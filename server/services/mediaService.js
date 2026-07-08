const { dbAll, dbGet, dbRun } = require('../database/db');
const fs = require('fs');
const path = require('path');
const sizeOf = require('image-size');
const { uploadsDir } = require('../middleware/upload');

// "sections" reflects real, current usage (not a stored tag) so it can never go
// stale — removing an image from a product/blog/design drops the badge immediately.
// product_images keeps one row per image a product has ever used (setImage() only
// ever demotes old rows to is_primary=0, never deletes them), so is_primary=1 is
// the only row that reflects what's actually showing anywhere today.
const SECTIONS_AGG = `TRIM(BOTH ',' FROM CONCAT(
    IF(EXISTS (SELECT 1 FROM product_images pi2 WHERE pi2.media_id = m.id AND pi2.is_primary = 1), 'menu,', ''),
    IF(EXISTS (SELECT 1 FROM blogs b WHERE b.featured_image = m.id OR b.author_image = m.id), 'blog,', ''),
    IF(EXISTS (SELECT 1 FROM cake_design_media cdm WHERE cdm.media_id = m.id)
       OR EXISTS (SELECT 1 FROM cake_collections cc WHERE cc.hero_media_id = m.id), 'cake,', '')
)) AS sections`;

const SECTION_FILTER_SQL = {
    menu: `m.id IN (SELECT media_id FROM product_images WHERE is_primary = 1)`,
    blog: `m.id IN (SELECT featured_image FROM blogs WHERE featured_image IS NOT NULL
                     UNION SELECT author_image FROM blogs WHERE author_image IS NOT NULL)`,
    cake: `m.id IN (SELECT media_id FROM cake_design_media WHERE media_id IS NOT NULL
                     UNION SELECT hero_media_id FROM cake_collections WHERE hero_media_id IS NOT NULL)`,
};

function withSections(rows) {
    return rows.map(r => ({ ...r, sections: r.sections ? r.sections.split(',') : [] }));
}

async function query({ search, unassigned, section, limit }) {
    const where = [], params = [];
    if (search) { where.push(`(m.filename LIKE ? OR m.title LIKE ? OR m.alt_text LIKE ?)`); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (section && SECTION_FILTER_SQL[section]) where.push(SECTION_FILTER_SQL[section]);
    if (unassigned) where.push(`pi.id IS NULL`);
    let sql = `SELECT m.*, ${SECTIONS_AGG} FROM media_library m`;
    if (unassigned) sql += ` LEFT JOIN product_images pi ON pi.media_id=m.id AND pi.is_primary=1`;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ` ORDER BY m.created_at DESC`;
    if (limit) { sql += ` LIMIT ${Number(limit)}`; }
    return withSections(await dbAll(sql, params));
}

async function getAll({ search, unassigned, section }) {
    return query({ search, unassigned, section, limit: 200 });
}

async function getList({ search, unassigned, section }) {
    return query({ search, unassigned, section, limit: (search || unassigned || section) ? 200 : 10 });
}

async function saveFileEntry(file) {
    let w = null, h = null;
    try {
        const dim = sizeOf(file.path);
        w = dim.width; h = dim.height;
    } catch (e) {}
    const title = path.basename(file.originalname, path.extname(file.originalname))
        .replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const result = await dbRun(
        `INSERT INTO media_library (filename,original_name,title,alt_text,file_type,file_size,width,height) VALUES (?,?,?,?,?,?,?,?)`,
        [file.filename, file.originalname, title, title, file.mimetype, file.size, w, h]
    );
    return { id: result.lastID, filename: file.filename, title };
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

module.exports = { getAll, getList, saveFileEntry, update, remove, bulkDelete };
