'use strict';
const express = require('express');
const { dbAll, dbGet, dbRun } = require('../../pos/db');
const { requireSession, requireRole } = require('../../middleware/posAuth');
const { audit } = require('../../middleware/posAudit');
const { getNepalDayBoundsUTC, getNepalDateStr } = require('../../utils/nepalDateTime');

const router = express.Router();
router.use(requireSession);

// // GET /api/pos/reports/sales?date=YYYY-MM-DD  (defaults to today in Nepal time)
// router.get('/sales', async (req, res) => {
//   const dateStr = req.query.date || getNepalDateStr();
//   const { start, end } = getNepalDayBoundsUTC(dateStr);

//   // CLOSED orders for the day
//   const orders = await dbAll(
//     `SELECT o.id, o.order_type, o.customer_name, o.customer_phone,
//             o.total_amount, o.closed_at
//      FROM   pos_orders o
//      WHERE  o.status = 'CLOSED'
//        AND  o.closed_at >= ? AND o.closed_at <= ?
//      ORDER  BY o.closed_at DESC`,
//     [dateStr, dateStr]
//   );

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
  const cakePayments = await dbAll(
    `SELECT method, SUM(amount) AS amount
     FROM   pos_payments
     WHERE  cake_order_id IS NOT NULL
       AND  created_at >= ? AND created_at <= ?
     GROUP  BY method`,
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
      credit: Math.round(sumLedger * 100) / 100,
      card: Math.round((sumCard + sumQR) * 100) / 100,
      cash: Math.round(sumCash * 100) / 100,
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

    const closedAt = new Date(o.closed_at.replace(' ', 'T') + 'Z');
    const nepalTime = closedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: false });
    const nepalDate = closedAt.toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' });

    return {
      id: o.id,
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
    credit: Math.round(sumLedger * 100) / 100,
    card: Math.round((sumCard + sumQR) * 100) / 100,
    cash: Math.round(sumCash * 100) / 100,
    orders: orderList,
  });
});

