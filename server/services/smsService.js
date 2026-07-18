'use strict';
// Centralized SMS Service — the single SMS engine for every MTC Studio module.
// Modules only ever call enqueue()/enqueueTemplate(). This module owns the queue,
// background dispatch, Android communication (via smsGateway), retries, delivery
// tracking, logging, and real-time status broadcasts. The DB (sms_queue) is the
// source of truth; every state transition writes a row + a timestamp immediately.
const { dbAll, dbGet, dbRun } = require('../pos/db');
const gateway = require('./smsGateway');
const socketServer = require('../pos/socketServer');
const templates = require('./smsTemplates');

const TICK_MS = Number(process.env.SMS_ENGINE_TICK_MS) || 4000;
const DEFAULT_MAX_RETRIES = Number(process.env.SMS_MAX_RETRIES) || 3;
const BATCH = Number(process.env.SMS_ENGINE_BATCH) || 10;

const inFlight = new Set();   // jobIds handed to a device, awaiting a status frame
let timer = null;

const TYPE_MAP = { sms_queued: 'QUEUED', sms_sending: 'SENDING', sms_sent: 'SENT', sms_delivered: 'DELIVERED', sms_failed: 'FAILED' };
const TS_COL   = { QUEUED: 'queued_at', SENDING: 'sending_at', SENT: 'sent_at', DELIVERED: 'delivered_at', FAILED: 'failed_at' };
const TERMINAL = new Set(['DELIVERED', 'CANCELLED']);

const normalizePhone = (p) => String(p || '').replace(/[\s\-]/g, '');

async function log(jobId, event, deviceId, detail) {
  try {
    await dbRun(`INSERT INTO sms_logs (job_id, event, device_id, detail) VALUES (?,?,?,?)`,
      [jobId || null, event, deviceId || null, detail ? String(detail).slice(0, 500) : null]);
  } catch { /* logging must never break the pipeline */ }
}

async function broadcast(jobId) {
  const row = await dbGet(`SELECT * FROM sms_queue WHERE id=?`, [jobId]);
  if (row) socketServer.emitSmsUpdate(row);   // live push to every POS/Studio client
  return row;
}

// ── Public: the single entry point every module uses ─────────────
async function enqueue({ phone, message, customerId = null, orderId = null, priority = 5, templateId = null, createdBy = null, maxRetries = DEFAULT_MAX_RETRIES }) {
  const ph = normalizePhone(phone);
  if (!ph) throw new Error('phone required');
  if (!message || !String(message).trim()) throw new Error('message required');

  const res = await dbRun(
    `INSERT INTO sms_queue (phone, message, customer_id, order_id, template_id, priority, status, max_retries, created_by)
     VALUES (?,?,?,?,?,?, 'PENDING', ?,?)`,
    [ph, String(message), customerId, orderId, templateId, Number(priority) || 5, Number(maxRetries) || DEFAULT_MAX_RETRIES, createdBy]
  );
  const jobId = res.insertId;
  await log(jobId, 'QUEUE_CREATED', null, `to=${ph} template=${templateId || '-'}`);
  await broadcast(jobId);

  // Immediate dispatch if a device is online; otherwise the engine picks it up.
  if (gateway.anyOnline()) setImmediate(() => tryDispatch(jobId).catch(() => { }));
  return jobId;
}

// Convenience wrapper so modules stay declarative — renders text from smsTemplates.
async function enqueueTemplate(templateId, data = {}) {
  const fn = templates[templateId];
  if (!fn) throw new Error(`unknown SMS template: ${templateId}`);
  return enqueue({ ...data, templateId, message: fn(data) });
}

// ── Dispatch ─────────────────────────────────────────────────────
async function tryDispatch(jobId) {
  if (inFlight.has(jobId)) return;
  const job = await dbGet(`SELECT * FROM sms_queue WHERE id=?`, [jobId]);
  if (!job || job.status !== 'PENDING') return;

  const deviceId = gateway.pickDevice();
  if (!deviceId) return;                  // no device — leave PENDING for reconnect

  inFlight.add(jobId);
  const ok = gateway.send(deviceId, { type: 'send_sms', jobId, phone: job.phone, message: job.message });
  if (!ok) { inFlight.delete(jobId); return; }

  await dbRun(`UPDATE sms_queue SET status='QUEUED', device_id=?, queued_at=CURRENT_TIMESTAMP WHERE id=? AND status='PENDING'`, [deviceId, jobId]);
  await log(jobId, 'DISPATCH_STARTED', deviceId, `device used: ${deviceId}`);
  await broadcast(jobId);
}

async function processPending() {
  if (!gateway.anyOnline()) return;
  const rows = await dbAll(`SELECT id FROM sms_queue WHERE status='PENDING' ORDER BY priority ASC, created_at ASC LIMIT ?`, [BATCH]);
  for (const r of rows) {
    if (!gateway.anyOnline()) break;
    await tryDispatch(r.id);
  }
}

