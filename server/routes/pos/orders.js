'use strict';
const express = require('express');
const { dbAll, dbGet, dbRun, transaction } = require('../../pos/db');
const { requireSession, requireRole } = require('../../middleware/posAuth');
const { audit }                       = require('../../middleware/posAudit');
const kdsEvents                       = require('../../pos/kdsEvents');
const socketServer                    = require('../../pos/socketServer');
const { triggerStockSync }            = require('../../services/liveShelfSync');
const { validateSplitTender }         = require('../../pos/splitTender');
const webOrderBridge                  = require('../../services/webOrderBridge');

const { requireOpenDay }              = require('../../middleware/posDayGuard');

const router = express.Router();
router.use(requireSession);
router.use(requireOpenDay);

// GET /api/pos/orders/active
router.get('/active', async (req, res) => {
  const orders = await dbAll(
    `SELECT o.*, t.name AS table_name
     FROM   pos_orders o
     LEFT JOIN pos_restaurant_tables t ON t.id = o.table_id
     WHERE  o.status IN ('OPEN','SAVED')
     ORDER  BY o.created_at`
  );

  if (!orders.length) return res.json({ orders: [], kots: [] });

  const ids     = orders.map(o => o.id);
  const ph      = ids.map(() => '?').join(',');
  const kots    = await dbAll(
    `SELECT k.*, u.employee_id AS punched_by_emp
     FROM   pos_kots k LEFT JOIN pos_users u ON u.id = k.punched_by
     WHERE  k.order_id IN (${ph}) ORDER BY k.created_at`,
    ids
  );

  const kotIds  = kots.map(k => k.id);
  const items   = kotIds.length
    ? await dbAll(`SELECT * FROM pos_kot_items WHERE kot_id IN (${kotIds.map(()=>'?').join(',')}) ORDER BY id`, kotIds)
    : [];

  const byKot = {};
  for (const i of items) { (byKot[i.kot_id] ??= []).push(i); }
  for (const k of kots)  k.items = byKot[k.id] || [];

  res.json({ orders, kots });
});

