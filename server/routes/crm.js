const express = require('express');
const router  = express.Router();
const { dbAll, dbGet, dbRun, transaction } = require('../database/db');
const { searchCustomers, searchCustomersPaged, HIGH_CONFIDENCE } = require('../services/customerSearch');

// Tables carrying an identity link to a customer's phone — cascaded when the
// primary phone number is corrected so order/loyalty/campaign history stays
// attached to the same customer instead of orphaning under the old number.
// Historical delivery logs (sms_queue) are deliberately left alone — they
// record what number a message actually went to at the time.
const PHONE_LINKED_TABLES = [
    ['pos_orders', 'customer_phone'],
    ['pos_ledger', 'customer_phone'],
    ['pos_cash_movements', 'customer_phone'],
    ['pos_scheduled_orders', 'customer_phone'],
    ['web_orders_pending', 'customer_phone'],
    ['campaign_coupon_codes', 'customer_phone'],
    ['campaign_coupon_redemptions', 'customer_phone'],
    ['campaign_queue', 'customer_phone'],
    ['campaign_events', 'customer_phone'],
    ['campaign_conversions', 'customer_phone'],
];

// Accepts an optional leading "+<country code>" then digits; strips spacing.
function normalizeInputPhone(raw) {
    const s = String(raw || '').trim().replace(/[\s-]/g, '');
    if (!/^\+?\d{7,15}$/.test(s)) return null;
    return s;
}

const SYSTEM_TAG = 'MTC Customers';

// Auto-tag any contact that has real MTC order history as an "MTC Customers"
// — this is what turns a plain contact into a customer. Idempotent; safe to
// call on import/sync or on demand.
async function reconcileMtcTag(tx = { dbGet, dbRun }) {
    const tag = await tx.dbGet('SELECT id FROM crm_tags WHERE name = ?', [SYSTEM_TAG]);
    if (!tag) return 0;
    const r = await tx.dbRun(
        `INSERT IGNORE INTO customer_tags (customer_phone, tag_id)
         SELECT DISTINCT o.customer_phone, ?
         FROM pos_orders o
         JOIN customers c ON c.phone = o.customer_phone
         WHERE o.customer_phone IS NOT NULL AND o.customer_phone <> ''`,
        [tag.id]);
    return r.changes || 0;
}

// Attach a `tags` array (id/name/color) to each customer row in place.
async function attachTags(rows) {
    if (!rows.length) return rows;
    const phones = rows.map(r => r.phone);
    const placeholders = phones.map(() => '?').join(',');
    const tagRows = await dbAll(
        `SELECT ct.customer_phone, t.id, t.name, t.color, t.source
         FROM customer_tags ct JOIN crm_tags t ON t.id = ct.tag_id
         WHERE ct.customer_phone IN (${placeholders})
         ORDER BY t.source='system' DESC, t.name`,
        phones);
    const byPhone = {};
    for (const t of tagRows) (byPhone[t.customer_phone] ||= []).push({ id: t.id, name: t.name, color: t.color, source: t.source });
    for (const r of rows) r.tags = byPhone[r.phone] || [];
    return rows;
}

// True if this phone has any MTC transactional record (order/ledger) — used to
// protect real customers from permanent deletion.
async function hasMtcRecord(phone) {
    const o = await dbGet('SELECT 1 FROM pos_orders WHERE customer_phone = ? LIMIT 1', [phone]);
    if (o) return true;
    const l = await dbGet('SELECT 1 FROM pos_ledger WHERE customer_phone = ? LIMIT 1', [phone]);
    return !!l;
}

// Ranked live search (typeahead) — phone/email auto-detect, fuzzy-ranked text match.
// Registered before /customers/:phone so "search" in the path isn't swallowed as a phone param.
router.get('/customers/search', async (req, res, next) => {
    try {
        const q = String(req.query.q || '').trim();
        const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 20));
        if (!q) return res.json({ rows: [] });
        const rows = await searchCustomers({ q, limit });
        await attachTags(rows);
        res.json({ rows, highConfidence: HIGH_CONFIDENCE });
    } catch (e) { next(e); }
});

