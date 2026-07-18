const express = require('express');
const router  = express.Router();
const { dbAll, dbGet, dbRun } = require('../database/db');

// LIST with search
router.get('/customers', async (req, res, next) => {
    try {
        const q  = `%${(req.query.search || '').trim()}%`;
        const st = req.query.status || 'active';
        const rows = await dbAll(
            `SELECT * FROM customers
             WHERE (phone LIKE ? OR name LIKE ? OR email LIKE ? OR phone2 LIKE ? OR address LIKE ?)
               AND (? = 'all' OR status = ?)
             ORDER BY name`,
            [q, q, q, q, q, st, st]
        );
        res.json(rows);
    } catch (e) { next(e); }
});

// GET single
router.get('/customers/:phone', async (req, res, next) => {
    try {
        const row = await dbGet('SELECT * FROM customers WHERE phone = ?', [req.params.phone]);
        if (!row) return res.status(404).json({ error: 'Not found' });
        res.json(row);
    } catch (e) { next(e); }
});

// CREATE
router.post('/customers', async (req, res, next) => {
    try {
        const { phone, phone2, name, address, birthday, email, email2, notes } = req.body;
        if (!phone || !name) return res.status(400).json({ error: 'phone and name are required' });
        const exists = await dbGet('SELECT phone FROM customers WHERE phone = ?', [phone]);
        if (exists) return res.status(409).json({ error: 'Phone number already exists' });
        await dbRun(
            `INSERT INTO customers (phone,phone2,name,address,birthday,email,email2,notes)
             VALUES (?,?,?,?,?,?,?,?)`,
            [phone, phone2||null, name, address||null, birthday||null, email||null, email2||null, notes||null]
        );
        res.json({ success: true, phone });
    } catch (e) { next(e); }
});

// UPDATE
router.put('/customers/:phone', async (req, res, next) => {
    try {
        const { phone2, name, address, birthday, email, email2, loyalty_points, rewards_tier, notes, status, is_delivery_partner, discount } = req.body;
        if (!name) return res.status(400).json({ error: 'name is required' });
        await dbRun(
            `UPDATE customers SET phone2=?,name=?,address=?,birthday=?,email=?,email2=?,
             loyalty_points=?,rewards_tier=?,notes=?,status=?,is_delivery_partner=?,discount=?,updated_at=CURRENT_TIMESTAMP
             WHERE phone=?`,
            [phone2||null, name, address||null, birthday||null, email||null, email2||null,
             loyalty_points||0, rewards_tier||'standard', notes||null, status||'active',
             is_delivery_partner ? 1 : 0, Math.min(100, Math.max(0, Number(discount) || 0)), req.params.phone]
        );
        res.json({ success: true });
    } catch (e) { next(e); }
});

// DELETE (soft)
router.delete('/customers/:phone', async (req, res, next) => {
    try {
        await dbRun(`UPDATE customers SET status='inactive', updated_at=CURRENT_TIMESTAMP WHERE phone=?`, [req.params.phone]);
        res.json({ success: true });
    } catch (e) { next(e); }
});

// HARD DELETE
router.delete('/customers/:phone/purge', async (req, res, next) => {
    try {
        await dbRun('DELETE FROM customers WHERE phone=?', [req.params.phone]);
        res.json({ success: true });
    } catch (e) { next(e); }
});

// STATS
router.get('/stats', async (req, res, next) => {
    try {
        const total    = await dbGet(`SELECT COUNT(*) as n FROM customers WHERE status='active'`);
        const inactive = await dbGet(`SELECT COUNT(*) as n FROM customers WHERE status='inactive'`);
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
        res.json({ total: total.n, inactive: inactive.n, bday_month: bday.n, bday_today: bday_today.n });
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
