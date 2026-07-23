'use strict';
/** Daily sales report — closed orders with their tenders and lines. */
const express = require('express');
const { dbAll } = require('../../../pos/db');
const { getNepalDayBoundsUTC, getNepalDateStr } = require('../../../utils/nepalDateTime');
const { round2 } = require('./shared');

const router = express.Router();

// GET /api/pos/reports/sales?date=YYYY-MM-DD  (defaults to today in Nepal time)
router.get('/sales', async (req, res) => {
  const dateStr = req.query.date || getNepalDateStr();

  const [year, month, day] = dateStr.split('-').map(Number);
  const { start, end } = getNepalDayBoundsUTC(dateStr);

  // CLOSED orders for the day
  const orders = await dbAll(
    `SELECT o.id, o.order_type, o.customer_name, o.customer_phone,
            o.total_amount, o.discount_amount, o.change_amount, o.closed_at,
            o.table_id, t.name AS table_name
     FROM pos_orders o
     LEFT JOIN pos_restaurant_tables t ON t.id = o.table_id
     WHERE o.status = 'CLOSED'
       AND YEAR(o.closed_at) = ?
       AND MONTH(o.closed_at) = ?
       AND DAY(o.closed_at) = ?
     ORDER BY o.closed_at DESC`,
    [year, month, day]
  );

  // Cake order payments collected on this day (checked out, regardless of order status)
  // Deleted cake orders are excluded from all sales calculations
  const cakePayments = await dbAll(
    `SELECT p.method, SUM(p.amount) AS amount
     FROM   pos_payments p
     JOIN   cake_orders co ON co.id = p.cake_order_id
     WHERE  p.cake_order_id IS NOT NULL
       AND  co.deleted_at IS NULL
       AND  p.created_at >= ? AND p.created_at <= ?
     GROUP  BY p.method`,
    [start, end]
  );

  let sumCash = 0, sumCard = 0, sumQR = 0, sumLedger = 0;
  for (const p of cakePayments) {
    if (p.method === 'CASH') sumCash += p.amount;
    if (p.method === 'CARD') sumCard += p.amount;
    if (p.method === 'QR') sumQR += p.amount;
    if (p.method === 'LEDGER') sumLedger += p.amount;
  }

  if (!orders.length) {
    return res.json({
      date: dateStr,
      credit: round2(sumLedger),
      card: round2(sumCard),
      qr: round2(sumQR),
      cash: round2(sumCash),
      orders: [],
    });
  }

  const orderIds = orders.map(o => o.id);
  const ph = orderIds.map(() => '?').join(',');

  // All payments for these orders
  const payments = await dbAll(
    `SELECT order_id, method, SUM(amount) AS amount
     FROM   pos_payments
     WHERE  order_id IN (${ph})
     GROUP  BY order_id, method`,
    orderIds
  );

  // All non-cancelled KOT items for these orders
  const items = await dbAll(
    `SELECT k.order_id,
            ki.product_name, ki.quantity, ki.unit_price, ki.discount_amount,
            ROW_NUMBER() OVER (PARTITION BY k.order_id ORDER BY ki.id) AS sn
     FROM   pos_kot_items ki
     JOIN   pos_kots k ON k.id = ki.kot_id
     WHERE  k.order_id IN (${ph})
       AND  ki.status != 'CANCELLED'
     ORDER  BY k.order_id, ki.id`,
    orderIds
  );

  // Group payments by order
  const payByOrder = {};
  for (const p of payments) {
    (payByOrder[p.order_id] ??= []).push(p);
  }

  // Group items by order
  const itemsByOrder = {};
  for (const i of items) {
    (itemsByOrder[i.order_id] ??= []).push(i);
  }

  // Build summary totals by payment method
  for (const p of payments) {
    if (p.method === 'CASH') sumCash += p.amount;
    if (p.method === 'CARD') sumCard += p.amount;
    if (p.method === 'QR') sumQR += p.amount;
    if (p.method === 'LEDGER') sumLedger += p.amount;
  }

  // Cash payments are tendered amounts (e.g. customer hands over 100 for a 90 bill) —
  // net out change given so cash reflects what actually stayed in the drawer
  sumCash -= orders.reduce((s, o) => s + Number(o.change_amount || 0), 0);

  // Build order list
  const orderList = orders.map(o => {
    const orderPayments = payByOrder[o.id] || [];
    const orderItems = itemsByOrder[o.id] || [];

    // Primary payment method label — prefer the dominant method
    let paymentMethod = 'CASH';
    if (orderPayments.length === 1) {
      paymentMethod = orderPayments[0].method;
    } else if (orderPayments.length > 1) {
      // Pick the method with the highest amount
      const dominant = orderPayments.reduce((a, b) => b.amount > a.amount ? b : a);
      paymentMethod = dominant.method;
    }

    // o.closed_at is already Nepal wall-clock (mysql2 dateStrings) — no TZ math, no 'Z'
    const [nepalDate, closedTimePart] = String(o.closed_at).split(' ');
    const nepalTime = (closedTimePart || '00:00:00').slice(0, 5);

    return {
      id: o.id,
      orderType: o.order_type,
      closedAt: o.closed_at,
      date: nepalDate,
      time: nepalTime,
      customerName: o.customer_name || null,
      customerPhone: o.customer_phone || null,
      tableName: o.table_name || null,
      paymentMethod,
      payments: orderPayments,
      amount: o.total_amount,
      discount: o.discount_amount || 0,
      items: orderItems.map((it, idx) => ({
        sn: idx + 1,
        name: it.product_name,
        qty: it.quantity,
        rate: it.unit_price,
        amount: it.quantity * it.unit_price - (it.discount_amount || 0),
      })),
    };
  });

  res.json({
    date: dateStr,
    credit: round2(sumLedger),
    card: round2(sumCard),
    qr: round2(sumQR),
    cash: round2(sumCash),
    orders: orderList,
  });
});

module.exports = router;
