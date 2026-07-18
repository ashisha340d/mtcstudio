'use strict';
const express = require('express');
const { dbAll, dbGet, dbRun, transaction, ready } = require('../../pos/db');
const { requireSession } = require('../../middleware/posAuth');
const { audit }          = require('../../middleware/posAudit');
const kdsEvents          = require('../../pos/kdsEvents');
const socketServer       = require('../../pos/socketServer');
const { triggerStockSync } = require('../../services/liveShelfSync');
const { getSchedule }    = require('../../services/liveStoreScheduleService');
const comboExpander      = require('../../services/comboExpander');

const router = express.Router();

// Items are stored in the POS cart shape:
// { product_id, product_name, variant_id, variant_name, unit_price, quantity,
//   modifiers:[{id,name,price}], notes, is_homepack, discount_amount, discount_type }
function toKotItem(i) {
  const modTotal = (i.modifiers ?? []).reduce((s, m) => s + (Number(m.price) || 0), 0);
  return {
    product_id: i.product_id,
    variant_id: i.variant_id ?? null,
    product_name: i.product_name
      + (i.variant_name ? ` (${i.variant_name})` : '')
      + (i.modifiers?.length ? ` + ${i.modifiers.map(m => m.name).join(', ')}` : ''),
    quantity: i.quantity,
    unit_price: (Number(i.unit_price) || 0) + modTotal,
    notes: i.notes ?? null,
    is_home_pack: i.is_homepack ? 1 : 0,
    discount_amount: Number(i.discount_amount) || 0,
    discount_type: i.discount_amount > 0 ? (i.discount_type ?? 'MANUAL') : null,
  };
}

async function buildFullOrder(orderId) {
  const order = await dbGet(
    `SELECT o.*, t.name AS table_name FROM pos_orders o
     LEFT JOIN pos_restaurant_tables t ON t.id = o.table_id
     WHERE o.id = ?`, [orderId]);
  if (!order) return null;
  const kots = await dbAll(`SELECT * FROM pos_kots WHERE order_id = ? ORDER BY created_at`, [orderId]);
  const kotIds = kots.map(k => k.id);
  const items = kotIds.length
    ? await dbAll(`SELECT * FROM pos_kot_items WHERE kot_id IN (${kotIds.map(() => '?').join(',')}) ORDER BY id`, kotIds)
    : [];
  const byKot = {};
  for (const i of items) { (byKot[i.kot_id] ??= []).push(i); }
  for (const k of kots) k.items = byKot[k.id] || [];
  return { ...order, kots };
}

