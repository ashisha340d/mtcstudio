const ENV_API = import.meta.env.VITE_API_URL || '(same-origin /api)';

const THEME_OPTIONS = [
  { key: 'warm',  label: 'Warm',  swatch: ['#fdf9f4', '#c1440e'] },
  { key: 'light', label: 'Light', swatch: ['#f7f7f8', '#c1440e'] },
  { key: 'dark',  label: 'Dark',  swatch: ['#14120f', '#ff7a3d'] },
  { key: 'slate', label: 'Slate', swatch: ['#f4f6f8', '#2563eb'] },
];

export default function SettingsPanel({ onClose, uiTheme, onThemeChange }) {
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

        </div>
      </div>
    </>
  );
}
