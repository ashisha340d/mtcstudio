'use strict';
const express    = require('express');
const { dbAll, dbGet, dbRun, transaction } = require('../../pos/db');
const { requireSession } = require('../../middleware/posAuth');
const { audit }          = require('../../middleware/posAudit');
const kdsEvents      = require('../../pos/kdsEvents');
const socketServer   = require('../../pos/socketServer');
const { getNepalDayBoundsUTC } = require('../../utils/nepalDateTime');
const { triggerStockSync } = require('../../services/liveShelfSync');
const webOrderBridge = require('../../services/webOrderBridge');
const comboExpander  = require('../../services/comboExpander');

const router = express.Router();

// Build a full order object (with nested kots+items) for Socket.IO payloads
async function buildFullOrder(orderId) {
  const order = await dbGet(
    `SELECT o.*, t.name AS table_name FROM pos_orders o
     LEFT JOIN pos_restaurant_tables t ON t.id = o.table_id
     WHERE o.id = ?`,
    [orderId]
  );
  if (!order) return null;
  const kots  = await dbAll(`SELECT k.*, u.employee_id AS punched_by_emp FROM pos_kots k LEFT JOIN pos_users u ON u.id = k.punched_by WHERE k.order_id = ? ORDER BY k.created_at`, [orderId]);
  const kotIds = kots.map(k => k.id);
  const items  = kotIds.length
    ? await dbAll(`SELECT * FROM pos_kot_items WHERE kot_id IN (${kotIds.map(() => '?').join(',')}) ORDER BY id`, kotIds)
    : [];
  const byKot = {};
  for (const i of items) { (byKot[i.kot_id] ??= []).push(i); }
  for (const k of kots)  k.items = byKot[k.id] || [];
  return { ...order, kots };
}

// Order context for socket payloads — resolved fresh so it works even after
// the order/table has been checked out and dropped from clients' active-orders cache.
async function getOrderContext(orderId) {
  return dbGet(
    `SELECT o.id, o.status, o.customer_name, t.name AS table_name FROM pos_orders o
     LEFT JOIN pos_restaurant_tables t ON t.id = o.table_id
     WHERE o.id = ?`,
    [orderId]
  );
}

// SSE endpoint must NOT use requireSession middleware (EventSource can't send headers)
// Token passed as ?token= query param instead
router.get('/events', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).json({ error: 'token required' });

  const session = await dbGet(
    `SELECT s.*, u.id AS uid FROM pos_sessions s
     JOIN pos_users u ON u.id = s.user_id
     WHERE s.token = ? AND s.ended_at IS NULL AND u.is_active = 1`,
    [token]
  );
  if (!session) return res.status(401).json({ error: 'Invalid session' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(':\n\n'); // establish connection

  kdsEvents.subscribe(res);

  const heartbeat = setInterval(() => {
    try { res.write(':\n\n'); } catch { clearInterval(heartbeat); }
  }, 20000);

  req.on('close', () => clearInterval(heartbeat));
});

router.use(requireSession);
router.use(require('../../middleware/posDayGuard').requireOpenDay);

// GET /api/pos/kots/today — history tab: orders with KOTs created today
router.get('/today', async (req, res) => {
  const { start, end } = getNepalDayBoundsUTC(req.query.date);
  const orders = await dbAll(
    `SELECT o.id, o.order_type, o.status AS order_status,
            o.customer_name, o.customer_phone,
            t.name AS table_name,
            MIN(k.created_at) AS first_kot_at
     FROM   pos_orders o
     JOIN   pos_kots k ON k.order_id = o.id
     LEFT JOIN pos_restaurant_tables t ON t.id = o.table_id
     WHERE  k.created_at >= ? AND k.created_at < ?
       AND  k.status != 'CANCELLED'
     GROUP  BY o.id
     ORDER  BY first_kot_at DESC`,
    [start, end]
  );

  if (!orders.length) return res.json([]);

  const orderIds   = orders.map(o => o.id);
  const ph         = orderIds.map(() => '?').join(',');

  const kots = await dbAll(
    `SELECT k.id, k.order_id, k.kot_number, k.status, k.created_at, k.served_at,
            u.employee_id AS punched_by_emp
     FROM   pos_kots k
     LEFT JOIN pos_users u ON u.id = k.punched_by
     WHERE  k.order_id IN (${ph})
       AND  k.status != 'CANCELLED'
       AND  k.created_at >= ? AND k.created_at < ?
     ORDER  BY k.created_at ASC`,
    [...orderIds, start, end]
  );

  const kotIds = kots.map(k => k.id);
  const items  = kotIds.length ? await dbAll(
    `SELECT ki.id, ki.kot_id, ki.product_name, ki.quantity, ki.notes, ki.status, ki.station_id
     FROM   pos_kot_items ki
     WHERE  ki.kot_id IN (${kotIds.map(()=>'?').join(',')}) ORDER BY ki.id`,
    kotIds
  ) : [];

  const itemsByKot = {};
  for (const i of items) { (itemsByKot[i.kot_id] ??= []).push(i); }
  const kotsByOrder = {};
  for (const k of kots) {
    k.items = itemsByKot[k.id] || [];
    (kotsByOrder[k.order_id] ??= []).push(k);
  }
  for (const o of orders) o.kots = kotsByOrder[o.id] || [];

  res.json(orders);
});

