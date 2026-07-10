const { dbAll } = require('../database/db');
const { syncMedia } = require('./mediaSyncService');

const SYNC_URL = `${process.env.PUBLIC_SITE_URL}/api/synccakes.php`;
const API_KEY = 'MTC_LIVE_SHELF_2026_X7K9P2Q8';

// Full v3 cake catalogue — replicated wholesale to the webserver's MariaDB,
// where the website reads the same table shapes directly.
const TABLES = [
    'cake_designs', 'cake_design_media', 'cake_design_sizes', 'cake_design_flavours',
    'cake_design_creams', 'cake_collections', 'cake_collection_items',
    'cake_catalogue', 'lookup_master',
];

async function syncCakeCatalog() {
    const payload = {};
    await Promise.all(TABLES.map(async (t) => {
        payload[t] = await dbAll(`SELECT * FROM ${t}`);
    }));

    const formBody = new URLSearchParams({ api_key: API_KEY });
    for (const table of TABLES) {
        formBody.set(table, JSON.stringify(payload[table]));
    }

    const response = await fetch(SYNC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formBody.toString(),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Remote API returned ${response.status}: ${text}`);
    }

    const json = await response.json().catch(() => null);
    if (!json || json.success !== true) {
        throw new Error(`Remote API unexpected response: ${JSON.stringify(json)}`);
    }

    const counts = {};
    for (const table of TABLES) counts[table] = json[table] ?? 0;
    return counts;
}

// Debounced fire-and-forget push, called after every cake CMS mutation so the
// website follows each save without blocking (or failing) the CRUD response.
// Media is synced first so freshly picked /uploads images exist remotely.
let timer = null;
function queueCakeSync(delayMs = 2000) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
        try {
            await syncMedia().catch(e => console.warn('[Cake Sync] media sync failed:', e.message));
            const counts = await syncCakeCatalog();
            console.log('[Cake Sync] pushed to webserver:', JSON.stringify(counts));
        } catch (e) {
            console.error('[Cake Sync] failed:', e.message);
        }
    }, delayMs);
}

module.exports = { syncCakeCatalog, queueCakeSync };
