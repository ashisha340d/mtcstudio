'use strict';
const { dbAll, dbGet, dbRun, transaction } = require('../pos/db');

const ATTENDANCE_VALUES = new Set(['FULL', 'HALF', 'ABSENT', 'LEAVE', 'OFF']);
const SETTLEMENT_STATUSES = new Set(['UNSETTLED', 'PENDING', 'PAID']);
const ADJUSTMENT_KINDS = new Set(['BONUS', 'PENALTY', 'ADVANCE']);

const EMPLOYEE_SELECT = `
    SELECT e.*, c.name AS customer_name, c.phone AS customer_phone, c.email, c.address,
           u.name AS pos_user_name, u.employee_id AS pos_user_code,
           m.filename AS photo_filename,
           (SELECT s.salary FROM employee_salary_history s
             WHERE s.customer_id = e.customer_id ORDER BY s.effective_from DESC LIMIT 1) AS current_salary
      FROM employee_profiles e
      JOIN customers c ON c.id = e.customer_id
      LEFT JOIN pos_users u ON u.id = e.pos_user_id
      LEFT JOIN media_library m ON m.id = e.photo_media_id`;

/** Server clock in ISO date form — the ceiling for anything backdated-only. */
function todayIso() {
    return new Date().toISOString().slice(0, 10);
}

function assertNotFuture(date, what) {
    if (normalizeDate(date) > todayIso()) throw new Error(`${what} cannot be in the future`);
}

/* ── employees ───────────────────────────────────────────────── */

async function getEmployeeProfiles() {
    return dbAll(`${EMPLOYEE_SELECT} ORDER BY e.status = 'active' DESC, c.name`);
}

async function getEmployeeProfile(customerId) {
    return dbGet(`${EMPLOYEE_SELECT} WHERE e.customer_id = ?`, [customerId]);
}

