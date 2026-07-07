import { useConnection } from '../hooks';

// Two independent indicators, matching the spec's two-channel architecture:
// LAN (production sync, via the Socket.IO connection) and Internet (photo
// uploads, via navigator.onLine) — never conflated into one status.
export default function ConnectionBadge() {
  const { lan, internet } = useConnection();
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <span className={`cp-badge ${lan ? 'cp-badge--ok' : 'cp-badge--off'}`} title="Local bakery network (production sync)">
        <span className="cp-dot" /> LAN
      </span>
      <span className={`cp-badge ${internet ? 'cp-badge--ok' : 'cp-badge--off'}`} title="Internet (photo uploads)">
        <span className="cp-dot" /> NET
      </span>
    </div>
  );
}
