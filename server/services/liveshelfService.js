const { dbAll, dbGet, dbRun } = require('../database/db');

const CATEGORIES = [
    'Ready Made Cakes', 'Pastries', 'Muffins',
    'Cookies', 'Bread', 'Desserts', "Today's Specials"
];

function getStatus(qty) {
    if (qty === 0) return 'sold_out';
    if (qty <= 3) return 'low_stock';
    return 'available';
}

function formatItem(row) {
    return {
        id: row.id,
        category: row.category,
        name: row.name,
        price: row.price,
        quantity: row.quantity,
        status: getStatus(row.quantity),
        image: row.image,
        notes: row.notes,
        sort_order: row.sort_order
    };
}

async function getAll({ search, category }) {
    let sql = `SELECT id, category, name, price, quantity, image, notes, sort_order, created_at FROM live_shelf WHERE 1=1`;
    const params = [];
    if (search) { sql += ` AND name LIKE ?`; params.push(`%${search}%`); }
    if (category) { sql += ` AND category = ?`; params.push(category); }
    sql += ` ORDER BY sort_order ASC, id DESC`;
    const items = await dbAll(sql, params);
    return { items: items.map(formatItem), categories: CATEGORIES };
}

async function getPublic({ category }) {
    let sql = `SELECT id, category, name, price, quantity, image, notes, sort_order FROM live_shelf WHERE 1=1`;
    const params = [];
    if (category) { sql += ` AND category = ?`; params.push(category); }
    sql += ` ORDER BY sort_order ASC, id DESC`;
    const rows = await dbAll(sql, params);
    return rows.map(formatItem);
}

async function getById(id) {
    return dbGet(`SELECT * FROM live_shelf WHERE id = ?`, [id]);
}

async function create({ category, name, price, quantity, image, notes, sort_order }) {
    if (!category || !name) throw Object.assign(new Error('Category and name are required'), { status: 400 });
    const result = await dbRun(
        `INSERT INTO live_shelf (category, name, price, quantity, image, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [category, name.trim(), parseFloat(price) || 0, parseInt(quantity) || 0,
         image || null, notes || null, parseInt(sort_order) || 0]
    );
    return result.insertId;
}

async function update(id, { category, name, price, quantity, image, notes, sort_order }) {
    if (!category || !name) throw Object.assign(new Error('Category and name are required'), { status: 400 });
    await dbRun(
        `UPDATE live_shelf SET category=?, name=?, price=?, quantity=?, image=?, notes=?, sort_order=?, sync_status=0, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        [category, name.trim(), parseFloat(price) || 0, parseInt(quantity) || 0,
         image || null, notes || null, parseInt(sort_order) || 0, id]
    );
}

async function remove(id) {
    await dbRun(`DELETE FROM live_shelf WHERE id = ?`, [id]);
}

module.exports = { CATEGORIES, getAll, getPublic, getById, create, update, remove };
