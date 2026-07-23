'use strict';
/**
 * Every raw fetch behind the Day End / Z report, grouped by the report section
 * it feeds. No arithmetic and no formatting live here — see dayEndReport.js.
 *
 * `B` is always the [start, end] UTC bound pair for the business day.
 */
const { dbAll, dbGet } = require('../../../pos/db');
const { walletMethodExpr } = require('./shared');

const methodExpr = walletMethodExpr('p');

// ── A. Business summary ──
const tillSessions = (B) => dbAll(
  `SELECT t.id, t.opened_at, t.closed_at, t.opening_float, t.closing_counted,
          t.variance, t.status, u1.name AS opened_by, u2.name AS closed_by
   FROM pos_till_sessions t
   LEFT JOIN pos_users u1 ON u1.id = t.opened_by
   LEFT JOIN pos_users u2 ON u2.id = t.closed_by
   WHERE t.opened_at >= ? AND t.opened_at <= ? ORDER BY t.id`, B);

const orderCounts = (B) => dbGet(
  `SELECT COUNT(*) AS total,
          COALESCE(SUM(status='CLOSED'),0)             AS completed,
          COALESCE(SUM(status='CANCELLED'),0)          AS cancelled,
          COALESCE(SUM(status IN ('OPEN','SAVED')),0)  AS pending
   FROM pos_orders WHERE created_at >= ? AND created_at <= ?`, B);

const refunds = (B) => dbGet(
  `SELECT COUNT(DISTINCT p.order_id) AS bills, COALESCE(SUM(-p.amount),0) AS amount
   FROM pos_payments p
   WHERE p.order_id IS NOT NULL AND p.amount < 0
     AND p.created_at >= ? AND p.created_at <= ?`, B);

// ── B. Sales summary (orders CLOSED in the day, whenever created) ──
const salesAgg = (B) => dbGet(
  `SELECT COUNT(*) AS orders,
          COALESCE(SUM(total_amount),0)    AS gross,
          COALESCE(SUM(discount_amount),0) AS discounts,
          COALESCE(SUM(paid_amount),0)     AS paid,
          COALESCE(SUM(change_amount),0)   AS change_given,
          COALESCE(SUM(pax_count),0)       AS pax
   FROM pos_orders WHERE status='CLOSED' AND closed_at >= ? AND closed_at <= ?`, B);

// Item-level discounts on today's closed orders, split by type (section J)
const itemDiscountRows = (B) => dbAll(
  `SELECT COALESCE(ki.discount_type,'MANUAL') AS dtype, COALESCE(SUM(ki.discount_amount),0) AS amount
   FROM pos_kot_items ki
   JOIN pos_kots k   ON k.id = ki.kot_id
   JOIN pos_orders o ON o.id = k.order_id
   WHERE o.status='CLOSED' AND o.closed_at >= ? AND o.closed_at <= ?
     AND ki.status != 'CANCELLED' AND ki.discount_amount > 0
   GROUP BY dtype`, B);

