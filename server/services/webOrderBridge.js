'use strict';
// ── Web Order Bridge ─────────────────────────────────────────────────────────
// Persistent WebSocket CLIENT to the public web-ordering server. Receives web
// orders in real time, imports them into the Pending Web Orders queue
// (web_orders_pending / web_order_items), acknowledges receipt, and pushes
// status updates (approved / rejected / ready / completed / cancelled) back.
//
//  - auto-reconnect with exponential backoff (1s → 60s)
//  - liveness watchdog (server pings us; any traffic resets the timer)
//  - offline sync on connect: { type:'sync', sinceId: MAX(web_order_id) }
//  - idempotent import keyed on web_orders_pending.web_order_id (UNIQUE)
//  - every imported order is acknowledged; duplicates are re-acknowledged
//
//  Config (server/.env.<APP_ENV>):
//    WEB_ORDER_BRIDGE_ENABLED  default true
//    WEB_ORDER_WS_URL          required
//    WEB_ORDER_BRIDGE_TOKEN    default mtc-pos-bridge-2026
const WebSocket = require('ws');
const { dbAll, dbGet, dbRun, transaction } = require('../pos/db');
const socketServer = require('../pos/socketServer');

const ENABLED = String(process.env.WEB_ORDER_BRIDGE_ENABLED ?? 'true').toLowerCase() !== 'false';
const WS_URL = process.env.WEB_ORDER_WS_URL;
const TOKEN = process.env.WEB_ORDER_BRIDGE_TOKEN || 'mtc-pos-bridge-2026';
const WATCHDOG_MS = 75_000;   // no traffic for this long → assume dead, reconnect
const PING_MS = 25_000;       // client-side ping keeps traffic flowing both ways
const BACKOFF_MAX_MS = 60_000;

let ws = null;
let backoff = 1000;
let watchdog = null;
let pinger = null;
let stopped = false;
const pendingStatusQueue = []; // status updates buffered while disconnected

const log = (...a) => console.log(new Date().toISOString(), '[web-orders]', ...a);

// ── Product resolution — map a web item onto POS products/variants ──────────
async function resolveItem(it) {
  let productId = null, variantId = null;
  if (it.kind === 'shelf' && it.pid) {
    const vid = +String(it.pid).replace('shelf-', '') || 0;
    if (vid) {
      const v = await dbGet(`SELECT id, product_id FROM product_variants WHERE id=?`, [vid]);
      if (v) { productId = v.product_id; variantId = v.id; }
    }
  }
  if (it.kind === 'product' && Number.isInteger(+it.pid)) {
    const p = await dbGet(`SELECT id FROM products WHERE id=?`, [+it.pid]);
    if (p) productId = p.id;
  }
  if (!productId && it.name) {
    // shelf / cake / renamed items — best-effort exact name match
    const p = await dbGet(`SELECT id FROM products WHERE name=? LIMIT 1`, [String(it.name)]);
    if (p) productId = p.id;
  }
  if (productId) {
    if (Number.isInteger(+it.variantId)) {
      const v = await dbGet(`SELECT id FROM product_variants WHERE id=? AND product_id=?`, [+it.variantId, productId]);
      if (v) variantId = v.id;
    }
    if (!variantId && it.variant) {
      const v = await dbGet(`SELECT id FROM product_variants WHERE product_id=? AND name=? LIMIT 1`, [productId, String(it.variant)]);
      if (v) variantId = v.id;
    }
  }
  return { productId, variantId };
}

