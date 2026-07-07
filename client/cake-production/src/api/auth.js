import { getServerUrl } from '../config/serverConfig';

const KEY = 'cake_prod_session';

export function getSession() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); }
  catch { return null; }
}

function setSession(session) {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(KEY);
}

export async function loginWithPin(pin) {
  const base = getServerUrl();
  const r = await fetch(`${base}/api/auth/pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Login failed');
  setSession({ sessionId: data.sessionId, user: data.user });
  return data;
}

export async function logout() {
  const session = getSession();
  clearSession();
  if (!session) return;
  const base = getServerUrl();
  try {
    await fetch(`${base}/api/auth/logout`, {
      method: 'POST',
      headers: { 'X-Session-ID': session.sessionId },
    });
  } catch { /* best-effort — local session is already cleared */ }
}
