'use strict';
// MTC Companion sync + live API. Feeds the Android caller-ID app:
//   • /caller-status  — ONE lightweight live call during a ringing phone.
//   • /sync/*         — background incremental pulls into the phone's Room DB.
// Everything the popup shows comes from Room; only active-order status is live.
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dbAll, dbGet, dbRun } = require('../../pos/db');       // POS DB (orders, kots, pos_customers, addresses)
const cmsDb = require('../../database/db');   // CMS DB (customers, menu, media, settings)
const { requireSession } = require('../../middleware/posAuth');

const router = express.Router();
router.use(requireSession);

const FORAPP_DIR = path.join(__dirname, '..', '..', 'uploads', 'forapp');

function normalizePhone(phone) {
  return String(phone || '').replace(/[\s\-]/g, '').replace(/^\+?977/, '').replace(/^0+/, '');
}
function basename(p) {
  return p ? String(p).split(/[\\/]/).pop() : null;
}
// forapp export stores every product/variant image as .webp (same hash stem as
// the DB's .jpg/.png record) — match on the webp stem, not the raw DB filename.
function toWebp(p) {
  const b = basename(p);
  return b ? b.replace(/\.[^.]+$/, '.webp') : null;
}

// ── LIVE: caller status (single lightweight request during a call) ──
router.get('/caller-status', async (req, res) => {
  const normPhone = normalizePhone(req.query.phone);
  if (!normPhone) return res.status(400).json({ error: 'phone required' });

  const [crmCustomer, posCustomer, activeOrder, cakeBalRow] = await Promise.all([
    cmsDb.dbGet(`SELECT phone, name, loyalty_points, rewards_tier, updated_at FROM customers WHERE phone=?`, [normPhone]),
    dbGet(`SELECT id, name FROM pos_customers WHERE phone=?`, [normPhone]),
    dbGet(`SELECT o.id, o.status, o.total_amount, o.paid_amount, o.updated_at
             FROM pos_orders o WHERE o.customer_phone=? AND o.status IN ('OPEN','SAVED')
               AND (EXISTS (SELECT 1 FROM pos_kots k
                              JOIN pos_kot_items ki ON ki.kot_id = k.id
                             WHERE k.order_id = o.id AND ki.status <> 'CANCELLED')
                    OR (o.draft_items IS NOT NULL
                        AND TRIM(o.draft_items) NOT IN ('', '[]', 'null')))
             ORDER BY o.updated_at DESC LIMIT 1`, [normPhone]),
    dbGet(`SELECT COALESCE(SUM(balance_due),0) AS bal FROM cake_orders
             WHERE phone=? AND balance_due>0 AND status NOT IN ('DELIVERED','CANCELLED','REFUNDED')`, [normPhone]),
  ]);

  const total = Number(activeOrder?.total_amount ?? 0);
  const paid = Number(activeOrder?.paid_amount ?? 0);

  // Kitchen/serve lifecycle for the active order — powers the popup's
  // "Sent to kitchen · Preparing · Xm ago" / "Served · packed, ready" line.
  let lifecycle = null;
  if (activeOrder) {
    const k = await dbGet(
      `SELECT MIN(k.created_at) AS sent_at,
              TIMESTAMPDIFF(MINUTE, MIN(k.created_at), NOW()) AS elapsed_min,
              COUNT(ki.id)                       AS items_total,
              SUM(ki.status='SERVED')            AS items_served,
              SUM(ki.status='READY')             AS items_ready,
              SUM(ki.status='ORDERSENT')         AS items_preparing
         FROM pos_kots k JOIN pos_kot_items ki ON ki.kot_id = k.id
        WHERE k.order_id = ? AND ki.status <> 'CANCELLED'`, [activeOrder.id]);
    const itemsTotal = Number(k?.items_total ?? 0);
    const served = Number(k?.items_served ?? 0);
    const ready = Number(k?.items_ready ?? 0);
    const stage = itemsTotal > 0 && served === itemsTotal ? 'SERVED'
      : itemsTotal > 0 && served + ready === itemsTotal && ready > 0 ? 'READY'
        : 'PREPARING';
    lifecycle = {
      stage,                                   // PREPARING | READY | SERVED
      sentAt: k?.sent_at ?? null,              // Nepal local time
      elapsedMin: Number(k?.elapsed_min ?? 0),
      itemsTotal, itemsServed: served, itemsReady: ready,
    };
  }

  // Per-item line list for the popup — client resolves each product's image
  // locally from its already-synced menu cache, keyed by productId.
  const items = activeOrder ? await dbAll(
    `SELECT ki.product_id AS productId, ki.product_name AS name, ki.quantity, ki.status
       FROM pos_kots k JOIN pos_kot_items ki ON ki.kot_id = k.id
      WHERE k.order_id = ? AND ki.status <> 'CANCELLED'
      ORDER BY ki.id`, [activeOrder.id]
  ) : [];

  res.json({
    phone: normPhone,
    customerExists: !!(crmCustomer || posCustomer),
    activeOrder: activeOrder ? {
      id: activeOrder.id,
      status: activeOrder.status,
      total,
      balance: Math.max(0, total - paid),
      stage: lifecycle?.stage ?? null,
      sentAt: lifecycle?.sentAt ?? null,
      elapsedMin: lifecycle?.elapsedMin ?? 0,
      itemsTotal: lifecycle?.itemsTotal ?? 0,
      itemsServed: lifecycle?.itemsServed ?? 0,
      itemsReady: lifecycle?.itemsReady ?? 0,
      items,
    } : null,
    cakeBalance: Number(cakeBalRow?.bal ?? 0),
    loyaltyPoints: crmCustomer?.loyalty_points ?? 0,
    rewardsTier: crmCustomer?.rewards_tier ?? 'standard',
    lastUpdated: activeOrder?.updated_at ?? crmCustomer?.updated_at ?? null,
  });
});