// Convert a scheduled/draft row into a real pos_orders + KOT. Punches the KOT
// so KDS picks it up exactly like a normal order.
async function convertRow(row, userId) {
  let items = [];
  try { items = row.items_json ? JSON.parse(row.items_json) : []; } catch { items = []; }

  const order = await transaction(async (tx) => {
    // Guard against double-conversion (poller + manual click racing)
    const claim = await tx.dbRun(
      `UPDATE pos_scheduled_orders SET status='CONVERTED' WHERE id=? AND status='PENDING'`,
      [row.id]
    );
    if (!claim || claim.changes === 0) return null;

    const order = await tx.dbGet(
      `INSERT INTO pos_orders
         (order_type, customer_name, customer_phone, order_notes, order_caption, status, punched_by)
       VALUES (?,?,?,?,?,'OPEN',?) RETURNING *`,
      [row.order_type, row.customer_name ?? null, row.customer_phone ?? null,
       row.order_notes ?? null, row.order_caption ?? null, userId ?? row.created_by ?? null]
    );

    const kot = await tx.dbGet(
      `INSERT INTO pos_kots (order_id, kot_number, punched_by) VALUES (?,1,?) RETURNING *`,
      [order.id, userId ?? row.created_by ?? null]
    );

    // Insert one KOT line; combo children pass comboParentId + isComboChild.
    const insertItem = async (item, comboParentId, isComboChild) => {
      const prod = await tx.dbGet(`SELECT prep_time_minutes, pos_station_id FROM products WHERE id=?`, [item.product_id]);
      const stationId = prod?.pos_station_id ?? null;
      const line = await tx.dbGet(
        `INSERT INTO pos_kot_items
           (kot_id, product_id, variant_id, product_name, quantity, unit_price, notes, is_home_pack, prep_time_minutes, station_id, discount_amount, discount_type, combo_parent_id, is_combo_child, status, served_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, IF(? IS NULL, NOW(), NULL)) RETURNING *`,
        [kot.id, item.product_id, item.variant_id ?? null, item.product_name,
         item.quantity, item.unit_price, item.notes ?? null, item.is_home_pack ?? 0,
         prod?.prep_time_minutes ?? 10, stationId,
         item.discount_amount ?? 0, item.discount_type ?? null,
         comboParentId ?? null, isComboChild ? 1 : 0,
         stationId == null ? 'SERVED' : 'ORDERSENT', stationId]
      );
      if (item.variant_id) await tx.dbRun(`UPDATE product_variants SET sync_status = 0 WHERE id = ? AND show_online = 1`, [item.variant_id]);
      else await tx.dbRun(`UPDATE product_variants SET sync_status = 0 WHERE product_id = ? AND show_online = 1`, [item.product_id]);
      return line;
    };

    for (const raw of items) {
      const parentItem = toKotItem(raw);
      const parent = await insertItem(parentItem, null, 0);
      const children = await comboExpander.componentsFor(parentItem.product_id, parentItem.quantity);
      for (const child of children) await insertItem({ ...child, is_home_pack: parentItem.is_home_pack }, parent.id, 1);
    }

    await tx.dbRun(`UPDATE pos_scheduled_orders SET converted_order_id=? WHERE id=?`, [order.id, row.id]);
    return order;
  });

  if (!order) return null; // already converted elsewhere

  kdsEvents.broadcast('new_kot', { orderId: order.id });
  const fullOrder = await buildFullOrder(order.id);
  if (fullOrder) socketServer.emitNewOrder(fullOrder);
  triggerStockSync();
  return order;
}

// ── Auto-convert poller — fires when NOW() reaches scheduled_for minus
// notify_before_min so the kitchen gets the KOT X minutes ahead ──
async function pollDue() {
  const due = await dbAll(
    `SELECT * FROM pos_scheduled_orders
     WHERE kind='SCHEDULED' AND status='PENDING' AND scheduled_for IS NOT NULL
       AND NOW() >= DATE_SUB(scheduled_for, INTERVAL notify_before_min MINUTE)`
  );
  for (const row of due) {
    try { await convertRow(row, null); }
    catch (err) { console.error(`[Scheduled] convert #${row.id} failed:`, err.message); }
  }
}
ready.then(() => setInterval(() => pollDue().catch(() => {}), 30000));

// ── Routes ────────────────────────────────────────────────────
router.use(requireSession);

// GET /api/pos/scheduled — all pending scheduled + draft orders
router.get('/', async (req, res) => {
  const rows = await dbAll(
    `SELECT * FROM pos_scheduled_orders WHERE status='PENDING'
     ORDER BY kind DESC, scheduled_for IS NULL, scheduled_for, created_at`
  );
  res.json(rows);
});

// GET /api/pos/scheduled/hours?date=YYYY-MM-DD — store hours for that weekday
router.get('/hours', async (req, res) => {
  const dateStr = req.query.date;
  if (!dateStr) return res.status(400).json({ error: 'date required' });
  const dow = new Date(`${dateStr}T00:00:00`).getDay(); // 0=Sun
  const schedule = await getSchedule();
  const day = schedule.find(d => Number(d.day_of_week) === dow);
  if (!day) return res.json({ is_open: 1, open_time: '08:00', close_time: '20:00' });
  res.json({ is_open: day.is_open ? 1 : 0, open_time: day.open_time, close_time: day.close_time, day_name: day.day_name });
});

