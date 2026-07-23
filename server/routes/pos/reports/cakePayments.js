'use strict';
/** Cake collections for a business day — advance vs follow-up, by tender. */
const express = require('express');
const { dbAll, dbGet } = require('../../../pos/db');
const { getNepalDayBoundsUTC, getNepalDateStr } = require('../../../utils/nepalDateTime');
const { round2, walletMethodExpr, nepalTimeOf } = require('./shared');

const router = express.Router();

// GET /api/pos/reports/cake-payments?date=YYYY-MM-DD  (Nepal business day)
// Advance vs follow-up collections by method, bookings, deliveries, outstanding.
router.get('/cake-payments', async (req, res) => {
  const dateStr = req.query.date || getNepalDateStr();
  const { start, end } = getNepalDayBoundsUTC(dateStr);
  const methodExpr = walletMethodExpr('p');

  // Deleted cake orders are excluded from all collection calculations
  const byMethod = await dbAll(
    `SELECT p.payment_type, ${methodExpr} AS method,
            SUM(CASE WHEN p.amount >= 0 THEN 1 ELSE 0 END) AS txns,
            COALESCE(SUM(p.amount),0) AS amount
     FROM pos_payments p
     JOIN cake_orders co ON co.id = p.cake_order_id
     WHERE p.cake_order_id IS NOT NULL AND co.deleted_at IS NULL
       AND p.created_at >= ? AND p.created_at <= ?
     GROUP BY p.payment_type, method
     ORDER BY p.payment_type, method`,
    [start, end]
  );

  const summary = {
    ADVANCE: { label: 'Advance', txns: 0, amount: 0, methods: [] },
    FOLLOWUP: { label: 'Follow-up', txns: 0, amount: 0, methods: [] },
  };
  for (const r of byMethod) {
    const key = r.payment_type === 'ADVANCE' ? 'ADVANCE' : 'FOLLOWUP';
    summary[key].methods.push({ method: r.method, txns: Number(r.txns), amount: round2(r.amount) });
    summary[key].txns += Number(r.txns);
    summary[key].amount = round2(summary[key].amount + r.amount);
  }

  const txns = await dbAll(
    `SELECT p.id, p.payment_type, ${methodExpr} AS method, p.amount, p.created_at,
            co.id AS cake_order_id, co.order_number, co.customer_name, co.status, co.deleted_at
     FROM pos_payments p JOIN cake_orders co ON co.id = p.cake_order_id
     WHERE p.created_at >= ? AND p.created_at <= ?
     ORDER BY p.created_at, p.id`,
    [start, end]
  );

  const booked = await dbGet(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(grand_total),0) AS value
     FROM cake_orders WHERE deleted_at IS NULL AND created_at >= ? AND created_at <= ?`,
    [start, end]
  );
  const delivered = await dbGet(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(grand_total),0) AS revenue
     FROM cake_orders
     WHERE deleted_at IS NULL AND status='DELIVERED' AND id IN (
       SELECT cake_order_id FROM cake_order_status_history
       WHERE new_status='DELIVERED' AND changed_at >= ? AND changed_at <= ?)`,
    [start, end]
  );
  const cancelled = await dbGet(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(grand_total),0) AS value
     FROM cake_orders
     WHERE deleted_at IS NULL AND status='CANCELLED' AND id IN (
       SELECT cake_order_id FROM cake_order_status_history
       WHERE new_status='CANCELLED' AND changed_at >= ? AND changed_at <= ?)`,
    [start, end]
  );
  const outstanding = await dbGet(
    `SELECT COUNT(CASE WHEN balance_due > 0 THEN 1 END) AS orders,
            COALESCE(SUM(balance_due),0) AS balance_due,
            COALESCE(SUM(advance_paid),0) AS advances_held
     FROM cake_orders
     WHERE deleted_at IS NULL AND status IN ('PENDING','CONFIRMED')`
  );

  res.json({
    date: dateStr,
    collections: {
      total: round2(summary.ADVANCE.amount + summary.FOLLOWUP.amount),
      advance: summary.ADVANCE,
      followup: summary.FOLLOWUP,
    },
    booked: { orders: Number(booked.orders), value: round2(booked.value) },
    delivered: { orders: Number(delivered.orders), revenue: round2(delivered.revenue) },
    cancelled: { orders: Number(cancelled.orders), value: round2(cancelled.value) },
    outstanding: {
      orders: Number(outstanding.orders || 0),
      balance_due: round2(outstanding.balance_due),
      advances_held: round2(outstanding.advances_held),
    },
    transactions: txns.map(t => ({
      id: t.id,
      cakeOrderId: t.cake_order_id,
      time: nepalTimeOf(t.created_at),
      order_number: t.order_number,
      customer_name: t.customer_name,
      order_status: t.status,
      type: t.amount < 0 ? 'REVERSAL' : (t.payment_type === 'ADVANCE' ? 'ADVANCE' : 'FOLLOWUP'),
      method: t.method,
      amount: t.deleted_at ? 0 : round2(t.amount),
      deleted: !!t.deleted_at,
    })),
  });
});

module.exports = router;