// ── Import one pushed order into the pending queue (idempotent) ─────────────
async function importOrder(o) {
  const webOrderId = Math.floor(+o.id || 0);
  if (!webOrderId || !o.orderNumber || !Array.isArray(o.items) || !o.items.length) {
    log(`invalid order payload ignored (id=${o?.id}, number=${o?.orderNumber})`);
    return { ok: false };
  }

  const dup = await dbGet(`SELECT id FROM web_orders_pending WHERE web_order_id=?`, [webOrderId]);
  if (dup) return { ok: true, duplicate: true, pendingId: dup.id };

  const c = o.customer || {}, t = o.totals || {}, pay = o.payment || {};
  const resolved = [];
  for (const it of o.items) {
    // cake items never map to POS food products — approval books them into
    // cake_orders from their cake_json instead of a KOT line
    if (it.kind === 'cake') resolved.push({ ...it, productId: null, variantId: null });
    else resolved.push({ ...it, ...(await resolveItem(it)) });
  }

  const pendingId = await transaction(async (tx) => {
    const ins = await tx.dbRun(
      `INSERT INTO web_orders_pending
         (web_order_id, order_number, source, order_type, customer_name, customer_phone,
          customer_address, landmark, customer_notes, items_json,
          subtotal, discount, tax, delivery_charge, grand_total, distance_km,
          payment_method, payment_status, payment_reference, ordered_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [webOrderId, o.orderNumber, o.source || 'WEB_ORDERING',
       o.orderType === 'Delivery' ? 'Delivery' : 'Pickup',
       c.name || null, c.phone || null, c.address || null, c.landmark || null, c.notes || null,
       JSON.stringify(o.items),
       +t.subtotal || 0, +t.discount || 0, +t.tax || 0, +t.deliveryCharge || 0, +t.grandTotal || 0,
       t.distanceKm == null ? null : +t.distanceKm,
       pay.method || 'COD', pay.status || 'UNPAID', pay.reference || null,
       o.createdAt || null]
    );
    let sort = 0;
    for (const it of resolved) {
      await tx.dbRun(
        `INSERT INTO web_order_items
           (pending_id, web_pid, kind, product_id, variant_id, item_name, variant_name,
            quantity, unit_price, line_total, modifiers_json, special_note, sort_order, cake_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [ins.lastInsertRowid, it.pid == null ? null : String(it.pid), it.kind || 'product',
         it.productId, it.variantId, String(it.name || 'Item'), it.variant || null,
         Math.max(1, Math.floor(+it.qty || 1)), +it.unitPrice || 0, +it.lineTotal || 0,
         it.modifiers?.length ? JSON.stringify(it.modifiers) : null, it.note || null, sort++,
         it.cake ? JSON.stringify(it.cake) : null]
      );
    }
    return ins.lastInsertRowid;
  });

  const unmatched = resolved.filter(i => i.kind !== 'cake' && !i.productId).length;
  log(`imported ${o.orderNumber} (web #${webOrderId}) as pending #${pendingId}` +
      (unmatched ? ` — ${unmatched} item(s) unmatched to POS products` : ''));

  // Notify every open POS screen: popup + sound + badge refresh
  socketServer.emitWebOrderReceived({
    pendingId, webOrderId,
    orderNumber: o.orderNumber, orderType: o.orderType,
    customerName: c.name || '', customerPhone: c.phone || '',
    grandTotal: +t.grandTotal || 0, itemCount: o.items.length,
  });

  return { ok: true, pendingId };
}

// ── Outbound messages ────────────────────────────────────────────────────────
function sendRaw(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(obj)); return true; } catch (e) { log('send failed:', e.message); }
  }
  return false;
}

// Send now or buffer until reconnect (flushed in onOpen)
function sendOrQueue(msg, what) {
  if (!sendRaw(msg)) {
    pendingStatusQueue.push(msg);
    log(`${what} queued (offline)`);
  } else {
    log(`${what} sent`);
  }
}

// Status update to the website (buffered while offline, flushed on reconnect)
function sendStatus(webOrderId, status, { posOrderId = null, reason = null, progress = null, etaMinutes = null, lines = null } = {}) {
  sendOrQueue({ type: 'status', orderId: webOrderId, status, posOrderId, reason, progress, etaMinutes, lines },
    `status ${status} for web #${webOrderId}`);
}

// Relay POS-side lifecycle events (serve-all → READY, checkout → COMPLETED,
// cancel → CANCELLED) for orders that originated as web orders. No-op otherwise.
async function notifyPosOrderEvent(posOrderId, status) {
  try {
    const row = await dbGet(
      `SELECT web_order_id FROM web_orders_pending WHERE pos_order_id=? AND status='APPROVED'`,
      [posOrderId]);
    if (row) sendStatus(row.web_order_id, status, { posOrderId });
  } catch (e) { log('notifyPosOrderEvent failed:', e.message); }
}

// Per-item KDS progress for web-origin orders: counts SERVED vs total live KOT
// items on the POS order and pushes PREPARING {done,total} (website renders
// "Order Prepared (n/N)"). When every item is served it pushes READY ("Packed").
// Reads pos_kot_items only — no POS model change.
// TODO(delivery-tracking): after READY/Packed, track a delivery leg
// (OUT_FOR_DELIVERY → DELIVERED) via a rider-dispatch field/event, then relay
// it here the same way.
async function notifyKotItemProgress(posOrderId) {
  try {
    const row = await dbGet(
      `SELECT web_order_id FROM web_orders_pending WHERE pos_order_id=? AND status='APPROVED'`,
      [posOrderId]);
    if (!row) return;
    // Per-line served flags ride along so the website bill can tick items green
    const rows = await dbAll(
      `SELECT ki.product_name AS name, ki.quantity AS qty, (ki.status='SERVED') AS served
       FROM pos_kot_items ki
       JOIN pos_kots k ON k.id = ki.kot_id
       WHERE k.order_id=? AND k.status!='CANCELLED' AND ki.status!='CANCELLED'
       ORDER BY ki.id`, [posOrderId]);
    const total = rows.length;
    if (!total) return;
    const done = rows.reduce((s, r) => s + (r.served ? 1 : 0), 0);
    const lines = rows.map(r => ({ name: r.name, qty: +r.qty || 1, served: r.served ? 1 : 0 }));
    if (done >= total) sendStatus(row.web_order_id, 'READY', { posOrderId, progress: { done, total }, lines });
    else sendStatus(row.web_order_id, 'PREPARING', { posOrderId, progress: { done, total }, lines });
  } catch (e) { log('notifyKotItemProgress failed:', e.message); }
}