// POST /api/pos/orders
router.post('/', async (req, res) => {
  const {
    order_type, table_id, customer_id, customer_name, customer_phone,
    customer_address, notes, order_notes = null, status = 'OPEN', draft_items,
    pax_count = 0, table_tags = null,
  } = req.body;
  if (!order_type) return res.status(400).json({ error: 'order_type required' });

  const result = await dbGet(
    `INSERT INTO pos_orders
       (order_type, table_id, customer_id, customer_name, customer_phone, customer_address,
        notes, order_notes, status, draft_items, punched_by, pax_count, table_tags)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
    [order_type, table_id ?? null, customer_id ?? null, customer_name ?? null,
     customer_phone ?? null, customer_address ?? null, notes ?? null, order_notes ?? null, status,
     draft_items ? JSON.stringify(draft_items) : null,
     req.posUser.id, pax_count ?? 0, table_tags ?? null]
  );

  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'ORDER', entityId: result.id, action: 'CREATE', delta: { order_type, status } });
  res.status(201).json(result);
});

// PATCH /api/pos/orders/:id — update draft_items and/or customer info
router.patch('/:id', async (req, res) => {
  const { draft_items, customer_name, customer_phone, status } = req.body;
  const order = await dbGet(`SELECT * FROM pos_orders WHERE id = ?`, [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Not found' });

  const { pax_count, table_tags, order_caption, order_notes } = req.body;
  const fields = [];
  const values = [];
  if (draft_items !== undefined) { fields.push('draft_items = ?'); values.push(draft_items ? JSON.stringify(draft_items) : null); }
  if (customer_name !== undefined) { fields.push('customer_name = ?'); values.push(customer_name); }
  if (customer_phone !== undefined) { fields.push('customer_phone = ?'); values.push(customer_phone); }
  if (status !== undefined) { fields.push('status = ?'); values.push(status); }
  if (pax_count !== undefined) { fields.push('pax_count = ?'); values.push(pax_count ?? 0); }
  if (table_tags !== undefined) { fields.push('table_tags = ?'); values.push(table_tags ?? null); }
  if (order_caption !== undefined) { fields.push('order_caption = ?'); values.push(order_caption || null); }
  if (order_notes !== undefined) { fields.push('order_notes = ?'); values.push(order_notes || null); }

  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

  values.push(order.id);
  await dbRun(`UPDATE pos_orders SET ${fields.join(', ')} WHERE id = ?`, values);
  const updated = await dbGet(`SELECT * FROM pos_orders WHERE id = ?`, [order.id]);
  res.json(updated);
});

// PATCH /api/pos/orders/:id/serve-all — KDS close: mark every unserved item SERVED, order stays OPEN
router.patch('/:id/serve-all', async (req, res) => {
  const orderId = Number(req.params.id);
  const order = await dbGet(`SELECT id FROM pos_orders WHERE id=?`, [orderId]);
  if (!order) return res.status(404).json({ error: 'Not found' });

  await transaction(async (tx) => {
    await tx.dbRun(
      `UPDATE pos_kot_items
       SET status='SERVED', served_at=CURRENT_TIMESTAMP
       WHERE status NOT IN ('SERVED','CANCELLED')
         AND kot_id IN (SELECT id FROM pos_kots WHERE order_id=?)`,
      [orderId]
    );
    await tx.dbRun(
      `UPDATE pos_kots
       SET status='SERVED', served_at=CURRENT_TIMESTAMP
       WHERE order_id=? AND status NOT IN ('SERVED','CANCELLED')`,
      [orderId]
    );
    audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'ORDER', entityId: orderId, action: 'KDS_CLOSE' });
  });

  kdsEvents.broadcast('new_kot', { orderId });
  socketServer.emitOrderCompleted({ orderId });
  webOrderBridge.notifyPosOrderEvent(orderId, 'READY'); // web-origin orders only, no-op otherwise
  res.json({ ok: true });
});

// PATCH /api/pos/orders/:id/status
router.patch('/:id/status', async (req, res) => {
  const { status } = req.body;
  const order = await dbGet(`SELECT * FROM pos_orders WHERE id = ?`, [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Not found' });
  await dbRun(`UPDATE pos_orders SET status = ? WHERE id = ?`, [status, order.id]);
  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'ORDER', entityId: order.id, action: 'STATUS_UPDATE', delta: { from: order.status, to: status } });
  const updated = { ...order, status };
  socketServer.emitOrderUpdated(updated);
  res.json(updated);
});

// POST /api/pos/orders/:id/cancel
router.post('/:id/cancel', requireRole('MANAGER', 'ADMIN'), async (req, res) => {
  const { reason } = req.body;
  const order = await dbGet(`SELECT * FROM pos_orders WHERE id = ?`, [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Not found' });
  if (order.status === 'CLOSED') return res.status(400).json({ error: 'Already closed' });

  await transaction(async (tx) => {
    await tx.dbRun(`UPDATE pos_orders SET status='CANCELLED' WHERE id=?`, [order.id]);
    await tx.dbRun(`UPDATE pos_kots SET status='CANCELLED' WHERE order_id=?`, [order.id]);
    await tx.dbRun(`UPDATE pos_kot_items SET status='CANCELLED' WHERE kot_id IN (SELECT id FROM pos_kots WHERE order_id=?)`, [order.id]);
    await tx.dbRun(`INSERT INTO pos_cancellations (entity_type,entity_id,reason,cancelled_by) VALUES ('ORDER',?,?,?)`, [order.id, reason ?? null, req.posUser.id]);
    audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'ORDER', entityId: order.id, action: 'CANCEL', delta: { reason } });
  });

  triggerStockSync(); // cancelled items drop from today's SUM — available recalculates automatically
  socketServer.emitOrderCancelled({ orderId: order.id });
  webOrderBridge.notifyPosOrderEvent(order.id, 'CANCELLED'); // web-origin orders only
  res.json({ ok: true });
});

// PATCH /api/pos/orders/:id/shift — reassign order to a different table or remove from table
// Works across all order types (not cake). Changing table_id or removing it.
router.patch('/:id/shift', async (req, res) => {
  const orderId = Number(req.params.id);
  const { targetTableId } = req.body; // null to unassign from table

  const order = await dbGet(`SELECT * FROM pos_orders WHERE id=?`, [orderId]);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  if (order.order_type === 'CAKE_ORDER')
    return res.status(400).json({ error: 'Cake orders cannot be shifted' });

  // If targetTableId is provided, validate the table exists
  let newTableId = null;
  let newOrderType = order.order_type;
  if (targetTableId !== null && targetTableId !== undefined) {
    const table = await dbGet(`SELECT id FROM pos_restaurant_tables WHERE id=?`, [targetTableId]);
    if (!table) return res.status(404).json({ error: 'Target table not found' });
    newTableId = targetTableId;
    newOrderType = 'DINE_IN'; // When assigning to a table, change to DINE_IN
  } else {
    // Shifting away from a table: keep order_type as-is (or could default to TAKEAWAY)
    newTableId = null;
    // Keep order_type unchanged (could be DELIVERY, TAKEAWAY, QUICK_SALE, or even stay DINE_IN if no table)
  }

  await transaction(async (tx) => {
    const oldTableId = order.table_id;
    await tx.dbRun(`UPDATE pos_orders SET table_id=?, order_type=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [newTableId, newOrderType, orderId]);
    audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'ORDER', entityId: orderId, action: 'SHIFT', delta: { from_table: oldTableId, to_table: newTableId, new_order_type: newOrderType } });
  });

  const updated = await dbGet(`SELECT * FROM pos_orders WHERE id=?`, [orderId]);
  kdsEvents.broadcast('order_shifted', { orderId, oldTableId: order.table_id, newTableId });
  socketServer.emitOrderUpdated(updated);

  res.json({ ok: true, orderId, newTableId, newOrderType });
});

