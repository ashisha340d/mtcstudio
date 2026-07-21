'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  Wi-Fi captive portal — request handling.
//
//  Renders one server-side page (no client framework, no external CDN: a guest
//  behind the hotspot cannot reach the Internet yet, so every byte must come
//  from this server), and hands the MikroTik hand-off back to the router.
// ─────────────────────────────────────────────────────────────────────────────
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ejs = require('ejs');

const portalService = require('../services/wifiPortalService');
const analytics = require('../services/wifiAnalyticsService');
const mikrotik = require('../services/wifiMikrotik');

const TEMPLATE = path.join(__dirname, '..', 'templates', 'wifi-portal.ejs');
const ASSET_DIR = path.join(__dirname, '..', 'public', 'wifi');
const HERO_DIR = path.join(__dirname, '..', 'public', 'img', 'carousel');

// ── Static config ────────────────────────────────────────────────────────────
const SITE = process.env.WIFI_SITE_URL || 'https://munchtimecafe.com.np';

const CAFE = {
  name: 'Munch Time Cafe',
  tagline: 'Wood fired. Freshly baked. Always warm.',
  address: 'Sahid Chowk, Narayangarh, Bharatpur, Chitwan',
  phone: '+977 56 595499',
  phoneDial: '+97756595499',
  hours: 'Every day · 8:00 AM – 8:30 PM',
  mapsUrl: 'https://maps.app.goo.gl/',
  site: SITE,
  orderUrl: `${SITE}/menu`,
  cakeUrl: `${SITE}/cakes`,
  social: [
    { key: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/munchtimecafe/' },
    { key: 'facebook',  label: 'Facebook',  url: 'https://www.facebook.com/munchtimecafe' },
    { key: 'tiktok',    label: 'TikTok',    url: 'https://www.tiktok.com/@munchtimecafe' },
    { key: 'whatsapp',  label: 'WhatsApp',  url: 'https://wa.me/97756595499' },
  ],
};

// ── Asset versioning ─────────────────────────────────────────────────────────
// Hash once at boot: assets ship with a 1-year immutable cache, the hash in the
// query string is what busts it on deploy.
const assetVersions = new Map();

function assetVersion(file) {
  if (assetVersions.has(file)) return assetVersions.get(file);
  let v = 'dev';
  try {
    const buf = fs.readFileSync(path.join(ASSET_DIR, file));
    v = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 10);
  } catch { /* asset missing → 'dev' keeps the page rendering */ }
  assetVersions.set(file, v);
  return v;
}

// ── Hero media ───────────────────────────────────────────────────────────────
// Prefer a real video when someone drops one in; otherwise cross-fade the
// existing curated carousel stills (already optimised, already on disk).
const HERO_STILLS = [
  'munch-time-cafe-bharatpur-chef-making-woodfired-pizza.jpg',
  'fresh-daily-patisserie-best-cakes-in-chitwan-bharatpur-munch-time-cafe.jpg',
  'professional-barista-brewing-fresh-espresso-coffee.jpg',
  'munchtime-court.jpg',
];

function heroMedia() {
  const video = ['wifi-hero.mp4', 'hero.mp4'].find(f => fs.existsSync(path.join(HERO_DIR, f)));
  const stills = HERO_STILLS
    .filter(f => fs.existsSync(path.join(HERO_DIR, f)))
    .map(f => `/public/img/carousel/${f}`);
  return {
    video: video ? `/public/img/carousel/${video}` : null,
    stills: stills.length ? stills : ['/public/img/menu-cover.jpg'],
  };
}

// ── Cookies ──────────────────────────────────────────────────────────────────
// One cookie, one purpose. Not worth pulling cookie-parser into the app for it.
const COOKIE = 'mtc_wifi_id';

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return '';
}

function ensureVisitorCookie(req, res) {
  let id = readCookie(req, COOKIE);
  if (!/^[a-f0-9]{32}$/.test(id)) {
    id = crypto.randomBytes(16).toString('hex');
    res.setHeader('Set-Cookie',
      `${COOKIE}=${id}; Path=/wifi; Max-Age=31536000; SameSite=Lax; HttpOnly`);
  }
  return id;
}

// ── Handlers ─────────────────────────────────────────────────────────────────

