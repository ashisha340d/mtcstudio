'use strict';
// ─────────────────────────────────────────────────────────────
//  Food Menu API — enhanced product data for AG Grid editor
//  Uses MariaDB (same connection as POS)
// ─────────────────────────────────────────────────────────────
const express = require('express');
const { dbAll, dbGet, dbRun, transaction } = require('../../pos/db');
const menuVersion = require('../../pos/menuVersion');

const router = express.Router();

// Any successful write to menu data bumps the version and notifies POS clients
router.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  res.on('finish', () => { if (res.statusCode < 400) menuVersion.bump(); });
  next();
});

// GET /api/food-menu/version — cache validation stamp for POS clients
router.get('/version', (req, res) => res.json({ version: menuVersion.get() }));

// GET /api/food-menu/categories
router.get('/categories', async (req, res) => {
  const cats = await dbAll(
    `SELECT c.id, c.name, c.sort_order,
            COUNT(p.id) AS product_count
     FROM   categories c
     LEFT JOIN products p ON p.category_id = c.id AND p.status = 'active'
     WHERE  c.status = 'active'
     GROUP  BY c.id
     ORDER  BY c.sort_order, c.name`
  );
  res.json(cats);
});

// Storefront categories shared list
const STOREFRONT_CATEGORIES = [
  'Ready Made Cakes', 'Pastries', 'Muffins', 'Cookies',
  'Bread', 'Desserts', "Today's Specials",
];

router.get('/storefront-categories', (req, res) => res.json(STOREFRONT_CATEGORIES));

// GET /api/food-menu/stations — for POS station assignment dropdown
router.get('/stations', async (req, res) => {
  res.json(await dbAll(`SELECT * FROM pos_stations ORDER BY sort_order, name`));
});

// GET /api/food-menu/badges — PRODUCT_BADGE lookup rows
router.get('/badges', async (req, res) => {
  res.json(await dbAll(
    `SELECT * FROM lookup_master WHERE lookup_type = 'PRODUCT_BADGE' ORDER BY sort_order, name`
  ));
});

// GET /api/food-menu/products?categoryId=1
router.get('/products', async (req, res) => {
  const { categoryId } = req.query;
  const where = categoryId ? 'WHERE p.category_id = ?' : '';
  const params = categoryId ? [categoryId] : [];

  const products = await dbAll(
    `SELECT
       p.id, p.name, p.category_id, p.status, p.featured, p.sort_order,
       p.pos_price, p.prep_time_minutes, p.is_fast_moving, p.pos_station_id, p.pos_active,
       p.badge, p.storefront_category,
       c.name AS category_name,
       s.name AS station_name,
       (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id AND v.status = 'active') AS variant_count,
       (SELECT MIN(v.selling_price) FROM product_variants v WHERE v.product_id = p.id AND v.status = 'active') AS min_price,
       (SELECT MAX(v.selling_price) FROM product_variants v WHERE v.product_id = p.id AND v.status = 'active') AS max_price,
       (SELECT pi.filename FROM product_images pi2
        JOIN media_library pi ON pi.id = pi2.media_id
        WHERE pi2.product_id = p.id AND pi2.is_primary = 1
        LIMIT 1) AS primary_image,
       (SELECT GROUP_CONCAT(v.name SEPARATOR '|') FROM product_variants v
        WHERE v.product_id = p.id AND v.status = 'active') AS variant_names
     FROM   products p
     LEFT JOIN categories   c ON c.id = p.category_id
     LEFT JOIN pos_stations s ON s.id = p.pos_station_id
     ${where}
     ORDER  BY c.sort_order, p.sort_order, p.name`,
    params
  );

  // 30-day units sold — POS search ranks best sellers higher
  const sold = await dbAll(
    `SELECT ki.product_id, SUM(ki.quantity) AS qty
     FROM   pos_kot_items ki
     JOIN   pos_kots   k ON k.id = ki.kot_id
     JOIN   pos_orders o ON o.id = k.order_id
     WHERE  o.status = 'CLOSED' AND ki.status != 'CANCELLED' AND ki.is_combo_child = 0
       AND  o.created_at >= NOW() - INTERVAL 30 DAY
     GROUP  BY ki.product_id`
  );
  const soldBy = new Map(sold.map(r => [r.product_id, Number(r.qty) || 0]));
  for (const p of products) p.sold_30d = soldBy.get(p.id) || 0;

  res.json(products);
});

