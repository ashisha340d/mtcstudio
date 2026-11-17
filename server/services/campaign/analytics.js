'use strict';
/**
 * Campaign Analytics — revenue, ROI, conversion, redemption, orders, average
 * ticket, retention, repeat visits, branch comparison, customer growth and
 * per-campaign performance. Built entirely on the campaign ledger tables plus
 * the existing pos_orders sales data (no duplicated sales storage).
 */
const { dbGet, dbAll } = require('../../database/db');

const COST_PER_MESSAGE = Number(process.env.CAMPAIGN_SMS_COST) || 0;

const num = (v) => Number(v) || 0;

/** Per-campaign performance card. */
async function campaignPerformance(campaignId) {
    const camp = await dbGet(`SELECT * FROM campaigns WHERE id=?`, [campaignId]);
    if (!camp) return null;
    const cfg = safe(camp.config);

    const q = await dbGet(
        `SELECT COUNT(*) AS total,
                SUM(status='sent' OR status='delivered') AS sent,
                SUM(status='failed') AS failed,
                COUNT(DISTINCT customer_phone) AS reached
         FROM campaign_queue WHERE campaign_id=?`, [campaignId]);

    const issued = await dbGet(`SELECT COUNT(*) AS n FROM campaign_coupon_codes WHERE campaign_id=?`, [campaignId]);
    const redeemed = await dbGet(
        `SELECT COUNT(*) AS n, COALESCE(SUM(discount_amount),0) AS discount
         FROM campaign_coupon_redemptions WHERE campaign_id=?`, [campaignId]);
    const conv = await dbGet(
        `SELECT COUNT(*) AS orders, COUNT(DISTINCT customer_phone) AS customers,
                COALESCE(SUM(revenue),0) AS revenue, COALESCE(AVG(revenue),0) AS avg_ticket
         FROM campaign_conversions WHERE campaign_id=?`, [campaignId]);

    const sent = num(q?.sent);
    const revenue = num(conv?.revenue);
    const cost = num(cfg.budget) || (sent * COST_PER_MESSAGE) + num(redeemed?.discount);
    const roi = cost > 0 ? ((revenue - cost) / cost) * 100 : null;

    return {
        campaign_id: campaignId,
        messages: { total: num(q?.total), sent, failed: num(q?.failed), reached: num(q?.reached) },
        coupons: { issued: num(issued?.n), redeemed: num(redeemed?.n),
                   redemption_rate: num(issued?.n) ? num(redeemed?.n) / num(issued?.n) : 0,
                   discount_given: num(redeemed?.discount) },
        conversion: { orders: num(conv?.orders), customers: num(conv?.customers),
                      conversion_rate: sent ? num(conv?.customers) / sent : 0 },
        revenue, avg_ticket: num(conv?.avg_ticket), cost, roi,
    };
}

/** Portfolio-level dashboard metrics. */
async function overview({ from = null, to = null } = {}) {
    const range = dateWhere('c.converted_at', from, to);
    const counts = await dbGet(
        `SELECT
            (SELECT COUNT(*) FROM campaigns) AS total,
            (SELECT COUNT(*) FROM campaigns WHERE status='active') AS active,
            (SELECT COUNT(*) FROM campaigns WHERE status='pending_approval') AS pending,
            (SELECT COUNT(*) FROM campaigns WHERE status='paused') AS paused`);
    const rev = await dbGet(
        `SELECT COALESCE(SUM(revenue),0) AS revenue, COUNT(*) AS orders,
                COUNT(DISTINCT customer_phone) AS customers
         FROM campaign_conversions c WHERE 1 ${range.clause}`, range.params);
    const redeem = await dbGet(
        `SELECT COUNT(*) AS n, COALESCE(SUM(discount_amount),0) AS discount
         FROM campaign_coupon_redemptions WHERE 1`);
    const sent = await dbGet(
        `SELECT COUNT(*) AS n FROM campaign_queue WHERE status IN ('sent','delivered')`);
    const issued = await dbGet(`SELECT COUNT(*) AS n FROM campaign_coupon_codes`);

    const revenue = num(rev?.revenue);
    const cost = num(sent?.n) * COST_PER_MESSAGE + num(redeem?.discount);
    return {
        campaigns: { total: num(counts?.total), active: num(counts?.active),
                     pending: num(counts?.pending), paused: num(counts?.paused) },
        revenue, orders: num(rev?.orders), customers: num(rev?.customers),
        messages_sent: num(sent?.n),
        coupons: { issued: num(issued?.n), redeemed: num(redeem?.n),
                   redemption_rate: num(issued?.n) ? num(redeem?.n) / num(issued?.n) : 0,
                   discount_given: num(redeem?.discount) },
        cost, roi: cost > 0 ? ((revenue - cost) / cost) * 100 : null,
        avg_ticket: num(rev?.orders) ? revenue / num(rev.orders) : 0,
    };
}

