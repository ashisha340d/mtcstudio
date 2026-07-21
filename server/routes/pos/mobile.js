'use strict';
const express = require('express');
const crypto  = require('crypto');
const { dbAll, dbGet, dbRun } = require('../../pos/db');
const cmsDb   = require('../../database/db');
const { requireSession } = require('../../middleware/posAuth');
const { audit }          = require('../../middleware/posAudit');
const socketServer       = require('../../pos/socketServer');
const { authenticatePin } = require('./auth');
const { uploadCallRecording } = require('../../middleware/upload');
const { getNepalDateStr, getNepalDayBoundsUTC } = require('../../utils/nepalDateTime');

const router = express.Router();

const MOBILE_API_ENABLED = String(process.env.MOBILE_API_ENABLED ?? 'true').toLowerCase() !== 'false';
router.use((req, res, next) => {
  if (!MOBILE_API_ENABLED) return res.status(503).json({ error: 'Mobile API disabled' });
  next();
});

function normalizePhone(phone) {
  return String(phone || '').replace(/[\s\-]/g, '').replace(/^\+?977/, '').replace(/^0+/, '');
}

// ── Auth ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { pin, deviceId } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN required' });

  const matched = await authenticatePin(pin);
  if (!matched) return res.status(401).json({ error: 'Incorrect PIN' });

  const token = crypto.randomUUID();
  const sess  = await dbGet(
    `INSERT INTO pos_sessions (user_id, token, terminal_id) VALUES (?,?,?) RETURNING id`,
    [matched.id, token, deviceId ?? null]
  );
  audit({ userId: matched.id, sessionId: sess.id, entityType: 'SESSION', entityId: sess.id, action: 'MOBILE_LOGIN' });

  res.json({
    sessionId: token,
    user: { id: matched.id, name: matched.name, employee_id: matched.employee_id, role: matched.role },
  });
});

router.post('/logout', requireSession, async (req, res) => {
  await dbRun(`UPDATE pos_sessions SET ended_at = CURRENT_TIMESTAMP WHERE id = ?`, [req.posSessionId]);
  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'SESSION', entityId: req.posSessionId, action: 'MOBILE_LOGOUT' });
  res.json({ ok: true });
});

router.use(requireSession);

// ── Device lifecycle ─────────────────────────────────────────
router.post('/pair', async (req, res) => {
  const { deviceId, deviceName, restaurantId, appVersion, platform } = req.body;
  if (!deviceId) return res.status(400).json({ error: 'deviceId required' });

  const existing = await dbGet(`SELECT id FROM pos_devices WHERE device_id=?`, [deviceId]);
  let device;
  if (existing) {
    await dbRun(
      `UPDATE pos_devices SET device_name=?, restaurant_id=?, app_version=?, platform=?, paired_by_user_id=?, status='ACTIVE', last_seen=CURRENT_TIMESTAMP
       WHERE id=?`,
      [deviceName ?? null, restaurantId ?? null, appVersion ?? null, platform ?? null, req.posUser.id, existing.id]
    );
    device = await dbGet(`SELECT * FROM pos_devices WHERE id=?`, [existing.id]);
  } else {
    device = await dbGet(
      `INSERT INTO pos_devices (device_id, device_name, restaurant_id, app_version, platform, paired_by_user_id, last_seen)
       VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP) RETURNING *`,
      [deviceId, deviceName ?? null, restaurantId ?? null, appVersion ?? null, platform ?? null, req.posUser.id]
    );
  }

  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'DEVICE', entityId: device.id, action: 'PAIR' });
  res.json({ success: true, device });
});

router.post('/heartbeat', async (req, res) => {
  const { deviceId, battery, wifi, network, appVersion } = req.body;
  if (!deviceId) return res.status(400).json({ error: 'deviceId required' });

  const result = await dbRun(
    `UPDATE pos_devices SET battery=?, wifi=?, network=?, app_version=COALESCE(?,app_version), last_seen=CURRENT_TIMESTAMP WHERE device_id=?`,
    [battery ?? null, wifi ?? null, network ?? null, appVersion ?? null, deviceId]
  );
  if (!result || result.changes === 0) return res.status(404).json({ error: 'Device not paired' });
  res.json({ success: true });
});

