import { getServerUrl } from '../config/serverConfig';
import { getSession } from './auth';

// Thin fetch wrapper: resolves the POS server base URL + attaches the
// X-Session-ID header, same auth convention the POS/Waiter clients use.
export async function apiFetch(path, options = {}) {
  const base = getServerUrl();
  if (!base) throw new Error('Server address not configured');
  const session = getSession();

  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (session?.sessionId) headers['X-Session-ID'] = session.sessionId;

  const res = await fetch(`${base}${path}`, { ...options, headers });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  return res;
}

export async function apiJson(path, options = {}) {
  const res = await apiFetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
