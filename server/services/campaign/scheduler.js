'use strict';
/**
 * Campaign Scheduler — fires time-based campaigns (scheduled, recurring,
 * lifecycle date campaigns like Birthday/Anniversary) and drains pending
 * webhook/API events. Each active time-based campaign carries a `next_run_at`;
 * the scheduler fires it when due, then recomputes the next occurrence.
 *
 * Times are handled in the server's local zone (MySQL stores Nepal local time),
 * matching the rest of the codebase.
 */
const { dbAll, dbGet, dbRun } = require('../../database/db');
const engine = require('./campaignEngine');
const triggerEngine = require('./triggerEngine');

const TICK_MS = Number(process.env.CAMPAIGN_SCHED_TICK_MS) || 60000;
const TIME_TRIGGERS = new Set(['scheduled', 'recurring']);
const parse = (v, d = null) => { try { return v == null ? d : (typeof v === 'string' ? JSON.parse(v) : v); } catch { return d; } };

let timer = null;

function atTime(date, hhmm) {
    const [h, m] = String(hhmm || '09:00').split(':').map(Number);
    const d = new Date(date);
    d.setHours(h || 0, m || 0, 0, 0);
    return d;
}

/** Next fire time for a campaign from its schedule config, relative to `from`. */
function computeNextRun(campaign, from = new Date()) {
    const sched = parse(campaign.schedule, {}) || {};
    const trig = parse(campaign.trigger_config, {}) || {};
    if (!TIME_TRIGGERS.has(trig.type)) {
        // Lifecycle date events (birthday/anniversary) run daily at their time.
        if (trig.type === 'recurring' || trig.event) return atTimeNextDay(from, trig.time || sched.time || '09:00');
        return null;
    }
    const rec = (sched.recurrence || (trig.type === 'recurring' ? 'daily' : 'once')).toLowerCase();
    const time = sched.time || trig.time || '09:00';
    const start = sched.start_at ? new Date(sched.start_at) : from;
    const base = start > from ? start : from;

    switch (rec) {
        case 'once':
            return sched.start_at && new Date(sched.start_at) > from ? new Date(sched.start_at) : null;
        case 'daily':
            return atTimeNextDay(base, time);
        case 'weekly': {
            const days = (sched.days || []).map(Number);           // 0=Sun..6=Sat
            for (let i = 0; i < 8; i++) {
                const d = atTime(new Date(base.getTime() + i * 86400000), time);
                if (d > from && (!days.length || days.includes(d.getDay()))) return d;
            }
            return atTimeNextDay(base, time);
        }
        case 'monthly': {
            const dom = Number(sched.day_of_month) || base.getDate();
            let d = atTime(new Date(base.getFullYear(), base.getMonth(), dom), time);
            if (d <= from) d = atTime(new Date(base.getFullYear(), base.getMonth() + 1, dom), time);
            return d;
        }
        case 'yearly': {
            const [mo, day] = String(sched.date || '01-01').split('-').map(Number);
            let d = atTime(new Date(base.getFullYear(), (mo || 1) - 1, day || 1), time);
            if (d <= from) d = atTime(new Date(base.getFullYear() + 1, (mo || 1) - 1, day || 1), time);
            return d;
        }
        default:
            return atTimeNextDay(base, time);
    }
}

function atTimeNextDay(from, time) {
    let d = atTime(from, time);
    if (d <= from) d = atTime(new Date(from.getTime() + 86400000), time);
    return d;
}

// Lifecycle campaigns restrict the audience to "today" using birthday/anniv
// derived fields — injected at fire time so no dynamic date is stored.
function extraAudienceFor(trig) {
    const now = new Date();
    const mm = now.getMonth() + 1, dd = now.getDate();
    if (trig.event === 'customer.birthday' || trig.type === 'recurring' && trig.event === 'customer.birthday') {
        return { and: [{ field: 'birthday_month', op: 'eq', value: mm }, { field: 'birthday_day', op: 'eq', value: dd }] };
    }
    return null;
}

async function fireDue() {
    const rows = await dbAll(
        `SELECT * FROM campaigns WHERE status IN ('active','scheduled')
           AND next_run_at IS NOT NULL AND next_run_at <= NOW()
         ORDER BY priority DESC, id ASC LIMIT 20`);
    for (const c of rows) {
        const trig = parse(c.trigger_config, {}) || {};
        try {
            await engine.buildRun(c.id, {
                triggerType: 'scheduled',
                triggerRef: `sched@${c.next_run_at}`,
                extraAudience: extraAudienceFor(trig),
            });
        } catch (e) {
            console.error(`[campaign-sched] campaign ${c.id} run failed:`, e.message);
        }
        const next = computeNextRun(c);
        await dbRun(
            `UPDATE campaigns SET next_run_at=?, status=IF(?, status, 'completed') WHERE id=?`,
            [next ? toMysql(next) : null, next ? 1 : 0, c.id]);
    }
}

function toMysql(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

async function tick() {
    await triggerEngine.processPendingEvents().catch(e => console.error('[campaign-sched] events', e.message));
    await fireDue();
}

/** Recompute + persist next_run_at for a campaign (called on save/activate). */
async function reschedule(campaignId) {
    const c = await dbGet(`SELECT * FROM campaigns WHERE id=?`, [campaignId]);
    if (!c) return;
    const next = computeNextRun(c);
    await dbRun(`UPDATE campaigns SET next_run_at=? WHERE id=?`, [next ? toMysql(next) : null, campaignId]);
    return next;
}

function start() {
    if (timer) return;
    timer = setInterval(() => tick().catch(e => console.error('[campaign-sched]', e.message)), TICK_MS);
    timer.unref();
}

module.exports = { start, tick, computeNextRun, reschedule, toMysql };
