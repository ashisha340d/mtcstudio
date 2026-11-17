'use strict';
/**
 * Message template rendering. Templates are plain strings with {{token}}
 * placeholders; tokens resolve against a flat context object (customer,
 * campaign, coupon, reward fields). Unknown tokens render empty so a partial
 * context never leaks "{{...}}" to a customer.
 */
const { dbGet } = require('../../database/db');

const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

function render(body, ctx = {}) {
    if (!body) return '';
    return String(body).replace(TOKEN_RE, (_, key) => {
        const v = key.split('.').reduce((o, k) => (o == null ? o : o[k]), ctx);
        return v === undefined || v === null ? '' : String(v);
    }).trim();
}

/** Build the render context for a recipient from campaign + customer + reward. */
function buildContext({ customer = {}, campaign = {}, coupon = null, couponCode = null, extra = {} }) {
    return {
        name: customer.name || 'there',
        phone: customer.phone || '',
        email: customer.email || '',
        loyalty_points: customer.loyalty_points ?? 0,
        tier: customer.rewards_tier || 'standard',
        campaign: campaign.name || '',
        festival: campaign.name || '',
        coupon: couponCode || '',
        reward: coupon ? rewardLabel(coupon) : (extra.reward || ''),
        valid_until: coupon?.valid_until ? String(coupon.valid_until).slice(0, 10) : '',
        ...extra,
    };
}

function rewardLabel(coupon) {
    switch (coupon.discount_type) {
        case 'percentage': return `${coupon.value}% off`;
        case 'flat':       return `Rs ${coupon.value} off`;
        case 'free_item':  return 'a free item';
        case 'combo':      return 'a combo deal';
        case 'bogo':       return 'buy 1 get 1';
        case 'delivery':   return 'free delivery';
        default:           return 'a special offer';
    }
}

async function renderTemplate(templateId, ctx) {
    const tpl = await dbGet(`SELECT * FROM campaign_templates WHERE id=?`, [templateId]);
    if (!tpl) return { subject: null, body: render(ctx.message || '', ctx) };
    return { subject: render(tpl.subject, ctx), body: render(tpl.body, ctx) };
}

module.exports = { render, renderTemplate, buildContext, rewardLabel };
