'use strict';
/**
 * Campaign module reference/seed data. Guards mirror the project convention:
 * a table that already holds rows is left untouched, so an operator's edits
 * (disabled types, tweaked channel config, extra roles) are never overwritten.
 *
 * Everything here is data — campaign types, channels/providers, role
 * permissions and starter templates. No campaign behaviour is coded; the
 * services read these rows at runtime, so a new campaign type is one INSERT.
 */

async function isEmpty(dbGet, table) {
    const row = await dbGet(`SELECT COUNT(*) AS n FROM ${table}`);
    return !row || Number(row.n) === 0;
}

// [key, label, category, icon, defaultTrigger, defaultChannels, defaultAudience, defaultConfig]
// defaultTrigger.type ∈ scheduled|recurring|event|webhook|api|manual|system
const CAMPAIGN_TYPES = [
    ['birthday',    'Birthday',            'lifecycle', '🎂',
        { type: 'recurring', event: 'customer.birthday', time: '09:00' },
        ['SMS'], { and: [{ field: 'has_birthday', op: 'eq', value: true }] }, {}],
    ['anniversary', 'Anniversary',         'lifecycle', '💍',
        { type: 'recurring', event: 'customer.anniversary', time: '09:00' }, ['SMS'], {}, {}],
    ['first_visit', 'First Visit',         'lifecycle', '👋',
        { type: 'event', event: 'order.completed' },
        ['SMS'], { and: [{ field: 'visit_count', op: 'eq', value: 1 }] }, {}],
    ['second_visit','Second Visit',        'lifecycle', '🔁',
        { type: 'event', event: 'order.completed' },
        ['SMS'], { and: [{ field: 'visit_count', op: 'eq', value: 2 }] }, {}],
    ['vip',         'VIP',                 'loyalty',   '⭐',
        { type: 'scheduled' },
        ['SMS'], { and: [{ field: 'rewards_tier', op: 'in', value: ['vip','gold','platinum'] }] }, {}],
    ['loyalty',     'Loyalty',             'loyalty',   '🏅',
        { type: 'scheduled' },
        ['SMS'], { and: [{ field: 'loyalty_points', op: 'gte', value: 100 }] }, {}],
    ['win_back',    'Win Back',            'retention', '🎯',
        { type: 'scheduled' },
        ['SMS'], { and: [{ field: 'days_since_last_order', op: 'gte', value: 60 }] }, {}],
    ['happy_hour',  'Happy Hour',          'promo',     '🍹',
        { type: 'recurring', window: { start: '16:00', end: '18:00' } }, ['SMS'], {}, {}],
    ['flash_sale',  'Flash Sale',          'promo',     '⚡',
        { type: 'scheduled' }, ['SMS'], {}, {}],
    ['limited_time','Limited Time Offer',  'promo',     '⏳',
        { type: 'scheduled' }, ['SMS'], {}, {}],
    ['festival',    'Festival',            'seasonal',  '🎉',
        { type: 'scheduled' }, ['SMS'], {}, {}],
    ['dashain',     'Dashain',             'seasonal',  '🪔',
        { type: 'scheduled' }, ['SMS'], {}, {}],
    ['tihar',       'Tihar',               'seasonal',  '🎆',
        { type: 'scheduled' }, ['SMS'], {}, {}],
    ['christmas',   'Christmas',           'seasonal',  '🎄',
        { type: 'scheduled' }, ['SMS'], {}, {}],
    ['valentines',  "Valentine's Day",     'seasonal',  '❤️',
        { type: 'scheduled' }, ['SMS'], {}, {}],
    ['mothers_day', "Mother's Day",        'seasonal',  '🌸',
        { type: 'scheduled' }, ['SMS'], {}, {}],
    ['fathers_day', "Father's Day",        'seasonal',  '👔',
        { type: 'scheduled' }, ['SMS'], {}, {}],
    ['pizza_day',   'Pizza Day',           'foodday',   '🍕',
        { type: 'scheduled' }, ['SMS'], {}, {}],
    ['burger_day',  'Burger Day',          'foodday',   '🍔',
        { type: 'scheduled' }, ['SMS'], {}, {}],
    ['coffee_day',  'Coffee Day',          'foodday',   '☕',
        { type: 'scheduled' }, ['SMS'], {}, {}],
    ['cake_day',    'Cake Day',            'foodday',   '🍰',
        { type: 'scheduled' }, ['SMS'], {}, {}],
    ['referral',    'Referral',            'growth',    '🤝',
        { type: 'event', event: 'referral.created' }, ['SMS'], {}, {}],
    ['review_reward','Review Reward',      'growth',    '📝',
        { type: 'event', event: 'review.submitted' }, ['SMS'], {}, {}],
    ['scratch_card','Scratch Card',        'gamified',  '🎫',
        { type: 'event', event: 'order.completed' }, ['SMS'], {}, { game: 'scratch_card' }],
    ['lucky_draw',  'Lucky Draw',          'gamified',  '🎰',
        { type: 'scheduled' }, ['SMS'], {}, { game: 'lucky_draw' }],
    ['spin_wheel',  'Spin Wheel',          'gamified',  '🎡',
        { type: 'event', event: 'order.completed' }, ['SMS'], {}, { game: 'spin_wheel' }],
    ['bundle',      'Bundle',              'merch',     '📦',
        { type: 'scheduled' }, ['SMS'], {}, {}],
    ['combo',       'Combo',               'merch',     '🍱',
        { type: 'scheduled' }, ['SMS'], {}, {}],
    ['upsell',      'Upsell',              'merch',     '⬆️',
        { type: 'event', event: 'cart.updated' }, ['SMS'], {}, {}],
    ['cross_sell',  'Cross Sell',          'merch',     '➕',
        { type: 'event', event: 'cart.updated' }, ['SMS'], {}, {}],
    ['clearance',   'Clearance',           'merch',     '🏷️',
        { type: 'scheduled' }, ['SMS'], {}, {}],
    ['weather',     'Weather',             'contextual','🌦️',
        { type: 'event', event: 'weather.changed' }, ['SMS'], {}, {}],
    ['student',     'Student',             'segment',   '🎓',
        { type: 'scheduled' }, ['SMS'], { and: [{ field: 'tags', op: 'contains', value: 'student' }] }, {}],
    ['senior',      'Senior',              'segment',   '🧓',
        { type: 'scheduled' }, ['SMS'], { and: [{ field: 'tags', op: 'contains', value: 'senior' }] }, {}],
    ['employee',    'Employee',            'segment',   '🧑‍🍳',
        { type: 'scheduled' }, ['SMS'], { and: [{ field: 'tags', op: 'contains', value: 'employee' }] }, {}],
    ['corporate',   'Corporate',           'segment',   '🏢',
        { type: 'scheduled' }, ['SMS'], { and: [{ field: 'tags', op: 'contains', value: 'corporate' }] }, {}],
    ['qr',          'QR',                  'channel',   '🔳',
        { type: 'event', event: 'qr.scanned' }, ['SMS'], {}, {}],
    ['social',      'Social',              'channel',   '📱',
        { type: 'event', event: 'social.engaged' }, ['SMS'], {}, {}],
    ['google_review','Google Review',      'channel',   '🌟',
        { type: 'event', event: 'review.submitted' }, ['SMS'], {}, {}],
];