async function createEmployeeProfile(customerId, data, posUserId) {
    const existing = await dbGet(`SELECT id FROM employee_profiles WHERE customer_id = ?`, [customerId]);
    if (existing) throw new Error('This customer is already an employee');
    const customer = await dbGet(`SELECT id FROM customers WHERE id = ?`, [customerId]);
    if (!customer) throw new Error('Customer not found');
    assertNotFuture(data.join_date, 'Join date');

    await dbRun(
        `INSERT INTO employee_profiles (customer_id, employee_number, department, designation, photo_media_id, join_date, status, notes, pos_user_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
        [customerId, data.employee_number, data.department ?? null, data.designation ?? null,
        data.photo_media_id ?? null,
        data.join_date, data.status || 'active', data.notes ?? null, data.pos_user_id ?? posUserId ?? null]
    );
    if (data.salary !== undefined && data.salary !== null && data.salary !== '') {
        await createSalaryHistory(customerId, data.join_date, parseFloat(data.salary), 'Starting salary');
    }
    return getEmployeeProfile(customerId);
}

async function updateEmployeeProfile(customerId, data) {
    const existing = await getEmployeeProfile(customerId);
    if (!existing) return null;
    if (data.join_date) assertNotFuture(data.join_date, 'Join date');
    await dbRun(
        `UPDATE employee_profiles
        SET employee_number = ?, department = ?, designation = ?, photo_media_id = ?, join_date = ?, status = ?, notes = ?, pos_user_id = ?
      WHERE customer_id = ?`,
        [data.employee_number ?? existing.employee_number,
        data.department ?? existing.department,
        data.designation ?? existing.designation,
        data.photo_media_id !== undefined ? data.photo_media_id : existing.photo_media_id,
        data.join_date ?? existing.join_date,
        data.status ?? existing.status,
        data.notes ?? existing.notes,
        data.pos_user_id ?? existing.pos_user_id,
            customerId]
    );
    return getEmployeeProfile(customerId);
}

async function deleteEmployeeProfile(customerId) {
    const linked = await dbGet(
        `SELECT COUNT(*) AS n FROM payroll_run_lines WHERE customer_id = ?`, [customerId]);
    if (linked?.n) throw new Error('Employee appears on payroll runs — set status to terminated instead');
    await dbRun(`DELETE FROM employee_profiles WHERE customer_id = ?`, [customerId]);
    return { ok: true };
}

/** Customers who are not yet employees — the "add employee" picker source. */
async function searchCandidates(q) {
    const like = `%${String(q || '').trim()}%`;
    return dbAll(
        `SELECT c.id, c.name, c.phone, c.email
       FROM customers c
      WHERE c.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM employee_profiles e WHERE e.customer_id = c.id)
        AND (c.name LIKE ? OR c.phone LIKE ?)
      ORDER BY c.name LIMIT 25`,
        [like, like]
    );
}

/**
 * Distinct department / designation values already in use — the combo inputs
 * offer these as suggestions while still accepting a free-typed new value.
 */
async function getTaxonomy() {
    const [departments, designations] = await Promise.all([
        dbAll(`SELECT DISTINCT department AS v FROM employee_profiles
                WHERE department IS NOT NULL AND department != '' ORDER BY department`),
        dbAll(`SELECT DISTINCT designation AS v FROM employee_profiles
                WHERE designation IS NOT NULL AND designation != '' ORDER BY designation`),
    ]);
    return { departments: departments.map(r => r.v), designations: designations.map(r => r.v) };
}

/* ── salary ──────────────────────────────────────────────────── */

async function getSalaryHistory(customerId) {
    return dbAll(
        `SELECT * FROM employee_salary_history WHERE customer_id = ? ORDER BY effective_from DESC`,
        [customerId]
    );
}

async function getLatestSalary(customerId, referenceDate) {
    return dbGet(
        `SELECT * FROM employee_salary_history
     WHERE customer_id = ? AND effective_from <= ?
     ORDER BY effective_from DESC LIMIT 1`,
        [customerId, referenceDate]
    );
}

async function createSalaryHistory(customerId, effectiveFrom, salary, notes) {
    await dbRun(
        `INSERT INTO employee_salary_history (customer_id, effective_from, salary, notes)
     VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE salary = VALUES(salary), notes = VALUES(notes)`,
        [customerId, effectiveFrom, salary, notes ?? null]
    );
    return dbGet(
        `SELECT * FROM employee_salary_history WHERE customer_id = ? AND effective_from = ?`,
        [customerId, effectiveFrom]
    );
}

async function deleteSalaryHistory(id) {
    await dbRun(`DELETE FROM employee_salary_history WHERE id = ?`, [id]);
    return { ok: true };
}

/* ── attendance ──────────────────────────────────────────────── */

async function getAttendance(customerId, fromDate, toDate) {
    return dbAll(
        `SELECT * FROM employee_attendance
     WHERE customer_id = ? AND attendance_date >= ? AND attendance_date <= ?
     ORDER BY attendance_date`,
        [customerId, fromDate, toDate]
    );
}

/** Whole-team attendance for a date window — powers the month grid. */
async function getAttendanceMatrix(fromDate, toDate) {
    return dbAll(
        `SELECT a.customer_id, a.attendance_date, a.attendance_code
       FROM employee_attendance a
       JOIN employee_profiles e ON e.customer_id = a.customer_id
      WHERE a.attendance_date >= ? AND a.attendance_date <= ?`,
        [fromDate, toDate]
    );
}

async function persistAttendance(customerId, attendanceDate, attendanceCode, notes, createdBy) {
    if (!ATTENDANCE_VALUES.has(attendanceCode)) throw new Error('Invalid attendance code');
    assertNotFuture(attendanceDate, 'Attendance date');
    await dbRun(
        `INSERT INTO employee_attendance (customer_id, attendance_date, attendance_code, notes, created_by)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE attendance_code = VALUES(attendance_code), notes = VALUES(notes)`,
        [customerId, attendanceDate, attendanceCode, notes ?? null, createdBy ?? null]
    );
    return dbGet(
        `SELECT * FROM employee_attendance WHERE customer_id = ? AND attendance_date = ?`,
        [customerId, attendanceDate]
    );
}

async function updateAttendance(id, attendanceCode, notes) {
    if (attendanceCode && !ATTENDANCE_VALUES.has(attendanceCode)) throw new Error('Invalid attendance code');
    const row = await dbGet(`SELECT * FROM employee_attendance WHERE id = ?`, [id]);
    if (!row) return null;
    await dbRun(
        `UPDATE employee_attendance SET attendance_code = ?, notes = ? WHERE id = ?`,
        [attendanceCode ?? row.attendance_code, notes ?? row.notes, id]
    );
    return dbGet(`SELECT * FROM employee_attendance WHERE id = ?`, [id]);
}

/**
 * Save a batch of grid cells in one transaction. A cell with a null/empty code
 * clears the mark rather than storing a sentinel — an unmarked day is treated
 * as a normal worked day by the payroll run.
 */
async function bulkSaveAttendance(cells, createdBy) {
    const cutoff = todayIso();
    return transaction(async (tx) => {
        for (const cell of cells) {
            const { customer_id, attendance_date, attendance_code } = cell;
            if (!customer_id || !attendance_date) continue;
            // Attendance is a record of what happened, never a forecast.
            if (normalizeDate(attendance_date) > cutoff) throw new Error(`Cannot mark attendance for ${attendance_date} — it is in the future`);
            if (!attendance_code) {
                await tx.dbRun(
                    `DELETE FROM employee_attendance WHERE customer_id = ? AND attendance_date = ?`,
                    [customer_id, attendance_date]);
                continue;
            }
            if (!ATTENDANCE_VALUES.has(attendance_code)) throw new Error(`Invalid attendance code ${attendance_code}`);
            await tx.dbRun(
                `INSERT INTO employee_attendance (customer_id, attendance_date, attendance_code, created_by)
         VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE attendance_code = VALUES(attendance_code)`,
                [customer_id, attendance_date, attendance_code, createdBy ?? null]);
        }
        return { saved: cells.length };
    });
}

/* ── adjustments (bonus / penalty / advance) ─────────────────── */

async function getAdjustments({ customerId, from, to, pendingOnly } = {}) {
    const where = [];
    const params = [];
    if (customerId) { where.push('a.customer_id = ?'); params.push(customerId); }
    if (from) { where.push('a.adj_date >= ?'); params.push(from); }
    if (to) { where.push('a.adj_date <= ?'); params.push(to); }
    if (pendingOnly) where.push('a.payroll_run_id IS NULL');
    return dbAll(
        `SELECT a.*, c.name AS customer_name, c.phone AS customer_phone, e.employee_number
       FROM employee_adjustments a
       JOIN customers c ON c.id = a.customer_id
       LEFT JOIN employee_profiles e ON e.customer_id = a.customer_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.adj_date DESC, a.id DESC`,
        params
    );
}

async function createAdjustment(customerId, kind, amount, adjDate, note, createdBy) {
    if (!ADJUSTMENT_KINDS.has(kind)) throw new Error('Invalid adjustment kind');
    if (!(amount > 0)) throw new Error('Amount must be greater than zero');
    const r = await dbRun(
        `INSERT INTO employee_adjustments (customer_id, adj_date, kind, amount, note, created_by)
     VALUES (?,?,?,?,?,?)`,
        [customerId, adjDate, kind, amount, note ?? null, createdBy ?? null]
    );
    return dbGet(`SELECT * FROM employee_adjustments WHERE id = ?`, [r.insertId ?? r.lastID]);
}

async function deleteAdjustment(id) {
    const row = await dbGet(`SELECT * FROM employee_adjustments WHERE id = ?`, [id]);
    if (!row) return null;
    if (row.payroll_run_id) throw new Error('Adjustment already consumed by a payroll run');
    await dbRun(`DELETE FROM employee_adjustments WHERE id = ?`, [id]);
    return { ok: true };
}

/* ── settings ────────────────────────────────────────────────── */

async function getPayrollSettings() {
    const settings = await dbGet(`SELECT * FROM payroll_settings ORDER BY id DESC LIMIT 1`);
    if (settings) return settings;
    await dbRun(`INSERT INTO payroll_settings (salary_cutoff_day) VALUES (30)`);
    return dbGet(`SELECT * FROM payroll_settings ORDER BY id DESC LIMIT 1`);
}

async function updatePayrollSettings(data) {
    const existing = await getPayrollSettings();
    await dbRun(
        `UPDATE payroll_settings
        SET salary_cutoff_day = ?, days_basis = ?, fixed_days = ?, half_day_factor = ?,
            deduct_absent = ?, deduct_staff_purchases = ?, carry_unsettled = ?
      WHERE id = ?`,
        [data.salary_cutoff_day ?? existing.salary_cutoff_day,
        data.days_basis ?? existing.days_basis,
        data.fixed_days ?? existing.fixed_days,
        data.half_day_factor ?? existing.half_day_factor,
        data.deduct_absent !== undefined ? (data.deduct_absent ? 1 : 0) : existing.deduct_absent,
        data.deduct_staff_purchases !== undefined ? (data.deduct_staff_purchases ? 1 : 0) : existing.deduct_staff_purchases,
        data.carry_unsettled !== undefined ? (data.carry_unsettled ? 1 : 0) : existing.carry_unsettled,
        existing.id]
    );
    return dbGet(`SELECT * FROM payroll_settings WHERE id = ?`, [existing.id]);
}

function normalizeDate(value) {
    return String(value).slice(0, 10);
}

function daysBetween(from, to) {
    const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
    return Math.round(ms / 86400000) + 1;
}

/* ── payroll runs ────────────────────────────────────────────── */

/**
 * Per-employee payroll working for a period. Pure read — used both when a run
 * is created and when a draft run is recalculated, so the two can never drift.
 */
async function computeLine(emp, periodStart, periodEnd, settings, runId) {
    const salaryRow = await getLatestSalary(emp.customer_id, periodEnd);
    const baseSalary = Number(salaryRow?.salary ?? 0);

    const basisDays = settings.days_basis === 'CALENDAR'
        ? daysBetween(periodStart, periodEnd)
        : Number(settings.fixed_days || 30);
    const perDay = basisDays > 0 ? baseSalary / basisDays : 0;

    const attendance = await getAttendance(emp.customer_id, periodStart, periodEnd);
    const count = (code) => attendance.filter(a => a.attendance_code === code).length;
    const daysFull = count('FULL');
    const daysHalf = count('HALF');
    const daysAbsent = count('ABSENT');
    const daysLeave = count('LEAVE');
    const daysOff = count('OFF');

    // Unmarked days count as worked — attendance is exception-based, so a blank
    // grid must not zero out a salary. Only ABSENT and HALF reduce pay.
    const halfFactor = Number(settings.half_day_factor ?? 0.5);
    const unpaidDays = settings.deduct_absent
        ? daysAbsent + daysHalf * (1 - halfFactor)
        : 0;
    const payableDays = Math.max(0, basisDays - unpaidDays);
    const attendanceAdjustment = -(unpaidDays * perDay);

    const commissionRow = runId ? await dbGet(
        `SELECT COALESCE(SUM(amount),0) AS total FROM payroll_commission_imports
      WHERE payroll_run_id = ? AND customer_id = ?`, [runId, emp.customer_id]) : null;
    const commissionAmount = Number(commissionRow?.total ?? 0);

    const pending = await dbAll(
        `SELECT kind, COALESCE(SUM(amount),0) AS total FROM employee_adjustments
      WHERE customer_id = ? AND adj_date <= ? AND (payroll_run_id IS NULL OR payroll_run_id = ?)
      GROUP BY kind`,
        [emp.customer_id, periodEnd, runId ?? 0]);
    const byKind = (k) => Number(pending.find(p => p.kind === k)?.total ?? 0);
    const bonusAmount = byKind('BONUS');
    const penaltyAmount = byKind('PENALTY');
    const advanceDeduction = byKind('ADVANCE');

    let staffPurchaseDeduction = 0;
    if (settings.deduct_staff_purchases && emp.customer_phone) {
        const sp = await dbGet(
            `SELECT COALESCE(SUM(total_amount),0) AS total FROM pos_orders
        WHERE is_staff_purchase = 1 AND customer_phone = ?
          AND DATE(created_at) >= ? AND DATE(created_at) <= ?`,
            [emp.customer_phone, periodStart, periodEnd]);
        staffPurchaseDeduction = Number(sp?.total ?? 0);
    }

    let previousBalance = 0;
    if (settings.carry_unsettled) {
        const prev = await dbGet(
            `SELECT COALESCE(SUM(l.net_pay),0) AS total
         FROM payroll_run_lines l JOIN payroll_runs r ON r.id = l.payroll_run_id
        WHERE l.customer_id = ? AND l.settlement_status = 'UNSETTLED'
          AND r.status = 'FINALIZED' AND r.period_end < ?`,
            [emp.customer_id, periodStart]);
        previousBalance = Number(prev?.total ?? 0);
    }

    const netPay = baseSalary + attendanceAdjustment + commissionAmount + bonusAmount
        - penaltyAmount - staffPurchaseDeduction - advanceDeduction + previousBalance;

    return {
        base_salary: baseSalary,
        days_full: daysFull, days_half: daysHalf, days_absent: daysAbsent,
        days_leave: daysLeave, days_off: daysOff,
        basis_days: basisDays, payable_days: payableDays,
        attendance_adjustment: attendanceAdjustment,
        commission_amount: commissionAmount,
        bonus_amount: bonusAmount,
        penalty_amount: penaltyAmount,
        adjustment_amount: 0,
        staff_purchase_deduction: staffPurchaseDeduction,
        advance_deduction: advanceDeduction,
        previous_balance: previousBalance,
        net_pay: netPay,
    };
}

async function writeRunLines(runId, periodStart, periodEnd) {
    const settings = await getPayrollSettings();
    const employees = (await getEmployeeProfiles()).filter(e => e.status === 'active');

    await dbRun(`DELETE FROM payroll_run_lines WHERE payroll_run_id = ?`, [runId]);

    let totalGross = 0;
    let totalDeductions = 0;
    let totalNet = 0;

    for (const emp of employees) {
        const l = await computeLine(emp, periodStart, periodEnd, settings, runId);
        const gross = l.base_salary + l.attendance_adjustment + l.commission_amount + l.bonus_amount;
        const deductions = l.penalty_amount + l.staff_purchase_deduction + l.advance_deduction;
        totalGross += gross;
        totalDeductions += deductions;
        totalNet += l.net_pay;

        await dbRun(`
      INSERT INTO payroll_run_lines (
        payroll_run_id, customer_id, employee_number, customer_name, customer_phone,
        base_salary, days_full, days_half, days_absent, days_leave, days_off,
        basis_days, payable_days, attendance_adjustment, commission_amount, bonus_amount,
        penalty_amount, adjustment_amount, staff_purchase_deduction,
        advance_deduction, previous_balance, net_pay
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [runId, emp.customer_id, emp.employee_number, emp.customer_name, emp.customer_phone,
            l.base_salary, l.days_full, l.days_half, l.days_absent, l.days_leave, l.days_off,
            l.basis_days, l.payable_days, l.attendance_adjustment, l.commission_amount, l.bonus_amount,
            l.penalty_amount, l.adjustment_amount, l.staff_purchase_deduction,
            l.advance_deduction, l.previous_balance, l.net_pay]);
    }

    await dbRun(
        `UPDATE payroll_runs SET total_gross = ?, total_deductions = ?, total_net = ? WHERE id = ?`,
        [totalGross, totalDeductions, totalNet, runId]);

    return dbGet(`SELECT * FROM payroll_runs WHERE id = ?`, [runId]);
}