// POST /api/pos/orders/:id/merge — merge sourceOrderId INTO :id (target survives)
// Works across DINE_IN / TAKEAWAY / DELIVERY / QUICK_SALE. CAKE_ORDER is not allowed.
router.post('/:id/merge', async (req, res) => {
  const targetId = Number(req.params.id);
  const sourceId = Number(req.body.sourceOrderId);

  if (!sourceId) return res.status(400).json({ error: 'sourceOrderId required' });
  if (sourceId === targetId) return res.status(400).json({ error: 'Cannot merge an order into itself' });

  const target = await dbGet(`SELECT * FROM pos_orders WHERE id=?`, [targetId]);
  const source = await dbGet(`SELECT * FROM pos_orders WHERE id=?`, [sourceId]);
  if (!target) return res.status(404).json({ error: 'Target order not found' });
  if (!source) return res.status(404).json({ error: 'Source order not found' });

  // Cake orders cannot participate in a merge
  if (target.order_type === 'CAKE_ORDER' || source.order_type === 'CAKE_ORDER')
    return res.status(400).json({ error: 'Cake orders cannot be merged' });

  // Both orders must still be live
  for (const o of [target, source]) {
    if (o.status !== 'OPEN' && o.status !== 'SAVED')
      return res.status(400).json({ error: `Order #${o.id} is ${o.status} and cannot be merged` });
  }

  const parseItems = (s) => { try { return s ? JSON.parse(s) : []; } catch { return []; } };

  const srcKots = await dbAll(`SELECT id FROM pos_kots WHERE order_id=? ORDER BY kot_number`, [sourceId]);

  await transaction(async (tx) => {
    // Reassign source KOTs to target, renumbering to respect UNIQUE(order_id, kot_number)
    let n = (await tx.dbGet(`SELECT COALESCE(MAX(kot_number),0) AS mx FROM pos_kots WHERE order_id=?`, [targetId])).mx;
    for (const k of srcKots) {
      n += 1;
      await tx.dbRun(`UPDATE pos_kots SET order_id=?, kot_number=? WHERE id=?`, [targetId, n, k.id]);
    }

    // Merge unsent draft cart items
    const mergedDraft = [...parseItems(target.draft_items), ...parseItems(source.draft_items)];
    await tx.dbRun(`UPDATE pos_orders SET draft_items=? WHERE id=?`,
      [mergedDraft.length ? JSON.stringify(mergedDraft) : null, targetId]);

    // Recalc target total — KOT reassignment alone doesn't fire the item recalc triggers
    await tx.dbRun(
      `UPDATE pos_orders SET total_amount = (
         SELECT COALESCE(SUM(ki.quantity * ki.unit_price - ki.discount_amount), 0)
         FROM   pos_kot_items ki JOIN pos_kots k ON k.id = ki.kot_id
         WHERE  k.order_id = ? AND ki.status != 'CANCELLED'
       ) WHERE id = ?`,
      [targetId, targetId]
    );

    // Cancel the source — frees its table (if any) and drops it from active lists
    await tx.dbRun(`UPDATE pos_orders SET status='CANCELLED', total_amount=0, draft_items=NULL WHERE id=?`, [sourceId]);
    await tx.dbRun(`INSERT INTO pos_cancellations (entity_type,entity_id,reason,cancelled_by) VALUES ('ORDER',?,?,?)`,
      [sourceId, `Merged into #${targetId}`, req.posUser.id]);

    audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'ORDER', entityId: targetId, action: 'MERGE', delta: { sourceOrderId: sourceId, kotsMoved: srcKots.length } });
  });

  // Refresh every dashboard: target gained KOTs, source is gone
  const updatedTarget = await dbGet(`SELECT * FROM pos_orders WHERE id=?`, [targetId]);
  kdsEvents.broadcast('new_kot', { orderId: targetId });
  socketServer.emitOrderUpdated(updatedTarget);
  socketServer.emitOrderCancelled({ orderId: sourceId });

  res.json({ ok: true, targetOrderId: targetId, sourceOrderId: sourceId, kotsMoved: srcKots.length });
});

