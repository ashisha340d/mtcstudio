'use strict';
// Pluggable OCR: image -> plain text. OCR does NO business logic.
// Default engine = local Tesseract. Set OCR_ENGINE=paddle + PADDLE_OCR_URL to
// forward to a standalone PaddleOCR microservice later (same contract).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const tesseract = require('node-tesseract-ocr');

// Guard against the env injector not having populated process.env yet at load.
const _env = () => process.env || {};
const ENGINE = (_env().OCR_ENGINE || 'tesseract').toLowerCase();
const PADDLE_URL = _env().PADDLE_OCR_URL || '';

const TESSERACT_CONFIG = {
  lang: 'eng',
  oem: 1,
  psm: 6,
  binary: _env().TESSERACT_BIN || '"D:\\Program Files\\Tesseract-OCR\\tesseract.exe"',
};

// Preprocess for cleaner OCR (upscale, grayscale, normalize, sharpen).
async function preprocess(srcPath) {
  const out = srcPath + '_proc.png';
  await sharp(srcPath).resize({ width: 1200 }).grayscale().normalize().sharpen({ sigma: 1.5 }).toFile(out);
  return out;
}

async function tesseractExtract(srcPath) {
  const proc = await preprocess(srcPath);
  try {
    return await tesseract.recognize(proc, TESSERACT_CONFIG);
  } finally {
    if (fs.existsSync(proc)) fs.unlinkSync(proc);
  }
}

// PaddleOCR microservice: POST multipart image, expect { text } or { rawText }.
async function paddleExtract(srcPath) {
  if (!PADDLE_URL) throw new Error('PADDLE_OCR_URL not set');
  const form = new FormData();
  const buf = fs.readFileSync(srcPath);
  form.append('image', new Blob([buf]), path.basename(srcPath));
  const r = await fetch(PADDLE_URL, { method: 'POST', body: form });
  if (!r.ok) throw new Error(`PaddleOCR ${r.status}`);
  const j = await r.json();
  return j.text ?? j.rawText ?? '';
}

// Returns { text, ms }.
async function extractText(srcPath) {
  const t0 = Date.now();
  const text = ENGINE === 'paddle' ? await paddleExtract(srcPath) : await tesseractExtract(srcPath);
  return { text: text || '', ms: Date.now() - t0 };
}

module.exports = { extractText, ENGINE };
