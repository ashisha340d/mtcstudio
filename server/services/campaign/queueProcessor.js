'use strict';
/**
 * Campaign Queue processor — the background worker that drains campaign_queue
 * and delivers each message through its channel provider. Mirrors the SMS
 * engine's state-machine discipline: every transition writes status + a
 * timestamp immediately, retries are capped, and a live socket update is
 * broadcast so the dashboard reflects progress in real time.
 */
const { dbAll, dbGet, dbRun } = require('../../database/db');
const channels = require('./channels');
const socketServer = require('../../pos/socketServer');

const TICK_MS = Number(process.env.CAMPAIGN_ENGINE_TICK_MS) || 5000;
const BATCH   = Number(process.env.CAMPAIGN_ENGINE_BATCH) || 25;

let timer = null;

async function broadcast(id) {
    const row = await dbGet(`SELECT * FROM campaign_queue WHERE id=?`, [id]);
    if (row) { try { socketServer.emitCampaignUpdate(row); } catch { /* optional */ } }
    return row;
}

// Rows eligible to send: approved into 'queued', schedule reached (or none).
async function dueRows() {
    return dbAll(
        `SELECT * FROM campaign_queue
         WHERE status='queued' AND (scheduled_at IS NULL OR scheduled_at <= NOW())
         ORDER BY priority ASC, id ASC LIMIT ?`, [BATCH]);
}

async function deliver(row) {
    const map = await channels.channelMap();
    const chan = map[row.channel];
    if (!chan || !chan.provider) return fail(row, `no provider for ${row.channel}`);
    if (!chan.is_enabled) return fail(row, `${row.channel} disabled`);

    await dbRun(`UPDATE campaign_queue SET status='sending' WHERE id=? AND status='queued'`, [row.id]);
    await broadcast(row.id);

    let payload = {};
    try { payload = row.payload ? (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) : {}; } catch { /* */ }
    payload.config = chan.config;

    let result;
    try {
        result = await chan.provider.send({
            jobId: row.id, recipient: row.recipient, subject: row.subject, message: row.message, payload,
        });
    } catch (e) {
        result = { ok: false, reason: e.message };
    }

    if (result.ok) {
        await dbRun(
            `UPDATE campaign_queue SET status='sent', sent_at=CURRENT_TIMESTAMP, provider_ref=?, external_job_id=?, error_message=NULL WHERE id=?`,
            [result.ref || null, result.externalJobId || null, row.id]);
        await bumpRun(row.run_id, 'sent');
        await broadcast(row.id);
        return;
    }
    return fail(row, result.reason || 'send failed');
}

async function fail(row, reason) {
    const willRetry = (row.retry_count + 1) <= row.max_retries;
    if (willRetry) {
        await dbRun(
            `UPDATE campaign_queue SET status='queued', retry_count=retry_count+1, error_message=?, failed_at=CURRENT_TIMESTAMP WHERE id=?`,
            [String(reason).slice(0, 500), row.id]);
    } else {
        await dbRun(
            `UPDATE campaign_queue SET status='failed', error_message=?, failed_at=CURRENT_TIMESTAMP WHERE id=?`,
            [String(reason).slice(0, 500), row.id]);
        await bumpRun(row.run_id, 'failed');
    }
    await broadcast(row.id);
}

async function bumpRun(runId, kind) {
    if (!runId) return;
    const col = kind === 'sent' ? 'sent_count' : 'failed_count';
    await dbRun(`UPDATE campaign_runs SET ${col}=${col}+1 WHERE id=?`, [runId]);
    // Mark a run complete once nothing is left pending in its queue.
    const left = await dbGet(
        `SELECT COUNT(*) AS n FROM campaign_queue WHERE run_id=? AND status IN ('queued','sending','scheduled','pending_approval','paused')`,
        [runId]);
    if (left && Number(left.n) === 0) {
        await dbRun(`UPDATE campaign_runs SET status='completed', finished_at=CURRENT_TIMESTAMP WHERE id=? AND status NOT IN ('cancelled','completed')`, [runId]);
    }
}

async function tick() {
    const rows = await dueRows();
    for (const row of rows) await deliver(row);
}

// ── Queue control operations (used by the routes) ────────────────
async function approve(ids) {
    await bulkSet(ids, `status='queued'`, `status='pending_approval'`);
}
async function reject(ids) {
    await bulkSet(ids, `status='rejected'`, `status='pending_approval'`);
}
async function pause(ids) {
    await bulkSet(ids, `status='paused'`, `status IN ('queued','scheduled')`);
}
async function resume(ids) {
    await bulkSet(ids, `status='queued'`, `status='paused'`);
}
async function cancel(ids) {
    await bulkSet(ids, `status='cancelled'`, `status IN ('preview','pending_approval','queued','scheduled','paused')`);
}
async function retry(ids) {
    await bulkSet(ids, `status='queued', retry_count=0, error_message=NULL`, `status='failed'`);
}

// Permanent removal — any status. Used by the Queue tab's bulk hard-delete;
// unlike the status transitions above, this does not go through bulkSet
// (no whereStatus gate) and is not reversible.
async function hardDelete(ids) {
    const list = (Array.isArray(ids) ? ids : [ids]).map(Number).filter(Boolean);
    if (!list.length) return { changed: 0 };
    const ph = list.map(() => '?').join(',');
    const res = await dbRun(`DELETE FROM campaign_queue WHERE id IN (${ph})`, list);
    return { changed: res.changes };
}

// Edit the rendered message/subject before it goes out. Blocked only while a
// row is actively being handed to the provider ('sending') to avoid a race
// with deliver() reading a half-updated row.
async function updateMessage(id, { subject, message }) {
    const res = await dbRun(
        `UPDATE campaign_queue SET subject=?, message=? WHERE id=? AND status <> 'sending'`,
        [subject ?? null, message, id]);
    if (res.changes) await broadcast(id);
    return { changed: res.changes };
}

async function bulkSet(ids, setExpr, whereStatus) {
    const list = (Array.isArray(ids) ? ids : [ids]).map(Number).filter(Boolean);
    if (!list.length) return { changed: 0 };
    const ph = list.map(() => '?').join(',');
    const res = await dbRun(
        `UPDATE campaign_queue SET ${setExpr} WHERE id IN (${ph}) AND ${whereStatus}`, list);
    for (const id of list) broadcast(id).catch(() => {});
    return { changed: res.changes };
}

// Approve/reject an entire run's queued messages at once.
async function approveRun(runId) {
    await dbRun(`UPDATE campaign_queue SET status='queued' WHERE run_id=? AND status='pending_approval'`, [runId]);
    await dbRun(`UPDATE campaign_runs SET status='processing' WHERE id=?`, [runId]);
}
async function rejectRun(runId) {
    await dbRun(`UPDATE campaign_queue SET status='rejected' WHERE run_id=? AND status='pending_approval'`, [runId]);
    await dbRun(`UPDATE campaign_runs SET status='rejected', finished_at=CURRENT_TIMESTAMP WHERE id=?`, [runId]);
}

function start() {
    if (timer) return;
    timer = setInterval(() => tick().catch(e => console.error('[campaign-queue]', e.message)), TICK_MS);
    timer.unref();
}

module.exports = {
    start, tick, deliver,
    approve, reject, pause, resume, cancel, retry, hardDelete, updateMessage,
    approveRun, rejectRun, bulkSet,
};
