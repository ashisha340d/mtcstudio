const { dbAll } = require('../database/db');

const SYNC_URL = `${process.env.PUBLIC_SITE_URL}/api/sync/menu`;
const API_KEY  = 'MTC_LIVE_SHELF_2026_X7K9P2Q8';

async function syncMenuCatalog() {
    // product_badges: the badge catalogue lives in lookup_master (lookup_type='PRODUCT_BADGE').
    // We ship it under a friendlier name so the remote menu can render badges dynamically.
    const [categories, media_library, products, modifier_groups, shared_modifiers, product_badges, lookup_master] = await Promise.all([
        dbAll(`SELECT * FROM categories WHERE status = 'active'`),
        dbAll(`SELECT * FROM media_library`),
        dbAll(`SELECT * FROM products WHERE status = 'active' AND featured = 1`),
        dbAll(`SELECT id, name, sort_order FROM modifier_groups`),
        dbAll(`SELECT id, group_id, name, price, sort_order, is_active FROM shared_modifiers WHERE is_active = 1`),
        dbAll(`SELECT id, code, name, value AS icon, sort_order
               FROM   lookup_master
               WHERE  lookup_type = 'PRODUCT_BADGE' AND is_active = 1
               ORDER  BY sort_order, name`),
        // Cake Atelier picklists (CREAM_TYPE, SHAPE_TYPE, SPONGE_TYPE, THEME_TYPE,
        // DIETARY_TYPE, ...) — ids must match verbatim on the website so a web cake
        // order's creamId/dietaryIds resolve straight back to the same lookup row here.
        dbAll(`SELECT id, lookup_type, code, name, value, extra_charge, description, sort_order, is_active
               FROM   lookup_master
               WHERE  lookup_type != 'PRODUCT_BADGE' AND lookup_type != 'TABLE_TAG'
               ORDER  BY lookup_type, sort_order, name`),
    ]);

    const ids = products.map(p => p.id);
    const ph = ids.map(() => '?').join(',');

    const [product_variants, product_images, product_modifier_assignments] = ids.length
        ? await Promise.all([
            dbAll(`SELECT * FROM product_variants WHERE product_id IN (${ph})`, ids),
            dbAll(`SELECT * FROM product_images WHERE product_id IN (${ph})`, ids),
            dbAll(`SELECT * FROM product_modifier_assignments WHERE product_id IN (${ph})`, ids),
        ])
        : [[], [], []];

    const payload = {
        categories, media_library, products, product_variants, product_images,
        product_modifier_assignments, modifier_groups, shared_modifiers, product_badges, lookup_master,
    };

    const response = await fetch(SYNC_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ api_key: API_KEY, ...payload }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Remote API returned ${response.status}: ${text}`);
    }

    const json = await response.json().catch(() => null);
    if (!json || json.success !== true) {
        throw new Error(`Remote API unexpected response: ${JSON.stringify(json)}`);
    }

    return {
        categories: json.categories ?? 0,
        media_library: json.media_library ?? 0,
        products: json.products ?? 0,
        product_variants: json.product_variants ?? 0,
        product_images: json.product_images ?? 0,
        product_modifier_assignments: json.product_modifier_assignments ?? 0,
        modifier_groups: json.modifier_groups ?? 0,
        shared_modifiers: json.shared_modifiers ?? 0,
        product_badges: json.product_badges ?? 0,
        lookup_master: json.lookup_master ?? 0,
    };
}

module.exports = { syncMenuCatalog };
