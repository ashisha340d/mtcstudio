'use strict';
/**
 * Reference/seed data. Guards mirror the original boot-time seeding exactly:
 * a table that already holds rows is left untouched, so an existing database
 * never has deleted lookup values resurrected.
 */
const bcrypt = require('bcryptjs');

const RECEIPT_DEFAULTS = [
    ['org_name',             'MTC STUDIO'],
    ['org_tagline',          'Thank You! Visit Again'],
    ['org_address',          ''],
    ['org_phone',            ''],
    ['org_email',            ''],
    ['org_gstin',            ''],
    ['org_pan',              ''],
    ['receipt_footer',       'Powered by MTC POS'],
    ['show_logo',            '0'],
    ['logo_text',            ''],
    ['show_customer_phone',  '1'],
    ['show_order_type',      '1'],
    ['show_table',           '1'],
    ['show_kot_breakdown',   '0'],
    ['paper_width_mm',       '80'],
    ['font_size_px',         '12'],
    ['copies',               '1'],
    ['custom_header_line',   ''],
    ['custom_footer_line',   ''],
    ['cake_slip_shop_name',        ''],
    ['cake_slip_header_line',      'CAKE PRODUCTION ORDER'],
    ['cake_slip_footer',           ''],
    ['cake_slip_show_phone',       '1'],
    ['cake_slip_show_flavour',     '1'],
    ['cake_slip_show_size',        '1'],
    ['cake_slip_show_qty',         '1'],
    ['cake_slip_show_cream',       '1'],
    ['cake_slip_show_sponge',      '1'],
    ['cake_slip_show_shape',       '1'],
    ['cake_slip_show_theme',       '1'],
    ['cake_slip_show_message',     '1'],
    ['cake_slip_show_accessories', '1'],
    ['cake_slip_show_allergies',   '1'],
    ['cake_slip_show_notes',       '1'],
    ['cake_slip_show_status',      '1'],
    ['cake_slip_show_qr',          '1'],
    ['cake_slip_show_pricing',     '1'],
];

const STORE_DAYS = [
    [0, 'Sunday', 0], [1, 'Monday', 1], [2, 'Tuesday', 1],
    [3, 'Wednesday', 1], [4, 'Thursday', 1], [5, 'Friday', 1], [6, 'Saturday', 1],
];

const CONDITION_TYPES = [
    ['category_in', 'Category is one of', 'product', { field: 'category_id', op: 'in', valueType: 'array<int>' }],
    ['product_in', 'Product is one of', 'product', { field: 'product_id', op: 'in', valueType: 'array<int>' }],
    ['price_range', 'Price between', 'product', { field: 'price', op: 'between', valueType: '[number,number]' }],
    ['is_first_order', 'Is first order', 'customer', { field: 'order_count', op: 'eq', valueType: 'boolean' }],
    ['loyalty_tier', 'Loyalty tier is', 'customer', { field: 'loyalty_tier', op: 'eq', valueType: 'string' }],
    ['tag_has', 'Customer has tag', 'customer', { field: 'tags', op: 'contains', valueType: 'string' }],
    ['last_order_days_ago', 'Last order was X days ago', 'history', { field: 'last_order_days_ago', op: 'gte', valueType: 'number' }],
    ['order_count_gte', 'Total orders at least', 'history', { field: 'order_count', op: 'gte', valueType: 'number' }],
    ['weather_condition', 'Weather condition is', 'context', { field: 'weather', op: 'eq', valueType: 'string' }],
    ['time_of_day', 'Time of day is', 'context', { field: 'time_of_day', op: 'eq', valueType: 'string' }],
    ['day_of_week', 'Day of week is', 'context', { field: 'day_of_week', op: 'in', valueType: 'array<int>' }],
    ['cart_total_gte', 'Cart total at least', 'cart', { field: 'cart_total', op: 'gte', valueType: 'number' }],
    ['cart_item_count_gte', 'Cart item count at least', 'cart', { field: 'cart_item_count', op: 'gte', valueType: 'number' }],
    ['cart_has_category', 'Cart contains category', 'cart', { field: 'cart_categories', op: 'contains', valueType: 'int' }],
    ['stock_level_below', 'Stock level below', 'business', { field: 'stock_level', op: 'lt', valueType: 'number' }],
    ['item_out_of_stock', 'Item is out of stock', 'business', { field: 'stock_level', op: 'eq', valueType: 'boolean' }],
];

