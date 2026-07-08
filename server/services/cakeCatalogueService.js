'use strict';
// Cake Atelier CMS — CRUD over the cake_designs family and cake_collections
// (cream types come from lookup_master, lookup_type='CREAM_TYPE'). These
// tables live in the shared MariaDB and are read
// DIRECTLY by the v3 website (munchtimecafe.com.np /cakes + /collection),
// so every change here is live immediately — no sync step.

const { dbAll, dbGet, dbRun, transaction } = require('../database/db');

function httpError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

function slugify(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function uniqueSlug(table, name, providedSlug, excludeId = null) {
    const base = slugify(providedSlug) || slugify(name) || 'item';
    let candidate = base, n = 1;
    while (true) {
        const row = excludeId
            ? await dbGet(`SELECT id FROM ${table} WHERE slug=? AND id<>?`, [candidate, excludeId])
            : await dbGet(`SELECT id FROM ${table} WHERE slug=?`, [candidate]);
        if (!row) return candidate;
        candidate = `${base}-${++n}`;
    }
}

// ── Designs ──────────────────────────────────────────────────────────────

async function getAllDesigns({ search = '', status = '' } = {}) {
    let sql = `SELECT * FROM cake_designs WHERE 1=1`;
    const params = [];
    if (search) { sql += ` AND (name LIKE ? OR tagline LIKE ? OR description LIKE ?)`; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (status === 'active') sql += ` AND is_active=1`;
    if (status === 'inactive') sql += ` AND is_active=0`;
    sql += ` ORDER BY sort_order, id`;
    const designs = await dbAll(sql, params);
    if (!designs.length) return [];
    const ids = designs.map(d => d.id);
    const ph = ids.map(() => '?').join(',');
    const [media, sizes, flavours, creams] = await Promise.all([
        dbAll(`SELECT * FROM cake_design_media WHERE design_id IN (${ph}) ORDER BY design_id, sort_order, id`, ids),
        dbAll(`SELECT * FROM cake_design_sizes WHERE design_id IN (${ph}) ORDER BY design_id, sort_order, weight_kg`, ids),
        dbAll(`SELECT * FROM cake_design_flavours WHERE design_id IN (${ph}) ORDER BY design_id, sort_order, id`, ids),
        dbAll(`SELECT dc.*, c.name FROM cake_design_creams dc JOIN lookup_master c ON c.id=dc.cream_id AND c.lookup_type='CREAM_TYPE'
               WHERE dc.design_id IN (${ph}) ORDER BY dc.design_id, dc.sort_order, dc.id`, ids),
    ]);
    const group = rows => rows.reduce((m, r) => ((m[r.design_id] ??= []).push(r), m), {});
    const mMap = group(media), sMap = group(sizes), fMap = group(flavours), cMap = group(creams);
    return designs.map(d => ({
        ...d,
        media: mMap[d.id] || [],
        sizes: sMap[d.id] || [],
        flavours: fMap[d.id] || [],
        creams: cMap[d.id] || [],
    }));
}

async function getDesignById(id) {
    const d = await dbGet(`SELECT * FROM cake_designs WHERE id=?`, [id]);
    if (!d) return null;
    const [media, sizes, flavours, creams] = await Promise.all([
        dbAll(`SELECT * FROM cake_design_media WHERE design_id=? ORDER BY sort_order, id`, [id]),
        dbAll(`SELECT * FROM cake_design_sizes WHERE design_id=? ORDER BY sort_order, weight_kg`, [id]),
        dbAll(`SELECT * FROM cake_design_flavours WHERE design_id=? ORDER BY sort_order, id`, [id]),
        dbAll(`SELECT dc.*, c.name FROM cake_design_creams dc JOIN lookup_master c ON c.id=dc.cream_id AND c.lookup_type='CREAM_TYPE'
               WHERE dc.design_id=? ORDER BY dc.sort_order, dc.id`, [id]),
    ]);
    return { ...d, media, sizes, flavours, creams };
}

function validateDesign(data) {
    if (!data.name || !String(data.name).trim()) throw httpError(400, 'Name is required');
    const sizes = Array.isArray(data.sizes) ? data.sizes : [];
    if (!sizes.length) throw httpError(400, 'At least one size is required');
    for (const s of sizes) {
        if (!s.label || !String(s.label).trim()) throw httpError(400, 'Every size needs a label');
        if (!(parseFloat(s.weight_kg) > 0)) throw httpError(400, `Size "${s.label}": weight (kg) must be > 0`);
        if (Number.isNaN(parseFloat(s.price)) || parseFloat(s.price) < 0) throw httpError(400, `Size "${s.label}": price must be a non-negative number`);
    }
    for (const f of (Array.isArray(data.flavours) ? data.flavours : [])) {
        if (!f.name || !String(f.name).trim()) throw httpError(400, 'Every flavour needs a name');
    }
    for (const c of (Array.isArray(data.creams) ? data.creams : [])) {
        if (!parseInt(c.cream_id, 10)) throw httpError(400, 'Every cream needs a valid cream_id');
    }
    for (const m of (Array.isArray(data.media) ? data.media : [])) {
        if (!m.url || !String(m.url).trim()) throw httpError(400, 'Every photo needs a URL');
    }
    return {
        name:        String(data.name).trim(),
        tagline:     String(data.tagline || '').trim(),
        description: String(data.description || '').trim(),
        shape_tags:  String(data.shape_tags || '').trim(),
        badge_tags:  String(data.badge_tags || '').trim(),
        cream_choice: data.cream_choice === undefined ? 1 : (data.cream_choice ? 1 : 0),
        eggless_available: data.eggless_available === undefined ? 1 : (data.eggless_available ? 1 : 0),
        prep_time_hours: parseInt(data.prep_time_hours, 10) || 24,
        is_active:   data.is_active === undefined ? 1 : (data.is_active ? 1 : 0),
        media:    (data.media || []).map(m => ({ url: String(m.url).trim(), alt: String(m.alt || '').trim(), media_id: m.media_id || null })),
        sizes:    (data.sizes || []).map(s => ({ label: String(s.label).trim(), weight_kg: parseFloat(s.weight_kg), serves: String(s.serves || '').trim(), price: parseFloat(s.price) })),
        flavours: (data.flavours || []).map(f => ({ name: String(f.name).trim(), surcharge: parseFloat(f.surcharge) || 0 })),
        creams:   (data.creams || []).map(c => ({ cream_id: parseInt(c.cream_id, 10), surcharge: parseFloat(c.surcharge) || 0 })),
    };
}

async function replaceChildren(tx, designId, v) {
    for (const t of ['cake_design_media', 'cake_design_sizes', 'cake_design_flavours', 'cake_design_creams'])
        await tx.dbRun(`DELETE FROM ${t} WHERE design_id=?`, [designId]);
    let i = 0;
    for (const m of v.media)
        await tx.dbRun(`INSERT INTO cake_design_media (design_id,url,alt,sort_order,media_id) VALUES (?,?,?,?,?)`, [designId, m.url, m.alt, i++, m.media_id]);
    i = 0;
    for (const s of v.sizes)
        await tx.dbRun(`INSERT INTO cake_design_sizes (design_id,label,weight_kg,serves,price,sort_order) VALUES (?,?,?,?,?,?)`, [designId, s.label, s.weight_kg, s.serves, s.price, i++]);
    i = 0;
    for (const f of v.flavours)
        await tx.dbRun(`INSERT INTO cake_design_flavours (design_id,name,surcharge,sort_order) VALUES (?,?,?,?)`, [designId, f.name, f.surcharge, i++]);
    i = 0;
    for (const c of v.creams)
        await tx.dbRun(`INSERT INTO cake_design_creams (design_id,cream_id,surcharge,sort_order) VALUES (?,?,?,?)`, [designId, c.cream_id, c.surcharge, i++]);
}

async function createDesign(data) {
    const v = validateDesign(data);
    const slug = await uniqueSlug('cake_designs', v.name, data.slug);
    const max = await dbGet(`SELECT COALESCE(MAX(sort_order),-1) mx FROM cake_designs`);
    let id;
    await transaction(async (tx) => {
        const r = await tx.dbRun(
            `INSERT INTO cake_designs (name,slug,tagline,description,shape_tags,badge_tags,cream_choice,eggless_available,prep_time_hours,sort_order,is_active)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            [v.name, slug, v.tagline, v.description, v.shape_tags, v.badge_tags, v.cream_choice, v.eggless_available, v.prep_time_hours, max.mx + 1, v.is_active]);
        id = r.lastInsertRowid;
        await replaceChildren(tx, id, v);
    });
    return id;
}

async function updateDesign(id, data) {
    const existing = await dbGet(`SELECT id FROM cake_designs WHERE id=?`, [id]);
    if (!existing) throw httpError(404, 'Design not found');
    const v = validateDesign(data);
    const slug = await uniqueSlug('cake_designs', v.name, data.slug, id);
    await transaction(async (tx) => {
        await tx.dbRun(
            `UPDATE cake_designs SET name=?, slug=?, tagline=?, description=?, shape_tags=?, badge_tags=?,
             cream_choice=?, eggless_available=?, prep_time_hours=?, is_active=? WHERE id=?`,
            [v.name, slug, v.tagline, v.description, v.shape_tags, v.badge_tags, v.cream_choice, v.eggless_available, v.prep_time_hours, v.is_active, id]);
        await replaceChildren(tx, id, v);
    });
}

async function removeDesign(id) {
    await transaction(async (tx) => {
        for (const t of ['cake_design_media', 'cake_design_sizes', 'cake_design_flavours', 'cake_design_creams'])
            await tx.dbRun(`DELETE FROM ${t} WHERE design_id=?`, [id]);
        await tx.dbRun(`DELETE FROM cake_collection_items WHERE design_id=?`, [id]);
        await tx.dbRun(`DELETE FROM cake_designs WHERE id=?`, [id]);
    });
}

async function bulkAction(action, ids) {
    if (!ids.length) return;
    const ph = ids.map(() => '?').join(',');
    if (action === 'activate') await dbRun(`UPDATE cake_designs SET is_active=1 WHERE id IN (${ph})`, ids);
    else if (action === 'deactivate') await dbRun(`UPDATE cake_designs SET is_active=0 WHERE id IN (${ph})`, ids);
    else if (action === 'delete') { for (const id of ids) await removeDesign(id); }
    else throw httpError(400, `Unknown action: ${action}`);
}

async function reorder(order) {
    for (const { id, sort_order } of order)
        await dbRun(`UPDATE cake_designs SET sort_order=? WHERE id=?`, [sort_order, id]);
}

// ── Lookups for the CMS form ─────────────────────────────────────────────

async function getLookups() {
    const [creams, badges, shapes, flavourRows] = await Promise.all([
        dbAll(`SELECT id, name, extra_charge AS surcharge, sort_order FROM lookup_master
               WHERE lookup_type='CREAM_TYPE' AND is_active=1 ORDER BY sort_order, name`).catch(() => []),
        dbAll(`SELECT code, name, value AS icon FROM lookup_master
               WHERE lookup_type='PRODUCT_BADGE' AND is_active=1 ORDER BY sort_order, name`).catch(() => []),
        dbAll(`SELECT name FROM cake_shapes WHERE is_active=1 ORDER BY sort_order`).catch(() => []),
        dbAll(`SELECT DISTINCT name FROM cake_design_flavours ORDER BY name`),
    ]);
    return {
        creams,
        badges,
        shapes: shapes.map(r => r.name),
        flavours: flavourRows.map(r => r.name),
    };
}

// ── Collections ──────────────────────────────────────────────────────────

async function getCollections() {
    const cols = await dbAll(`SELECT * FROM cake_collections ORDER BY sort_order, id`);
    if (!cols.length) return [];
    const ph = cols.map(() => '?').join(',');
    const items = await dbAll(
        `SELECT i.*, d.name AS design_name,
                (SELECT url FROM cake_design_media m WHERE m.design_id=d.id ORDER BY m.sort_order, m.id LIMIT 1) AS design_image
         FROM cake_collection_items i JOIN cake_designs d ON d.id=i.design_id
         WHERE i.collection_id IN (${ph}) ORDER BY i.collection_id, i.sort_order, i.id`, cols.map(c => c.id));
    const map = items.reduce((m, r) => ((m[r.collection_id] ??= []).push(r), m), {});
    return cols.map(c => ({ ...c, items: map[c.id] || [] }));
}

function validateCollection(data) {
    if (!data.title || !String(data.title).trim()) throw httpError(400, 'Title is required');
    const items = Array.isArray(data.items) ? data.items : [];
    for (const it of items) {
        if (!parseInt(it.design_id, 10)) throw httpError(400, 'Every collection item needs a design');
    }
    return {
        title: String(data.title).trim(),
        kicker: String(data.kicker || '').trim(),
        intro: String(data.intro || '').trim(),
        quote: String(data.quote || '').trim(),
        hero_url: String(data.hero_url || '').trim(),
        hero_media_id: data.hero_media_id || null,
        sort_order: parseInt(data.sort_order, 10) || 0,
        is_active: data.is_active === undefined ? 1 : (data.is_active ? 1 : 0),
        items: items.map(it => ({ design_id: parseInt(it.design_id, 10), note: String(it.note || '').trim() })),
    };
}

async function replaceCollectionItems(tx, collectionId, items) {
    await tx.dbRun(`DELETE FROM cake_collection_items WHERE collection_id=?`, [collectionId]);
    let i = 0;
    for (const it of items)
        await tx.dbRun(`INSERT INTO cake_collection_items (collection_id,design_id,note,sort_order) VALUES (?,?,?,?)`,
            [collectionId, it.design_id, it.note, i++]);
}

async function createCollection(data) {
    const v = validateCollection(data);
    const slug = await uniqueSlug('cake_collections', v.title, data.slug);
    let id;
    await transaction(async (tx) => {
        const r = await tx.dbRun(
            `INSERT INTO cake_collections (slug,title,kicker,intro,quote,hero_url,hero_media_id,sort_order,is_active) VALUES (?,?,?,?,?,?,?,?,?)`,
            [slug, v.title, v.kicker, v.intro, v.quote, v.hero_url, v.hero_media_id, v.sort_order, v.is_active]);
        id = r.lastInsertRowid;
        await replaceCollectionItems(tx, id, v.items);
    });
    return id;
}

async function updateCollection(id, data) {
    const existing = await dbGet(`SELECT id FROM cake_collections WHERE id=?`, [id]);
    if (!existing) throw httpError(404, 'Collection not found');
    const v = validateCollection(data);
    const slug = await uniqueSlug('cake_collections', v.title, data.slug, id);
    await transaction(async (tx) => {
        await tx.dbRun(
            `UPDATE cake_collections SET slug=?, title=?, kicker=?, intro=?, quote=?, hero_url=?, hero_media_id=?, sort_order=?, is_active=? WHERE id=?`,
            [slug, v.title, v.kicker, v.intro, v.quote, v.hero_url, v.hero_media_id, v.sort_order, v.is_active, id]);
        await replaceCollectionItems(tx, id, v.items);
    });
}

async function removeCollection(id) {
    await transaction(async (tx) => {
        await tx.dbRun(`DELETE FROM cake_collection_items WHERE collection_id=?`, [id]);
        await tx.dbRun(`DELETE FROM cake_collections WHERE id=?`, [id]);
    });
}

async function reorderCollections(order) {
    for (const { id, sort_order } of order)
        await dbRun(`UPDATE cake_collections SET sort_order=? WHERE id=?`, [sort_order, id]);
}

module.exports = {
    getAllDesigns, getDesignById, createDesign, updateDesign, removeDesign,
    bulkAction, reorder, getLookups,
    getCollections, createCollection, updateCollection, removeCollection, reorderCollections,
};
