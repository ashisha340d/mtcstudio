const fs   = require('fs');
const path = require('path');
const { dbAll, dbRun } = require('../database/db');
const { uploadsDir }   = require('../middleware/upload');

const SYNC_URL = `${process.env.PUBLIC_SITE_URL}/api/syncimages.php`;
const API_KEY  = 'MTC_LIVE_SHELF_2026_X7K9P2Q8';

/**
 * Build a multipart/form-data body manually using Buffers.
 * Node.js built-in FormData+Blob does not produce $_FILES-compatible
 * multipart bodies for PHP, so we construct the raw bytes ourselves.
 */
function buildMultipart(fields, file) {
    const boundary = '----MTC' + Date.now().toString(16) + Math.random().toString(16).slice(2);
    const CRLF = '\r\n';
    const parts = [];

    // Text fields
    for (const [name, value] of Object.entries(fields)) {
        parts.push(Buffer.from(
            `--${boundary}${CRLF}` +
            `Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}` +
            `${value}${CRLF}`
        ));
    }

    // File part
    parts.push(Buffer.from(
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="file"; filename="${file.filename}"${CRLF}` +
        `Content-Type: ${file.mimeType}${CRLF}${CRLF}`
    ));
    parts.push(file.buffer);
    parts.push(Buffer.from(CRLF));

    // Closing boundary
    parts.push(Buffer.from(`--${boundary}--${CRLF}`));

    return {
        body:        Buffer.concat(parts),
        contentType: `multipart/form-data; boundary=${boundary}`,
    };
}

async function deleteRemote(filename) {
    const boundary = '----MTC' + Date.now().toString(16) + Math.random().toString(16).slice(2);
    const CRLF = '\r\n';
    const body = Buffer.from(
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="api_key"${CRLF}${CRLF}${API_KEY}${CRLF}` +
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="action"${CRLF}${CRLF}delete${CRLF}` +
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="filename"${CRLF}${CRLF}${filename}${CRLF}` +
        `--${boundary}--${CRLF}`
    );

    try {
        const res = await fetch(SYNC_URL, {
            method: 'POST',
            headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
            body,
        });
        const text = await res.text().catch(() => '');
        const json = JSON.parse(text);
        if (!res.ok || json.success !== true) {
            console.warn(`[Media Sync] Remote delete failed for ${filename}:`, text);
            return false;
        }
        return true;
    } catch (err) {
        console.warn(`[Media Sync] Remote delete error for ${filename}:`, err.message);
        return false;
    }
}

async function uploadOne(row) {
    const filePath = path.join(uploadsDir, row.filename);

    if (!fs.existsSync(filePath)) {
        console.warn(`[Media Sync] Missing local file, deleting from remote + DB: ${row.filename}`);
        return 'missing';
    }

    const fileBuffer = fs.readFileSync(filePath);
    const mimeType   = row.file_type || 'image/jpeg';

    const { body, contentType } = buildMultipart(
        { api_key: API_KEY, original_name: row.filename },
        { filename: row.filename, mimeType, buffer: fileBuffer }
    );

    const res = await fetch(SYNC_URL, {
        method:  'POST',
        headers: { 'Content-Type': contentType },
        body,
    });

    const text = await res.text().catch(() => '');

    if (!res.ok) {
        console.error(`[Media Sync] HTTP ${res.status} for ${row.filename}: ${text}`);
        return 'failed';
    }

    let json;
    try { json = JSON.parse(text); } catch {
        console.error(`[Media Sync] Non-JSON response for ${row.filename}:`, text);
        return 'failed';
    }

    if (!json || json.success !== true) {
        console.error(`[Media Sync] API error for ${row.filename}:`, json);
        return 'failed';
    }

    return json.skipped ? 'skipped' : 'synced';
}

async function syncMedia() {
    // --- Phase 1: upload unsynced files ---
    const rows = await dbAll(
        `SELECT id, filename, file_type FROM media_library WHERE sync_status = 0 ORDER BY created_at ASC`,
        []
    );

    let synced = 0, skipped = 0, failed = 0, deleted = 0;
    const doneIds    = [];
    const deleteIds  = [];

    for (const row of rows) {
        try {
            const result = await uploadOne(row);
            if (result === 'synced')  { synced++;  doneIds.push(row.id); }
            if (result === 'skipped') { skipped++; doneIds.push(row.id); }
            if (result === 'missing') { deleteIds.push(row); }
            if (result === 'failed')  { failed++; }
        } catch (err) {
            console.error(`[Media Sync] Unexpected error for ${row.filename}:`, err.message);
            failed++;
        }
    }

    if (doneIds.length > 0) {
        const ph = doneIds.map(() => '?').join(',');
        await dbRun(`UPDATE media_library SET sync_status = 1 WHERE id IN (${ph})`, doneIds);
    }

    // --- Phase 2: clean up already-synced files whose local copy is also gone ---
    const syncedRows = await dbAll(
        `SELECT id, filename FROM media_library WHERE sync_status = 1`,
        []
    );
    for (const row of syncedRows) {
        const filePath = path.join(uploadsDir, row.filename);
        if (!fs.existsSync(filePath)) {
            console.warn(`[Media Sync] Orphan (synced but local gone): ${row.filename}`);
            deleteIds.push(row);
        }
    }

    // --- Phase 3: delete missing files from remote + DB ---
    for (const row of deleteIds) {
        await deleteRemote(row.filename);
        await dbRun(`DELETE FROM media_library WHERE id = ?`, [row.id]);
        deleted++;
        console.log(`[Media Sync] Deleted from remote + DB: ${row.filename}`);
    }

    console.log(`[Media Sync] uploaded:${synced} existed:${skipped} failed:${failed} deleted:${deleted}`);
    return { synced, skipped, failed, deleted, total: rows.length };
}

module.exports = { syncMedia };
