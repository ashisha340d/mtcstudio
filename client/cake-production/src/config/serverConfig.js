const KEY = 'cake_prod_server_url';

// The bakery's POS server LAN address can change (DHCP, new hardware), so it's
// captured once per device at first run rather than baked into the build.
// When the app is served from the POS server itself (the recommended /cake-app
// deployment), same-origin is used automatically and no prompt is needed.
export function getServerUrl() {
  const stored = localStorage.getItem(KEY);
  if (stored) return stored;

  // Same-origin deployment (served at <pos-server>/cake-app) — this is the
  // default, recommended setup, so skip prompting whenever possible.
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/cake-app')) {
    return window.location.origin;
  }
  return null;
}

export function setServerUrl(url) {
  const trimmed = url.trim().replace(/\/+$/, '');
  localStorage.setItem(KEY, trimmed);
  return trimmed;
}

export function clearServerUrl() {
  localStorage.removeItem(KEY);
}
