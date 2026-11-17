'use strict';
/**
 * Campaign module DEMO data. Guarded on the `campaigns` table being empty, so
 * on a real install with campaigns it never runs, and it is applied exactly
 * once by the migrator. Everything here is reviewable sample data spanning
 * every campaign status, every coupon discount type, nested AND/OR audiences,
 * runs, an outbound queue covering every queue state, approvals, events and
 * conversion/redemption rows so the Dashboard, Analytics and History have
 * something to show on a fresh demo server.
 *
 * Recipient phones/names are pulled from real `customers` rows when present;
 * otherwise synthetic demo contacts are used (this is a demo dataset).
 */

const DAY = 86400000;
const now = () => new Date();
const dt = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 19).replace('T', ' ');
const J = (v) => JSON.stringify(v);

// Fallback demo contacts (used only when the customers table is empty).
const DEMO_CONTACTS = [
    ['9855046301', 'Ramesh Shrestha'], ['9801122334', 'Sita Gurung'],
    ['9812345678', 'Bikash Thapa'], ['9843009911', 'Anjali Rai'],
    ['9861002200', 'Prakash KC'], ['9807654321', 'Nisha Lama'],
    ['9823456789', 'Dipesh Magar'], ['9849887766', 'Puja Karki'],
    ['9816543210', 'Sabin Tamang'], ['9800011223', 'Rekha Adhikari'],
    ['9851122001', 'Hari Bhandari'], ['9840099887', 'Sunita Poudel'],
];

// ── Reusable audiences — nested AND/OR trees exercising many filter fields ──
const AUDIENCES = [
    ['All Active Customers', 'Every reachable customer with an active status.',
        { and: [{ field: 'status', op: 'eq', value: 'active' }] }],
    ['VIP & Gold Members', 'Top loyalty tiers with healthy point balances.',
        { and: [
            { field: 'rewards_tier', op: 'in', value: ['vip', 'gold', 'platinum'] },
            { field: 'loyalty_points', op: 'gte', value: 100 },
        ] }],
    ['Lapsed High Spenders', 'Big spenders who have not ordered in a while — win-back core.',
        { and: [
            { field: 'total_spent', op: 'gte', value: 5000 },
            { field: 'days_since_last_order', op: 'gte', value: 45 },
            { or: [
                { field: 'rewards_tier', op: 'eq', value: 'gold' },
                { field: 'visit_count', op: 'gte', value: 10 },
            ] },
        ] }],
    ['Birthday This Month', 'Customers with an upcoming birthday.',
        { and: [{ field: 'has_birthday', op: 'eq', value: true }] }],
    ['Students & Seniors', 'Segment discount eligibility by profile tags.',
        { or: [
            { field: 'tags', op: 'contains', value: 'student' },
            { field: 'tags', op: 'contains', value: 'senior' },
        ] }],
    ['New Customers (First Visit)', 'Single-visit customers for onboarding nudges.',
        { and: [{ field: 'visit_count', op: 'eq', value: 1 }] }],
];

