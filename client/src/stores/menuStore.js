// ─────────────────────────────────────────────────────────────
//  Global menu prefetch & cache store
//  Memory cache = authoritative runtime source.
//  IndexedDB    = persistence only (instant restore after refresh).
//  Images       = warmed via Image objects into the browser HTTP cache.
//  Live sync    = POSContext socket calls refreshMenu() on 'menu-updated'.
// ─────────────────────────────────────────────────────────────
const API = import.meta.env.VITE_API_URL || '/api';
const H = { 'Content-Type': 'application/json', 'X-Session-ID': 'dev-session' };

/* ── Product normalization (moved from POS.jsx — single source) ── */
export function normalizeMenuProduct(product) {
  const rawPrice = product?.price ?? product?.pos_price ?? product?.min_price ?? product?.max_price ?? product?.selling_price ?? 0;
  const rawPrep = product?.prep_time_minutes ?? product?.prep_time ?? 10;
  const rawActive = product?.is_active ?? product?.pos_active ?? 1;
  const rawVariantCount = product?.variant_count ?? product?.variantCount ?? (Array.isArray(product?.variants) ? product.variants.length : 0) ?? 0;
  const badgeCodes = String(product?.badge || product?.badges || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const price = Number(rawPrice);
  const prepTime = Number(rawPrep);
  const variantCount = Number(rawVariantCount);
  const isActive = rawActive === 0 || rawActive === '0' || rawActive === false ? 0 : 1;

  return {
    ...product,
    id: product?.id ?? product?.product_id,
    name: product?.name ?? product?.product_name ?? '',
    price: Number.isFinite(price) ? price : 0,
    prep_time_minutes: Number.isFinite(prepTime) ? prepTime : 10,
    is_active: isActive,
    is_fast_moving: Boolean(Number(product?.is_fast_moving ?? 0)),
    variant_count: Number.isFinite(variantCount) ? variantCount : 0,
    badge: badgeCodes.join(','),
  };
}

/* ── Memory cache (authoritative while app runs) ─────────────── */
let menu = null;      // normalized active products (full list)
let cats = null;      // categories
let tbls = null;      // tables
let version = null;   // server menu version stamp

const listeners = new Set();
function notify() { listeners.forEach((fn) => { try { fn(); } catch { } }); }

export function subscribeMenu(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getMenuSnapshot() {
  return { menu, cats, tbls, version };
}

/* ── IndexedDB (persistence only) ────────────────────────────── */
const DB_NAME = 'mtc-pos-menu';
const STORE = 'kv';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  try {
    const db = await idbOpen();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch { return undefined; }
}

async function idbSet(entries) {
  try {
    const db = await idbOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      Object.entries(entries).forEach(([k, v]) => os.put(v, k));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* persistence is best-effort */ }
}

/* ── Image warm-up (browser HTTP cache, deduped) ─────────────── */
const warmed = new Set();

function warmImages(products) {
  (products || []).forEach((p) => {
    if (!p?.primary_image) return;
    const url = `/uploads/${p.primary_image}`;
    if (warmed.has(url)) return;
    warmed.add(url);
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
  });
}

/* ── Fetch fresh from server (deduped in-flight) ─────────────── */
let inflight = null;

export function fetchFreshMenu() {
  if (inflight) return inflight;
  inflight = (async () => {
    const [rows, categories, tables, ver] = await Promise.all([
      fetch(`${API}/food-menu/products`).then((r) => r.json()),
      fetch(`${API}/food-menu/categories`).then((r) => r.json()),
      fetch(`${API}/pos/tables`, { headers: H }).then((r) => r.json()),
      fetch(`${API}/food-menu/version`).then((r) => r.json()).catch(() => null),
    ]);
    menu = (rows || []).map(normalizeMenuProduct).filter((p) => p.is_active !== 0);
    cats = categories || [];
    tbls = tables || [];
    version = ver?.version ?? Date.now();
    notify();
    warmImages(menu);
    idbSet({ menu, cats, tbls, version });
    return getMenuSnapshot();
  })().finally(() => { inflight = null; });
  return inflight;
}

/* ── Live sync — called by socket 'menu-updated' handler ─────── */
export function refreshMenu(incomingVersion) {
  if (incomingVersion != null && incomingVersion === version) return Promise.resolve(getMenuSnapshot());
  return fetchFreshMenu();
}

/* Tables-only refresh — for 'tables-updated' socket events */
export async function refreshTables() {
  try {
    const tables = await fetch(`${API}/pos/tables`, { headers: H }).then((r) => r.json());
    tbls = tables || [];
    notify();
    idbSet({ tbls });
  } catch { }
}

/* ── Init — call once at app boot (idempotent) ───────────────── */
let initPromise = null;

export function initMenuStore() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    // 1. Instant restore from IndexedDB (only if memory is empty)
    if (!menu) {
      const [m, c, t, v] = await Promise.all([
        idbGet('menu'), idbGet('cats'), idbGet('tbls'), idbGet('version'),
      ]);
      if (m && !menu) {
        menu = m; cats = c ?? cats; tbls = t ?? tbls; version = v ?? null;
        notify();
        warmImages(menu);
      }
    }
    // 2. Version check — skip full fetch when server version matches cache
    if (menu && version != null) {
      const ver = await fetch(`${API}/food-menu/version`).then((r) => r.json()).catch(() => null);
      if (ver && ver.version === version) return getMenuSnapshot();
    }
    // 3. Fetch fresh in background
    return fetchFreshMenu();
  })();
  return initPromise;
}
