'use strict';
/**
 * Trigger Engine — the entry point for every non-scheduled trigger:
 * event-driven, webhook, API, POS/system and manual. It records the event,
 * finds active campaigns whose trigger matches, and asks the campaign engine
 * to build a run (targeted at the event's customer when one is supplied).
 *
 * Any module can fire a trigger with a single call:
 *   triggerEngine.emitEvent('order.completed', { customer_phone, payload })
 */
const { dbAll, dbGet, dbRun } = require('../../database/db');
const engine = require('./campaignEngine');
const audience = require('./audienceBuilder');

const parse = (v, d = null) => { try { return v == null ? d : (typeof v === 'string' ? JSON.parse(v) : v); } catch { return d; } };
const EVENT_TRIGGERS = new Set(['event', 'webhook', 'api', 'system']);

// Load the customer record (with aggregates) so per-recipient conditions can
// evaluate against visit/spend fields for event-driven, single-customer runs.
async function loadCustomer(phone) {
    if (!phone) return null;
    const rows = await audience.resolve({ and: [{ field: 'phone', op: 'eq', value: phone }] }, { status: 'all', limit: 1 });
    return rows[0] || null;
}

async function matchingCampaigns(eventType) {
    const rows = await dbAll(
        `SELECT * FROM campaigns WHERE status='active' ORDER BY priority DESC, id ASC`);
    return rows.filter(c => {
        const t = parse(c.trigger_config, {});
        return EVENT_TRIGGERS.has(t.type) && (t.event === eventType || t.event === '*');
    });
}

/**
 * Fire an event. Records it, runs every matching active campaign, marks it
 * processed. Returns the list of runs created.
 */
async function emitEvent(eventType, { customer_phone = null, payload = {}, source = 'system', createdBy = null } = {}) {
    const evRes = await dbRun(
        `INSERT INTO campaign_events (event_type, source, customer_phone, payload) VALUES (?,?,?,?)`,
        [eventType, source, customer_phone, JSON.stringify(payload || {})]);
    const eventId = evRes.insertId;

    const campaigns = await matchingCampaigns(eventType);
    const customer = customer_phone ? await loadCustomer(customer_phone) : null;
    const runs = [];
    for (const c of campaigns) {
        try {
            const res = await engine.buildRun(c.id, {
                triggerType: source, triggerRef: `${eventType}#${eventId}`, createdBy,
                targetCustomer: customer_phone ? customer : null,
            });
            runs.push({ campaign_id: c.id, ...res });
        } catch (e) {
            console.error(`[campaign-trigger] campaign ${c.id} failed on ${eventType}:`, e.message);
        }
    }
    await dbRun(`UPDATE campaign_events SET processed=1, processed_at=CURRENT_TIMESTAMP WHERE id=?`, [eventId]);
    return { eventId, runs };
}

/** Drain webhook/API events that were recorded but not yet processed. */
async function processPendingEvents(limit = 50) {
    const rows = await dbAll(
        `SELECT * FROM campaign_events WHERE processed=0 ORDER BY id ASC LIMIT ?`, [limit]);
    for (const ev of rows) {
        const campaigns = await matchingCampaigns(ev.event_type);
        const customer = ev.customer_phone ? await loadCustomer(ev.customer_phone) : null;
        for (const c of campaigns) {
            try {
                await engine.buildRun(c.id, {
                    triggerType: ev.source, triggerRef: `${ev.event_type}#${ev.id}`,
                    targetCustomer: ev.customer_phone ? customer : null,
                });
            } catch (e) { console.error('[campaign-trigger] pending event failed:', e.message); }
        }
        await dbRun(`UPDATE campaign_events SET processed=1, processed_at=CURRENT_TIMESTAMP WHERE id=?`, [ev.id]);
    }
    return rows.length;
}

module.exports = { emitEvent, processPendingEvents, matchingCampaigns, loadCustomer };