// ── Campaigns — one per status at least; varied types, triggers, channels ──
// [name, type_key, status, priority, audienceIdx, trigger, channels, rewards, schedule, approval, offsetDaysLastRun|null, nextRunOffsetDays|null, desc]
const CAMPAIGNS = [
    ['Dashain Dhamaka 2026', 'dashain', 'active', 90, 0,
        { type: 'scheduled' }, ['SMS', 'WHATSAPP'],
        { coupon: 'DASHAIN', discount_type: 'percentage', value: 20 },
        { start_at: dt(-3 * DAY), end_at: dt(12 * DAY) }, 1, -1 * DAY, 2 * DAY,
        'Festival blast — 20% off across the menu for Dashain.'],
    ['Birthday Treats', 'birthday', 'active', 70, 3,
        { type: 'recurring', event: 'customer.birthday', time: '09:00' }, ['SMS'],
        { coupon: 'BDAY', discount_type: 'free_item', value: 0 },
        { recurrence: 'daily', time: '09:00' }, 0, -1 * DAY, 1 * DAY,
        'Automated free slice on every customer birthday.'],
    ['Win Back — 60 Day Lapsed', 'win_back', 'active', 80, 2,
        { type: 'scheduled' }, ['SMS', 'EMAIL'],
        { coupon: 'MISSYOU', discount_type: 'flat', value: 300 },
        { start_at: dt(-10 * DAY) }, 1, -2 * DAY, 5 * DAY,
        'Rs.300 off for customers gone quiet 60+ days.'],
    ['Weekend Flash Sale', 'flash_sale', 'scheduled', 85, 0,
        { type: 'scheduled' }, ['SMS'],
        { coupon: 'FLASH50', discount_type: 'percentage', value: 50, max_discount: 500 },
        { start_at: dt(2 * DAY), end_at: dt(3 * DAY) }, 1, null, 2 * DAY,
        'Half price Saturday, capped at Rs.500.'],
    ['VIP Appreciation', 'vip', 'pending_approval', 75, 1,
        { type: 'scheduled' }, ['SMS', 'WHATSAPP'],
        { coupon: 'VIPLOVE', discount_type: 'bogo', value: 1 },
        { start_at: dt(4 * DAY) }, 1, null, 4 * DAY,
        'Buy-one-get-one for VIP & Gold members.'],
    ['Tihar Lights Offer', 'tihar', 'approved', 88, 0,
        { type: 'scheduled' }, ['SMS'],
        { coupon: 'TIHAR', discount_type: 'combo', value: 0 },
        { start_at: dt(20 * DAY), end_at: dt(25 * DAY) }, 1, null, 20 * DAY,
        'Combo meal special for Tihar week.'],
    ['Happy Hour Coffee', 'happy_hour', 'active', 60, 0,
        { type: 'recurring', window: { start: '16:00', end: '18:00' } }, ['SMS'],
        { coupon: 'HH20', discount_type: 'percentage', value: 20 },
        { recurrence: 'daily', window: { start: '16:00', end: '18:00' } }, 0, -1 * DAY, 1 * DAY,
        '4–6pm every day, 20% off hot drinks.'],
    ['Referral Rewards', 'referral', 'active', 65, 0,
        { type: 'event', event: 'referral.created' }, ['SMS'],
        { coupon: 'REFER', discount_type: 'flat', value: 200 },
        {}, 0, -3 * DAY, null,
        'Rs.200 credit when a referred friend orders.'],
    ['Free Delivery Friday', 'limited_time', 'paused', 55, 0,
        { type: 'scheduled' }, ['SMS'],
        { coupon: 'FREEDEL', discount_type: 'delivery', value: 0 },
        { start_at: dt(-7 * DAY), end_at: dt(7 * DAY) }, 0, -4 * DAY, null,
        'Waived delivery fee on Fridays — currently paused.'],
    ['Student Special', 'student', 'draft', 50, 4,
        { type: 'scheduled' }, ['SMS'],
        { coupon: 'STUDENT15', discount_type: 'percentage', value: 15 },
        {}, 0, null, null,
        'Draft — 15% student discount, pending finalisation.'],
    ['Valentine Couples Combo', 'valentines', 'completed', 70, 0,
        { type: 'scheduled' }, ['SMS', 'WHATSAPP'],
        { coupon: 'LOVE', discount_type: 'combo', value: 0 },
        { start_at: dt(-40 * DAY), end_at: dt(-38 * DAY) }, 1, -39 * DAY, null,
        'Completed — couples combo for Valentine\'s Day.'],
    ['Old Menu Clearance', 'clearance', 'archived', 40, 0,
        { type: 'scheduled' }, ['SMS'],
        { coupon: 'CLEAR30', discount_type: 'percentage', value: 30 },
        { start_at: dt(-90 * DAY), end_at: dt(-80 * DAY) }, 0, -85 * DAY, null,
        'Archived — cleared discontinued items at 30% off.'],
    ['Untargeted Blast (Rejected)', 'festival', 'rejected', 30, 0,
        { type: 'scheduled' }, ['SMS'],
        { coupon: 'GENERIC', discount_type: 'flat', value: 100 },
        {}, 1, null, null,
        'Rejected in approval — audience too broad, no cap.'],
    ['Coffee Day Spin Wheel', 'spin_wheel', 'active', 62, 0,
        { type: 'event', event: 'order.completed' }, ['SMS'],
        { game: 'spin_wheel', coupon: 'SPIN', discount_type: 'percentage', value: 10 },
        {}, 0, -1 * DAY, null,
        'Gamified spin-to-win after each order on Coffee Day.'],
];