// [key, label, provider, isEnabled, sortOrder, config]
// Only SMS is wired to a live sender today; the rest are registered providers
// the queue processor already routes to — enabling one is a flag flip.
const CHANNELS = [
    ['SMS',      'SMS',        'sms',      1, 0, {}],
    ['WHATSAPP', 'WhatsApp',   'whatsapp', 0, 1, {}],
    ['EMAIL',    'Email',      'email',    0, 2, {}],
    ['PUSH',     'Push',       'push',     0, 3, {}],
    ['TELEGRAM', 'Telegram',   'telegram', 0, 4, {}],
    ['VIBER',    'Viber',      'viber',    0, 5, {}],
    ['AICALL',   'AI Call',    'aicall',   0, 6, {}],
];

// permissions: view, create, edit, delete, approve, execute, manage_coupons, manage_settings
const PERMS_ALL = ['view','create','edit','delete','approve','execute','manage_coupons','manage_settings'];
const ROLE_PERMISSIONS = {
    OWNER:     PERMS_ALL,
    ADMIN:     PERMS_ALL,                                   // existing owner-equivalent role
    MANAGER:   ['view','create','edit','approve','execute','manage_coupons'],
    MARKETING: ['view','create','edit','execute','manage_coupons'],
    CASHIER:   ['view','execute'],
    WAITER:    ['view'],
    VIEWER:    ['view'],
};