// GET /api/pos/kots/served — orders where every item is SERVED or CANCELLED today
router.get('/served', async (req, res) => {
  const { start, end } = getNepalDayBoundsUTC(req.query.date);
  const orders = await dbAll(
    `SELECT o.id, o.order_type, o.status AS order_status,
            o.customer_name, o.customer_phone,
            t.name AS table_name,
            MIN(k.created_at) AS first_kot_at
     FROM   pos_orders o
     JOIN   pos_kots k ON k.order_id = o.id
     LEFT JOIN pos_restaurant_tables t ON t.id = o.table_id
     WHERE  k.created_at >= ? AND k.created_at < ?
       AND  k.status != 'CANCELLED'
       AND  o.id NOT IN (
              SELECT DISTINCT k2.order_id
              FROM   pos_kots k2
              JOIN   pos_kot_items ki2 ON ki2.kot_id = k2.id
              WHERE  k2.created_at >= ? AND k2.created_at < ?
                AND  k2.status != 'CANCELLED'
                AND  ki2.status NOT IN ('SERVED','CANCELLED')
            )
     GROUP  BY o.id
     ORDER  BY first_kot_at DESC`,
    [start, end, start, end]
  );

  if (!orders.length) return res.json([]);

  const orderIds = orders.map(o => o.id);
  const ph       = orderIds.map(() => '?').join(',');

  const kots = await dbAll(
    `SELECT k.id, k.order_id, k.kot_number, k.status, k.created_at, k.served_at,
            u.employee_id AS punched_by_emp
     FROM   pos_kots k
     LEFT JOIN pos_users u ON u.id = k.punched_by
     WHERE  k.order_id IN (${ph})
       AND  k.status != 'CANCELLED'
       AND  k.created_at >= ? AND k.created_at < ?
     ORDER  BY k.created_at ASC`,
    [...orderIds, start, end]
  );

  const kotIds = kots.map(k => k.id);
  const items  = kotIds.length ? await dbAll(
    `SELECT ki.*, s.color_hex AS station_color
     FROM   pos_kot_items ki
     LEFT JOIN pos_stations s ON s.id = ki.station_id
     WHERE  ki.kot_id IN (${kotIds.map(() => '?').join(',')}) ORDER BY ki.id`,
    kotIds
  ) : [];

  const itemsByKot = {};
  for (const i of items) { (itemsByKot[i.kot_id] ??= []).push(i); }
  const kotsByOrder = {};
  for (const k of kots) {
    k.items = itemsByKot[k.id] || [];
    (kotsByOrder[k.order_id] ??= []).push(k);
  }
  for (const o of orders) o.kots = kotsByOrder[o.id] || [];

  res.json(orders);
});

// GET /api/pos/kots/active — orders with at least one unserved item today (item-level)
router.get('/active', async (req, res) => {
  const { start, end } = getNepalDayBoundsUTC();
  const orders = await dbAll(
    `SELECT o.id, o.order_type, o.status AS order_status,
            o.customer_name, o.customer_phone,
            t.name AS table_name,
            MIN(k.created_at) AS first_kot_at
     FROM   pos_orders o
     JOIN   pos_kots k ON k.order_id = o.id
     JOIN   pos_kot_items ki ON ki.kot_id = k.id
     LEFT JOIN pos_restaurant_tables t ON t.id = o.table_id
     WHERE  k.created_at >= ? AND k.created_at < ?
       AND  k.status != 'CANCELLED'
       AND  ki.status NOT IN ('SERVED','CANCELLED')
     GROUP  BY o.id
     ORDER  BY first_kot_at ASC`,
    [start, end]
  );

  if (!orders.length) return res.json([]);

  const orderIds = orders.map(o => o.id);
  const ph       = orderIds.map(() => '?').join(',');

  const kots = await dbAll(
    `SELECT k.id, k.order_id, k.kot_number, k.status, k.created_at, k.served_at,
            u.employee_id AS punched_by_emp
     FROM   pos_kots k
     LEFT JOIN pos_users u ON u.id = k.punched_by
     WHERE  k.order_id IN (${ph})
       AND  k.status != 'CANCELLED'
       AND  k.created_at >= ? AND k.created_at < ?
     ORDER  BY k.created_at ASC`,
    [...orderIds, start, end]
  );

  const kotIds = kots.map(k => k.id);
  const items  = kotIds.length ? await dbAll(
    `SELECT ki.*, s.color_hex AS station_color
     FROM   pos_kot_items ki
     LEFT JOIN pos_stations s ON s.id = ki.station_id
     WHERE  ki.kot_id IN (${kotIds.map(()=>'?').join(',')}) ORDER BY ki.id`,
    kotIds
  ) : [];

  const itemsByKot = {};
  for (const i of items) { (itemsByKot[i.kot_id] ??= []).push(i); }
  const kotsByOrder = {};
  for (const k of kots) {
    k.items = itemsByKot[k.id] || [];
    (kotsByOrder[k.order_id] ??= []).push(k);
  }
  for (const o of orders) o.kots = kotsByOrder[o.id] || [];

  res.json(orders);
});

