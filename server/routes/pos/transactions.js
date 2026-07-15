'use strict';
const express = require('express');
const { dbAll, dbGet, dbRun, transaction } = require('../../pos/db');
const { requireSession, requireRole } = require('../../middleware/posAuth');
const { audit }                       = require('../../middleware/posAudit');
const socketServer                    = require('../../pos/socketServer');
const { getNepalDayBoundsUTC, getNepalDateStr } = require('../../utils/nepalDateTime');

const { requireOpenDay } = require('../../middleware/posDayGuard');

const router = express.Router();
router.use(requireSession);
router.use(requireOpenDay);

async function creditTill(tx, cash, card, qr) {
  const till = await tx.dbGet(`SELECT id FROM pos_till_sessions WHERE status='OPEN' ORDER BY id DESC LIMIT 1`);
  if (till) await tx.dbRun(`UPDATE pos_till_sessions SET cash_sales=cash_sales+?,card_sales=card_sales+?,qr_sales=qr_sales+? WHERE id=?`, [cash, card, qr, till.id]);
}

// GET /api/pos/transactions/today — closed orders + cake checkouts for the day, with payments
router.get('/today', async (req, res) => {
  const dateStr = req.query.date || getNepalDateStr();
  const { start, end } = getNepalDayBoundsUTC(dateStr);

  const orders = await dbAll(
    `SELECT o.id, o.order_type, o.customer_name, o.customer_phone, o.table_id,
            t.name AS table_name, o.total_amount, o.paid_amount, o.closed_at
     FROM   pos_orders o
     LEFT JOIN pos_restaurant_tables t ON t.id = o.table_id
     WHERE  o.status = 'CLOSED' AND o.closed_at >= ? AND o.closed_at <= ?
     ORDER  BY o.closed_at DESC`,
    [start, end]
  );

  const cakeOrders = await dbAll(
    `SELECT co.id, co.order_number, co.customer_name, co.phone, co.grand_total, co.advance_paid, co.status
     FROM   cake_orders co
     WHERE  co.deleted_at IS NULL AND co.advance_paid > 0
       AND  EXISTS (SELECT 1 FROM pos_payments p WHERE p.cake_order_id = co.id AND p.created_at >= ? AND p.created_at <= ?)
     ORDER  BY co.id DESC`,
    [start, end]
  );

  const orderIds = orders.map(o => o.id);
  const payByOrder = {};
  if (orderIds.length) {
    const ph = orderIds.map(() => '?').join(',');
    const rows = await dbAll(`SELECT * FROM pos_payments WHERE order_id IN (${ph}) ORDER BY id`, orderIds);
    for (const p of rows) (payByOrder[p.order_id] ??= []).push(p);
  }

  const cakeIds = cakeOrders.map(o => o.id);
  const payByCake = {};
  if (cakeIds.length) {
    const ph = cakeIds.map(() => '?').join(',');
    const rows = await dbAll(`SELECT * FROM pos_payments WHERE cake_order_id IN (${ph}) AND created_at >= ? AND created_at <= ? ORDER BY id`,
      [...cakeIds, start, end]);
    for (const p of rows) (payByCake[p.cake_order_id] ??= []).push(p);
  }

  res.json({
    orders: orders.map(o => ({ ...o, payments: payByOrder[o.id] || [] })),
    cakeOrders: cakeOrders.map(o => ({ ...o, payments: payByCake[o.id] || [] })),
  });
});

