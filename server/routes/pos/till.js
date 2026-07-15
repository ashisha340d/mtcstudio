'use strict';
const express = require('express');
const bcrypt  = require('bcryptjs');
const { dbAll, dbGet, dbRun, transaction } = require('../../pos/db');
const { requireSession, requireRole } = require('../../middleware/posAuth');
const { audit }          = require('../../middleware/posAudit');
const { getNepalDateStr, getNepalDayBoundsUTC } = require('../../utils/nepalDateTime');

const router = express.Router();
router.use(requireSession);

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const MOVEMENT_TYPES = ['CASH_IN', 'PETTY_CASH', 'PAID_OUT', 'CREDIT_RECEIVED'];
const IN_TYPES  = ['CASH_IN', 'CREDIT_RECEIVED'];
const OUT_TYPES = ['PETTY_CASH', 'PAID_OUT'];
const TERMINAL_ID = process.env.POS_TERMINAL_ID || 'POS-01';

// Cash sales for the business day, computed the same way as the sales report
// (/reports/sales): cash payments of orders CLOSED on the business date (net of
// change given) plus cake cash collected that date (deleted cakes excluded).
// Reverted checkouts drop out (order no longer CLOSED / negative payment rows).
async function sessionCashSales(session) {
  const date = String(session.business_date).slice(0, 10);
  const cap  = session.closed_at; // frozen history once the day is closed

  const ord = await dbGet(
    `SELECT COALESCE(SUM(p.amount),0) AS cash
     FROM pos_payments p JOIN pos_orders o ON o.id = p.order_id
     WHERE p.method='CASH' AND o.status='CLOSED' AND DATE(o.closed_at)=?${cap ? ' AND o.closed_at <= ?' : ''}`,
    cap ? [date, cap] : [date]);
  const chg = await dbGet(
    `SELECT COALESCE(SUM(change_amount),0) AS c FROM pos_orders
     WHERE status='CLOSED' AND DATE(closed_at)=?${cap ? ' AND closed_at <= ?' : ''}`,
    cap ? [date, cap] : [date]);
  const cake = await dbGet(
    `SELECT COALESCE(SUM(p.amount),0) AS cash
     FROM pos_payments p JOIN cake_orders co ON co.id = p.cake_order_id
     WHERE p.method='CASH' AND co.deleted_at IS NULL AND DATE(p.created_at)=?${cap ? ' AND p.created_at <= ?' : ''}`,
    cap ? [date, cap] : [date]);

  return round2(ord.cash - chg.c + cake.cash);
}

async function findManagerByPin(pin) {
  const managers = await dbAll(
    `SELECT u.*, r.name AS role FROM pos_users u JOIN pos_roles r ON r.id=u.role_id
     WHERE u.is_active=1 AND r.name IN ('MANAGER','ADMIN')`);
  for (const m of managers) {
    if (bcrypt.compareSync(String(pin), m.pin_hash)) return m;
  }
  return null;
}

// Signed sum of drawer movements for one till session (in: +, out: −)
async function movementsNet(tillId) {
  const row = await dbGet(
    `SELECT COALESCE(SUM(CASE WHEN type IN ('CASH_IN','CREDIT_RECEIVED') THEN amount ELSE -amount END),0) AS net
     FROM pos_cash_movements WHERE till_session_id = ?`, [tillId]);
  return round2(row.net);
}

router.get('/current', async (req, res) => {
  const till = await dbGet(
    `SELECT t.*, u1.name AS opened_by_name, u1.employee_id AS opened_by_emp
     FROM   pos_till_sessions t
     LEFT JOIN pos_users u1 ON u1.id = t.opened_by
     WHERE  t.status = 'OPEN' ORDER BY t.id DESC LIMIT 1`
  );
  if (!till) return res.json(null);
  const net = await movementsNet(till.id);
  res.json({ ...till, movements_net: net, expected_cash: round2(till.opening_float + till.cash_sales + net) });
});

