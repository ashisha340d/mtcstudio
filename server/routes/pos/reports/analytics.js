'use strict';
/** Sales analytics roll-ups: by order type, category, product, month, and the
 *  inverse view of items that did not sell at all. */
const express = require('express');
const { dbAll } = require('../../../pos/db');
const {
  round2, SALES_JOIN, PRODUCT_NAME, PRODUCT_KEY, idListFilter, rangeBounds,
} = require('./shared');

const router = express.Router();

// GET /api/pos/reports/order-type-summary?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/order-type-summary', async (req, res) => {
  const { start, end } = rangeBounds(req);

  const rows = await dbAll(
    `SELECT o.order_type, COUNT(DISTINCT o.id) AS orders,
            SUM(ki.quantity) AS qty, SUM(ki.quantity * ki.unit_price) AS amount
     FROM pos_kot_items ki
     JOIN pos_kots k ON k.id = ki.kot_id
     JOIN pos_orders o ON o.id = k.order_id
     WHERE o.status = 'CLOSED' AND o.closed_at >= ? AND o.closed_at <= ?
     GROUP BY o.order_type
     ORDER BY amount DESC`,
    [start, end]
  );

  res.json(rows.map(r => ({
    id: r.order_type, name: r.order_type, orders: Number(r.orders) || 0,
    qty: Number(r.qty) || 0, amount: round2(r.amount),
  })));
});

// GET /api/pos/reports/category-summary?from=&to=&category_ids=1,2
router.get('/category-summary', async (req, res) => {
  const { start, end } = rangeBounds(req);
  const cat = idListFilter(req.query.category_ids, 'p.category_id');

  const rows = await dbAll(
    `SELECT c.id, c.name, c.icon,
            (SELECT ml.filename FROM media_library ml WHERE ml.id = c.image_id) AS image_url,
            SUM(ki.quantity) AS qty, SUM(ki.quantity * ki.unit_price) AS amount
     ${SALES_JOIN}
     WHERE o.status = 'CLOSED' AND o.closed_at >= ? AND o.closed_at <= ?${cat.clause}
     GROUP BY c.id, c.name, c.icon, c.image_id
     ORDER BY amount DESC`,
    [start, end, ...cat.params]
  );

  res.json(rows.map(r => ({
    id: r.id ?? 'uncategorized', name: r.name || 'Uncategorized',
    icon: r.icon, image_url: r.image_url,
    qty: Number(r.qty) || 0, amount: round2(r.amount),
  })));
});

// GET /api/pos/reports/product-summary?from=&to=&category_ids=&product_ids=
router.get('/product-summary', async (req, res) => {
  const { start, end } = rangeBounds(req);
  const cat = idListFilter(req.query.category_ids || req.query.category_id, 'p.category_id');
  const prod = idListFilter(req.query.product_ids, 'p.id');

  const rows = await dbAll(
    `SELECT ${PRODUCT_KEY} AS row_key, p.id, ${PRODUCT_NAME} AS name,
            c.name AS category_name,
            SUM(ki.quantity) AS qty, SUM(ki.quantity * ki.unit_price) AS amount
     ${SALES_JOIN}
     WHERE o.status = 'CLOSED' AND o.closed_at >= ? AND o.closed_at <= ?
       ${cat.clause}${prod.clause}
     GROUP BY row_key, p.id, name, c.name
     ORDER BY amount DESC`,
    [start, end, ...cat.params, ...prod.params]
  );

  res.json(rows.map(r => ({
    id: r.row_key, productId: r.id, name: r.name, category_name: r.category_name,
    qty: Number(r.qty) || 0, amount: round2(r.amount),
  })));
});

// GET /api/pos/reports/monthly-summary?year=YYYY&category_ids=&product_ids=
router.get('/monthly-summary', async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const cat = idListFilter(req.query.category_ids || req.query.category_id, 'p.category_id');
  const prod = idListFilter(req.query.product_ids, 'p.id');

  const rows = await dbAll(
    `SELECT ${PRODUCT_KEY} AS row_key, p.id, ${PRODUCT_NAME} AS name,
            MONTH(o.closed_at) AS month,
            SUM(ki.quantity) AS qty, SUM(ki.quantity * ki.unit_price) AS amount
     ${SALES_JOIN}
     WHERE o.status = 'CLOSED' AND YEAR(o.closed_at) = ?
       ${cat.clause}${prod.clause}
     GROUP BY row_key, p.id, name, month
     ORDER BY name`,
    [year, ...cat.params, ...prod.params]
  );

  res.json(rows.map(r => ({
    id: r.row_key, productId: r.id, name: r.name, month: Number(r.month) || 0,
    qty: Number(r.qty) || 0, amount: round2(r.amount),
  })));
});

// GET /api/pos/reports/zero-sales?from=&to=&category_ids=
// Active POS items with no closed sales line in the period.
router.get('/zero-sales', async (req, res) => {
  const { start, end } = rangeBounds(req);
  const cat = idListFilter(req.query.category_ids || req.query.category_id, 'p.category_id');

  const rows = await dbAll(
    `SELECT p.id, p.name, c.name AS category_name, p.pos_price,
            (SELECT MAX(o2.closed_at)
               FROM pos_kot_items ki2
               JOIN pos_kots k2 ON k2.id = ki2.kot_id
               JOIN pos_orders o2 ON o2.id = k2.order_id
              WHERE ki2.product_id = p.id AND o2.status = 'CLOSED') AS last_sold
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.pos_active = 1${cat.clause}
       AND NOT EXISTS (
         SELECT 1 FROM pos_kot_items ki
         JOIN pos_kots k ON k.id = ki.kot_id
         JOIN pos_orders o ON o.id = k.order_id
         WHERE ki.product_id = p.id AND o.status = 'CLOSED'
           AND o.closed_at >= ? AND o.closed_at <= ?)
     ORDER BY c.name, p.name`,
    [...cat.params, start, end]
  );

  res.json(rows.map(r => ({
    id: r.id, name: r.name, category_name: r.category_name,
    price: round2(r.pos_price),
    last_sold: r.last_sold ? String(r.last_sold).split(' ')[0] : null,
    qty: 0, amount: 0,
  })));
});

module.exports = router;
