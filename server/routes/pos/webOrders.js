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

// CAKE-YYYY-NNNN — same numbering scheme as cakeOrders.js
async function nextCakeOrderNumber(tx) {
  const yr = new Date().getFullYear();
  const r = await tx.dbGet(
    `SELECT COALESCE(MAX(CAST(SUBSTR(order_number,-4) AS INTEGER)),0)+1 AS seq
     FROM cake_orders WHERE order_number LIKE ?`,
    [`CAKE-${yr}-%`]
  );
  return `CAKE-${yr}-${String(r.seq).padStart(4, '0')}`;
}

const parseCake = it => { try { return JSON.parse(it.cake_json || 'null') || {}; } catch { return {}; } };

// POST /api/pos/web-orders/:id/approve
// Food items → standard POS order + KOT (existing workflow: KDS/Waiter/printing).
// Cake items → a cake_orders booking (CONFIRMED, production 'New') so the cake
// production pipeline handles them — cakes are NEVER punched as KOT items.
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

    const cakeItems = items.filter(i => i.kind === 'cake');
    const foodItems = items.filter(i => i.kind !== 'cake');

    // Late re-resolution — products may have been added/renamed since import.
    // Cake items are exempt: they resolve against cake_designs, not products.
    const unmatched = [];
    for (const it of foodItems) {
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

    // ── Cake items → cake_orders booking ────────────────────────────────
    let cakeOrder = null;
    if (cakeItems.length) {
      const cakes = cakeItems.map(it => ({ it, c: parseCake(it) }));
      const cakeOnly = !foodItems.length;
      const today = new Date().toISOString().slice(0, 10);

      // earliest customer-requested time drives the production deadline
      const needed = cakes.map(x => String(x.c.neededAt || '')).filter(x => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(x)).sort()[0] || null;
      const messages = [...new Set(cakes.map(x => String(x.c.message || '').trim()).filter(Boolean))];
      const dietary = [...new Set(cakes.flatMap(x => Array.isArray(x.c.dietary) ? x.c.dietary : []))];
      const designNotes = cakes.map(({ it, c }) =>
        [c.design || it.item_name, c.size, c.flavour, c.cream,
         (Array.isArray(c.dietary) && c.dietary.length) ? c.dietary.join('/') : null,
         it.quantity > 1 ? `x${it.quantity}` : null].filter(Boolean).join(' · ')).join('\n');

      const internalBits = [`🌐 Web order ${wo.order_number}`,
        `${wo.order_type} · ${wo.payment_method} / ${wo.payment_status}`];
      if (cakeOnly && +wo.delivery_charge > 0) internalBits.push(`Delivery charge Rs.${+wo.delivery_charge} (collect on delivery)`);
      if (cakeOnly && wo.customer_address) internalBits.push(`Deliver to: ${[wo.customer_address, wo.landmark].filter(Boolean).join(' · ')}`);
      if (!cakeOnly) internalBits.push('Part of a mixed web order — food items are on the linked POS order');
      if (wo.customer_notes) internalBits.push(`Customer: ${wo.customer_notes}`);

      const cakeNumber = await nextCakeOrderNumber(tx);
      const ins = await tx.dbRun(`
        INSERT INTO cake_orders (
          order_number, phone, customer_name, order_date, delivery_date, delivery_time,
          message_on_cake, design_notes, dietary_notes, internal_notes,
          discount, advance_paid, advance_method, status, production_status, created_by
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,'CASH','CONFIRMED','New',?)`,
        [cakeNumber, wo.customer_phone || null, wo.customer_name || 'Web Customer',
         today, needed ? needed.slice(0, 10) : null, needed ? needed.slice(11, 16) : null,
         messages.join(' / ').slice(0, 255) || null, designNotes || null,
         dietary.join(', ') || null, internalBits.join(' | '),
         cakeOnly ? (+wo.discount || 0) : 0, req.posUser.id]);
      const cakeOrderId = ins.lastInsertRowid;

      let sort = 0;
      let cakeTotal = 0;
      for (const { it, c } of cakes) {
        cakeTotal += +it.line_total || 0;
        await tx.dbRun(
          `INSERT INTO cake_order_items (cake_order_id,product_id,variant_id,product_name,variant_name,size,unit,qty,rate,amount,sort_order)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [cakeOrderId, null, null, c.design || it.item_name,
           [c.flavour, c.cream].filter(Boolean).join(' · ') || null,
           c.size || null, 'PCS', it.quantity, +it.unit_price || 0, +it.line_total || 0, sort++]
        );
      }
      // rates already include all web-side surcharges — no modifier ids set,
      // so nothing double-counts; totals are simply items − discount
      const disc = cakeOnly ? (+wo.discount || 0) : 0;
      const grand = Math.max(0, cakeTotal - disc);
      await tx.dbRun(`UPDATE cake_orders SET cake_total=?, modifier_total=0, accessory_total=0, grand_total=?, balance_due=? WHERE id=?`,
        [cakeTotal, grand, grand, cakeOrderId]);

      await tx.dbRun(`INSERT INTO cake_order_status_history (cake_order_id,old_status,new_status,changed_by) VALUES (?,?,?,?)`,
        [cakeOrderId, null, 'PENDING', req.posUser.id]);
      await tx.dbRun(`INSERT INTO cake_order_status_history (cake_order_id,old_status,new_status,changed_by) VALUES (?,?,?,?)`,
        [cakeOrderId, 'PENDING', 'CONFIRMED', req.posUser.id]);

      cakeOrder = { id: cakeOrderId, order_number: cakeNumber };
    }

    // ── Food items → POS order + KOT (existing workflow) ────────────────
    let order = null, kot = null, maxPrepMin = 0;
    const savedItems = [];
    if (foodItems.length) {
      const orderType = wo.order_type === 'Delivery' ? 'DELIVERY' : 'TAKEAWAY';
      const noteBits = [`🌐 Web order ${wo.order_number}`];
      if (cakeOrder) noteBits.push(`🎂 + cake order ${cakeOrder.order_number}`);
      if (+wo.delivery_charge > 0) noteBits.push(`Delivery charge Rs.${+wo.delivery_charge}`);
      if (+wo.discount > 0) noteBits.push(`Web discount Rs.${+wo.discount} (apply at checkout)`);
      noteBits.push(`Web total Rs.${+wo.grand_total} · ${wo.payment_method} / ${wo.payment_status}`);
      if (wo.customer_notes) noteBits.push(`Customer: ${wo.customer_notes}`);

      order = await tx.dbGet(
        `INSERT INTO pos_orders
           (order_type, customer_name, customer_phone, customer_address, notes, status, punched_by)
         VALUES (?,?,?,?,?,'OPEN',?) RETURNING *`,
        [orderType, wo.customer_name, wo.customer_phone,
         [wo.customer_address, wo.landmark].filter(Boolean).join(' · ') || null,
         noteBits.join(' | '), req.posUser.id]
      );

      kot = await tx.dbGet(
        `INSERT INTO pos_kots (order_id, kot_number, punched_by) VALUES (?,1,?) RETURNING *`,
        [order.id, req.posUser.id]
      );

      for (const it of foodItems) {
        const prod = await tx.dbGet(`SELECT prep_time_minutes, pos_station_id FROM products WHERE id=?`, [it.product_id]);
        maxPrepMin = Math.max(maxPrepMin, prod?.prep_time_minutes ?? 10);
        const mods = (() => { try { return JSON.parse(it.modifiers_json || '[]'); } catch { return []; } })();
        const notes = [mods.length ? `➕ ${mods.join(', ')}` : '', it.special_note || ''].filter(Boolean).join(' · ') || null;
        // Stationless (water, delivery charge...) = auto-SERVED — KDS skips, web n/N intact
        const stationId = prod?.pos_station_id ?? null;
        savedItems.push(await tx.dbGet(
          `INSERT INTO pos_kot_items
             (kot_id, product_id, variant_id, product_name, quantity, unit_price, notes, prep_time_minutes, station_id, status, served_at)
           VALUES (?,?,?,?,?,?,?,?,?,?, IF(? IS NULL, NOW(), NULL)) RETURNING *`,
          [kot.id, it.product_id, it.variant_id ?? null,
           it.variant_name ? `${it.item_name} (${it.variant_name})` : it.item_name,
           it.quantity, it.unit_price, notes,
           prod?.prep_time_minutes ?? 10, stationId,
           stationId == null ? 'SERVED' : 'ORDERSENT',
           stationId]
        ));
        if (it.variant_id) {
          await tx.dbRun(`UPDATE product_variants SET sync_status = 0 WHERE id = ? AND show_online = 1`, [it.variant_id]);
        } else {
          await tx.dbRun(`UPDATE product_variants SET sync_status = 0 WHERE product_id = ? AND show_online = 1`, [it.product_id]);
        }
      }
    }

    await tx.dbRun(
      `UPDATE web_orders_pending
       SET status='APPROVED', pos_order_id=?, cake_order_id=?, approved_by=?, approved_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      [order ? order.id : null, cakeOrder ? cakeOrder.id : null, req.posUser.id, pendingId]);

    audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'WEB_ORDER', entityId: pendingId, action: 'APPROVE', delta: { order_number: wo.order_number, pos_order_id: order?.id ?? null, kot_id: kot?.id ?? null, cake_order_id: cakeOrder?.id ?? null, cake_order_number: cakeOrder?.order_number ?? null, itemCount: savedItems.length + cakeItems.length } });
    return { wo, order, kot: kot ? { ...kot, items: savedItems } : null, cakeOrder, maxPrepMin };
  });

  if (result.error) return res.status(result.code).json({ error: result.error });
  const { wo, order, kot, cakeOrder, maxPrepMin } = result;

  log(`approved ${wo.order_number} (pending #${pendingId})`
    + (order ? ` → POS order #${order.id}, KOT #${kot.id}` : '')
    + (cakeOrder ? ` → cake order ${cakeOrder.order_number} (#${cakeOrder.id})` : '')
    + ` by ${req.posUser.employee_id}`);

  // Existing notification pipeline: KDS + POS + Waiter (all join/listen on these rooms)
  let fullOrder = null;
  if (order) {
    kdsEvents.broadcast('new_kot', { orderId: order.id, kotId: kot.id });
    fullOrder = await buildFullOrder(order.id);
    if (fullOrder) socketServer.emitNewOrder(fullOrder);
    triggerStockSync();
  }
  // Cake production screens pick up the new confirmed booking
  if (cakeOrder) socketServer.emitCakeProductionChanged({ cake_order_id: cakeOrder.id, kind: 'status' });

  // Tell the website the customer's order was accepted — etaMinutes = slowest
  // item's prep time; the website adds its own buffer for the ETA display.
  webOrderBridge.sendStatus(wo.web_order_id, 'APPROVED',
    { posOrderId: order ? order.id : cakeOrder.id, etaMinutes: maxPrepMin || null });
  // Stationless items are auto-SERVED at insert — if that's the whole order,
  // this pushes READY immediately (KDS will never touch it)
  if (order) webOrderBridge.notifyKotItemProgress(order.id);

  res.json({
    ok: true,
    posOrderId: order ? order.id : null, kotId: kot ? kot.id : null, order: fullOrder,
    cakeOrderId: cakeOrder ? cakeOrder.id : null, cakeOrderNumber: cakeOrder ? cakeOrder.order_number : null,
  });
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
