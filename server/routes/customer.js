'use strict';
const express      = require('express');
const { dbAll, dbGet, dbRun, transaction } = require('../pos/db');
const socketServer = require('../pos/socketServer');

const router = express.Router();

// Resolve CSV badge codes + attach variants (low→high effective price) — shared
// by /menu and /recommended so both product lists render identically.
async function shapeProducts(products) {
  if (!products.length) return products;

  const badgeCatalogue = await dbAll(
    `SELECT code, name, value AS icon FROM lookup_master WHERE lookup_type = 'PRODUCT_BADGE' AND is_active = 1`
  );
  const badgeByCode = new Map(badgeCatalogue.map(b => [b.code, b]));
  for (const p of products) {
    p.badges = String(p.badge || '').split(',').map(c => c.trim()).filter(Boolean)
      .map(c => badgeByCode.get(c)).filter(Boolean);
    delete p.badge;
  }

  const ids = products.map(p => p.id);
  const ph  = ids.map(() => '?').join(',');
  const variants = await dbAll(`
    SELECT pv.id, pv.product_id, pv.name, COALESCE(pv.selling_price, 0) AS price, pv.sort_order
    FROM   product_variants pv
    JOIN   products p2 ON p2.id = pv.product_id
    WHERE  pv.product_id IN (${ph}) AND pv.status = 'active'
    ORDER  BY COALESCE(NULLIF(pv.selling_price, 0), p2.pos_price), pv.sort_order, pv.id
  `, ids);

  const byProd = {};
  for (const v of variants) (byProd[v.product_id] ??= []).push(v);
  for (const p of products) {
    p.variants = byProd[p.id] || [];
    p.price = p.variants.length
      ? Math.min(...p.variants.map(v => v.price || p.base_price))
      : p.base_price;
    p.has_variants = p.variants.length > 1;
  }
  return products;
}

// ── GET /api/customer/menu?tableId=1 ─────────────────────────────────────────
router.get('/menu', async (req, res) => {
  const { tableId } = req.query;

  let table = null;
  if (tableId) {
    table = await dbGet(
      `SELECT id, name, section, capacity FROM pos_restaurant_tables WHERE id = ? AND is_active = 1`, [tableId]
    ) || null;
    if (!table) return res.status(404).json({ error: 'Table not found' });
  }

  const categories = await dbAll(`
    SELECT DISTINCT c.id, c.name, c.icon, c.sort_order
    FROM   categories c
    JOIN   products p ON p.category_id = c.id
    WHERE  p.customer_visible = 1 AND p.pos_active = 1
    ORDER  BY c.sort_order, c.name
  `, []);

  const products = await dbAll(`
    SELECT
      p.id, p.name, p.description, p.pos_price AS base_price,
      p.customer_max_qty, p.prep_time_minutes, p.is_fast_moving, p.badge,
      p.category_id, p.pos_station_id,
      c.name AS category_name, c.icon AS category_icon,
      ml.filename AS image_filename
    FROM   products p
    LEFT JOIN categories     c      ON c.id = p.category_id
    LEFT JOIN product_images pi_img ON pi_img.product_id = p.id AND pi_img.is_primary = 1
    LEFT JOIN media_library  ml     ON ml.id = pi_img.media_id
    WHERE  p.customer_visible = 1 AND p.pos_active = 1
    ORDER  BY c.sort_order, p.sort_order, p.name
  `, []);

  await shapeProducts(products);

  res.json({ table, categories, products });
});