// GET /api/pos/kots — same as /active
router.get('/', async (req, res) => {
  const { start, end } = getNepalDayBoundsUTC();
  const orders = await dbAll(
    `SELECT o.id, o.order_type, o.status AS order_status,
            o.customer_name, o.customer_phone,
            t.name AS table_name,
            MIN(k.created_at) AS first_kot_at
     FROM   pos_orders o
     JOIN   pos_kots k ON k.order_id = o.id
     JOIN   pos_kot_items ki ON ki.kot_id = k.id
     LEFT JOIN pos_restaurant_tables t ON t.id = o.table_id
     WHERE  k.created_at >= ? AND k.created_at < ?
       AND  k.status != 'CANCELLED'
       AND  ki.status NOT IN ('SERVED','CANCELLED')
     GROUP  BY o.id
     ORDER  BY first_kot_at ASC`,
    [start, end]
  );
  if (!orders.length) return res.json([]);
  const orderIds = orders.map(o => o.id);
  const ph       = orderIds.map(() => '?').join(',');
  const kots = await dbAll(
    `SELECT k.id, k.order_id, k.kot_number, k.status, k.created_at, k.served_at,
            u.employee_id AS punched_by_emp
     FROM pos_kots k
     LEFT JOIN pos_users u ON u.id = k.punched_by
     WHERE k.order_id IN (${ph})
       AND k.status != 'CANCELLED'
       AND k.created_at >= ? AND k.created_at < ?
     ORDER BY k.created_at ASC`,
    [...orderIds, start, end]
  );
  const kotIds = kots.map(k => k.id);
  const items  = kotIds.length ? await dbAll(
    `SELECT ki.*, s.color_hex AS station_color FROM pos_kot_items ki
     LEFT JOIN pos_stations s ON s.id = ki.station_id
     WHERE ki.kot_id IN (${kotIds.map(()=>'?').join(',')}) ORDER BY ki.id`,
    kotIds
  ) : [];
  const itemsByKot = {};
  for (const i of items) { (itemsByKot[i.kot_id] ??= []).push(i); }
  const kotsByOrder = {};
  for (const k of kots) {
    k.items = itemsByKot[k.id] || [];
    (kotsByOrder[k.order_id] ??= []).push(k);
  }
  for (const o of orders) o.kots = kotsByOrder[o.id] || [];
  res.json(orders);
});

// GET /api/pos/kots/report/today — item totals + avg ticket time for today
router.get('/report/today', async (req, res) => {
  const { start, end } = getNepalDayBoundsUTC(req.query.date);
  const stationId = req.query.station ? Number(req.query.station) : null;

  let itemSql = `
    SELECT ki.product_name, CAST(SUM(ki.quantity) AS UNSIGNED) AS total_qty
    FROM   pos_kot_items ki
    JOIN   pos_kots k ON k.id = ki.kot_id
    WHERE  k.created_at >= ? AND k.created_at < ?
      AND  k.status != 'CANCELLED'
      AND  ki.status = 'SERVED'
  `;
  const itemParams = [start, end];
  if (stationId) { itemSql += ` AND ki.station_id = ?`; itemParams.push(stationId); }
  itemSql += ` GROUP BY ki.product_name ORDER BY total_qty DESC`;
  const items = await dbAll(itemSql, itemParams);

  // Avg ticket time: created_at -> served_at for fully-SERVED KOTs today
  let ticketSql = `
    SELECT COUNT(*) AS kot_count,
           AVG(TIMESTAMPDIFF(SECOND, k.created_at, k.served_at)) AS avg_secs
    FROM   pos_kots k
    WHERE  k.created_at >= ? AND k.created_at < ?
      AND  k.status = 'SERVED'
      AND  k.served_at IS NOT NULL
  `;
  const ticketParams = [start, end];
  if (stationId) {
    ticketSql += ` AND EXISTS (SELECT 1 FROM pos_kot_items ki WHERE ki.kot_id = k.id AND ki.station_id = ?)`;
    ticketParams.push(stationId);
  }
  const ticket = await dbGet(ticketSql, ticketParams);

  res.json({
    items,
    kot_count: Number(ticket?.kot_count) || 0,
    avg_ticket_secs: ticket?.avg_secs === null || ticket?.avg_secs === undefined ? null : Math.round(Number(ticket.avg_secs)),
  });
});

const DISCOUNT_TYPES = ['MANUAL', 'PROMO', 'COMPLIMENTARY', 'EMPLOYEE'];