router.post('/open', async (req, res) => {
  const today = getNepalDateStr();
  const existing = await dbGet(
    `SELECT id, status FROM pos_till_sessions WHERE business_date=? ORDER BY id DESC LIMIT 1`, [today]);
  if (existing?.status === 'OPEN')   return res.status(400).json({ error: 'Business day already open' });
  if (existing?.status === 'CLOSED') return res.status(400).json({ error: 'Business day already closed — reopen it instead' });
  if (await dbGet(`SELECT id FROM pos_till_sessions WHERE status='OPEN'`)) {
    return res.status(400).json({ error: 'A previous business day is still open — close it first' });
  }

  // Default opening = yesterday's closing balance (carry-over)
  let openingFloat = parseFloat(req.body.opening_float);
  if (!Number.isFinite(openingFloat)) {
    const prev = await dbGet(
      `SELECT closing_balance FROM pos_till_sessions
       WHERE status='CLOSED' AND business_date < ? ORDER BY business_date DESC, id DESC LIMIT 1`, [today]);
    openingFloat = round2(prev?.closing_balance ?? 0);
  }

  const till = await dbGet(
    `INSERT INTO pos_till_sessions (opened_by, opening_float, business_date) VALUES (?,?,?) RETURNING *`,
    [req.posUser.id, round2(openingFloat), today]
  );
  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'TILL', entityId: till.id, action: 'OPEN', delta: { opening_float: till.opening_float, business_date: today } });
  res.status(201).json(till);
});

// ── Daily Cash Closing (business day) ───────────────────────────

async function daySessionPayload(dateStr) {
  const SESSION_SELECT = `
    SELECT t.*, u1.name AS opened_by_name, u2.name AS closed_by_name, u3.name AS reopened_by_name
    FROM pos_till_sessions t
    LEFT JOIN pos_users u1 ON u1.id = t.opened_by
    LEFT JOIN pos_users u2 ON u2.id = t.closed_by
    LEFT JOIN pos_users u3 ON u3.id = t.reopened_by`;

  // A still-open session (even from an earlier date) IS the current business day —
  // it must be closed before a new day can be opened.
  let session = await dbGet(`${SESSION_SELECT} WHERE t.status='OPEN' ORDER BY t.id DESC LIMIT 1`);
  if (!session) {
    session = await dbGet(`${SESSION_SELECT} WHERE t.business_date = ? ORDER BY t.id DESC LIMIT 1`, [dateStr]);
  } else {
    dateStr = String(session.business_date ?? dateStr).slice(0, 10);
  }

  let movements = [];
  let cashIn = 0, cashOut = 0, cashSales = 0;
  if (session) {
    movements = await dbAll(
      `SELECT m.*, u.name AS created_by_name FROM pos_cash_movements m
       LEFT JOIN pos_users u ON u.id = m.created_by
       WHERE m.till_session_id = ? ORDER BY m.id DESC`, [session.id]);
    for (const m of movements) {
      if (IN_TYPES.includes(m.type)) cashIn += m.amount; else cashOut += m.amount;
    }
    cashSales = await sessionCashSales(session);
  }
  const expected = session
    ? round2(session.opening_float + cashSales + cashIn - cashOut)
    : null;

  // Legacy sessions predate closing_balance — fall back to the counted cash
  const previous = await dbGet(
    `SELECT t.business_date, t.opening_float, t.cash_sales, t.closing_counted, t.variance,
            t.cash_taken, COALESCE(t.closing_balance, t.closing_counted) AS closing_balance,
            t.closed_at, u.name AS closed_by_name
     FROM pos_till_sessions t LEFT JOIN pos_users u ON u.id = t.closed_by
     WHERE t.status='CLOSED' AND t.business_date < ?
     ORDER BY t.business_date DESC, t.id DESC LIMIT 1`, [dateStr]);

  return {
    business_date: dateStr,
    today: getNepalDateStr(),
    terminal: TERMINAL_ID,
    session: session ? {
      ...session,
      cash_sales: cashSales,
      denominations: session.denominations_json ? JSON.parse(session.denominations_json) : null,
      cash_in: round2(cashIn),
      cash_out: round2(cashOut),
      expected_cash: expected,
    } : null,
    movements,
    previous: previous ? { ...previous, closing_balance: round2(previous.closing_balance ?? 0) } : null,
  };
}

// GET /api/pos/till/day?date=YYYY-MM-DD — full day status for the closing module
router.get('/day', async (req, res) => {
  res.json(await daySessionPayload(req.query.date ?? getNepalDateStr()));
});

// POST /api/pos/till/day/draft — save denomination count / cash taken / note without closing
router.post('/day/draft', async (req, res) => {
  const till = await dbGet(`SELECT * FROM pos_till_sessions WHERE status='OPEN' ORDER BY id DESC LIMIT 1`);
  if (!till) return res.status(400).json({ error: 'No open business day' });

  const { denominations, cash_taken, note } = req.body;
  await dbRun(
    `UPDATE pos_till_sessions SET denominations_json=?, cash_taken=?, closing_note=? WHERE id=?`,
    [denominations ? JSON.stringify(denominations) : null, round2(cash_taken), note ?? null, till.id]);
  res.json({ ok: true });
});