// LIST with search + pagination — a non-blank search routes through the same
// ranked engine as the live picker (phone/email auto-detect, fuzzy name match);
// a blank search keeps the plain alphabetical browse query.
router.get('/customers', async (req, res, next) => {
    try {
        const searchTerm = (req.query.search || '').trim();
        const st = req.query.status || 'active';
        const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 25));
        const offset = (page - 1) * limit;

        const rawTag = String(req.query.tag || '');
        const noTag  = rawTag === 'none';                 // "Unlabelled" — customers with no tags
        const tagId  = noTag ? null : (parseInt(rawTag, 10) || null);
        const tier   = (req.query.tier || '').trim();

        if (searchTerm) {
            const result = await searchCustomersPaged({ q: searchTerm, status: st, page, limit });
            // Tag/tier are refine filters applied on top of the ranked search page.
            let rows = result.rows;
            if (tier)  rows = rows.filter(r => r.rewards_tier === tier);
            await attachTags(rows);
            if (tagId) rows = rows.filter(r => (r.tags || []).some(t => t.id === tagId));
            if (noTag) rows = rows.filter(r => !(r.tags || []).length);
            return res.json({ rows, total: result.total, page, limit });
        }

        const q = '%%';
        // Optional tag filter joins customer_tags. Kept as an EXISTS so paging math stays simple.
        const tagClause  = noTag
            ? ' AND NOT EXISTS (SELECT 1 FROM customer_tags ct WHERE ct.customer_phone = customers.phone)'
            : (tagId ? ' AND EXISTS (SELECT 1 FROM customer_tags ct WHERE ct.customer_phone = customers.phone AND ct.tag_id = ?)' : '');
        const tagParam   = tagId ? [tagId] : [];
        const tierClause = tier ? ' AND rewards_tier = ?' : '';
        const tierParam  = tier ? [tier] : [];
        const totalRow = await dbGet(
            `SELECT COUNT(*) as n FROM customers
             WHERE (phone LIKE ? OR name LIKE ? OR email LIKE ? OR phone2 LIKE ? OR address LIKE ?)
               AND (? = 'all' OR status = ?)${tagClause}${tierClause}`,
            [q, q, q, q, q, st, st, ...tagParam, ...tierParam]
        );
        const rows = await dbAll(
            `SELECT * FROM customers
             WHERE (phone LIKE ? OR name LIKE ? OR email LIKE ? OR phone2 LIKE ? OR address LIKE ?)
               AND (? = 'all' OR status = ?)${tagClause}${tierClause}
             ORDER BY name
             LIMIT ? OFFSET ?`,
            [q, q, q, q, q, st, st, ...tagParam, ...tierParam, limit, offset]
        );
        await attachTags(rows);
        res.json({ rows, total: totalRow.n, page, limit });
    } catch (e) { next(e); }
});

// GET single
router.get('/customers/:phone', async (req, res, next) => {
    try {
        const row = await dbGet('SELECT * FROM customers WHERE phone = ?', [req.params.phone]);
        if (!row) return res.status(404).json({ error: 'Not found' });
        await attachTags([row]);
        res.json(row);
    } catch (e) { next(e); }
});