// ── Incoming call ─────────────────────────────────────────────
router.post('/incoming-call', async (req, res) => {
  const { deviceId, phone, timestamp } = req.body;
  if (!deviceId || !phone) return res.status(400).json({ error: 'deviceId and phone required' });
  const normPhone = normalizePhone(phone);

  const [posCustomer, crmCustomer, addresses, notes, cakeBalanceRow, lastOrder, orderCountRow, pendingOrders, cakeOrdersToday, orderHistory] = await Promise.all([
    dbGet(`SELECT * FROM pos_customers WHERE phone=?`, [normPhone]),
    cmsDb.dbGet(`SELECT * FROM customers WHERE phone=?`, [normPhone]),
    dbAll(`SELECT id,label,address,is_default FROM pos_customer_addresses WHERE phone=? ORDER BY is_default DESC, id`, [normPhone]),
    dbAll(`SELECT id,note,created_at FROM pos_customer_notes WHERE phone=? ORDER BY created_at DESC`, [normPhone]),
    dbGet(`SELECT COALESCE(SUM(balance_due),0) AS balance FROM cake_orders WHERE phone=? AND balance_due>0 AND status NOT IN ('DELIVERED','CANCELLED','REFUNDED')`, [normPhone]),
    dbGet(`SELECT * FROM pos_orders WHERE customer_phone=? ORDER BY created_at DESC LIMIT 1`, [normPhone]),
    dbGet(`SELECT COUNT(*) AS n FROM pos_orders WHERE customer_phone=?`, [normPhone]),
    dbAll(`SELECT id,order_type,status,total_amount,created_at FROM pos_orders WHERE customer_phone=? AND status IN ('OPEN','SAVED') AND DATE(created_at)=CURDATE() ORDER BY created_at DESC`, [normPhone]),
    dbAll(`SELECT id,order_number,status,grand_total,balance_due,delivery_date,delivery_time FROM cake_orders WHERE phone=? AND status NOT IN ('DELIVERED','CANCELLED','REFUNDED') AND (DATE(order_date)=CURDATE() OR DATE(delivery_date)=CURDATE())`, [normPhone]),
    dbAll(`SELECT id,order_type,status,total_amount,created_at FROM pos_orders WHERE customer_phone=? ORDER BY created_at DESC LIMIT 10`, [normPhone]),
  ]);

  const customer = { ...(crmCustomer ?? {}), ...(posCustomer ?? {}) };
  const loyaltyPoints = crmCustomer?.loyalty_points ?? 0;
  const rewardsTier = crmCustomer?.rewards_tier ?? 'standard';

  const call = await dbGet(
    `INSERT INTO pos_call_events (device_id, phone, pos_customer_id, customer_name, status, created_by)
     VALUES (?,?,?,?,'INCOMING',?) RETURNING *`,
    [deviceId, normPhone, posCustomer?.id ?? null, customer.name ?? null, req.posUser.id]
  );

  const payload = {
    callId: call.id,
    customer: Object.keys(customer).length ? customer : null,
    loyalty: { loyalty_points: loyaltyPoints, rewards_tier: rewardsTier, vip: rewardsTier !== 'standard' },
    addresses,
    lastOrder: lastOrder ?? null,
    orderCount: orderCountRow?.n ?? 0,
    cakeBalance: Number(cakeBalanceRow?.balance ?? 0),
    notes,
    pendingOrders,
    cakeOrdersToday,
    orderHistory,
  };

  socketServer.emitIncomingCall({
    callId: call.id, customer: payload.customer, phone: normPhone,
    timestamp: timestamp ?? new Date().toISOString(), device: deviceId,
    vip: payload.loyalty.vip, loyalty: payload.loyalty, lastOrder: payload.lastOrder, cakeBalance: payload.cakeBalance,
    orderCount: payload.orderCount, pendingOrders, cakeOrdersToday, orderHistory,
  });

  res.status(201).json(payload);
});