// ── Coupons — cover every discount_type and limit/expiry combination ──
// [name, code|null, prefix|null, discount_type, value, freeProdId|null, maxDisc|null, minOrder, uniquePer, usageTotal|null, usagePerCust, perCampLimit|null, validFromOff, validUntilOff, status, campaignName]
const COUPONS = [
    ['Dashain 20% Off',      'DASHAIN20', null,      'percentage', 20, null, 800, 500, 1, 1000, 1, 1000, -3 * DAY, 12 * DAY, 'active', 'Dashain Dhamaka 2026'],
    ['Birthday Free Slice',  null,        'BDAY-',   'free_item',   0, null, null,   0, 1,  null, 1, null, -30 * DAY, 30 * DAY, 'active', 'Birthday Treats'],
    ['Win Back Rs.300',      'MISSYOU300', null,     'flat',      300, null, null, 700, 1,  500, 1,  500, -10 * DAY, 20 * DAY, 'active', 'Win Back — 60 Day Lapsed'],
    ['Flash 50% (Cap 500)',  'FLASH50',   null,      'percentage', 50, null, 500, 300, 1,  200, 1,  200, 2 * DAY, 3 * DAY, 'active', 'Weekend Flash Sale'],
    ['VIP BOGO',             'VIPBOGO',   null,      'bogo',        1, null, null, 400, 1,  300, 2,  300, 3 * DAY, 30 * DAY, 'active', 'VIP Appreciation'],
    ['Tihar Combo Deal',     'TIHARCOMBO', null,     'combo',       0, null, null, 600, 1,  800, 1,  800, 20 * DAY, 25 * DAY, 'active', 'Tihar Lights Offer'],
    ['Free Delivery',        'FREEDEL',   null,      'delivery',    0, null, null, 500, 1,  null, 4, null, -7 * DAY, 7 * DAY, 'disabled', 'Free Delivery Friday'],
    ['Referral Rs.200',      null,        'REF-',    'flat',      200, null, null,   0, 1,  null, 1, null, -30 * DAY, 60 * DAY, 'active', 'Referral Rewards'],
    ['Student 15%',          'STUDENT15', null,      'percentage', 15, null, 300, 300, 1,  null, 1, null, -1 * DAY, 90 * DAY, 'active', 'Student Special'],
    ['Happy Hour 20%',       'HH20',      null,      'percentage', 20, null, 250, 200, 0,  null, 3, null, -30 * DAY, 30 * DAY, 'active', 'Happy Hour Coffee'],
    ['Clearance 30%',        'CLEAR30',   null,      'percentage', 30, null, null, 0,   1,  null, 1, null, -90 * DAY, -80 * DAY, 'disabled', 'Old Menu Clearance'],
    ['Spin Win 10%',         null,        'SPIN-',   'percentage', 10, null, 200,   0,  1,  null, 1, null, -5 * DAY, 30 * DAY, 'active', 'Coffee Day Spin Wheel'],
];

const CODE_STATUSES = ['active', 'redeemed', 'expired', 'void'];
const QUEUE_STATUSES = ['preview', 'pending_approval', 'approved', 'scheduled', 'queued',
    'sending', 'sent', 'delivered', 'failed', 'cancelled', 'paused'];
