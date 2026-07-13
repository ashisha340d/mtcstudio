'use strict';
const express = require('express');
const { dbAll, dbGet } = require('../../pos/db');
const { requireSession } = require('../../middleware/posAuth');

const router = express.Router();
router.use(requireSession);

router.get('/tables', async (req, res) => {
  res.json(await dbAll(
    `SELECT * FROM pos_restaurant_tables WHERE is_active = 1 ORDER BY sort_order, name`
  ));
});

router.get('/categories', async (req, res) => {
  res.json(await dbAll(
    `SELECT id, name, sort_order, icon FROM categories WHERE status = 'active' ORDER BY sort_order, name`
  ));
});

router.get('/stations', async (req, res) => {
  res.json(await dbAll(
    `SELECT * FROM pos_stations WHERE is_active = 1 ORDER BY sort_order, name`
  ));
});

router.get('/products', async (req, res) => {
  const products = await dbAll(
    `SELECT p.id, p.name, p.category_id, p.pos_station_id AS station_id,
            p.pos_price AS price, p.prep_time_minutes, p.is_fast_moving,
            p.pos_active AS is_active, p.badge,
            (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id AND v.status = 'active') AS variant_count,
            c.name AS category_name,
            s.name AS station_name, s.color_hex AS station_color,
            EXISTS(
              SELECT 1 FROM product_modifier_assignments WHERE product_id = p.id LIMIT 1
            ) AS has_modifiers
     FROM   products p
     LEFT JOIN categories  c ON c.id = p.category_id
     LEFT JOIN pos_stations s ON s.id = p.pos_station_id
     WHERE  p.pos_active = 1 AND p.status = 'active'
     ORDER  BY c.sort_order, p.sort_order, p.name`
  );

  if (!products.length) return res.json([]);

  // Embed active variants into each product (one query, not N)
  const ids = products.map(p => p.id);
  const ph  = ids.map(() => '?').join(',');
  const variants = await dbAll(
    `SELECT id, product_id, name,
            COALESCE(selling_price, 0) AS price,
            sort_order
     FROM   product_variants
     WHERE  product_id IN (${ph}) AND status = 'active'
     ORDER  BY sort_order, id`,
    ids
  );

  const byProd = {};
  for (const v of variants) (byProd[v.product_id] ??= []).push(v);
  for (const p of products)  p.variants = byProd[p.id] || [];

  res.json(products);
});

// GET /api/pos/products/:id/modifiers  — used by waiter app picker
router.get('/products/:id/modifiers', async (req, res) => {
  const mods = await dbAll(
    `SELECT sm.id, sm.name, sm.price,
            mg.id   AS group_id,
            mg.name AS group_name
     FROM   product_modifier_assignments pma
     JOIN   shared_modifiers sm   ON sm.id  = pma.modifier_id
     LEFT JOIN modifier_groups mg ON mg.id  = sm.group_id
     WHERE  pma.product_id = ?
     ORDER  BY mg.sort_order, sm.name`,
    [req.params.id]
  );

  // Group by modifier group for the picker UI
  const groupMap = new Map();
  for (const m of mods) {
    const key = m.group_id ?? 0;
    if (!groupMap.has(key)) {
      groupMap.set(key, { id: key, name: m.group_name || 'Extras', items: [] });
    }
    groupMap.get(key).items.push({ id: m.id, name: m.name, price: m.price });
  }

  res.json([...groupMap.values()]);
});

router.get('/dashboard/stats', async (req, res) => {
  const openOrders   = await dbGet(`SELECT COUNT(*) AS c FROM pos_orders WHERE status IN ('OPEN','SAVED')`);
  const activeKots   = await dbGet(`SELECT COUNT(*) AS c FROM pos_kots WHERE status IN ('ORDERSENT','IN_PROGRESS')`);
  const todayRevenue = await dbGet(`SELECT COALESCE(SUM(paid_amount),0) AS t FROM pos_orders WHERE status='CLOSED' AND DATE(closed_at)=CURDATE()`);
  res.json({
    openOrders:   openOrders.c,
    activeKots:   activeKots.c,
    todayRevenue: todayRevenue.t,
  });
});

module.exports = router;