// POST /api/pos/scheduled — create scheduled or draft order
router.post('/', async (req, res) => {
  const {
    kind, order_type = 'DELIVERY', customer_name, customer_phone,
    order_notes, order_caption, scheduled_for, notify_before_min = 30,
    items, total_amount = 0,
  } = req.body;

  if (kind !== 'SCHEDULED' && kind !== 'DRAFT') return res.status(400).json({ error: 'kind must be SCHEDULED or DRAFT' });
  if (!items?.length) return res.status(400).json({ error: 'items required' });
  if (kind === 'SCHEDULED') {
    if (!scheduled_for) return res.status(400).json({ error: 'scheduled_for required' });
    if (!customer_phone && !customer_name) return res.status(400).json({ error: 'customer required for scheduled order' });
  }

  const row = await dbGet(
    `INSERT INTO pos_scheduled_orders
       (kind, order_type, customer_name, customer_phone, order_notes, order_caption,
        scheduled_for, notify_before_min, items_json, total_amount, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
    [kind, order_type, customer_name ?? null, customer_phone ?? null,
     order_notes ?? null, order_caption ?? null,
     kind === 'SCHEDULED' ? scheduled_for : null, notify_before_min ?? 30,
     JSON.stringify(items), total_amount ?? 0, req.posUser.id]
  );
  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'SCHEDULED_ORDER', entityId: row.id, action: 'CREATE', delta: { kind, scheduled_for } });
  res.status(201).json(row);
});

// PATCH /api/pos/scheduled/:id — update a pending row
router.patch('/:id', async (req, res) => {
  const row = await dbGet(`SELECT * FROM pos_scheduled_orders WHERE id=?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'PENDING') return res.status(400).json({ error: `Already ${row.status}` });

  const { customer_name, customer_phone, order_notes, order_caption, scheduled_for, notify_before_min, items, total_amount } = req.body;
  const fields = [];
  const values = [];
  if (customer_name !== undefined)     { fields.push('customer_name = ?');     values.push(customer_name ?? null); }
  if (customer_phone !== undefined)    { fields.push('customer_phone = ?');    values.push(customer_phone ?? null); }
  if (order_notes !== undefined)       { fields.push('order_notes = ?');       values.push(order_notes ?? null); }
  if (order_caption !== undefined)     { fields.push('order_caption = ?');     values.push(order_caption || null); }
  if (scheduled_for !== undefined)     { fields.push('scheduled_for = ?');     values.push(scheduled_for ?? null); }
  if (notify_before_min !== undefined) { fields.push('notify_before_min = ?'); values.push(notify_before_min ?? 30); }
  if (items !== undefined)             { fields.push('items_json = ?');        values.push(items ? JSON.stringify(items) : null); }
  if (total_amount !== undefined)      { fields.push('total_amount = ?');      values.push(total_amount ?? 0); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

  values.push(row.id);
  await dbRun(`UPDATE pos_scheduled_orders SET ${fields.join(', ')} WHERE id = ?`, values);
  const updated = await dbGet(`SELECT * FROM pos_scheduled_orders WHERE id=?`, [row.id]);
  res.json(updated);
});

// POST /api/pos/scheduled/:id/convert — manual fire ("Send Now" / process draft)
router.post('/:id/convert', async (req, res) => {
  const row = await dbGet(`SELECT * FROM pos_scheduled_orders WHERE id=?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'PENDING') return res.status(400).json({ error: `Already ${row.status}` });

  const order = await convertRow(row, req.posUser.id);
  if (!order) return res.status(409).json({ error: 'Already converted' });
  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'SCHEDULED_ORDER', entityId: row.id, action: 'CONVERT', delta: { order_id: order.id } });
  res.json({ ok: true, order });
});

// POST /api/pos/scheduled/:id/cancel
router.post('/:id/cancel', async (req, res) => {
  const row = await dbGet(`SELECT * FROM pos_scheduled_orders WHERE id=?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'PENDING') return res.status(400).json({ error: `Already ${row.status}` });
  await dbRun(`UPDATE pos_scheduled_orders SET status='CANCELLED' WHERE id=?`, [row.id]);
  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'SCHEDULED_ORDER', entityId: row.id, action: 'CANCEL' });
  res.json({ ok: true });
});

// DELETE /api/pos/scheduled/:id — hard delete a wrong-punched draft/scheduled row.
router.delete('/:id', async (req, res) => {
  const row = await dbGet(`SELECT * FROM pos_scheduled_orders WHERE id=?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status === 'CONVERTED') return res.status(400).json({ error: 'Already converted' });
  await dbRun(`UPDATE pos_ocr_imports SET scheduled_order_id=NULL WHERE scheduled_order_id=?`, [row.id]);
  await dbRun(`DELETE FROM pos_scheduled_orders WHERE id=?`, [row.id]);
  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'SCHEDULED_ORDER', entityId: row.id, action: 'DELETE' });
  res.json({ ok: true });
});

module.exports = router;