// POST /api/pos/till/day/close — close the business day (variance needs manager PIN)
router.post('/day/close', async (req, res) => {
  const till = await dbGet(`SELECT * FROM pos_till_sessions WHERE status='OPEN' ORDER BY id DESC LIMIT 1`);
  if (!till) return res.status(400).json({ error: 'No open business day' });

  const { denominations, cash_taken, note, manager_pin } = req.body;
  let counted = parseFloat(req.body.counted);
  if (denominations && !Number.isFinite(counted)) {
    counted = Object.entries(denominations).reduce((s, [d, q]) => s + Number(d) * (Number(q) || 0), 0);
  }
  if (!Number.isFinite(counted)) return res.status(400).json({ error: 'counted or denominations required' });
  counted = round2(counted);

  const cashSales = await sessionCashSales(till);
  const expected  = round2(till.opening_float + cashSales + await movementsNet(till.id));
  const variance  = round2(counted - expected);
  const taken     = round2(cash_taken);
  if (taken < 0 || taken > counted) return res.status(400).json({ error: 'cash_taken must be between 0 and counted cash' });

  let approver = null;
  if (Math.abs(variance) > 0.005) {
    if (!manager_pin) return res.status(400).json({ requiresApproval: true, variance, expected, counted, error: 'Variance — manager PIN required' });
    approver = await findManagerByPin(manager_pin);
    if (!approver) return res.status(401).json({ error: 'Invalid manager PIN' });
  }

  const closingBalance = round2(counted - taken);
  await dbRun(
    `UPDATE pos_till_sessions
     SET status='CLOSED', closed_by=?, closed_at=CURRENT_TIMESTAMP, cash_sales=?, closing_counted=?, variance=?,
         variance_note=?, variance_approved_by=?, denominations_json=?, cash_taken=?, closing_balance=?, closing_note=?
     WHERE id=?`,
    [req.posUser.id, cashSales, counted, variance, note ?? null, approver?.id ?? null,
     denominations ? JSON.stringify(denominations) : till.denominations_json,
     taken, closingBalance, note ?? null, till.id]);

  // Freeze the day-end snapshot so both modules agree the day is closed
  const dateStr = till.business_date ? String(till.business_date).slice(0, 10) : getNepalDateStr();
  if (!await dbGet(`SELECT id FROM pos_day_closures WHERE business_date=?`, [dateStr])) {
    const { buildDayEndReport } = require('./reports');
    const report = await buildDayEndReport(dateStr);
    const f = report.verification.flags;
    await dbRun(
      `INSERT INTO pos_day_closures
         (business_date, snapshot_json, sales_balanced, payments_balanced, cash_balanced,
          orders_balanced, cakes_balanced, credits_balanced, day_closed, closed_by, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [dateStr, JSON.stringify(report),
       f.sales_balanced ? 1 : 0, f.payments_balanced ? 1 : 0, f.cash_balanced ? 1 : 0,
       f.orders_balanced ? 1 : 0, f.cakes_balanced ? 1 : 0, f.credits_balanced ? 1 : 0,
       f.day_closed_ok ? 1 : 0, req.posUser.id, note ?? null]);
  }

  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'TILL', entityId: till.id, action: 'CLOSE_DAY',
          delta: { business_date: dateStr, counted, expected, variance, cash_taken: taken, closing_balance: closingBalance, approved_by: approver?.employee_id ?? null } });
  res.json({ ok: true, ...(await daySessionPayload(dateStr)) });
});

// POST /api/pos/till/day/reopen — manager/admin, reason required (audit trail)
router.post('/day/reopen', requireRole('MANAGER', 'ADMIN'), async (req, res) => {
  const reason = String(req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'reason required' });
  const dateStr = req.body.date ?? getNepalDateStr();

  const till = await dbGet(
    `SELECT * FROM pos_till_sessions WHERE business_date=? AND status='CLOSED' ORDER BY id DESC LIMIT 1`, [dateStr]);
  if (!till) return res.status(404).json({ error: 'No closed business day for that date' });
  if (await dbGet(`SELECT id FROM pos_till_sessions WHERE status='OPEN'`)) {
    return res.status(400).json({ error: 'Another business day is open — close it first' });
  }

  await dbRun(
    `UPDATE pos_till_sessions
     SET status='OPEN', reopened_by=?, reopened_at=CURRENT_TIMESTAMP, reopen_reason=?, reopen_count=reopen_count+1
     WHERE id=?`, [req.posUser.id, reason, till.id]);
  await dbRun(`DELETE FROM pos_day_closures WHERE business_date=?`, [dateStr]);

  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'TILL', entityId: till.id, action: 'REOPEN_DAY',
          delta: { business_date: dateStr, reason } });
  res.json({ ok: true, ...(await daySessionPayload(dateStr)) });
});

// POST /api/pos/till/day/print — thermal print of the daily cash closing report
router.post('/day/print', async (req, res) => {
  const dateStr = req.body.date ?? getNepalDateStr();
  const payload = await daySessionPayload(dateStr);
  const s = payload.session;
  if (!s) return res.status(404).json({ error: 'No business day for that date' });

  const mainDb = require('../../database/db');
  const pcfg = await mainDb.dbGet(`SELECT vendor_id, product_id, paper_width FROM printer_config WHERE id = 1`);
  const rows = await mainDb.dbAll(`SELECT \`key\`, value FROM receipt_config`);
  const rcfg = {};
  rows.forEach(r => rcfg[r.key] = r.value);
  rcfg.paper_width = pcfg?.paper_width || 80;

  const denoms = s.denominations
    ? Object.entries(s.denominations).map(([denom, qty]) => ({ denom: Number(denom), qty: Number(qty) || 0 }))
        .sort((a, b) => b.denom - a.denom)
    : [];

  const { buildCashClosingEscPos } = require('../../services/escposBuilder');
  const bytes = buildCashClosingEscPos({
    business_date: dateStr,
    terminal: payload.terminal,
    opened_at: s.opened_at,
    opened_by_name: s.opened_by_name,
    opening_float: s.opening_float,
    cash_sales: s.cash_sales,
    cash_in: s.cash_in,
    cash_out: s.cash_out,
    cash_in_list:  payload.movements.filter(m => IN_TYPES.includes(m.type)),
    cash_out_list: payload.movements.filter(m => OUT_TYPES.includes(m.type)),
    expected: s.expected_cash,
    denominations: denoms,
    counted: s.closing_counted,
    variance: s.variance,
    cash_taken: s.status === 'CLOSED' ? s.cash_taken : null,
    closing_balance: s.closing_balance,
    closing_note: s.closing_note,
    closed_at: s.closed_at,
    closed_by_name: s.closed_by_name,
  }, rcfg);

  const { printRawUsingConfig } = require('../../services/usbPrinter');
  await printRawUsingConfig(bytes, 1);
  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'TILL', entityId: s.id, action: 'PRINT_DAY_CLOSING', delta: { business_date: dateStr } });
  res.json({ ok: true });
});

