'use strict';
const fs   = require('fs');
const path = require('path');

const DB_PATH      = path.join(__dirname, '..', 'database', 'mtcstudio.db');
const UPLOADS_DIR  = path.join(__dirname, '..', 'uploads');
const BACKUPS_ROOT = path.join(__dirname, '..', 'backups');

const DIRS = {
  manual:  path.join(BACKUPS_ROOT, 'manual'),
  daily:   path.join(BACKUPS_ROOT, 'daily'),
  weekly:  path.join(BACKUPS_ROOT, 'weekly'),
};

function ensureDirs() {
  Object.values(DIRS).forEach(d => fs.mkdirSync(d, { recursive: true }));
}

function isoStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function backup(type = 'manual') {
  ensureDirs();
  const dir  = DIRS[type] ?? DIRS.manual;
  const name = `backup-${isoStamp()}`;
  const dest = path.join(dir, name);
  fs.mkdirSync(dest, { recursive: true });

  // Copy database
  fs.copyFileSync(DB_PATH, path.join(dest, 'mtcstudio.db'));

  // Copy uploads (skip very large files > 50 MB to keep backups lean)
  const uploadsOut = path.join(dest, 'uploads');
  fs.mkdirSync(uploadsOut, { recursive: true });
  if (fs.existsSync(UPLOADS_DIR)) {
    for (const f of fs.readdirSync(UPLOADS_DIR, { withFileTypes: true })) {
      if (!f.isFile()) continue;
      const src = path.join(UPLOADS_DIR, f.name);
      if (fs.statSync(src).size > 52428800) continue;
      fs.copyFileSync(src, path.join(uploadsOut, f.name));
    }
  }

  const meta = {
    type,
    createdAt: new Date().toISOString(),
    dbSizeBytes: fs.statSync(path.join(dest, 'mtcstudio.db')).size,
    dir: dest,
  };
  fs.writeFileSync(path.join(dest, 'meta.json'), JSON.stringify(meta, null, 2));
  return meta;
}

function list() {
  ensureDirs();
  const results = [];
  for (const [type, dir] of Object.entries(DIRS)) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const metaPath = path.join(dir, entry.name, 'meta.json');
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        results.push({ ...meta, name: entry.name, category: type });
      } catch {
        results.push({ name: entry.name, category: type, dir: path.join(dir, entry.name) });
      }
    }
  }
  return results.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

function restore(backupDir) {
  if (!fs.existsSync(backupDir)) throw new Error('Backup not found: ' + backupDir);
  const srcDb  = path.join(backupDir, 'mtcstudio.db');
  if (!fs.existsSync(srcDb)) throw new Error('No database file in backup');

  // Pre-restore snapshot
  const snap = DB_PATH + '.pre-restore';
  fs.copyFileSync(DB_PATH, snap);

  fs.copyFileSync(srcDb, DB_PATH);

  const srcUploads = path.join(backupDir, 'uploads');
  if (fs.existsSync(srcUploads)) {
    for (const f of fs.readdirSync(srcUploads)) {
      fs.copyFileSync(path.join(srcUploads, f), path.join(UPLOADS_DIR, f));
    }
  }
  return { ok: true, restoredFrom: backupDir };
}

function cleanup(retentionDays = 30) {
  const cutoff = Date.now() - retentionDays * 86400000;
  let removed = 0;
  for (const dir of [DIRS.daily, DIRS.weekly]) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs < cutoff) {
          fs.rmSync(full, { recursive: true, force: true });
          removed++;
        }
      } catch {}
    }
  }
  return { removed };
}

module.exports = { backup, list, restore, cleanup };
