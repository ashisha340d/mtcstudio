'use strict';
// Pushes compiled published rules for a scope to the website's Node sync endpoint.
// Config (server/.env.<APP_ENV>):
//   AUTOMATION_SYNC_ENABLED  default true
//   AUTOMATION_SYNC_URL      base URL of the website (e.g. http://localhost:3300)
//   AUTOMATION_SYNC_SECRET   shared secret, must match website's AUTOMATION_SYNC_SECRET
const { dbAll, dbGet } = require('../database/db');

const ENABLED = String(process.env.AUTOMATION_SYNC_ENABLED ?? 'true').toLowerCase() !== 'false';
const SYNC_URL = process.env.AUTOMATION_SYNC_URL;
const TOKEN = process.env.AUTOMATION_SYNC_SECRET || 'mtc-automation-sync-2026';

// force=true (manual "Sync Now" trigger) bypasses AUTOMATION_SYNC_ENABLED but still needs SYNC_URL configured.
// ruleIds, if given, restricts the push to those published rules — website still full-replaces
// the whole scope, so rules left out are removed from the website cache (explicit overwrite).
async function pushCompiledRules(scope, { ruleIds = null, force = false } = {}) {
    if (!force && !ENABLED) return;
    if (!SYNC_URL) { if (force) throw new Error('AUTOMATION_SYNC_URL is not configured'); return; }
    const idFilter = ruleIds && ruleIds.length ? `AND id IN (${ruleIds.map(() => '?').join(',')})` : '';
    const rows = await dbAll(
        `SELECT id, name, priority, trigger_type, conditions, actions, schedule, frequency_cap, stop_processing
         FROM automation_rules WHERE scope=? AND status='published' ${idFilter} ORDER BY priority DESC`,
        ruleIds && ruleIds.length ? [scope, ...ruleIds] : [scope]
    );
    const settings = await dbGet(`SELECT global_session_cap, conflict_strategy, stop_overrides_cap FROM automation_settings WHERE scope=?`, [scope]);
    const rules = rows.map(r => ({
        ...r,
        conditions: r.conditions ? JSON.parse(r.conditions) : null,
        actions: r.actions ? JSON.parse(r.actions) : [],
        schedule: r.schedule ? JSON.parse(r.schedule) : {},
        frequency_cap: r.frequency_cap ? JSON.parse(r.frequency_cap) : {},
    }));

    const res = await fetch(`${SYNC_URL.replace(/\/$/, '')}/api/automation/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: TOKEN, scope, settings, rules }),
    });
    if (!res.ok) throw new Error(`website sync failed: ${res.status} ${await res.text()}`);
    return res.json();
}

module.exports = { pushCompiledRules };
