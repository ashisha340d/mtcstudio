import { io } from 'socket.io-client';

// When VITE_API_URL is set (e.g. direct IP), strip /api suffix to get the socket origin.
// When it is empty, use same origin so Vite's /socket.io proxy handles the WebSocket
// upgrade — this makes Socket.IO work from any remote device (waiter phones, KDS tablets)
// that can reach the Vite server on port 5173 without needing port 3001 open directly.
const SOCKET_URL = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace('/api', '')
  : (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');

// Create a socket factory so POS and KDS can connect with different roles/stations
export function createSocket({ role = 'pos', station = null, token = null } = {}) {
  const query = { role };
  if (station) query.station = station;
  if (token) query.token = token;

  return io(SOCKET_URL, {
    auth: token ? { token } : {},
    query,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    transports: ['websocket', 'polling'],
    autoConnect: true,
  });
}
