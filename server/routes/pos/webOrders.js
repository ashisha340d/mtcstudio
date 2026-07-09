'use strict';
// ── Pending Web Orders — approval queue ──────────────────────────────────────
// Orders arrive via services/webOrderBridge.js (WebSocket from the website).
// The cashier reviews them here: Approve converts the web order into a standard
// POS order + KOT (existing workflows, so KDS/Waiter/printing all behave exactly
// like a hand-punched order); Reject records the reason and notifies the website.
const express = require('express');
const { dbAll, dbGet, dbRun, transaction } = require('../../pos/db');
const { requireSession } = require('../../middleware/posAuth');
const { audit } = require('../../middleware/posAudit');
const kdsEvents = require('../../pos/kdsEvents');
const socketServer = require('../../pos/socketServer');
const { triggerStockSync } = require('../../services/liveShelfSync');
const webOrderBridge = require('../../services/webOrderBridge');

const router = express.Router();
router.use(requireSession);

const log = (...a) => console.log(new Date().toISOString(), '[web-orders]', ...a);

async function attachItems(rows) {
  if (!rows.length) return rows;
  const ids = rows.map(r => r.id);
  const items = await dbAll(
    `SELECT * FROM web_order_items WHERE pending_id IN (${ids.map(() => '?').join(',')})
     ORDER BY pending_id, sort_order, id`, ids);
  const byPending = {};
  for (const i of items) (byPending[i.pending_id] ??= []).push(i);
  for (const r of rows) r.items = byPending[r.id] || [];
  return rows;
}

// Same shape kots.js emits for Socket.IO so KDS/POS insert without a refetch
async function buildFullOrder(orderId) {
  const order = await dbGet(
    `SELECT o.*, t.name AS table_name FROM pos_orders o
     LEFT JOIN pos_restaurant_tables t ON t.id = o.table_id WHERE o.id = ?`, [orderId]);
  if (!order) return null;
  const kots = await dbAll(
    `SELECT k.*, u.employee_id AS punched_by_emp FROM pos_kots k
     LEFT JOIN pos_users u ON u.id = k.punched_by WHERE k.order_id = ? ORDER BY k.created_at`, [orderId]);
  const kotIds = kots.map(k => k.id);
  const items = kotIds.length
    ? await dbAll(`SELECT * FROM pos_kot_items WHERE kot_id IN (${kotIds.map(() => '?').join(',')}) ORDER BY id`, kotIds)
    : [];
  const byKot = {};
  for (const i of items) (byKot[i.kot_id] ??= []).push(i);
  for (const k of kots) k.items = byKot[k.id] || [];
  return { ...order, kots };
}

// GET /api/pos/web-orders?status=PENDING_APPROVAL — approval queue list
router.get('/', async (req, res) => {
  const status = String(req.query.status || 'PENDING_APPROVAL').toUpperCase();
  const rows = await dbAll(
    `SELECT * FROM web_orders_pending WHERE status = ? ORDER BY received_at DESC LIMIT 100`, [status]);
  res.json(await attachItems(rows));
});

// GET /api/pos/web-orders/counts — badge on the POS dashboard
router.get('/counts', async (req, res) => {
  const row = await dbGet(`SELECT COUNT(*) AS pending FROM web_orders_pending WHERE status='PENDING_APPROVAL'`);
  res.json({ pending: row?.pending ?? 0 });
});