// ── Save a new customer captured on the phone after a call ends ──
// Upserts pos_customers by phone; logs a note. Used by the app's post-call
// "New Customer" capture form (phone auto-filled, name/notes typed).
router.post('/customer', express.json(), async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!phone) return res.status(400).json({ error: 'phone required' });
  const name = (req.body.name || '').trim() || phone;   // name column is NOT NULL
  const notes = (req.body.notes || '').trim() || null;

  await dbRun(
    `INSERT INTO pos_customers (name, phone, notes) VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE
         name  = IF(VALUES(name) <> phone, VALUES(name), name),
         notes = COALESCE(VALUES(notes), notes)`,
    [name, phone, notes]
  );
  if (notes) await dbRun(`INSERT INTO pos_customer_notes (phone, note) VALUES (?,?)`, [phone, notes]);

  // New number, not yet in CRM (cms customers) — mirror it there too.
  const crmExisting = await cmsDb.dbGet(`SELECT phone FROM customers WHERE phone=?`, [phone]);
  if (!crmExisting) {
    await cmsDb.dbRun(`INSERT INTO customers (phone, name, notes) VALUES (?,?,?)`, [phone, name, notes]);
  }

  res.json({ ok: true, phone });
});

// ── SYNC: customers (incremental via updated_at) + their addresses ──
router.get('/sync/customers', async (req, res) => {
  const since = req.query.since || '1970-01-01 00:00:00';
  const customers = await cmsDb.dbAll(
    `SELECT phone, name, phone2, address, birthday, email, loyalty_points, rewards_tier,
            discount, status, updated_at
       FROM customers WHERE updated_at > ? ORDER BY updated_at ASC`, [since]
  );
  // Addresses lack updated_at — return those for changed customers, plus any created since.
  const phones = customers.map(c => c.phone);
  let addresses = [];
  if (phones.length) {
    addresses = await dbAll(
      `SELECT id, phone, label, address, is_default, created_at
         FROM pos_customer_addresses
        WHERE phone IN (${phones.map(() => '?').join(',')}) OR created_at > ?`,
      [...phones, since]
    );
  } else {
    addresses = await dbAll(`SELECT id, phone, label, address, is_default, created_at
                               FROM pos_customer_addresses WHERE created_at > ?`, [since]);
  }
  res.json({ serverTime: new Date().toISOString(), customers, addresses });
});

// ── SYNC: top-3 favorite products per customer (for popup State 2) ──
router.get('/sync/favorites', async (_req, res) => {
  const rows = await dbAll(
    `SELECT o.customer_phone AS phone, ki.product_id, MAX(ki.product_name) AS product_name,
            SUM(ki.quantity) AS qty
       FROM pos_orders o
       JOIN pos_kots k     ON k.order_id = o.id
       JOIN pos_kot_items ki ON ki.kot_id = k.id
      WHERE o.customer_phone IS NOT NULL AND o.customer_phone <> '' AND ki.status <> 'CANCELLED'
      GROUP BY o.customer_phone, ki.product_id
      ORDER BY o.customer_phone, qty DESC`
  );
  const byPhone = {};
  for (const r of rows) {
    const p = normalizePhone(r.phone);
    if (!byPhone[p]) byPhone[p] = [];
    if (byPhone[p].length < 3) {
      byPhone[p].push({ productId: r.product_id, name: r.product_name, count: Number(r.qty) });
    }
  }
  const favorites = Object.entries(byPhone).map(([phone, items]) => ({ phone, items }));
  res.json({ favorites });
});