// POST /api/pos/transactions/order/:id/revert
router.post('/order/:id/revert', requireRole('MANAGER', 'ADMIN'), async (req, res) => {
  const { reason } = req.body;
  const order = await dbGet(`SELECT * FROM pos_orders WHERE id = ?`, [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Not found' });
  if (order.status !== 'CLOSED') return res.status(400).json({ error: 'Order is not closed' });

  const payments = await dbAll(`SELECT * FROM pos_payments WHERE order_id = ?`, [order.id]);
  if (!payments.length) return res.status(400).json({ error: 'No payments to revert' });

  const result = await transaction(async (tx) => {
    // Offsetting negative payment rows — preserves original rows + audit trail
    let cash = 0, card = 0, qr = 0;
    for (const p of payments) {
      await tx.dbRun(`INSERT INTO pos_payments (order_id,method,amount,notes) VALUES (?,?,?,?)`,
        [order.id, p.method, -p.amount, `Revert of payment #${p.id}${reason ? ' — ' + reason : ''}`]);
      if (p.method === 'CASH') cash -= p.amount;
      if (p.method === 'CARD') card -= p.amount;
      if (p.method === 'QR')   qr   -= p.amount;
    }
    await creditTill(tx, cash, card, qr);

    // Reopen the order. If its original table is now occupied by a different
    // live order, drop it onto Quick Order instead of conflicting on the table map.
    let newTableId = order.table_id;
    let newOrderType = order.order_type;
    let notesAppend = '';
    if (order.table_id) {
      const occupant = await tx.dbGet(
        `SELECT id FROM pos_orders WHERE table_id=? AND status IN ('OPEN','SAVED') AND id<>?`,
        [order.table_id, order.id]
      );
      if (occupant) {
        const table = await tx.dbGet(`SELECT name FROM pos_restaurant_tables WHERE id=?`, [order.table_id]);
        newTableId = null;
        newOrderType = 'QUICK_SALE';
        notesAppend = `Reverted from Table ${table?.name || order.table_id}`;
      }
    }

    await tx.dbRun(
      `UPDATE pos_orders
       SET status='OPEN', paid_amount=0, closed_at=NULL, table_id=?, order_type=?,
           notes = CASE WHEN ? <> '' THEN
                     TRIM(CONCAT(COALESCE(notes,''), CASE WHEN COALESCE(notes,'')<>'' THEN ' | ' ELSE '' END, ?))
                   ELSE notes END
       WHERE id=?`,
      [newTableId, newOrderType, notesAppend, notesAppend, order.id]
    );

    audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'ORDER', entityId: order.id, action: 'REVERT', delta: { reason, movedToQuick: newTableId === null && order.table_id !== null } });

    return await tx.dbGet(`SELECT * FROM pos_orders WHERE id=?`, [order.id]);
  });

  socketServer.emitOrderUpdated(result);
  res.json({ ok: true, order: result });
});

// POST /api/pos/transactions/cake/:id/revert
router.post('/cake/:id/revert', requireRole('MANAGER', 'ADMIN'), async (req, res) => {
  const { reason } = req.body;
  const cakeOrder = await dbGet(`SELECT * FROM cake_orders WHERE id = ? AND deleted_at IS NULL`, [req.params.id]);
  if (!cakeOrder) return res.status(404).json({ error: 'Not found' });

  const payments = await dbAll(`SELECT * FROM pos_payments WHERE cake_order_id = ?`, [cakeOrder.id]);
  if (!payments.length) return res.status(400).json({ error: 'No payments to revert' });

  const result = await transaction(async (tx) => {
    let cash = 0, card = 0, qr = 0;
    for (const p of payments) {
      await tx.dbRun(`INSERT INTO pos_payments (cake_order_id,method,amount,notes) VALUES (?,?,?,?)`,
        [cakeOrder.id, p.method, -p.amount, `Revert of payment #${p.id}${reason ? ' — ' + reason : ''}`]);
      if (p.method === 'CASH') cash -= p.amount;
      if (p.method === 'CARD') card -= p.amount;
      if (p.method === 'QR')   qr   -= p.amount;
    }
    await creditTill(tx, cash, card, qr);

    // advance_paid/balance_due reflect the reversal; production status untouched
    const newAdv = Math.max(0, Number(cakeOrder.advance_paid) - payments.reduce((s, p) => s + p.amount, 0));
    const newBal = Math.max(0, Number(cakeOrder.grand_total) - newAdv);
    await tx.dbRun(`UPDATE cake_orders SET advance_paid=?, balance_due=? WHERE id=?`, [newAdv, newBal, cakeOrder.id]);

    audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'CAKE_ORDER', entityId: cakeOrder.id, action: 'REVERT', delta: { reason } });

    return await tx.dbGet(`SELECT * FROM cake_orders WHERE id=?`, [cakeOrder.id]);
  });

  res.json({ ok: true, cakeOrder: result });
});

module.exports = router;