// KOT line edits (item added / qty change / cancel) on a web-origin order:
// push the exact live bill snapshot so the website bill mirrors the POS bill.
// Regular POS orders exit on the first indexed lookup — nothing built or sent.
async function notifyKotItemsChanged(posOrderId) {
  try {
    const row = await dbGet(
      `SELECT web_order_id FROM web_orders_pending WHERE pos_order_id=? AND status='APPROVED'`,
      [posOrderId]);
    if (!row) return;
    const items = await dbAll(
      `SELECT ki.product_name AS name, ki.quantity AS qty, ki.unit_price AS price, ki.notes
       FROM pos_kot_items ki
       JOIN pos_kots k ON k.id = ki.kot_id
       WHERE k.order_id=? AND k.status!='CANCELLED' AND ki.status!='CANCELLED'
       ORDER BY ki.id`, [posOrderId]);
    const total = +items.reduce((s, i) => s + (+i.qty || 0) * (+i.price || 0), 0).toFixed(2);
    sendOrQueue({ type: 'items', orderId: row.web_order_id, posOrderId, items, total },
      `bill snapshot (${items.length} lines) for web #${row.web_order_id}`);
  } catch (e) { log('notifyKotItemsChanged failed:', e.message); }
}

// Same relay for cake-order lifecycle (READY / DELIVERED / CANCELLED). Only
// drives the website status when the web order was cake-only — mixed orders
// (food + cake) stay driven by their pos_order events to avoid status ping-pong.
async function notifyCakeOrderEvent(cakeOrderId, status) {
  try {
    const row = await dbGet(
      `SELECT web_order_id FROM web_orders_pending
       WHERE cake_order_id=? AND pos_order_id IS NULL AND status='APPROVED'`,
      [cakeOrderId]);
    if (row) sendStatus(row.web_order_id, status, { posOrderId: cakeOrderId });
  } catch (e) { log('notifyCakeOrderEvent failed:', e.message); }
}

// ── Connection lifecycle ─────────────────────────────────────────────────────
function resetWatchdog() {
  clearTimeout(watchdog);
  watchdog = setTimeout(() => {
    log('watchdog: no traffic — terminating connection');
    try { ws?.terminate(); } catch {}
  }, WATCHDOG_MS);
  watchdog.unref?.();
}

async function onOpen() {
  backoff = 1000;
  log(`connected to ${WS_URL}`);
  resetWatchdog();
  clearInterval(pinger);
  pinger = setInterval(() => { try { ws?.ping(); } catch {} }, PING_MS);
  pinger.unref?.();

  // Offline synchronization: ask for everything after our last imported order
  const row = await dbGet(`SELECT COALESCE(MAX(web_order_id),0) AS mx FROM web_orders_pending`);
  sendRaw({ type: 'sync', sinceId: row?.mx ?? 0 });
  log(`sync requested since web #${row?.mx ?? 0}`);

  // Flush status updates that happened while offline
  while (pendingStatusQueue.length) {
    const msg = pendingStatusQueue.shift();
    if (!sendRaw(msg)) { pendingStatusQueue.unshift(msg); break; }
  }
}

async function onMessage(raw) {
  resetWatchdog();
  let m; try { m = JSON.parse(raw); } catch { return; }
  if (m.type === 'order' && m.order) {
    try {
      const r = await importOrder(m.order);
      if (r.ok) sendRaw({ type: 'ack', orderId: m.order.id }); // dup → re-ack (idempotent)
    } catch (e) {
      log(`import failed for web #${m.order?.id}: ${e.message} — no ack, server will retry`);
    }
  } else if (m.type === 'sync-done') {
    log(`sync complete — ${m.count} order(s) received`);
  }
}

function connect() {
  if (stopped) return;
  const url = `${WS_URL}${WS_URL.includes('?') ? '&' : '?'}token=${encodeURIComponent(TOKEN)}`;
  log(`connecting to ${WS_URL} ...`);
  ws = new WebSocket(url, { handshakeTimeout: 10_000 });

  ws.on('open', () => onOpen().catch(e => log('onOpen error:', e.message)));
  ws.on('message', raw => onMessage(raw).catch(e => log('onMessage error:', e.message)));
  ws.on('ping', resetWatchdog);
  ws.on('pong', resetWatchdog);
  ws.on('error', e => log('connection error:', e.message));
  ws.on('close', () => {
    clearTimeout(watchdog);
    clearInterval(pinger);
    if (stopped) return;
    log(`disconnected — reconnecting in ${Math.round(backoff / 1000)}s`);
    const t = setTimeout(connect, backoff);
    t.unref?.();
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
  });
}

function start() {
  if (!ENABLED) { log('bridge disabled (WEB_ORDER_BRIDGE_ENABLED=false)'); return; }
  connect();
}

function stop() {
  stopped = true;
  clearTimeout(watchdog);
  clearInterval(pinger);
  try { ws?.close(); } catch {}
}

module.exports = { start, stop, sendStatus, notifyPosOrderEvent, notifyCakeOrderEvent, notifyKotItemProgress, notifyKotItemsChanged };