// POST /api/pos/orders/:id/checkout
router.post('/:id/checkout', async (req, res) => {
  const { payments, discount_amount = 0 } = req.body;
  if (!payments?.length) return res.status(400).json({ error: 'payments required' });

  const order = await dbGet(`SELECT * FROM pos_orders WHERE id = ?`, [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Not found' });
  if (order.status === 'CLOSED') return res.status(400).json({ error: 'Already closed' });

  const sumBy = (method) => payments.filter(p => p.method === method).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  // pos_payments has no WALLET enum value — client sends WALLET tenders as method:'CARD' with notes:'WALLET'
  const cash   = sumBy('CASH');
  const qr     = sumBy('QR');
  const wallet = sumBy('CARD');
  const ledger = sumBy('LEDGER');

  const result = validateSplitTender({ total_amount: order.total_amount, discount_amount, cash, qr, wallet, ledger });
  if (!result.valid) return res.status(400).json({ error: result.error });

  const { paid_amount, change, balance_due } = result;
  const discount = Math.min(Math.max(parseFloat(discount_amount) || 0, 0), order.total_amount);
  const effectiveTotal = parseFloat((order.total_amount - discount).toFixed(2));

  await transaction(async (tx) => {
    for (const p of payments) {
      await tx.dbRun(`INSERT INTO pos_payments (order_id,method,amount,reference,notes) VALUES (?,?,?,?,?)`,
        [order.id, p.method, p.amount, p.reference ?? null, p.notes ?? null]);
    }

    // Ledger entries — record full transaction history for any named customer
    if (order.customer_name || order.customer_phone) {
      const custPhone = order.customer_phone || null;
      const custName  = order.customer_name  || 'Walk-in';
      const prev = custPhone
        ? await tx.dbGet(`SELECT COALESCE(balance_after,0) AS b FROM pos_ledger WHERE customer_phone=? ORDER BY id DESC LIMIT 1`, [custPhone])
        : null;
      const prevBal = prev?.b ?? 0;
      // DEBIT: total order amount (after discount)
      await tx.dbRun(`INSERT INTO pos_ledger (customer_name,customer_phone,customer_id,order_id,type,amount,balance_after,notes) VALUES (?,?,?,?,'DEBIT',?,?,?)`,
        [custName, custPhone, order.customer_id ?? null, order.id, effectiveTotal, prevBal + effectiveTotal, `Order #${order.id} — total`]);
      // CREDIT: paid_amount excludes ledger (rule 6) and change (rule 5)
      if (paid_amount > 0) {
        const afterDebit = prevBal + effectiveTotal;
        await tx.dbRun(`INSERT INTO pos_ledger (customer_name,customer_phone,customer_id,order_id,type,amount,balance_after,notes) VALUES (?,?,?,?,'CREDIT',?,?,?)`,
          [custName, custPhone, order.customer_id ?? null, order.id, paid_amount, afterDebit - paid_amount, `Payment for order #${order.id} via ${payments.map(p=>p.method).join('+')}`]);
      }
    }

    // Update till sales totals — cash net of change handed back
    const cashNet = parseFloat((cash - change).toFixed(2));
    const till = await tx.dbGet(`SELECT id FROM pos_till_sessions WHERE status='OPEN' ORDER BY id DESC LIMIT 1`);
    if (till) await tx.dbRun(`UPDATE pos_till_sessions SET cash_sales=cash_sales+?,card_sales=card_sales+?,qr_sales=qr_sales+? WHERE id=?`, [cashNet, wallet, qr, till.id]);

    await tx.dbRun(`UPDATE pos_orders SET status=?, paid_amount=?, discount_amount=?, change_amount=?, closed_at=CURRENT_TIMESTAMP WHERE id=?`,
      [balance_due > 0 ? 'OPEN' : 'CLOSED', paid_amount, discount, change, order.id]);
    audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'ORDER', entityId: order.id, action: 'CHECKOUT', delta: { paid_amount, discount, change, balance_due } });
  });

  socketServer.emitOrderCompleted({ orderId: order.id });
  if (balance_due <= 0) webOrderBridge.notifyPosOrderEvent(order.id, 'COMPLETED'); // web-origin orders only
  res.json({ ok: true, balance: balance_due, change });
});

module.exports = router;
