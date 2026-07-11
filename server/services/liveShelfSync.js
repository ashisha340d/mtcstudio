const { dbAll, dbRun } = require('../database/db');
const scheduleSvc = require('./liveStoreScheduleService');
const { getNepalDayBoundsUTC } = require('../utils/nepalDateTime');

const SYNC_API_URL     = `${process.env.PUBLIC_SITE_URL}/api/sync/products`;
const SCHEDULE_API_URL = `${process.env.PUBLIC_SITE_URL}/api/sync/schedule`;
const API_KEY          = 'MTC_LIVE_SHELF_2026_X7K9P2Q8';

let _syncing     = false;
let _stockTimer  = null;   // debounce handle for POS stock sync

/**
 * Called by POS routes (KOT punch / order cancel) after stock changes.
 * Debounces 400 ms so a multi-item KOT batches into one network call.
 * Sends only { id, quantity } pairs — does NOT overwrite name/price/image.
 */
function triggerStockSync() {
    if (_stockTimer) clearTimeout(_stockTimer);
    _stockTimer = setTimeout(_syncStockOnly, 400);
}

async function _syncStockOnly() {
    _stockTimer = null;
    try {
        const { start, end } = getNepalDayBoundsUTC();

        const rows = await dbAll(
            `SELECT v.id,
                    GREATEST(0, v.stock - COALESCE((
                      SELECT SUM(ki.quantity)
                      FROM   pos_kot_items ki
                      JOIN   pos_kots k ON k.id = ki.kot_id
                      JOIN   pos_orders o ON o.id = k.order_id
                      WHERE  ki.variant_id = v.id
                        AND  ki.status  != 'CANCELLED'
                        AND  k.status   != 'CANCELLED'
                        AND  o.status   != 'SAVED'
                        AND  k.created_at >= ?
                        AND  k.created_at <  ?
                    ), 0)) AS quantity
             FROM   product_variants v
             JOIN   products p ON p.id = v.product_id
             WHERE  v.show_online = 1
               AND  v.sync_status = 0
               AND  v.status      = 'active'
               AND  p.status      = 'active'`,
            [start, end]
        );

        if (rows.length === 0) return;

        const data = rows.map(r => ({ id: r.id, quantity: r.quantity }));

        const response = await fetch(SYNC_API_URL, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ api_key: API_KEY, mode: 'qty_only', data }),
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            console.error(`[Storefront Sync] Stock sync failed ${response.status}: ${text}`);
            return;
        }

        const json = await response.json().catch(() => null);
        if (!json || json.success !== true) {
            console.error('[Storefront Sync] Stock sync bad response:', json);
            return;
        }

        const ids = rows.map(r => r.id);
        const ph  = ids.map(() => '?').join(',');
        await dbRun(`UPDATE product_variants SET sync_status = 1 WHERE id IN (${ph})`, ids);

        console.log(`[Storefront Sync] Stock-only: updated qty for ${rows.length} variant(s)`);
    } catch (err) {
        console.error('[Storefront Sync] Stock sync error:', err.message);
    }
}

/**
 * Full-replace sync: fetches ALL active online variants from local DB,
 * sends them to the remote with mode='full_replace' so the remote deletes
 * any item not in the list, then marks every sent variant sync_status=1.
 */