async function createPayrollRun(periodStart, periodEnd, generatedBy) {
    if (periodEnd < periodStart) throw new Error('Period end must be on or after period start');
    const existing = await dbGet(
        `SELECT id FROM payroll_runs WHERE period_start = ? AND period_end = ? AND status != 'REVERSED' LIMIT 1`,
        [periodStart, periodEnd]);
    if (existing) throw new Error('Payroll run already exists for this period');

    const r = await dbRun(
        `INSERT INTO payroll_runs (period_start, period_end, generated_by) VALUES (?,?,?)`,
        [periodStart, periodEnd, generatedBy ?? null]);
    const runId = r.insertId ?? r.lastID;
    return writeRunLines(runId, periodStart, periodEnd);
}

/** Rebuild a draft run's lines — picks up attendance, commission imports and
 *  adjustments entered after the run was first generated. */
async function recalcPayrollRun(runId) {
    const run = await dbGet(`SELECT * FROM payroll_runs WHERE id = ?`, [runId]);
    if (!run) throw new Error('Payroll run not found');
    if (run.status !== 'DRAFT') throw new Error('Only draft payroll runs can be recalculated');
    return writeRunLines(run.id, run.period_start, run.period_end);
}

async function finalizePayrollRun(runId) {
    const run = await dbGet(`SELECT * FROM payroll_runs WHERE id = ?`, [runId]);
    if (!run) throw new Error('Payroll run not found');
    if (run.status !== 'DRAFT') throw new Error('Only draft payroll runs can be finalized');
    return transaction(async (tx) => {
        // Claim every adjustment the run priced in, so the next run cannot
        // deduct the same advance or pay the same bonus twice.
        await tx.dbRun(
            `UPDATE employee_adjustments SET payroll_run_id = ?
        WHERE payroll_run_id IS NULL AND adj_date <= ?
          AND customer_id IN (SELECT customer_id FROM payroll_run_lines WHERE payroll_run_id = ?)`,
            [runId, run.period_end, runId]);
        await tx.dbRun(`UPDATE payroll_runs SET status = 'FINALIZED' WHERE id = ?`, [runId]);
        return tx.dbGet(`SELECT * FROM payroll_runs WHERE id = ?`, [runId]);
    });
}