// ── GET /api/customer/recommended ────────────────────────────────────────────
// Admin-curated "you might also like" list (Automation module → Recommended
// Products). Shown on the customer menu when an item is added to cart or the
// cart opens. Same product shape as /menu so the existing Card/quickAdd/detail
// sheet UI works unchanged.
router.get('/recommended', async (req, res) => {
  const products = await dbAll(`
    SELECT
      p.id, p.name, p.description, p.pos_price AS base_price,
      p.customer_max_qty, p.prep_time_minutes, p.is_fast_moving, p.badge,
      p.category_id, p.pos_station_id,
      c.name AS category_name, c.icon AS category_icon,
      ml.filename AS image_filename
    FROM   recommended_products rp
    JOIN   products p ON p.id = rp.product_id
    LEFT JOIN categories     c      ON c.id = p.category_id
    LEFT JOIN product_images pi_img ON pi_img.product_id = p.id AND pi_img.is_primary = 1
    LEFT JOIN media_library  ml     ON ml.id = pi_img.media_id
    WHERE  rp.is_active = 1 AND p.customer_visible = 1 AND p.pos_active = 1
    ORDER  BY rp.sort_order, rp.id
  `, []);

  await shapeProducts(products);

  res.json({ products });
});

// ── POST /api/customer/order ──────────────────────────────────────────────────
// One order per table session — additional submissions add new KOTs to the
// existing OPEN order for that table rather than creating a new order.
router.post('/order', async (req, res) => {
  const { table_id, customer_name, customer_phone, items, order_type } = req.body;

  const VALID_TYPES = ['DINE_IN', 'TAKEAWAY'];
  // If no explicit type, infer from context: table present → DINE_IN, else TAKEAWAY
  const type = VALID_TYPES.includes(order_type) ? order_type : (table_id ? 'DINE_IN' : 'TAKEAWAY');

  if (type === 'DINE_IN' && !table_id) return res.status(400).json({ error: 'table_id required for dine-in' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items required' });

  let table = null;
  if (table_id) {
    table = await dbGet(`SELECT * FROM pos_restaurant_tables WHERE id = ? AND is_active = 1`, [table_id]);
    if (!table) return res.status(404).json({ error: 'Table not found' });
  }

  // Validate + enrich every item
  const enriched = [];
  for (const item of items) {
    const product = await dbGet(
      `SELECT id, name, pos_price, prep_time_minutes, pos_station_id, customer_max_qty
       FROM   products WHERE id = ? AND customer_visible = 1 AND pos_active = 1`, [item.product_id]
    );
    if (!product) return res.status(400).json({ error: `Product ${item.product_id} not available` });

    let unitPrice   = product.pos_price;
    let variantId   = null;
    let variantName = null;

    if (item.variant_id) {
      const variant = await dbGet(
        `SELECT id, name, selling_price FROM product_variants
         WHERE  id = ? AND product_id = ? AND status = 'active'`, [item.variant_id, product.id]
      );
      if (!variant) return res.status(400).json({ error: `Variant not available for ${product.name}` });
      unitPrice   = variant.selling_price || product.pos_price;
      variantId   = variant.id;
      variantName = variant.name;
    }

    let modifierNames = [];
    if (Array.isArray(item.modifier_ids) && item.modifier_ids.length) {
      const ph   = item.modifier_ids.map(() => '?').join(',');
      const mods = await dbAll(
        `SELECT id, name, COALESCE(price, 0) AS price FROM shared_modifiers WHERE id IN (${ph})`, item.modifier_ids
      );
      unitPrice    += mods.reduce((s, m) => s + m.price, 0);
      modifierNames = mods.map(m => m.name);
    }

    const noteParts  = [item.notes?.trim(), modifierNames.length ? `Extras: ${modifierNames.join(', ')}` : ''].filter(Boolean);
    const finalNotes = noteParts.join(' | ') || null;

    const qty = Math.max(1, parseInt(item.quantity) || 1);
    if (product.customer_max_qty && qty > product.customer_max_qty) {
      return res.status(400).json({ error: `Max ${product.customer_max_qty} of "${product.name}" per order` });
    }

    enriched.push({
      ...product, quantity: qty,
      notes: finalNotes, modifier_names: modifierNames,
      unit_price: unitPrice, variant_id: variantId, variant_name: variantName,
    });
  }

  // Customer orders no longer punch straight to KDS — they land in the same
  // pending-approval queue as website orders (web_orders_pending, source
  // 'CUSTOMER_QR'); a POS user approves them, which is what actually creates/
  // appends the pos_orders + pos_kots row (see routes/pos/webOrders.js).
  const orderNumber = `QR-${Date.now().toString(36).toUpperCase()}`;
  const subtotal     = enriched.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const estimated    = Math.max(...enriched.map(i => i.prep_time_minutes || 15));

  const pendingId = await transaction(async (tx) => {
    const ins = await tx.dbRun(
      `INSERT INTO web_orders_pending
         (web_order_id, order_number, source, order_type, table_id, customer_name, customer_phone,
          items_json, subtotal, grand_total, ordered_at)
       VALUES (NULL, ?, 'CUSTOMER_QR', ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [orderNumber, type, table_id || null, customer_name?.trim() || null, customer_phone?.trim() || null,
       JSON.stringify(enriched), subtotal, subtotal]
    );
    const insId = ins.lastInsertRowid;
    let sort = 0;
    for (const item of enriched) {
      await tx.dbRun(
        `INSERT INTO web_order_items
           (pending_id, web_pid, kind, product_id, variant_id, item_name, variant_name,
            quantity, unit_price, line_total, modifiers_json, special_note, sort_order)
         VALUES (?, ?, 'product', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [insId, String(item.id), item.id, item.variant_id, item.name, item.variant_name,
         item.quantity, item.unit_price, item.unit_price * item.quantity,
         item.modifier_names.length ? JSON.stringify(item.modifier_names) : null,
         item.notes, sort++]
      );
    }
    return insId;
  });

  // Notify every open POS screen — same popup/sound/badge as a website order
  socketServer.emitWebOrderReceived({
    pendingId, webOrderId: null, orderNumber, orderType: type,
    customerName: customer_name?.trim() || '', customerPhone: customer_phone?.trim() || '',
    tableName: table?.name || null, grandTotal: subtotal, itemCount: enriched.length,
  });

  res.status(201).json({
    pending_id:        pendingId,
    status:            'PENDING_APPROVAL',
    order_type:        type,
    table_name:        table?.name || null,
    estimated_minutes: estimated,
    total:             subtotal,
    items:             enriched.map(i => ({
      name:           i.name,
      variant_name:   i.variant_name,
      modifier_names: i.modifier_names,
      qty:            i.quantity,
      price:          i.unit_price,
    })),
  });
});

// ── GET /api/customer/product/:id/modifiers ──────────────────────────────────
router.get('/product/:id/modifiers', async (req, res) => {
  const product = await dbGet(
    `SELECT id FROM products WHERE id = ? AND customer_visible = 1 AND pos_active = 1`, [req.params.id]
  );
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const mods = await dbAll(`
    SELECT sm.id, sm.name, COALESCE(sm.price, 0) AS price,
           mg.id AS group_id, mg.name AS group_name
    FROM   product_modifier_assignments pma
    JOIN   shared_modifiers sm ON sm.id = pma.modifier_id
    LEFT JOIN modifier_groups mg ON mg.id = sm.group_id
    WHERE  pma.product_id = ?
    ORDER  BY mg.sort_order, sm.name
  `, [req.params.id]);

  const groupMap = new Map();
  for (const m of mods) {
    const key = m.group_id ?? 0;
    if (!groupMap.has(key)) groupMap.set(key, { id: key, name: m.group_name || 'Extras', items: [] });
    groupMap.get(key).items.push({ id: m.id, name: m.name, price: m.price });
  }
  res.json([...groupMap.values()]);
});

// ── GET /api/customer/order/:id ───────────────────────────────────────────────
router.get('/order/:id', async (req, res) => {
  const order = await dbGet(
    `SELECT o.*, t.name AS table_name FROM pos_orders o
     LEFT JOIN pos_restaurant_tables t ON t.id = o.table_id
     WHERE o.id = ?`, [req.params.id]
  );
  if (!order) return res.status(404).json({ error: 'Not found' });

  const kots = await dbAll(`SELECT * FROM pos_kots WHERE order_id = ? ORDER BY created_at`, [order.id]);
  const ids   = kots.map(k => k.id);
  const items = ids.length
    ? await dbAll(`SELECT * FROM pos_kot_items WHERE kot_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids)
    : [];

  const byKot = {};
  for (const i of items) (byKot[i.kot_id] ??= []).push(i);
  for (const k of kots) k.items = byKot[k.id] || [];

  res.json({ order, kots });
});

// ── GET /api/customer/table/:tableId/orders ───────────────────────────────────
// Table ordering is shared (no per-customer login) — return every order currently
// open, or closed recently, for this table so any device scanning the QR sees the
// whole table's orders, not just the ones it personally placed.
router.get('/table/:tableId/orders', async (req, res) => {
  const orders = await dbAll(
    `SELECT o.*, t.name AS table_name FROM pos_orders o
     LEFT JOIN pos_restaurant_tables t ON t.id = o.table_id
     WHERE o.table_id = ? AND o.status = 'OPEN'
       AND o.created_at >= DATE_SUB(NOW(), INTERVAL 12 HOUR)
     ORDER BY o.created_at DESC`,
    [req.params.tableId]
  );
  if (!orders.length) return res.json({ orders: [] });

  const orderIds = orders.map(o => o.id);
  const ph1      = orderIds.map(() => '?').join(',');
  const kots     = await dbAll(`SELECT * FROM pos_kots WHERE order_id IN (${ph1})`, orderIds);
  const kotIds   = kots.map(k => k.id);
  const items    = kotIds.length
    ? await dbAll(
        `SELECT * FROM pos_kot_items WHERE kot_id IN (${kotIds.map(() => '?').join(',')}) AND status != 'CANCELLED' ORDER BY id`,
        kotIds
      )
    : [];

  const itemsByKot = {};
  for (const i of items) (itemsByKot[i.kot_id] ??= []).push(i);
  const kotsByOrder = {};
  for (const k of kots) (kotsByOrder[k.order_id] ??= []).push(k);

  const shaped = orders.map(o => ({
    order_id:   o.id,
    table_name: o.table_name,
    order_type: o.order_type,
    status:     o.status,
    placed_at:  o.created_at,
    total:      o.total_amount,
    items: (kotsByOrder[o.id] || []).flatMap(k => itemsByKot[k.id] || []).map(i => ({
      name: i.product_name, variant_name: null, qty: i.quantity, price: i.unit_price,
    })),
  }));

  // Orders still waiting on POS approval — no pos_orders row yet, so they're
  // pulled straight from the pending queue and shown with a distinct status.
  const pending = await dbAll(
    `SELECT id, order_type, customer_name, items_json, grand_total, ordered_at, status, reject_reason
     FROM web_orders_pending
     WHERE table_id = ? AND source = 'CUSTOMER_QR' AND status IN ('PENDING_APPROVAL','REJECTED')
       AND received_at >= DATE_SUB(NOW(), INTERVAL 12 HOUR)
     ORDER BY received_at DESC`,
    [req.params.tableId]
  );
  const shapedPending = pending.map(p => {
    let items = [];
    try { items = JSON.parse(p.items_json || '[]'); } catch {}
    return {
      order_id:      `pending-${p.id}`,
      pending_id:    p.id,
      order_type:    p.order_type,
      status:        p.status === 'REJECTED' ? 'CANCELLED' : 'PENDING_APPROVAL',
      reject_reason: p.reject_reason,
      placed_at:     p.ordered_at,
      total:         p.grand_total,
      items: items.map(i => ({ name: i.name, variant_name: i.variant_name, qty: i.quantity, price: i.unit_price })),
    };
  });

  res.json({ orders: [...shapedPending, ...shaped] });
});

// ── GET /api/customer/pending/:id — poll fallback for approval status ────────
router.get('/pending/:id', async (req, res) => {
  const row = await dbGet(
    `SELECT id, status, pos_order_id, reject_reason FROM web_orders_pending WHERE id = ? AND source = 'CUSTOMER_QR'`,
    [req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({
    pending_id: row.id, status: row.status,
    order_id: row.pos_order_id, reject_reason: row.reject_reason,
  });
});

module.exports = router;
