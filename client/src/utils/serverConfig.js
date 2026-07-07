/**
 * Runtime server configuration.
 *
 * Priority:  localStorage override  →  VITE_API_URL env var  →  '/api' (same-origin proxy)
 *
 * Keys stored in localStorage:
 *   mtc_srv_protocol  — 'http' | 'https'
 *   mtc_srv_host      — hostname or IP  (e.g. '192.168.1.90')
 *   mtc_srv_port      — port number     (e.g. '3001')
 */

const LS = {
  PROTOCOL: 'mtc_srv_protocol',
  HOST:     'mtc_srv_host',
  PORT:     'mtc_srv_port',
};

function read(key) {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}

function buildUrl(protocol, host, port) {
  if (!host || !port) return null;
  return `${protocol || 'http'}://${host}:${port}`;
}

/** Effective base URL (no trailing slash). */
export function getServerBase() {
  const host = read(LS.HOST);
  const port = read(LS.PORT);
  const prot = read(LS.PROTOCOL) || 'http';
  const override = buildUrl(prot, host, port);
  if (override) return override;
  // Remove trailing /api from VITE_API_URL if present so callers can append their own path
  const env = import.meta.env.VITE_API_URL || '';
  return env.replace(/\/api\/?$/, '') || '';
}

/** Full API base — append resource paths to this. */
export function getApiBase() {
  const base = getServerBase();
  return base ? `${base}/api` : '/api';
}

/** Saved settings as object. */
export function getServerSettings() {
  return {
    protocol: read(LS.PROTOCOL) || 'http',
    host:     read(LS.HOST),
    port:     read(LS.PORT),
  };
}

/** Persist settings (does NOT reload — caller decides). */
export function saveServerSettings({ protocol, host, port }) {
  try {
    localStorage.setItem(LS.PROTOCOL, protocol || 'http');
    localStorage.setItem(LS.HOST,     (host || '').trim());
    localStorage.setItem(LS.PORT,     (port || '').trim());
  } catch { /* ignore */ }
}

/** Clear any override (revert to VITE_API_URL / same-origin proxy). */
export function clearServerSettings() {
  try {
    localStorage.removeItem(LS.PROTOCOL);
    localStorage.removeItem(LS.HOST);
    localStorage.removeItem(LS.PORT);
  } catch { /* ignore */ }
}
