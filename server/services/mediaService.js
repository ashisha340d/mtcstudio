const { dbAll, dbGet, dbRun } = require('../database/db');
const fs = require('fs');
const path = require('path');
const sizeOf = require('image-size');
const sharp = require('sharp');
const { uploadsDir } = require('../middleware/upload');

// Raster formats only — svg is vector, gif may be animated, both would break on re-encode.
const COMPRESSIBLE = ['.jpg', '.jpeg', '.png', '.webp'];

// Compress in place and normalize to webp so every media-library file matches
// the forapp export pipeline. No resize — quality-only compression.
async function compressToWebp(file) {
    const ext = path.extname(file.filename).toLowerCase();
    if (!COMPRESSIBLE.includes(ext)) return file;

    const webpName = file.filename.replace(/\.[^.]+$/, '.webp');
    const webpPath = path.join(uploadsDir, webpName);
    const tmpPath = webpPath + '.tmp';

    await sharp(file.path).webp({ quality: 82 }).toFile(tmpPath);
    fs.unlinkSync(file.path);
    fs.renameSync(tmpPath, webpPath);

    const { size } = fs.statSync(webpPath);
    return { ...file, filename: webpName, path: webpPath, mimetype: 'image/webp', size };
}

// "sections" reflects real, current usage (not a stored tag) so it can never go
// stale — removing an image from a product/blog/design drops the badge immediately.
// product_images keeps one row per image a product has ever used (setImage() only
// ever demotes old rows to is_primary=0, never deletes them), so is_primary=1 is
// the only row that reflects what's actually showing anywhere today.
const SECTIONS_AGG = `TRIM(BOTH ',' FROM CONCAT(
    IF(EXISTS (SELECT 1 FROM product_images pi2 WHERE pi2.media_id = m.id AND pi2.is_primary = 1), 'menu,', ''),
    IF(EXISTS (SELECT 1 FROM blogs b WHERE b.featured_image = m.id OR b.author_image = m.id), 'blog,', ''),
    IF(EXISTS (SELECT 1 FROM cake_design_media cdm WHERE cdm.media_id = m.id)
       OR EXISTS (SELECT 1 FROM cake_collections cc WHERE cc.hero_media_id = m.id), 'cake,', ''),
    IF(EXISTS (SELECT 1 FROM employee_profiles ep WHERE ep.photo_media_id = m.id), 'employee,', '')
)) AS sections`;

const SECTION_FILTER_SQL = {
    menu: `m.id IN (SELECT media_id FROM product_images WHERE is_primary = 1)`,
    blog: `m.id IN (SELECT featured_image FROM blogs WHERE featured_image IS NOT NULL
                     UNION SELECT author_image FROM blogs WHERE author_image IS NOT NULL)`,
    cake: `m.id IN (SELECT media_id FROM cake_design_media WHERE media_id IS NOT NULL
                     UNION SELECT hero_media_id FROM cake_collections WHERE hero_media_id IS NOT NULL)`,
    employee: `m.id IN (SELECT photo_media_id FROM employee_profiles WHERE photo_media_id IS NOT NULL)`,
};

function withSections(rows) {
    return rows.map(r => ({ ...r, sections: r.sections ? r.sections.split(',') : [] }));
}

