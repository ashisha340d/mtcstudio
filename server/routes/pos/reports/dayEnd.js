'use strict';
/**
 * Day End routes. The report is live until the day is closed, after which it is
 * served from the frozen snapshot in pos_day_closures.
 */
const express = require('express');
const { dbGet, dbRun } = require('../../../pos/db');
const { requireRole } = require('../../../middleware/posAuth');
const { audit } = require('../../../middleware/posAudit');
const { getNepalDateStr } = require('../../../utils/nepalDateTime');
const { DATE_RE } = require('./shared');
const { buildDayEndReport } = require('./dayEndReport');

const router = express.Router();

// GET /api/pos/reports/day-end?date=YYYY-MM-DD — frozen snapshot if closed, live otherwise
router.get('/day-end', async (req, res) => {
  const dateStr = req.query.date || getNepalDateStr();
  if (!DATE_RE.test(dateStr)) return res.status(400).json({ error: 'Invalid date' });

  const closure = await dbGet(
    `SELECT c.*, u.name AS closed_by_name FROM pos_day_closures c
     LEFT JOIN pos_users u ON u.id = c.closed_by WHERE c.business_date = ?`, [dateStr]);
  if (closure) {
    return res.json({
      closed: true,
      closed_at: closure.closed_at,
      closed_by: closure.closed_by_name,
      report: JSON.parse(closure.snapshot_json),
    });
  }
  res.json({ closed: false, report: await buildDayEndReport(dateStr) });
});

// POST /api/pos/reports/day-end/close — freeze the day (manager/admin)
router.post('/day-end/close', requireRole('MANAGER', 'ADMIN'), async (req, res) => {
  const dateStr = req.body.date || getNepalDateStr();
  if (!DATE_RE.test(dateStr)) return res.status(400).json({ error: 'Invalid date' });
  if (dateStr > getNepalDateStr()) return res.status(400).json({ error: 'Cannot close a future date' });
  if (await dbGet(`SELECT id FROM pos_day_closures WHERE business_date = ?`, [dateStr])) {
    return res.status(400).json({ error: 'Day already closed' });
  }

  const report = await buildDayEndReport(dateStr);
  const f = report.verification.flags;
  const closure = await dbGet(
    `INSERT INTO pos_day_closures
       (business_date, snapshot_json, sales_balanced, payments_balanced, cash_balanced,
        orders_balanced, cakes_balanced, credits_balanced, day_closed, closed_by, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
    [dateStr, JSON.stringify(report),
      f.sales_balanced ? 1 : 0, f.payments_balanced ? 1 : 0, f.cash_balanced ? 1 : 0,
      f.orders_balanced ? 1 : 0, f.cakes_balanced ? 1 : 0, f.credits_balanced ? 1 : 0,
      f.day_closed_ok ? 1 : 0, req.posUser.id, req.body.notes ?? null]);

  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'DAY_CLOSURE', entityId: closure.id, action: 'CLOSE_DAY', delta: { date: dateStr, flags: f } });
  res.status(201).json({ ok: true, closed: true, closed_at: closure.closed_at, closed_by: req.posUser.name, report });
});

// POST /api/pos/reports/day-end/reopen — admin only, deletes the snapshot
router.post('/day-end/reopen', requireRole('ADMIN'), async (req, res) => {
  const dateStr = req.body.date;
  if (!dateStr || !DATE_RE.test(dateStr)) return res.status(400).json({ error: 'date required' });

  const closure = await dbGet(`SELECT id FROM pos_day_closures WHERE business_date = ?`, [dateStr]);
  if (!closure) return res.status(404).json({ error: 'Day is not closed' });

  await dbRun(`DELETE FROM pos_day_closures WHERE id = ?`, [closure.id]);
  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'DAY_CLOSURE', entityId: closure.id, action: 'REOPEN_DAY', delta: { date: dateStr } });
  res.json({ ok: true, closed: false });
});

module.exports = router;
