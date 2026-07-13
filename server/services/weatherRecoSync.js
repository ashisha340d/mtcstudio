'use strict';
// Pushes weather recommendations + popup settings to the website's Node sync endpoint.
// Reuses the automation sync config (same website URL + shared secret):
//   AUTOMATION_SYNC_URL     base URL of the website (e.g. http://localhost:3300)
//   AUTOMATION_SYNC_SECRET  shared secret, must match website's AUTOMATION_SYNC_SECRET
const { dbAll, dbGet } = require('../database/db');

const SYNC_URL = process.env.AUTOMATION_SYNC_URL;
const TOKEN = process.env.AUTOMATION_SYNC_SECRET || 'mtc-automation-sync-2026';

async function pushWeatherReco() {
    if (!SYNC_URL) throw new Error('AUTOMATION_SYNC_URL is not configured');

    const rows = await dbAll(
        `SELECT bucket, product_id, sort_order FROM weather_recommendations ORDER BY bucket, sort_order, id`);
    const s = await dbGet(`SELECT enabled, modal_seconds, max_per_session FROM weather_reco_settings WHERE id=1`)
        || { enabled: 1, modal_seconds: 8, max_per_session: 1 };

    const res = await fetch(`${SYNC_URL.replace(/\/$/, '')}/api/weather-reco/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            api_key: TOKEN,
            rows,
            settings: {
                enabled: !!s.enabled,
                modalSeconds: s.modal_seconds,
                maxPerSession: s.max_per_session,
            },
        }),
    });
    if (!res.ok) throw new Error(`website weather sync failed: ${res.status} ${await res.text()}`);
    return res.json();
}

module.exports = { pushWeatherReco };