// GET /api/food-menu/products/:id  — single product (one product → one primary image)
router.get('/products/:id', async (req, res) => {
  const product = await dbGet(
    `SELECT
       p.id, p.name, p.category_id, p.status, p.pos_price, p.pos_active, p.badge,
       c.name AS category_name,
       (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id AND v.status = 'active') AS variant_count,
       (SELECT pi.filename FROM product_images pi2
        JOIN media_library pi ON pi.id = pi2.media_id
        WHERE pi2.product_id = p.id AND pi2.is_primary = 1
        LIMIT 1) AS primary_image
     FROM   products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE  p.id = ?`,
    [req.params.id]
  );
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

// PATCH /api/food-menu/products/:id  — inline save from AG Grid
router.patch('/products/:id', async (req, res) => {
  const allowed = ['pos_price','prep_time_minutes','is_fast_moving','pos_station_id','pos_active','featured','sort_order','status','name','storefront_category'];
  const body    = req.body;
  const fields  = Object.keys(body).filter(k => allowed.includes(k));
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

  const values = fields.map(f => body[f]);
  values.push(req.params.id);
  await dbRun(`UPDATE products SET ${fields.map(f => `${f}=?`).join(',')} WHERE id=?`, values);
  res.json({ ok: true });
});

// POST /api/food-menu/products  — create new product
router.post('/products', async (req, res) => {
  const { name, category_id, pos_price = 0, prep_time_minutes = null, status = 'active' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();

  const product = await transaction(async (tx) => {
    const p = await tx.dbGet(
      `INSERT INTO products (name, slug, category_id, pos_price, prep_time_minutes, status, pos_active)
       VALUES (?,?,?,?,?,?,1) RETURNING id`,
      [name.trim(), slug, category_id ?? null, pos_price, prep_time_minutes, status]
    );
    await tx.dbRun(
      `INSERT INTO product_variants (product_id, name, selling_price) VALUES (?, 'Regular', ?)`,
      [p.id, pos_price]
    );
    return p;
  });

  res.status(201).json(product);
});

// DELETE /api/food-menu/products/:id  — delete product
router.delete('/products/:id', async (req, res) => {
  await dbRun(`DELETE FROM products WHERE id=?`, [req.params.id]);
  res.json({ ok: true });
});

// DELETE /api/food-menu/variants/:id  — delete variant
router.delete('/variants/:id', async (req, res) => {
  await dbRun(`DELETE FROM product_variants WHERE id=?`, [req.params.id]);
  res.json({ ok: true });
});

// POST /api/food-menu/products/bulk  — batch save all dirty rows
router.post('/products/bulk', async (req, res) => {
  const { rows } = req.body; // [{ id, ...fields }]
  if (!rows?.length) return res.status(400).json({ error: 'rows required' });

  const allowed = ['pos_price','prep_time_minutes','is_fast_moving','pos_station_id','pos_active','featured','sort_order','status','name','storefront_category'];

  await transaction(async (tx) => {
    for (const row of rows) {
      const { id, ...rest } = row;
      const fields = Object.keys(rest).filter(k => allowed.includes(k));
      if (!fields.length || !id) continue;
      const values = [...fields.map(f => rest[f]), id];
      await tx.dbRun(`UPDATE products SET ${fields.map(f => `${f}=?`).join(',')} WHERE id=?`, values);
    }
  });

  res.json({ ok: true, saved: rows.length });
});

// GET /api/food-menu/products/:id/variants  — ALL variants (active + inactive)
// GET /api/food-menu/flagged-variants — variants tagged Auto Entry / Check on Bill
// (POS table orders: auto_entry rows pre-fill the cart, check_on_bill rows are
// verified present on the bill at checkout)
router.get('/flagged-variants', async (req, res) => {
  const rows = await dbAll(
    `SELECT v.id, v.product_id, v.name AS variant_name, v.selling_price,
            v.auto_entry, v.check_on_bill, p.name AS product_name
     FROM   product_variants v
     JOIN   products p ON p.id = v.product_id
     WHERE  (v.auto_entry = 1 OR v.check_on_bill = 1)
       AND  v.status = 'active' AND p.status = 'active'`
  );
  res.json(rows);
});

router.get('/products/:id/variants', async (req, res) => {
  const variants = await dbAll(
    `SELECT id, product_id, name, sku, selling_price, cost_price, stock, unit, status, sort_order, show_online, sync_status
     FROM   product_variants
     WHERE  product_id = ?
     ORDER  BY sort_order, id`,
    [req.params.id]
  );
  res.json(variants);
});

// Sync pos_price to match the single active variant's selling_price
async function syncSingleVariantPrice(productId) {
  const { c } = await dbGet(
    `SELECT COUNT(*) AS c FROM product_variants WHERE product_id=? AND status='active'`,
    [productId]
  );
  if (c !== 1) return;
  const v = await dbGet(
    `SELECT selling_price FROM product_variants WHERE product_id=? AND status='active' LIMIT 1`,
    [productId]
  );
  if (v) await dbRun(`UPDATE products SET pos_price=? WHERE id=?`, [v.selling_price, productId]);
}

// PATCH /api/food-menu/variants/:id  — inline cell edit save
router.patch('/variants/:id', async (req, res) => {
  const allowed = ['name','sku','selling_price','cost_price','stock','unit','status','sort_order','show_online'];
  const fields  = Object.keys(req.body).filter(k => allowed.includes(k));
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  await dbRun(`UPDATE product_variants SET ${fields.map(f=>`${f}=?`).join(',')} WHERE id=?`,
    [...fields.map(f => req.body[f]), req.params.id]);
  const row = await dbGet(`SELECT product_id FROM product_variants WHERE id=?`, [req.params.id]);
  if (row) await syncSingleVariantPrice(row.product_id);
  res.json({ ok: true });
});

// POST /api/food-menu/variants/bulk  — batch save dirty variant rows
router.post('/variants/bulk', async (req, res) => {
  const { rows } = req.body;
  if (!rows?.length) return res.status(400).json({ error: 'rows required' });
  const allowed = ['name','sku','selling_price','cost_price','stock','unit','status','sort_order','show_online'];
  const affectedProductIds = new Set();
  await transaction(async (tx) => {
    for (const row of rows) {
      const { id, ...rest } = row;
      const fields = Object.keys(rest).filter(k => allowed.includes(k));
      if (!fields.length || !id) continue;
      await tx.dbRun(`UPDATE product_variants SET ${fields.map(f=>`${f}=?`).join(',')} WHERE id=?`,
        [...fields.map(f => rest[f]), id]);
      const v = await tx.dbGet(`SELECT product_id FROM product_variants WHERE id=?`, [id]);
      if (v) affectedProductIds.add(v.product_id);
    }
  });
  for (const pid of affectedProductIds) await syncSingleVariantPrice(pid);
  res.json({ ok: true, saved: rows.length });
});

// POST /api/food-menu/products/:id/variants  — add new variant
router.post('/products/:id/variants', async (req, res) => {
  const { name, selling_price = 0, cost_price = 0, sku, stock = 0, unit, show_online = 0 } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const result = await dbGet(
    `INSERT INTO product_variants (product_id,name,selling_price,cost_price,sku,stock,unit,show_online) VALUES (?,?,?,?,?,?,?,?) RETURNING *`,
    [req.params.id, name.trim(), selling_price, cost_price, sku??null, stock, unit??null, show_online ? 1 : 0]
  );
  res.status(201).json(result);
});

// GET /api/food-menu/products/:id/modifiers  — returns ASSIGNED shared modifiers (new system)
// Falls back to legacy pos_modifiers if no assignments exist (backward-compat)
router.get('/products/:id/modifiers', async (req, res) => {
  const assigned = await dbAll(`
    SELECT sm.id, sm.name, sm.price, sm.sort_order,
           mg.id AS group_id, mg.name AS group_name
    FROM   product_modifier_assignments pma
    JOIN   shared_modifiers sm ON sm.id = pma.modifier_id
    LEFT JOIN modifier_groups mg ON mg.id = sm.group_id
    WHERE  pma.product_id = ? AND sm.is_active = 1
    ORDER  BY mg.sort_order, mg.name, sm.sort_order, sm.name
  `, [req.params.id]);

  if (assigned.length > 0) return res.json(assigned);

  // Legacy fallback
  const legacy = await dbAll(
    `SELECT * FROM pos_modifiers WHERE product_id = ? AND is_active = 1 ORDER BY sort_order, id`,
    [req.params.id]
  );
  res.json(legacy);
});

// POST /api/food-menu/products/:id/modifiers
router.post('/products/:id/modifiers', async (req, res) => {
  const { name, price = 0, sort_order = 0 } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const row = await dbGet(
    `INSERT INTO pos_modifiers (product_id,name,price,sort_order) VALUES (?,?,?,?) RETURNING *`,
    [req.params.id, name, price, sort_order]
  );
  res.status(201).json(row);
});

router.patch('/modifiers/:id', async (req, res) => {
  const { name, price, is_active } = req.body;
  const mod = await dbGet(`SELECT * FROM pos_modifiers WHERE id=?`, [req.params.id]);
  if (!mod) return res.status(404).json({ error: 'Not found' });
  await dbRun(`UPDATE pos_modifiers SET name=?,price=?,is_active=? WHERE id=?`,
    [name ?? mod.name, price ?? mod.price, is_active ?? mod.is_active, mod.id]);
  res.json({ ok: true });
});

router.delete('/modifiers/:id', async (req, res) => {
  await dbRun(`UPDATE pos_modifiers SET is_active=0 WHERE id=?`, [req.params.id]);
  res.json({ ok: true });
});

// ── Modifier Assignment (shared modifiers ↔ products) ─────────

// ── Modifier Groups CRUD ─────────────────────────────────────
router.get('/modifier-groups', async (req, res) => {
  const groups = await dbAll(`SELECT * FROM modifier_groups ORDER BY sort_order, name`);
  const mods   = await dbAll(`
    SELECT * FROM shared_modifiers WHERE is_active=1 ORDER BY sort_order, name
  `);
  res.json(groups.map(g => ({ ...g, modifiers: mods.filter(m => m.group_id === g.id) })));
});

router.post('/modifier-groups', async (req, res) => {
  const { name, sort_order = 0 } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  try {
    const row = await dbGet(
      `INSERT INTO modifier_groups (name, sort_order) VALUES (?,?) RETURNING *`,
      [name.trim(), sort_order]
    );
    res.status(201).json(row);
  } catch { res.status(409).json({ error: 'Group name already exists' }); }
});

router.put('/modifier-groups/:id', async (req, res) => {
  const { name, sort_order } = req.body;
  const row = await dbGet(`SELECT * FROM modifier_groups WHERE id=?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  await dbRun(`UPDATE modifier_groups SET name=?, sort_order=? WHERE id=?`,
    [name ?? row.name, sort_order ?? row.sort_order, row.id]);
  res.json(await dbGet(`SELECT * FROM modifier_groups WHERE id=?`, [row.id]));
});

router.delete('/modifier-groups/:id', async (req, res) => {
  // Null out group_id on child modifiers, then delete group
  await dbRun(`UPDATE shared_modifiers SET group_id=NULL WHERE group_id=?`, [req.params.id]);
  await dbRun(`DELETE FROM modifier_groups WHERE id=?`, [req.params.id]);
  res.json({ ok: true });
});

// ── Shared Modifiers CRUD ────────────────────────────────────
router.get('/shared-modifiers-all', async (req, res) => {
  const rows = await dbAll(`
    SELECT sm.*, mg.name AS group_name
    FROM   shared_modifiers sm
    LEFT JOIN modifier_groups mg ON mg.id = sm.group_id
    ORDER  BY mg.sort_order, mg.name, sm.sort_order, sm.name
  `);
  res.json(rows);
});

router.post('/shared-modifiers', async (req, res) => {
  const { name, price = 0, group_id, sort_order = 0 } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const row = await dbGet(
    `INSERT INTO shared_modifiers (name, price, group_id, sort_order) VALUES (?,?,?,?) RETURNING *`,
    [name.trim(), price, group_id ?? null, sort_order]
  );
  const group = group_id ? await dbGet(`SELECT name FROM modifier_groups WHERE id=?`, [group_id]) : null;
  res.status(201).json({ ...row, group_name: group?.name ?? null });
});

router.put('/shared-modifiers/:id', async (req, res) => {
  const { name, price, group_id, sort_order, is_active } = req.body;
  const row = await dbGet(`SELECT * FROM shared_modifiers WHERE id=?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  await dbRun(`UPDATE shared_modifiers SET name=?,price=?,group_id=?,sort_order=?,is_active=? WHERE id=?`,
    [
      name       ?? row.name,
      price      ?? row.price,
      group_id   !== undefined ? (group_id ?? null) : row.group_id,
      sort_order ?? row.sort_order,
      is_active  ?? row.is_active,
      row.id
    ]);
  const updated = await dbGet(
    `SELECT sm.*, mg.name AS group_name FROM shared_modifiers sm LEFT JOIN modifier_groups mg ON mg.id=sm.group_id WHERE sm.id=?`,
    [row.id]
  );
  res.json(updated);
});

router.delete('/shared-modifiers/:id', async (req, res) => {
  // Remove assignments first, then delete
  await dbRun(`DELETE FROM product_modifier_assignments WHERE modifier_id=?`, [req.params.id]);
  await dbRun(`DELETE FROM shared_modifiers WHERE id=?`, [req.params.id]);
  res.json({ ok: true });
});

// GET /api/food-menu/shared-modifiers  — all active shared modifiers with group name
router.get('/shared-modifiers', async (req, res) => {
  const rows = await dbAll(`
    SELECT sm.id, sm.name, sm.price, sm.sort_order,
           mg.id AS group_id, mg.name AS group_name
    FROM   shared_modifiers sm
    LEFT JOIN modifier_groups mg ON mg.id = sm.group_id
    WHERE  sm.is_active = 1
    ORDER  BY mg.sort_order, mg.name, sm.sort_order, sm.name
  `);
  res.json(rows);
});

// GET /api/food-menu/modifier-groups  — groups with their modifiers
router.get('/modifier-groups', async (req, res) => {
  const groups = await dbAll(`SELECT * FROM modifier_groups ORDER BY sort_order, name`);
  const mods   = await dbAll(`SELECT * FROM shared_modifiers WHERE is_active=1 ORDER BY sort_order, name`);
  const result = groups.map(g => ({ ...g, modifiers: mods.filter(m => m.group_id === g.id) }));
  res.json(result);
});

// GET /api/food-menu/products-with-assignments  — products list + their assigned modifier ids
router.get('/products-with-assignments', async (req, res) => {
  const products = await dbAll(`
    SELECT p.id, p.name, p.pos_active,
           c.name AS category_name
    FROM   products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE  p.status = 'active'
    ORDER  BY c.sort_order, c.name, p.sort_order, p.name
  `);

  const assignments = await dbAll(`SELECT product_id, modifier_id FROM product_modifier_assignments`);
  const byProduct = {};
  for (const a of assignments) {
    if (!byProduct[a.product_id]) byProduct[a.product_id] = [];
    byProduct[a.product_id].push(a.modifier_id);
  }
  const result = products.map(p => ({ ...p, assigned_modifier_ids: byProduct[p.id] ?? [] }));
  res.json(result);
});

// POST /api/food-menu/modifier-assignments  — bulk assign modifiers to products
// Body: { product_ids: number[], modifier_ids: number[], replace: boolean }
router.post('/modifier-assignments', async (req, res) => {
  const { product_ids, modifier_ids, replace = false } = req.body;
  if (!Array.isArray(product_ids) || !product_ids.length) return res.status(400).json({ error: 'product_ids required' });
  if (!Array.isArray(modifier_ids) || !modifier_ids.length) return res.status(400).json({ error: 'modifier_ids required' });

  let inserted = 0;
  await transaction(async (tx) => {
    for (const pid of product_ids) {
      if (replace) await tx.dbRun(`DELETE FROM product_modifier_assignments WHERE product_id = ?`, [pid]);
      for (const mid of modifier_ids) {
        const info = await tx.dbRun(
          `INSERT IGNORE INTO product_modifier_assignments (product_id, modifier_id) VALUES (?,?)`,
          [pid, mid]
        );
        inserted += info.changes;
      }
    }
  });

  res.json({ ok: true, inserted, products: product_ids.length, modifiers: modifier_ids.length });
});

// DELETE /api/food-menu/modifier-assignments  — remove specific modifiers from products
// Body: { product_ids: number[], modifier_ids: number[] }
router.delete('/modifier-assignments', async (req, res) => {
  const { product_ids, modifier_ids } = req.body;
  if (!Array.isArray(product_ids) || !Array.isArray(modifier_ids)) {
    return res.status(400).json({ error: 'product_ids and modifier_ids required' });
  }
  let deleted = 0;
  await transaction(async (tx) => {
    for (const pid of product_ids) {
      for (const mid of modifier_ids) {
        const info = await tx.dbRun(
          `DELETE FROM product_modifier_assignments WHERE product_id=? AND modifier_id=?`,
          [pid, mid]
        );
        deleted += info.changes;
      }
    }
  });
  res.json({ ok: true, deleted });
});

module.exports = router;
