'use strict';
const { Server } = require('socket.io');
const { dbGet }   = require('./db');
const tracker     = require('../services/deviceTracker');

// Station slug → room name mapping (matches station names in DB, lowercase)
const STATION_ROOMS = {
  kitchen:  'station-kitchen',
  pizzeria: 'station-pizzeria',
  barista:  'station-barista',
  bakery:   'station-bakery',
  dessert:  'station-dessert',
};

let io = null;

function init(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: (origin, cb) => cb(null, true),
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // ── Auth middleware ────────────────────────────────────────────
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token || token === 'dev-session') return next(); // dev bypass
    const session = await dbGet(
      `SELECT s.*, u.id AS uid FROM pos_sessions s
       JOIN pos_users u ON u.id = s.user_id
       WHERE s.token = ? AND s.ended_at IS NULL AND u.is_active = 1`,
      [token]
    );
    if (!session) return next(new Error('Unauthorized'));
    socket.data.userId = session.uid;
    next();
  });

  io.on('connection', (socket) => {
    const role = socket.handshake.query?.role ?? 'pos';

    if (role === 'customer') {
      // Customer QR app — join order-specific room(s) for live notifications
      const orderId = socket.handshake.query?.orderId;
      if (orderId) socket.join(`order-${orderId}`);
      // Client may track several open orders for its table (across reloads/multiple KOTs)
      socket.on('join-order',   (id) => { if (id) socket.join(`order-${id}`); });
      // Orders awaiting POS approval — no pos_order_id yet, tracked by pending id
      socket.on('join-pending', (id) => { if (id) socket.join(`pending-${id}`); });
      socket.on('disconnect', () => {});
      return; // customers don't join pos/kds rooms
    }

    if (role === 'kds') {
      socket.join('kds');
    } else if (role === 'waiter') {
      socket.join('pos');
      socket.join('waiter');
    } else if (role === 'cake_production') {
      socket.join('cake_production');
    } else {
      socket.join('pos');
    }

    const station = socket.handshake.query?.station;
    if (station && STATION_ROOMS[station.toLowerCase()]) {
      socket.join(STATION_ROOMS[station.toLowerCase()]);
    }

    tracker.register(socket);
    socket.on('heartbeat', () => tracker.heartbeat(socket.id));
    socket.on('disconnect', () => tracker.unregister(socket.id));
  });

  return io;
}

// ── Emit helpers used by route handlers ───────────────────────

async function emitNewOrder(orderPayload) {
  if (!io) return;
  io.to('kds').emit('new-order', orderPayload);
  io.to('pos').emit('new-order', orderPayload);

  // Also emit to station rooms based on which stations have items
  const stationIds = [...new Set(
    (orderPayload.kots ?? []).flatMap(k => (k.items ?? []).map(i => i.station_id).filter(Boolean))
  )];
  for (const sid of stationIds) {
    const row = await dbGet(`SELECT name FROM pos_stations WHERE id=?`, [sid]);
    if (!row) continue;
    const room = STATION_ROOMS[row.name.toLowerCase()];
    if (room) io.to(room).emit('new-order', orderPayload);
  }
}

function emitOrderUpdated(orderPayload) {
  if (!io) return;
  io.to('kds').emit('order-updated', orderPayload);
  io.to('pos').emit('order-updated', orderPayload);
}

async function emitItemServed(payload) {
  if (!io) return;
  // payload: { kotId, orderId, itemId, status, served_at, station_id? }
  io.to('kds').emit('item-served', payload);
  io.to('pos').emit('item-served', payload);
  if (payload.station_id) {
    const row = await dbGet(`SELECT name FROM pos_stations WHERE id=?`, [payload.station_id]);
    if (row) {
      const room = STATION_ROOMS[row.name.toLowerCase()];
      if (room) io.to(room).emit('item-served', payload);
    }
  }
  if (payload.orderId) io.to(`order-${payload.orderId}`).emit('item-updated', payload);
}

function emitOrderCompleted(payload) {
  if (!io) return;
  io.to('kds').emit('order-completed', payload);
  io.to('pos').emit('order-completed', payload);
  // Notify customer app if connected
  const oid = payload.id || payload.order_id;
  if (oid) io.to(`order-${oid}`).emit('order-ready', { order_id: oid, status: 'CLOSED' });
}

function emitCustomerNotify(orderId, event, payload) {
  if (!io || !orderId) return;
  io.to(`order-${orderId}`).emit(event, payload);
}

async function emitItemUpdated(payload) {
  if (!io) return;
  // payload: { kotId, orderId, itemId, quantity, notes, is_home_pack, station_id? }
  io.to('kds').emit('item-updated', payload);
  io.to('pos').emit('item-updated', payload);
  if (payload.station_id) {
    const row = await dbGet(`SELECT name FROM pos_stations WHERE id=?`, [payload.station_id]);
    if (row) {
      const room = STATION_ROOMS[row.name.toLowerCase()];
      if (room) io.to(room).emit('item-updated', payload);
    }
  }
  if (payload.orderId) io.to(`order-${payload.orderId}`).emit('item-updated', payload);
}

function emitOrderCancelled(payload) {
  if (!io) return;
  io.to('kds').emit('order-cancelled', payload);
  io.to('pos').emit('order-cancelled', payload);
}

function emitWaiterCall(payload) {
  if (!io) return;
  // Emit to waiter room AND pos room so POS cashier can also see alerts
  io.to('waiter').emit('waiter-call', payload);
  io.to('pos').emit('waiter-call', payload);
}

function emitWaiterCallResolved(payload) {
  if (!io) return;
  io.to('waiter').emit('waiter-call-resolved', payload);
}

function emitCakeProductionChanged({ cake_order_id, kind }) {
  if (!io) return;
  io.to('cake_production').emit('cake_production_changed', { cake_order_id, kind, at: new Date().toISOString() });
}

function emitTablesUpdated() {
  if (!io) return;
  io.to('pos').emit('tables-updated');
  io.to('waiter').emit('tables-updated');
}

// Menu data changed (products/categories/variants/modifiers/pricing) —
// POS clients refetch and update their local caches.
function emitMenuUpdated(version) {
  if (!io) return;
  io.to('pos').emit('menu-updated', { version });
}

// New pending web order imported from the website — POS screens show a popup,
// play the web_order sound and refresh the Web Orders badge.
function emitWebOrderReceived(payload) {
  if (!io) return;
  io.to('pos').emit('web-order-received', payload);
}

// POS approved/rejected a pending order — tell the customer waiting on it
function emitPendingApproved(pendingId, payload) {
  if (!io || !pendingId) return;
  io.to(`pending-${pendingId}`).emit('pending-approved', payload);
}
function emitPendingRejected(pendingId, payload) {
  if (!io || !pendingId) return;
  io.to(`pending-${pendingId}`).emit('pending-rejected', payload);
}

module.exports = { init, emitNewOrder, emitOrderUpdated, emitItemServed, emitItemUpdated, emitOrderCompleted, emitOrderCancelled, emitWaiterCall, emitWaiterCallResolved, emitCustomerNotify, emitTablesUpdated, emitMenuUpdated, emitCakeProductionChanged, emitWebOrderReceived, emitPendingApproved, emitPendingRejected };