function buildWhere({ search, unassigned, section }) {
    const where = [], params = [];
    if (search) { where.push(`(m.filename LIKE ? OR m.title LIKE ? OR m.alt_text LIKE ?)`); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (section && SECTION_FILTER_SQL[section]) where.push(SECTION_FILTER_SQL[section]);
    if (unassigned) where.push(`pi.id IS NULL`);
    return { where, params };
}

async function query({ search, unassigned, section, limit, offset }) {
    const { where, params } = buildWhere({ search, unassigned, section });
    let sql = `SELECT m.*, ${SECTIONS_AGG} FROM media_library m`;
    if (unassigned) sql += ` LEFT JOIN product_images pi ON pi.media_id=m.id AND pi.is_primary=1`;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ` ORDER BY m.created_at DESC`;
    if (limit) { sql += ` LIMIT ${Number(limit)}`; }
    if (offset) { sql += ` OFFSET ${Number(offset)}`; }
    return withSections(await dbAll(sql, params));
}

async function countMedia({ search, unassigned, section }) {
    const { where, params } = buildWhere({ search, unassigned, section });
    let sql = `SELECT COUNT(*) AS c FROM media_library m`;
    if (unassigned) sql += ` LEFT JOIN product_images pi ON pi.media_id=m.id AND pi.is_primary=1`;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    const row = await dbGet(sql, params);
    return row.c;
}

async function getAll({ search, unassigned, section }) {
    return query({ search, unassigned, section, limit: 200 });
}

async function getList({ search, unassigned, section, page, perPage }) {
    const p = Math.max(1, Number(page) || 1);
    const pp = Number(perPage) === 12 ? 12 : 24; // only 12 or 24 allowed
    const [items, total] = await Promise.all([
        query({ search, unassigned, section, limit: pp, offset: (p - 1) * pp }),
        countMedia({ search, unassigned, section }),
    ]);
    return { items, total, page: p, perPage: pp, totalPages: Math.max(1, Math.ceil(total / pp)) };
}

async function saveFileEntry(file) {
    const f = await compressToWebp(file);
    let w = null, h = null;
    try {
        const dim = sizeOf(f.path);
        w = dim.width; h = dim.height;
    } catch (e) {}
    const title = path.basename(file.originalname, path.extname(file.originalname))
        .replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const result = await dbRun(
        `INSERT INTO media_library (filename,original_name,title,alt_text,file_type,file_size,width,height) VALUES (?,?,?,?,?,?,?,?)`,
        [f.filename, file.originalname, title, title, f.mimetype, f.size, w, h]
    );
    return { id: result.insertId, filename: f.filename, title };
}

async function update(id, { title, alt_text, caption }) {
    await dbRun(
        `UPDATE media_library SET title=?,alt_text=?,caption=? WHERE id=?`,
        [title || null, alt_text || null, caption || null, id]
    );
}

async function remove(id) {
    const row = await dbGet(`SELECT filename FROM media_library WHERE id=?`, [id]);
    if (!row) throw Object.assign(new Error('Not found'), { status: 404 });
    await dbRun(`DELETE FROM media_library WHERE id=?`, [id]);
    const filePath = path.join(uploadsDir, row.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

async function bulkDelete(ids) {
    const ph = ids.map(() => '?').join(',');
    const rows = await dbAll(`SELECT filename FROM media_library WHERE id IN (${ph})`, ids);
    await dbRun(`DELETE FROM media_library WHERE id IN (${ph})`, ids);
    rows.forEach(r => {
        const fp = path.join(uploadsDir, r.filename);
        if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch (e) {}
    });
    return rows.length;
}

// ── "Make For App" — rebuild uploads/forapp from scratch: wipe, then export
// ONLY product (menu) + category images as compressed webp, max 512×512.
// Filenames keep the source basename stem + .webp so the companion app's
// /sync/images manifest lines up.
const FORAPP_DIR = path.join(__dirname, '..', 'uploads', 'forapp');

async function makeForApp() {
    fs.mkdirSync(FORAPP_DIR, { recursive: true });
    for (const f of fs.readdirSync(FORAPP_DIR)) {
        try { fs.unlinkSync(path.join(FORAPP_DIR, f)); } catch (e) {}
    }

    const [prodImgs, catImgs] = await Promise.all([
        dbAll(`SELECT ml.filename FROM product_images pi JOIN media_library ml ON ml.id = pi.media_id`),
        dbAll(`SELECT ml.filename AS image_url
                 FROM categories c JOIN media_library ml ON ml.id = c.image_id`),
    ]);

    const names = new Set();
    for (const r of prodImgs) if (r.filename) names.add(r.filename);
    for (const r of catImgs) {
        const base = String(r.image_url).replace(/\\/g, '/').split('/').pop();
        if (base) names.add(base);
    }

    let exported = 0, missing = 0, failed = 0;
    for (const name of names) {
        const src = path.join(uploadsDir, name);
        if (!fs.existsSync(src)) { missing++; continue; }
        const out = path.join(FORAPP_DIR, name.replace(/\.[^.]+$/, '.webp'));
        try {
            await sharp(src)
                .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 80 })
                .toFile(out);
            exported++;
        } catch (e) { failed++; }
    }
    return { exported, missing, failed, total: names.size };
}

module.exports = { getAll, getList, saveFileEntry, update, remove, bulkDelete, makeForApp };
