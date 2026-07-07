'use strict';
// ─────────────────────────────────────────────────────────────
//  File Maintenance — CRUD for Tables, Stations, Users, POS Products
// ─────────────────────────────────────────────────────────────
const express      = require('express');
const bcrypt       = require('bcryptjs');
const { dbAll, dbGet, dbRun, transaction } = require('../../pos/db');
const { requireSession, requireRole } = require('../../middleware/posAuth');
const socketServer = require('../../pos/socketServer');

const router = express.Router();
router.use(requireSession);
router.use(requireRole('MANAGER', 'ADMIN'));

// ══ RESTAURANT TABLES ════════════════════════════════════════
router.get('/tables', async (req, res) => {
  res.json(await dbAll(`SELECT * FROM pos_restaurant_tables ORDER BY sort_order, name`));
});

router.post('/tables', async (req, res) => {
  const { name, capacity = 4, section, sort_order = 0 } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  try {
    const row = await dbGet(
      `INSERT INTO pos_restaurant_tables (name,capacity,section,sort_order) VALUES (?,?,?,?) RETURNING *`,
      [name.trim(), capacity, section ?? null, sort_order]
    );
    socketServer.emitTablesUpdated();
    res.status(201).json(row);
  } catch { res.status(409).json({ error: 'Table name already exists' }); }
});