router.post('/close', async (req, res) => {
  const { closing_counted, variance_note } = req.body;
  if (closing_counted === undefined) return res.status(400).json({ error: 'closing_counted required' });

  const till = await dbGet(`SELECT * FROM pos_till_sessions WHERE status='OPEN' ORDER BY id DESC LIMIT 1`);
  if (!till) return res.status(400).json({ error: 'No open till' });

  const counted  = parseFloat(closing_counted) || 0;
  const expected = round2(till.opening_float + till.cash_sales + await movementsNet(till.id));
  const variance = parseFloat((counted - expected).toFixed(2));

  if (variance !== 0) {
    await dbRun(`UPDATE pos_till_sessions SET closing_counted=?,variance=?,variance_note=? WHERE id=?`, [counted, variance, variance_note ?? null, till.id]);
    return res.json({ requiresApproval: true, variance, expected, tillId: till.id });
  }

  await dbRun(`UPDATE pos_till_sessions SET status='CLOSED',closed_by=?,closed_at=CURRENT_TIMESTAMP,closing_counted=?,variance=0 WHERE id=?`, [req.posUser.id, counted, till.id]);
  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'TILL', entityId: till.id, action: 'CLOSE', delta: { variance: 0 } });
  res.json({ requiresApproval: false, till: await dbGet(`SELECT * FROM pos_till_sessions WHERE id=?`, [till.id]) });
});

