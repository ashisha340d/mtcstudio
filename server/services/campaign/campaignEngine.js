'use strict';
/**
 * Campaign Engine — the configuration-driven orchestrator.
 *
 * A campaign is a declarative bundle (audience, trigger, conditions, actions,
 * rewards, channels, schedule, approval). Building a run means:
 *   1. resolve the audience to concrete customers,
 *   2. per recipient, evaluate `conditions` (rule engine) — skip on miss,
 *   3. run each configured `action` / `reward` (extensible ACTION handlers),
 *   4. render each enabled `channel` message and enqueue a campaign_queue row,
 *   5. honour the approval workflow (queue as pending_approval vs queued).
 *
 * No campaign type is special-cased here — behaviour is entirely the config.
 */
const { dbAll, dbGet, dbRun } = require('../../database/db');
const ruleEngine = require('./ruleEngine');
const audience = require('./audienceBuilder');
const coupons = require('./couponEngine');
const template = require('./templateEngine');
const channels = require('./channels');
const socketServer = require('../../pos/socketServer');

const parse = (v, d = null) => { try { return v == null ? d : (typeof v === 'string' ? JSON.parse(v) : v); } catch { return d; } };

function hydrate(c) {
    if (!c) return c;
    return {
        ...c,
        audience: parse(c.audience, null),
        trigger_config: parse(c.trigger_config, {}),
        conditions: parse(c.conditions, null),
        actions: parse(c.actions, []),
        rewards: parse(c.rewards, []),
        channels: parse(c.channels, []),
        schedule: parse(c.schedule, {}),
        config: parse(c.config, {}),
        branch_restrictions: parse(c.branch_restrictions, null),
    };
}

async function getCampaign(id) {
    return hydrate(await dbGet(`SELECT * FROM campaigns WHERE id=?`, [id]));
}

// Resolve the effective audience tree: inline audience wins, else saved segment,
// else the campaign type's default audience.
async function resolveAudienceTree(campaign) {
    if (campaign.audience) return campaign.audience;
    if (campaign.audience_id) {
        const seg = await dbGet(`SELECT rules FROM campaign_audiences WHERE id=?`, [campaign.audience_id]);
        if (seg) return parse(seg.rules, null);
    }
    const type = await dbGet('SELECT default_audience FROM campaign_types WHERE `key`=?', [campaign.type_key]);
    return type ? parse(type.default_audience, null) : null;
}

// Normalize channels config to [{ channel, template_id }]. Accepts ['SMS'] or
// [{ channel:'SMS', template_id: 3 }].
function normalizeChannels(campaign) {
    const arr = Array.isArray(campaign.channels) ? campaign.channels : [];
    return arr.map(c => (typeof c === 'string' ? { channel: c, template_id: null } : c))
              .filter(c => c && c.channel);
}

// ── Extensible per-recipient action handlers ─────────────────────
// Each returns partial context (e.g. an issued coupon) merged into the render
// context. New action types are registered, never branched into the engine.
const ACTION_HANDLERS = {
    async issue_coupon(action, { campaign, run, customer }) {
        const couponId = action.coupon_id || campaign.config?.coupon_id;
        if (!couponId) return {};
        const code = await coupons.issueCode(couponId, {
            customerPhone: customer.phone, campaignId: campaign.id, runId: run.id,
        });
        const coupon = await coupons.getCoupon(couponId);
        return { coupon, couponCode: code.code, coupon_code_id: code.id };
    },
    async create_coupon(action, ctx) {
        const def = action.coupon || {};
        const couponId = await coupons.createCoupon({ ...def, campaign_id: ctx.campaign.id });
        return ACTION_HANDLERS.issue_coupon({ coupon_id: couponId }, ctx);
    },
    async add_loyalty_points(action, { customer }) {
        const pts = Number(action.points) || 0;
        if (pts && customer.phone) {
            await dbRun(`UPDATE customers SET loyalty_points = loyalty_points + ? WHERE phone=?`, [pts, customer.phone]);
        }
        return { points_added: pts };
    },
    async set_tier(action, { customer }) {
        if (action.tier && customer.phone) {
            await dbRun(`UPDATE customers SET rewards_tier=? WHERE phone=?`, [action.tier, customer.phone]);
        }
        return {};
    },
};

function registerAction(type, handler) { ACTION_HANDLERS[type] = handler; }

async function runActions(campaign, run, customer) {
    let ctx = {};
    const list = [
        ...(campaign.rewards || []),
        ...(campaign.actions || []).filter(a => a && a.type && ACTION_HANDLERS[a.type]),
    ];
    for (const action of list) {
        const handler = ACTION_HANDLERS[action.type];
        if (!handler) continue;
        try { Object.assign(ctx, await handler(action, { campaign, run, customer }) || {}); }
        catch (e) { console.error(`[campaign] action ${action.type} failed:`, e.message); }
    }
    return ctx;
}

/**
 * Build (materialize) a run for a campaign: resolve audience, evaluate
 * conditions, run actions, enqueue per-channel messages. If a single
 * `targetCustomer` is passed (event-driven), only that customer is considered.
 */