async function reversePayrollRun(runId) {
    const run = await dbGet(`SELECT * FROM payroll_runs WHERE id = ?`, [runId]);
    if (!run) throw new Error('Payroll run not found');
    if (run.status === 'REVERSED') throw new Error('Payroll run already reversed');
    return transaction(async (tx) => {
        await tx.dbRun(`UPDATE employee_adjustments SET payroll_run_id = NULL WHERE payroll_run_id = ?`, [runId]);
        await tx.dbRun(`UPDATE payroll_runs SET status = 'REVERSED' WHERE id = ?`, [runId]);
        return tx.dbGet(`SELECT * FROM payroll_runs WHERE id = ?`, [runId]);
    });
}

async function deletePayrollRun(runId) {
    const run = await dbGet(`SELECT * FROM payroll_runs WHERE id = ?`, [runId]);
    if (!run) return null;
    if (run.status === 'FINALIZED') throw new Error('Finalized runs cannot be deleted — reverse it first');
    await dbRun(`DELETE FROM payroll_runs WHERE id = ?`, [runId]);
    return { ok: true };
}

async function getPayrollRuns() {
    return dbAll(
        `SELECT pr.*, u.name AS generated_by_name, u.employee_id AS generated_by_emp,
            (SELECT COUNT(*) FROM payroll_run_lines l WHERE l.payroll_run_id = pr.id) AS line_count,
            (SELECT COUNT(*) FROM payroll_run_lines l WHERE l.payroll_run_id = pr.id AND l.settlement_status = 'PAID') AS paid_count
       FROM payroll_runs pr LEFT JOIN pos_users u ON u.id = pr.generated_by
      ORDER BY pr.period_start DESC, pr.id DESC`);
}

