const { dbAll, dbGet, dbRun } = require('../database/db');

async function getAll({ search, sort }) {
    const allowed = ['id', 'name', 'slug', 'sort_order', 'status'];
    const sortCol = allowed.includes(sort) ? sort : 'sort_order';
    if (search) {
        return dbAll(
            `SELECT * FROM categories WHERE name LIKE ? OR slug LIKE ? OR description LIKE ? ORDER BY ${sortCol}`,
            [`%${search}%`, `%${search}%`, `%${search}%`]
        );
    }
    return dbAll(`SELECT * FROM categories ORDER BY ${sortCol}`);
}

async function getById(id) {
    return dbGet(`SELECT * FROM categories WHERE id = ?`, [id]);
}

async function create({ name, slug, description, sort_order, status }) {
    const result = await dbRun(
        `INSERT INTO categories (name, slug, description, sort_order, status) VALUES (?, ?, ?, ?, ?)`,
        [name, slug || null, description || null, sort_order || 0, status || 'active']
    );
    return dbGet(`SELECT * FROM categories WHERE id = ?`, [result.insertId]);
}

async function update(id, { name, slug, description, sort_order, status }) {
    await dbRun(
        `UPDATE categories SET name=?, slug=?, description=?, sort_order=?, status=? WHERE id=?`,
        [name, slug || null, description || null, sort_order || 0, status || 'active', id]
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
