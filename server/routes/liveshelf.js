const express = require('express');
const router  = express.Router();
const { dbAll, dbRun } = require('../pos/db');
const { syncLiveShelf, syncSchedule } = require('../services/liveShelfSync');
const scheduleSvc = require('../services/liveStoreScheduleService');
const { getNepalDayBoundsUTC } = require('../utils/nepalDateTime');

// ── Helper: format a variant row into the shape LiveShelf expects ─
function formatVariant(r) {
  const stock    = r.stock    ?? 0;
  const kotSold  = r.kot_sold ?? 0;
  const available = Math.max(0, stock - kotSold);
  const variantSuffix = r.variant_name && r.variant_name !== 'Regular' ? ` – ${r.variant_name}` : '';
  return {
    id:           r.id,
    variant_id:   r.id,
    product_id:   r.product_id,
    category:     r.category || 'Uncategorized',
    name:         (r.product_name || '') + variantSuffix,
    variant_name: r.variant_name,
    price:        r.price ?? 0,
    stock,                          // beginning inventory (editable)
    kot_sold:     kotSold,          // punched today, read-only
    available,                      // what goes to website, read-only
    status:       available === 0 ? 'sold_out' : available <= 3 ? 'low_stock' : 'available',
    image:        r.image || '',
    image_id:     r.image_id ?? null,
    notes:        r.notes || '',
    sort_order:   r.sort_order ?? 0,
    sync_status:  r.sync_status ?? 0,
  };
}

function buildStorefrontSQL(start, end) {
  return `
    SELECT
      v.id,
      v.stock,
      v.selling_price AS price,
      v.sync_status,
      v.name         AS variant_name,
      v.sort_order,
      p.id           AS product_id,
      p.name         AS product_name,
      p.storefront_category AS category,
      p.short_description   AS notes,
      v.image_id,
      COALESCE(
        (SELECT ml.filename FROM media_library ml WHERE ml.id = v.image_id LIMIT 1),
        (SELECT ml.filename FROM product_images pi JOIN media_library ml ON ml.id = pi.media_id WHERE pi.product_id = p.id AND pi.is_primary = 1 LIMIT 1)
      ) AS image,
      COALESCE((
        SELECT SUM(ki.quantity)
        FROM   pos_kot_items ki
        JOIN   pos_kots k ON k.id = ki.kot_id
        JOIN   pos_orders o ON o.id = k.order_id
        WHERE  ki.variant_id = v.id
          AND  ki.status  != 'CANCELLED'
          AND  k.status   != 'CANCELLED'
          AND  o.status   != 'SAVED'
          AND  k.created_at >= '${start}'
          AND  k.created_at <  '${end}'
      ), 0) AS kot_sold
    FROM   product_variants v
    JOIN   products p ON p.id = v.product_id
    WHERE  v.show_online = 1
      AND  v.status  = 'active'
      AND  p.status  = 'active'
  `;
}

// GET /api/liveshelf — all show_online variants with today's KOT sold computed
router.get('/', async (req, res) => {
  try {
    const { search, category } = req.query;
    const { start, end } = getNepalDayBoundsUTC();
    let sql = buildStorefrontSQL(start, end);
    const params = [];
    if (search) {
      sql += ` AND (p.name LIKE ? OR v.name LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }
    if (category) {
      sql += ` AND p.storefront_category = ?`;
      params.push(category);
    }
    sql += ` ORDER BY p.storefront_category, p.sort_order, v.sort_order`;

    const rows  = await dbAll(sql, params);
    const items = rows.map(formatVariant);
    const cats  = [...new Set(items.map(i => i.category).filter(Boolean))].sort();
    res.json({ items, categories: cats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/liveshelf/public — same, for external consumption
router.get('/public', async (req, res) => {
  try {
    const { start, end } = getNepalDayBoundsUTC();
    const sql  = buildStorefrontSQL(start, end) + ` ORDER BY p.storefront_category, p.sort_order, v.sort_order`;
    const rows = await dbAll(sql, []);
    res.json(rows.map(formatVariant));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Live Shelf sync ───────────────────────────────────────────
router.post('/sync', async (req, res) => {
  try {
    const result = await syncLiveShelf();
    res.json({ success: true, synced: result.synced, deleted: result.deleted_remote ?? 0 });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── Store Schedule ────────────────────────────────────────────
router.get('/schedule', async (req, res) => {
  try {
    res.json(await scheduleSvc.getSchedule());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/schedule', async (req, res) => {
  try {
    const { days } = req.body;
    if (!Array.isArray(days) || days.length === 0)
      return res.status(400).json({ error: 'days array required' });
    await scheduleSvc.saveSchedule(days);
    res.json({ success: true, days: await scheduleSvc.getSchedule() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/schedule/sync', async (req, res) => {
  try {
    const result = await syncSchedule();
    res.json({ success: true, synced: result.synced });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// POST /api/liveshelf/reorder — bulk-update sort_order for drag-drop
router.post('/reorder', async (req, res) => {
  try {
    const { order } = req.body; // [{ id, sort_order }, ...]
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
    for (const { id, sort_order } of order) {
      await dbRun(`UPDATE product_variants SET sort_order = ?, sync_status = 0 WHERE id = ?`, [sort_order, id]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/liveshelf/:id — update stock, notes, and/or image on a variant
router.put('/:id', async (req, res) => {
  try {
    const { quantity, stock, notes, product_id, image_id } = req.body;
    const newStock = parseInt(quantity ?? stock ?? 0);

    if (image_id !== undefined) {
      await dbRun(
        `UPDATE product_variants SET stock = ?, image_id = ?, sync_status = 0 WHERE id = ?`, [newStock, image_id || null, req.params.id]
      );
    } else {
      await dbRun(
        `UPDATE product_variants SET stock = ?, sync_status = 0 WHERE id = ?`, [newStock, req.params.id]
      );
    }

    if (notes !== undefined && product_id) {
      await dbRun(`UPDATE products SET short_description = ? WHERE id = ?`, [notes || null, product_id]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/liveshelf/:id — remove from storefront (set show_online=0)
router.delete('/:id', async (req, res) => {
  try {
    await dbRun(`UPDATE product_variants SET show_online = 0 WHERE id = ?`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
