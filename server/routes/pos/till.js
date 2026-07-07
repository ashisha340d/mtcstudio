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
  if (await dbGet(`SELECT id FROM pos_till_sessions WHERE status='OPEN'`)) {
    return res.status(400).json({ error: 'Till already open' });
  }
  const till = await dbGet(
    `INSERT INTO pos_till_sessions (opened_by, opening_float) VALUES (?,?) RETURNING *`,
    [req.posUser.id, parseFloat(req.body.opening_float) || 0]
  );
  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'TILL', entityId: till.id, action: 'OPEN', delta: { opening_float: till.opening_float } });
  res.status(201).json(till);
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
