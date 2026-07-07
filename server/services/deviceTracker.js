'use strict';

// In-memory device registry — keyed by socket.id
const devices = new Map();

const VALID_TYPES = new Set(['pos', 'waiter', 'kds', 'admin', 'unknown']);

function register(socket) {
  const type = VALID_TYPES.has(socket.handshake.query?.role)
    ? socket.handshake.query.role
    : 'unknown';

  devices.set(socket.id, {
    socketId:   socket.id,
    ip:         socket.handshake.address,
    type,
    userAgent:  socket.handshake.headers?.['user-agent'] || '',
    connectedAt: new Date().toISOString(),
    lastSeen:   new Date().toISOString(),
  });
}

function unregister(socketId) {
  devices.delete(socketId);
}

function heartbeat(socketId) {
  const d = devices.get(socketId);
  if (d) d.lastSeen = new Date().toISOString();
}

function getAll() {
  return Array.from(devices.values());
}

function getSummary() {
  const all = getAll();
  return {
    total:  all.length,
    pos:    all.filter(d => d.type === 'pos').length,
    waiter: all.filter(d => d.type === 'waiter').length,
    kds:    all.filter(d => d.type === 'kds').length,
    admin:  all.filter(d => d.type === 'admin').length,
  };
}

module.exports = { register, unregister, heartbeat, getAll, getSummary };
