const { dbAll, dbGet, dbRun } = require('../database/db');
const fs = require('fs');
const path = require('path');
const sizeOf = require('image-size');
const { uploadsDir } = require('../middleware/upload');

async function getAll({ search, unassigned }) {
    if (search) {
        return dbAll(
            `SELECT * FROM media_library WHERE filename LIKE ? OR title LIKE ? OR alt_text LIKE ? ORDER BY created_at DESC`,
            [`%${search}%`, `%${search}%`, `%${search}%`]
        );
    }
    if (unassigned) {
        return dbAll(
            `SELECT m.* FROM media_library m LEFT JOIN product_images pi ON pi.media_id=m.id WHERE pi.id IS NULL ORDER BY m.created_at DESC LIMIT 200`
        );
    }
    return dbAll(`SELECT * FROM media_library ORDER BY created_at DESC`);
}

async function getList({ search, unassigned }) {
    if (search) {
        return dbAll(
            `SELECT * FROM media_library WHERE filename LIKE ? OR title LIKE ? OR alt_text LIKE ? ORDER BY created_at DESC LIMIT 200`,
            [`%${search}%`, `%${search}%`, `%${search}%`]
        );
    }
    if (unassigned) {
        return dbAll(
            `SELECT m.* FROM media_library m LEFT JOIN product_images pi ON pi.media_id=m.id WHERE pi.id IS NULL ORDER BY m.created_at DESC LIMIT 200`
        );
    }
    return dbAll(`SELECT * FROM media_library ORDER BY created_at DESC LIMIT 10`);
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