async function getPayrollRun(runId) {
    return dbGet(
        `SELECT pr.*, u.name AS generated_by_name, u.employee_id AS generated_by_emp
       FROM payroll_runs pr LEFT JOIN pos_users u ON u.id = pr.generated_by WHERE pr.id = ?`,
        [runId]);
}

async function getPayrollLines(runId) {
    return dbAll(
        `SELECT * FROM payroll_run_lines WHERE payroll_run_id = ? ORDER BY customer_name`,
        [runId]);
}

async function updatePayrollLineSettlement(lineId, settlementStatus, settlementNote, drawerMovementId) {
    if (settlementStatus && !SETTLEMENT_STATUSES.has(settlementStatus)) throw new Error('Invalid settlement status');
    const row = await dbGet(`SELECT * FROM payroll_run_lines WHERE id = ?`, [lineId]);
    if (!row) return null;
    await dbRun(
        `UPDATE payroll_run_lines SET settlement_status = ?, settlement_note = ?, drawer_movement_id = ? WHERE id = ?`,
        [settlementStatus ?? row.settlement_status,
        settlementNote !== undefined ? settlementNote : row.settlement_note,
        drawerMovementId ?? row.drawer_movement_id, lineId]);
    return dbGet(`SELECT * FROM payroll_run_lines WHERE id = ?`, [lineId]);
}