// ── SYNC: full menu bundle (tables lack updated_at → versioned full pull) ──
router.get('/sync/menu', async (req, res) => {
  const [pv, cv, vv, mv] = await Promise.all([
    cmsDb.dbGet(`SELECT COUNT(*) n, COALESCE(MAX(created_at),0) m FROM products`),
    cmsDb.dbGet(`SELECT COUNT(*) n, 0 m FROM categories`),
    cmsDb.dbGet(`SELECT COUNT(*) n, COALESCE(MAX(created_at),0) m FROM product_variants`),
    cmsDb.dbGet(`SELECT COUNT(*) n, COALESCE(MAX(created_at),0) m FROM media_library`),
  ]);
  const version = crypto.createHash('md5')
    .update(`${pv.n}:${pv.m}|${cv.n}|${vv.n}:${vv.m}|${mv.n}:${mv.m}`).digest('hex');
  if (req.query.version && req.query.version === version) {
    return res.json({ changed: false, version });
  }

  const [categories, products, variants, modifierGroups, modifiers, assignments, images] = await Promise.all([
    cmsDb.dbAll(`SELECT c.id, c.name, c.slug, c.sort_order, c.status, c.icon,
                        ml.filename AS image_url
                   FROM categories c LEFT JOIN media_library ml ON ml.id = c.image_id
                  ORDER BY c.sort_order, c.id`),
    cmsDb.dbAll(`SELECT id, category_id, name, short_description, pos_price, prep_time_minutes,
                        is_fast_moving, pos_active, customer_visible, badge, enable_variant_image, status, sort_order
                   FROM products WHERE pos_active=1 ORDER BY sort_order, id`),
    cmsDb.dbAll(`SELECT v.id, v.product_id, v.name, v.sku, v.selling_price, v.unit, v.status, v.sort_order,
                        v.image_id, ml.filename AS image_url
                   FROM product_variants v LEFT JOIN media_library ml ON ml.id = v.image_id
                  ORDER BY v.product_id, v.sort_order, v.id`),
    cmsDb.dbAll(`SELECT id, name, sort_order FROM modifier_groups ORDER BY sort_order, id`),
    cmsDb.dbAll(`SELECT id, group_id, name, price, sort_order, is_active FROM shared_modifiers ORDER BY group_id, sort_order`),
    cmsDb.dbAll(`SELECT id, product_id, modifier_id FROM product_modifier_assignments`),
    cmsDb.dbAll(`SELECT pi.product_id, ml.filename, pi.is_primary, pi.sort_order
                   FROM product_images pi JOIN media_library ml ON ml.id = pi.media_id
                  ORDER BY pi.product_id, pi.is_primary DESC, pi.sort_order`),
  ]);
  // Emit the webp stem so filenames line up with the on-disk forapp cache.
  const imagesWebp = images.map(i => ({ ...i, filename: toWebp(i.filename) }));
  const categoriesOut = categories.map(c => ({ ...c, image_file: toWebp(c.image_url) }));
  res.json({ changed: true, version, categories: categoriesOut, products, variants, modifierGroups, modifiers, assignments, images: imagesWebp });
});

// ── SYNC: image manifest (only product/variant/category files present in forapp) ──
router.get('/sync/images', async (_req, res) => {
  let onDisk = [];
  try { onDisk = fs.readdirSync(FORAPP_DIR); } catch { onDisk = []; }
  const diskSet = new Set(onDisk);

  const [prodImgs, varImgs, catImgs] = await Promise.all([
    cmsDb.dbAll(`SELECT ml.filename FROM product_images pi JOIN media_library ml ON ml.id = pi.media_id`),
    cmsDb.dbAll(`SELECT ml.filename
                   FROM product_variants pv JOIN media_library ml ON ml.id = pv.image_id`),
    cmsDb.dbAll(`SELECT ml.filename AS image_url
                   FROM categories c JOIN media_library ml ON ml.id = c.image_id`),
  ]);

  const wanted = new Set();
  for (const r of prodImgs) if (r.filename) wanted.add(toWebp(r.filename));
  for (const r of catImgs) if (r.image_url) wanted.add(toWebp(r.image_url));
  for (const r of varImgs) if (r.filename) wanted.add(toWebp(r.filename));

  const manifest = [];
  for (const name of wanted) {
    if (!diskSet.has(name)) continue;               // only files actually exported to forapp
    let size = 0;
    try { size = fs.statSync(path.join(FORAPP_DIR, name)).size; } catch { /* skip */ }
    manifest.push({ filename: name, size, url: `/uploads/forapp/${name}` });
  }
  res.json({ count: manifest.length, images: manifest });
});

// ── SYNC: settings (receipt config + live store hours for sync scheduling) ──
router.get('/settings', async (_req, res) => {
  const [config, schedule] = await Promise.all([
    cmsDb.dbAll(`SELECT \`key\`, value FROM receipt_config`),
    cmsDb.dbAll(`SELECT day_of_week, day_name, is_open, open_time, close_time FROM live_store_schedule ORDER BY day_of_week`),
  ]);
  const settings = {};
  for (const r of config) settings[r.key] = r.value;
  res.json({ settings, storeSchedule: schedule });
});

module.exports = router;