router.post('/approve-close', async (req, res) => {
  const { manager_pin, till_id } = req.body;
  if (!manager_pin || !till_id) return res.status(400).json({ error: 'manager_pin and till_id required' });

  const till = await dbGet(`SELECT * FROM pos_till_sessions WHERE id=? AND status='OPEN'`, [till_id]);
  if (!till) return res.status(404).json({ error: 'Till not found or already closed' });

  const managers = await dbAll(
    `SELECT u.*, r.name AS role FROM pos_users u JOIN pos_roles r ON r.id=u.role_id WHERE u.is_active=1 AND r.name IN ('MANAGER','ADMIN')`
  );

  let approver = null;
  for (const m of managers) {
    if (bcrypt.compareSync(String(manager_pin), m.pin_hash)) { approver = m; break; }
  }
  if (!approver) return res.status(401).json({ error: 'Invalid manager PIN' });

  await dbRun(`UPDATE pos_till_sessions SET status='CLOSED',closed_by=?,closed_at=CURRENT_TIMESTAMP,variance_approved_by=? WHERE id=?`, [req.posUser.id, approver.id, till.id]);
  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'TILL', entityId: till.id, action: 'CLOSE_APPROVED', delta: { variance: till.variance, approved_by: approver.employee_id } });
  res.json({ ok: true, till: await dbGet(`SELECT * FROM pos_till_sessions WHERE id=?`, [till.id]) });
});

router.get('/summary', async (req, res) => {
  const { start, end } = getNepalDayBoundsUTC(req.query.date ?? getNepalDateStr());
  res.json(await dbAll(
    `SELECT t.*, u1.employee_id AS opened_by_emp, u2.employee_id AS closed_by_emp
     FROM   pos_till_sessions t
     LEFT JOIN pos_users u1 ON u1.id=t.opened_by
     LEFT JOIN pos_users u2 ON u2.id=t.closed_by
     WHERE  t.opened_at >= ? AND t.opened_at < ? ORDER BY t.id`,
    [start, end]
  ));
});

// ── Cash movements (Cash In / Petty Cash / Paid Out / Credit Received) ──

// GET /api/pos/till/movements?date=YYYY-MM-DD
router.get('/movements', async (req, res) => {
  const { start, end } = getNepalDayBoundsUTC(req.query.date ?? getNepalDateStr());
  res.json(await dbAll(
    `SELECT m.*, u.name AS created_by_name, t.status AS till_status
     FROM pos_cash_movements m
     LEFT JOIN pos_users u ON u.id = m.created_by
     JOIN pos_till_sessions t ON t.id = m.till_session_id
     WHERE m.created_at >= ? AND m.created_at <= ? ORDER BY m.id DESC`,
    [start, end]
  ));
});

// POST /api/pos/till/movements — needs an open till (drawer must exist)
router.post('/movements', async (req, res) => {
  const { type, amount, reason, customer_name, customer_phone } = req.body;
  if (!MOVEMENT_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid movement type' });
  const amt = round2(amount);
  if (amt <= 0) return res.status(400).json({ error: 'amount must be > 0' });
  if (type !== 'CASH_IN' && !String(reason || '').trim()) return res.status(400).json({ error: 'reason required' });
  if (type === 'CREDIT_RECEIVED' && !String(customer_phone || '').trim()) {
    return res.status(400).json({ error: 'customer_phone required for credit received' });
  }

  const till = await dbGet(`SELECT id FROM pos_till_sessions WHERE status='OPEN' ORDER BY id DESC LIMIT 1`);
  if (!till) return res.status(400).json({ error: 'Open the till first' });

  const movement = await transaction(async (tx) => {
    const m = await tx.dbGet(
      `INSERT INTO pos_cash_movements (till_session_id,type,amount,reason,customer_name,customer_phone,created_by)
       VALUES (?,?,?,?,?,?,?) RETURNING *`,
      [till.id, type, amt, reason ?? null, customer_name ?? null, customer_phone ?? null, req.posUser.id]);

    // Credit repayment lowers the customer's ledger balance
    if (type === 'CREDIT_RECEIVED') {
      const prev = await tx.dbGet(
        `SELECT customer_name, customer_id, COALESCE(balance_after,0) AS b
         FROM pos_ledger WHERE customer_phone=? ORDER BY id DESC LIMIT 1`, [customer_phone]);
      const prevBal = prev?.b ?? 0;
      await tx.dbRun(
        `INSERT INTO pos_ledger (customer_name,customer_phone,customer_id,type,amount,balance_after,notes)
         VALUES (?,?,?,'CREDIT',?,?,?)`,
        [customer_name || prev?.customer_name || 'Customer', customer_phone, prev?.customer_id ?? null,
         amt, round2(prevBal - amt), `Credit repayment (cash) — movement #${m.id}`]);
    }
    return m;
  });

  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'TILL', entityId: till.id, action: 'CASH_MOVEMENT', delta: { movementId: movement.id, type, amount: amt, reason: reason ?? null } });
  res.status(201).json(movement);
});

