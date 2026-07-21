'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  MikroTik Hotspot integration helpers.
//
//  The router's own login.html is expected to bounce the client here, forwarding
//  its template variables as query params, e.g.
//
//    <meta http-equiv="refresh" content="0; url=http://<studio-ip>:3001/wifi
//      ?link-login-only=$(link-login-only)&link-orig=$(link-orig)&mac=$(mac)
//      &ip=$(ip)&username=$(username)&error=$(error)
//      &chap-id=$(chap-id)&chap-challenge=$(chap-challenge)&server-name=$(server-name)">
//
//  Node never authenticates anybody. It only re-packages those params into the
//  POST that MikroTik itself expects, so the router stays the single authority
//  on network access.
// ─────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');

// MikroTik sends the same value under a few different spellings depending on
// whether it came straight from a $(…) substitution or through a proxy/rewrite.
const ALIASES = {
  loginUrl:  ['link-login-only', 'link_login_only', 'linkloginonly', 'loginurl', 'login_url', 'link-login', 'link_login'],
  origUrl:   ['link-orig', 'link_orig', 'linkorig', 'dst', 'destination', 'orig_url'],
  mac:       ['mac', 'client-mac', 'client_mac', 'mac-address', 'mac_address'],
  ip:        ['ip', 'client-ip', 'client_ip', 'ip-address', 'ip_address'],
  username:  ['username', 'user'],
  error:     ['error', 'error-orig', 'message'],
  chapId:    ['chap-id', 'chap_id', 'chapid'],
  chapChal:  ['chap-challenge', 'chap_challenge', 'chapchallenge'],
  serverName:['server-name', 'server_name', 'servername', 'hotspot'],
  identity:  ['identity'],
};

function pick(query, keys) {
  for (const k of keys) {
    const v = query[k];
    if (typeof v === 'string' && v.trim() && !v.startsWith('$(')) return v.trim();
  }
  return '';
}

// Only ever hand the browser an http(s) URL we were actually given — never let a
// crafted ?link-login-only=javascript:… ride through into the form action.
function safeUrl(raw) {
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
  } catch { return ''; }
}

const MAC_RE = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;
const HEX_RE = /^[0-9A-Fa-f]+$/;

function normalizeMac(mac) {
  const m = String(mac || '').replace(/-/g, ':').toUpperCase();
  return MAC_RE.test(m) ? m : '';
}

// CHAP: MikroTik's own login page computes md5(id + password + challenge) in
// JavaScript. Doing it here instead means the client ships zero crypto code and
// the shared guest password never appears in the page source.
function chapPassword(chapId, chapChallenge, plainPassword) {
  if (!chapId || !HEX_RE.test(chapChallenge)) return null;
  const idByte = Buffer.from(chapId, 'hex');
  const challenge = Buffer.from(chapChallenge, 'hex');
  return crypto
    .createHash('md5')
    .update(Buffer.concat([idByte, Buffer.from(plainPassword, 'utf8'), challenge]))
    .digest('hex');
}

// Where to send the browser when MikroTik gave us no link-login-only. The router
// is the client's gateway, so http://<gateway>/login is the reliable guess; the
// env override exists for setups with a hotspot DNS name.
function fallbackLoginUrl(req) {
  const configured = safeUrl(process.env.WIFI_FALLBACK_LOGIN_URL);
  if (configured) return configured;
  const host = String(process.env.WIFI_HOTSPOT_HOST || '').trim();
  return host ? `http://${host}/login` : '';
}

/**
 * Read every MikroTik parameter out of a request (query string first, then the
 * POST body) and derive everything the portal needs to grant Internet access.
 */
function parse(req) {
  const src = { ...(req.body || {}), ...(req.query || {}) };

  const loginUrl = safeUrl(pick(src, ALIASES.loginUrl)) || fallbackLoginUrl(req);
  const origUrl = safeUrl(pick(src, ALIASES.origUrl));
  const chapId = pick(src, ALIASES.chapId);
  const chapChal = pick(src, ALIASES.chapChal);

  const mac = normalizeMac(pick(src, ALIASES.mac));
  const username = pick(src, ALIASES.username) || process.env.WIFI_HOTSPOT_USER || 'guest';
  const plainPassword = process.env.WIFI_HOTSPOT_PASSWORD || '';
  const chap = chapPassword(chapId, chapChal, plainPassword);

  return {
    loginUrl,
    origUrl,
    // Landing target after MikroTik grants access: whatever the customer was
    // originally opening, else the café site so the session ends somewhere useful.
    dst: origUrl || process.env.WIFI_AFTER_LOGIN_URL || 'https://munchtimecafe.com.np',
    mac: mac,
    maskedMac: maskMac(mac),
    ip: pick(src, ALIASES.ip).slice(0, 45),
    username,
    password: chap || plainPassword,
    usesChap: Boolean(chap),
    error: pick(src, ALIASES.error).slice(0, 200),
    serverName: pick(src, ALIASES.serverName).slice(0, 64),
    // True when the router actually handed us a login endpoint. When false the
    // portal degrades to "you're already online" instead of posting into a void.
    ready: Boolean(loginUrl),
  };
}

// Masked form for display + logging — full MACs are personal data, the OUI-free
// tail is enough for a returning-guest greeting.
function maskMac(mac) {
  return mac ? `••:••:••:${mac.slice(9)}` : '';
}

module.exports = { parse, maskMac, normalizeMac, chapPassword, safeUrl };
