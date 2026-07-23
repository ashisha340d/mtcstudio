'use strict';
/**
 * Day End / Z report builder — the one report that closes the business day.
 * Takes the raw rows from dayEndQueries and derives every total, balance check
 * and flag. Pure computation: no Express, no SQL.
 */
const { getNepalDayBoundsUTC } = require('../../../utils/nepalDateTime');
const { round2, BALANCE_TOLERANCE } = require('./shared');
const { fetchDayEndData } = require('./dayEndQueries');

async function buildDayEndReport(dateStr) {
  const { start, end } = getNepalDayBoundsUTC(dateStr);
  const d = await fetchDayEndData([start, end]);

  const {
    tillSessions, orderCounts, refunds, salesAgg, itemDiscountRows, returnsAgg,
    cancelKinds, payMethods, creditExtended, cashAgg, cakeBooked, cakeDelivered,
    cakeCancelled, cakeCollections, cakePending, orderTypes, categories,
    topProducts, staffOrders, staffKots, cancels, auditCounts, tablesServed,
    prep, movementRows, creditOutstanding, ledgerDelta,
  } = d;

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

module.exports = { buildDayEndReport };