// CREATE
router.post('/customers', async (req, res, next) => {
    try {
        const { phone, phone2, country_code, name, company_name, job_title, address, birthday, anniversary, email, email2, notes } = req.body;
        if (!phone || !name) return res.status(400).json({ error: 'phone and name are required' });
        const exists = await dbGet('SELECT phone FROM customers WHERE phone = ?', [phone]);
        if (exists) return res.status(409).json({ error: 'Phone number already exists' });
        await dbRun(
            `INSERT INTO customers (phone,phone2,country_code,name,company_name,job_title,address,birthday,anniversary,email,email2,notes)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [phone, phone2||null, country_code||null, name, company_name||null, job_title||null, address||null, birthday||null,
             anniversary||null, email||null, email2||null, notes||null]
        );
        res.json({ success: true, phone });
    } catch (e) { next(e); }
});

// UPDATE
router.put('/customers/:phone', async (req, res, next) => {
    try {
        const { phone2, country_code, name, company_name, job_title, address, birthday, anniversary, email, email2, loyalty_points, rewards_tier, notes, status, is_delivery_partner, discount } = req.body;
        if (!name) return res.status(400).json({ error: 'name is required' });
        await dbRun(
            `UPDATE customers SET phone2=?,country_code=?,name=?,company_name=?,job_title=?,address=?,birthday=?,anniversary=?,email=?,email2=?,
             loyalty_points=?,rewards_tier=?,notes=?,status=?,is_delivery_partner=?,discount=?,updated_at=CURRENT_TIMESTAMP
             WHERE phone=?`,
            [phone2||null, country_code||null, name, company_name||null, job_title||null, address||null, birthday||null, anniversary||null, email||null, email2||null,
             loyalty_points||0, rewards_tier||'standard', notes||null, status||'active',
             is_delivery_partner ? 1 : 0, Math.min(100, Math.max(0, Number(discount) || 0)), req.params.phone]
        );
        res.json({ success: true });
    } catch (e) { next(e); }
});

// RENAME PRIMARY PHONE — corrects a mistyped/changed number without losing
// order/loyalty/campaign history. Blocks if the new number is already used
// by another customer (in this table or POS's own customer list), and
// cascades the identity link across every table in PHONE_LINKED_TABLES
// inside one transaction so the change is all-or-nothing.
router.put('/customers/:phone/phone', async (req, res, next) => {
    try {
        const oldPhone = req.params.phone;
        const newPhone = normalizeInputPhone(req.body.new_phone);
        if (!newPhone) return res.status(400).json({ error: 'Enter a valid phone number (7–15 digits, optional leading +country code)' });
        if (newPhone === oldPhone) return res.json({ success: true, phone: oldPhone });

        const dupe = await dbGet('SELECT phone FROM customers WHERE phone = ?', [newPhone]);
        if (dupe) return res.status(409).json({ error: `Phone number ${newPhone} is already used by another customer` });
        const posDupe = await dbGet('SELECT phone FROM pos_customers WHERE phone = ?', [newPhone]);
        if (posDupe) return res.status(409).json({ error: `Phone number ${newPhone} is already used by a POS customer record` });

        await transaction(async (tx) => {
            const res1 = await tx.dbRun('UPDATE customers SET phone=?, updated_at=CURRENT_TIMESTAMP WHERE phone=?', [newPhone, oldPhone]);
            if (!res1.changes) throw Object.assign(new Error('Customer not found'), { status: 404 });
            for (const [table, col] of PHONE_LINKED_TABLES) {
                await tx.dbRun(`UPDATE ${table} SET ${col}=? WHERE ${col}=?`, [newPhone, oldPhone]);
            }
            await tx.dbRun('UPDATE pos_customers SET phone=? WHERE phone=?', [newPhone, oldPhone]);
            await tx.dbRun('UPDATE customer_addresses SET customer_phone=? WHERE customer_phone=?', [newPhone, oldPhone]);
        });
        res.json({ success: true, phone: newPhone });
    } catch (e) {
        if (e.status === 404) return res.status(404).json({ error: e.message });
        next(e);
    }
});

/* ════════════════ ADDRESSES (up to 3 per customer, one default) ════════════════ */
router.get('/customers/:phone/addresses', async (req, res, next) => {
    try {
        const rows = await dbAll(
            `SELECT * FROM customer_addresses WHERE customer_phone=? ORDER BY is_default DESC, id ASC`,
            [req.params.phone]);
        res.json(rows);
    } catch (e) { next(e); }
});

router.post('/customers/:phone/addresses', async (req, res, next) => {
    try {
        const { label, address_line, city, phone, is_default } = req.body;
        if (!address_line) return res.status(400).json({ error: 'address_line is required' });
        if (phone) {
            const p = normalizeInputPhone(phone);
            if (!p) return res.status(400).json({ error: 'Address phone must be 7–15 digits (optional leading +country code)' });
        }
        const countRow = await dbGet('SELECT COUNT(*) AS n FROM customer_addresses WHERE customer_phone=?', [req.params.phone]);
        if (Number(countRow.n) >= 3) return res.status(409).json({ error: 'A customer can have at most 3 addresses' });

        await transaction(async (tx) => {
            const makeDefault = is_default || Number(countRow.n) === 0;   // first address is default automatically
            if (makeDefault) await tx.dbRun('UPDATE customer_addresses SET is_default=0 WHERE customer_phone=?', [req.params.phone]);
            await tx.dbRun(
                `INSERT INTO customer_addresses (customer_phone,label,address_line,city,phone,is_default) VALUES (?,?,?,?,?,?)`,
                [req.params.phone, label || 'Home', address_line, city || null, phone ? normalizeInputPhone(phone) : null, makeDefault ? 1 : 0]);
        });
        res.json({ success: true });
    } catch (e) { next(e); }
});

router.put('/addresses/:id', async (req, res, next) => {
    try {
        const { label, address_line, city, phone } = req.body;
        if (!address_line) return res.status(400).json({ error: 'address_line is required' });
        if (phone) {
            const p = normalizeInputPhone(phone);
            if (!p) return res.status(400).json({ error: 'Address phone must be 7–15 digits (optional leading +country code)' });
        }
        await dbRun(
            `UPDATE customer_addresses SET label=?, address_line=?, city=?, phone=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
            [label || 'Home', address_line, city || null, phone ? normalizeInputPhone(phone) : null, req.params.id]);
        res.json({ success: true });
    } catch (e) { next(e); }
});