/* ── commission rules ────────────────────────────────────────── */

async function getCommissionRules() {
    return dbAll(`SELECT cr.*, u.employee_id AS created_by_emp FROM commission_rules cr LEFT JOIN pos_users u ON u.id = cr.created_by ORDER BY cr.active DESC, cr.effective_from DESC`);
}

async function getCommissionRule(id) {
    return dbGet(`SELECT * FROM commission_rules WHERE id = ?`, [id]);
}

async function createCommissionRule(name, ruleType, criteriaJson, rateType, rateValue, active, effectiveFrom, createdBy) {
    const r = await dbRun(
        `INSERT INTO commission_rules (name,rule_type,criteria_json,rate_type,rate_value,active,effective_from,created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
        [name, ruleType, criteriaJson ? JSON.stringify(criteriaJson) : null, rateType, rateValue, active ? 1 : 0, effectiveFrom, createdBy ?? null]);
    return getCommissionRule(r.insertId ?? r.lastID);
}

async function updateCommissionRule(id, data) {
    const rule = await getCommissionRule(id);
    if (!rule) return null;
    await dbRun(
        `UPDATE commission_rules SET name=?,rule_type=?,criteria_json=?,rate_type=?,rate_value=?,active=?,effective_from=? WHERE id=?`,
        [data.name ?? rule.name, data.rule_type ?? rule.rule_type,
        data.criteria_json ? JSON.stringify(data.criteria_json) : rule.criteria_json,
        data.rate_type ?? rule.rate_type, data.rate_value ?? rule.rate_value,
        data.active !== undefined ? (data.active ? 1 : 0) : rule.active,
        data.effective_from ?? rule.effective_from, id]);
    return getCommissionRule(id);
}

async function deleteCommissionRule(id) {
    await dbRun(`DELETE FROM commission_rules WHERE id = ?`, [id]);
    return { ok: true };
}

async function importPayrollCommission(payrollRunId, sourceType, sourceId, customerId, amount, description, uniqueKey) {
    const existing = await dbGet(
        `SELECT * FROM payroll_commission_imports WHERE payroll_run_id = ? AND unique_key = ?`,
        [payrollRunId, uniqueKey]);
    if (existing) return existing;
    const r = await dbRun(
        `INSERT INTO payroll_commission_imports (payroll_run_id, source_type, source_id, customer_id, amount, description, unique_key)
     VALUES (?,?,?,?,?,?,?)`,
        [payrollRunId, sourceType, sourceId, customerId, amount, description ?? null, uniqueKey]);
    return dbGet(`SELECT * FROM payroll_commission_imports WHERE id = ?`, [r.insertId ?? r.lastID]);
}

/* ── dashboard ───────────────────────────────────────────────── */

async function getHrSummary() {
    const staff = await dbGet(
        `SELECT COUNT(*) AS total,
            SUM(status = 'active')   AS active,
            SUM(status = 'on_leave') AS on_leave,
            SUM(status IN ('inactive','terminated')) AS inactive
       FROM employee_profiles`);
    const cost = await dbGet(
        `SELECT COALESCE(SUM(s.salary),0) AS monthly
       FROM employee_profiles e
       JOIN employee_salary_history s ON s.id = (
            SELECT id FROM employee_salary_history x
             WHERE x.customer_id = e.customer_id ORDER BY x.effective_from DESC LIMIT 1)
      WHERE e.status = 'active'`);
    const pending = await dbGet(
        `SELECT COALESCE(SUM(CASE WHEN kind = 'ADVANCE' THEN amount ELSE 0 END),0) AS advances,
            COALESCE(SUM(CASE WHEN kind = 'BONUS'   THEN amount ELSE 0 END),0) AS bonuses,
            COALESCE(SUM(CASE WHEN kind = 'PENALTY' THEN amount ELSE 0 END),0) AS penalties
       FROM employee_adjustments WHERE payroll_run_id IS NULL`);
    const unsettled = await dbGet(
        `SELECT COALESCE(SUM(l.net_pay),0) AS total, COUNT(*) AS line_count
       FROM payroll_run_lines l JOIN payroll_runs r ON r.id = l.payroll_run_id
      WHERE r.status = 'FINALIZED' AND l.settlement_status != 'PAID'`);

    // Month-to-date attendance. Days elapsed is the ceiling — an unmarked day
    // counts as present, so "present" is elapsed minus the marked exceptions.
    const t = todayIso();
    const monthStart = `${t.slice(0, 7)}-01`;
    const elapsed = Number(t.slice(8, 10));
    const marks = await dbAll(
        `SELECT a.customer_id, a.attendance_code, COUNT(*) AS n
       FROM employee_attendance a
       JOIN employee_profiles e ON e.customer_id = a.customer_id AND e.status = 'active'
      WHERE a.attendance_date >= ? AND a.attendance_date <= ?
      GROUP BY a.customer_id, a.attendance_code`, [monthStart, t]);
    const sumOf = (code) => marks.filter(m => m.attendance_code === code).reduce((s, m) => s + Number(m.n), 0);
    const activeStaff = Number(staff?.active ?? 0);
    const absent = sumOf('ABSENT');
    const half = sumOf('HALF');
    const leave = sumOf('LEAVE');
    const off = sumOf('OFF');
    const attendance = {
        month: t.slice(0, 7),
        days_elapsed: elapsed,
        possible: activeStaff * elapsed,
        present: Math.max(0, activeStaff * elapsed - absent - half - leave - off),
        half, absent, leave, off,
    };
    attendance.rate = attendance.possible ? attendance.present / attendance.possible : 0;

    return {
        attendance,
        staff: {
            total: Number(staff?.total ?? 0), active: Number(staff?.active ?? 0),
            on_leave: Number(staff?.on_leave ?? 0), inactive: Number(staff?.inactive ?? 0),
        },
        monthly_cost: Number(cost?.monthly ?? 0),
        pending: {
            advances: Number(pending?.advances ?? 0),
            bonuses: Number(pending?.bonuses ?? 0),
            penalties: Number(pending?.penalties ?? 0),
        },
        unsettled: { amount: Number(unsettled?.total ?? 0), lines: Number(unsettled?.line_count ?? 0) },
    };
}

module.exports = {
    getEmployeeProfiles,
    getEmployeeProfile,
    createEmployeeProfile,
    updateEmployeeProfile,
    deleteEmployeeProfile,
    searchCandidates,
    getTaxonomy,
    getSalaryHistory,
    getLatestSalary,
    createSalaryHistory,
    deleteSalaryHistory,
    getAttendance,
    getAttendanceMatrix,
    persistAttendance,
    updateAttendance,
    bulkSaveAttendance,
    getAdjustments,
    createAdjustment,
    deleteAdjustment,
    getPayrollSettings,
    updatePayrollSettings,
    createPayrollRun,
    recalcPayrollRun,
    finalizePayrollRun,
    reversePayrollRun,
    deletePayrollRun,
    getPayrollRuns,
    getPayrollRun,
    getPayrollLines,
    updatePayrollLineSettlement,
    getCommissionRules,
    getCommissionRule,
    createCommissionRule,
    updateCommissionRule,
    deleteCommissionRule,
    importPayrollCommission,
    getHrSummary,
    normalizeDate,
    todayIso,
};