// Returns: RETURN-tagged item cancellations today whose order also closed today —
// these were produced and sold-then-returned, so they gross up section B
const returnsAgg = (B) => dbGet(
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
const cancelKinds = (B) => dbAll(
  `SELECT c.kind, COUNT(*) AS n, COALESCE(SUM(ki.quantity * ki.unit_price - ki.discount_amount),0) AS value
   FROM pos_cancellations c
   JOIN pos_kot_items ki ON ki.id = c.entity_id
   WHERE c.entity_type='KOT_ITEM' AND c.created_at >= ? AND c.created_at <= ?
   GROUP BY c.kind`, B);

// ── C. Payment reconciliation (every tender row of the day, net of reversals) ──
const payMethods = (B) => dbAll(
  `SELECT ${methodExpr} AS method,
          COALESCE(SUM(p.amount >= 0),0) AS txns,
          COALESCE(SUM(p.amount),0) AS amount,
          COALESCE(SUM(CASE WHEN p.order_id IS NOT NULL THEN p.amount END),0)      AS pos_amount,
          COALESCE(SUM(CASE WHEN p.cake_order_id IS NOT NULL THEN p.amount END),0) AS cake_amount
   FROM pos_payments p
   WHERE p.created_at >= ? AND p.created_at <= ?
   GROUP BY method ORDER BY amount DESC`, B);

// Credit (LEDGER) extended on orders closed today — completes the sales equation
const creditExtended = (B) => dbGet(
  `SELECT COALESCE(SUM(p.amount),0) AS amount
   FROM pos_payments p JOIN pos_orders o ON o.id = p.order_id
   WHERE p.method='LEDGER' AND o.status='CLOSED'
     AND o.closed_at >= ? AND o.closed_at <= ?`, B);

// ── D. Cash drawer (computed from payment rows, not till counters) ──
const cashAgg = (B) => dbGet(
  `SELECT COALESCE(SUM(CASE WHEN p.order_id IS NOT NULL      AND p.amount > 0 THEN p.amount END),0) AS pos_cash,
          COALESCE(SUM(CASE WHEN p.cake_order_id IS NOT NULL AND p.amount > 0 THEN p.amount END),0) AS cake_cash,
          COALESCE(SUM(CASE WHEN p.amount < 0 THEN -p.amount END),0) AS cash_refunds
   FROM pos_payments p
   WHERE p.method='CASH' AND p.created_at >= ? AND p.created_at <= ?`, B);

// ── E. Cake orders ──
const cakeBooked = (B) => dbGet(
  `SELECT COUNT(*) AS orders, COALESCE(SUM(grand_total),0) AS value
   FROM cake_orders WHERE deleted_at IS NULL AND created_at >= ? AND created_at <= ?`, B);

const cakeDelivered = (B) => dbGet(
  `SELECT COUNT(*) AS orders, COALESCE(SUM(grand_total),0) AS revenue,
          COALESCE(SUM(balance_due > 0),0) AS unsettled
   FROM cake_orders
   WHERE deleted_at IS NULL AND status='DELIVERED' AND id IN (
     SELECT cake_order_id FROM cake_order_status_history
     WHERE new_status='DELIVERED' AND changed_at >= ? AND changed_at <= ?)`, B);

const cakeCancelled = (B) => dbGet(
  `SELECT COUNT(*) AS orders, COALESCE(SUM(grand_total),0) AS value
   FROM cake_orders
   WHERE deleted_at IS NULL AND status='CANCELLED' AND id IN (
     SELECT cake_order_id FROM cake_order_status_history
     WHERE new_status='CANCELLED' AND changed_at >= ? AND changed_at <= ?)`, B);

const cakeCollections = (B) => dbAll(
  `SELECT p.payment_type, COALESCE(SUM(p.amount >= 0),0) AS txns, COALESCE(SUM(p.amount),0) AS amount
   FROM pos_payments p
   WHERE p.cake_order_id IS NOT NULL AND p.created_at >= ? AND p.created_at <= ?
   GROUP BY p.payment_type`, B);

const cakePending = () => dbGet(
  `SELECT COUNT(*) AS orders,
          COALESCE(SUM(advance_paid),0) AS advances_held,
          COALESCE(SUM(balance_due),0)  AS balance_due
   FROM cake_orders
   WHERE deleted_at IS NULL AND status IN ('PENDING','CONFIRMED','IN_PRODUCTION','READY')`);

// ── F. Order types ──
const orderTypes = (B) => dbAll(
  `SELECT order_type, COUNT(*) AS orders,
          COALESCE(SUM(total_amount - discount_amount),0) AS sales
   FROM pos_orders WHERE status='CLOSED' AND closed_at >= ? AND closed_at <= ?
   GROUP BY order_type ORDER BY sales DESC`, B);

// ── G. Sales by category ──
const categories = (B) => dbAll(
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
const topProducts = (B) => dbAll(
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
const staffOrders = (B) => dbAll(
  `SELECT u.name, u.employee_id, COUNT(*) AS orders,
          COALESCE(SUM(o.total_amount - o.discount_amount),0) AS sales
   FROM pos_orders o JOIN pos_users u ON u.id = o.punched_by
   WHERE o.status='CLOSED' AND o.closed_at >= ? AND o.closed_at <= ?
   GROUP BY u.id, u.name, u.employee_id ORDER BY sales DESC`, B);

const staffKots = (B) => dbAll(
  `SELECT u.name, u.employee_id, COUNT(*) AS kots
   FROM pos_kots k JOIN pos_users u ON u.id = k.punched_by
   WHERE k.created_at >= ? AND k.created_at <= ?
   GROUP BY u.id, u.name, u.employee_id ORDER BY kots DESC`, B);

// ── L. Operational events ──
const cancels = (B) => dbAll(
  `SELECT entity_type, COUNT(*) AS n FROM pos_cancellations
   WHERE created_at >= ? AND created_at <= ? GROUP BY entity_type`, B);

const auditCounts = (B) => dbAll(
  `SELECT action, COUNT(*) AS n FROM pos_audit_log
   WHERE action IN ('EDIT','REVERT','MERGE','SHIFT','REPRINT')
     AND created_at >= ? AND created_at <= ? GROUP BY action`, B);

const tablesServed = (B) => dbGet(
  `SELECT COUNT(DISTINCT table_id) AS n FROM pos_orders
   WHERE status='CLOSED' AND table_id IS NOT NULL
     AND closed_at >= ? AND closed_at <= ?`, B);

const prep = (B) => dbGet(
  `SELECT AVG(TIMESTAMPDIFF(MINUTE, created_at, served_at)) AS avg_min
   FROM pos_kots
   WHERE status='SERVED' AND served_at IS NOT NULL
     AND created_at >= ? AND created_at <= ?`, B);

// ── Cash movements (Cash In / Petty / Paid Out / Credit Received) ──
const movementRows = (B) => dbAll(
  `SELECT type, COUNT(*) AS n, COALESCE(SUM(amount),0) AS amount
   FROM pos_cash_movements WHERE created_at >= ? AND created_at <= ? GROUP BY type`, B);

// ── Credit outstanding (latest ledger balance per customer) ──
const creditOutstanding = () => dbGet(
  `SELECT COALESCE(SUM(l.balance_after),0) AS total, COUNT(*) AS customers
   FROM pos_ledger l
   WHERE l.customer_phone IS NOT NULL AND l.balance_after > 0
     AND l.id = (SELECT MAX(l2.id) FROM pos_ledger l2 WHERE l2.customer_phone = l.customer_phone)`);

const ledgerDelta = (B) => dbGet(
  `SELECT COALESCE(SUM(CASE WHEN type='DEBIT' THEN amount ELSE -amount END),0) AS delta
   FROM pos_ledger WHERE created_at >= ? AND created_at <= ?`, B);

/** Run every day-end query for the bound pair and return the raw rows. */
async function fetchDayEndData(B) {
  return {
    tillSessions: await tillSessions(B),
    orderCounts: await orderCounts(B),
    refunds: await refunds(B),
    salesAgg: await salesAgg(B),
    itemDiscountRows: await itemDiscountRows(B),
    returnsAgg: await returnsAgg(B),
    cancelKinds: await cancelKinds(B),
    payMethods: await payMethods(B),
    creditExtended: await creditExtended(B),
    cashAgg: await cashAgg(B),
    cakeBooked: await cakeBooked(B),
    cakeDelivered: await cakeDelivered(B),
    cakeCancelled: await cakeCancelled(B),
    cakeCollections: await cakeCollections(B),
    cakePending: await cakePending(),
    orderTypes: await orderTypes(B),
    categories: await categories(B),
    topProducts: await topProducts(B),
    staffOrders: await staffOrders(B),
    staffKots: await staffKots(B),
    cancels: await cancels(B),
    auditCounts: await auditCounts(B),
    tablesServed: await tablesServed(B),
    prep: await prep(B),
    movementRows: await movementRows(B),
    creditOutstanding: await creditOutstanding(),
    ledgerDelta: await ledgerDelta(B),
  };
}

module.exports = { fetchDayEndData };