async function syncLiveShelf() {
    if (_syncing) {
        console.log('[Storefront Sync] Skipped — previous sync still running');
        return { skipped: true, synced: 0 };
    }

    _syncing = true;
    try {
        const { start, end } = getNepalDayBoundsUTC();

        // Fetch ALL online items — quantity = stock minus today's KOT sold (available for online)
        const rows = await dbAll(
            `SELECT
               v.id,
               GREATEST(0, v.stock - COALESCE((
                 SELECT SUM(ki.quantity)
                 FROM   pos_kot_items ki
                 JOIN   pos_kots k ON k.id = ki.kot_id
                 JOIN   pos_orders o ON o.id = k.order_id
                 WHERE  ki.variant_id = v.id
                   AND  ki.status  != 'CANCELLED'
                   AND  k.status   != 'CANCELLED'
                   AND  o.status   != 'SAVED'
                   AND  k.created_at >= ?
                   AND  k.created_at <  ?
               ), 0))    AS quantity,
               v.selling_price  AS price,
               v.name           AS variant_name,
               v.sort_order,
               p.name           AS product_name,
               p.storefront_category AS category,
               p.short_description   AS notes,
               COALESCE(
                 (SELECT ml.filename FROM media_library ml WHERE ml.id = v.image_id LIMIT 1),
                 (SELECT ml.filename FROM product_images pi JOIN media_library ml ON ml.id = pi.media_id WHERE pi.product_id = p.id AND pi.is_primary = 1 LIMIT 1)
               ) AS image
             FROM   product_variants v
             JOIN   products p ON p.id = v.product_id
             WHERE  v.show_online = 1
               AND  v.status      = 'active'
               AND  p.status      = 'active'
             ORDER BY p.storefront_category, p.sort_order, v.sort_order`,
            [start, end]
        );

        const data = rows.map(r => ({
            id:          r.id,
            category:    r.category   || '',
            name:        r.product_name + (r.variant_name && r.variant_name !== 'Regular' ? ` – ${r.variant_name}` : ''),
            price:       r.price      ?? 0,
            quantity:    r.quantity   ?? 0,
            image:       r.image      || '',
            notes:       r.notes      || '',
            sort_order:  r.sort_order ?? 0,
            show_online: 1,
        }));

        // mode=full_replace tells the remote endpoint to delete any row whose id
        // is not present in this payload before upserting what's here.
        const response = await fetch(SYNC_API_URL, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ api_key: API_KEY, mode: 'full_replace', data }),
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Remote API returned ${response.status}: ${text}`);
        }

        const json = await response.json().catch(() => null);
        if (!json || json.success !== true) {
            throw new Error(`Remote API unexpected response: ${JSON.stringify(json)}`);
        }

        // Mark all online variants as synced
        if (rows.length > 0) {
            const ids          = rows.map(r => r.id);
            const placeholders = ids.map(() => '?').join(',');
            await dbRun(
                `UPDATE product_variants SET sync_status = 1 WHERE id IN (${placeholders})`,
                ids
            );
        }

        // Also clear sync_status on any variant that is now offline (show_online=0),
        // so if it comes back online later it will be treated as pending.
        await dbRun(
            `UPDATE product_variants SET sync_status = 0 WHERE show_online = 0 AND sync_status = 1`,
            []
        );

        console.log(`[Storefront Sync] Full-replace: sent ${data.length} item(s) to remote`);
        return { synced: data.length, deleted_remote: json.deleted ?? 0 };

    } catch (err) {
        console.error('[Storefront Sync] Error:', err.message);
        throw err;
    } finally {
        _syncing = false;
    }
}

async function syncSchedule() {
    const days = await scheduleSvc.getUnsyncedSchedule();
    if (days.length === 0) return { synced: 0 };

    const response = await fetch(SCHEDULE_API_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ api_key: API_KEY, data: days }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Schedule API returned ${response.status}: ${text}`);
    }

    const json = await response.json().catch(() => null);
    if (!json || json.success !== true) {
        throw new Error(`Schedule API unexpected response: ${JSON.stringify(json)}`);
    }

    await scheduleSvc.markScheduleSynced(days.map(d => d.day_of_week));
    console.log(`[Storefront Sync] Schedule synced ${days.length} days`);
    return { synced: days.length };
}

function startAutoSync() {
    // On startup, flush any variants left dirty from a previous session
    dbAll(`SELECT id FROM product_variants WHERE sync_status = 0 AND show_online = 1`, [])
        .then(rows => {
            if (rows.length > 0) {
                console.log(`[Storefront Sync] ${rows.length} dirty variant(s) from last session — flushing stock`);
                triggerStockSync();
            }
        })
        .catch(() => {});
}

module.exports = { syncLiveShelf, syncSchedule, startAutoSync, triggerStockSync };