router.post('/addresses/:id/default', async (req, res, next) => {
    try {
        const addr = await dbGet('SELECT customer_phone FROM customer_addresses WHERE id=?', [req.params.id]);
        if (!addr) return res.status(404).json({ error: 'Not found' });
        await transaction(async (tx) => {
            await tx.dbRun('UPDATE customer_addresses SET is_default=0 WHERE customer_phone=?', [addr.customer_phone]);
            await tx.dbRun('UPDATE customer_addresses SET is_default=1 WHERE id=?', [req.params.id]);
        });
        res.json({ success: true });
    } catch (e) { next(e); }
});

router.delete('/addresses/:id', async (req, res, next) => {
    try {
        const addr = await dbGet('SELECT customer_phone, is_default FROM customer_addresses WHERE id=?', [req.params.id]);
        if (!addr) return res.status(404).json({ error: 'Not found' });
        await dbRun('DELETE FROM customer_addresses WHERE id=?', [req.params.id]);
        if (addr.is_default) {
            // Promote the oldest remaining address to default so there's always
            // one, if any are left.
            const next = await dbGet('SELECT id FROM customer_addresses WHERE customer_phone=? ORDER BY id ASC LIMIT 1', [addr.customer_phone]);
            if (next) await dbRun('UPDATE customer_addresses SET is_default=1 WHERE id=?', [next.id]);
        }
        res.json({ success: true });
    } catch (e) { next(e); }
});

// DELETE (soft) — move to recycle bin (status='deleted'), reversible.
router.delete('/customers/:phone', async (req, res, next) => {
    try {
        await dbRun(`UPDATE customers SET status='deleted', deleted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE phone=?`, [req.params.phone]);
        res.json({ success: true });
    } catch (e) { next(e); }
});

// BULK status change — mark active/inactive or move to bin for many contacts.
router.post('/customers/bulk-status', async (req, res, next) => {
    try {
        const { phones, status } = req.body;
        const allowed = ['active', 'inactive', 'deleted'];
        if (!Array.isArray(phones) || !phones.length) return res.status(400).json({ error: 'No contacts selected' });
        if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
        const ph = phones.map(() => '?').join(',');
        const delSql = status === 'deleted' ? ', deleted_at=CURRENT_TIMESTAMP' : ', deleted_at=NULL';
        await dbRun(
            `UPDATE customers SET status=?${delSql}, updated_at=CURRENT_TIMESTAMP WHERE phone IN (${ph})`,
            [status, ...phones]);
        res.json({ success: true, updated: phones.length });
    } catch (e) { next(e); }
});

// RESTORE from bin (or reactivate).
router.post('/customers/:phone/restore', async (req, res, next) => {
    try {
        await dbRun(`UPDATE customers SET status='active', deleted_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE phone=?`, [req.params.phone]);
        res.json({ success: true });
    } catch (e) { next(e); }
});