// ── Call events ───────────────────────────────────────────────
router.post('/call-answered', async (req, res) => {
  const { callId, startTime } = req.body;
  if (!callId) return res.status(400).json({ error: 'callId required' });
  const result = await dbRun(`UPDATE pos_call_events SET status='ANSWERED', start_time=? WHERE id=?`, [new Date(startTime || Date.now()), callId]);
  if (!result || result.changes === 0) return res.status(404).json({ error: 'Call not found' });
  const call = await dbGet(`SELECT * FROM pos_call_events WHERE id=?`, [callId]);
  socketServer.emitCallAnswered({ callId: call.id, phone: call.phone, deviceId: call.device_id });
  res.json({ success: true });
});

router.post('/call-ended', async (req, res) => {
  const { callId, endTime, duration } = req.body;
  if (!callId) return res.status(400).json({ error: 'callId required' });
  const result = await dbRun(`UPDATE pos_call_events SET status='ENDED', end_time=?, duration_seconds=? WHERE id=?`, [new Date(endTime || Date.now()), duration ?? null, callId]);
  if (!result || result.changes === 0) return res.status(404).json({ error: 'Call not found' });
  const call = await dbGet(`SELECT * FROM pos_call_events WHERE id=?`, [callId]);
  socketServer.emitCallEnded({ callId: call.id, phone: call.phone, deviceId: call.device_id, duration: call.duration_seconds });
  res.json({ success: true });
});

router.post('/missed-call', async (req, res) => {
  const { callId, deviceId, phone } = req.body;
  let call;
  if (callId) {
    const result = await dbRun(`UPDATE pos_call_events SET status='MISSED' WHERE id=?`, [callId]);
    call = result && result.changes ? await dbGet(`SELECT * FROM pos_call_events WHERE id=?`, [callId]) : null;
  } else if (deviceId && phone) {
    call = await dbGet(
      `INSERT INTO pos_call_events (device_id, phone, status, created_by) VALUES (?,?,'MISSED',?) RETURNING *`,
      [deviceId, normalizePhone(phone), req.posUser.id]
    );
  } else {
    return res.status(400).json({ error: 'callId or (deviceId and phone) required' });
  }
  if (!call) return res.status(404).json({ error: 'Call not found' });
  socketServer.emitMissedCall({ callId: call.id, phone: call.phone, deviceId: call.device_id });
  res.json({ success: true });
});

// ── Recording upload ──────────────────────────────────────────
router.post('/upload-recording', uploadCallRecording.single('audio'), async (req, res) => {
  const { deviceId, customerId, callId } = req.body;
  if (!req.file) return res.status(400).json({ error: 'audio file required' });
  if (!callId) return res.status(400).json({ error: 'callId required' });

  const recordingPath = `call-recordings/${req.file.filename}`;
  const result = await dbRun(`UPDATE pos_call_events SET recording_path=? WHERE id=?`, [recordingPath, callId]);
  if (!result || result.changes === 0) return res.status(404).json({ error: 'Call not found' });
  const call = await dbGet(`SELECT * FROM pos_call_events WHERE id=?`, [callId]);

  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'CALL_EVENT', entityId: call.id, action: 'UPLOAD_RECORDING', delta: { deviceId, customerId } });
  res.json({ success: true, recording_path: recordingPath });
});

