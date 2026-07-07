'use strict';
const express = require('express');
const os      = require('os');
const path    = require('path');
const fs      = require('fs');
const tracker = require('../services/deviceTracker');
const backup  = require('../services/backupService');
const logger  = require('../services/logService');
const router  = express.Router();

const DB_PATH = path.join(__dirname, '..', 'database', 'mtcstudio.db');

function dbSize() {
  try { return fs.statSync(DB_PATH).size; } catch { return 0; }
}

function memoryInfo() {
  const total = os.totalmem();
  const free  = os.freemem();
  const used  = total - free;
  return {
    totalMB:  Math.round(total / 1048576),
    usedMB:   Math.round(used  / 1048576),
    freeMB:   Math.round(free  / 1048576),
    usedPct:  Math.round((used / total) * 100),
  };
}

function cpuInfo() {
  const cpus = os.cpus();
  return {
    count: cpus.length,
    model: (cpus[0] || {}).model || 'Unknown',
  };
}

// GET /api/system/status
router.get('/status', async (req, res) => {
  const { dbGet } = req.app.locals.db;
  let dbOk = false;
  try {
    await dbGet('SELECT 1', []);
    dbOk = true;
  } catch {}

  const io = req.app.locals.io;
  const socketOk = !!(io && io.engine);

  res.json({
    backend:  true,
    socket:   socketOk,
    mariadb:  dbOk,
    uptime:   Math.floor(process.uptime()),
    memory:   memoryInfo(),
    cpu:      cpuInfo(),
    dbSizeBytes: dbSize(),
    version:  require('../package.json').version,
    node:     process.version,
    platform: process.platform,
  });
});

// GET /api/system/devices
router.get('/devices', (_req, res) => {
  res.json({
    summary: tracker.getSummary(),
    devices: tracker.getAll(),
  });
});

// POST /api/system/backup  { type: 'manual'|'daily'|'weekly' }
router.post('/backup', (req, res) => {
  try {
    const meta = backup.backup(req.body?.type || 'manual');
    res.json({ ok: true, ...meta });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/system/backups
router.get('/backups', (_req, res) => {
  res.json(backup.list());
});

// POST /api/system/restore  { dir: '<absolute-backup-dir>' }
router.post('/restore', (req, res) => {
  try {
    const result = backup.restore(req.body?.dir);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/system/backups/cleanup?days=30
router.delete('/backups/cleanup', (req, res) => {
  const days = parseInt(req.query.days, 10) || 30;
  res.json(backup.cleanup(days));
});

// GET /api/system/logs?type=app&lines=300
router.get('/logs', (req, res) => {
  const type  = req.query.type  || 'app';
  const lines = parseInt(req.query.lines, 10) || 300;
  res.json(logger.read(type, lines));
});

// GET /api/system/logs/search?type=app&q=error
router.get('/logs/search', (req, res) => {
  res.json(logger.search(req.query.type || 'app', req.query.q || ''));
});

// DELETE /api/system/logs?type=app
router.delete('/logs', (req, res) => {
  logger.clear(req.query.type || 'app');
  res.json({ ok: true });
});

// ── System actions ────────────────────────────────────────────

// POST /api/system/restart  — graceful server restart (Electron handles the process)
router.post('/restart', (_req, res) => {
  res.json({ ok: true, message: 'Restart signal sent' });
  setTimeout(() => process.exit(0), 300);
});

// GET /api/system/info
router.get('/info', (_req, res) => {
  let version = '?';
  try { version = require('../package.json').version; } catch {}
  res.json({
    version,
    node:        process.version,
    platform:    process.platform,
    arch:        os.arch(),
    hostname:    os.hostname(),
    uptime:      Math.floor(process.uptime()),
    dbSizeBytes: dbSize(),
  });
});

module.exports = router;