// HARD DELETE (permanent) — blocked when the contact has real MTC order/ledger
// history, since that would orphan transactional records. force=1 overrides
// only when caller explicitly accepts that.
router.delete('/customers/:phone/purge', async (req, res, next) => {
    try {
        const phone = req.params.phone;
        if (req.query.force !== '1' && await hasMtcRecord(phone)) {
            return res.status(409).json({ error: 'This contact has MTC order history and cannot be permanently deleted. Remove from bin or keep it.' });
        }
        await transaction(async (tx) => {
            await tx.dbRun('DELETE FROM customer_tags WHERE customer_phone=?', [phone]);
            await tx.dbRun('DELETE FROM customer_addresses WHERE customer_phone=?', [phone]);
            await tx.dbRun('DELETE FROM customers WHERE phone=?', [phone]);
        });
        res.json({ success: true });
    } catch (e) { next(e); }
});

/* ════════════════ TAGS / LABELS (Google-Contacts style) ════════════════ */
// List all tags with a live member count.
router.get('/tags', async (req, res, next) => {
    try {
        const rows = await dbAll(
            `SELECT t.*, (SELECT COUNT(*) FROM customer_tags ct WHERE ct.tag_id=t.id) AS count
             FROM crm_tags t ORDER BY t.source='system' DESC, t.name`);
        res.json(rows);
    } catch (e) { next(e); }
});

// Create a manual label.
router.post('/tags', async (req, res, next) => {
    try {
        const name = String(req.body.name || '').trim();
        if (!name) return res.status(400).json({ error: 'Tag name is required' });
        const dupe = await dbGet('SELECT id FROM crm_tags WHERE name=?', [name]);
        if (dupe) return res.status(409).json({ error: 'A tag with that name already exists' });
        const r = await dbRun('INSERT INTO crm_tags (name,color,source) VALUES (?,?,?)',
            [name, req.body.color || '#6b7280', 'manual']);
        res.json({ success: true, id: r.lastID ?? r.insertId });
    } catch (e) { next(e); }
});

// Rename / recolor a label. The system tag can be recolored but not renamed.
router.put('/tags/:id', async (req, res, next) => {
    try {
        const tag = await dbGet('SELECT * FROM crm_tags WHERE id=?', [req.params.id]);
        if (!tag) return res.status(404).json({ error: 'Not found' });
        const name = tag.source === 'system' ? tag.name : String(req.body.name || tag.name).trim();
        await dbRun('UPDATE crm_tags SET name=?, color=? WHERE id=?', [name, req.body.color || tag.color, req.params.id]);
        res.json({ success: true });
    } catch (e) { next(e); }
});

// Delete a label (memberships cascade). System tag is protected.
router.delete('/tags/:id', async (req, res, next) => {
    try {
        const tag = await dbGet('SELECT * FROM crm_tags WHERE id=?', [req.params.id]);
        if (!tag) return res.status(404).json({ error: 'Not found' });
        if (tag.source === 'system') return res.status(400).json({ error: 'The system tag cannot be deleted' });
        await transaction(async (tx) => {
            await tx.dbRun('DELETE FROM customer_tags WHERE tag_id=?', [req.params.id]);
            await tx.dbRun('DELETE FROM crm_tags WHERE id=?', [req.params.id]);
        });
        res.json({ success: true });
    } catch (e) { next(e); }
});

// Assign / unassign a tag on a customer. Blocks manual assignment of the
// system tag (it's auto-managed from order history).
router.post('/customers/:phone/tags', async (req, res, next) => {
    try {
        const tagId = parseInt(req.body.tag_id, 10);
        if (!tagId) return res.status(400).json({ error: 'tag_id is required' });
        const tag = await dbGet('SELECT source FROM crm_tags WHERE id=?', [tagId]);
        if (!tag) return res.status(404).json({ error: 'Tag not found' });
        if (tag.source === 'system') return res.status(400).json({ error: 'The MTC Customers tag is applied automatically' });
        await dbRun('INSERT IGNORE INTO customer_tags (customer_phone, tag_id) VALUES (?,?)', [req.params.phone, tagId]);
        res.json({ success: true });
    } catch (e) { next(e); }
});