/** Leaderboard — top campaigns by revenue. */
async function leaderboard(limit = 10) {
    return dbAll(
        `SELECT ca.id, ca.name, ca.type_key, ca.status,
                COALESCE(SUM(cc.revenue),0) AS revenue,
                COUNT(cc.id) AS orders,
                COUNT(DISTINCT cc.customer_phone) AS customers
         FROM   campaigns ca
         LEFT JOIN campaign_conversions cc ON cc.campaign_id = ca.id
         GROUP  BY ca.id
         ORDER  BY revenue DESC
         LIMIT  ?`, [Number(limit) || 10]);
}

/** Repeat-visit / retention: customers touched who returned to buy again. */
async function retention(campaignId) {
    const row = await dbGet(
        `SELECT COUNT(DISTINCT q.customer_phone) AS reached,
                COUNT(DISTINCT cc.customer_phone) AS returned
         FROM   campaign_queue q
         LEFT JOIN campaign_conversions cc
                ON cc.campaign_id = q.campaign_id AND cc.customer_phone = q.customer_phone
         WHERE  q.campaign_id=? AND q.status IN ('sent','delivered')`, [campaignId]);
    const reached = num(row?.reached), returned = num(row?.returned);
    return { reached, returned, retention_rate: reached ? returned / reached : 0 };
}

/** Branch comparison from redemption ledger. */
async function branchComparison(campaignId = null) {
    const where = campaignId ? 'WHERE campaign_id=?' : '';
    const params = campaignId ? [campaignId] : [];
    return dbAll(
        `SELECT COALESCE(branch,'—') AS branch, COUNT(*) AS redemptions,
                COALESCE(SUM(order_amount),0) AS revenue, COALESCE(SUM(discount_amount),0) AS discount
         FROM   campaign_coupon_redemptions ${where}
         GROUP  BY branch ORDER BY revenue DESC`, params);
}

/** Customer growth — new customers per month (existing customers table). */
async function customerGrowth(months = 12) {
    return dbAll(
        `SELECT DATE_FORMAT(created_at,'%Y-%m') AS month, COUNT(*) AS new_customers
         FROM   customers
         WHERE  created_at >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
         GROUP  BY month ORDER BY month`, [Number(months) || 12]);
}

/** Revenue timeline for a campaign (or all). */
async function revenueTimeline(campaignId = null, days = 30) {
    const where = campaignId ? 'AND campaign_id=?' : '';
    const params = campaignId ? [Number(days) || 30, campaignId] : [Number(days) || 30];
    return dbAll(
        `SELECT DATE(converted_at) AS day, COALESCE(SUM(revenue),0) AS revenue, COUNT(*) AS orders
         FROM   campaign_conversions
         WHERE  converted_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY) ${where}
         GROUP  BY day ORDER BY day`, params);
}

function dateWhere(col, from, to) {
    const parts = [], params = [];
    if (from) { parts.push(`${col} >= ?`); params.push(from); }
    if (to)   { parts.push(`${col} <= ?`); params.push(to); }
    return { clause: parts.length ? 'AND ' + parts.join(' AND ') : '', params };
}

function safe(v) { try { return typeof v === 'string' ? JSON.parse(v) : (v || {}); } catch { return {}; } }

module.exports = {
    campaignPerformance, overview, leaderboard, retention,
    branchComparison, customerGrowth, revenueTimeline,
};