const RUN_STATUSES = ['completed', 'processing', 'scheduled', 'pending_approval', 'failed', 'cancelled'];

async function isEmpty(dbGet, table) {
    const row = await dbGet(`SELECT COUNT(*) AS n FROM ${table}`);
    return !row || Number(row.n) === 0;
}

async function up({ dbAll, dbGet, dbRun }) {
    // Idempotent demo seed: skip only if the demo set is already present, so a
    // couple of hand-made campaigns don't block the sample data (and re-running
    // never duplicates it).
    const marker = await dbGet(`SELECT id FROM campaigns WHERE name = 'Dashain Dhamaka 2026' LIMIT 1`);
    if (marker) return;

    // Recipients: prefer real customers, else synthetic demo contacts.
    let contacts = [];
    try {
        const rows = await dbAll(
            `SELECT phone, name FROM customers WHERE status = 'active' AND phone IS NOT NULL AND phone <> '' ORDER BY loyalty_points DESC LIMIT 12`
        );
        contacts = rows.map((r) => [String(r.phone), r.name || 'Customer']);
    } catch { /* customers table shape differs — fall through to demo */ }
    if (contacts.length === 0) contacts = DEMO_CONTACTS.slice();

    // ── Audiences ──
    const audienceIds = [];
    for (const [name, desc, rules] of AUDIENCES) {
        const r = await dbRun(
            `INSERT INTO campaign_audiences (name, description, rules, is_active) VALUES (?,?,?,1)`,
            [name, desc, J(rules)]
        );
        audienceIds.push(r.insertId);
    }

    // ── Campaigns ──
    const campaignIdByName = {};
    for (const [name, typeKey, status, priority, audIdx, trig, chans, rewards, schedule, approval, lastRunOff, nextRunOff, desc] of CAMPAIGNS) {
        const approvedStatuses = ['approved', 'active', 'scheduled', 'completed', 'archived'];
        const approved = approvedStatuses.includes(status);
        const r = await dbRun(
            `INSERT INTO campaigns
               (name, description, type_key, status, priority, audience_id, audience,
                trigger_config, conditions, actions, rewards, channels, schedule, config,
                approval_required, version, created_by, approved_by, approved_at,
                last_run_at, next_run_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,?,?,?,?)`,
            [
                name, desc, typeKey, status, priority, audienceIds[audIdx],
                J(AUDIENCES[audIdx][2]),
                J(trig), J({ and: [] }),
                J([{ type: 'send_message' }, { type: 'issue_coupon' }]),
                // rewards is an array in the builder's shape
                J([{ type: 'issue_coupon', reward: rewards }]), J(chans), J(schedule), J({}),
                approval,
                approved ? 1 : null,
                approved ? dt(-5 * DAY) : null,
                lastRunOff != null ? dt(lastRunOff) : null,
                nextRunOff != null ? dt(nextRunOff) : null,
            ]
        );
        campaignIdByName[name] = r.insertId;
    }

    // ── Coupons ──
    const couponIdByName = {};
    for (const [name, code, prefix, dtype, value, freeProd, maxDisc, minOrder, uniquePer, usageTotal, usagePerCust, perCampLimit, vFromOff, vUntilOff, cstatus, campName] of COUPONS) {
        const r = await dbRun(
            `INSERT INTO campaign_coupons
               (campaign_id, name, code, code_prefix, discount_type, value, free_product_id,
                max_discount, min_order_amount, unique_per_customer, usage_limit_total,
                usage_limit_per_customer, per_campaign_limit, valid_from, valid_until, status)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
                campaignIdByName[campName] || null, name, code, prefix, dtype, value, freeProd,
                maxDisc, minOrder, uniquePer, usageTotal, usagePerCust, perCampLimit,
                dt(vFromOff), dt(vUntilOff), cstatus,
            ]
        );
        couponIdByName[name] = { id: r.insertId, campaignId: campaignIdByName[campName] || null, code, prefix };
    }

    // ── Runs — history spine, one per campaign that has run + varied statuses ──
    const runIdByCampaign = {};
    let runStatusPtr = 0;
    for (const [name] of CAMPAIGNS) {
        const cid = campaignIdByName[name];
        const status = RUN_STATUSES[runStatusPtr % RUN_STATUSES.length];
        runStatusPtr++;
        const audienceCount = 40 + (runStatusPtr * 7) % 120;
        const sent = status === 'completed' ? audienceCount : Math.floor(audienceCount * 0.6);
        const failed = status === 'failed' ? Math.floor(audienceCount * 0.3) : Math.floor(audienceCount * 0.05);
        const r = await dbRun(
            `INSERT INTO campaign_runs
               (campaign_id, trigger_type, trigger_ref, status, audience_count, queued_count,
                sent_count, failed_count, scheduled_at, started_at, finished_at, created_by, meta)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)`,
            [
                cid, 'manual', 'seed-demo', status, audienceCount, audienceCount,
                sent, failed,
                status === 'scheduled' ? dt(2 * DAY) : dt(-3 * DAY),
                status === 'scheduled' ? null : dt(-3 * DAY),
                status === 'completed' || status === 'failed' || status === 'cancelled' ? dt(-3 * DAY + 3600000) : null,
                J({ note: 'demo run' }),
            ]
        );
        runIdByCampaign[cid] = r.insertId;
    }

    // ── Coupon codes + redemptions + conversions ──
    let contactPtr = 0;
    const nextContact = () => contacts[(contactPtr++) % contacts.length];
    for (const [name, meta] of Object.entries(couponIdByName)) {
        for (let i = 0; i < 4; i++) {
            const [phone] = nextContact();
            const cstatus = CODE_STATUSES[i % CODE_STATUSES.length];
            const codeStr = (meta.code || meta.prefix || 'CODE') + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
            const codeRow = await dbRun(
                `INSERT INTO campaign_coupon_codes
                   (coupon_id, campaign_id, run_id, customer_phone, code, status, issued_at, redeemed_at, order_id)
                 VALUES (?,?,?,?,?,?,?,?,?)`,
                [
                    meta.id, meta.campaignId, meta.campaignId ? runIdByCampaign[meta.campaignId] : null,
                    phone, codeStr, cstatus, dt(-6 * DAY),
                    cstatus === 'redeemed' ? dt(-2 * DAY) : null,
                    cstatus === 'redeemed' ? 1000 + contactPtr : null,
                ]
            );
            if (cstatus === 'redeemed') {
                const orderAmount = 600 + (i * 137) % 900;
                const discount = 80 + (i * 43) % 220;
                await dbRun(
                    `INSERT INTO campaign_coupon_redemptions
                       (coupon_id, code_id, campaign_id, customer_phone, order_id, discount_amount, order_amount, branch, redeemed_at)
                     VALUES (?,?,?,?,?,?,?,?,?)`,
                    [meta.id, codeRow.insertId, meta.campaignId, phone, 1000 + contactPtr, discount, orderAmount, 'MTC Main', dt(-2 * DAY)]
                );
                if (meta.campaignId) {
                    await dbRun(
                        `INSERT INTO campaign_conversions
                           (campaign_id, run_id, customer_phone, order_id, coupon_code_id, revenue, converted_at)
                         VALUES (?,?,?,?,?,?,?)`,
                        [meta.campaignId, runIdByCampaign[meta.campaignId], phone, 1000 + contactPtr, codeRow.insertId, orderAmount, dt(-2 * DAY)]
                    );
                }
            }
        }
    }

    // ── Queue — cover every queue state across active campaigns ──
    const activeCampaigns = CAMPAIGNS.filter((c) => ['active', 'scheduled', 'pending_approval', 'approved', 'paused'].includes(c[2]));
    let qPtr = 0;
    for (const camp of activeCampaigns) {
        const cid = campaignIdByName[camp[0]];
        const rid = runIdByCampaign[cid];
        const channels = camp[6];
        for (const qstatus of QUEUE_STATUSES) {
            const [phone, cname] = nextContact();
            const channel = channels[qPtr % channels.length];
            qPtr++;
            const sent = ['sending', 'sent', 'delivered'].includes(qstatus);
            await dbRun(
                `INSERT INTO campaign_queue
                   (campaign_id, run_id, customer_phone, customer_name, channel, recipient,
                    subject, message, priority, status, scheduled_at, retry_count, max_retries,
                    error_message, queued_at, sent_at, delivered_at, failed_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [
                    cid, rid, phone, cname, channel, phone,
                    channel === 'EMAIL' ? camp[0] : null,
                    `Hi ${cname}, ${camp[0]} — show your code at MTC to redeem.`,
                    5, qstatus,
                    qstatus === 'scheduled' ? dt(2 * DAY) : null,
                    qstatus === 'failed' ? 3 : 0, 3,
                    qstatus === 'failed' ? 'Provider timeout after 3 retries' : null,
                    ['queued', 'sending', 'sent', 'delivered', 'failed'].includes(qstatus) ? dt(-1 * DAY) : null,
                    sent || qstatus === 'failed' ? dt(-1 * DAY + 60000) : null,
                    qstatus === 'delivered' ? dt(-1 * DAY + 120000) : null,
                    qstatus === 'failed' ? dt(-1 * DAY + 180000) : null,
                ]
            );
        }
    }

    // ── Approval workflow audit trail ──
    const approvalRows = [
        ['VIP Appreciation', 'submit', 'MARKETING', 'Submitted for manager approval.'],
        ['Tihar Lights Offer', 'submit', 'MARKETING', 'Ready for Tihar week.'],
        ['Tihar Lights Offer', 'approve', 'MANAGER', 'Approved — good margin.'],
        ['Untargeted Blast (Rejected)', 'submit', 'MARKETING', 'Broad festival blast.'],
        ['Untargeted Blast (Rejected)', 'reject', 'OWNER', 'Audience too broad, no discount cap.'],
        ['Dashain Dhamaka 2026', 'approve', 'OWNER', 'Approved for launch.'],
    ];
    for (const [campName, action, role, note] of approvalRows) {
        const cid = campaignIdByName[campName];
        if (!cid) continue;
        await dbRun(
            `INSERT INTO campaign_approvals (campaign_id, run_id, action, actor_id, actor_role, note)
             VALUES (?,?,?,?,?,?)`,
            [cid, runIdByCampaign[cid] || null, action, 1, role, note]
        );
    }

    // ── Trigger events — mix of processed/unprocessed across sources ──
    const events = [
        ['customer.birthday', 'system', contacts[0][0], { name: contacts[0][1] }, 1],
        ['order.completed', 'pos', contacts[1][0], { order_id: 1001, amount: 850 }, 1],
        ['referral.created', 'api', contacts[2][0], { referred_by: contacts[0][0] }, 0],
        ['review.submitted', 'webhook', contacts[3][0], { rating: 5, source: 'google' }, 0],
        ['qr.scanned', 'pos', contacts[4][0], { table: 7, branch: 'MTC Main' }, 0],
        ['cart.updated', 'pos', contacts[5 % contacts.length][0], { items: 3, subtotal: 1200 }, 1],
        ['weather.changed', 'system', null, { condition: 'rain', temp_c: 14 }, 0],
    ];
    for (const [etype, source, phone, payload, processed] of events) {
        await dbRun(
            `INSERT INTO campaign_events (event_type, source, customer_phone, payload, processed, processed_at)
             VALUES (?,?,?,?,?,?)`,
            [etype, source, phone, J(payload), processed, processed ? dt(-1 * DAY) : null]
        );
    }
}

module.exports = { up };
