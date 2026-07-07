import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

const DEFAULTS = {
  cake_slip_shop_name:        '',
  cake_slip_header_line:      'CAKE PRODUCTION ORDER',
  cake_slip_footer:           '',
  cake_slip_show_phone:       '1',
  cake_slip_show_flavour:     '1',
  cake_slip_show_size:        '1',
  cake_slip_show_qty:         '1',
  cake_slip_show_cream:       '1',
  cake_slip_show_sponge:      '1',
  cake_slip_show_shape:       '1',
  cake_slip_show_theme:       '1',
  cake_slip_show_message:     '1',
  cake_slip_show_accessories: '1',
  cake_slip_show_allergies:   '1',
  cake_slip_show_notes:       '1',
  cake_slip_show_status:      '1',
  cake_slip_show_qr:          '1',
  cake_slip_show_pricing:     '1',
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

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', marginBottom: 4 }}>
        {label}
      </label>
      {children}
      {hint && <div style={{ fontSize: 11, color: '#aaa', marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

const inp = {
  width: '100%', padding: '8px 10px', border: '1px solid #ddd',
  borderRadius: 6, fontSize: 13, boxSizing: 'border-box', outline: 'none',
};

const sectionHead = {
  fontSize: 11, fontWeight: 800, color: '#888', textTransform: 'uppercase',
  letterSpacing: '0.08em', marginBottom: 6, marginTop: 4,
};

export default function CakeSlipTab() {
  const [cfg,        setCfg]       = useState(DEFAULTS);
  const [saving,     setSaving]    = useState(false);
  const [toast,      setToast]     = useState(null);
  const [paperWidth, setPaperWidth] = useState(80);   // loaded from global printer_config

  const load = useCallback(async () => {
    try {
      const [slipRes, printerRes] = await Promise.all([
        API.get('/settings/cake-slip'),
        API.get('/settings/printer'),
      ]);
      setCfg(c => ({ ...c, ...slipRes.data }));
      setPaperWidth(Number(printerRes.data.paper_width) || 80);
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
      await API.post('/settings/cake-slip', cfg);
      flash('Cake slip settings saved ✓');
    } catch { flash('Save failed', true); }
    finally { setSaving(false); }
  }

  // ── Live slip preview — simulates actual ESC/POS monospace output ──
  function previewHTML() {
    const is80     = paperWidth >= 80;
    const W        = is80 ? 48 : 32;
    const pxW      = is80 ? 80 * 3.78 : 58 * 3.78;
    const shopName = cfg.cake_slip_shop_name?.trim();
    const hdrLine  = cfg.cake_slip_header_line?.trim() || 'CAKE PRODUCTION ORDER';
    const footer   = cfg.cake_slip_footer?.trim();
    const on       = (key) => String(cfg[key]) === '1';

    // Mirrors the server's center() function exactly
    const ctr = (s) => {
      const sp = Math.max(0, Math.floor((W - s.length) / 2));
      return ' '.repeat(sp) + s;
    };
    const DIV = '='.repeat(W);
    const div = '-'.repeat(W);

    // Mirrors the server's field() function: label on line 1, BOLD value on line 2
    const field = (label, val) =>
      val ? `${label}:\n<b>${String(val)}</b>\n\n` : '';

    const lines = [
      shopName ? `${ctr(shopName)}\n` : '',
      `${ctr(hdrLine)}\n`,
      `${ctr(DIV)}\n`,
      `${ctr('ORDER #CAKE-2026-0001')}\n`,
      `${ctr(DIV)}\n\n`,

      field('Customer', 'Priya Sharma'),
      on('cake_slip_show_phone') ? field('Phone', '98XXXXXXXX') : '',

      `Delivery:\n<b>28 Jun 2026  02:00 PM</b>\n\n`,
      `${div}\n`,

      on('cake_slip_show_flavour') ? field('Flavour',  'Chocolate')   : '',
      on('cake_slip_show_size')    ? field('Size',     '1 Kg')         : '',
      on('cake_slip_show_qty')     ? field('Quantity', '1')            : '',
      on('cake_slip_show_cream')   ? field('Cream',    'Fresh Cream')  : '',
      on('cake_slip_show_sponge')  ? field('Sponge',   'Chocolate')    : '',
      on('cake_slip_show_shape')   ? field('Shape',    'Round')        : '',
      on('cake_slip_show_theme')   ? field('Theme',    'Birthday')     : '',

      on('cake_slip_show_message')
        ? field('Message on Cake', 'Happy Birthday!') : '',

      on('cake_slip_show_accessories')
        ? `Accessories:\n  Candle  : YES\n  Knife   : No\n  Eggless : No\n\n` : '',

      on('cake_slip_show_allergies') ? field('Allergies', 'None')       : '',
      on('cake_slip_show_notes')     ? field('Notes',     'Extra moist'): '',
      on('cake_slip_show_status')    ? field('Status',    'CONFIRMED')  : '',

      on('cake_slip_show_pricing')
        ? `${div}\nTotal  : <b>Rs.850.00</b>\nAdvance: Rs.500.00\nBalance: <b>Rs.350.00</b>\n` : '',

      `${DIV}\nPhotos: 2 image(s) attached\n${DIV}\n\n`,

      on('cake_slip_show_qr') ? `${ctr('QR: CAKE-2026-0001')}\n${DIV}\n` : '',

      footer ? `${ctr(footer)}\n` : '',
    ].join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Courier New',monospace;font-size:11px;line-height:1.5;
       width:${Math.round(pxW)}px;padding:8px;color:#000;background:#fff;
       white-space:pre-wrap;word-break:break-all;}
</style></head>
<body>${lines}</body></html>`;
  }

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', width: '100%' }}>

      {/* ── Left: Settings ─────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0 }}>

        {/* Global paper width notice */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          background: '#f0f9ff', border: '1px solid #bae6fd',
          borderRadius: 8, padding: '10px 16px', marginBottom: 20,
        }}>
          <span style={{ fontSize: 18 }}>🖨</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#0369a1' }}>
              Paper Width: {paperWidth}mm — {paperWidth >= 80 ? '80mm (48 chars/line)' : '58mm (32 chars/line)'}
            </div>
            <div style={{ fontSize: 11, color: '#0284c7', marginTop: 2 }}>
              This is the global setting from <strong>Receipt &amp; Printer</strong> tab. Change it there to affect all ESC/POS printing.
            </div>
          </div>
        </div>

        {/* Header section */}
        <div className="fm-card" style={{ marginBottom: 20 }}>
          <div className="fm-card__head">
            <span className="fm-card__title">🎂 Slip Header</span>
          </div>
          <div style={{ padding: '16px 20px' }}>
            <Field label="Bakery / Shop Name" hint="Printed at the top of the slip. Leave blank to omit.">
              <input style={inp} value={cfg.cake_slip_shop_name || ''} placeholder="e.g. Munch Time Bakery"
                onChange={e => set('cake_slip_shop_name', e.target.value)} />
            </Field>
            <Field label="Slip Title" hint="Main heading of the slip.">
              <input style={inp} value={cfg.cake_slip_header_line || ''} placeholder="CAKE PRODUCTION ORDER"
                onChange={e => set('cake_slip_header_line', e.target.value)} />
            </Field>
            <Field label="Footer Text" hint="Printed at the bottom. Leave blank to omit.">
              <input style={inp} value={cfg.cake_slip_footer || ''} placeholder="e.g. Thank you for your order!"
                onChange={e => set('cake_slip_footer', e.target.value)} />
            </Field>
          </div>
        </div>

        {/* Field toggles */}
        <div className="fm-card" style={{ marginBottom: 20 }}>
          <div className="fm-card__head">
            <span className="fm-card__title">📋 Fields to Print</span>
          </div>
          <div style={{ padding: '4px 20px 16px' }}>

            <div style={sectionHead}>Customer</div>
            <Toggle label="Phone Number"        checked={tog('cake_slip_show_phone')}       onChange={v => set('cake_slip_show_phone', v)} />

            <div style={{ ...sectionHead, marginTop: 14 }}>Cake Specification</div>
            <Toggle label="Flavour"             checked={tog('cake_slip_show_flavour')}     onChange={v => set('cake_slip_show_flavour', v)} />
            <Toggle label="Size"                checked={tog('cake_slip_show_size')}        onChange={v => set('cake_slip_show_size', v)} />
            <Toggle label="Quantity"            checked={tog('cake_slip_show_qty')}         onChange={v => set('cake_slip_show_qty', v)} />
            <Toggle label="Cream Tags"          checked={tog('cake_slip_show_cream')}       onChange={v => set('cake_slip_show_cream', v)} />
            <Toggle label="Sponge Tags"         checked={tog('cake_slip_show_sponge')}      onChange={v => set('cake_slip_show_sponge', v)} />
            <Toggle label="Shape Tags"          checked={tog('cake_slip_show_shape')}       onChange={v => set('cake_slip_show_shape', v)} />
            <Toggle label="Theme Tags"          checked={tog('cake_slip_show_theme')}       onChange={v => set('cake_slip_show_theme', v)} />

            <div style={{ ...sectionHead, marginTop: 14 }}>Design & Instructions</div>
            <Toggle label="Message on Cake"     checked={tog('cake_slip_show_message')}     onChange={v => set('cake_slip_show_message', v)} />
            <Toggle label="Accessories (Candle / Knife / Eggless)" checked={tog('cake_slip_show_accessories')} onChange={v => set('cake_slip_show_accessories', v)} />
            <Toggle label="Allergies"           checked={tog('cake_slip_show_allergies')}   onChange={v => set('cake_slip_show_allergies', v)} />
            <Toggle label="Cake Notes"          checked={tog('cake_slip_show_notes')}       onChange={v => set('cake_slip_show_notes', v)} />

            <div style={{ ...sectionHead, marginTop: 14 }}>Order Info</div>
            <Toggle label="Order Status"        checked={tog('cake_slip_show_status')}      onChange={v => set('cake_slip_show_status', v)} />
            <Toggle label="Pricing (Total / Advance / Balance)" checked={tog('cake_slip_show_pricing')} onChange={v => set('cake_slip_show_pricing', v)} />
            <Toggle label="QR Code"             checked={tog('cake_slip_show_qr')}          onChange={v => set('cake_slip_show_qr', v)} />
          </div>
        </div>

        {/* Save */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, alignItems: 'center' }}>
          {toast && (
            <span style={{ fontSize: 12, color: toast.err ? '#dc2626' : '#16a34a', fontWeight: 600 }}>
              {toast.msg}
            </span>
          )}
          <button
            onClick={save}
            disabled={saving}
            style={{
              padding: '9px 24px', borderRadius: 7, border: 'none',
              background: '#c1440e', color: '#fff', fontWeight: 700,
              fontSize: 13, cursor: 'pointer', opacity: saving ? 0.65 : 1,
            }}
          >{saving ? 'Saving…' : 'Save Cake Slip Settings'}</button>
        </div>
      </div>

      {/* ── Right: Live preview ─────────────────────────────────── */}
      <div style={{ width: 280, flexShrink: 0, position: 'sticky', top: 24, alignSelf: 'flex-start' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
          Live Preview
        </div>
        <div style={{
          border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden',
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        }}>
          <iframe
            title="slip-preview"
            srcDoc={previewHTML()}
            style={{ width: '100%', height: 560, border: 'none', display: 'block', background: '#fff' }}
          />
        </div>
        <div style={{ fontSize: 10, color: '#bbb', textAlign: 'center', marginTop: 6 }}>
          {paperWidth}mm paper preview · {paperWidth >= 80 ? '48' : '32'} chars/line
        </div>
      </div>
    </div>
  );
}
