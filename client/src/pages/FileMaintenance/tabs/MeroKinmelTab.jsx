import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

const DEFAULTS = {
  mk_import_mode:         'DRAFT',
  mk_min_confidence:      '0.6',
  mk_require_total_match: '1',
  mk_require_all_matched: '1',
};

function Toggle({ label, hint, checked, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f0f0f0' }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#222' }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{hint}</div>}
      </div>
      <button
        onClick={() => onChange(checked ? '0' : '1')}
        style={{
          width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
          background: checked ? '#c1440e' : '#ddd', transition: 'background .2s',
          position: 'relative', flexShrink: 0,
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: checked ? 22 : 3,
          width: 18, height: 18, borderRadius: '50%', background: '#fff',
          transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.3)',
        }} />
      </button>
    </div>
  );
}

const inp = {
  width: '100%', padding: '8px 10px', border: '1px solid #ddd',
  borderRadius: 6, fontSize: 13, boxSizing: 'border-box', outline: 'none',
};

export default function MeroKinmelTab() {
  const [cfg, setCfg]       = useState(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [toast, setToast]   = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await API.get('/settings/mero-kinmel');
      setCfg(c => ({ ...c, ...res.data }));
    } catch { flash('Failed to load settings', true); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function flash(msg, err = false) {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 3000);
  }

  function set(key, val) { setCfg(c => ({ ...c, [key]: val })); }
  const tog = (key) => String(cfg[key]) === '1';

  async function save() {
    setSaving(true);
    try {
      await API.post('/settings/mero-kinmel', cfg);
      flash('Saved');
    } catch (e) { flash(e.response?.data?.error || 'Save failed', true); }
    setSaving(false);
  }

  const isOrder = cfg.mk_import_mode === 'ORDER';

  return (
    <div style={{ maxWidth: 620 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
        Mero Kinmel Order — Send To
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
        {['DRAFT', 'ORDER'].map(m => (
          <button
            key={m}
            onClick={() => set('mk_import_mode', m)}
            style={{
              flex: 1, padding: '16px 10px', borderRadius: 8, cursor: 'pointer',
              fontSize: 14, fontWeight: 700, letterSpacing: '0.04em',
              border: cfg.mk_import_mode === m ? '2px solid #c1440e' : '2px solid #e2e2e2',
              background: cfg.mk_import_mode === m ? '#fdf1ec' : '#fff',
              color: cfg.mk_import_mode === m ? '#c1440e' : '#666',
            }}
          >
            {m === 'DRAFT' ? '📝 DRAFT' : '🍳 ORDER'}
            <div style={{ fontSize: 11, fontWeight: 500, marginTop: 4, color: '#999' }}>
              {m === 'DRAFT' ? 'Cashier confirms on POS' : 'Straight to kitchen (KOT)'}
            </div>
          </button>
        ))}
      </div>

      <div style={{ fontSize: 12, color: isOrder ? '#b3261e' : '#888', marginBottom: 18 }}>
        {isOrder
          ? '⚠ Only trustworthy imports become orders. Anything failing the checks below still lands as an MK-REVIEW draft.'
          : 'Every import lands as a draft card on the POS dashboard.'}
      </div>

      <div style={{ fontSize: 11, fontWeight: 800, color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
        Trust Checks
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', marginBottom: 4 }}>
          Minimum Confidence
        </label>
        <input
          type="number" step="0.05" min="0" max="1" style={inp}
          value={cfg.mk_min_confidence}
          onChange={e => set('mk_min_confidence', e.target.value)}
        />
        <div style={{ fontSize: 11, color: '#aaa', marginTop: 3 }}>
          0 – 1. Combined OCR parse + product match score.
        </div>
      </div>

      <Toggle
        label="Slip total must match"
        hint="Computed total (our prices × qty) must equal the printed slip total. Best proof the quantities are right."
        checked={tog('mk_require_total_match')}
        onChange={v => set('mk_require_total_match', v)}
      />
      <Toggle
        label="All items must be matched"
        hint="No unmatched item names allowed."
        checked={tog('mk_require_all_matched')}
        onChange={v => set('mk_require_all_matched', v)}
      />

      <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={save} disabled={saving}
          style={{
            padding: '9px 22px', borderRadius: 6, border: 'none', cursor: 'pointer',
            background: '#c1440e', color: '#fff', fontSize: 13, fontWeight: 700,
            opacity: saving ? 0.6 : 1,
          }}
        >{saving ? 'Saving…' : 'Save'}</button>
        {toast && (
          <span style={{ fontSize: 13, color: toast.err ? '#b3261e' : '#1a7f37' }}>{toast.msg}</span>
        )}
      </div>
    </div>
  );
}
