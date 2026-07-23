'use strict';
/** Payment register — one row per business day, split by tender method. */
const express = require('express');
const { dbAll } = require('../../../pos/db');
const { getNepalDayBoundsUTC, getNepalDateStr } = require('../../../utils/nepalDateTime');
const { round2, walletMethodExpr } = require('./shared');

const router = express.Router();

// GET /api/pos/reports/payment-register?from=&to=
router.get('/payment-register', async (req, res) => {
  const from = req.query.from || getNepalDateStr();
  const to = req.query.to || from;
  const { start } = getNepalDayBoundsUTC(from);
  const { end } = getNepalDayBoundsUTC(to);
  const methodExpr = walletMethodExpr('pay');

  const orderRows = await dbAll(
    `SELECT DATE(o.closed_at) AS d, ${methodExpr} AS method,
            SUM(pay.amount) AS amount, COUNT(DISTINCT o.id) AS orders
     FROM pos_payments pay
     JOIN pos_orders o ON o.id = pay.order_id
     WHERE o.status = 'CLOSED' AND o.closed_at >= ? AND o.closed_at <= ?
     GROUP BY d, method`,
    [start, end]
  );

  const cakeRows = await dbAll(
    `SELECT DATE(pay.created_at) AS d, ${methodExpr} AS method,
            SUM(pay.amount) AS amount, 0 AS orders
     FROM pos_payments pay
     JOIN cake_orders co ON co.id = pay.cake_order_id
     WHERE co.deleted_at IS NULL AND pay.created_at >= ? AND pay.created_at <= ?
     GROUP BY d, method`,
    [start, end]
  );

  const byDay = new Map();
  for (const r of [...orderRows, ...cakeRows]) {
    const day = String(r.d).split(' ')[0];
    if (!byDay.has(day)) {
      byDay.set(day, { id: day, date: day, orders: 0, CASH: 0, CARD: 0, WALLET: 0, QR: 0, LEDGER: 0, total: 0 });
    }
    const row = byDay.get(day);
    const method = row[r.method] !== undefined ? r.method : 'CASH';
    row[method] += Number(r.amount) || 0;
    row.total += Number(r.amount) || 0;
    row.orders += Number(r.orders) || 0;
  }

  const out = [...byDay.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(r => ({
      ...r,
      CASH: round2(r.CASH), CARD: round2(r.CARD), WALLET: round2(r.WALLET),
      QR: round2(r.QR), LEDGER: round2(r.LEDGER), total: round2(r.total),
    }));

  res.json(out);
});

module.exports = router;