/** GET /wifi — the whole experience, one document. */
async function renderPortal(req, res, next) {
  try {
    const [snapshot] = await Promise.all([portalService.getSnapshot()]);
    const router = mikrotik.parse(req);
    const cookieId = ensureVisitorCookie(req, res);
    const deviceKey = analytics.deviceKeyFor({ mac: router.mac, cookieId });

    const visit = await analytics.touchVisit({ deviceKey, mac: router.mac });
    analytics.track({ deviceKey, event: 'portal_view', meta: { returning: visit.returning, ip: router.ip } });

    const html = await ejs.renderFile(TEMPLATE, {
      cafe: CAFE,
      data: snapshot,
      hero: heroMedia(),
      router,
      visit,
      deviceKey,
      greeting: greetingFor(new Date()),
      asset: file => `/wifi/assets/${file}?v=${assetVersion(file)}`,
      year: new Date().getFullYear(),
    }, { cache: process.env.NODE_ENV === 'production', filename: TEMPLATE });

    // The portal is per-device (MAC, returning state) and the catalogue moves
    // during the day — never let a proxy or the browser pin an old copy.
    res.set('Cache-Control', 'no-store, must-revalidate');
    res.set('X-Content-Type-Options', 'nosniff');
    res.type('html').send(html);
  } catch (err) {
    next(err);
  }
}

function greetingFor(now) {
  // Nepal runs UTC+05:45 — derive the local hour rather than trusting the host clock.
  const npt = new Date(now.getTime() + (5 * 60 + 45) * 60 * 1000);
  const h = npt.getUTCHours();
  if (h < 11) return 'Good morning';
  if (h < 16) return 'Good afternoon';
  return 'Good evening';
}

/**
 * POST /wifi/connect — the hand-off.
 *
 * Node grants nothing. It renders a self-submitting form that POSTs the guest
 * straight into MikroTik's own login endpoint; the router decides from there.
 */
async function connect(req, res, next) {
  try {
    const router = mikrotik.parse(req);
    const cookieId = readCookie(req, COOKIE);
    const deviceKey = analytics.deviceKeyFor({ mac: router.mac, cookieId });

    analytics.recordConnect(deviceKey);
    analytics.track({ deviceKey, event: 'connect_click', meta: { chap: router.usesChap, ready: router.ready } });

    if (!router.ready) {
      // No login endpoint means this page was opened outside the hotspot flow
      // (direct visit, already authenticated). Send them somewhere useful.
      return res.redirect(302, router.dst);
    }

    res.set('Cache-Control', 'no-store');
    res.type('html').send(handoffPage(router));
  } catch (err) {
    next(err);
  }
}

function escapeAttr(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Deliberately bare: this document is on screen for a few hundred milliseconds
// while the router takes over, and it must work with JS disabled.
function handoffPage(router) {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Connecting…</title>
<style>
html,body{height:100%;margin:0}
body{display:grid;place-items:center;background:#14100e;color:#f4ece4;
  font:500 15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center}
.r{width:34px;height:34px;margin:0 auto 16px;border-radius:50%;
  border:2px solid rgba(244,236,228,.2);border-top-color:#e2703a;animation:s .7s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}
button{margin-top:18px;padding:12px 22px;border:0;border-radius:999px;background:#e2703a;color:#fff;font:inherit}
@media(prefers-reduced-motion:reduce){.r{animation-duration:2s}}
</style></head><body>
<main><div class="r" role="status" aria-label="Connecting to Wi-Fi"></div>
<p>Getting you online…</p>
<form id="f" method="post" action="${escapeAttr(router.loginUrl)}" accept-charset="UTF-8">
  <input type="hidden" name="username" value="${escapeAttr(router.username)}">
  <input type="hidden" name="password" value="${escapeAttr(router.password)}">
  <input type="hidden" name="dst" value="${escapeAttr(router.dst)}">
  <input type="hidden" name="popup" value="false">
  <noscript><button type="submit">Tap to continue</button></noscript>
</form></main>
<script>document.getElementById('f').submit();</script>
</body></html>`;
}

/** POST /wifi/api/event — beacon sink for scroll depth, taps, section reach. */
async function trackEvent(req, res) {
  const { event, section, refId, meta } = req.body || {};
  const router = mikrotik.parse(req);
  const cookieId = readCookie(req, COOKIE);
  analytics.track({
    deviceKey: analytics.deviceKeyFor({ mac: router.mac, cookieId }),
    event, section, refId, meta,
  });
  res.status(204).end();
}

/** GET /wifi/api/summary — roll-up for a future admin card. */
async function summary(req, res, next) {
  try {
    res.json(await analytics.summary(Number(req.query.days) || 7));
  } catch (err) { next(err); }
}

module.exports = { renderPortal, connect, trackEvent, summary, CAFE };