// Fire one KOT for order_id from items[] — one per call, never appended to an
// existing KOT. Shared by POST / below and the mobile companion edit endpoint
// (adding a line to an order re-uses the exact same punch path).
async function fireKot({ order_id, items, punched_by, actorUserId, actorSessionId, actorEmployeeId }) {
  const userId = punched_by ?? actorUserId;

  const result = await transaction(async (tx) => {
    // Auto-calculate next kot_number for this order
    const mx = await tx.dbGet(`SELECT MAX(kot_number) AS mx FROM pos_kots WHERE order_id=?`, [order_id]);
    const kotNum = (mx?.mx ?? 0) + 1;

    const kot = await tx.dbGet(
      `INSERT INTO pos_kots (order_id, kot_number, punched_by) VALUES (?,?,?) RETURNING *`,
      [order_id, kotNum, userId]
    );

    // Insert one KOT line. Combo children pass comboParentId + isComboChild.
    const insertItem = async (item, comboParentId, isComboChild) => {
      const prod = await tx.dbGet(`SELECT p.prep_time_minutes, p.pos_station_id, (SELECT COALESCE(MAX(v.auto_kds),0) FROM product_variants v WHERE IF(? IS NULL, v.product_id = p.id, v.id = ?)) AS auto_kds FROM products p WHERE p.id=?`, [item.variant_id ?? null, item.variant_id ?? null, item.product_id]);
      // Item discount: absolute per line, clamped to line value; type required with amount
      const lineValue = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
      const discAmt = Math.min(Math.max(Number(item.discount_amount) || 0, 0), lineValue);
      const discType = discAmt > 0 && DISCOUNT_TYPES.includes(item.discount_type) ? item.discount_type : (discAmt > 0 ? 'MANUAL' : null);
      // No station = not kitchen-tracked (water, delivery charge, retail) — auto-SERVED
      // so KDS skips it and web-order progress (n/N) never stalls on it. Auto KDS variants take the same path.
      const stationId = prod?.auto_kds ? null : prod?.pos_station_id ?? null;
      const row = await tx.dbGet(
        `INSERT INTO pos_kot_items
           (kot_id, product_id, variant_id, product_name, quantity, unit_price, notes, is_home_pack, prep_time_minutes, station_id, discount_amount, discount_type, combo_parent_id, is_combo_child, status, served_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, IF(? IS NULL, NOW(), NULL)) RETURNING *`,
        [
          kot.id, item.product_id, item.variant_id ?? null, item.product_name,
          item.quantity, item.unit_price,
          item.notes ?? null, item.is_home_pack ? 1 : 0,
          item.prep_time_minutes ?? prod?.prep_time_minutes ?? 10,
          stationId,
          discAmt, discType,
          comboParentId ?? null, isComboChild ? 1 : 0,
          stationId == null ? 'SERVED' : 'ORDERSENT',
          stationId,
        ]
      );
      // Flag variant as dirty so triggerStockSync() will push available qty to website
      if (item.variant_id) {
        await tx.dbRun(`UPDATE product_variants SET sync_status = 0 WHERE id = ? AND show_online = 1`, [item.variant_id]);
      } else {
        await tx.dbRun(`UPDATE product_variants SET sync_status = 0 WHERE product_id = ? AND show_online = 1`, [item.product_id]);
      }
      return row;
    };

    // Expand combos: parent line keeps price/name; children (price 0) carry the
    // real variant_ids so KOT + inventory see the components.
    const groups = await comboExpander.expandGroups(items);
    const saved = [];
    for (const g of groups) {
      const parent = await insertItem(g.parent, null, 0);
      saved.push(parent);
      for (const child of g.children) saved.push(await insertItem(child, parent.id, 1));
    }

    audit({ userId: actorUserId, sessionId: actorSessionId, entityType: 'KOT', entityId: kot.id, action: 'CREATE', delta: { order_id, kot_number: kotNum, itemCount: saved.length } });
    return { ...kot, items: saved, punched_by_emp: actorEmployeeId };
  });

  kdsEvents.broadcast('new_kot', { orderId: result.order_id, kotId: result.id });

  // Fetch full order payload for Socket.IO so KDS can insert without a refetch
  const fullOrder = await buildFullOrder(result.order_id);
  if (fullOrder) socketServer.emitNewOrder(fullOrder);

  triggerStockSync(); // background qty-only push to website
  webOrderBridge.notifyKotItemsChanged(result.order_id); // web-origin orders only, no-op otherwise
  webOrderBridge.notifyKotItemProgress(result.order_id);

  return result;
}

// POST /api/pos/kots — one per SEND, never append
router.post('/', async (req, res) => {
  const { order_id, items, punched_by } = req.body;
  if (!order_id || !items?.length) return res.status(400).json({ error: 'order_id and items required' });

  const result = await fireKot({
    order_id, items, punched_by,
    actorUserId: req.posUser.id, actorSessionId: req.posSessionId, actorEmployeeId: req.posUser.employee_id,
  });
  res.status(201).json(result);
});

