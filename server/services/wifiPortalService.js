'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  Read-only projection of the existing catalogue for the Wi-Fi landing page.
//
//  Nothing here writes. Everything is a SELECT against tables the CMS/POS
//  already own (products, product_images, media_library, live_shelf,
//  cake_designs, combo_items, order_reviews), reshaped for presentation and
//  held in one in-memory snapshot so a busy café hour costs ~0 queries.
// ─────────────────────────────────────────────────────────────────────────────
const path = require('path');
const fs = require('fs');
const { dbAll } = require('../database/db');

const TTL_MS = Number(process.env.WIFI_CACHE_TTL_MS) || 5 * 60 * 1000;
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

let cache = { data: null, at: 0, inflight: null };

// ── Text repair ──────────────────────────────────────────────────────────────
// Parts of the catalogue were imported through a latin1 hop, so em dashes and
// accents arrive as "â€”" / "Ã‰". Decode those back at the display layer rather
// than rewriting rows other systems already read.
const CP1252_HIGH = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020,
  0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152,
  0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022,
  0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};
const CP1252_REVERSE = new Map(Object.entries(CP1252_HIGH).map(([b, cp]) => [cp, Number(b)]));

function fixText(value) {
  const s = String(value ?? '');
  if (!/[ÂÃâ€]/.test(s)) return s;
  const bytes = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp <= 0xff) bytes.push(cp);
    else if (CP1252_REVERSE.has(cp)) bytes.push(CP1252_REVERSE.get(cp));
    else return s;                       // not a mojibake string after all
  }
  const decoded = Buffer.from(bytes).toString('utf8');
  return decoded.includes('�') ? s : decoded;
}

// ── Shaping helpers ──────────────────────────────────────────────────────────
const money = n => Math.round(Number(n) || 0);

// A handful of catalogue rows still reference uploads that are no longer on
// disk. Returning null for those lets the view fall back to a branded tile
// instead of rendering a broken image, and keeps the item itself sellable.
// Results are memoised per snapshot build — the cost is a few dozen stats
// every TTL, not one per request.
const existsMemo = new Map();

function uploadExists(filename) {
  if (existsMemo.has(filename)) return existsMemo.get(filename);
  const resolved = path.resolve(UPLOAD_DIR, filename);
  // Guard against a stored name like "../../secret" escaping the upload dir.
  const ok = resolved.startsWith(UPLOAD_DIR + path.sep) && fs.existsSync(resolved);
  existsMemo.set(filename, ok);
  return ok;
}

