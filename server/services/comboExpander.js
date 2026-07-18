'use strict';
// Combo expansion — a combo product line explodes into its child component
// lines for KOT + inventory, while the combo line keeps its own price/name.
// Composition comes from combo_items; cached in memory (60s) so expansion is O(n).
const { dbAll } = require('../pos/db');

let cache = null;
let cacheAt = 0;
async function loadMap() {
  if (cache && Date.now() - cacheAt < 60000) return cache;
  const rows = await dbAll(`
    SELECT ci.combo_product_id, ci.child_product_id, ci.child_variant_id,
           ci.quantity, ci.sequence,
           cp.name AS child_name, cv.name AS variant_name
    FROM   combo_items ci
    JOIN   products cp ON cp.id = ci.child_product_id
    LEFT JOIN product_variants cv ON cv.id = ci.child_variant_id
    ORDER BY ci.combo_product_id, ci.sequence, ci.id`);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.combo_product_id)) map.set(r.combo_product_id, []);
    map.get(r.combo_product_id).push(r);
  }
  cache = map;
  cacheAt = Date.now();
  return cache;
}
// Call after any combo_items write so the next expansion sees fresh composition.
function invalidate() { cache = null; cacheAt = 0; }

function childName(r) {
  return r.variant_name ? `${r.child_name} (${r.variant_name})` : r.child_name;
}

// Components for one combo product, scaled to a parent quantity. [] if not a combo.
async function componentsFor(productId, parentQty = 1) {
  const map = await loadMap();
  const comps = map.get(Number(productId));
  if (!comps || !comps.length) return [];
  return comps.map(c => ({
    product_id: c.child_product_id,
    variant_id: c.child_variant_id ?? null,
    product_name: childName(c),
    quantity: (Number(parentQty) || 1) * (Number(c.quantity) || 1),
    unit_price: 0,            // revenue stays on the combo parent line
    notes: null,
  }));
}

// items = incoming KOT payload lines. Returns groups: [{ parent, children:[] }].
// Non-combo → children:[]. Combo → children carry child product/variant, qty =
// parentQty * childQty, price 0. Caller inserts parent, then children linked to it.
async function expandGroups(items) {
  const out = [];
  for (const it of items) {
    const children = await componentsFor(it.product_id, it.quantity);
    if (children.length) children.forEach(c => { c.is_home_pack = it.is_home_pack ? 1 : 0; });
    out.push({ parent: it, children, isCombo: children.length > 0 });
  }
  return out;
}

module.exports = { expandGroups, componentsFor, loadMap, invalidate };