// PATCH /api/pos/kots/:id/items/:itemId — update quantity, notes, packing flag and/or discount
router.patch('/:id/items/:itemId', async (req, res) => {
  const { quantity, notes, is_home_pack, discount_amount, discount_type } = req.body;

  const item = await dbGet(`SELECT * FROM pos_kot_items WHERE id=? AND kot_id=?`,
    [req.params.itemId, req.params.id]);
  if (!item) return res.status(404).json({ error: 'Not found' });

  const fields = [];
  const values = [];

  // Qty only editable if not yet served/cancelled — except no-station lines (combo
  // parents, auto-entry, retail), which auto-serve on send and were never actually
  // kitchen-served, so they must stay qty-editable.
  if (quantity !== undefined) {
    if (item.station_id != null && (item.status === 'SERVED' || item.status === 'CANCELLED'))
      return res.status(400).json({ error: 'Cannot change quantity of a served or cancelled item' });
    if (item.station_id == null && item.status === 'CANCELLED')
      return res.status(400).json({ error: 'Cannot change quantity of a cancelled item' });
    if (quantity < 1) return res.status(400).json({ error: 'quantity >= 1 required' });
    fields.push('quantity = ?'); values.push(quantity);
  }

  // Notes editable at any status
  if (notes !== undefined) {
    fields.push('notes = ?'); values.push(notes || null);
  }

  // Packing flag editable only while unserved
  if (is_home_pack !== undefined) {
    if (item.status === 'SERVED' || item.status === 'CANCELLED')
      return res.status(400).json({ error: 'Cannot change packing of a served or cancelled item' });
    fields.push('is_home_pack = ?'); values.push(is_home_pack ? 1 : 0);
  }

  // Discount editable while not cancelled — clamped to the (possibly updated) line value
  if (discount_amount !== undefined) {
    if (item.status === 'CANCELLED')
      return res.status(400).json({ error: 'Cannot discount a cancelled item' });
    const qty = quantity !== undefined ? quantity : item.quantity;
    const lineValue = qty * item.unit_price;
    const discAmt = Math.min(Math.max(Number(discount_amount) || 0, 0), lineValue);
    const discType = discAmt > 0 && DISCOUNT_TYPES.includes(discount_type) ? discount_type : (discAmt > 0 ? 'MANUAL' : null);
    fields.push('discount_amount = ?'); values.push(discAmt);
    fields.push('discount_type = ?');   values.push(discType);
  }

  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

  values.push(item.id);
  await dbRun(`UPDATE pos_kot_items SET ${fields.join(', ')} WHERE id=?`, values);

  // Combo parent qty changed → rescale its child component lines (qty = newQty × childQty)
  if (quantity !== undefined) {
    const kids = await dbAll(
      `SELECT * FROM pos_kot_items WHERE combo_parent_id=? AND status NOT IN ('SERVED','CANCELLED')`, [item.id]);
    if (kids.length) {
      const comps = await comboExpander.componentsFor(item.product_id, quantity);
      const childKot = await dbGet(`SELECT order_id FROM pos_kots WHERE id=?`, [item.kot_id]);
      for (const ch of kids) {
        const match = comps.find(c => c.product_id === ch.product_id && (c.variant_id ?? null) === (ch.variant_id ?? null));
        if (match && match.quantity !== ch.quantity) {
          await dbRun(`UPDATE pos_kot_items SET quantity=? WHERE id=?`, [match.quantity, ch.id]);
          if (ch.variant_id) await dbRun(`UPDATE product_variants SET sync_status=0 WHERE id=? AND show_online=1`, [ch.variant_id]);
          else await dbRun(`UPDATE product_variants SET sync_status=0 WHERE product_id=? AND show_online=1`, [ch.product_id]);
          socketServer.emitItemUpdated({ // broadcast rescaled child so KDS sees new qty
            kotId: ch.kot_id, orderId: childKot?.order_id ?? null, itemId: ch.id,
            quantity: match.quantity, notes: ch.notes, is_home_pack: ch.is_home_pack,
            station_id: ch.station_id ?? null,
          });
        }
      }
      triggerStockSync();
    }
  }

  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'KOT_ITEM', entityId: item.id, action: 'EDIT', delta: { quantity, notes, is_home_pack, discount_amount, discount_type } });

  const updated = await dbGet(`SELECT * FROM pos_kot_items WHERE id=?`, [item.id]);
  const kotRow  = await dbGet(`SELECT order_id FROM pos_kots WHERE id=?`, [updated.kot_id]);
  socketServer.emitItemUpdated({
    kotId: updated.kot_id,
    orderId: kotRow?.order_id ?? null,
    itemId: updated.id,
    quantity: updated.quantity,
    notes: updated.notes,
    is_home_pack: updated.is_home_pack,
    station_id: updated.station_id ?? null,
  });
  if (quantity !== undefined) { // line change → mirror bill on the website (web orders only)
    if (kotRow) webOrderBridge.notifyKotItemsChanged(kotRow.order_id);
  }

  res.json({ ok: true, quantity, notes, is_home_pack });
});

