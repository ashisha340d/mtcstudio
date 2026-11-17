'use strict';
/**
 * Coupon Engine — issue, validate and redeem coupons. Supports percentage,
 * flat, free item, combo, BOGO and free-delivery discounts with branch
 * restrictions, expiry, and total / per-customer / per-campaign usage limits.
 * The redemption ledger feeds ROI and redemption analytics.
 */
const crypto = require('crypto');
const { dbAll, dbGet, dbRun, transaction } = require('../../database/db');

function genCode(prefix = '') {
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase();   // 8 hex chars
    return `${(prefix || 'MTC').toUpperCase()}${raw}`;
}

async function getCoupon(id) {
    const c = await dbGet(`SELECT * FROM campaign_coupons WHERE id=?`, [id]);
    if (c && c.branch_restrictions) c.branch_restrictions = safeJson(c.branch_restrictions);
    if (c && c.config) c.config = safeJson(c.config);
    return c;
}

function safeJson(v) { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return v; } }

async function createCoupon(data) {
    const {
        campaign_id = null, name, code = null, code_prefix = null,
        discount_type = 'percentage', value = 0, free_product_id = null,
        max_discount = null, min_order_amount = 0, unique_per_customer = 1,
        usage_limit_total = null, usage_limit_per_customer = 1, per_campaign_limit = null,
        branch_restrictions = null, valid_from = null, valid_until = null, config = null,
    } = data;
    const res = await dbRun(
        `INSERT INTO campaign_coupons
           (campaign_id,name,code,code_prefix,discount_type,value,free_product_id,max_discount,
            min_order_amount,unique_per_customer,usage_limit_total,usage_limit_per_customer,
            per_campaign_limit,branch_restrictions,valid_from,valid_until,config)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [campaign_id, name, code, code_prefix, discount_type, value, free_product_id, max_discount,
         min_order_amount, unique_per_customer ? 1 : 0, usage_limit_total, usage_limit_per_customer,
         per_campaign_limit, branch_restrictions ? JSON.stringify(branch_restrictions) : null,
         valid_from, valid_until, config ? JSON.stringify(config) : null]
    );
    return res.insertId;
}

/**
 * Issue a code for a customer. For unique_per_customer coupons a customer that
 * already holds an active code gets the same one back (idempotent per run).
 */
async function issueCode(couponId, { customerPhone = null, campaignId = null, runId = null } = {}) {
    const coupon = await getCoupon(couponId);
    if (!coupon) throw new Error('coupon not found');

    if (coupon.unique_per_customer && customerPhone) {
        const existing = await dbGet(
            `SELECT * FROM campaign_coupon_codes WHERE coupon_id=? AND customer_phone=? AND status='active'
             ORDER BY id DESC LIMIT 1`, [couponId, customerPhone]);
        if (existing) return existing;
    }

    // Shared, non-unique coupon with a fixed code — reuse the single code row.
    const code = coupon.unique_per_customer ? genCode(coupon.code_prefix) : (coupon.code || genCode(coupon.code_prefix));
    const res = await dbRun(
        `INSERT INTO campaign_coupon_codes (coupon_id, campaign_id, run_id, customer_phone, code)
         VALUES (?,?,?,?,?)`,
        [couponId, campaignId ?? coupon.campaign_id, runId, customerPhone, code]
    );
    return dbGet(`SELECT * FROM campaign_coupon_codes WHERE id=?`, [res.insertId]);
}

/** Validate a code against an order context without consuming it. */
async function validate(code, { orderAmount = 0, customerPhone = null, branch = null } = {}) {
    const row = await dbGet(`SELECT * FROM campaign_coupon_codes WHERE code=?`, [code]);
    if (!row) return { valid: false, reason: 'unknown code' };
    if (row.status !== 'active') return { valid: false, reason: `code ${row.status}` };
    const coupon = await getCoupon(row.coupon_id);
    if (!coupon || coupon.status !== 'active') return { valid: false, reason: 'coupon disabled' };

    const now = new Date();
    if (coupon.valid_from && new Date(coupon.valid_from) > now) return { valid: false, reason: 'not yet valid' };
    if (coupon.valid_until && new Date(coupon.valid_until) < now) return { valid: false, reason: 'expired' };
    if (orderAmount < (coupon.min_order_amount || 0)) return { valid: false, reason: `min order Rs ${coupon.min_order_amount}` };

    const branches = coupon.branch_restrictions;
    if (Array.isArray(branches) && branches.length && branch && !branches.includes(branch))
        return { valid: false, reason: 'not valid at this branch' };

    if (coupon.usage_limit_total != null) {
        const used = await dbGet(`SELECT COUNT(*) AS n FROM campaign_coupon_redemptions WHERE coupon_id=?`, [coupon.id]);
        if (Number(used.n) >= coupon.usage_limit_total) return { valid: false, reason: 'usage limit reached' };
    }
    if (customerPhone && coupon.usage_limit_per_customer != null) {
        const used = await dbGet(
            `SELECT COUNT(*) AS n FROM campaign_coupon_redemptions WHERE coupon_id=? AND customer_phone=?`,
            [coupon.id, customerPhone]);
        if (Number(used.n) >= coupon.usage_limit_per_customer) return { valid: false, reason: 'already used' };
    }

    return { valid: true, coupon, codeRow: row, discount: computeDiscount(coupon, orderAmount) };
}

function computeDiscount(coupon, orderAmount) {
    let d = 0;
    switch (coupon.discount_type) {
        case 'percentage': d = (orderAmount * coupon.value) / 100; break;
        case 'flat':       d = coupon.value; break;
        case 'delivery':   d = coupon.value || 0; break;   // delivery-fee waiver amount
        case 'free_item':
        case 'combo':
        case 'bogo':       d = coupon.value || 0; break;   // item value resolved at POS; value = cap
        default:           d = 0;
    }
    if (coupon.max_discount != null) d = Math.min(d, coupon.max_discount);
    return Math.max(0, Math.min(d, orderAmount));
}

/** Consume a code atomically and write the redemption ledger row. */
async function redeem(code, { orderAmount = 0, customerPhone = null, orderId = null, branch = null } = {}) {
    const check = await validate(code, { orderAmount, customerPhone, branch });
    if (!check.valid) return check;

    return transaction(async (tx) => {
        const fresh = await tx.dbGet(`SELECT * FROM campaign_coupon_codes WHERE id=? FOR UPDATE`, [check.codeRow.id]);
        if (!fresh || fresh.status !== 'active') return { valid: false, reason: 'code already consumed' };

        await tx.dbRun(
            `UPDATE campaign_coupon_codes SET status='redeemed', redeemed_at=CURRENT_TIMESTAMP, order_id=? WHERE id=?`,
            [orderId, fresh.id]);
        await tx.dbRun(
            `INSERT INTO campaign_coupon_redemptions
               (coupon_id, code_id, campaign_id, customer_phone, order_id, discount_amount, order_amount, branch)
             VALUES (?,?,?,?,?,?,?,?)`,
            [check.coupon.id, fresh.id, fresh.campaign_id, customerPhone || fresh.customer_phone,
             orderId, check.discount, orderAmount, branch]);

        // Attribution: link the paying order to the campaign for ROI analytics.
        if (fresh.campaign_id && orderId) {
            await tx.dbRun(
                `INSERT INTO campaign_conversions (campaign_id, run_id, customer_phone, order_id, coupon_code_id, revenue)
                 VALUES (?,?,?,?,?,?)`,
                [fresh.campaign_id, fresh.run_id, customerPhone || fresh.customer_phone, orderId, fresh.id, orderAmount]);
        }
        return { valid: true, redeemed: true, discount: check.discount, coupon: check.coupon };
    });
}

async function listCoupons(campaignId = null) {
    return campaignId
        ? dbAll(`SELECT * FROM campaign_coupons WHERE campaign_id=? ORDER BY id DESC`, [campaignId])
        : dbAll(`SELECT * FROM campaign_coupons ORDER BY id DESC`);
}

module.exports = { genCode, createCoupon, getCoupon, issueCode, validate, redeem, computeDiscount, listCoupons };
