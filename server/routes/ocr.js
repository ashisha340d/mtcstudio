const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const tesseract = require('node-tesseract-ocr');
const sharp = require('sharp');
const router = express.Router();

const API_TOKEN = 'ABCNEPAL'; // change later

// Tesseract config
const TESSERACT_CONFIG = {
  lang: 'eng',
  oem: 1,
  psm: 6,
  binary: process.env.TESSERACT_BIN || '"D:\\Program Files\\Tesseract-OCR\\tesseract.exe"'
};

// Save uploads
const uploadDir = path.join(__dirname, '../uploads/receipts');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /jpeg|jpg|png/.test(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Only jpg/png allowed'), ok);
  }
});

// --- FIXED TOKEN MIDDLEWARE ---
const checkToken = (req, res, next) => {
  // safe read - req.body exists because upload runs first
  const token = req.headers['x-api-token'] || req.headers['x-api-key'] || req.body?.token;

  // for testing: allow no token, but reject wrong token
  if (token && token !== API_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // to ENFORCE: change to: if (!token || token!== API_TOKEN) return...
  next();
};

function parseReceipt(text) { /* your same parse code - unchanged */
  const items = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/Munch Time|Qty\s+Rate|Amt|Order No|Address|Payment|Sub Total|Total|Date|Order Amount|Receipt/i.test(line)) { i++; continue; }
    const singleLine = line.match(/^([A-Za-z].+?)\s{2,}(\d+)\s+([\d,]+)(?:\s+[\d,]+)?$/);
    if (singleLine) {
      let [_, name, qty, rate] = singleLine;
      name = name.replace(/\s{2,}/g, ' ').replace(/\.{2,}$/, '').trim();
      if (name.length >= 3) items.push({ name, qty: parseInt(qty, 10), rate: parseInt(rate.replace(/[,.]/g, ''), 10) });
      i++; continue;
    }
    if (/^[A-Za-z]/.test(line) && line.length > 3 && !/^\d+$/.test(line)) {
      const name = line.replace(/\.{2,}$/, '').trim();
      const qtyLine = lines[i + 1] || ''; const rateLine = lines[i + 2] || ''; const amtLine = lines[i + 3] || '';
      if (/^\d+$/.test(qtyLine)) {
        const qty = parseInt(qtyLine, 10); let rate = 0;
        if (/^[\d,]+$/.test(rateLine)) rate = parseInt(rateLine.replace(/[,.]/g, ''), 10);
        else if (/^[\d,]+\s+[\d,]+$/.test(rateLine)) rate = parseInt(rateLine.split(/\s+/)[0].replace(/[,.]/g, ''), 10);
        else if (/^[\d,]+$/.test(amtLine)) rate = parseInt(amtLine.replace(/[,.]/g, ''), 10);
        items.push({ name, qty, rate });
        if (/^[\d,]+\s+[\d,]+$/.test(rateLine)) i += 3; else if (/^[\d,]+$/.test(rateLine)) i += 4; else i += 2; continue;
      }
    }
    i++;
  }
  return items;
}

// --- FIXED ROUTE: '/' not '/ocr', and upload BEFORE checkToken ---
router.post('/', upload.single('image'), checkToken, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

  let processedPath = null;
  try {
    console.log('OCR start:', req.file.filename);
    processedPath = req.file.path + '_proc.png';
    await sharp(req.file.path).resize({ width: 1200 }).grayscale().normalize().sharpen({ sigma: 1.5 }).toFile(processedPath);
    const text = await tesseract.recognize(processedPath, TESSERACT_CONFIG);
    console.log('=== FULL OCR TEXT ===\n', text, '\n=== END ===');
    const items = parseReceipt(text);
    if (fs.existsSync(processedPath)) fs.unlinkSync(processedPath);
    res.json({ success: true, filename: req.file.filename, path: req.file.path, size: req.file.size, rawText: text, items });
  } catch (err) {
    console.error('OCR Error:', err);
    if (processedPath && fs.existsSync(processedPath)) fs.unlinkSync(processedPath);
    res.status(500).json({ error: 'Processing failed', details: err.message });
  }
});

module.exports = router;