// PATCH /api/pos/kots/:id/items/:itemId/serve
router.patch('/:id/items/:itemId/serve', async (req, res) => {
  const item = await dbGet(`SELECT ki.* FROM pos_kot_items ki WHERE ki.id=? AND ki.kot_id=?`, [req.params.itemId, req.params.id]);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  await dbRun(`UPDATE pos_kot_items SET status='SERVED', served_at=CURRENT_TIMESTAMP WHERE id=?`, [item.id]);
  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'KOT_ITEM', entityId: item.id, action: 'SERVED' });

  const updated = await dbGet(`SELECT * FROM pos_kot_items WHERE id=?`, [item.id]);
  const kot     = await dbGet(`SELECT * FROM pos_kots WHERE id=?`, [req.params.id]);
  const order   = await getOrderContext(kot.order_id);
  const servedPayload = {
    kotId: kot.id, orderId: kot.order_id, itemId: item.id, status: 'SERVED', served_at: updated.served_at, station_id: item.station_id ?? null,
    product_name: item.product_name, table_name: order?.table_name ?? null, customer_name: order?.customer_name ?? null, order_status: order?.status ?? null,
  };
  kdsEvents.broadcast('item_served', servedPayload);
  socketServer.emitItemServed(servedPayload);
  webOrderBridge.notifyKotItemProgress(kot.order_id); // web-origin orders only, no-op otherwise
  res.json({ item: updated, kotStatus: kot.status });
});

// PATCH /api/pos/kots/:id/items/:itemId/unserve — undo served, revert item to ORDERSENT
router.patch('/:id/items/:itemId/unserve', async (req, res) => {
  const item = await dbGet(`SELECT * FROM pos_kot_items WHERE id=? AND kot_id=?`,
    [req.params.itemId, req.params.id]);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (item.status !== 'SERVED') return res.status(400).json({ error: 'Item is not served' });

  await transaction(async (tx) => {
    await tx.dbRun(`UPDATE pos_kot_items SET status='ORDERSENT', served_at=NULL WHERE id=?`, [item.id]);
    await tx.dbRun(`UPDATE pos_kots SET status='IN_PROGRESS', served_at=NULL WHERE id=? AND status='SERVED'`,
      [req.params.id]);
  });

  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'KOT_ITEM', entityId: item.id, action: 'UNSERVED' });
  const kot = await dbGet(`SELECT order_id FROM pos_kots WHERE id=?`, [req.params.id]);
  const unservedPayload = { kotId: Number(req.params.id), orderId: kot?.order_id, itemId: item.id, status: 'ORDERSENT', served_at: null, station_id: item.station_id ?? null };
  kdsEvents.broadcast('item_served', unservedPayload);
  socketServer.emitItemServed(unservedPayload);
  if (kot?.order_id) webOrderBridge.notifyKotItemProgress(kot.order_id); // web-origin orders only
  res.json({ ok: true });
});