// GET /api/pos/reports/cake-payments?date=YYYY-MM-DD  (Nepal business day)
// Advance vs follow-up collections by method, bookings, deliveries, outstanding.
router.get('/cake-payments', async (req, res) => {
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const dateStr = req.query.date || getNepalDateStr();
  const { start, end } = getNepalDayBoundsUTC(dateStr);
  // WALLET is stored as CARD with notes='WALLET' (POS checkout convention)
  const methodExpr = `CASE WHEN p.method='CARD' AND p.notes='WALLET' THEN 'WALLET' ELSE p.method END`;

  const byMethod = await dbAll(
    `SELECT p.payment_type, ${methodExpr} AS method,
            SUM(CASE WHEN p.amount >= 0 THEN 1 ELSE 0 END) AS txns,
            COALESCE(SUM(p.amount),0) AS amount
     FROM pos_payments p
     WHERE p.cake_order_id IS NOT NULL AND p.created_at >= ? AND p.created_at <= ?
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
            co.order_number, co.customer_name, co.status
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

  const nepalTime = (ts) => new Date(String(ts).replace(' ', 'T') + 'Z')
    .toLocaleString('en-IN', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: false });

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
      time: nepalTime(t.created_at),
      order_number: t.order_number,
      customer_name: t.customer_name,
      order_status: t.status,
      type: t.amount < 0 ? 'REVERSAL' : (t.payment_type === 'ADVANCE' ? 'ADVANCE' : 'FOLLOWUP'),
      method: t.method,
      amount: round2(t.amount),
    })),
  });
});

// ── Day End / Z Report ─────────────────────────────────────────
// One report that closes the business day. Live until closed, then served
// from the frozen snapshot in pos_day_closures.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const BALANCE_TOLERANCE = 0.02;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function buildDayEndReport(dateStr) {
  const { start, end } = getNepalDayBoundsUTC(dateStr);
  const B = [start, end];
  // WALLET is stored as CARD with notes='WALLET' (POS checkout convention)
  const methodExpr = `CASE WHEN p.method='CARD' AND p.notes='WALLET' THEN 'WALLET' ELSE p.method END`;

  // ── A. Business summary ──
  const tillSessions = await dbAll(
    `SELECT t.id, t.opened_at, t.closed_at, t.opening_float, t.closing_counted,
            t.variance, t.status, u1.name AS opened_by, u2.name AS closed_by
     FROM pos_till_sessions t
     LEFT JOIN pos_users u1 ON u1.id = t.opened_by
     LEFT JOIN pos_users u2 ON u2.id = t.closed_by
     WHERE t.opened_at >= ? AND t.opened_at <= ? ORDER BY t.id`, B);

  const orderCounts = await dbGet(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(status='CLOSED'),0)             AS completed,
            COALESCE(SUM(status='CANCELLED'),0)          AS cancelled,
            COALESCE(SUM(status IN ('OPEN','SAVED')),0)  AS pending
     FROM pos_orders WHERE created_at >= ? AND created_at <= ?`, B);

  const refunds = await dbGet(
    `SELECT COUNT(DISTINCT p.order_id) AS bills, COALESCE(SUM(-p.amount),0) AS amount
     FROM pos_payments p
     WHERE p.order_id IS NOT NULL AND p.amount < 0
       AND p.created_at >= ? AND p.created_at <= ?`, B);

  // ── B. Sales summary (orders CLOSED in the day, whenever created) ──
  const salesAgg = await dbGet(
    `SELECT COUNT(*) AS orders,
            COALESCE(SUM(total_amount),0)    AS gross,
            COALESCE(SUM(discount_amount),0) AS discounts,
            COALESCE(SUM(paid_amount),0)     AS paid,
            COALESCE(SUM(change_amount),0)   AS change_given,
            COALESCE(SUM(pax_count),0)       AS pax
     FROM pos_orders WHERE status='CLOSED' AND closed_at >= ? AND closed_at <= ?`, B);

  // Item-level discounts on today's closed orders, split by type (section J)
  const itemDiscountRows = await dbAll(
    `SELECT COALESCE(ki.discount_type,'MANUAL') AS dtype, COALESCE(SUM(ki.discount_amount),0) AS amount
     FROM pos_kot_items ki
     JOIN pos_kots k   ON k.id = ki.kot_id
     JOIN pos_orders o ON o.id = k.order_id
     WHERE o.status='CLOSED' AND o.closed_at >= ? AND o.closed_at <= ?
       AND ki.status != 'CANCELLED' AND ki.discount_amount > 0
     GROUP BY dtype`, B);

  // Returns: RETURN-tagged item cancellations today whose order also closed today —
  // these were produced and sold-then-returned, so they gross up section B
  const returnsAgg = await dbGet(
    `SELECT COUNT(*) AS items, COALESCE(SUM(ki.quantity * ki.unit_price - ki.discount_amount),0) AS value
     FROM pos_cancellations c
     JOIN pos_kot_items ki ON ki.id = c.entity_id
     JOIN pos_kots k       ON k.id = ki.kot_id
     JOIN pos_orders o     ON o.id = k.order_id
     WHERE c.entity_type='KOT_ITEM' AND c.kind='RETURN'
       AND c.created_at >= ? AND c.created_at <= ?
       AND o.status='CLOSED' AND o.closed_at >= ? AND o.closed_at <= ?`,
    [...B, ...B]);

  // All item cancellations today by kind (operational view, any order status)
  const cancelKinds = await dbAll(
    `SELECT c.kind, COUNT(*) AS n, COALESCE(SUM(ki.quantity * ki.unit_price - ki.discount_amount),0) AS value
     FROM pos_cancellations c
     JOIN pos_kot_items ki ON ki.id = c.entity_id
     WHERE c.entity_type='KOT_ITEM' AND c.created_at >= ? AND c.created_at <= ?
     GROUP BY c.kind`, B);

  // ── C. Payment reconciliation (every tender row of the day, net of reversals) ──
  const payMethods = await dbAll(
    `SELECT ${methodExpr} AS method,
            COALESCE(SUM(p.amount >= 0),0) AS txns,
            COALESCE(SUM(p.amount),0) AS amount,
            COALESCE(SUM(CASE WHEN p.order_id IS NOT NULL THEN p.amount END),0)      AS pos_amount,
            COALESCE(SUM(CASE WHEN p.cake_order_id IS NOT NULL THEN p.amount END),0) AS cake_amount
     FROM pos_payments p
     WHERE p.created_at >= ? AND p.created_at <= ?
     GROUP BY method ORDER BY amount DESC`, B);

  // Credit (LEDGER) extended on orders closed today — completes the sales equation
  const creditExtended = await dbGet(
    `SELECT COALESCE(SUM(p.amount),0) AS amount
     FROM pos_payments p JOIN pos_orders o ON o.id = p.order_id
     WHERE p.method='LEDGER' AND o.status='CLOSED'
       AND o.closed_at >= ? AND o.closed_at <= ?`, B);

  // ── D. Cash drawer (computed from payment rows, not till counters) ──
  const cashAgg = await dbGet(
    `SELECT COALESCE(SUM(CASE WHEN p.order_id IS NOT NULL      AND p.amount > 0 THEN p.amount END),0) AS pos_cash,
            COALESCE(SUM(CASE WHEN p.cake_order_id IS NOT NULL AND p.amount > 0 THEN p.amount END),0) AS cake_cash,
            COALESCE(SUM(CASE WHEN p.amount < 0 THEN -p.amount END),0) AS cash_refunds
     FROM pos_payments p
     WHERE p.method='CASH' AND p.created_at >= ? AND p.created_at <= ?`, B);

  // ── E. Cake orders ──
  const cakeBooked = await dbGet(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(grand_total),0) AS value
     FROM cake_orders WHERE deleted_at IS NULL AND created_at >= ? AND created_at <= ?`, B);
  const cakeDelivered = await dbGet(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(grand_total),0) AS revenue,
            COALESCE(SUM(balance_due > 0),0) AS unsettled
     FROM cake_orders
     WHERE deleted_at IS NULL AND status='DELIVERED' AND id IN (
       SELECT cake_order_id FROM cake_order_status_history
       WHERE new_status='DELIVERED' AND changed_at >= ? AND changed_at <= ?)`, B);
  const cakeCancelled = await dbGet(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(grand_total),0) AS value
     FROM cake_orders
     WHERE deleted_at IS NULL AND status='CANCELLED' AND id IN (
       SELECT cake_order_id FROM cake_order_status_history
       WHERE new_status='CANCELLED' AND changed_at >= ? AND changed_at <= ?)`, B);
  const cakeCollections = await dbAll(
    `SELECT p.payment_type, COALESCE(SUM(p.amount >= 0),0) AS txns, COALESCE(SUM(p.amount),0) AS amount
     FROM pos_payments p
     WHERE p.cake_order_id IS NOT NULL AND p.created_at >= ? AND p.created_at <= ?
     GROUP BY p.payment_type`, B);
  const cakePending = await dbGet(
    `SELECT COUNT(*) AS orders,
            COALESCE(SUM(advance_paid),0) AS advances_held,
            COALESCE(SUM(balance_due),0)  AS balance_due
     FROM cake_orders
     WHERE deleted_at IS NULL AND status IN ('PENDING','CONFIRMED','IN_PRODUCTION','READY')`);

  // ── F. Order types ──
  const orderTypes = await dbAll(
    `SELECT order_type, COUNT(*) AS orders,
            COALESCE(SUM(total_amount - discount_amount),0) AS sales
     FROM pos_orders WHERE status='CLOSED' AND closed_at >= ? AND closed_at <= ?
     GROUP BY order_type ORDER BY sales DESC`, B);

  // ── G. Sales by category ──
  const categories = await dbAll(
    `SELECT COALESCE(c.name,'Uncategorised') AS category,
            COALESCE(SUM(ki.quantity),0) AS qty,
            COALESCE(SUM(ki.quantity * ki.unit_price - ki.discount_amount),0) AS revenue
     FROM pos_kot_items ki
     JOIN pos_kots k   ON k.id = ki.kot_id
     JOIN pos_orders o ON o.id = k.order_id
     LEFT JOIN products p2  ON p2.id = ki.product_id
     LEFT JOIN categories c ON c.id = p2.category_id
     WHERE o.status='CLOSED' AND o.closed_at >= ? AND o.closed_at <= ?
       AND ki.status != 'CANCELLED'
     GROUP BY category ORDER BY revenue DESC`, B);

  // ── H. Top products ──
  const topProducts = await dbAll(
    `SELECT ki.product_name AS product,
            COALESCE(SUM(ki.quantity),0) AS qty,
            COALESCE(SUM(ki.quantity * ki.unit_price - ki.discount_amount),0) AS revenue
     FROM pos_kot_items ki
     JOIN pos_kots k   ON k.id = ki.kot_id
     JOIN pos_orders o ON o.id = k.order_id
     WHERE o.status='CLOSED' AND o.closed_at >= ? AND o.closed_at <= ?
       AND ki.status != 'CANCELLED'
     GROUP BY ki.product_name ORDER BY revenue DESC LIMIT 10`, B);

  // ── I. Staff performance ──
  const staffOrders = await dbAll(
    `SELECT u.name, u.employee_id, COUNT(*) AS orders,
            COALESCE(SUM(o.total_amount - o.discount_amount),0) AS sales
     FROM pos_orders o JOIN pos_users u ON u.id = o.punched_by
     WHERE o.status='CLOSED' AND o.closed_at >= ? AND o.closed_at <= ?
     GROUP BY u.id, u.name, u.employee_id ORDER BY sales DESC`, B);
  const staffKots = await dbAll(
    `SELECT u.name, u.employee_id, COUNT(*) AS kots
     FROM pos_kots k JOIN pos_users u ON u.id = k.punched_by
     WHERE k.created_at >= ? AND k.created_at <= ?
     GROUP BY u.id, u.name, u.employee_id ORDER BY kots DESC`, B);

  // ── L. Operational events ──
  const cancels = await dbAll(
    `SELECT entity_type, COUNT(*) AS n FROM pos_cancellations
     WHERE created_at >= ? AND created_at <= ? GROUP BY entity_type`, B);
  const auditCounts = await dbAll(
    `SELECT action, COUNT(*) AS n FROM pos_audit_log
     WHERE action IN ('EDIT','REVERT','MERGE','SHIFT','REPRINT')
       AND created_at >= ? AND created_at <= ? GROUP BY action`, B);
  const tablesServed = await dbGet(
    `SELECT COUNT(DISTINCT table_id) AS n FROM pos_orders
     WHERE status='CLOSED' AND table_id IS NOT NULL
       AND closed_at >= ? AND closed_at <= ?`, B);
  const prep = await dbGet(
    `SELECT AVG(TIMESTAMPDIFF(MINUTE, created_at, served_at)) AS avg_min
     FROM pos_kots
     WHERE status='SERVED' AND served_at IS NOT NULL
       AND created_at >= ? AND created_at <= ?`, B);

  // ── Cash movements (Cash In / Petty / Paid Out / Credit Received) ──
  const movementRows = await dbAll(
    `SELECT type, COUNT(*) AS n, COALESCE(SUM(amount),0) AS amount
     FROM pos_cash_movements WHERE created_at >= ? AND created_at <= ? GROUP BY type`, B);

  // ── Credit outstanding (latest ledger balance per customer) ──
  const creditOutstanding = await dbGet(
    `SELECT COALESCE(SUM(l.balance_after),0) AS total, COUNT(*) AS customers
     FROM pos_ledger l
     WHERE l.customer_phone IS NOT NULL AND l.balance_after > 0
       AND l.id = (SELECT MAX(l2.id) FROM pos_ledger l2 WHERE l2.customer_phone = l.customer_phone)`);
  const ledgerDelta = await dbGet(
    `SELECT COALESCE(SUM(CASE WHEN type='DEBIT' THEN amount ELSE -amount END),0) AS delta
     FROM pos_ledger WHERE created_at >= ? AND created_at <= ?`, B);

  // ── Assemble ──
  const cancelMap = Object.fromEntries(cancels.map(r => [r.entity_type, Number(r.n)]));
  const auditMap = Object.fromEntries(auditCounts.map(r => [r.action, Number(r.n)]));
  const kindMap = Object.fromEntries(cancelKinds.map(r => [r.kind, { items: Number(r.n), value: round2(r.value) }]));
  const cakeColl = { ADVANCE: { txns: 0, amount: 0 }, REGULAR: { txns: 0, amount: 0 } };
  for (const r of cakeCollections) {
    const k = r.payment_type === 'ADVANCE' ? 'ADVANCE' : 'REGULAR';
    cakeColl[k].txns += Number(r.txns);
    cakeColl[k].amount = round2(cakeColl[k].amount + r.amount);
  }

  // total_amount is already net of item discounts (trigger subtracts them) and
  // excludes cancelled items — gross adds both back for the official B section
  const itemDisc = { MANUAL: 0, PROMO: 0, COMPLIMENTARY: 0, EMPLOYEE: 0 };
  for (const r of itemDiscountRows) itemDisc[r.dtype] = round2((itemDisc[r.dtype] || 0) + Number(r.amount));
  const itemDiscTotal = round2(itemDisc.MANUAL + itemDisc.PROMO + itemDisc.COMPLIMENTARY + itemDisc.EMPLOYEE);
  const returnsValue = round2(returnsAgg.value);

  const billDiscounts = round2(salesAgg.discounts);
  const gross = round2(salesAgg.gross + itemDiscTotal + returnsValue);
  const netSales = round2(salesAgg.gross - billDiscounts);
  const cakeRevenue = round2(cakeDelivered.revenue);
  const grandTotal = round2(netSales + cakeRevenue);
  const changeGiven = round2(salesAgg.change_given);
  const credit = round2(creditExtended.amount);
  const paid = round2(salesAgg.paid);

  // Sales check: every closed order's tenders (paid + credit) cover its net total
  const salesDiff = round2(netSales - (paid + credit));
  // Payments check: tender rows captured today (net of change) equal net sales
  const posPayTotal = round2(payMethods.reduce((s, m) => s + Number(m.pos_amount), 0));
  const cakePayTotal = round2(payMethods.reduce((s, m) => s + Number(m.cake_amount), 0));
  const paymentsDiff = round2(posPayTotal - changeGiven - netSales);

  const mv = Object.fromEntries(movementRows.map(r => [r.type, round2(r.amount)]));
  const cashIn = mv.CASH_IN || 0;
  const pettyCash = mv.PETTY_CASH || 0;
  const paidOut = mv.PAID_OUT || 0;
  const creditRepaid = mv.CREDIT_RECEIVED || 0;

  const openingFloat = round2(tillSessions.reduce((s, t) => s + Number(t.opening_float || 0), 0));
  const allTillsClosed = tillSessions.length > 0 && tillSessions.every(t => t.status === 'CLOSED');
  const expectedCash = round2(
    openingFloat + cashAgg.pos_cash - changeGiven + cashAgg.cake_cash - cashAgg.cash_refunds
    + cashIn + creditRepaid - pettyCash - paidOut);
  const actualCash = allTillsClosed
    ? round2(tillSessions.reduce((s, t) => s + Number(t.closing_counted || 0), 0))
    : null;
  const cashDiff = actualCash === null ? null : round2(actualCash - expectedCash);

  // Repayments write ledger CREDIT rows, lowering the day's delta — add them back
  const creditsDiff = round2(ledgerDelta.delta - credit + creditRepaid);

  const noActivity = Number(orderCounts.total) === 0 && posPayTotal === 0 && cakePayTotal === 0
    && movementRows.length === 0;
  const flags = {
    sales_balanced: Math.abs(salesDiff) <= BALANCE_TOLERANCE,
    payments_balanced: Math.abs(paymentsDiff) <= BALANCE_TOLERANCE,
    cash_balanced: actualCash !== null ? Math.abs(cashDiff) <= BALANCE_TOLERANCE
      : (noActivity && tillSessions.length === 0),
    orders_balanced: Number(orderCounts.pending) === 0,
    cakes_balanced: Number(cakeDelivered.unsettled) === 0,
    credits_balanced: Math.abs(creditsDiff) <= BALANCE_TOLERANCE,
    till_closed: allTillsClosed || (noActivity && tillSessions.length === 0),
  };
  flags.day_closed_ok = Object.values(flags).every(Boolean);

  return {
    date: dateStr,
    business: {
      till_sessions: tillSessions,
      orders: {
        total: Number(orderCounts.total),
        completed: Number(orderCounts.completed),
        cancelled: Number(orderCounts.cancelled),
        pending: Number(orderCounts.pending),
      },
      refunds: { bills: Number(refunds.bills), amount: round2(refunds.amount) },
      pax: Number(salesAgg.pax),
    },
    sales: {
      gross_sales: gross,
      bill_discounts: billDiscounts,
      item_discounts: itemDiscTotal,
      returns: returnsValue,
      returns_items: Number(returnsAgg.items),
      net_sales: netSales,
      cake_revenue_delivered: cakeRevenue,
      grand_total: grandTotal,
    },
    payments: {
      methods: payMethods.map(m => ({
        method: m.method,
        txns: Number(m.txns),
        amount: round2(m.amount),
        pos_amount: round2(m.pos_amount),
        cake_amount: round2(m.cake_amount),
      })),
      pos_total: posPayTotal,
      cake_total: cakePayTotal,
      change_given: changeGiven,
      credit_extended: credit,
      total: round2(posPayTotal + cakePayTotal),
    },
    cash: {
      opening_float: openingFloat,
      pos_cash: round2(cashAgg.pos_cash),
      change_given: changeGiven,
      cake_cash: round2(cashAgg.cake_cash),
      cash_refunds: round2(cashAgg.cash_refunds),
      cash_in: cashIn,
      petty_cash: pettyCash,
      paid_out: paidOut,
      credit_repayments_cash: creditRepaid,
      expected: expectedCash,
      actual: actualCash,
      difference: cashDiff,
    },
    cakes: {
      booked: { orders: Number(cakeBooked.orders), value: round2(cakeBooked.value) },
      delivered: { orders: Number(cakeDelivered.orders), revenue: cakeRevenue, unsettled: Number(cakeDelivered.unsettled) },
      cancelled: { orders: Number(cakeCancelled.orders), value: round2(cakeCancelled.value) },
      advance_received: cakeColl.ADVANCE,
      balance_collected: cakeColl.REGULAR,
      pending: {
        orders: Number(cakePending.orders),
        advance_outstanding: round2(cakePending.advances_held),
        balance_due: round2(cakePending.balance_due),
      },
    },
    order_types: orderTypes.map(t => ({ order_type: t.order_type, orders: Number(t.orders), sales: round2(t.sales) })),
    categories: categories.map(c => ({
      category: c.category, qty: Number(c.qty), revenue: round2(c.revenue),
      pct: gross > 0 ? round2((c.revenue / gross) * 100) : 0,
    })),
    top_products: topProducts.map(p => ({ product: p.product, qty: Number(p.qty), revenue: round2(p.revenue) })),
    staff: {
      orders: staffOrders.map(s => ({ name: s.name, employee_id: s.employee_id, orders: Number(s.orders), sales: round2(s.sales) })),
      kots: staffKots.map(s => ({ name: s.name, employee_id: s.employee_id, kots: Number(s.kots) })),
    },
    discounts: {
      bill: billDiscounts,
      manual: itemDisc.MANUAL,
      promotion: itemDisc.PROMO,
      complimentary: itemDisc.COMPLIMENTARY,
      employee: itemDisc.EMPLOYEE,
      total: round2(billDiscounts + itemDiscTotal),
    },
    operations: {
      bills_edited: auditMap.EDIT || 0,
      bills_reprinted: auditMap.REPRINT || 0,
      bills_cancelled: cancelMap.ORDER || 0,
      kots_cancelled: cancelMap.KOT || 0,
      items_cancelled: cancelMap.KOT_ITEM || 0,
      returns: kindMap.RETURN || { items: 0, value: 0 },
      waste: kindMap.WASTE || { items: 0, value: 0 },
      orders_merged: auditMap.MERGE || 0,
      orders_shifted: auditMap.SHIFT || 0,
      reverts: auditMap.REVERT || 0,
      tables_served: Number(tablesServed.n),
      avg_ticket: salesAgg.orders > 0 ? round2(netSales / salesAgg.orders) : 0,
      avg_prep_minutes: prep.avg_min === null ? null : round2(prep.avg_min),
    },
    verification: {
      sales: { sales: netSales, tendered: round2(paid + credit), difference: salesDiff },
      payments: { captured: round2(posPayTotal - changeGiven), sales: netSales, difference: paymentsDiff },
      cash: { expected: expectedCash, actual: actualCash, difference: cashDiff },
      credits: { ledger_delta: round2(ledgerDelta.delta), credit_extended: credit, difference: creditsDiff },
      credit_outstanding: { total: round2(creditOutstanding.total), customers: Number(creditOutstanding.customers) },
      cake_advances_outstanding: round2(cakePending.advances_held),
      flags,
    },
  };
}

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