// ── Dashboard (Home tab): tender split, top items, hot categories ──
router.get('/dashboard', async (req, res) => {
  const dateStr = req.query.date || getNepalDateStr();
  const { start, end } = getNepalDayBoundsUTC(dateStr);

  const [openRow, closedRow, orderPayments, cakePayments, changeRow, itemRows] = await Promise.all([
    dbGet(`SELECT COUNT(*) AS n FROM pos_orders WHERE status IN ('OPEN','SAVED') AND created_at >= ? AND created_at <= ?`, [start, end]),
    dbGet(`SELECT COUNT(*) AS n FROM pos_orders WHERE status='CLOSED' AND closed_at >= ? AND closed_at <= ?`, [start, end]),
    dbAll(
      `SELECT p.method, SUM(p.amount) AS amount
         FROM pos_payments p JOIN pos_orders o ON o.id = p.order_id
        WHERE o.status='CLOSED' AND o.closed_at >= ? AND o.closed_at <= ?
        GROUP BY p.method`, [start, end]),
    dbAll(
      `SELECT p.method, SUM(p.amount) AS amount
         FROM pos_payments p JOIN cake_orders co ON co.id = p.cake_order_id
        WHERE p.cake_order_id IS NOT NULL AND co.deleted_at IS NULL
          AND p.created_at >= ? AND p.created_at <= ?
        GROUP BY p.method`, [start, end]),
    dbGet(`SELECT COALESCE(SUM(change_amount),0) AS chg FROM pos_orders
            WHERE status='CLOSED' AND closed_at >= ? AND closed_at <= ?`, [start, end]),
    dbAll(
      `SELECT ki.product_id, MAX(ki.product_name) AS name,
              p.category_id, MAX(c.name) AS category_name,
              SUM(ki.quantity) AS qty,
              SUM(ki.quantity * ki.unit_price - COALESCE(ki.discount_amount,0)) AS amount
         FROM pos_kot_items ki
         JOIN pos_kots k   ON k.id = ki.kot_id
         JOIN pos_orders o ON o.id = k.order_id
         LEFT JOIN products p   ON p.id = ki.product_id
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE ki.status <> 'CANCELLED'
          AND o.status='CLOSED' AND o.closed_at >= ? AND o.closed_at <= ?
        GROUP BY ki.product_id, p.category_id
        ORDER BY qty DESC`, [start, end]),
  ]);

  let cash = 0, fonePay = 0, ledger = 0;
  for (const p of [...orderPayments, ...cakePayments]) {
    const amt = Number(p.amount || 0);
    if (p.method === 'CASH') cash += amt;
    else if (p.method === 'QR' || p.method === 'CARD') fonePay += amt;
    else if (p.method === 'LEDGER') ledger += amt;
  }
  cash -= Number(changeRow?.chg || 0);   // net out change given back
  const r2 = n => Math.round(n * 100) / 100;

  // Category rollup with per-category item detail (drill-down is offline on the phone)
  const catMap = new Map();
  for (const it of itemRows) {
    const key = it.category_id ?? 0;
    if (!catMap.has(key)) catMap.set(key, {
      categoryId: it.category_id, name: it.category_name || 'Other', qty: 0, amount: 0, items: [],
    });
    const cat = catMap.get(key);
    cat.qty += Number(it.qty);
    cat.amount = r2(cat.amount + Number(it.amount || 0));
    cat.items.push({ productId: it.product_id, name: it.name, qty: Number(it.qty), amount: r2(Number(it.amount || 0)) });
  }
  const categories = [...catMap.values()].sort((a, b) => b.qty - a.qty);
  categories.forEach(cat => cat.items.sort((a, b) => b.qty - a.qty));

  res.json({
    date: dateStr,
    openOrders: Number(openRow?.n ?? 0),
    closedOrders: Number(closedRow?.n ?? 0),
    sales: {
      cash: r2(cash), fonePay: r2(fonePay), ledger: r2(ledger),
      total: r2(cash + fonePay + ledger),
    },
    topItems: itemRows.slice(0, 5).map(it => ({
      productId: it.product_id, name: it.name, qty: Number(it.qty), amount: r2(Number(it.amount || 0)),
    })),
    categories,
  });
});

