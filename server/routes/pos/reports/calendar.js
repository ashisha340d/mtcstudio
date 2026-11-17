'use strict';
/**
 * Calendar report — the same closed-sales figures the other reports use, but
 * bucketed by hour (day/week/month views) or by day (year view) so the client
 * can plot them as time blocks. One request per visible range; the client
 * slices the payload for every view it renders from it.
 */
const express = require('express');
const { dbAll } = require('../../../pos/db');
const { getNepalDayBoundsUTC, getNepalDateStr } = require('../../../utils/nepalDateTime');
const {
  round2, SALES_JOIN, PRODUCT_NAME, PRODUCT_KEY, idListFilter, walletMethodExpr,
} = require('./shared');
const holidayCalendar = require('../../../services/holidayCalendar');

const router = express.Router();

const bucketExpr = (col, bucket) =>
  bucket === 'day' ? `DATE_FORMAT(${col}, '%Y-%m-%d')` : `DATE_FORMAT(${col}, '%Y-%m-%d %H:00')`;

const DT_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/;

// GET /api/pos/reports/calendar?from=&to=&bucket=hour|day&include=payments,categories,products
router.get('/calendar', async (req, res) => {
  const from = req.query.from || getNepalDateStr();
  const to = req.query.to || from;
  const bucket = req.query.bucket === 'day' ? 'day' : 'hour';
  const { start } = getNepalDayBoundsUTC(from);
  const { end } = getNepalDayBoundsUTC(to);
  const include = String(req.query.include || 'payments').split(',').map(s => s.trim());
  const method = walletMethodExpr('pay');

  const out = {
    from, to, bucket,
    payments: [], categories: [], products: [], stations: [], badges: [], holidays: [],
  };

  if (include.includes('payments')) {
    const [orderRows, cakeRows, changeRows] = await Promise.all([
      dbAll(
        `SELECT ${bucketExpr('o.closed_at', bucket)} AS t, ${method} AS method,
                SUM(pay.amount) AS amount, COUNT(DISTINCT o.id) AS orders
         FROM pos_payments pay
         JOIN pos_orders o ON o.id = pay.order_id
         WHERE o.status = 'CLOSED' AND o.closed_at >= ? AND o.closed_at <= ?
         GROUP BY t, method`,
        [start, end]
      ),
      dbAll(
        `SELECT ${bucketExpr('pay.created_at', bucket)} AS t, ${method} AS method,
                SUM(pay.amount) AS amount
         FROM pos_payments pay
         JOIN cake_orders co ON co.id = pay.cake_order_id
         WHERE co.deleted_at IS NULL AND pay.created_at >= ? AND pay.created_at <= ?
         GROUP BY t, method`,
        [start, end]
      ),
      // Cash tendered includes change handed back — net it out per bucket so
      // CASH matches the drawer, exactly like the payment register does daily.
      dbAll(
        `SELECT ${bucketExpr('o.closed_at', bucket)} AS t, SUM(o.change_amount) AS change_amount
         FROM pos_orders o
         WHERE o.status = 'CLOSED' AND o.closed_at >= ? AND o.closed_at <= ?
         GROUP BY t`,
        [start, end]
      ),
    ]);

    const byKey = new Map();
    const bump = (t, m, amount, orders) => {
      const key = `${t}|${m}`;
      const row = byKey.get(key) || { t, method: m, amount: 0, orders: 0 };
      row.amount += Number(amount) || 0;
      row.orders += Number(orders) || 0;
      byKey.set(key, row);
      return row;
    };

    for (const r of orderRows) bump(r.t, r.method, r.amount, r.orders);
    for (const r of cakeRows) bump(r.t, r.method, r.amount, 0);
    for (const r of changeRows) {
      const change = Number(r.change_amount) || 0;
      if (change) bump(r.t, 'CASH', -change, 0);
    }

    out.payments = [...byKey.values()]
      .map(r => ({ ...r, amount: round2(r.amount) }))
      .filter(r => r.amount || r.orders)
      .sort((a, b) => a.t.localeCompare(b.t));
  }

  if (include.includes('categories')) {
    const cat = idListFilter(req.query.category_ids, 'p.category_id');
    const rows = await dbAll(
      `SELECT ${bucketExpr('o.closed_at', bucket)} AS t,
              COALESCE(c.id, 0) AS id, COALESCE(c.name, 'Uncategorized') AS name,
              SUM(ki.quantity) AS qty, SUM(ki.quantity * ki.unit_price) AS amount
       ${SALES_JOIN}
       WHERE o.status = 'CLOSED' AND o.closed_at >= ? AND o.closed_at <= ?${cat.clause}
       GROUP BY t, c.id, c.name
       ORDER BY t`,
      [start, end, ...cat.params]
    );
    out.categories = rows.map(r => ({
      t: r.t, id: String(r.id), name: r.name,
      qty: Number(r.qty) || 0, amount: round2(r.amount),
    }));
  }

  if (include.includes('products')) {
    const cat = idListFilter(req.query.category_ids, 'p.category_id');
    const prod = idListFilter(req.query.product_ids, 'p.id');
    const rows = await dbAll(
      `SELECT ${bucketExpr('o.closed_at', bucket)} AS t,
              ${PRODUCT_KEY} AS row_key, ${PRODUCT_NAME} AS name,
              SUM(ki.quantity) AS qty, SUM(ki.quantity * ki.unit_price) AS amount
       ${SALES_JOIN}
       WHERE o.status = 'CLOSED' AND o.closed_at >= ? AND o.closed_at <= ?${cat.clause}${prod.clause}
       GROUP BY t, row_key, name
       ORDER BY t`,
      [start, end, ...cat.params, ...prod.params]
    );
    out.products = rows.map(r => ({
      t: r.t, id: String(r.row_key), name: r.name,
      qty: Number(r.qty) || 0, amount: round2(r.amount),
    }));
  }

  if (include.includes('stations')) {
    const st = idListFilter(req.query.station_ids, 'ki.station_id');
    const rows = await dbAll(
      `SELECT ${bucketExpr('o.closed_at', bucket)} AS t,
              COALESCE(st.id, 0) AS id, COALESCE(st.name, 'Unassigned') AS name, st.color_hex,
              SUM(ki.quantity) AS qty, SUM(ki.quantity * ki.unit_price) AS amount
       ${SALES_JOIN}
       LEFT JOIN pos_stations st ON st.id = ki.station_id
       WHERE o.status = 'CLOSED' AND o.closed_at >= ? AND o.closed_at <= ?${st.clause}
       GROUP BY t, st.id, st.name, st.color_hex
       ORDER BY t`,
      [start, end, ...st.params]
    );
    out.stations = rows.map(r => ({
      t: r.t, id: String(r.id), name: r.name, color: r.color_hex || null,
      qty: Number(r.qty) || 0, amount: round2(r.amount),
    }));
  }

  if (include.includes('badges')) {
    // products.badge is a comma list ('VEG,SPICY') — group on the raw combo,
    // then fan each combo out into the individual badges the client asked for.
    const wanted = new Set(
      String(req.query.badges || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    );
    const rows = wanted.size ? await dbAll(
      `SELECT ${bucketExpr('o.closed_at', bucket)} AS t, p.badge AS badge,
              SUM(ki.quantity) AS qty, SUM(ki.quantity * ki.unit_price) AS amount
       ${SALES_JOIN}
       WHERE o.status = 'CLOSED' AND o.closed_at >= ? AND o.closed_at <= ?
         AND p.badge IS NOT NULL AND p.badge <> ''
       GROUP BY t, p.badge
       ORDER BY t`,
      [start, end]
    ) : [];

    const byKey = new Map();
    for (const r of rows) {
      for (const raw of String(r.badge).split(',')) {
        const code = raw.trim().toUpperCase();
        if (!code || !wanted.has(code)) continue;
        const key = `${r.t}|${code}`;
        const cell = byKey.get(key) || { t: r.t, id: code, name: code, qty: 0, amount: 0 };
        cell.qty += Number(r.qty) || 0;
        cell.amount += Number(r.amount) || 0;
        byKey.set(key, cell);
      }
    }
    out.badges = [...byKey.values()].map(r => ({ ...r, amount: round2(r.amount) }));
  }

  out.holidays = holidayCalendar.getHolidays(from, to);

  res.json(out);
});

// GET /api/pos/reports/calendar-meta — the plottable dimensions the picker lists.
router.get('/calendar-meta', async (req, res) => {
  const [stations, badgeRows] = await Promise.all([
    dbAll(`SELECT id, name, color_hex FROM pos_stations WHERE is_active = 1 ORDER BY sort_order, name`),
    dbAll(`SELECT badge, COUNT(*) AS n FROM products
           WHERE badge IS NOT NULL AND badge <> '' GROUP BY badge`),
  ]);

  const badges = new Map();
  for (const r of badgeRows) {
    for (const raw of String(r.badge).split(',')) {
      const code = raw.trim().toUpperCase();
      if (!code) continue;
      badges.set(code, (badges.get(code) || 0) + (Number(r.n) || 0));
    }
  }

  res.json({
    stations: stations.map(s => ({ id: String(s.id), name: s.name, color: s.color_hex || null })),
    badges: [...badges.entries()]
      .map(([id, products]) => ({ id, name: id.replace(/_/g, ' '), products }))
      .sort((a, b) => b.products - a.products),
  });
});

// GET /api/pos/reports/calendar-detail?from=YYYY-MM-DD HH:MM&to=…
// Breakdown behind one plotted block: tenders, order count, categories, items.
router.get('/calendar-detail', async (req, res) => {
  const rawFrom = String(req.query.from || '').trim();
  const rawTo = String(req.query.to || '').trim();
  if (!DT_RE.test(rawFrom) || !DT_RE.test(rawTo)) {
    return res.status(400).json({ error: 'from/to must be YYYY-MM-DD[ HH:MM[:SS]]' });
  }
  const pad = (s, tail) => (s.length === 10 ? `${s} ${tail}` : s.length === 16 ? `${s}:${tail.slice(-2)}` : s);
  const start = pad(rawFrom, '00:00:00');
  const end = pad(rawTo, '23:59:59');
  const method = walletMethodExpr('pay');

  const [tenders, cakeTenders, head, categories, items] = await Promise.all([
    dbAll(
      `SELECT ${method} AS method, SUM(pay.amount) AS amount
       FROM pos_payments pay
       JOIN pos_orders o ON o.id = pay.order_id
       WHERE o.status = 'CLOSED' AND o.closed_at >= ? AND o.closed_at <= ?
       GROUP BY method`,
      [start, end]
    ),
    dbAll(
      `SELECT ${method} AS method, SUM(pay.amount) AS amount
       FROM pos_payments pay
       JOIN cake_orders co ON co.id = pay.cake_order_id
       WHERE co.deleted_at IS NULL AND pay.created_at >= ? AND pay.created_at <= ?
       GROUP BY method`,
      [start, end]
    ),
    dbAll(
      `SELECT COUNT(*) AS orders, SUM(o.total_amount) AS amount,
              SUM(o.discount_amount) AS discount, SUM(o.change_amount) AS change_amount
       FROM pos_orders o
       WHERE o.status = 'CLOSED' AND o.closed_at >= ? AND o.closed_at <= ?`,
      [start, end]
    ),
    dbAll(
      `SELECT COALESCE(c.name, 'Uncategorized') AS name,
              SUM(ki.quantity) AS qty, SUM(ki.quantity * ki.unit_price) AS amount
       ${SALES_JOIN}
       WHERE o.status = 'CLOSED' AND o.closed_at >= ? AND o.closed_at <= ?
       GROUP BY name
       ORDER BY amount DESC`,
      [start, end]
    ),
    dbAll(
      `SELECT ${PRODUCT_NAME} AS name, COALESCE(c.name, 'Uncategorized') AS category_name,
              SUM(ki.quantity) AS qty, SUM(ki.quantity * ki.unit_price) AS amount
       ${SALES_JOIN}
       WHERE o.status = 'CLOSED' AND o.closed_at >= ? AND o.closed_at <= ?
       GROUP BY name, category_name
       ORDER BY amount DESC
       LIMIT 25`,
      [start, end]
    ),
  ]);

  const byMethod = new Map();
  for (const r of [...tenders, ...cakeTenders]) {
    byMethod.set(r.method, round2((byMethod.get(r.method) || 0) + Number(r.amount || 0)));
  }
  const change = Number(head[0]?.change_amount) || 0;
  if (change) byMethod.set('CASH', round2((byMethod.get('CASH') || 0) - change));

  res.json({
    from: start,
    to: end,
    orders: Number(head[0]?.orders) || 0,
    amount: round2(head[0]?.amount),
    discount: round2(head[0]?.discount),
    tenders: [...byMethod.entries()].map(([m, amount]) => ({ method: m, amount })).sort((a, b) => b.amount - a.amount),
    categories: categories.map(r => ({ name: r.name, qty: Number(r.qty) || 0, amount: round2(r.amount) })),
    items: items.map(r => ({
      name: r.name, category_name: r.category_name,
      qty: Number(r.qty) || 0, amount: round2(r.amount),
    })),
  });
});

// GET /api/pos/reports/calendar-holidays?from=&to=&refresh=1
router.get('/calendar-holidays', async (req, res) => {
  if (req.query.refresh) await holidayCalendar.sync({ force: true });
  res.json({
    ...holidayCalendar.status(),
    holidays: holidayCalendar.getHolidays(req.query.from, req.query.to),
  });
});

module.exports = router;