// ── Device status frames from Android ────────────────────────────
async function handleStatus({ type, jobId, error, deviceId }) {
  const status = TYPE_MAP[type];
  if (!status || !jobId) return;
  const job = await dbGet(`SELECT * FROM sms_queue WHERE id=?`, [jobId]);
  if (!job || TERMINAL.has(job.status)) return;   // never override a terminal state

  if (status === 'FAILED') {
    inFlight.delete(jobId);
    const willRetry = (job.retry_count + 1) <= job.max_retries;   // configurable cap
    if (willRetry) {
      await dbRun(`UPDATE sms_queue SET status='PENDING', retry_count=retry_count+1, device_id=NULL, error_message=?, failed_at=CURRENT_TIMESTAMP WHERE id=?`, [error || 'failed', jobId]);
      await log(jobId, 'SMS_FAILED', deviceId, error);
      await log(jobId, 'RETRY', deviceId, `attempt ${job.retry_count + 1}/${job.max_retries}`);
    } else {
      await dbRun(`UPDATE sms_queue SET status='FAILED', error_message=?, failed_at=CURRENT_TIMESTAMP WHERE id=?`, [error || 'failed', jobId]);
      await log(jobId, 'SMS_FAILED', deviceId, `final: ${error || ''}`);
    }
    await broadcast(jobId);
    return;
  }

  const col = TS_COL[status];
  await dbRun(`UPDATE sms_queue SET status=?, ${col}=CURRENT_TIMESTAMP, device_id=COALESCE(?, device_id) WHERE id=?`, [status, deviceId || null, jobId]);
  if (status === 'SENT' || status === 'DELIVERED') inFlight.delete(jobId);
  const evt = status === 'SENT' ? 'SMS_SENT' : status === 'DELIVERED' ? 'SMS_DELIVERED' : `STATUS_${status}`;
  await log(jobId, evt, deviceId, null);
  await broadcast(jobId);
}

// ── Cancellation ─────────────────────────────────────────────────
async function cancel(jobId) {
  const job = await dbGet(`SELECT * FROM sms_queue WHERE id=?`, [jobId]);
  if (!job) return { ok: false, reason: 'not found' };
  if (job.status === 'SENDING') return { ok: false, reason: 'already sending' };
  if (!['PENDING', 'QUEUED'].includes(job.status)) return { ok: false, reason: `cannot cancel ${job.status}` };

  await dbRun(`UPDATE sms_queue SET status='CANCELLED' WHERE id=? AND status IN ('PENDING','QUEUED')`, [jobId]);
  inFlight.delete(jobId);
  if (job.device_id && gateway.supportsCancel(job.device_id)) gateway.send(job.device_id, { type: 'cancel_sms', jobId });
  await log(jobId, 'DISPATCH_CANCELLED', job.device_id, null);
  await broadcast(jobId);
  return { ok: true };
}

// Manual retry of a job that already exhausted automatic retries.
async function retry(jobId) {
  const job = await dbGet(`SELECT * FROM sms_queue WHERE id=?`, [jobId]);
  if (!job || job.status !== 'FAILED') return { ok: false, reason: 'only FAILED jobs can be retried' };
  await dbRun(`UPDATE sms_queue SET status='PENDING', device_id=NULL WHERE id=?`, [jobId]);
  await log(jobId, 'RETRY', null, 'manual');
  await broadcast(jobId);
  if (gateway.anyOnline()) setImmediate(() => tryDispatch(jobId).catch(() => { }));
  return { ok: true };
}

// Device dropped mid-flight — return its unfinished jobs to PENDING for another device.
async function requeueDeviceJobs(deviceId) {
  const rows = await dbAll(`SELECT id FROM sms_queue WHERE device_id=? AND status IN ('QUEUED','SENDING')`, [deviceId]);
  if (!rows.length) return;
  await dbRun(`UPDATE sms_queue SET status='PENDING', device_id=NULL WHERE device_id=? AND status IN ('QUEUED','SENDING')`, [deviceId]);
  for (const r of rows) {
    inFlight.delete(r.id);
    await log(r.id, 'RECONNECT', deviceId, 'device disconnected — job returned to PENDING');
    await broadcast(r.id);
  }
}

function start() {
  gateway.onStatus(handleStatus);
  gateway.onConnect((deviceId) => { log(null, 'RECONNECT', deviceId, 'device online'); processPending().catch(() => { }); });
  gateway.onDisconnect((deviceId) => { requeueDeviceJobs(deviceId).catch(() => { }); });
  if (timer) return;
  timer = setInterval(() => processPending().catch(() => { }), TICK_MS);
  timer.unref();
}

module.exports = { enqueue, enqueueTemplate, cancel, retry, start };
