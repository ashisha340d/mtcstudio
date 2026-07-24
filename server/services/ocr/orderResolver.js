'use strict';
// Resolve parsed Mero Kinmel items to real POS products/variants.
// Strategy: MySQL FULLTEXT (BOOLEAN MODE) narrows candidates fast, then a
// token-Jaccard + paren-hint rerank picks the exact product/variant. Falls back
// to a full in-memory Jaccard scan when FULLTEXT yields nothing (short/garbled
// OCR names, tokens under the InnoDB min token size).
// Output = POS cart shape consumed by pos_scheduled_orders.items_json and
// scheduled.js convertRow(): { product_id, product_name, variant_id,
// variant_name, unit_price, quantity, modifiers:[], notes }.
const cmsDb = require('../../database/db');

// Unit/size noise dropped from FULLTEXT queries (kept for Jaccard via paren hint).
const UNIT = new Set(['ml', 'ltr', 'litre', 'liter', 'gm', 'gram', 'kg', 'pc', 'pcs', 'pax', 'reg', 'regular']);

function norm(s) {
  return String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ')  // drop paren hints for base match
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function parenHint(s) {
  const m = String(s || '').match(/\(([^)]+)\)/);
  return m ? norm(m[1]) : '';
}
function tokens(s) { return new Set(norm(s).split(' ').filter(Boolean)); }
// Alias key for mero_map: keep every token (incl. paren/size words) so
// "Red Velvet (Cheese)" and "Red Velvet (Cream)" stay distinct.
function aliasKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Jaccard token overlap 0..1.
function score(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

// BOOLEAN MODE query: each usable token as an optional prefix term (relevance
// ranks the best overlap first). Operators stripped so OCR text can't inject.
function booleanQuery(name) {
  const toks = [...tokens(name)].filter(t => t.length >= 3 && !UNIT.has(t));
  if (!toks.length) return '';
  return toks.map(t => `${t.replace(/[+\-><()~*"@]/g, '')}*`).join(' ');
}

// ft_products_name / ft_variants_name_sku are created by migration 008.

let cache = null;
let cacheAt = 0;
async function loadCatalog() {
  if (cache && Date.now() - cacheAt < 60000) return cache;
  const [products, variants, allProducts, allVariants, mero] = await Promise.all([
    cmsDb.dbAll(`SELECT id, name, pos_price FROM products WHERE pos_active=1`),
    cmsDb.dbAll(`SELECT id, product_id, name, sku, selling_price FROM product_variants WHERE status='active'`),
    cmsDb.dbAll(`SELECT id, name, pos_price FROM products`),                       // all statuses — mero targets
    cmsDb.dbAll(`SELECT id, product_id, name, sku, selling_price FROM product_variants`),
    cmsDb.dbAll(`SELECT category, GROUP_NAME AS group_name, product_name, ocr_text, product_id, variant_id
                 FROM mero_map WHERE product_id IS NOT NULL`)
      // Table is optional (no mero_map → pure fuzzy), but never fail silently:
      // an empty mero_map disables every alias + offer combo at once.
      .catch(e => { console.warn('[resolver] mero_map unavailable — alias/offer matching OFF:', e.message); return []; }),
  ]);
  // Fuzzy candidate lookups use active-only. mero_map targets resolve against the
  // full catalog so inactive products/variants (e.g. offer components) still map.
  const byId = new Map(allProducts.map(p => [p.id, p]));
  const variantById = new Map(allVariants.map(v => [v.id, v]));
  // Alias index: parsed name -> {product_id, variant_id}. Both the clean
  // product_name and the raw ocr_text map to the same target. First write wins
  // (rows for the same alias are consistent). Offers are combos — handled
  // separately below, so they don't pollute the single-item alias index.
  const isOffer = r => String(r.category || '').trim().toLowerCase() === 'offers';
  const meroIndex = new Map();
  for (const r of mero) {
    if (isOffer(r)) continue;
    for (const k of [aliasKey(r.product_name), aliasKey(r.ocr_text)]) {
      if (k && !meroIndex.has(k)) meroIndex.set(k, { product_id: r.product_id, variant_id: r.variant_id });
    }
  }
  // Offer combos: rows share a group key (product_name, e.g. 'A'/'B'); each row
  // is one component. label(s) = aliasKey(ocr_text). Expand the whole group when
  // a parsed name matches (prefix, since OCR text is truncated).
  const offerGroups = new Map();   // groupKey -> { items:[{product_id,variant_id}], labels:Set }
  for (const r of mero) {
    if (!isOffer(r)) continue;
    const gk = aliasKey(r.group_name || r.product_name);   // GROUP_NAME is the real group key
    if (!gk) continue;
    let g = offerGroups.get(gk);
    if (!g) { g = { items: [], labels: new Set() }; offerGroups.set(gk, g); }
    g.items.push({ product_id: r.product_id, variant_id: r.variant_id });
    const lbl = aliasKey(r.ocr_text);
    if (lbl) g.labels.add(lbl);
  }
  cache = { products, variants, byId, variantById, meroIndex, offerGroups };
  cacheAt = Date.now();
  return cache;
}

// Best Offers combo group for a parsed name. OCR text is truncated, so match by
// prefix (stored label is a prefix of the parsed name) or exact; longest label
// wins to disambiguate overlapping combos.
function matchOfferGroup(name, offerGroups) {
  const key = aliasKey(name);
  if (key.length < 8) return null;                        // too short → unsafe
  let best = null, bestLen = 0;
  for (const [, g] of offerGroups) {
    for (const label of g.labels) {
      // OCR truncates both sides to varying lengths → prefix match either way.
      const overlap = Math.min(key.length, label.length);
      const hit = overlap >= 8 && (key.startsWith(label) || label.startsWith(key));
      if (hit && overlap > bestLen) { best = g; bestLen = overlap; }
    }
  }
  return best;
}

// Build a POS cart line from a mero_map {product_id, variant_id} target.
function lineFromTarget(t, catalog, qty) {
  const prod = catalog.byId.get(t.product_id);
  if (!prod) return null;                                 // product inactive/missing
  const variant = t.variant_id ? catalog.variantById.get(t.variant_id) : null;
  return {
    product_id: prod.id,
    product_name: prod.name,                              // name from OUR DB, not the mero label
    variant_id: variant ? variant.id : null,
    variant_name: variant ? variant.name : null,
    unit_price: variant?.selling_price ?? prod.pos_price ?? 0,
    quantity: qty || 1,
    modifiers: [],
    notes: null,
  };
}

// FULLTEXT candidate product-id set for one parsed name (products + variant hits).
async function ftCandidateIds(name) {
  const q = booleanQuery(name);
  if (!q) return new Set();
  const [prod, vars] = await Promise.all([
    cmsDb.dbAll(
      `SELECT id FROM products
       WHERE pos_active=1 AND MATCH(name) AGAINST(? IN BOOLEAN MODE)
       ORDER BY MATCH(name) AGAINST(? IN BOOLEAN MODE) DESC LIMIT 12`, [q, q]),
    cmsDb.dbAll(
      `SELECT product_id FROM product_variants
       WHERE status='active' AND MATCH(name, sku) AGAINST(? IN BOOLEAN MODE)
       ORDER BY MATCH(name, sku) AGAINST(? IN BOOLEAN MODE) DESC LIMIT 12`, [q, q]),
  ]);
  const ids = new Set(prod.map(r => r.id));
  vars.forEach(r => ids.add(r.product_id));
  return ids;
}

// Best product+variant for one parsed name, reranking within a candidate subset.
// candProducts = FULLTEXT-narrowed list (or full catalog on fallback).
function rerank(name, candProducts, catalog) {
  const hint = parenHint(name);
  let best = { product: null, variant: null, sim: 0 };

  for (const p of candProducts) {
    const s = score(name, p.name);
    if (s > best.sim) best = { product: p, variant: null, sim: s };
  }
  // Variant match — combine product+variant name, honor paren hint (e.g. "200ml").
  const candIds = new Set(candProducts.map(p => p.id));
  for (const v of catalog.variants) {
    if (!candIds.has(v.product_id)) continue;
    const prod = catalog.byId.get(v.product_id);
    if (!prod) continue;
    const combo = `${prod.name} ${v.name || ''} ${v.sku || ''}`;
    let s = score(name, combo);
    if (hint && norm(v.name || '').includes(hint)) s += 0.25;
    if (s > best.sim) best = { product: prod, variant: v, sim: Math.min(1, s) };
  }
  return best;
}

// items = parser output [{ name, qty, unitPrice, amount }]
async function resolve(items) {
  const catalog = await loadCatalog();
  const cart = [];
  const unresolved = [];
  let simSum = 0;

  for (const it of items) {
    // ── mero_map single-item alias hit — exact source-of-truth, skip fuzzy ──
    const alias = catalog.meroIndex.get(aliasKey(it.name));
    if (alias && catalog.byId.has(alias.product_id)) {
      simSum += 1;
      cart.push(lineFromTarget(alias, catalog, it.qty));
      continue;
    }

    // ── Offers combo — expand the group into all its component lines ──
    const group = matchOfferGroup(it.name, catalog.offerGroups);
    if (group) {
      const lines = group.items.map(t => lineFromTarget(t, catalog, it.qty)).filter(Boolean);
      if (lines.length) { simSum += 1; cart.push(...lines); continue; }
    }

    let ftIds;
    try { ftIds = await ftCandidateIds(it.name); }
    catch (e) { ftIds = new Set(); }               // FULLTEXT hiccup → fall back
    // Narrow to FULLTEXT candidates; empty result → full-catalog Jaccard fallback.
    const candProducts = ftIds.size
      ? catalog.products.filter(p => ftIds.has(p.id))
      : catalog.products;

    const m = rerank(it.name, candProducts, catalog);
    simSum += m.sim;

    if (!m.product || m.sim < 0.34) {              // too weak → cashier must pick
      unresolved.push(it.name);
      cart.push({
        product_id: null,
        product_name: it.name,                     // keep raw name so cashier sees it
        variant_id: null,
        variant_name: null,
        unit_price: it.unitPrice || 0,             // receipt price
        quantity: it.qty || 1,
        modifiers: [],
        notes: 'OCR: unmatched item — verify',
        _unresolved: true,
      });
      continue;
    }
    cart.push({
      product_id: m.product.id,
      product_name: m.product.name,
      variant_id: m.variant ? m.variant.id : null,
      variant_name: m.variant ? m.variant.name : null,
      unit_price: m.variant?.selling_price ?? m.product.pos_price ?? 0,   // price from DB match
      quantity: it.qty || 1,
      modifiers: [],
      notes: null,
    });
  }

  const matchConfidence = items.length ? Number((simSum / items.length).toFixed(2)) : 0;
  return { cart, unresolved, matchConfidence };
}

module.exports = { resolve };
