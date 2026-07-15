'use strict';
const { dbGet } = require('../pos/db');
const { getNepalDateStr } = require('../utils/nepalDateTime');

// Write operations are blocked unless today's business day (till session) is open.
// GETs always pass so screens can still render read-only.
async function requireOpenDay(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

  const open = await dbGet(`SELECT id FROM pos_till_sessions WHERE status='OPEN' LIMIT 1`);
  if (open) return next();

  const closed = await dbGet(
    `SELECT id FROM pos_till_sessions WHERE business_date=? AND status='CLOSED' LIMIT 1`,
    [getNepalDateStr()]);
  res.status(423).json({
    error: closed
      ? 'Business day is closed — reopen the day to continue'
      : 'Business day not open — open the day to continue',
    day_locked: true,
  });
}

module.exports = { requireOpenDay };
