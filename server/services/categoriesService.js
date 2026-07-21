const { dbAll, dbGet, dbRun } = require('../database/db');

async function getAll({ search, sort }) {
    const allowed = ['id', 'name', 'slug', 'sort_order', 'status'];
    const sortCol = allowed.includes(sort) ? sort : 'sort_order';
    // image_url is derived from the media library FK, never stored on the row
    const base = `SELECT c.*, ml.filename AS image_url
                    FROM categories c LEFT JOIN media_library ml ON ml.id = c.image_id`;
    if (search) {
        return dbAll(
            `${base} WHERE c.name LIKE ? OR c.slug LIKE ? OR c.description LIKE ? ORDER BY c.${sortCol}`,
            [`%${search}%`, `%${search}%`, `%${search}%`]
        );
    }
    return dbAll(`${base} ORDER BY c.${sortCol}`);
}

async function getById(id) {
    return dbGet(`SELECT c.*, ml.filename AS image_url
                    FROM categories c LEFT JOIN media_library ml ON ml.id = c.image_id
                   WHERE c.id = ?`, [id]);
}

async function create({ name, slug, description, sort_order, status, image_id }) {
    const result = await dbRun(
        `INSERT INTO categories (name, slug, description, sort_order, status, image_id) VALUES (?, ?, ?, ?, ?, ?)`,
        [name, slug || null, description || null, sort_order || 0, status || 'active', image_id || null]
    );
    return dbGet(`SELECT * FROM categories WHERE id = ?`, [result.insertId]);
}

async function update(id, { name, slug, description, sort_order, status, image_id }) {
    await dbRun(
        `UPDATE categories SET name=?, slug=?, description=?, sort_order=?, status=?, image_id=? WHERE id=?`,
        [name, slug || null, description || null, sort_order || 0, status || 'active', image_id || null, id]
    );
}

async function remove(id) {
    await dbRun(`DELETE FROM categories WHERE id = ?`, [id]);
}

async function reorder(order) {
    for (let i = 0; i < order.length; i++) {
        await dbRun(`UPDATE categories SET sort_order = ? WHERE id = ?`, [i + 1, order[i]]);
    }
}

module.exports = { getAll, getById, create, update, remove, reorder };
