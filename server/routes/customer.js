'use strict';
const express      = require('express');
const { dbAll, dbGet, dbRun, transaction } = require('../pos/db');
const socketServer = require('../pos/socketServer');

const router = express.Router();

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
      p.customer_max_qty, p.prep_time_minutes, p.is_fast_moving,
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

  // Attach variants to each product
  if (products.length) {
    const ids = products.map(p => p.id);
    const ph  = ids.map(() => '?').join(',');
    const variants = await dbAll(`
      SELECT id, product_id, name, COALESCE(selling_price, 0) AS price, sort_order
      FROM   product_variants
      WHERE  product_id IN (${ph}) AND status = 'active'
      ORDER  BY sort_order, id
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
  }

  res.json({ table, categories, products });
});

// ── POST /api/customer/order ──────────────────────────────────────────────────
// One order per table session — additional submissions add new KOTs to the
// existing OPEN order for that table rather than creating a new order.
router.post('/order', async (req, res) => {
  const { table_id, customer_name, items, order_type } = req.body;

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

  // For DINE_IN: find an existing OPEN order on this table → append KOTs to it.
  // For TAKEAWAY: always create a fresh order (no session grouping).
  let existingOrder = null;
  if (table_id && type === 'DINE_IN') {
    existingOrder = await dbGet(
      `SELECT * FROM pos_orders WHERE table_id = ? AND status = 'OPEN' ORDER BY created_at DESC LIMIT 1`, [table_id]
    );
  }

  const result = await transaction(async (tx) => {
    let order;
    let isNewOrder = false;

    if (existingOrder) {
      order = existingOrder;
    } else {
      order = await tx.dbGet(`
        INSERT INTO pos_orders (order_type, table_id, customer_name, status, punched_by)
        VALUES (?, ?, ?, 'OPEN', NULL) RETURNING *
      `, [type, table_id || null, customer_name?.trim() || null]);
      isNewOrder = true;
    }

    // Next KOT number for this order
    const { mx } = await tx.dbGet(`SELECT COALESCE(MAX(kot_number), 0) AS mx FROM pos_kots WHERE order_id = ?`, [order.id]);
    let kotNum = mx + 1;

    // Group by station → one KOT per station
    const byStation = {};
    for (const item of enriched) {
      const key = item.pos_station_id ?? 'general';
      (byStation[key] ??= []).push(item);
    }

    const newKots = [];
    for (const stationItems of Object.values(byStation)) {
      const kot = await tx.dbGet(`
        INSERT INTO pos_kots (order_id, kot_number, status, punched_by)
        VALUES (?, ?, 'ORDERSENT', NULL) RETURNING *
      `, [order.id, kotNum++]);

      const kotItems = [];
      for (const item of stationItems) {
        const ki = await tx.dbGet(`
          INSERT INTO pos_kot_items
            (kot_id, product_id, product_name, quantity, unit_price,
             notes, station_id, prep_time_minutes, status, variant_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ORDERSENT', ?) RETURNING *
        `, [
          kot.id, item.id, item.name, item.quantity, item.unit_price,
          item.notes ?? null, item.pos_station_id ?? null,
          item.prep_time_minutes ?? 10, item.variant_id ?? null
        ]);
        kotItems.push(ki);
      }
      newKots.push({ ...kot, items: kotItems });
    }

    // For new orders: set initial total (trigger also recalculates, this is belt-and-braces)
    if (isNewOrder) {
      const total = enriched.reduce((s, i) => s + i.unit_price * i.quantity, 0);
      await tx.dbRun(`UPDATE pos_orders SET total_amount = ? WHERE id = ?`, [total, order.id]);
    }
    // For existing orders: the trg_pos_recalc_insert trigger recalculates automatically.

    return { order: { ...order, table_name: table?.name || null }, newKots, isNewOrder };
  });

  // Re-read total after trigger has fired (existing order total is recalculated by trigger)
  const finalTotal = (await dbGet(`SELECT total_amount FROM pos_orders WHERE id = ?`, [result.order.id]))?.total_amount || 0;

  // Build full order payload: KDS ORDER_UPSERT needs ALL kots for an existing order
  let socketPayload;
  if (result.isNewOrder) {
    socketPayload = { ...result.order, total_amount: finalTotal, kots: result.newKots, source: 'customer_qr' };
  } else {
    const allKots  = await dbAll(`SELECT * FROM pos_kots WHERE order_id = ? ORDER BY created_at`, [result.order.id]);
    const kotIds   = allKots.map(k => k.id);
    const allItems = kotIds.length
      ? await dbAll(`SELECT * FROM pos_kot_items WHERE kot_id IN (${kotIds.map(() => '?').join(',')}) ORDER BY id`, kotIds)
      : [];
    const byKot = {};
    for (const it of allItems) (byKot[it.kot_id] ??= []).push(it);
    for (const k of allKots) k.items = byKot[k.id] || [];

    const freshOrder = await dbGet(`SELECT * FROM pos_orders WHERE id = ?`, [result.order.id]);
    socketPayload = { ...freshOrder, table_name: table?.name || null, kots: allKots, source: 'customer_qr' };
  }

  // Notify KDS + POS. For a new KOT on an existing order this upserts the order in KDS.
  socketServer.emitNewOrder(socketPayload);

  const thisKotTotal = enriched.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const estimated    = Math.max(...enriched.map(i => i.prep_time_minutes || 15));

  res.status(201).json({
    order_id:          result.order.id,
    is_new_order:      result.isNewOrder,
    order_type:        type,
    table_name:        table?.name || null,
    estimated_minutes: estimated,
    total:             thisKotTotal,   // cost of this submission only
    order_total:       finalTotal,     // running bill total for the whole order
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

module.exports = router;