router.put('/tables/:id', async (req, res) => {
  const { name, capacity, section, sort_order, is_active } = req.body;
  const row = await dbGet(`SELECT * FROM pos_restaurant_tables WHERE id=?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  await dbRun(
    `UPDATE pos_restaurant_tables SET name=?,capacity=?,section=?,sort_order=?,is_active=? WHERE id=?`,
    [name ?? row.name, capacity ?? row.capacity, section ?? row.section, sort_order ?? row.sort_order, is_active ?? row.is_active, row.id]
  );
  socketServer.emitTablesUpdated();
  res.json(await dbGet(`SELECT * FROM pos_restaurant_tables WHERE id=?`, [row.id]));
});

router.delete('/tables/:id', async (req, res) => {
  const row = await dbGet(`SELECT * FROM pos_restaurant_tables WHERE id=?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const hasOrders = await dbGet(`SELECT id FROM pos_orders WHERE table_id=? AND status IN ('OPEN','SAVED') LIMIT 1`, [row.id]);
  if (hasOrders) return res.status(409).json({ error: 'Table has active orders — cannot delete' });
  await dbRun(`DELETE FROM pos_restaurant_tables WHERE id=?`, [row.id]);
  socketServer.emitTablesUpdated();
  res.json({ ok: true });
});

// ══ STATIONS ═════════════════════════════════════════════════
router.get('/stations', async (req, res) => {
  res.json(await dbAll(`SELECT * FROM pos_stations ORDER BY sort_order, name`));
});

router.post('/stations', async (req, res) => {
  const { name, color_hex = '#ffffff', sort_order = 0 } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  try {
    const row = await dbGet(
      `INSERT INTO pos_stations (name,color_hex,sort_order) VALUES (?,?,?) RETURNING *`,
      [name.trim(), color_hex, sort_order]
    );
    res.status(201).json(row);
  } catch { res.status(409).json({ error: 'Station name already exists' }); }
});

router.put('/stations/:id', async (req, res) => {
  const { name, color_hex, sort_order, is_active } = req.body;
  const row = await dbGet(`SELECT * FROM pos_stations WHERE id=?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  await dbRun(`UPDATE pos_stations SET name=?,color_hex=?,sort_order=?,is_active=? WHERE id=?`,
    [name ?? row.name, color_hex ?? row.color_hex, sort_order ?? row.sort_order, is_active ?? row.is_active, row.id]);
  res.json(await dbGet(`SELECT * FROM pos_stations WHERE id=?`, [row.id]));
});

router.delete('/stations/:id', async (req, res) => {
  // Null out station references in products, then hard delete
  await dbRun(`UPDATE products SET pos_station_id=NULL WHERE pos_station_id=?`, [req.params.id]);
  await dbRun(`DELETE FROM pos_stations WHERE id=?`, [req.params.id]);
  res.json({ ok: true });
});

// Bulk sort_order update for drag-drop reordering
router.post('/stations/reorder', async (req, res) => {
  const { order } = req.body; // [{ id, sort_order }]
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
  await transaction(async (tx) => {
    for (const { id, sort_order } of order) {
      await tx.dbRun(`UPDATE pos_stations SET sort_order=? WHERE id=?`, [sort_order, id]);
    }
  });
  res.json({ ok: true });
});

router.post('/tables/reorder', async (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
  await transaction(async (tx) => {
    for (const { id, sort_order } of order) {
      await tx.dbRun(`UPDATE pos_restaurant_tables SET sort_order=? WHERE id=?`, [sort_order, id]);
    }
  });
  socketServer.emitTablesUpdated();
  res.json({ ok: true });
});

// ══ POS USERS ════════════════════════════════════════════════
router.get('/users', async (req, res) => {
  res.json(await dbAll(
    `SELECT u.id, u.name, u.employee_id, u.is_active, u.created_at, r.name AS role
     FROM   pos_users u JOIN pos_roles r ON r.id=u.role_id ORDER BY u.employee_id`
  ));
});

router.post('/users', requireRole('ADMIN'), async (req, res) => {
  const { name, employee_id, role, pin } = req.body;
  if (!name || !employee_id || !role || !pin) return res.status(400).json({ error: 'name, employee_id, role, pin required' });
  if (String(pin).length !== 4) return res.status(400).json({ error: 'PIN must be 4 digits' });

  const roleRow = await dbGet(`SELECT id FROM pos_roles WHERE name=?`, [role.toUpperCase()]);
  if (!roleRow) return res.status(400).json({ error: 'Invalid role' });

  try {
    const row = await dbGet(
      `INSERT INTO pos_users (name,employee_id,role_id,pin_hash) VALUES (?,?,?,?) RETURNING id,name,employee_id,is_active,created_at`,
      [name.trim(), employee_id.toUpperCase().trim(), roleRow.id, bcrypt.hashSync(String(pin), 10)]
    );
    res.status(201).json({ ...row, role });
  } catch { res.status(409).json({ error: 'employee_id already exists' }); }
});

router.put('/users/:id', requireRole('ADMIN'), async (req, res) => {
  const { name, role, pin, is_active } = req.body;
  const user = await dbGet(`SELECT * FROM pos_users WHERE id=?`, [req.params.id]);
  if (!user) return res.status(404).json({ error: 'Not found' });

  let roleId = user.role_id;
  if (role) {
    const r = await dbGet(`SELECT id FROM pos_roles WHERE name=?`, [role.toUpperCase()]);
    if (!r) return res.status(400).json({ error: 'Invalid role' });
    roleId = r.id;
  }

  const pinHash = pin ? bcrypt.hashSync(String(pin), 10) : user.pin_hash;
  await dbRun(`UPDATE pos_users SET name=?,role_id=?,pin_hash=?,is_active=? WHERE id=?`,
    [name ?? user.name, roleId, pinHash, is_active ?? user.is_active, user.id]);

  const updated = await dbGet(`SELECT u.id,u.name,u.employee_id,u.is_active,u.created_at,r.name AS role FROM pos_users u JOIN pos_roles r ON r.id=u.role_id WHERE u.id=?`, [user.id]);
  res.json(updated);
});

router.delete('/users/:id', requireRole('ADMIN'), async (req, res) => {
  // Never delete — soft deactivate
  await dbRun(`UPDATE pos_users SET is_active=0 WHERE id=?`, [req.params.id]);
  res.json({ ok: true });
});

// ══ POS PRODUCTS (set pos fields on existing products) ═══════
router.get('/products', async (req, res) => {
  const rows = await dbAll(
    `SELECT p.id, p.name, p.category_id, p.pos_price, p.prep_time_minutes,
            p.is_fast_moving, p.pos_station_id, p.pos_active, p.status, p.cake_type,
            p.customer_visible, p.customer_max_qty,
            c.name AS category_name,
            s.name AS station_name
     FROM   products p
     LEFT JOIN categories  c ON c.id = p.category_id
     LEFT JOIN pos_stations s ON s.id = p.pos_station_id
     ORDER  BY c.sort_order, p.sort_order, p.name`
  );
  res.json(rows);
});

// Returns all variants for a product (for cake-type sub-row editing)
router.get('/products/:id/variants', async (req, res) => {
  const rows = await dbAll(
    `SELECT id, name, selling_price, unit, status, cake_type FROM product_variants WHERE product_id=? ORDER BY sort_order, name`,
    [req.params.id]
  );
  res.json(rows);
});

router.put('/products/variants/:variantId/cake-type', async (req, res) => {
  const v = await dbGet(`SELECT id FROM product_variants WHERE id=?`, [req.params.variantId]);
  if (!v) return res.status(404).json({ error: 'Variant not found' });
  await dbRun(`UPDATE product_variants SET cake_type=? WHERE id=?`, [req.body.cake_type || null, v.id]);
  res.json({ ok: true });
});

router.put('/products/:id', async (req, res) => {
  const { pos_price, prep_time_minutes, is_fast_moving, pos_station_id, pos_active, cake_type,
          customer_visible, customer_max_qty } = req.body;
  const prod = await dbGet(`SELECT id FROM products WHERE id=?`, [req.params.id]);
  if (!prod) return res.status(404).json({ error: 'Product not found' });

  const fields = [];
  const values = [];
  if (pos_price          !== undefined) { fields.push('pos_price=?');          values.push(parseFloat(pos_price)); }
  if (prep_time_minutes  !== undefined) { fields.push('prep_time_minutes=?');  values.push(parseInt(prep_time_minutes)); }
  if (is_fast_moving     !== undefined) { fields.push('is_fast_moving=?');     values.push(is_fast_moving ? 1 : 0); }
  if (pos_station_id     !== undefined) { fields.push('pos_station_id=?');     values.push(pos_station_id ?? null); }
  if (pos_active         !== undefined) { fields.push('pos_active=?');         values.push(pos_active ? 1 : 0); }
  if (cake_type          !== undefined) { fields.push('cake_type=?');          values.push(cake_type || null); }
  if (customer_visible   !== undefined) { fields.push('customer_visible=?');   values.push(customer_visible ? 1 : 0); }
  if (customer_max_qty   !== undefined) { fields.push('customer_max_qty=?');   values.push(customer_max_qty ? parseInt(customer_max_qty) : null); }

  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  values.push(prod.id);
  await dbRun(`UPDATE products SET ${fields.join(',')} WHERE id=?`, values);
  res.json(await dbGet(
    `SELECT id,name,pos_price,prep_time_minutes,is_fast_moving,pos_station_id,pos_active,cake_type,
            customer_visible,customer_max_qty FROM products WHERE id=?`,
    [prod.id]
  ));
});

// Bulk update (set station or prep_time for all products in a category)
router.post('/products/bulk', async (req, res) => {
  const { product_ids, updates } = req.body;
  if (!product_ids?.length || !updates) return res.status(400).json({ error: 'product_ids and updates required' });

  const allowed = ['pos_price','prep_time_minutes','is_fast_moving','pos_station_id','pos_active','customer_visible','customer_max_qty'];
  const fields  = Object.keys(updates).filter(k => allowed.includes(k));
  if (!fields.length) return res.status(400).json({ error: 'No valid fields to update' });

  const ph     = product_ids.map(() => '?').join(',');
  const values = [...fields.map(f => updates[f]), ...product_ids];
  await dbRun(`UPDATE products SET ${fields.map(f => f+'=?').join(',')} WHERE id IN (${ph})`, values);
  res.json({ ok: true, updated: product_ids.length });
});

// ══ CAKE LOOKUP MASTER ═══════════════════════════════════════
const LOOKUP_TYPES = ['CREAM_TYPE','SHAPE_TYPE','SPONGE_TYPE','THEME_TYPE','DIETARY_TYPE','TABLE_TAG','PRODUCT_BADGE'];

router.get('/cake-lookup', async (req, res) => {
  const rows = await dbAll(
    `SELECT * FROM lookup_master ORDER BY lookup_type, sort_order, name`
  );
  res.json(rows);
});

router.post('/cake-lookup', async (req, res) => {
  const { lookup_type, name, code, value, extra_charge = 0, description, sort_order = 0 } = req.body;
  if (!lookup_type || !name?.trim()) return res.status(400).json({ error: 'lookup_type and name required' });
  if (!LOOKUP_TYPES.includes(lookup_type)) return res.status(400).json({ error: `lookup_type must be one of: ${LOOKUP_TYPES.join(', ')}` });
  try {
    const row = await dbGet(
      `INSERT INTO lookup_master (lookup_type,code,name,value,extra_charge,description,sort_order)
       VALUES (?,?,?,?,?,?,?) RETURNING *`,
      [
        lookup_type,
        code?.trim()  || name.trim().toUpperCase().replace(/\s+/g, '_'),
        name.trim(),
        value?.trim() || null,
        parseFloat(extra_charge) || 0,
        description?.trim()      || null,
        parseInt(sort_order)     || 0
      ]
    );
    res.status(201).json(row);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Name already exists for this type' });
    throw e;
  }
});

router.post('/cake-lookup/reorder', async (req, res) => {
  const { order } = req.body; // [{ id, sort_order }]
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
  await transaction(async (tx) => {
    for (const { id, sort_order } of order) {
      await tx.dbRun(`UPDATE lookup_master SET sort_order=? WHERE id=?`, [sort_order, id]);
    }
  });
  res.json({ ok: true });
});

router.put('/cake-lookup/:id', async (req, res) => {
  const row = await dbGet(`SELECT * FROM lookup_master WHERE id=?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const { name, code, value, extra_charge, description, sort_order, is_active } = req.body;
  await dbRun(
    `UPDATE lookup_master
     SET code=?,name=?,value=?,extra_charge=?,description=?,sort_order=?,is_active=?,updated_at=CURRENT_TIMESTAMP
     WHERE id=?`,
    [
      code        !== undefined ? (code?.trim() || row.code)        : row.code,
      name        !== undefined ? (name?.trim() || row.name)        : row.name,
      value       !== undefined ? (value?.trim() || null)           : row.value,
      extra_charge !== undefined ? parseFloat(extra_charge) || 0   : row.extra_charge,
      description !== undefined ? (description?.trim() || null)    : row.description,
      sort_order  !== undefined ? parseInt(sort_order) || 0        : row.sort_order,
      is_active   !== undefined ? (is_active ? 1 : 0)              : row.is_active,
      row.id
    ]
  );
  res.json(await dbGet(`SELECT * FROM lookup_master WHERE id=?`, [row.id]));
});

router.delete('/cake-lookup/:id', async (req, res) => {
  const row = await dbGet(`SELECT id FROM lookup_master WHERE id=?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  await dbRun(`DELETE FROM lookup_master WHERE id=?`, [row.id]);
  res.json({ ok: true });
});

// ══ ROLES (read-only) ════════════════════════════════════════
router.get('/roles', async (req, res) => {
  res.json(await dbAll(`SELECT * FROM pos_roles ORDER BY id`));
});

module.exports = router;