const ACTION_TYPES = [
    ['show_popup_discount', 'Show discount popup', 'sales', { params: ['discount_pct', 'message'] }],
    ['recommend_product', 'Recommend product', 'sales', { params: ['product_id', 'message'] }],
    ['show_upsell_banner', 'Show upsell banner', 'service', { params: ['message', 'target_product_id'] }],
    ['flag_kitchen_note', 'Flag kitchen note', 'kitchen', { params: ['note'] }],
    ['suppress_item_promo', 'Suppress item promo', 'inventory', { params: ['product_id'] }],
    ['notify_staff', 'Notify staff', 'operations', { params: ['message', 'channel'] }],
    ['show_survey_prompt', 'Show survey prompt', 'cx', { params: ['survey_id'] }],
    ['send_sms', 'Send SMS', 'notifications', { params: ['template_id'] }],
    ['send_email', 'Send email', 'notifications', { params: ['template_id'] }],
    ['show_info_tooltip', 'Show info tooltip', 'knowledge', { params: ['message'] }],
    ['custom_webhook', 'Call custom webhook', 'custom', { params: ['url', 'payload_template'] }],
];

const CATEGORY_ACTIONS = [
    ['sales', 'show_popup_discount'], ['sales', 'recommend_product'],
    ['service', 'show_upsell_banner'],
    ['kitchen', 'flag_kitchen_note'],
    ['inventory', 'suppress_item_promo'],
    ['operations', 'notify_staff'],
    ['cx', 'show_survey_prompt'],
    ['notifications', 'send_sms'], ['notifications', 'send_email'],
    ['knowledge', 'show_info_tooltip'],
    ['custom', 'custom_webhook'],
];

const CAKE_LOOKUPS = {
    CREAM_TYPE: [['Fresh Cream', 250], ['Non Dairy', 0], ['Whipping Cream', 0], ['Buttercream', 150], ['Chocolate Ganache', 200], ['Cream Cheese', 150]],
    SHAPE_TYPE: [['Round', 0], ['Square', 100], ['Heart', 150], ['Rectangle', 100], ['Number', 200], ['Custom', 300]],
    SPONGE_TYPE: [['Vanilla', 0], ['Chocolate', 0], ['Red Velvet', 100], ['Black Forest', 0], ['White Forest', 0]],
    THEME_TYPE: [['Birthday', 0], ['Wedding', 300], ['Anniversary', 100], ['Kids', 150], ['Corporate', 200], ['Photo Print', 200], ['Fondant', 500], ['Cartoon', 200], ['Floral', 150], ['Custom', 0]],
    DIETARY_TYPE: [['Eggless', 100], ['Vegan', 150], ['Sugar Free', 200], ['Gluten Free', 200], ['Nut Free', 0]],
};

const TABLE_TAGS = [
    { code: 'VIP', name: 'VIP', value: '👑', sort_order: 1 },
    { code: 'BIRTHDAY', name: 'Birthday', value: '🎂', sort_order: 2 },
    { code: 'ALLERGY', name: 'Allergy', value: '⚠', sort_order: 3 },
    { code: 'SPECIAL_GUEST', name: 'Special Guest', value: '⭐', sort_order: 4 },
    { code: 'CELEBRATION', name: 'Celebration', value: '🎉', sort_order: 5 },
    { code: 'CORPORATE', name: 'Corporate', value: '💼', sort_order: 6 },
];

const PRODUCT_BADGES = [
    { code: 'VEG', name: 'Veg', value: '🟢', sort_order: 1 },
    { code: 'NONVEG', name: 'Non Veg', value: '🔴', sort_order: 2 },
    { code: 'SPICY', name: 'Spicy', value: '🌶️', sort_order: 3 },
    { code: 'HOT', name: 'Hot', value: '🔥', sort_order: 4 },
    { code: 'CHEF_SPECIAL', name: 'Chef Special', value: '👨‍🍳', sort_order: 5 },
    { code: 'POPULAR', name: 'Popular', value: '⭐', sort_order: 6 },
    { code: 'NEW', name: 'New', value: '🆕', sort_order: 7 },
    { code: 'GLUTEN_FREE', name: 'Gluten Free', value: '🌾', sort_order: 8 },
    { code: 'DAIRY_FREE', name: 'Dairy Free', value: '🥛', sort_order: 9 },
    { code: 'HIGH_PROTEIN', name: 'High Protein', value: '💪', sort_order: 10 },
    { code: 'KIDS', name: 'Kids', value: '🧒', sort_order: 11 },
    { code: 'SIGNATURE', name: 'Signature', value: '✨', sort_order: 12 },
];

const CHECKLIST_TEMPLATE = [
    ['base_baked', 'Base baked', 1],
    ['crumb_coated', 'Crumb-coated', 2],
    ['decorated', 'Decorated', 3],
    ['boxed', 'Boxed & ready', 4],
];

/** True when the table holds no rows matching the optional WHERE clause. */
async function isEmpty(dbGet, table, where = '', params = []) {
    const row = await dbGet(`SELECT COUNT(*) AS c FROM ${table} ${where}`, params);
    return !row || Number(row.c) === 0;
}