function imageUrl(raw) {
  if (!raw) return null;
  const value = String(raw);
  if (/^https?:\/\//.test(value)) return value;          // remote, trust it
  const filename = value.replace(/^\/?uploads\//, '');
  if (value.startsWith('/') && !value.startsWith('/uploads/')) return value;  // e.g. /public/img/…
  return uploadExists(filename) ? `/uploads/${filename}` : null;
}

// Badges are a CSV of lookup keys; only a few read well as a customer-facing pill.
const BADGE_LABELS = {
  SIGNATURE: 'Signature', CHEF_SPECIAL: "Chef's Special", POPULAR: 'Popular',
  SPICY: 'Spicy', VEG: 'Veg', NONVEG: 'Non-veg', KIDS: 'Kids',
  HIGH_PROTEIN: 'High protein', DAIRY_CREAM: 'Dairy cream', HOT: 'Hot',
};
const BADGE_PRIORITY = ['CHEF_SPECIAL', 'SIGNATURE', 'POPULAR', 'SPICY', 'HOT', 'HIGH_PROTEIN', 'KIDS'];

function topBadge(csv) {
  const keys = String(csv || '').split(',').map(s => s.trim()).filter(Boolean);
  const key = BADGE_PRIORITY.find(p => keys.includes(p));
  return key ? { key, label: BADGE_LABELS[key] } : null;
}

function dietOf(csv) {
  const keys = String(csv || '').split(',').map(s => s.trim());
  if (keys.includes('VEG') && !keys.includes('NONVEG')) return 'veg';
  if (keys.includes('NONVEG')) return 'nonveg';
  return null;
}

function shapeProduct(row) {
  return {
    id: row.id,
    name: fixText(row.name),
    slug: row.slug,
    tagline: fixText(row.short_description || ''),
    price: money(row.price ?? row.pos_price),
    image: imageUrl(row.filename),
    alt: fixText(row.alt_text || row.name),
    category: fixText(row.category_name || ''),
    badge: topBadge(row.badge),
    diet: dietOf(row.badge),
  };
}

// ── Queries ──────────────────────────────────────────────────────────────────
// One shared projection so every section returns an identically shaped card.
const PRODUCT_SELECT = `
  SELECT p.id, p.name, p.slug, p.short_description, p.badge,
         COALESCE(NULLIF(p.pos_price,0), v.selling_price, 0) AS price,
         c.name AS category_name, ml.filename, ml.alt_text
  FROM   products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
  LEFT JOIN media_library ml ON ml.id = pi.media_id
  LEFT JOIN product_variants v ON v.id = (
    SELECT id FROM product_variants WHERE product_id = p.id AND status='active'
    ORDER BY sort_order, id LIMIT 1)
  WHERE  p.status = 'active' AND COALESCE(p.is_combo,0) = 0 AND ml.filename IS NOT NULL`;

// These sections are pure image carousels and the catalogue has depth to
// spare, so an item whose photo went missing is dropped rather than shown as
// a placeholder — the rail stays immaculate.
async function fetchFeatured() {
  const rows = await dbAll(
    `${PRODUCT_SELECT} AND p.featured = 1 ORDER BY p.is_fast_moving DESC, p.sort_order, p.id DESC LIMIT 14`
  );
  return rows.map(shapeProduct).filter(p => p.image).slice(0, 12);
}

async function fetchByCategory(names, limit) {
  const ph = names.map(() => '?').join(',');
  const rows = await dbAll(
    `${PRODUCT_SELECT} AND c.name IN (${ph}) ORDER BY p.featured DESC, p.sort_order, p.id LIMIT ?`,
    [...names, limit + 4]
  );
  return rows.map(shapeProduct).filter(p => p.image).slice(0, limit);
}

// Today's Specials come off the bakery counter shelf, not the fixed menu — this
// is the same live_shelf the storefront reads, so the portal is always in step.
async function fetchSpecials() {
  const rows = await dbAll(
    `SELECT id, name, category, price, quantity, image, notes
     FROM   live_shelf
     WHERE  show_online = 1 AND quantity > 0
     ORDER  BY sort_order, id LIMIT 6`
  );
  return rows.map(r => ({
    id: r.id,
    name: fixText(r.name),
    category: fixText(r.category || ''),
    price: money(r.price),
    qty: Number(r.quantity) || 0,
    // Counter notes are free text with hard newlines — collapse for a one-liner.
    tagline: fixText(r.notes || '').replace(/\s*\n+\s*/g, ' · ').trim(),
    image: imageUrl(r.image),
    alt: fixText(r.name),
  }));
}

async function fetchCakes() {
  const rows = await dbAll(
    `SELECT d.id, d.name, d.tagline, d.eggless_available, d.prep_time_hours,
            (SELECT url FROM cake_design_media WHERE design_id = d.id ORDER BY sort_order, id LIMIT 1) AS image,
            (SELECT MIN(price) FROM cake_design_sizes WHERE design_id = d.id) AS from_price
     FROM   cake_designs d
     WHERE  d.is_active = 1
     HAVING image IS NOT NULL
     ORDER  BY d.sort_order, d.id LIMIT 6`
  );
  return rows.map(r => ({
    id: r.id,
    name: fixText(r.name),
    tagline: fixText(r.tagline || ''),
    price: money(r.from_price),
    image: imageUrl(r.image),
    alt: `${fixText(r.name)} — birthday cake by Munch Time Cafe`,
    eggless: Boolean(r.eggless_available),
    prepHours: Number(r.prep_time_hours) || 24,
  })).filter(c => c.image).slice(0, 8);
}

async function fetchCombos() {
  const combos = await dbAll(
    `SELECT p.id, p.name, p.pos_price, ml.filename, ml.alt_text
     FROM   products p
     LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
     LEFT JOIN media_library ml ON ml.id = pi.media_id
     WHERE  COALESCE(p.is_combo,0) = 1 AND p.status = 'active'
     ORDER  BY p.sort_order, p.id LIMIT 6`
  );
  if (!combos.length) return [];

  const ids = combos.map(c => c.id);
  const items = await dbAll(
    `SELECT ci.combo_product_id, ci.quantity, cp.name
     FROM   combo_items ci
     JOIN   products cp ON cp.id = ci.child_product_id
     WHERE  ci.combo_product_id IN (${ids.map(() => '?').join(',')})
     ORDER  BY ci.sequence, ci.id`, ids
  );

  return combos.map(c => ({
    id: c.id,
    name: fixText(c.name),
    price: money(c.pos_price),
    image: imageUrl(c.filename),
    alt: fixText(c.alt_text || c.name),
    includes: items
      .filter(i => i.combo_product_id === c.id)
      .map(i => (i.quantity > 1 ? `${i.quantity}× ${fixText(i.name)}` : fixText(i.name))),
  }));
}

// The Pizza spotlight — one showstopper pizza headlines the section on a
// spinning peel, the rest fill the grid beneath. Ordered so a popular, premium
// pie takes the hero slot.
async function fetchPizza() {
  const rows = await dbAll(
    `${PRODUCT_SELECT} AND c.name = 'Wood Fired Pizza'
     ORDER BY p.featured DESC, (p.badge LIKE '%POPULAR%') DESC, p.pos_price DESC
     LIMIT 12`
  );
  const all = rows.map(shapeProduct).filter(p => p.image);
  if (!all.length) return null;
  const [hero, ...rest] = all;
  return { hero, rest: rest.slice(0, 8) };
}

// The Burger spotlight — one hero (the priciest signature) headlines the
// section, the rest fill a rail beneath it. Pulled from the same catalogue,
// so pricing and photos stay in step with the POS.
async function fetchBurgers() {
  const rows = await dbAll(
    `${PRODUCT_SELECT} AND c.name = 'Burgers & Dogs'
     ORDER BY p.featured DESC, (p.badge LIKE '%SIGNATURE%') DESC, p.pos_price DESC
     LIMIT 9`
  );
  const all = rows.map(shapeProduct).filter(p => p.image);
  if (!all.length) return null;
  const [hero, ...rest] = all;
  return { hero, rest: rest.slice(0, 6) };
}

// Real guest reviews when we have them. The curated set below is what shows on
// day one and whenever fewer than three real ones clear the 4-star bar — it is
// clearly labelled as Google-sourced in the view, never passed off as new.
const SEED_REVIEWS = [
  { name: 'Sujata K.', rating: 5, text: 'The wood fired pizza here is the real thing — proper charred crust, not the usual soggy base. Best in Bharatpur.', source: 'Google' },
  { name: 'Bibek T.', rating: 5, text: 'Ordered a birthday cake two days ahead and it arrived exactly like the picture. The team even called to confirm the message on top.', source: 'Google' },
  { name: 'Anisha S.', rating: 5, text: 'Coffee is genuinely good and the staff remember your order. My go-to spot for working afternoons.', source: 'Google' },
  { name: 'Rajan P.', rating: 4, text: 'Smash burgers are excellent and portions are honest. Gets busy around 7pm so come a little early.', source: 'Google' },
];

async function fetchReviews() {
  let live = [];
  try {
    const rows = await dbAll(
      `SELECT r.rating, r.review_text, r.created_at, c.name
       FROM   order_reviews r
       LEFT JOIN customers c ON c.id = r.customer_id
       WHERE  r.rating >= 4 AND r.review_text IS NOT NULL AND CHAR_LENGTH(r.review_text) > 12
       ORDER  BY r.created_at DESC LIMIT 6`
    );
    live = rows.map(r => ({
      // First name + initial only — the portal is a public screen.
      name: (() => {
        const parts = fixText(r.name || 'Guest').trim().split(/\s+/);
        return parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];
      })(),
      rating: Number(r.rating) || 5,
      text: fixText(r.review_text).slice(0, 220),
      source: 'Verified order',
    }));
  } catch {
    live = [];   // reviews are decorative; never let them break the page
  }
  return live.length >= 3 ? live : [...live, ...SEED_REVIEWS].slice(0, 6);
}

// ── Snapshot ─────────────────────────────────────────────────────────────────
async function build() {
  existsMemo.clear();   // re-check the disk each rebuild so re-uploads show up

  const [featured, specials, cakes, burgers, pizza, coffee, desserts, combos, reviews] = await Promise.all([
    fetchFeatured(),
    fetchSpecials(),
    fetchCakes(),
    fetchBurgers(),
    fetchPizza(),
    fetchByCategory(['Drinks'], 8),
    fetchByCategory(['Desserts'], 8),
    fetchCombos(),
    fetchReviews(),
  ]);

  const ratings = reviews.map(r => r.rating);
  const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 5;

  return {
    featured,
    specials,
    cakes,
    burgers,
    pizza,
    coffee,
    desserts,
    combos,
    reviews,
    rating: Math.min(5, Math.round(avg * 10) / 10),
    builtAt: Date.now(),
  };
}

/**
 * Cached catalogue snapshot. Concurrent misses share one build so a cold cache
 * under a rush of arriving phones still issues a single set of queries.
 */
async function getSnapshot({ force = false } = {}) {
  const fresh = cache.data && Date.now() - cache.at < TTL_MS;
  if (fresh && !force) return cache.data;
  if (cache.inflight) return cache.inflight;

  cache.inflight = build()
    .then(data => {
      cache = { data, at: Date.now(), inflight: null };
      return data;
    })
    .catch(err => {
      cache.inflight = null;
      if (cache.data) {
        // Serve the stale snapshot rather than a broken page — a guest waiting
        // on Wi-Fi should never see a 500 because one query timed out.
        console.error('[wifi] snapshot refresh failed, serving stale:', err.message);
        return cache.data;
      }
      throw err;
    });

  return cache.inflight;
}

function invalidate() {
  cache = { data: null, at: 0, inflight: null };
}

module.exports = { getSnapshot, invalidate, fixText, TTL_MS };
