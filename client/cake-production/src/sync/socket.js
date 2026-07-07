import { io } from 'socket.io-client';
import { getServerUrl } from '../config/serverConfig';

// Mirrors client/src/socket.js's factory/reconnection settings so this app's
// LAN-reachability behavior matches the rest of the fleet (POS/KDS/Waiter).
export function createCakeProductionSocket(token) {
  const base = getServerUrl();
  return io(base, {
    auth: token ? { token } : {},
    query: { role: 'cake_production' },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    transports: ['websocket', 'polling'],
    autoConnect: true,
  });
}
