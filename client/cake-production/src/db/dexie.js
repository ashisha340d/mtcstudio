import Dexie from 'dexie';

// Offline working copy + sync/photo queues + small key-value store.
// This IndexedDB is the app's complete offline workspace — the POS SQLite
// database remains the single source of truth (see plan: sync engine
// overwrites local rows with server-canonical data on every successful pull).
export const db = new Dexie('cake-production');

db.version(1).stores({
  orders: 'id, status, delivery_date, updated_at, order_number',
  syncQueue: '++localId, cake_order_id, createdAt',
  photoQueue: '++localId, cake_order_id, slot, status',
  meta: 'key',
});

export async function getMeta(key, fallback = null) {
  const row = await db.meta.get(key);
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  await db.meta.put({ key, value });
}