// PATCH /api/pos/kots/:id/items/:itemId/status
// On CANCELLED, cancel_kind classifies it: CANCEL (mistake/edit) | RETURN | WASTE
router.patch('/:id/items/:itemId/status', async (req, res) => {
  const { status, cancel_kind, cancel_reason } = req.body;
  const item = await dbGet(`SELECT * FROM pos_kot_items WHERE id=? AND kot_id=?`, [req.params.itemId, req.params.id]);
  if (!item) return res.status(404).json({ error: 'Not found' });

  let cancelledKids = []; // combo children cascaded — broadcast after commit
  await transaction(async (tx) => {
    if (status === 'SERVED') {
      await tx.dbRun(`UPDATE pos_kot_items SET status='SERVED', served_at=CURRENT_TIMESTAMP WHERE id=?`, [item.id]);
    } else {
      await tx.dbRun(`UPDATE pos_kot_items SET status=? WHERE id=?`, [status, item.id]);
    }
    // Flag for sync — cancelled items auto-drop from today's SUM so available recalculates correctly
    if (status === 'CANCELLED' && item.status !== 'CANCELLED') {
      const kind = ['CANCEL', 'RETURN', 'WASTE'].includes(cancel_kind) ? cancel_kind : 'CANCEL';
      await tx.dbRun(
        `INSERT INTO pos_cancellations (entity_type, entity_id, reason, kind, cancelled_by) VALUES ('KOT_ITEM',?,?,?,?)`,
        [item.id, cancel_reason ?? null, kind, req.posUser.id]
      );
      if (item.variant_id) {
        await tx.dbRun(`UPDATE product_variants SET sync_status = 0 WHERE id = ? AND show_online = 1`, [item.variant_id]);
      } else {
        await tx.dbRun(`UPDATE product_variants SET sync_status = 0 WHERE product_id = ? AND show_online = 1`, [item.product_id]);
      }
      // Combo parent cancelled → cancel its child component lines too
      const kids = await tx.dbAll(`SELECT * FROM pos_kot_items WHERE combo_parent_id=? AND status!='CANCELLED'`, [item.id]);
      cancelledKids = kids;
      for (const k of kids) {
        await tx.dbRun(`UPDATE pos_kot_items SET status='CANCELLED' WHERE id=?`, [k.id]);
        await tx.dbRun(
          `INSERT INTO pos_cancellations (entity_type, entity_id, reason, kind, cancelled_by) VALUES ('KOT_ITEM',?,?,?,?)`,
          [k.id, cancel_reason ?? 'combo parent cancelled', kind, req.posUser.id]
        );
        if (k.variant_id) await tx.dbRun(`UPDATE product_variants SET sync_status = 0 WHERE id = ? AND show_online = 1`, [k.variant_id]);
        else await tx.dbRun(`UPDATE product_variants SET sync_status = 0 WHERE product_id = ? AND show_online = 1`, [k.product_id]);
      }
      triggerStockSync();
    }
  });
  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'KOT_ITEM', entityId: item.id, action: 'STATUS_UPDATE', delta: { from: item.status, to: status } });

  const updated = await dbGet(`SELECT * FROM pos_kot_items WHERE id=?`, [item.id]);
  const kot     = await dbGet(`SELECT * FROM pos_kots WHERE id=?`, [req.params.id]);
  const order   = updated.status === 'SERVED' ? await getOrderContext(kot.order_id) : null;
  const statusPayload = {
    kotId: kot.id, orderId: kot.order_id, itemId: item.id, status: updated.status, served_at: updated.served_at, station_id: item.station_id ?? null,
    product_name: item.product_name, table_name: order?.table_name ?? null, customer_name: order?.customer_name ?? null, order_status: order?.status ?? null,
  };
  kdsEvents.broadcast('item_served', statusPayload);
  socketServer.emitItemServed(statusPayload);
  // Cascaded combo children — broadcast their cancel so KDS drops them (socket only, no SSE dup)
  for (const k of cancelledKids) {
    socketServer.emitItemServed({
      kotId: k.kot_id, orderId: kot.order_id, itemId: k.id, status: 'CANCELLED',
      served_at: null, station_id: k.station_id ?? null, product_name: k.product_name,
    });
  }
  webOrderBridge.notifyKotItemProgress(kot.order_id); // web-origin orders only, no-op otherwise
  if (status === 'CANCELLED' || item.status === 'CANCELLED') // line removed/restored → mirror bill
    webOrderBridge.notifyKotItemsChanged(kot.order_id);

  res.json({ ok: true, status });
});

// Change a fired line's quantity (with combo-child rescale). Same rules as the
// quantity branch of PATCH /:id/items/:itemId above; kept as a standalone
// function so the mobile companion edit endpoint can drive it by item id alone
// (no kot id needed) without duplicating the combo-rescale logic.
async function changeKotItemQuantity(itemId, quantity, { actorUserId, actorSessionId }) {
  const item = await dbGet(`SELECT * FROM pos_kot_items WHERE id=?`, [itemId]);
  if (!item) return { error: 'Item not found', status: 404 };

  if (item.station_id != null && (item.status === 'SERVED' || item.status === 'CANCELLED'))
    return { error: 'Cannot change quantity of a served or cancelled item', status: 400 };
  if (item.station_id == null && item.status === 'CANCELLED')
    return { error: 'Cannot change quantity of a cancelled item', status: 400 };
  if (!(quantity >= 1)) return { error: 'quantity >= 1 required', status: 400 };

  await dbRun(`UPDATE pos_kot_items SET quantity=? WHERE id=?`, [quantity, item.id]);

  const kids = await dbAll(
    `SELECT * FROM pos_kot_items WHERE combo_parent_id=? AND status NOT IN ('SERVED','CANCELLED')`, [item.id]);
  if (kids.length) {
    const comps = await comboExpander.componentsFor(item.product_id, quantity);
    const childKot = await dbGet(`SELECT order_id FROM pos_kots WHERE id=?`, [item.kot_id]);
    for (const ch of kids) {
      const match = comps.find(c => c.product_id === ch.product_id && (c.variant_id ?? null) === (ch.variant_id ?? null));
      if (match && match.quantity !== ch.quantity) {
        await dbRun(`UPDATE pos_kot_items SET quantity=? WHERE id=?`, [match.quantity, ch.id]);
        if (ch.variant_id) await dbRun(`UPDATE product_variants SET sync_status=0 WHERE id=? AND show_online=1`, [ch.variant_id]);
        else await dbRun(`UPDATE product_variants SET sync_status=0 WHERE product_id=? AND show_online=1`, [ch.product_id]);
        socketServer.emitItemUpdated({
          kotId: ch.kot_id, orderId: childKot?.order_id ?? null, itemId: ch.id,
          quantity: match.quantity, notes: ch.notes, is_home_pack: ch.is_home_pack,
          station_id: ch.station_id ?? null,
        });
      }
    }
    triggerStockSync();
  }

  audit({ userId: actorUserId, sessionId: actorSessionId, entityType: 'KOT_ITEM', entityId: item.id, action: 'EDIT', delta: { quantity } });

  const updated = await dbGet(`SELECT * FROM pos_kot_items WHERE id=?`, [item.id]);
  const kotRow  = await dbGet(`SELECT order_id FROM pos_kots WHERE id=?`, [updated.kot_id]);
  socketServer.emitItemUpdated({
    kotId: updated.kot_id, orderId: kotRow?.order_id ?? null, itemId: updated.id,
    quantity: updated.quantity, notes: updated.notes, is_home_pack: updated.is_home_pack,
    station_id: updated.station_id ?? null,
  });
  if (kotRow) webOrderBridge.notifyKotItemsChanged(kotRow.order_id);

  return { item: updated };
}