router.delete('/customers/:phone/tags/:tagId', async (req, res, next) => {
    try {
        const tag = await dbGet('SELECT source FROM crm_tags WHERE id=?', [req.params.tagId]);
        if (tag?.source === 'system') return res.status(400).json({ error: 'The MTC Customers tag is applied automatically' });
        await dbRun('DELETE FROM customer_tags WHERE customer_phone=? AND tag_id=?', [req.params.phone, req.params.tagId]);
        res.json({ success: true });
    } catch (e) { next(e); }
});

// Recompute the auto system tag from order history.
router.post('/tags/reconcile', async (req, res, next) => {
    try {
        const added = await reconcileMtcTag();
        res.json({ success: true, added });
    } catch (e) { next(e); }
});

/* ════════════════ BULK MERGE (2+) with user-chosen field winners ════════════════ */
// Folds every phone in `phones` except `survivor_phone` into the survivor, then
// overwrites the survivor's fields with whatever the user picked per-field in
// the merge modal, and sets the final tag list. One transaction.
router.post('/customers/merge-many', async (req, res, next) => {
    try {
        const { phones, survivor_phone, resolved, tag_ids } = req.body;
        if (!Array.isArray(phones) || phones.length < 2) return res.status(400).json({ error: 'Pick at least two contacts to merge' });
        if (!phones.includes(survivor_phone)) return res.status(400).json({ error: 'Primary contact must be one of the selected contacts' });

        const placeholders = phones.map(() => '?').join(',');
        const existing = await dbAll(`SELECT phone FROM customers WHERE phone IN (${placeholders})`, phones);
        if (existing.length !== phones.length) return res.status(404).json({ error: 'One of the contacts no longer exists' });

        const others = phones.filter(p => p !== survivor_phone);

        await transaction(async (tx) => {
            for (const src of others) {
                await tx.dbRun('INSERT IGNORE INTO customer_tags (customer_phone, tag_id) SELECT ?, tag_id FROM customer_tags WHERE customer_phone=?', [survivor_phone, src]);
                await tx.dbRun('DELETE FROM customer_tags WHERE customer_phone=?', [src]);
                await tx.dbRun('UPDATE customer_addresses SET customer_phone=? WHERE customer_phone=?', [survivor_phone, src]);
                for (const [table, col] of PHONE_LINKED_TABLES) {
                    await tx.dbRun(`UPDATE ${table} SET ${col}=? WHERE ${col}=?`, [survivor_phone, src]);
                }
                await tx.dbRun('UPDATE pos_customers SET phone=? WHERE phone=?', [survivor_phone, src]).catch(() => {});
                await tx.dbRun('DELETE FROM customers WHERE phone=?', [src]);
            }

            const allowedFields = ['name','phone2','country_code','company_name','job_title','address','birthday','anniversary','email','email2','notes','loyalty_points','rewards_tier'];
            const sets = [], vals = [];
            for (const f of allowedFields) {
                if (resolved && Object.prototype.hasOwnProperty.call(resolved, f)) {
                    sets.push(`${f}=?`);
                    vals.push(resolved[f] === '' ? null : resolved[f]);
                }
            }
            if (sets.length) {
                vals.push(survivor_phone);
                await tx.dbRun(`UPDATE customers SET ${sets.join(',')}, updated_at=CURRENT_TIMESTAMP WHERE phone=?`, vals);
            }

            // Final tag selection from the modal — system tag is never touched here.
            if (Array.isArray(tag_ids)) {
                await tx.dbRun(
                    `DELETE FROM customer_tags WHERE customer_phone=? AND tag_id NOT IN (SELECT id FROM crm_tags WHERE source='system')`,
                    [survivor_phone]);
                for (const id of tag_ids) {
                    await tx.dbRun('INSERT IGNORE INTO customer_tags (customer_phone, tag_id) VALUES (?,?)', [survivor_phone, id]);
                }
            }
        });
        res.json({ success: true, phone: survivor_phone });
    } catch (e) { next(e); }
});

