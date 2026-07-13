const express = require('express');
const router  = express.Router();
const { dbAll, dbGet, dbRun } = require('../pos/db');
const { pushWeatherReco } = require('../services/weatherRecoSync');

// Weather buckets the website understands (server/weather.js bucketize()).
const BUCKETS = ['sunny', 'cloudy', 'rain', 'storm', 'snow', 'fog', 'windy'];

// GET /api/weather-reco — recommendations grouped by bucket + popup settings
router.get('/', async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT wr.id, wr.bucket, wr.product_id, wr.sort_order,
              p.name AS product_name,
              (SELECT MIN(v.selling_price) FROM product_variants v WHERE v.product_id = p.id AND v.status='active') AS price
       FROM weather_recommendations wr
       JOIN products p ON p.id = wr.product_id
       ORDER BY wr.bucket, wr.sort_order, wr.id`);
    const buckets = {};
    BUCKETS.forEach(b => { buckets[b] = []; });
    rows.forEach(r => { (buckets[r.bucket] ??= []).push(r); });
    const s = await dbGet(`SELECT enabled, modal_seconds, max_per_session FROM weather_reco_settings WHERE id=1`)
      || { enabled: 1, modal_seconds: 8, max_per_session: 1 };
    res.json({ buckets: BUCKETS, items: buckets, settings: s });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/weather-reco/products — active products for the picker
router.get('/products', async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT p.id, p.name, c.name AS category,
              (SELECT MIN(v.selling_price) FROM product_variants v WHERE v.product_id = p.id AND v.status='active') AS price
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.status='active'
       ORDER BY c.name, p.sort_order, p.id`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/weather-reco — add a product to a bucket
router.post('/', async (req, res) => {
  try {
    const { bucket, product_id } = req.body;
    if (!BUCKETS.includes(bucket) || !product_id)
      return res.status(400).json({ error: 'Valid bucket and product_id required' });
    const max = await dbGet(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM weather_recommendations WHERE bucket=?`, [bucket]);
    await dbRun(
      `INSERT IGNORE INTO weather_recommendations (bucket, product_id, sort_order) VALUES (?,?,?)`,
      [bucket, product_id, (max?.m ?? -1) + 1]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/weather-reco/reorder — bulk sort_order update within a bucket
router.post('/reorder', async (req, res) => {
  try {
    const { order } = req.body; // [{ id, sort_order }, ...]
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
    for (const { id, sort_order } of order)
      await dbRun(`UPDATE weather_recommendations SET sort_order=? WHERE id=?`, [sort_order, id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/weather-reco/:id — remove a mapping row
router.delete('/:id', async (req, res) => {
  try {
    await dbRun(`DELETE FROM weather_recommendations WHERE id=?`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/weather-reco/settings — popup toggle + timing
router.put('/settings', async (req, res) => {
  try {
    const { enabled, modalSeconds, maxPerSession } = req.body;
    await dbRun(
      `UPDATE weather_reco_settings
         SET enabled=?, modal_seconds=?, max_per_session=? WHERE id=1`,
      [enabled ? 1 : 0, Number(modalSeconds) || 8, Number(maxPerSession) || 1]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/weather-reco/sync — push everything to the live website
router.post('/sync', async (req, res) => {
  try {
    const result = await pushWeatherReco();
    res.json({ success: true, synced: result.synced ?? 0 });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

module.exports = router;