// ── Open orders (Orders tab): today's only, newest first.
// POS orders (with fired items only) + today's scheduled + today's cake orders.
router.get('/open-orders', async (_req, res) => {
  const { start, end } = getNepalDayBoundsUTC();
  const dateStr = getNepalDateStr();

  const [orders, scheduled, cakes] = await Promise.all([
    dbAll(
      `SELECT o.id, o.order_type, o.status, o.customer_name, o.customer_phone,
              o.total_amount, o.created_at,
              TIMESTAMPDIFF(MINUTE, o.created_at, NOW()) AS elapsed_min,
              t.name AS table_name
         FROM pos_orders o
         LEFT JOIN pos_restaurant_tables t ON t.id = o.table_id
        WHERE o.status IN ('OPEN','SAVED')
          AND o.created_at >= ? AND o.created_at <= ?
        ORDER BY o.created_at DESC`, [start, end]),
    dbAll(
      `SELECT id, order_type, customer_name, customer_phone, order_caption,
              scheduled_for, items_json, total_amount
         FROM pos_scheduled_orders
        WHERE status='PENDING' AND scheduled_for >= ? AND scheduled_for <= ?
        ORDER BY scheduled_for ASC`, [start, end]),
    dbAll(
      `SELECT id, order_number, customer_name, phone, grand_total, balance_due,
              delivery_date, delivery_time, status, message_on_cake
         FROM cake_orders
        WHERE deleted_at IS NULL AND delivery_date = ?
          AND status NOT IN ('DELIVERED','CANCELLED','REFUNDED')
        ORDER BY id DESC`, [dateStr]),
  ]);

  let byOrder = {};
  if (orders.length) {
    const ph = orders.map(() => '?').join(',');
    const items = await dbAll(
      `SELECT k.order_id, ki.product_name AS name, ki.quantity AS qty, ki.status,
              TIMESTAMPDIFF(MINUTE, k.created_at, ki.served_at) AS served_in_min
         FROM pos_kot_items ki JOIN pos_kots k ON k.id = ki.kot_id
        WHERE k.order_id IN (${ph}) AND ki.status <> 'CANCELLED'
        ORDER BY k.order_id, ki.id`, orders.map(o => o.id));
    for (const i of items) (byOrder[i.order_id] ??= []).push(i);
  }

  const posOut = orders
    .map(o => {
      const its = byOrder[o.id] || [];
      const total = its.length;
      const served = its.filter(i => i.status === 'SERVED').length;
      const ready  = its.filter(i => i.status === 'READY').length;
      const stage = total > 0 && served === total ? 'SERVED'
                  : total > 0 && served + ready === total && ready > 0 ? 'READY'
                  : 'PREPARING';
      const servedIn = stage === 'SERVED'
        ? Math.max(0, ...its.map(i => Number(i.served_in_min ?? 0)))
        : null;
      return {
        id: o.id, kind: 'POS', orderType: o.order_type, status: o.status, stage,
        tableName: o.table_name, customerName: o.customer_name,
        customerPhone: o.customer_phone,
        total: Number(o.total_amount || 0), createdAt: o.created_at,
        elapsedMin: Number(o.elapsed_min ?? 0),
        servedInMin: servedIn, timeLabel: null,
        items: its.map(i => ({ name: i.name, qty: Number(i.qty), status: i.status })),
      };
    })
    // Draft-only orders (no fired KOT lines) have nothing to show — hide them.
    .filter(o => o.items.length > 0);

  const schedOut = scheduled.map(s => {
    let items = [];
    try { items = s.items_json ? JSON.parse(s.items_json) : []; } catch { items = []; }
    return {
      id: s.id, kind: 'SCHEDULED', orderType: s.order_type, status: 'PENDING',
      stage: 'SCHEDULED', tableName: null,
      customerName: s.customer_name || s.order_caption,
      customerPhone: s.customer_phone,
      total: Number(s.total_amount || 0), createdAt: s.scheduled_for,
      elapsedMin: 0, servedInMin: null,
      timeLabel: `Fires ${String(s.scheduled_for || '').slice(11, 16)}`,
      items: items.map(i => ({
        name: i.product_name || i.name || 'Item', qty: Number(i.quantity || 1), status: 'ORDERSENT',
      })),
    };
  });

  const cakeOut = cakes.map(c => ({
    id: c.id, kind: 'CAKE', orderType: 'CAKE', status: c.status,
    stage: 'CAKE', tableName: null,
    customerName: c.customer_name, customerPhone: c.phone,
    total: Number(c.grand_total || 0), createdAt: null,
    elapsedMin: 0, servedInMin: null,
    timeLabel: `Delivery ${c.delivery_time || 'today'}`,
    items: [{
      name: c.message_on_cake ? `${c.order_number} — “${c.message_on_cake}”` : c.order_number,
      qty: 1, status: 'ORDERSENT',
    }],
  }));

  res.json({ orders: [...posOut, ...schedOut, ...cakeOut] });
});

module.exports = router;
