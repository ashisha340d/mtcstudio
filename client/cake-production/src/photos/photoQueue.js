import { db } from '../db/dexie';
import { mutations } from '../sync/syncEngine';

// Internet channel — fully independent of the LAN sync engine. Uploads
// directly to the user's own external image server; only the resulting URL
// flows back to POS, over the LAN, as a normal queued mutation.
const UPLOAD_URL = import.meta.env.VITE_UPLOAD_URL || 'https://munchtimecafe.com.np/api/uploadimages.php';
const UPLOAD_API_KEY = import.meta.env.VITE_UPLOAD_API_KEY || '';

const BACKOFF_BASE_MS = 5000;
const BACKOFF_MAX_MS = 5 * 60_000;

const listeners = new Set();
function notify() { listeners.forEach(fn => fn()); }
export function onPhotoQueueChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function enqueuePhoto({ cake_order_id, slot, blob, fileName }) {
  await db.photoQueue.add({
    cake_order_id, slot, blob, fileName,
    status: 'pending', createdAt: Date.now(), attempts: 0, nextAttemptAt: 0,
  });
  notify();
  processPhotoQueue();
}

function extractUrl(body) {
  if (body.url) return body.url;
  if (body.image_url) return body.image_url;
  if (body.filename) {
    try { return `${new URL(UPLOAD_URL).origin}/uploads/cake/${body.filename}`; } catch { return null; }
  }
  return null;
}

async function uploadOne(item) {
  const order = await db.orders.get(item.cake_order_id);

  const form = new FormData();
  form.append('photo', item.blob, item.fileName || `slot${item.slot}.jpg`);
  form.append('order_id', String(item.cake_order_id));
  if (order?.order_number) form.append('order_number', order.order_number);
  form.append('slot', String(item.slot));
  if (UPLOAD_API_KEY) form.append('api_key', UPLOAD_API_KEY);

  let res;
  try {
    res = await fetch(UPLOAD_URL, { method: 'POST', body: form });
  } catch {
    return false; // no internet / host unreachable — caller applies backoff
  }
  if (!res.ok) return false;

  const body = await res.json().catch(() => ({}));
  if (!body.success) return false;

  const url = extractUrl(body);
  if (!url) {
    console.warn('[cake-production] uploadimages.php response had no recognizable URL field', body);
    return false;
  }

  await db.photoQueue.delete(item.localId);
  await mutations.photo(item.cake_order_id, item.slot, url, item.fileName || body.filename || null);
  return true;
}

let draining = false;
export async function processPhotoQueue() {
  if (draining) return;
  draining = true;
  try {
    const items = await db.photoQueue.orderBy('localId').toArray();
    for (const item of items) {
      if (item.nextAttemptAt && item.nextAttemptAt > Date.now()) continue; // this item's backoff hasn't elapsed — try others
      const ok = await uploadOne(item).catch(() => false);
      if (!ok) {
        const attempts = (item.attempts || 0) + 1;
        const backoff = Math.min(BACKOFF_BASE_MS * 2 ** (attempts - 1), BACKOFF_MAX_MS);
        await db.photoQueue.update(item.localId, { attempts, nextAttemptAt: Date.now() + backoff, status: 'failed' });
      }
      notify();
    }
  } finally {
    draining = false;
  }
}

let pollTimer = null;
export function startPhotoQueue() {
  if (pollTimer) return;
  processPhotoQueue();
  window.addEventListener('online', processPhotoQueue);
  pollTimer = setInterval(processPhotoQueue, 20_000);
}

export function stopPhotoQueue() {
  window.removeEventListener('online', processPhotoQueue);
  clearInterval(pollTimer);
  pollTimer = null;
}
