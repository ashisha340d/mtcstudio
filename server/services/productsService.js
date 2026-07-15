const { dbAll, dbGet, dbRun } = require('../database/db');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

// ── Slug helpers ──────────────────────────────────────────────
function slugify(str) {
    return String(str || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

// Build a slug that is guaranteed unique against products.slug.
// Prefers an explicitly provided slug, falls back to the name, then 'item'.
// Appends -2, -3, … on collision. Pass excludeId to ignore the row being updated.
async function uniqueSlug(name, providedSlug, excludeId = null) {
    const base = slugify(providedSlug) || slugify(name) || 'item';
    let candidate = base;
    let n = 1;
    while (true) {
        const row = excludeId
            ? await dbGet(`SELECT id FROM products WHERE slug=? AND id<>?`, [candidate, excludeId])
            : await dbGet(`SELECT id FROM products WHERE slug=?`, [candidate]);
        if (!row) return candidate;
        n += 1;
        candidate = `${base}-${n}`;
    }
}

async function getAll({ search, category, statusFilter, featuredFilter, station, liveShop, storefrontCat, qrActive, blankMax, badge, fastFilter, sort, sortDir, page }) {
    const limit = 100;
    const offset = ((parseInt(page) || 1) - 1) * limit;
    const sortAllowed = ['id', 'name', 'sort_order', 'status', 'created_at'];
    // 'category' sorts by the category's own sort_order (category order grouping)
    const sortCol = sort === 'category'
        ? 'c.sort_order'
        : 'p.' + (sortAllowed.includes(sort) ? sort : 'sort_order');
    const dir = String(sortDir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    const conditions = [], params = [];
    if (search) {
        conditions.push(`(p.name LIKE ? OR p.slug LIKE ? OR p.description LIKE ? OR p.short_description LIKE ? OR EXISTS (SELECT 1 FROM product_variants sv WHERE sv.product_id=p.id AND sv.sku LIKE ?))`);
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    } else {
        if (category) { conditions.push(`p.category_id = ?`); params.push(category); }
        if (statusFilter) { conditions.push(`p.status = ?`); params.push(statusFilter); }
        if (featuredFilter !== '') { conditions.push(`p.featured = ?`); params.push(parseInt(featuredFilter)); }
        if (station) { conditions.push(`p.pos_station_id = ?`); params.push(station); }
        if (liveShop === 'active') { conditions.push(`p.storefront_category IS NOT NULL`); }
        if (liveShop === 'inactive') { conditions.push(`p.storefront_category IS NULL`); }
        if (storefrontCat) { conditions.push(`p.storefront_category = ?`); params.push(storefrontCat); }
        if (qrActive === 'active') { conditions.push(`p.customer_visible = 1`); }
        if (qrActive === 'inactive') { conditions.push(`(p.customer_visible = 0 OR p.customer_visible IS NULL)`); }
        if (blankMax === 'blank') { conditions.push(`p.customer_max_qty IS NULL`); }
        if (badge) { conditions.push(`FIND_IN_SET(?, p.badge)`); params.push(badge); }
        if (fastFilter === 'fast') { conditions.push(`p.is_fast_moving = 1`); }
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRows = await dbAll(`SELECT status, featured, COUNT(*) as cnt FROM products GROUP BY status, featured`);
    const counts = { all: 0, active: 0, inactive: 0, featured: 0, notFeatured: 0 };
    (countRows || []).forEach(r => {
        counts.all += r.cnt;
        if (r.status === 'active') counts.active += r.cnt;
        if (r.status === 'inactive') counts.inactive += r.cnt;
        if (r.featured == 1) counts.featured += r.cnt;
        if (r.featured == 0) counts.notFeatured += r.cnt;
    });

    const countRow = await dbGet(`SELECT COUNT(*) as total FROM products p ${where}`, params);
    const total = countRow.total;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const products = await dbAll(
        `SELECT p.*, c.name as category_name FROM products p
         LEFT JOIN categories c ON p.category_id=c.id
         ${where} ORDER BY ${sortCol} ${dir}, p.id DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
    );

    if (!products.length) {
        const cats = await dbAll(`SELECT id,name FROM categories ORDER BY sort_order`);
        return { products, categories: cats, total, totalPages, counts };
    }

    const ids = products.map(p => p.id);
    const ph = ids.map(() => '?').join(',');

    const variants = await dbAll(
        `SELECT * FROM product_variants WHERE product_id IN (${ph}) ORDER BY product_id, sort_order`, ids
    );
    const varMap = {};
    variants.forEach(v => { if (!varMap[v.product_id]) varMap[v.product_id] = []; varMap[v.product_id].push(v); });
    products.forEach(p => { p.variants = varMap[p.id] || []; });

    const imgRows = await dbAll(
        `SELECT pi.product_id, ml.filename, ml.alt_text FROM product_images pi
         JOIN media_library ml ON pi.media_id=ml.id
         WHERE pi.is_primary=1 AND pi.product_id IN (${ph})`, ids
    );
    const imgMap = {};
    (imgRows || []).forEach(r => { imgMap[r.product_id] = r; });
    products.forEach(p => { p.primary_image = imgMap[p.id] || null; });

    const cats = await dbAll(`SELECT id,name FROM categories ORDER BY sort_order`);
    return { products, categories: cats, total, totalPages, counts };
}

async function getById(id) {
    const product = await dbGet(`SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.id=?`, [id]);
    if (!product) return null;

    const [variants, images, cats] = await Promise.all([
        dbAll(`SELECT * FROM product_variants WHERE product_id=? ORDER BY sort_order`, [id]),
        dbAll(`SELECT pi.*, ml.filename, ml.alt_text, ml.title FROM product_images pi JOIN media_library ml ON pi.media_id=ml.id WHERE pi.product_id=? ORDER BY pi.sort_order`, [id]),
        dbAll(`SELECT id,name FROM categories ORDER BY sort_order`)
    ]);

    product.variants = variants;
    product.images = images;
    return { product, categories: cats };
}

async function create(body) {
    const b = body;
    const slug = await uniqueSlug(b.name, b.slug);
    const result = await dbRun(
        `INSERT INTO products (category_id,name,slug,short_description,description,featured,status,sort_order,storefront_category,badge,
          pos_price,prep_time_minutes,is_fast_moving,pos_station_id,pos_active,customer_visible,customer_max_qty,enable_variant_image)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [b.category_id || null, b.name, slug, b.short_description || null,
         b.description || null, b.featured || 0, b.status || 'active', b.sort_order || 0, b.storefront_category || null, b.badge || '',
         b.pos_price || 0, b.prep_time_minutes || 10, b.is_fast_moving ? 1 : 0, b.pos_station_id || null,
         b.pos_active !== undefined ? (b.pos_active ? 1 : 0) : 1, b.customer_visible ? 1 : 0,
         b.customer_max_qty ? parseInt(b.customer_max_qty) : null, b.enable_variant_image ? 1 : 0]
    );
    return { product_id: result.insertId };
}

async function update(id, body) {
    const b = body;
    const slug = await uniqueSlug(b.name, b.slug, id);
    await dbRun(
        `UPDATE products SET category_id=?,name=?,slug=?,short_description=?,description=?,featured=?,status=?,sort_order=?,storefront_category=?,badge=?,
          pos_price=?,prep_time_minutes=?,is_fast_moving=?,pos_station_id=?,pos_active=?,customer_visible=?,customer_max_qty=?,enable_variant_image=? WHERE id=?`,
        [b.category_id || null, b.name, slug, b.short_description || null,
         b.description || null, b.featured || 0, b.status || 'active', b.sort_order || 0, b.storefront_category || null, b.badge || '',
         b.pos_price || 0, b.prep_time_minutes || 10, b.is_fast_moving ? 1 : 0, b.pos_station_id || null,
         b.pos_active !== undefined ? (b.pos_active ? 1 : 0) : 1, b.customer_visible ? 1 : 0,
         b.customer_max_qty ? parseInt(b.customer_max_qty) : null, b.enable_variant_image ? 1 : 0, id]
    );
}

async function remove(id) {
    await dbRun(`DELETE FROM products WHERE id=?`, [id]);
}

async function addVariant(productId, body) {
    const b = body;
    const result = await dbRun(
        `INSERT INTO product_variants (product_id,name,sku,selling_price,cost_price,stock,reorder_level,unit,status,sort_order,show_online,image_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [productId, b.name || 'Regular', b.sku || null, b.selling_price || 0, b.cost_price || 0,
         b.stock || 0, b.reorder_level || 0, b.unit || null, b.status || 'active', b.sort_order || 0, b.show_online ? 1 : 0, b.image_url || null]
    );
    return result.insertId;
}

async function updateVariant(productId, variantId, body) {
    const b = body;
    await dbRun(
        `UPDATE product_variants SET name=?,sku=?,selling_price=?,cost_price=?,stock=?,reorder_level=?,unit=?,barcode=?,status=?,sort_order=?,show_online=?,image_url=? WHERE id=? AND product_id=?`,
        [b.name || 'Regular', b.sku || null, b.selling_price || 0, b.cost_price || 0, b.stock || 0,
         b.reorder_level || 0, b.unit || null, b.barcode || null, b.status || 'active', b.sort_order || 0, b.show_online ? 1 : 0, b.image_url || null,
         variantId, productId]
    );
}

async function removeVariant(productId, variantId) {
    await dbRun(`DELETE FROM product_variants WHERE id=? AND product_id=?`, [variantId, productId]);
}

async function setImage(productId, mediaId) {
    await dbRun(`UPDATE product_images SET is_primary=0 WHERE product_id=?`, [productId]);
    if (!mediaId) return { cleared: true };
    const row = await dbGet(`SELECT id FROM product_images WHERE product_id=? AND media_id=?`, [productId, mediaId]);
    if (row) {
        await dbRun(`UPDATE product_images SET is_primary=1 WHERE id=?`, [row.id]);
    } else {
        await dbRun(`INSERT INTO product_images (product_id,media_id,is_primary,sort_order) VALUES (?,?,1,0)`, [productId, mediaId]);
    }
    return { success: true };
}

async function bulkSave(rows) {
    const errors = [];
    await Promise.all(rows.map(async b => {
        try {
            if (b.type === 'product') {
                await dbRun(
                    `UPDATE products SET category_id=?,name=?,slug=?,short_description=?,description=?,featured=?,status=?,sort_order=? WHERE id=?`,
                    [b.category_id || null, b.name, b.slug || null, b.short_description || null,
                     b.description || null, b.featured || 0, b.status || 'active', b.sort_order || 0, b.id]
                );
            } else if (b.type === 'variant') {
                await dbRun(
                    `UPDATE product_variants SET name=?,sku=?,selling_price=?,stock=?,reorder_level=?,unit=?,status=?,sort_order=? WHERE id=?`,
                    [b.name, b.sku || null, b.selling_price || 0, b.stock || 0, b.reorder_level || 0,
                     b.unit || null, b.status || 'active', b.sort_order || 0, b.id]
                );
            }
        } catch (e) { errors.push(e.message); }
    }));
    return errors;
}

async function bulkAction({ ids, action, target }) {
    const ph = ids.map(() => '?').join(',');
    const tbl = target === 'variant' ? 'product_variants' : 'products';
    let sql;
    if (action === 'featured_on') sql = `UPDATE products SET featured=1 WHERE id IN (${ph})`;
    else if (action === 'featured_off') sql = `UPDATE products SET featured=0 WHERE id IN (${ph})`;
    else if (action === 'activate') sql = `UPDATE ${tbl} SET status='active' WHERE id IN (${ph})`;
    else if (action === 'deactivate') sql = `UPDATE ${tbl} SET status='inactive' WHERE id IN (${ph})`;
    else if (action === 'delete') sql = `DELETE FROM ${tbl} WHERE id IN (${ph})`;
    else throw Object.assign(new Error('Unknown action'), { status: 400 });
    await dbRun(sql, ids);
}

async function reorder(order) {
    await Promise.all(order.map((id, i) => dbRun(`UPDATE products SET sort_order=? WHERE id=?`, [i + 1, id])));
}

async function exportCsv() {
    const rows = await dbAll(
        `SELECT p.id as product_id, p.name as product_name, p.slug, c.name as category_name,
                p.short_description, p.description, p.featured, p.status as product_status, p.sort_order as product_sort_order,
                p.pos_price, p.prep_time_minutes, p.is_fast_moving, p.pos_station_id, s.name as station_name,
                p.pos_active, p.badge, p.storefront_category, p.customer_visible, p.customer_max_qty,
                v.id as variant_id, v.name as variant_name, v.sku, v.selling_price, v.cost_price,
                v.stock, v.reorder_level, v.unit, v.barcode, v.status as variant_status, v.sort_order as variant_sort_order
         FROM products p
         LEFT JOIN categories c ON p.category_id = c.id
         LEFT JOIN pos_stations s ON s.id = p.pos_station_id
         LEFT JOIN product_variants v ON v.product_id = p.id
         ORDER BY p.sort_order ASC, p.id DESC, v.sort_order`
    );
    return stringify(rows, { header: true });
}

async function importCsv(csvBuffer) {
    let records;
    try {
        records = parse(csvBuffer.toString('utf8'), { columns: true, skip_empty_lines: true, trim: true });
    } catch (e) {
        throw Object.assign(new Error('CSV parse error: ' + e.message), { status: 400 });
    }
    if (!records.length) return { inserted: 0, updated: 0, errors: [] };

    let inserted = 0, updated = 0;
    const errors = [];

    await Promise.all(records.map(async r => {
        const productName = (r.product_name || r.name || '').trim();
        const variantName = (r.variant_name || 'Regular').trim();
        const sku = (r.sku || '').trim();

        if (!productName) { errors.push('Row missing product_name'); return; }

        try {
            const existingProduct = await dbGet(
                `SELECT id FROM products WHERE name=? AND (category_id=? OR (category_id IS NULL AND ?=''))`,
                [productName, r.category_id || null, r.category_id || '']
            );

            const posFields = [
                r.pos_price || 0, r.prep_time_minutes || null, r.is_fast_moving || 0,
                r.pos_station_id || null, r.pos_active === '' || r.pos_active === undefined ? 1 : r.pos_active,
                r.badge || null, r.storefront_category || null, r.customer_visible || 0,
                r.customer_max_qty === '' || r.customer_max_qty === undefined ? null : r.customer_max_qty,
            ];

            let productId;
            if (existingProduct) {
                const slug = await uniqueSlug(productName, r.slug, existingProduct.id);
                await dbRun(
                    `UPDATE products SET category_id=?,slug=?,short_description=?,description=?,featured=?,status=?,sort_order=?,
                            pos_price=?,prep_time_minutes=?,is_fast_moving=?,pos_station_id=?,pos_active=?,badge=?,storefront_category=?,customer_visible=?,customer_max_qty=?
                     WHERE id=?`,
                    [r.category_id || null, slug, r.short_description || null, r.description || null,
                     r.featured || 0, r.product_status || r.status || 'active', r.product_sort_order || 0,
                     ...posFields, existingProduct.id]
                );
                productId = existingProduct.id;
            } else {
                const slug = await uniqueSlug(productName, r.slug);
                const res = await dbRun(
                    `INSERT INTO products (category_id,name,slug,short_description,description,featured,status,sort_order,
                            pos_price,prep_time_minutes,is_fast_moving,pos_station_id,pos_active,badge,storefront_category,customer_visible,customer_max_qty)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                    [r.category_id || null, productName, slug, r.short_description || null,
                     r.description || null, r.featured || 0, r.product_status || r.status || 'active', r.product_sort_order || 0,
                     ...posFields]
                );
                productId = res.insertId;
            }

            const vvals = [variantName, productId, r.selling_price || 0, r.cost_price || 0, r.stock || 0,
                           r.reorder_level || 0, r.unit || null, r.barcode || null, r.variant_status || r.status || 'active'];
            if (sku) {
                const ev = await dbGet(`SELECT id FROM product_variants WHERE sku=?`, [sku]);
                if (ev) {
                    await dbRun(`UPDATE product_variants SET name=?,product_id=?,selling_price=?,cost_price=?,stock=?,reorder_level=?,unit=?,barcode=?,status=? WHERE sku=?`,
                        [...vvals, sku]);
                    updated++;
                } else {
                    await dbRun(`INSERT INTO product_variants (name,product_id,sku,selling_price,cost_price,stock,reorder_level,unit,barcode,status) VALUES (?,?,?,?,?,?,?,?,?,?)`,
                        [variantName, productId, sku, r.selling_price || 0, r.cost_price || 0, r.stock || 0, r.reorder_level || 0, r.unit || null, r.barcode || null, r.variant_status || r.status || 'active']);
                    inserted++;
                }
            } else {
                await dbRun(`INSERT INTO product_variants (name,product_id,selling_price,cost_price,stock,reorder_level,unit,barcode,status) VALUES (?,?,?,?,?,?,?,?,?)`,
                    vvals);
                inserted++;
            }
        } catch (e) { errors.push(e.message); }
    }));

    return { inserted, updated, errors };
}

module.exports = { getAll, getById, create, update, remove, addVariant, updateVariant, removeVariant, setImage, bulkSave, bulkAction, reorder, exportCsv, importCsv };