async function buildRun(campaignId, { triggerType = 'manual', triggerRef = null, createdBy = null, targetCustomer = null, audienceTree = undefined, extraAudience = null } = {}) {
    const campaign = await getCampaign(campaignId);
    if (!campaign) throw new Error('campaign not found');

    const approvalNeeded = !!campaign.approval_required;
    const runStatus = approvalNeeded ? 'pending_approval' : 'processing';
    const runRes = await dbRun(
        `INSERT INTO campaign_runs (campaign_id, trigger_type, trigger_ref, status, started_at, created_by)
         VALUES (?,?,?,?,CURRENT_TIMESTAMP,?)`,
        [campaign.id, triggerType, triggerRef, runStatus, createdBy]
    );
    const run = { id: runRes.insertId, ...campaign, campaign_id: campaign.id };

    // Resolve recipients.
    let recipients;
    if (targetCustomer) {
        recipients = [targetCustomer];
    } else {
        let tree = audienceTree !== undefined ? audienceTree : await resolveAudienceTree(campaign);
        if (extraAudience) tree = { and: [tree, extraAudience].filter(Boolean) };
        recipients = await audience.resolve(tree, { limit: campaign.config?.audience_limit || null });
    }

    const chans = normalizeChannels(campaign);
    const chanMap = await channels.channelMap();
    const queueStatus = approvalNeeded ? 'pending_approval' : 'queued';
    let queued = 0, audienceCount = 0;

    // Dedupe against messages already in flight for this campaign so
    // re-running (manual "Run Now", or a scheduler retry) doesn't pile a
    // second batch on top of one that hasn't finished sending yet. Once a
    // row reaches a terminal state (sent/delivered/failed/cancelled/rejected)
    // it no longer blocks — that's what lets a daily lifecycle campaign
    // (birthday) message the same customer again next year.
    const inFlight = await dbAll(
        `SELECT customer_phone, channel FROM campaign_queue
         WHERE campaign_id=? AND status IN
           ('preview','pending_approval','approved','scheduled','queued','sending','paused')`,
        [campaign.id]);
    const inFlightSet = new Set(inFlight.map(r => `${r.customer_phone}|${r.channel}`));

    for (const customer of recipients) {
        // Per-recipient condition gate (nested AND/OR).
        if (campaign.conditions && !ruleEngine.evaluate(campaign.conditions, customer)) continue;
        audienceCount++;

        const actionCtx = await runActions(campaign, run, customer);
        const renderCtx = template.buildContext({
            customer,
            campaign,
            coupon: actionCtx.coupon || null,
            couponCode: actionCtx.couponCode || null,
            extra: { message: campaign.config?.message || '', ...campaign.config?.tokens },
        });

        for (const spec of chans) {
            const chan = chanMap[spec.channel];
            if (!chan || !chan.is_enabled) continue;                 // skip disabled channels
            const recipient = channels.recipientFor(spec.channel, customer);
            if (!recipient) continue;
            if (inFlightSet.has(`${customer.phone}|${spec.channel}`)) continue;  // already queued/sending, don't duplicate

            const tplId = spec.template_id || campaign.config?.template_id ||
                          await defaultTemplateId(spec.channel, campaign.type_key);
            let subject = null, body;
            if (tplId) {
                const r = await template.renderTemplate(tplId, renderCtx);
                subject = r.subject; body = r.body;
            } else {
                body = template.render(campaign.config?.message || '{{message}}', renderCtx);
            }

            await dbRun(
                `INSERT INTO campaign_queue
                   (campaign_id, run_id, customer_phone, customer_name, channel, recipient, template_id,
                    subject, message, coupon_code_id, payload, priority, status, scheduled_at, max_retries)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [campaign.id, run.id, customer.phone, customer.name, spec.channel, recipient, tplId || null,
                 subject, body, actionCtx.coupon_code_id || null,
                 JSON.stringify({ customer_phone: customer.phone, config: chan.config, template_id: tplId || null }),
                 campaign.priority || 5, queueStatus, campaign.schedule?.send_at || null, 3]
            );
            inFlightSet.add(`${customer.phone}|${spec.channel}`);
            queued++;
        }
    }

    await dbRun(
        `UPDATE campaign_runs SET status=?, audience_count=?, queued_count=? WHERE id=?`,
        [approvalNeeded ? 'pending_approval' : 'processing', audienceCount, queued, run.id]
    );
    await dbRun(`UPDATE campaigns SET last_run_at=CURRENT_TIMESTAMP WHERE id=?`, [campaign.id]);
    emit(campaign.id, run.id);
    return { runId: run.id, audienceCount, queued, approvalNeeded };
}

async function defaultTemplateId(channel, typeKey) {
    const row = await dbGet(
        `SELECT id FROM campaign_templates WHERE channel=? AND (type_key=? OR type_key IS NULL) AND is_active=1
         ORDER BY (type_key=?) DESC, id ASC LIMIT 1`,
        [channel, typeKey, typeKey]);
    return row ? row.id : null;
}

function emit(campaignId, runId) {
    try { socketServer.emitCampaignUpdate({ campaign_id: campaignId, run_id: runId }); } catch { /* socket optional */ }
}

module.exports = {
    getCampaign, hydrate, buildRun, resolveAudienceTree, normalizeChannels,
    registerAction, runActions, ACTION_HANDLERS,
};