async function up({ dbGet, dbRun }) {
    // ── Receipt / printer configuration ──
    for (const [key, value] of RECEIPT_DEFAULTS) {
        await dbRun('INSERT IGNORE INTO receipt_config (`key`, value) VALUES (?, ?)', [key, value]);
    }
    await dbRun(`INSERT IGNORE INTO printer_config (id, printer_name) VALUES (1, NULL)`);

    // ── Live store opening hours ──
    if (await isEmpty(dbGet, 'live_store_schedule')) {
        for (const [dow, name, open] of STORE_DAYS) {
            await dbRun(
                `INSERT INTO live_store_schedule (day_of_week, day_name, is_open, open_time, close_time)
                 VALUES (?, ?, ?, '08:00', '20:00')`,
                [dow, name, open]
            );
        }
    }

    // ── Weather recommendation defaults ──
    await dbRun(`INSERT IGNORE INTO weather_reco_settings (id, enabled, modal_seconds, max_per_session) VALUES (1, 1, 8, 1)`);

    // ── Automation rule engine reference data ──
    if (await isEmpty(dbGet, 'automation_settings')) {
        for (const scope of ['website', 'pos', 'kiosk']) {
            await dbRun(
                `INSERT INTO automation_settings (scope, global_session_cap, conflict_strategy, stop_overrides_cap)
                 VALUES (?, 3, 'priority_then_score', 1)`,
                [scope]
            );
        }
    }

    if (await isEmpty(dbGet, 'automation_condition_types')) {
        for (const [key, label, category, schema] of CONDITION_TYPES) {
            await dbRun(
                'INSERT INTO automation_condition_types (`key`, label, category, value_schema) VALUES (?, ?, ?, ?)',
                [key, label, category, JSON.stringify(schema)]
            );
        }
    }

    if (await isEmpty(dbGet, 'automation_action_types')) {
        for (const [key, label, category, schema] of ACTION_TYPES) {
            await dbRun(
                'INSERT INTO automation_action_types (`key`, label, category, value_schema) VALUES (?, ?, ?, ?)',
                [key, label, category, JSON.stringify(schema)]
            );
        }
    }

    if (await isEmpty(dbGet, 'automation_category_actions')) {
        for (const [category, actionKey] of CATEGORY_ACTIONS) {
            await dbRun(
                `INSERT INTO automation_category_actions (category, action_key) VALUES (?, ?)`,
                [category, actionKey]
            );
        }
    }

    // ── POS roles ──
    await dbRun(`INSERT IGNORE INTO pos_roles (name) VALUES ('WAITER')`);

    // ── Cake configuration lookups ──
    if (await isEmpty(dbGet, 'lookup_master')) {
        for (const [type, items] of Object.entries(CAKE_LOOKUPS)) {
            let i = 0;
            for (const [name, charge] of items) {
                await dbRun(
                    `INSERT IGNORE INTO lookup_master (lookup_type,name,extra_charge,sort_order) VALUES (?,?,?,?)`,
                    [type, name, charge, i++]
                );
            }
        }
    }

    if (await isEmpty(dbGet, 'lookup_master', `WHERE lookup_type = 'TABLE_TAG'`)) {
        for (const t of TABLE_TAGS) {
            await dbRun(
                `INSERT INTO lookup_master (lookup_type,code,name,value,sort_order) VALUES ('TABLE_TAG',?,?,?,?)`,
                [t.code, t.name, t.value, t.sort_order]
            );
        }
    }

    if (await isEmpty(dbGet, 'lookup_master', `WHERE lookup_type = 'PRODUCT_BADGE'`)) {
        for (const b of PRODUCT_BADGES) {
            await dbRun(
                `INSERT IGNORE INTO lookup_master (lookup_type,code,name,value,sort_order) VALUES ('PRODUCT_BADGE',?,?,?,?)`,
                [b.code, b.name, b.value, b.sort_order]
            );
        }
    }

    // ── Cake production checklist template ──
    if (await isEmpty(dbGet, 'cake_production_checklist_template')) {
        for (const [key, label, sort] of CHECKLIST_TEMPLATE) {
            await dbRun(
                `INSERT INTO cake_production_checklist_template (item_key,label,sort_order) VALUES (?,?,?)`,
                [key, label, sort]
            );
        }
    }

    // ── Default waiter user ──
    const waiterRole = await dbGet(`SELECT id FROM pos_roles WHERE name = 'WAITER'`);
    if (waiterRole) {
        const existingWaiter = await dbGet(`SELECT id FROM pos_users WHERE employee_id = 'WTR01'`);
        if (!existingWaiter) {
            await dbRun(
                `INSERT INTO pos_users (name, employee_id, role_id, pin_hash) VALUES ('Waiter', 'WTR01', ?, ?)`,
                [waiterRole.id, bcrypt.hashSync('1111', 10)]
            );
        }
    }
}

module.exports = { up };
