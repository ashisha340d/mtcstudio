'use strict';
const express = require('express');
const { dbAll, dbGet, dbRun } = require('../../pos/db');
const { requireSession } = require('../../middleware/posAuth');

const router = express.Router();
router.use(requireSession);

router.get('/lookup', async (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: 'phone required' });
  const customer = await dbGet(`SELECT * FROM pos_customers WHERE phone=?`, [phone.trim()]);
  res.json(customer ? { found: true, customer } : { found: false });
});

router.post('/', async (req, res) => {
  const { name, phone, address, notes } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });
  const existing = await dbGet(`SELECT id FROM pos_customers WHERE phone=?`, [phone.trim()]);
  if (existing) {
    await dbRun(`UPDATE pos_customers SET name=?, address=?, notes=? WHERE id=?`, [name, address ?? null, notes ?? null, existing.id]);
    return res.json(await dbGet(`SELECT * FROM pos_customers WHERE id=?`, [existing.id]));
  }
  const result = await dbGet(`INSERT INTO pos_customers (name,phone,address,notes) VALUES (?,?,?,?) RETURNING *`, [name.trim(), phone.trim(), address ?? null, notes ?? null]);
  res.status(201).json(result);
});

// GET /api/pos/ledger?phone=xxx
router.get('/ledger', async (req, res) => {
  const { phone } = req.query;
  const rows = phone
    ? await dbAll(`SELECT l.*,o.order_type FROM pos_ledger l LEFT JOIN pos_orders o ON o.id=l.order_id WHERE l.customer_phone=? ORDER BY l.created_at DESC LIMIT 100`, [phone])
    : await dbAll(`SELECT l.*,o.order_type FROM pos_ledger l LEFT JOIN pos_orders o ON o.id=l.order_id ORDER BY l.created_at DESC LIMIT 100`);
  res.json(rows);
});

module.exports = router;
