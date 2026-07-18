// Combo Meals — a combo is a normal product (is_combo=1) with its own price,
// category and image, plus a composition list in combo_items. This service
// orchestrates the product row + its single pricing variant + the child map.
const { dbAll, dbGet, dbRun } = require('../database/db');
const productsService = require('./productsService');
const comboExpander = require('./comboExpander');

// Header fields a combo reuses from products (no shortcut/barcode/tax for now).
function header(b) {
  return {
    name: b.name,
    category_id: b.category_id || null,
    pos_price: Number(b.pos_price) || 0,
    status: b.status || 'active',
    pos_active: b.pos_active !== undefined ? (b.pos_active ? 1 : 0) : 1,
    customer_visible: b.customer_visible ? 1 : 0,
    prep_time_minutes: b.prep_time_minutes || 0,
    pos_station_id: b.pos_station_id || null,   // usually null → combo line auto-serves, KDS shows children
  };
}

async function loadItems(comboId) {
  return dbAll(
    `SELECT ci.id, ci.child_product_id, ci.child_variant_id, ci.quantity, ci.sequence,
            p.name AS child_name, v.name AS variant_name
     FROM   combo_items ci
     JOIN   products p ON p.id = ci.child_product_id
     LEFT JOIN product_variants v ON v.id = ci.child_variant_id
     WHERE  ci.combo_product_id = ?
     ORDER BY ci.sequence, ci.id`, [comboId]);
}

async function getAll({ search } = {}) {
  const where = search ? `AND p.name LIKE ?` : '';
  const params = search ? [`%${search}%`] : [];
  const combos = await dbAll(
    `SELECT p.id, p.name, p.category_id, c.name AS category_name, p.pos_price,
            p.status, p.pos_active, p.customer_visible, p.pos_station_id,
            (SELECT ml.filename FROM product_images pi
             JOIN media_library ml ON ml.id = pi.media_id
             WHERE pi.product_id = p.id AND pi.is_primary = 1 LIMIT 1) AS primary_image
     FROM   products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE  COALESCE(p.is_combo,0) = 1 ${where}
     ORDER BY p.sort_order, p.id DESC`, params);
  for (const combo of combos) combo.items = await loadItems(combo.id);
  return combos;
}

async function getOne(id) {
  const combo = await dbGet(
    `SELECT p.*, c.name AS category_name,
            (SELECT ml.filename FROM product_images pi
             JOIN media_library ml ON ml.id = pi.media_id
             WHERE pi.product_id = p.id AND pi.is_primary = 1 LIMIT 1) AS primary_image
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.id = ? AND COALESCE(p.is_combo,0) = 1`, [id]);
  if (!combo) return null;
  combo.items = await loadItems(id);
  return combo;
}

// Replace the whole composition (simplest correct CRUD for the modal editor).
async function replaceItems(comboId, items = []) {
  await dbRun(`DELETE FROM combo_items WHERE combo_product_id = ?`, [comboId]);
  let seq = 0;
  for (const it of items) {
    if (!it || !it.child_product_id) continue;
    await dbRun(
      `INSERT INTO combo_items (combo_product_id, child_product_id, child_variant_id, quantity, sequence)
       VALUES (?,?,?,?,?)`,
      [comboId, it.child_product_id, it.child_variant_id || null, Math.max(1, Number(it.quantity) || 1), it.sequence ?? seq++]
    );
  }
}

// Keep the combo's single pricing variant in step with pos_price so POS add-to-cart
// (which reads the first active variant's selling_price) charges the combo price.
async function syncPriceVariant(comboId, price) {
  const v = await dbGet(`SELECT id FROM product_variants WHERE product_id=? ORDER BY sort_order, id LIMIT 1`, [comboId]);
  if (v) await dbRun(`UPDATE product_variants SET selling_price=? WHERE id=?`, [price, v.id]);
  else await productsService.addVariant(comboId, { name: 'Regular', selling_price: price, status: 'active', show_online: 0 });
}

async function create(body) {
  if (!body?.name) throw new Error('Combo name required');
  const { product_id } = await productsService.create({ ...header(body), is_combo: 1 });
  await syncPriceVariant(product_id, header(body).pos_price);
  await replaceItems(product_id, body.items);
  if (body.media_id) await productsService.setImage(product_id, body.media_id).catch(() => {});
  comboExpander.invalidate();
  return getOne(product_id);
}

async function update(id, body) {
  const existing = await getOne(id);
  if (!existing) throw new Error('Combo not found');
  await productsService.update(id, header(body));   // update() never sets is_combo → stays a combo
  await syncPriceVariant(id, header(body).pos_price);
  await replaceItems(id, body.items);
  if (body.media_id) await productsService.setImage(id, body.media_id).catch(() => {});
  comboExpander.invalidate();
  return getOne(id);
}

async function remove(id) {
  await dbRun(`DELETE FROM products WHERE id=? AND COALESCE(is_combo,0)=1`, [id]);  // FK cascades combo_items + variants
  comboExpander.invalidate();
}

module.exports = { getAll, getOne, create, update, remove };