// Cancel a single fired line (with combo-child cascade). Same rules as the
// CANCELLED branch of PATCH /:id/items/:itemId/status above; standalone so the
// mobile companion edit endpoint can drive it by item id alone.
async function cancelKotItem(itemId, { reason, kind, actorUserId, actorSessionId }) {
  const item = await dbGet(`SELECT * FROM pos_kot_items WHERE id=?`, [itemId]);
  if (!item) return { error: 'Item not found', status: 404 };
  if (item.status === 'CANCELLED') return { item }; // already cancelled — no-op

  let cancelledKids = [];
  await transaction(async (tx) => {
    await tx.dbRun(`UPDATE pos_kot_items SET status='CANCELLED' WHERE id=?`, [item.id]);
    const k = ['CANCEL', 'RETURN', 'WASTE'].includes(kind) ? kind : 'CANCEL';
    await tx.dbRun(
      `INSERT INTO pos_cancellations (entity_type, entity_id, reason, kind, cancelled_by) VALUES ('KOT_ITEM',?,?,?,?)`,
      [item.id, reason ?? null, k, actorUserId]
    );
    if (item.variant_id) await tx.dbRun(`UPDATE product_variants SET sync_status = 0 WHERE id = ? AND show_online = 1`, [item.variant_id]);
    else await tx.dbRun(`UPDATE product_variants SET sync_status = 0 WHERE product_id = ? AND show_online = 1`, [item.product_id]);

    const kids = await tx.dbAll(`SELECT * FROM pos_kot_items WHERE combo_parent_id=? AND status!='CANCELLED'`, [item.id]);
    cancelledKids = kids;
    for (const kd of kids) {
      await tx.dbRun(`UPDATE pos_kot_items SET status='CANCELLED' WHERE id=?`, [kd.id]);
      await tx.dbRun(
        `INSERT INTO pos_cancellations (entity_type, entity_id, reason, kind, cancelled_by) VALUES ('KOT_ITEM',?,?,?,?)`,
        [kd.id, reason ?? 'combo parent cancelled', k, actorUserId]
      );
      if (kd.variant_id) await tx.dbRun(`UPDATE product_variants SET sync_status = 0 WHERE id = ? AND show_online = 1`, [kd.variant_id]);
      else await tx.dbRun(`UPDATE product_variants SET sync_status = 0 WHERE product_id = ? AND show_online = 1`, [kd.product_id]);
    }
    triggerStockSync();
  });

  audit({ userId: actorUserId, sessionId: actorSessionId, entityType: 'KOT_ITEM', entityId: item.id, action: 'STATUS_UPDATE', delta: { from: item.status, to: 'CANCELLED' } });

  const updated = await dbGet(`SELECT * FROM pos_kot_items WHERE id=?`, [item.id]);
  const kot     = await dbGet(`SELECT * FROM pos_kots WHERE id=?`, [item.kot_id]);
  const statusPayload = {
    kotId: kot.id, orderId: kot.order_id, itemId: item.id, status: 'CANCELLED', served_at: null, station_id: item.station_id ?? null,
    product_name: item.product_name, table_name: null, customer_name: null, order_status: null,
  };
  kdsEvents.broadcast('item_served', statusPayload);
  socketServer.emitItemServed(statusPayload);
  for (const kd of cancelledKids) {
    socketServer.emitItemServed({
      kotId: kd.kot_id, orderId: kot.order_id, itemId: kd.id, status: 'CANCELLED',
      served_at: null, station_id: kd.station_id ?? null, product_name: kd.product_name,
    });
  }
  webOrderBridge.notifyKotItemProgress(kot.order_id);
  webOrderBridge.notifyKotItemsChanged(kot.order_id);

  return { item: updated, cancelledKids };
}

router.fireKot = fireKot;
router.changeKotItemQuantity = changeKotItemQuantity;
router.cancelKotItem = cancelKotItem;

module.exports = router;
