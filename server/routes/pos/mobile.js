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

module.exports = router;