// PUT /api/pos/till/movements/:id — manager/admin, only while its till is open.
// CREDIT_RECEIVED is excluded (ledger side-effects) — delete and re-add instead.
router.put('/movements/:id', requireRole('MANAGER', 'ADMIN'), async (req, res) => {
  const m = await dbGet(
    `SELECT m.*, t.status AS till_status FROM pos_cash_movements m
     JOIN pos_till_sessions t ON t.id = m.till_session_id WHERE m.id=?`, [req.params.id]);
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (m.till_status !== 'OPEN') return res.status(400).json({ error: 'Till already closed — movement is frozen' });
  if (m.type === 'CREDIT_RECEIVED') return res.status(400).json({ error: 'Credit repayments cannot be edited — delete and re-add' });

  const amt = round2(req.body.amount ?? m.amount);
  if (amt <= 0) return res.status(400).json({ error: 'amount must be > 0' });
  const reason = req.body.reason !== undefined ? (String(req.body.reason || '').trim() || null) : m.reason;
  if (m.type !== 'CASH_IN' && !reason) return res.status(400).json({ error: 'reason required' });

  await dbRun(`UPDATE pos_cash_movements SET amount=?, reason=? WHERE id=?`, [amt, reason, m.id]);
  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'TILL', entityId: m.till_session_id, action: 'CASH_MOVEMENT_EDIT',
          delta: { movementId: m.id, type: m.type, amount: [m.amount, amt], reason: [m.reason, reason] } });
  res.json(await dbGet(`SELECT m.*, u.name AS created_by_name FROM pos_cash_movements m LEFT JOIN pos_users u ON u.id=m.created_by WHERE m.id=?`, [m.id]));
});

// PUT /api/pos/till/day/opening — edit opening cash while the day is open (manager/admin)
router.put('/day/opening', requireRole('MANAGER', 'ADMIN'), async (req, res) => {
  const till = await dbGet(`SELECT * FROM pos_till_sessions WHERE status='OPEN' ORDER BY id DESC LIMIT 1`);
  if (!till) return res.status(400).json({ error: 'No open business day' });
  const val = parseFloat(req.body.opening_float);
  if (!Number.isFinite(val) || val < 0) return res.status(400).json({ error: 'opening_float must be >= 0' });

  await dbRun(`UPDATE pos_till_sessions SET opening_float=? WHERE id=?`, [round2(val), till.id]);
  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'TILL', entityId: till.id, action: 'OPENING_EDIT',
          delta: { opening_float: [till.opening_float, round2(val)] } });
  res.json({ ok: true, opening_float: round2(val) });
});

// DELETE /api/pos/till/movements/:id — manager/admin, only while its till is still open
router.delete('/movements/:id', requireRole('MANAGER', 'ADMIN'), async (req, res) => {
  const m = await dbGet(
    `SELECT m.*, t.status AS till_status FROM pos_cash_movements m
     JOIN pos_till_sessions t ON t.id = m.till_session_id WHERE m.id=?`, [req.params.id]);
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (m.till_status !== 'OPEN') return res.status(400).json({ error: 'Till already closed — movement is frozen' });

  await transaction(async (tx) => {
    // Undo the ledger effect of a deleted repayment
    if (m.type === 'CREDIT_RECEIVED') {
      const prev = await tx.dbGet(
        `SELECT customer_name, customer_id, COALESCE(balance_after,0) AS b
         FROM pos_ledger WHERE customer_phone=? ORDER BY id DESC LIMIT 1`, [m.customer_phone]);
      const prevBal = prev?.b ?? 0;
      await tx.dbRun(
        `INSERT INTO pos_ledger (customer_name,customer_phone,customer_id,type,amount,balance_after,notes)
         VALUES (?,?,?,'DEBIT',?,?,?)`,
        [m.customer_name || prev?.customer_name || 'Customer', m.customer_phone, prev?.customer_id ?? null,
         m.amount, round2(prevBal + m.amount), `Reversal of credit repayment — movement #${m.id}`]);
    }
    await tx.dbRun(`DELETE FROM pos_cash_movements WHERE id=?`, [m.id]);
  });

  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'TILL', entityId: m.till_session_id, action: 'CASH_MOVEMENT_DELETE', delta: { movementId: m.id, type: m.type, amount: m.amount, reason: m.reason } });
  res.json({ ok: true });
});

module.exports = router;
