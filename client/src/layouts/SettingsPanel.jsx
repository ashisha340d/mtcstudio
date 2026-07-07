import { useState, useEffect } from 'react';
import {
  getServerSettings, saveServerSettings, clearServerSettings, getApiBase,
} from '../utils/serverConfig';

const ENV_API = import.meta.env.VITE_API_URL || '(same-origin /api)';

/* ── Status dot ─────────────────────────────────────────── */
function Dot({ status }) {
  const col = status === 'ok' ? '#28c840' : status === 'err' ? '#ff5f57' : '#febc2e';
  return (
    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: col, marginRight: 6, verticalAlign: 'middle' }} />
  );
}

const THEME_OPTIONS = [
  { key: 'warm',  label: 'Warm',  swatch: ['#fdf9f4', '#c1440e'] },
  { key: 'light', label: 'Light', swatch: ['#f7f7f8', '#c1440e'] },
  { key: 'dark',  label: 'Dark',  swatch: ['#14120f', '#ff7a3d'] },
  { key: 'slate', label: 'Slate', swatch: ['#f4f6f8', '#2563eb'] },
];

export default function SettingsPanel({ onClose, uiTheme, onThemeChange }) {
  const saved = getServerSettings();

  const [protocol, setProtocol] = useState(saved.protocol || 'http');
  const [host,     setHost]     = useState(saved.host || '');
  const [port,     setPort]     = useState(saved.port || '3001');
  const [testStatus, setTestStatus] = useState(null); // null | 'testing' | 'ok' | 'err'
  const [testMsg,    setTestMsg]    = useState('');
  const [saved_,     setSaved_]     = useState(false);

  const effectiveApi = (() => {
    if (host.trim() && port.trim()) return `${protocol}://${host.trim()}:${port.trim()}/api`;
    return ENV_API;
  })();

  async function testConnection() {
    setTestStatus('testing'); setTestMsg('');
    const base = host.trim() && port.trim()
      ? `${protocol}://${host.trim()}:${port.trim()}/api`
      : getApiBase();
    try {
      const r = await fetch(`${base}/pos/tables`, {
        headers: { 'X-Session-ID': 'dev-session' },
        signal: AbortSignal.timeout(4000),
      });
      if (r.ok) { setTestStatus('ok'); setTestMsg('Connection successful'); }
      else       { setTestStatus('err'); setTestMsg(`Server returned ${r.status}`); }
    } catch (e) {
      setTestStatus('err');
      setTestMsg(e.name === 'TimeoutError' ? 'Timed out (4 s)' : e.message);
    }
  }

  function handleSave() {
    if (host.trim() && port.trim()) {
      saveServerSettings({ protocol, host: host.trim(), port: port.trim() });
    } else {
      clearServerSettings();
    }
    setSaved_(true);
    setTimeout(() => setSaved_(false), 1500);
  }

  function handleReload() {
    handleSave();
    setTimeout(() => window.location.reload(), 200);
  }

  function handleClear() {
    clearServerSettings();
    setHost(''); setPort('3001'); setProtocol('http');
    setSaved_(true); setTimeout(() => setSaved_(false), 1500);
  }

  return (
    <>
      {/* Backdrop */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 9990 }} onClick={onClose} />

      {/* Panel */}
      <div style={{
        position: 'fixed', right: 16, top: 46,
        width: 320, zIndex: 9991,
        background: 'var(--t-surface)',
        border: '1px solid var(--t-border-strong)', borderRadius: 14,
        boxShadow: 'var(--t-shadow-md), 0 1px 0 rgba(255,255,255,0.7) inset',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        maxHeight: 'calc(100vh - 60px)',
      }} onClick={e => e.stopPropagation()}>

        {/* Chrome title bar */}
        <div style={{
          padding: '9px 14px',
          background: 'linear-gradient(180deg, var(--t-chrome-1) 0%, var(--t-chrome-2) 100%)',
          borderBottom: '1px solid var(--t-border-strong)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', gap: 5 }}>
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57', border: '1px solid rgba(0,0,0,0.18)' }} />
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e', border: '1px solid rgba(0,0,0,0.18)' }} />
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840', border: '1px solid rgba(0,0,0,0.18)' }} />
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t-text)', letterSpacing: '0.06em', textTransform: 'uppercase', textShadow: '0 1px 0 rgba(255,255,255,0.45)' }}>
            ⚙ Settings
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t-text-muted)', fontSize: 15, lineHeight: 1, fontWeight: 700, padding: 2 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>

          {/* ── Appearance ─────────────────────────────────── */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--t-text-muted)', marginBottom: 10 }}>
              Appearance
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {THEME_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => onThemeChange?.(opt.key)}
                  title={opt.label}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                    padding: '8px 4px', borderRadius: 9, cursor: 'pointer',
                    border: `1.5px solid ${uiTheme === opt.key ? 'var(--t-accent)' : 'var(--t-border-strong)'}`,
                    background: uiTheme === opt.key ? 'var(--t-accent-soft)' : 'var(--t-surface-2)',
                  }}
                >
                  <span style={{
                    width: 28, height: 20, borderRadius: 5,
                    background: opt.swatch[0],
                    border: '1px solid rgba(0,0,0,0.15)',
                    boxShadow: `inset -10px 0 0 0 ${opt.swatch[1]}`,
                  }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: uiTheme === opt.key ? 'var(--t-accent)' : 'var(--t-text-muted)' }}>
                    {opt.label}
                  </span>
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: 'var(--t-text-muted)', marginTop: 8, lineHeight: 1.4 }}>
              Applies to the dashboard, CRM, File Maintenance and CMS pages. POS is unaffected.
            </div>
          </div>

          {/* ── Current URL info ─────────────────────────── */}
          <div style={{ marginBottom: 16, padding: '9px 12px', background: 'rgba(0,0,0,0.04)', borderRadius: 8, border: '1px solid rgba(160,144,128,0.2)' }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--t-text-muted)', marginBottom: 4 }}>Build-time URL (VITE_API_URL)</div>
            <code style={{ fontSize: 11, color: 'var(--t-text)', wordBreak: 'break-all' }}>{ENV_API}</code>
          </div>

          {/* ── Override fields ───────────────────────────── */}
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--t-text-muted)', marginBottom: 10 }}>
              Runtime Override
            </div>

            {/* Protocol */}
            <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--t-text-muted)', marginBottom: 4 }}>Protocol</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {['http', 'https'].map(p => (
                <button key={p} onClick={() => setProtocol(p)} style={{
                  flex: 1, padding: '7px', borderRadius: 7,
                  border: `1.5px solid ${protocol === p ? 'var(--t-accent)' : 'var(--t-border-strong)'}`,
                  background: protocol === p ? 'var(--t-accent-soft)' : 'var(--t-surface-2)',
                  color: protocol === p ? 'var(--t-accent)' : 'var(--t-text-muted)',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}>{p}</button>
              ))}
            </div>

            {/* Host */}
            <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--t-text-muted)', marginBottom: 4 }}>Server IP / Hostname</label>
            <input
              value={host}
              onChange={e => setHost(e.target.value)}
              placeholder="e.g. 192.168.1.90 or localhost"
              style={{ width: '100%', padding: '8px 11px', borderRadius: 8, border: '1.5px solid var(--t-border-strong)', background: 'var(--t-surface)', color: 'var(--t-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 10 }}
              onFocus={e => e.target.style.borderColor = 'var(--t-accent)'}
              onBlur={e  => e.target.style.borderColor = 'var(--t-border-strong)'}
            />

            {/* Port */}
            <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--t-text-muted)', marginBottom: 4 }}>Port</label>
            <input
              value={port}
              onChange={e => setPort(e.target.value)}
              placeholder="3001"
              type="number"
              style={{ width: '100%', padding: '8px 11px', borderRadius: 8, border: '1.5px solid var(--t-border-strong)', background: 'var(--t-surface)', color: 'var(--t-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 10 }}
              onFocus={e => e.target.style.borderColor = 'var(--t-accent)'}
              onBlur={e  => e.target.style.borderColor = 'var(--t-border-strong)'}
            />

            {/* Effective URL preview */}
            <div style={{ padding: '8px 10px', background: 'var(--t-accent-soft)', borderRadius: 7, border: '1px solid var(--t-accent-soft)', marginBottom: 14 }}>
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--t-text-muted)', marginBottom: 3 }}>Effective API URL</div>
              <code style={{ fontSize: 11, color: 'var(--t-accent)', wordBreak: 'break-all', fontWeight: 700 }}>{effectiveApi}</code>
            </div>

            {/* Test connection */}
            <button onClick={testConnection} disabled={testStatus === 'testing'} style={{
              width: '100%', padding: '8px', borderRadius: 8,
              border: '1px solid var(--t-border-strong)', background: 'var(--t-surface-2)',
              color: 'var(--t-text-muted)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              marginBottom: testStatus ? 8 : 0,
              transition: 'background 0.1s',
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--t-surface-3)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--t-surface-2)'}
            >
              {testStatus === 'testing' ? '⏳ Testing…' : '🔌 Test Connection'}
            </button>

            {testStatus && testStatus !== 'testing' && (
              <div style={{ fontSize: 11, fontWeight: 600, color: testStatus === 'ok' ? '#2d7a2d' : '#c0392b', padding: '4px 2px' }}>
                <Dot status={testStatus} />{testMsg}
              </div>
            )}
          </div>

          {/* ── Clear override ────────────────────────────── */}
          {(saved.host || saved.port) && (
            <button onClick={handleClear} style={{
              width: '100%', padding: '7px', borderRadius: 7, marginTop: 8,
              border: '1px solid rgba(192,57,43,0.3)', background: 'rgba(192,57,43,0.06)',
              color: '#c0392b', fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}>
              ✕ Clear Override (use build-time URL)
            </button>
          )}
        </div>

        {/* Footer actions */}
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--t-border-strong)', display: 'flex', gap: 8, flexShrink: 0, background: 'var(--t-surface-2)' }}>
          <button onClick={handleSave} style={{
            flex: 1, padding: '8px', borderRadius: 8,
            border: '1px solid var(--t-border-strong)', background: 'var(--t-surface-2)',
            color: saved_ ? '#2d7a2d' : 'var(--t-text-muted)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
            transition: 'all 0.15s',
          }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--t-surface-3)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--t-surface-2)'}
          >{saved_ ? '✓ Saved' : '💾 Save'}</button>

          <button onClick={handleReload} style={{
            flex: 2, padding: '8px', borderRadius: 8,
            border: 'none', background: 'var(--t-accent)',
            color: '#fff', fontSize: 11, fontWeight: 800, cursor: 'pointer',
          }}>
            🔄 Save &amp; Reload App
          </button>
        </div>
      </div>
    </>
  );
}
