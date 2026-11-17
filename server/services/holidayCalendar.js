'use strict';
/**
 * Nepal public-holiday feed for the sales calendar.
 *
 * Boot pulls https://www.officeholidays.com/ics/nepal and caches the raw .ics
 * under server/data. No internet (or the site is down) → the cached copy is
 * parsed instead, so the calendar still plots holidays offline. The feed is
 * only re-fetched when the cache is older than MAX_AGE_MS.
 */
const fs = require('fs');
const path = require('path');

const FEED_URL = 'https://www.officeholidays.com/ics/nepal';
const DATA_DIR = path.join(__dirname, '..', 'data');
const ICS_FILE = path.join(DATA_DIR, 'holidays-nepal.ics');
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12_000;

let cache = [];          // [{ date, end, title, source }]
let lastSync = null;

/** RFC 5545 folding: a leading space/tab continues the previous line. */
function unfold(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
}

const unescapeText = (v) =>
  v.replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();

/** '20260629' | '20260629T031500Z' → 'YYYY-MM-DD' (date part only). */
function icsDate(raw) {
  const m = String(raw).trim().match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

const shiftDay = (iso, days) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
};

/** .ics text → [{ date, end, title }] — end is inclusive. */
function parseICS(text) {
  const out = [];
  let ev = null;
  for (const line of unfold(text).split('\n')) {
    if (line === 'BEGIN:VEVENT') { ev = {}; continue; }
    if (line === 'END:VEVENT') {
      if (ev?.date) {
        // DTEND on an all-day VEVENT is exclusive — step back one day.
        const end = ev.end && ev.end > ev.date ? shiftDay(ev.end, -1) : ev.date;
        out.push({ date: ev.date, end, title: ev.title || 'Holiday', source: 'nepal' });
      }
      ev = null;
      continue;
    }
    if (!ev) continue;
    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const name = line.slice(0, sep).split(';')[0].toUpperCase();
    const value = line.slice(sep + 1);
    if (name === 'DTSTART') ev.date = icsDate(value);
    else if (name === 'DTEND') ev.end = icsDate(value);
    // Feed titles arrive as 'Nepal: Dashain' — the country prefix is noise here.
    else if (name === 'SUMMARY') ev.title = unescapeText(value).replace(/^Nepal:\s*/i, '');
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function readCachedFile() {
  try { return fs.readFileSync(ICS_FILE, 'utf8'); } catch { return null; }
}

function cacheAgeMs() {
  try { return Date.now() - fs.statSync(ICS_FILE).mtimeMs; } catch { return Infinity; }
}

async function download() {
  const res = await fetch(FEED_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'User-Agent': 'MTC-Studio/1.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('not an ics payload');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ICS_FILE, text, 'utf8');
  return text;
}

/**
 * Refresh the in-memory holiday list. Never throws — a failed download falls
 * back to whatever is on disk.
 * @param {boolean} force  ignore the cache age and always hit the network
 */
async function sync({ force = false } = {}) {
  const stale = force || cacheAgeMs() > MAX_AGE_MS;
  let text = stale ? null : readCachedFile();
  let origin = 'cache';

  if (!text) {
    try {
      text = await download();
      origin = 'network';
    } catch (err) {
      text = readCachedFile();
      origin = text ? 'cache (offline)' : 'none';
      if (!text) console.warn(`[holidays] feed unavailable and no cache: ${err.message}`);
    }
  }

  if (text) {
    cache = parseICS(text);
    lastSync = new Date();
  }
  console.log(`[holidays] ${cache.length} Nepal holidays loaded from ${origin}`);
  return cache;
}

/** Holidays overlapping an inclusive 'YYYY-MM-DD' range. */
function getHolidays(from, to) {
  if (!from) return cache;
  const hi = to || from;
  return cache.filter(h => h.end >= from && h.date <= hi);
}

const status = () => ({
  count: cache.length,
  lastSync: lastSync ? lastSync.toISOString() : null,
  file: ICS_FILE,
});

module.exports = { sync, getHolidays, status, parseICS };