// GET /api/pos/web-orders/:id — full details
router.get('/:id', async (req, res) => {
  const row = await dbGet(`SELECT * FROM web_orders_pending WHERE id=?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  await attachItems([row]);
  res.json(row);
});

// POST /api/pos/web-orders/:id/approve → POS order + KOT via existing workflow
router.post('/:id/approve', async (req, res) => {
  const pendingId = Number(req.params.id);

  const result = await transaction(async (tx) => {
    const wo = await tx.dbGet(`SELECT * FROM web_orders_pending WHERE id=? FOR UPDATE`, [pendingId]);
    if (!wo) return { code: 404, error: 'Web order not found' };
    if (wo.status !== 'PENDING_APPROVAL')
      return { code: 400, error: `Order is already ${wo.status}` };

    const items = await tx.dbAll(
      `SELECT * FROM web_order_items WHERE pending_id=? ORDER BY sort_order, id`, [pendingId]);
    if (!items.length) return { code: 400, error: 'Web order has no items' };

    // Late re-resolution — products may have been added/renamed since import
    const unmatched = [];
    for (const it of items) {
      if (!it.product_id) {
        const p = Number.isInteger(+it.web_pid) && it.kind === 'product'
          ? await tx.dbGet(`SELECT id FROM products WHERE id=?`, [+it.web_pid])
          : await tx.dbGet(`SELECT id FROM products WHERE name=? LIMIT 1`, [it.item_name]);
        if (p) {
          it.product_id = p.id;
          await tx.dbRun(`UPDATE web_order_items SET product_id=? WHERE id=?`, [p.id, it.id]);
        } else unmatched.push(it.item_name);
      }
    }
    if (unmatched.length)
      return { code: 400, error: `Cannot match to POS products: ${unmatched.join(', ')}. Add/rename the product in Food Menu, or reject and punch manually.` };

    // Keep the customer on file (phone is the natural key; existing rows win)
    if (wo.customer_phone) {
      await tx.dbRun(`INSERT IGNORE INTO pos_customers (name, phone, address) VALUES (?,?,?)`,
        [wo.customer_name || 'Web Customer', wo.customer_phone, wo.customer_address || null]);
    }

    const orderType = wo.order_type === 'Delivery' ? 'DELIVERY' : 'TAKEAWAY';
    const noteBits = [`🌐 Web order ${wo.order_number}`];
    if (+wo.delivery_charge > 0) noteBits.push(`Delivery charge Rs.${+wo.delivery_charge}`);
    if (+wo.discount > 0) noteBits.push(`Web discount Rs.${+wo.discount} (apply at checkout)`);
    noteBits.push(`Web total Rs.${+wo.grand_total} · ${wo.payment_method} / ${wo.payment_status}`);
    if (wo.customer_notes) noteBits.push(`Customer: ${wo.customer_notes}`);

    const order = await tx.dbGet(
      `INSERT INTO pos_orders
         (order_type, customer_name, customer_phone, customer_address, notes, status, punched_by)
       VALUES (?,?,?,?,?,'OPEN',?) RETURNING *`,
      [orderType, wo.customer_name, wo.customer_phone,
       [wo.customer_address, wo.landmark].filter(Boolean).join(' · ') || null,
       noteBits.join(' | '), req.posUser.id]
    );

    const kot = await tx.dbGet(
      `INSERT INTO pos_kots (order_id, kot_number, punched_by) VALUES (?,1,?) RETURNING *`,
      [order.id, req.posUser.id]
    );

    const savedItems = [];
    for (const it of items) {
      const prod = await tx.dbGet(`SELECT prep_time_minutes, pos_station_id FROM products WHERE id=?`, [it.product_id]);
      const mods = (() => { try { return JSON.parse(it.modifiers_json || '[]'); } catch { return []; } })();
      const notes = [mods.length ? `➕ ${mods.join(', ')}` : '', it.special_note || ''].filter(Boolean).join(' · ') || null;
      savedItems.push(await tx.dbGet(
        `INSERT INTO pos_kot_items
           (kot_id, product_id, variant_id, product_name, quantity, unit_price, notes, prep_time_minutes, station_id)
         VALUES (?,?,?,?,?,?,?,?,?) RETURNING *`,
        [kot.id, it.product_id, it.variant_id ?? null,
         it.variant_name ? `${it.item_name} (${it.variant_name})` : it.item_name,
         it.quantity, it.unit_price, notes,
         prod?.prep_time_minutes ?? 10, prod?.pos_station_id ?? null]
      ));
      if (it.variant_id) {
        await tx.dbRun(`UPDATE product_variants SET sync_status = 0 WHERE id = ? AND show_online = 1`, [it.variant_id]);
      } else {
        await tx.dbRun(`UPDATE product_variants SET sync_status = 0 WHERE product_id = ? AND show_online = 1`, [it.product_id]);
      }
    }

    await tx.dbRun(
      `UPDATE web_orders_pending
       SET status='APPROVED', pos_order_id=?, approved_by=?, approved_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      [order.id, req.posUser.id, pendingId]);

    audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'WEB_ORDER', entityId: pendingId, action: 'APPROVE', delta: { order_number: wo.order_number, pos_order_id: order.id, kot_id: kot.id, itemCount: savedItems.length } });
    return { wo, order, kot: { ...kot, items: savedItems } };
  });

  if (result.error) return res.status(result.code).json({ error: result.error });
  const { wo, order, kot } = result;

  log(`approved ${wo.order_number} (pending #${pendingId}) → POS order #${order.id}, KOT #${kot.id} by ${req.posUser.employee_id}`);

  // Existing notification pipeline: KDS + POS + Waiter (all join/listen on these rooms)
  kdsEvents.broadcast('new_kot', { orderId: order.id, kotId: kot.id });
  const fullOrder = await buildFullOrder(order.id);
  if (fullOrder) socketServer.emitNewOrder(fullOrder);
  triggerStockSync();

  // Tell the website the customer's order was accepted
  webOrderBridge.sendStatus(wo.web_order_id, 'APPROVED', { posOrderId: order.id });

  res.json({ ok: true, posOrderId: order.id, kotId: kot.id, order: fullOrder });
});

// POST /api/pos/web-orders/:id/reject — no POS order, no KOT
router.post('/:id/reject', async (req, res) => {
  const pendingId = Number(req.params.id);
  const reason = String(req.body?.reason || '').trim().slice(0, 300) || null;

  const result = await transaction(async (tx) => {
    const wo = await tx.dbGet(`SELECT * FROM web_orders_pending WHERE id=? FOR UPDATE`, [pendingId]);
    if (!wo) return { code: 404, error: 'Web order not found' };
    if (wo.status !== 'PENDING_APPROVAL')
      return { code: 400, error: `Order is already ${wo.status}` };

    await tx.dbRun(
      `UPDATE web_orders_pending
       SET status='REJECTED', reject_reason=?, rejected_by=?, rejected_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      [reason, req.posUser.id, pendingId]);

    audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'WEB_ORDER', entityId: pendingId, action: 'REJECT', delta: { order_number: wo.order_number, reason } });
    return { wo };
  });

  if (result.error) return res.status(result.code).json({ error: result.error });

  log(`rejected ${result.wo.order_number} (pending #${pendingId}) by ${req.posUser.employee_id}${reason ? ` — ${reason}` : ''}`);
  webOrderBridge.sendStatus(result.wo.web_order_id, 'REJECTED', { reason });
  res.json({ ok: true });
});

module.exports = router;
