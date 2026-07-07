'use strict';
const express      = require('express');
const { dbAll, dbGet, dbRun } = require('../../pos/db');
const { requireSession } = require('../../middleware/posAuth');
const socketServer = require('../../pos/socketServer');
const { getNepalDayBoundsUTC } = require('../../utils/nepalDateTime');

const router = express.Router();
router.use(requireSession);

// ── GET /api/pos/waiter/table-tags ───────────────────────────
// Returns TABLE_TAG items from lookup_master (configurable via File Maintenance)
router.get('/table-tags', async (req, res) => {
  res.json(await dbAll(
    `SELECT id, code, name, value, sort_order
     FROM lookup_master
     WHERE lookup_type = 'TABLE_TAG' AND is_active = 1
     ORDER BY sort_order, name`
  ));
});

// ── GET /api/pos/waiter/stats ─────────────────────────────────
// Waiter performance for the logged-in user today
router.get('/stats', async (req, res) => {
  const userId = req.query.userId || req.posUser.id;
  const { start, end } = getNepalDayBoundsUTC();

  const ordersToday = (await dbGet(
    `SELECT COUNT(*) AS c FROM pos_orders
     WHERE punched_by = ? AND created_at >= ? AND created_at < ?
       AND status NOT IN ('CANCELLED')`,
    [userId, start, end]
  )).c;

  const tablesServed = (await dbGet(
    `SELECT COUNT(DISTINCT table_id) AS c FROM pos_orders
     WHERE punched_by = ? AND table_id IS NOT NULL
       AND created_at >= ? AND created_at < ?
       AND status IN ('CLOSED')`,
    [userId, start, end]
  )).c;

  // Avg minutes from order created_at to first item served
  const avgRaw = (await dbGet(
    `SELECT AVG(
       TIMESTAMPDIFF(SECOND, o.created_at, ki.served_at) / 60
     ) AS avg_min
     FROM pos_orders o
     JOIN pos_kots k ON k.order_id = o.id
     JOIN pos_kot_items ki ON ki.kot_id = k.id
     WHERE o.punched_by = ?
       AND o.created_at >= ? AND o.created_at < ?
       AND ki.status = 'SERVED' AND ki.served_at IS NOT NULL`,
    [userId, start, end]
  )).avg_min;

  const avgServiceMin = avgRaw ? Math.round(avgRaw) : null;

  res.json({ ordersToday, tablesServed, avgServiceMin });
});

// ── GET /api/pos/waiter/table/:tableId/last-order ─────────────
// Items from the most recent CLOSED order for this table — for Repeat Last Order
router.get('/table/:tableId/last-order', async (req, res) => {
  const order = await dbGet(
    `SELECT id FROM pos_orders
     WHERE table_id = ? AND status = 'CLOSED'
     ORDER BY closed_at DESC LIMIT 1`,
    [req.params.tableId]
  );

  if (!order) return res.json({ items: [] });

  const items = await dbAll(
    `SELECT ki.product_id, ki.product_name, ki.unit_price,
            SUM(ki.quantity) AS quantity, ki.variant_id
     FROM pos_kots k
     JOIN pos_kot_items ki ON ki.kot_id = k.id
     WHERE k.order_id = ? AND ki.status != 'CANCELLED'
     GROUP BY ki.product_id, ki.variant_id, ki.product_name, ki.unit_price
     ORDER BY SUM(ki.quantity) DESC`,
    [order.id]
  );

  res.json({ orderId: order.id, items });
});

// ── GET /api/pos/waiter/top-items ─────────────────────────────
// Top 10 frequently ordered items (all waiters, last 30 days)
router.get('/top-items', async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const items = await dbAll(
    `SELECT ki.product_id, ki.product_name,
            COALESCE(p.pos_price, 0) AS price,
            SUM(ki.quantity) AS total_ordered
     FROM pos_kot_items ki
     LEFT JOIN products p ON p.id = ki.product_id
     WHERE ki.status != 'CANCELLED'
       AND ki.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       AND p.pos_active = 1 AND p.status = 'active'
     GROUP BY ki.product_id, ki.product_name
     ORDER BY total_ordered DESC
     LIMIT ?`,
    [limit]
  );
  res.json(items);
});

// ── POST /api/pos/waiter/calls ────────────────────────────────
// Trigger a waiter call alert for a table
router.post('/calls', async (req, res) => {
  const { table_id } = req.body;
  if (!table_id) return res.status(400).json({ error: 'table_id required' });

  const table = await dbGet(`SELECT * FROM pos_restaurant_tables WHERE id = ?`, [table_id]);
  if (!table) return res.status(404).json({ error: 'Table not found' });

  // Resolve any existing pending call for this table first
  await dbRun(
    `UPDATE waiter_calls SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP
     WHERE table_id = ? AND status = 'PENDING'`,
    [table_id]
  );

  const result = await dbGet(
    `INSERT INTO waiter_calls (table_id, table_name) VALUES (?,?) RETURNING *`,
    [table_id, table.name]
  );

  socketServer.emitWaiterCall({ id: result.id, table_id, table_name: table.name });
  res.status(201).json(result);
});

// ── GET /api/pos/waiter/calls/active ─────────────────────────
router.get('/calls/active', async (req, res) => {
  res.json(await dbAll(
    `SELECT * FROM waiter_calls WHERE status = 'PENDING' ORDER BY created_at`
  ));
});

// ── PATCH /api/pos/waiter/calls/:id/resolve ───────────────────
router.patch('/calls/:id/resolve', async (req, res) => {
  await dbRun(
    `UPDATE waiter_calls SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [req.params.id]
  );
  socketServer.emitWaiterCallResolved({ id: Number(req.params.id) });
  res.json({ ok: true });
});

module.exports = router;