/* ════════════════ MERGE two contacts into one ════════════════ */
// Fold `source` phone into `target`: target keeps its own set fields, gaps are
// filled from source, then tags/addresses and every identity link cascade over
// and the source row is removed — all in one transaction.
router.post('/customers/merge', async (req, res, next) => {
    try {
        const source = normalizeInputPhone(req.body.source_phone) || req.body.source_phone;
        const target = normalizeInputPhone(req.body.target_phone) || req.body.target_phone;
        if (!source || !target || source === target) return res.status(400).json({ error: 'Pick two different contacts to merge' });

        const s = await dbGet('SELECT * FROM customers WHERE phone=?', [source]);
        const t = await dbGet('SELECT * FROM customers WHERE phone=?', [target]);
        if (!s || !t) return res.status(404).json({ error: 'One of the contacts no longer exists' });

        await transaction(async (tx) => {
            // Fill target's empty scalar fields from source.
            const fillCols = ['phone2','country_code','company_name','job_title','address','birthday','anniversary','email','email2','notes'];
            const sets = [], vals = [];
            for (const col of fillCols) {
                if ((t[col] === null || t[col] === '' || t[col] === undefined) && s[col]) { sets.push(`${col}=?`); vals.push(s[col]); }
            }
            if (t.loyalty_points === 0 && s.loyalty_points) { sets.push('loyalty_points=?'); vals.push(s.loyalty_points); }
            if (sets.length) { vals.push(target); await tx.dbRun(`UPDATE customers SET ${sets.join(',')}, updated_at=CURRENT_TIMESTAMP WHERE phone=?`, vals); }

            // Move tags (ignore dupes), addresses, and every phone-linked table.
            await tx.dbRun('INSERT IGNORE INTO customer_tags (customer_phone, tag_id) SELECT ?, tag_id FROM customer_tags WHERE customer_phone=?', [target, source]);
            await tx.dbRun('DELETE FROM customer_tags WHERE customer_phone=?', [source]);
            await tx.dbRun('UPDATE customer_addresses SET customer_phone=? WHERE customer_phone=?', [target, source]);
            for (const [table, col] of PHONE_LINKED_TABLES) {
                await tx.dbRun(`UPDATE ${table} SET ${col}=? WHERE ${col}=?`, [target, source]);
            }
            await tx.dbRun('UPDATE pos_customers SET phone=? WHERE phone=?', [target, source]).catch(() => {});
            await tx.dbRun('DELETE FROM customers WHERE phone=?', [source]);
        });
        res.json({ success: true, phone: target });
    } catch (e) { next(e); }
});

// STATS
router.get('/stats', async (req, res, next) => {
    try {
        const total    = await dbGet(`SELECT COUNT(*) as n FROM customers WHERE status='active'`);
        const inactive = await dbGet(`SELECT COUNT(*) as n FROM customers WHERE status='inactive'`);
        const binned   = await dbGet(`SELECT COUNT(*) as n FROM customers WHERE status='deleted'`);
        // Birthdays this month (MM matches)
        const bday = await dbGet(
            `SELECT COUNT(*) as n FROM customers
             WHERE status='active' AND birthday IS NOT NULL
               AND MONTH(birthday) = MONTH(CURDATE())`
        );
        const bday_today = await dbGet(
            `SELECT COUNT(*) as n FROM customers
             WHERE status='active' AND birthday IS NOT NULL
               AND DATE_FORMAT(birthday, '%m-%d') = DATE_FORMAT(CURDATE(), '%m-%d')`
        );
        res.json({ total: total.n, inactive: inactive.n, binned: binned.n, bday_month: bday.n, bday_today: bday_today.n });
    } catch (e) { next(e); }
});

// DELIVERY PARTNERS
router.get('/delivery-partners', async (req, res, next) => {
    try {
        const rows = await dbAll(
            `SELECT phone, name, phone2, email FROM customers
             WHERE is_delivery_partner = 1 AND status = 'active'
             ORDER BY name`
        );
        res.json(rows);
    } catch (e) { next(e); }
});

// BIRTHDAY LIST (upcoming 30 days)
router.get('/birthdays', async (req, res, next) => {
    try {
        const rows = await dbAll(
            `SELECT phone, name, email, phone2, birthday,
                    DATE_FORMAT(birthday, '%m-%d') as mmdd
             FROM customers
             WHERE status='active' AND birthday IS NOT NULL
             ORDER BY DATE_FORMAT(birthday, '%m-%d')`
        );
        res.json(rows);
    } catch (e) { next(e); }
});

module.exports = router;
