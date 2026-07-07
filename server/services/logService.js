'use strict';
const fs   = require('fs');
const path = require('path');

const LOGS_DIR  = path.join(__dirname, '..', 'logs');
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB rotation threshold

const FILES = {
  app:     path.join(LOGS_DIR, 'app.log'),
  error:   path.join(LOGS_DIR, 'error.log'),
  crash:   path.join(LOGS_DIR, 'crash.log'),
  printer: path.join(LOGS_DIR, 'printer.log'),
};

function ensureDir() {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function rotate(filePath) {
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > MAX_BYTES) {
      fs.renameSync(filePath, filePath + '.old');
    }
  } catch {}
}

function write(type, level, message, extra = {}) {
  ensureDir();
  const filePath = FILES[type] || FILES.app;
  rotate(filePath);
  const entry = JSON.stringify({
    ts:      new Date().toISOString(),
    level:   level.toUpperCase(),
    message,
    ...extra,
  });
  try { fs.appendFileSync(filePath, entry + '\n'); } catch {}
}

function read(type, lines = 300) {
  const filePath = FILES[type] || FILES.app;
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  return raw.slice(-lines).map(l => {
    try { return JSON.parse(l); } catch { return { ts: '', level: 'RAW', message: l }; }
  }).reverse();
}

function search(type, query) {
  const all = read(type, 2000);
  if (!query) return all;
  const q = query.toLowerCase();
  return all.filter(e => (e.message || '').toLowerCase().includes(q));
}

function clear(type) {
  const filePath = FILES[type] || FILES.app;
  try { fs.writeFileSync(filePath, ''); } catch {}
}

function filePath(type) {
  return FILES[type] || FILES.app;
}

module.exports = { write, read, search, clear, filePath };
