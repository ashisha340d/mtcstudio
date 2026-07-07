'use strict';

// SSE client registry — each entry is an express Response object
const clients = new Set();

function subscribe(res) {
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(msg); } catch { clients.delete(res); }
  }
}

module.exports = { subscribe, broadcast };
