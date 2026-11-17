const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/dashboardController');
const { dbAll } = require('../pos/db');
const { getNepalDayBoundsUTC } = require('../utils/nepalDateTime');

router.get('/stats', ctrl.stats);

// Fonepay payments captured today by MTC Companion — read-only log for the
// Studio payment drawer.
router.get('/fonepay-today', async (req, res) => {
  const { start, end } = getNepalDayBoundsUTC(req.query.date);
  const rows = await dbAll(
    `SELECT id, amount, payer, txn_id, raw_title, raw_text, notified_at, created_at
       FROM pos_fonepay_payments WHERE created_at BETWEEN ? AND ? ORDER BY created_at DESC`,
    [start, end]
  );
  res.json(rows.map(r => ({
    paymentId: r.id, amount: r.amount != null ? Number(r.amount) : null,
    payer: r.payer, txnId: r.txn_id, title: r.raw_title, text: r.raw_text,
    timestamp: r.created_at,
  })));
});

module.exports = router;
