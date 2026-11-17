'use strict';
// WhatsApp/OCR image imports (Mero Kinmel). Android uploads the image here;
// the pipeline runs OCR + parse + product resolve + DRAFT creation server-side.
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { dbAll, dbGet } = require('../../pos/db');
const { requireSession } = require('../../middleware/posAuth');
const pipeline = require('../../services/ocr/importPipeline');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'whatsapp');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname) || '.jpg'}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /jpe?g|png|webp/i.test(path.extname(file.originalname));
    cb(ok ? null : new Error('Only jpg/png/webp allowed'), ok);
  },
});

router.use(requireSession);

// POST /api/companion/ocr-import — multipart image + metadata → DRAFT order.
router.post('/ocr-import', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  try {
    const result = await pipeline.process({
      imagePath: req.file.path,
      filename: req.file.filename,
      source: req.body.source || 'WhatsApp Business',
      platform: req.body.platform || 'Mero Kinmel',
      notificationTs: req.body.notificationTs || null,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[ocr-import] failed:', err);
    res.status(500).json({ error: 'Import failed', details: err.message });
  }
});

router.post('/foodmandu-import', async (req, res) => {
  const rawText = req.body.rawText;
  if (typeof rawText !== 'string' || !rawText.trim()) return res.status(400).json({ error: 'No order text uploaded' });
  try {
    const result = await pipeline.process({
      rawText,
      source: 'Foodmandu Restro',
      platform: 'Foodmandu',
      notificationTs: req.body.notificationTs || null,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[foodmandu-import] failed:', err);
    res.status(500).json({ error: 'Import failed', details: err.message });
  }
});

// GET /api/companion/imports — recent imports (POS monitor / debugging).
router.get('/imports', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = await dbAll(
    `SELECT id, source, platform, image_filename, notification_ts, ocr_ms,
            parser_confidence, status, scheduled_order_id, error, created_at
       FROM pos_ocr_imports ORDER BY id DESC LIMIT ?`, [limit]);
  res.json(rows);
});

// GET /api/companion/imports/:id — full row incl. raw text + parsed json.
router.get('/imports/:id', async (req, res) => {
  const row = await dbGet(`SELECT * FROM pos_ocr_imports WHERE id = ?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

module.exports = router;