// [name, channel, typeKey|null, subject|null, body]
const TEMPLATES = [
    ['Birthday — SMS',   'SMS', 'birthday', null,
        'Happy Birthday {{name}}! 🎂 Enjoy {{reward}} on us at MTC. Show code {{coupon}}. Valid {{valid_until}}.'],
    ['Win Back — SMS',   'SMS', 'win_back', null,
        'We miss you {{name}}! Come back to MTC and enjoy {{reward}}. Code {{coupon}}.'],
    ['Flash Sale — SMS', 'SMS', 'flash_sale', null,
        '⚡ Flash Sale at MTC! {{reward}} today only. Use {{coupon}} before {{valid_until}}.'],
    ['Festival — SMS',   'SMS', 'festival', null,
        'Happy {{festival}} from MTC, {{name}}! Celebrate with {{reward}}. Code {{coupon}}.'],
    ['Generic — SMS',    'SMS', null, null,
        'Hi {{name}}, {{message}} — MTC. {{coupon}}'],
];

async function up({ dbGet, dbRun }) {
    if (await isEmpty(dbGet, 'campaign_types')) {
        for (let i = 0; i < CAMPAIGN_TYPES.length; i++) {
            const [key, label, category, icon, trig, chans, aud, cfg] = CAMPAIGN_TYPES[i];
            await dbRun(
                'INSERT INTO campaign_types (`key`, label, category, icon, default_trigger, default_channels, default_audience, default_config, is_system, sort_order) VALUES (?,?,?,?,?,?,?,?,1,?)',
                [key, label, category, icon, JSON.stringify(trig), JSON.stringify(chans), JSON.stringify(aud), JSON.stringify(cfg), i]
            );
        }
    }

    if (await isEmpty(dbGet, 'campaign_channels')) {
        for (const [key, label, provider, enabled, sort, cfg] of CHANNELS) {
            await dbRun(
                'INSERT INTO campaign_channels (`key`, label, provider, is_enabled, sort_order, config) VALUES (?,?,?,?,?,?)',
                [key, label, provider, enabled, sort, JSON.stringify(cfg)]
            );
        }
    }

    if (await isEmpty(dbGet, 'campaign_role_permissions')) {
        for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
            for (const p of perms) {
                await dbRun(
                    `INSERT IGNORE INTO campaign_role_permissions (role, permission) VALUES (?,?)`,
                    [role, p]
                );
            }
        }
    }

    if (await isEmpty(dbGet, 'campaign_templates')) {
        for (const [name, channel, typeKey, subject, body] of TEMPLATES) {
            await dbRun(
                `INSERT INTO campaign_templates (name, channel, type_key, subject, body) VALUES (?,?,?,?,?)`,
                [name, channel, typeKey, subject, body]
            );
        }
    }

    // Ensure the campaign role set exists in pos_roles so operators can assign
    // them to staff (existing WAITER/ADMIN/MANAGER rows are left as-is).
    for (const role of ['OWNER', 'MANAGER', 'MARKETING', 'CASHIER', 'VIEWER']) {
        await dbRun(`INSERT IGNORE INTO pos_roles (name) VALUES (?)`, [role]);
    }
}

module.exports = { up };
