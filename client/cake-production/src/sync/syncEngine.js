import { db, getMeta, setMeta } from '../db/dexie';
import { apiFetch, apiJson } from '../api/client';
import { getSession } from '../api/auth';
import { createCakeProductionSocket } from './socket';

const FAILSAFE_PULL_MS = 60_000;
const PUSH_BACKOFF_BASE_MS = 2000;
const PUSH_BACKOFF_MAX_MS = 60_000;
const MAX_ATTEMPTS_4XX = 5;

let socket = null;
let failsafeTimer = null;
let pushLoopTimer = null;
let listeners = new Set();

function notify() {
  listeners.forEach(fn => fn());
}

export function onSyncChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── Pull (LAN channel: read POS -> local Dexie) ─────────────────────────

export async function pullNow() {
  const since = await getMeta('lastSyncCursor', null);
  const qs = since ? `?since=${encodeURIComponent(since)}` : '';
  const data = await apiJson(`/api/pos/cake-production/sync${qs}`);

  const pendingOrderIds = new Set((await db.syncQueue.toArray()).map(q => q.cake_order_id));

  await db.transaction('rw', db.orders, async () => {
    for (const order of data.orders) {
      if (pendingOrderIds.has(order.id)) continue; // local edit in flight — don't clobber it this cycle
      await db.orders.put(order);
    }
    if (data.deletedIds?.length) await db.orders.bulkDelete(data.deletedIds);
  });

  if (!since) {
    if (data.lookups) await setMeta('lookups', data.lookups);
    if (data.checklistTemplate) await setMeta('checklistTemplate', data.checklistTemplate);
  }
  await setMeta('lastSyncCursor', data.serverTime);
  notify();
}

// ── Push (LAN channel: local Dexie -> POS) ──────────────────────────────

async function pushOne(item) {
  const res = await apiFetch(item.path, { method: item.method, body: JSON.stringify(item.body) });
  if (res.ok) {
    await db.syncQueue.delete(item.localId);
    return true;
  }
  const is4xx = res.status >= 400 && res.status < 500;
  const attempts = (item.attempts || 0) + 1;

  if (is4xx && attempts >= MAX_ATTEMPTS_4XX) {
    console.warn('[cake-production] dropping mutation after repeated 4xx', item);
    await db.syncQueue.delete(item.localId);
    return false;
  }

  const backoff = Math.min(PUSH_BACKOFF_BASE_MS * 2 ** (attempts - 1), PUSH_BACKOFF_MAX_MS);
  await db.syncQueue.update(item.localId, {
    attempts,
    nextAttemptAt: Date.now() + backoff,
    lastError: `HTTP ${res.status}`,
  });
  return false;
}

let draining = false;
export async function drainQueue() {
  if (draining) return;
  draining = true;
  try {
    const items = await db.syncQueue.orderBy('localId').toArray();
    for (const item of items) {
      if (item.nextAttemptAt && item.nextAttemptAt > Date.now()) break; // head-of-line wait, preserves FIFO order
      const ok = await pushOne(item).catch(() => false);
      notify();
      if (!ok) break; // stop draining on first failure — strictly serial, don't reorder
    }
  } finally {
    draining = false;
  }
}

export async function enqueueMutation({ cake_order_id, kind, method, path, body, optimistic }) {
  if (optimistic) await db.orders.update(cake_order_id, optimistic);
  await db.syncQueue.add({ cake_order_id, kind, method, path, body, createdAt: Date.now(), attempts: 0, nextAttemptAt: 0 });
  notify();
  drainQueue();
}

// ── Convenience mutation builders ───────────────────────────────────────

export const mutations = {
  status: (id, status) => enqueueMutation({
    cake_order_id: id, kind: 'status', method: 'PATCH',
    path: `/api/pos/cake-production/${id}/status`, body: { status },
    optimistic: { status },
  }),
  notes: (id, production_notes) => enqueueMutation({
    cake_order_id: id, kind: 'notes', method: 'PATCH',
    path: `/api/pos/cake-production/${id}/notes`, body: { production_notes },
    optimistic: { production_notes },
  }),
  checklist: (id, checklist) => enqueueMutation({
    cake_order_id: id, kind: 'checklist', method: 'PUT',
    path: `/api/pos/cake-production/${id}/state`, body: { checklist },
  }),
  tags: (id, tags) => enqueueMutation({
    cake_order_id: id, kind: 'tags', method: 'PUT',
    path: `/api/pos/cake-production/${id}/state`, body: { tags },
  }),
  photo: (id, slot, image_url, image_name) => enqueueMutation({
    cake_order_id: id, kind: 'photo', method: 'PUT',
    path: `/api/pos/cake-production/${id}/photo/${slot}`, body: { image_url, image_name },
  }),
  photoDelete: (id, slot) => enqueueMutation({
    cake_order_id: id, kind: 'photo', method: 'DELETE',
    path: `/api/pos/cake-production/${id}/photo/${slot}`, body: {},
  }),
};

// ── Lifecycle ────────────────────────────────────────────────────────────

export function getConnectionState() {
  return { lanConnected: !!socket?.connected };
}

export function startSyncEngine() {
  if (socket) return; // already running

  pullNow().catch(err => console.warn('[cake-production] initial pull failed', err));

  const session = getSession();
  socket = createCakeProductionSocket(session?.sessionId);

  socket.on('connect', () => { pullNow().catch(() => {}); drainQueue(); notify(); });
  socket.on('disconnect', () => notify());
  socket.on('cake_production_changed', () => { pullNow().catch(() => {}); });

  failsafeTimer = setInterval(() => {
    if (socket?.connected) pullNow().catch(() => {});
  }, FAILSAFE_PULL_MS);

  // Independent retry loop for the push queue — runs regardless of socket
  // state, since a queued item may become pushable (backoff elapsed) at any
  // time even between reconnect events.
  pushLoopTimer = setInterval(() => { drainQueue(); }, 5000);
}

export function stopSyncEngine() {
  socket?.disconnect();
  socket = null;
  clearInterval(failsafeTimer);
  clearInterval(pushLoopTimer);
}
