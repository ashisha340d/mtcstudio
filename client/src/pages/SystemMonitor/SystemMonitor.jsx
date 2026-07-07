import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import './SystemMonitor.css';

const API = import.meta.env.VITE_API_URL || '/api';
const api = axios.create({ baseURL: API });
const isElectron = typeof window !== 'undefined' && !!window.api;

function fmt(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function fmtUptime(s) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

function StatusDot({ ok }) {
  return <span className={`sm-dot ${ok ? 'sm-dot--ok' : 'sm-dot--err'}`} />;
}

function StatCard({ label, value, sub }) {
  return (
    <div className="sm-stat">
      <div className="sm-stat__val">{value}</div>
      <div className="sm-stat__label">{label}</div>
      {sub && <div className="sm-stat__sub">{sub}</div>}
    </div>
  );
}

export default function SystemMonitor() {
  const [status,  setStatus]  = useState(null);
  const [devices, setDevices] = useState({ summary: {}, devices: [] });
  const [logs,    setLogs]    = useState([]);
  const [logType, setLogType] = useState('app');
  const [logQ,    setLogQ]    = useState('');
  const [loading, setLoading] = useState(true);
  const [tab,     setTab]     = useState('overview');
  const [action,  setAction]  = useState('');

  const load = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([
        api.get('/system/status'),
        api.get('/system/devices'),
      ]);
      setStatus(s.data);
      setDevices(d.data);
    } catch {}
    setLoading(false);
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const url = logQ
        ? `/system/logs/search?type=${logType}&q=${encodeURIComponent(logQ)}`
        : `/system/logs?type=${logType}&lines=200`;
      const r = await api.get(url);
      setLogs(r.data);
    } catch {}
  }, [logType, logQ]);

  useEffect(() => { load(); const id = setInterval(load, 10000); return () => clearInterval(id); }, [load]);
  useEffect(() => { if (tab === 'logs') loadLogs(); }, [tab, logType, logQ, loadLogs]);

  const doBackup = async () => {
    setAction('backup');
    try {
      await api.post('/system/backup', { type: 'manual' });
      setAction('done');
      setTimeout(() => setAction(''), 2500);
    } catch { setAction(''); }
  };

  const doRestart = async () => {
    if (!confirm('Restart the backend server?')) return;
    setAction('restart');
    try {
      if (isElectron) {
        await window.api.invoke('server:restart');
      } else {
        await api.post('/system/restart');
      }
      setAction('restarted');
      setTimeout(() => { setAction(''); load(); }, 3000);
    } catch { setAction(''); }
  };

  const openFolder = (type) => {
    if (!isElectron) return;
    if (type === 'logs')    window.api.invoke('log:openFolder');
    if (type === 'backups') window.api.invoke('shell:openBackupFolder');
  };

  if (loading) return <div className="sm-loading">Loading system status…</div>;

  const s = status || {};

  return (
    <div className="sm-root">
      {/* ── Tabs ── */}
      <div className="sm-tabs">
        {['overview', 'devices', 'logs'].map(t => (
          <button key={t} className={`sm-tab ${tab === t ? 'sm-tab--active' : ''}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div className="sm-content">
          {/* Status row */}
          <div className="sm-section-label">Service Status</div>
          <div className="sm-status-row">
            <div className="sm-status-item"><StatusDot ok={s.backend} /><span>Backend</span></div>
            <div className="sm-status-item"><StatusDot ok={s.socket}  /><span>Socket.IO</span></div>
            <div className="sm-status-item"><StatusDot ok={s.mariadb} /><span>MariaDB</span></div>
          </div>

          {/* Stats grid */}
          <div className="sm-section-label">System</div>
          <div className="sm-stats-grid">
            <StatCard label="Uptime"     value={fmtUptime(s.uptime || 0)} />
            <StatCard label="Memory"     value={`${s.memory?.usedPct || 0}%`} sub={`${s.memory?.usedMB || 0} / ${s.memory?.totalMB || 0} MB`} />
            <StatCard label="CPU"        value={s.cpu?.count ? `${s.cpu.count} cores` : '—'} sub={s.cpu?.model?.slice(0, 24)} />
            <StatCard label="DB Size"    value={fmt(s.dbSizeBytes)} />
            <StatCard label="Node"       value={s.node || '—'} />
            <StatCard label="Version"    value={`v${s.version || '?'}`} />
          </div>

          {/* Connected devices summary */}
          <div className="sm-section-label">Connected Devices</div>
          <div className="sm-stats-grid">
            <StatCard label="Total"   value={devices.summary?.total  || 0} />
            <StatCard label="POS"     value={devices.summary?.pos    || 0} />
            <StatCard label="Waiters" value={devices.summary?.waiter || 0} />
            <StatCard label="KDS"     value={devices.summary?.kds    || 0} />
          </div>

          {/* Actions */}
          <div className="sm-section-label">Actions</div>
          <div className="sm-actions">
            <button className="sm-action-btn sm-action-btn--primary" onClick={doBackup} disabled={!!action}>
              {action === 'backup' ? 'Backing up…' : action === 'done' ? '✓ Done' : '💾 Backup'}
            </button>
            <button className="sm-action-btn sm-action-btn--warn" onClick={doRestart} disabled={!!action}>
              {action === 'restart' ? 'Restarting…' : action === 'restarted' ? '✓ Restarted' : '↺ Restart Server'}
            </button>
            <button className="sm-action-btn" onClick={load}>⟳ Refresh</button>
            {isElectron && (
              <>
                <button className="sm-action-btn" onClick={() => openFolder('logs')}>📋 Logs Folder</button>
                <button className="sm-action-btn" onClick={() => openFolder('backups')}>📦 Backups Folder</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Devices ── */}
      {tab === 'devices' && (
        <div className="sm-content">
          <div className="sm-section-label">Active Connections ({devices.devices?.length || 0})</div>
          {devices.devices?.length === 0
            ? <div className="sm-empty">No devices connected</div>
            : (
              <table className="sm-table">
                <thead><tr><th>Type</th><th>IP</th><th>Connected</th><th>Last Seen</th></tr></thead>
                <tbody>
                  {devices.devices.map(d => (
                    <tr key={d.socketId}>
                      <td><span className={`sm-type-badge sm-type-badge--${d.type}`}>{d.type}</span></td>
                      <td className="sm-mono">{d.ip?.replace('::ffff:', '')}</td>
                      <td className="sm-mono">{d.connectedAt ? new Date(d.connectedAt).toLocaleTimeString() : '—'}</td>
                      <td className="sm-mono">{d.lastSeen    ? new Date(d.lastSeen).toLocaleTimeString()    : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </div>
      )}

      {/* ── Logs ── */}
      {tab === 'logs' && (
        <div className="sm-content">
          <div className="sm-log-toolbar">
            <select className="sm-select" value={logType} onChange={e => setLogType(e.target.value)}>
              <option value="app">App</option>
              <option value="error">Error</option>
              <option value="crash">Crash</option>
              <option value="printer">Printer</option>
            </select>
            <input className="sm-search" placeholder="Search…" value={logQ} onChange={e => setLogQ(e.target.value)} />
            <button className="sm-action-btn" onClick={loadLogs}>⟳</button>
          </div>
          <div className="sm-log-list">
            {logs.length === 0
              ? <div className="sm-empty">No log entries</div>
              : logs.map((e, i) => (
                <div key={i} className={`sm-log-row sm-log-row--${(e.level || 'info').toLowerCase()}`}>
                  <span className="sm-log-ts">{e.ts ? new Date(e.ts).toLocaleTimeString() : ''}</span>
                  <span className="sm-log-level">{e.level || 'INFO'}</span>
                  <span className="sm-log-msg">{e.message}</span>
                </div>
              ))
            }
          </div>
        </div>
      )}
    </div>
  );
}
