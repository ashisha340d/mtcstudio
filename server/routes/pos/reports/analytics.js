'use strict';
/** Sales analytics roll-ups: by order type, category, product, month, and the
 *  inverse view of items that did not sell at all. */
const express = require('express');
const { dbAll } = require('../../../pos/db');
const {
  round2, SALES_JOIN, PRODUCT_NAME, PRODUCT_KEY, idListFilter, stringListFilter, rangeBounds,
} = require('./shared');
const { getNepalDayBoundsUTC, getNepalDateStr } = require('../../../utils/nepalDateTime');

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

// GET /api/pos/reports/monthly-summary?year=YYYY&group=item|category|order-type
//     &category_ids=&product_ids=&order_types=
// One full-year pivot, three shapes: item rows, category rows, or order-type
// rows — the filter params only ever narrow that shape's own rows, they
// never switch it (that's what `group` is for).
router.get('/monthly-summary', async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const group = ['category', 'order-type'].includes(req.query.group) ? req.query.group : 'item';
  const cat = idListFilter(req.query.category_ids || req.query.category_id, 'p.category_id');
  const prod = idListFilter(req.query.product_ids, 'p.id');
  const ot = stringListFilter(req.query.order_types, 'o.order_type');

  let rows;
  if (group === 'category') {
    rows = await dbAll(
      `SELECT COALESCE(c.id, 0) AS row_key, COALESCE(c.name, 'Uncategorized') AS name,
              MONTH(o.closed_at) AS month,
              SUM(ki.quantity) AS qty, SUM(ki.quantity * ki.unit_price) AS amount
       ${SALES_JOIN}
       WHERE o.status = 'CLOSED' AND YEAR(o.closed_at) = ?${cat.clause}
       GROUP BY row_key, name, month
       ORDER BY name`,
      [year, ...cat.params]
    );
  } else if (group === 'order-type') {
    rows = await dbAll(
      `SELECT o.order_type AS row_key, o.order_type AS name,
              MONTH(o.closed_at) AS month,
              SUM(ki.quantity) AS qty, SUM(ki.quantity * ki.unit_price) AS amount
       FROM pos_kot_items ki
       JOIN pos_kots k ON k.id = ki.kot_id
       JOIN pos_orders o ON o.id = k.order_id
       WHERE o.status = 'CLOSED' AND YEAR(o.closed_at) = ?${ot.clause}
       GROUP BY row_key, name, month
       ORDER BY name`,
      [year, ...ot.params]
    );
  } else {
    rows = await dbAll(
      `SELECT ${PRODUCT_KEY} AS row_key, p.id, ${PRODUCT_NAME} AS name,
              COALESCE(c.name, 'Uncategorized') AS category_name,
              MONTH(o.closed_at) AS month,
              SUM(ki.quantity) AS qty, SUM(ki.quantity * ki.unit_price) AS amount
       ${SALES_JOIN}
       WHERE o.status = 'CLOSED' AND YEAR(o.closed_at) = ?
         ${cat.clause}${prod.clause}
       GROUP BY row_key, p.id, name, category_name, month
       ORDER BY name`,
      [year, ...cat.params, ...prod.params]
    );
  }

  res.json({
    mode: group,
    rows: rows.map(r => ({
      id: r.row_key, productId: r.id ?? null, name: r.name, category_name: r.category_name ?? null, month: Number(r.month) || 0,
      qty: Number(r.qty) || 0, amount: round2(r.amount),
    })),
  });
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

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Count how many of each weekday (0=Sun..6=Sat) fall in an inclusive date range. */
function weekdayCounts(from, to) {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const start = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  for (let t = start; t <= end; t += 86400000) counts[new Date(t).getUTCDay()]++;
  return counts;
}

// GET /api/pos/reports/weekly-pattern?from=&to=
// Typical hourly sales curve per weekday — averaged over how many times that
// weekday actually occurred in the range, so a 2-week range and a 2-month
// range both plot "a normal Monday", not a lopsided sum.
router.get('/weekly-pattern', async (req, res) => {
  const from = req.query.from || getNepalDateStr();
  const to = req.query.to || from;
  const { start } = getNepalDayBoundsUTC(from);
  const { end } = getNepalDayBoundsUTC(to);

  const rows = await dbAll(
    `SELECT (DAYOFWEEK(o.closed_at) - 1) AS dow, HOUR(o.closed_at) AS hour,
            SUM(ki.quantity * ki.unit_price) AS amount
     ${SALES_JOIN}
     WHERE o.status = 'CLOSED' AND o.closed_at >= ? AND o.closed_at <= ?
     GROUP BY dow, hour`,
    [start, end]
  );

  const counts = weekdayCounts(from, to);
  const sums = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const r of rows) sums[r.dow][r.hour] = Number(r.amount) || 0;

  const weekdays = [1, 2, 3, 4, 5, 6, 0].map(dow => ({
    dow,
    label: WEEKDAY_LABELS[dow],
    days: counts[dow],
    hours: counts[dow] ? sums[dow].map(v => round2(v / counts[dow])) : sums[dow].map(() => 0),
  }));

  res.json({ from, to, weekdays });
});

module.exports = router;
