'use strict';
// SMS transport layer — a raw `ws` server the Android Companion devices connect
// to at ws://host:PORT/ws/sms?token=<session>&deviceId=<id>. Holds one live
// socket per authenticated device, pushes send_sms / cancel_sms jobs, and relays
// device status frames (sms_queued/sending/sent/delivered/failed) back to the
// SMS Service. No module talks to Android directly — only through this gateway.
const WebSocket = require('ws');
const { WebSocketServer } = WebSocket;
const { dbGet } = require('../pos/db');

let wss = null;
const devices = new Map();      // deviceId -> ws
let rrIndex = 0;                // round-robin cursor across online devices

const statusHandlers = [];
const connectHandlers = [];
const disconnectHandlers = [];

// Same session check the socket.io middleware uses; 'dev-session' bypass for dev.
async function authToken(token) {
  if (!token || token === 'dev-session') return { userId: null };
  const session = await dbGet(
    `SELECT s.id, u.id AS uid FROM pos_sessions s
       JOIN pos_users u ON u.id = s.user_id
      WHERE s.token = ? AND s.ended_at IS NULL AND u.is_active = 1`,
    [token]
  );
  return session ? { userId: session.uid } : null;
}

function init() {
  wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws, req, ctx) => {
    const { deviceId } = ctx;
    // One active session per device — a fresh socket replaces any stale one.
    const prev = devices.get(deviceId);
    if (prev && prev !== ws) { try { prev.close(4001, 'replaced'); } catch { /* ignore */ } }
    devices.set(deviceId, ws);
    ws.deviceId = deviceId;
    ws.isAlive = true;
    connectHandlers.forEach(h => { try { h(deviceId); } catch { /* ignore */ } });

    ws.on('message', (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }
      if (msg && msg.type) statusHandlers.forEach(h => { try { h({ ...msg, deviceId }); } catch { /* ignore */ } });
    });
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('close', () => {
      if (devices.get(deviceId) === ws) {
        devices.delete(deviceId);
        disconnectHandlers.forEach(h => { try { h(deviceId); } catch { /* ignore */ } });
      }
    });
    ws.on('error', () => { /* close handler does the cleanup */ });
  });

  // Ping/pong liveness — drop half-open sockets so device selection stays honest.
  setInterval(() => {
    for (const ws of devices.values()) {
      if (ws.isAlive === false) { try { ws.terminate(); } catch { /* ignore */ } continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* ignore */ }
    }
  }, 30000).unref();

  return wss;
}

// Called from app.js on the shared HTTP server's 'upgrade' event for /ws/sms.
async function handleUpgrade(req, socket, head) {
  const { searchParams } = new URL(req.url, 'http://localhost');
  const deviceId = searchParams.get('deviceId');
  if (!deviceId) { socket.destroy(); return; }
  const auth = await authToken(searchParams.get('token'));
  if (!auth) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req, { deviceId, userId: auth.userId });
  });
}

function send(deviceId, obj) {
  const ws = devices.get(deviceId);
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try { ws.send(JSON.stringify(obj)); return true; } catch { return false; }
}

function onlineDeviceIds() {
  return [...devices.entries()].filter(([, ws]) => ws.readyState === WebSocket.OPEN).map(([id]) => id);
}
function anyOnline() { return onlineDeviceIds().length > 0; }
function isOnline(id) { const ws = devices.get(id); return !!ws && ws.readyState === WebSocket.OPEN; }

// Scheduling logic — round-robin across the online devices.
function pickDevice() {
  const ids = onlineDeviceIds();
  if (!ids.length) return null;
  rrIndex = (rrIndex + 1) % ids.length;
  return ids[rrIndex];
}
function supportsCancel(deviceId) { return isOnline(deviceId); }

function onStatus(h)     { statusHandlers.push(h); }
function onConnect(h)    { connectHandlers.push(h); }
function onDisconnect(h) { disconnectHandlers.push(h); }

module.exports = {
  init, handleUpgrade, send, pickDevice,
  anyOnline, isOnline, onlineDeviceIds, supportsCancel,
  onStatus, onConnect, onDisconnect,
};
