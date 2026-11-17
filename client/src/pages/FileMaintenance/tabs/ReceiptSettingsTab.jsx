import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

const DEFAULTS = {
    org_name: '', org_tagline: '', org_address: '', org_phone: '',
    org_email: '', org_gstin: '', org_pan: '', receipt_footer: '',
    show_logo: '0', logo_text: '', show_customer_phone: '1',
    show_order_type: '1', show_table: '1', show_kot_breakdown: '0',
    paper_width_mm: '80', font_size_px: '12', copies: '1',
    custom_header_line: '', custom_footer_line: '',
};

function Toggle({ label, checked, onChange, hint }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--t-border)' }}>
            <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t-text)' }}>{label}</div>
                {hint && <div style={{ fontSize: 11, color: 'var(--t-text-muted)', marginTop: 2 }}>{hint}</div>}
            </div>
            <button
                onClick={() => onChange(checked ? '0' : '1')}
                style={{
                    width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                    background: checked ? 'var(--t-accent)' : 'var(--t-border-strong)', transition: 'background .2s',
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

function Field({ label, required, error, hint, children }) {
    return (
        <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--t-text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
                {label}{required && <span style={{ color: 'var(--t-accent)' }}> *</span>}
            </label>
            {children}
            {error && <div style={{ fontSize: 11, color: 'var(--t-danger)', marginTop: 3 }}>{error}</div>}
            {hint && !error && <div style={{ fontSize: 11, color: 'var(--t-text-soft)', marginTop: 3 }}>{hint}</div>}
        </div>
    );
}

const inputStyle = (err) => ({
    width: '100%', padding: '8px 10px', border: `1px solid ${err ? 'var(--t-danger)' : 'var(--t-border)'}`,
    borderRadius: 6, fontSize: 13, boxSizing: 'border-box', outline: 'none',
});

export default function ReceiptSettingsTab() {
    const [cfg,      setCfg]      = useState(DEFAULTS);
    const [errors,   setErrors]   = useState({});
    const [saving,   setSaving]   = useState(false);
    const [toast,    setToast]    = useState(null);
    const [printers, setPrinters] = useState([]);
    const [scanning, setScanning] = useState(false);
    const [selPrinter, setSelPrinter] = useState('');
    const [savedPrinter, setSavedPrinter] = useState('');
    const [showPreview, setShowPreview] = useState(false);

    const load = useCallback(async () => {
        try {
            const [cfgRes, printerRes] = await Promise.all([
                API.get('/settings/receipt'),
                API.get('/settings/printer'),
            ]);
            setCfg(c => ({ ...c, ...cfgRes.data }));
            const { printer_name, vendor_id, product_id } = printerRes.data;
            setSavedPrinter(printer_name || (vendor_id && product_id ? `${vendor_id}:${product_id}` : ''));
            setSelPrinter(vendor_id && product_id ? `${vendor_id}:${product_id}` : '');
        } catch { flash('Failed to load settings', true); }
    }, []);

    useEffect(() => { load(); }, [load]);

    function flash(msg, err = false) {
        setToast({ msg, err });
        setTimeout(() => setToast(null), 3000);
    }

    function set(key, val) {
        setCfg(c => ({ ...c, [key]: val }));
        setErrors(e => { const n = { ...e }; delete n[key]; return n; });
    }

    async function save() {
        setSaving(true);
        try {
            const res = await API.post('/settings/receipt', cfg);
            if (res.data.errors) { setErrors(res.data.errors); flash('Fix errors below', true); }
            else { setErrors({}); flash('Receipt settings saved'); }
        } catch (e) {
            if (e.response?.data?.errors) setErrors(e.response.data.errors);
            else flash('Save failed', true);
        } finally { setSaving(false); }
    }

    async function scanPrinters() {
        setScanning(true); setPrinters([]);
        try {
            const r = await API.get('/settings/printers');
            setPrinters(r.data.printers ?? []);
            if (!r.data.printers?.length) flash('No printers found. Install printer driver first.', true);
        } catch { flash('Could not scan printers', true); }
        finally { setScanning(false); }
    }

    async function savePrinter() {
        if (!selPrinter) return flash('Select a printer first', true);
        const picked = printers.find(p => `${p.vendor_id}:${p.product_id}` === selPrinter);
        if (!picked) return flash('Select a printer first', true);
        try {
            await API.post('/settings/printer', {
                printer_name: picked.label,
                vendor_id: picked.vendor_id,
                product_id: picked.product_id,
                paper_width: cfg.paper_width_mm,
            });
            setSavedPrinter(picked.label);
            flash(`Printer set to "${picked.label}"`);
        } catch { flash('Failed to save printer', true); }
    }

    const tog = (key) => String(cfg[key]) === '1';

    // ── Receipt Preview HTML ──────────────────────────────────
    function previewHTML() {
        const logoLines = String(cfg.logo_text || '').split('\n').filter(Boolean);
        const fontPx = Number(cfg.font_size_px) || 12;
        return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Courier New',monospace;font-size:${fontPx}px;width:${cfg.paper_width_mm}mm;padding:6px 8px;color:#000;background:#fff}
  .center{text-align:center}.bold{font-weight:bold}.dashed{border-top:1px dashed #000;margin:5px 0}
  .double{border-top:3px double #000;margin:5px 0}.sm{font-size:${fontPx - 2}px}.lg{font-size:${fontPx + 3}px}
  .xl{font-size:${fontPx + 7}px;letter-spacing:1px}.kv{display:flex;justify-content:space-between;padding:1px 0}
  pre{font-family:inherit;white-space:pre;font-size:${fontPx}px}
  table{width:100%;border-collapse:collapse}th{font-size:${fontPx - 2}px;border-bottom:1px solid #000;padding:2px 0}
</style></head><body>
<div class="center">
  ${tog('show_logo') && logoLines.length ? `<pre class="bold">${logoLines.join('\n')}</pre>` : ''}
  <div class="bold xl">${cfg.org_name || 'ORG NAME'}</div>
  ${cfg.custom_header_line ? `<div class="sm">${cfg.custom_header_line}</div>` : ''}
  ${cfg.org_address ? `<div class="sm">${cfg.org_address}</div>` : ''}
  ${cfg.org_phone   ? `<div class="sm">Tel: ${cfg.org_phone}</div>` : ''}
  ${cfg.org_email   ? `<div class="sm">${cfg.org_email}</div>` : ''}
  ${cfg.org_gstin   ? `<div class="sm">GST: ${cfg.org_gstin}</div>` : ''}
  ${cfg.org_pan     ? `<div class="sm">PAN: ${cfg.org_pan}</div>` : ''}
</div>
<div class="dashed"></div>
<div class="kv"><span>Receipt #</span><span class="bold">1001</span></div>
<div class="kv"><span>Date/Time</span><span>24 Jun 2026 10:30</span></div>
${tog('show_order_type') ? `<div class="kv"><span>Type</span><span>TAKEAWAY</span></div>` : ''}
${tog('show_table')      ? `<div class="kv"><span>Table</span><span>T-01</span></div>` : ''}
<div class="dashed"></div>
<div class="kv"><span>Customer</span><span class="bold">Walk-in</span></div>
${tog('show_customer_phone') ? `<div class="kv"><span>Phone</span><span>98000000</span></div>` : ''}
<div class="dashed"></div>
<table>
  <thead><tr><th style="text-align:left">Item</th><th>Qty</th><th>Rate</th><th>Amt</th></tr></thead>
  <tbody>
    <tr><td>Margherita Pizza</td><td style="text-align:center">1</td><td style="text-align:right">350.00</td><td style="text-align:right">350.00</td></tr>
    <tr><td>Cold Coffee</td><td style="text-align:center">2</td><td style="text-align:right">120.00</td><td style="text-align:right">240.00</td></tr>
  </tbody>
</table>
<div class="double"></div>
<div class="kv bold lg"><span>TOTAL</span><span>₹590.00</span></div>
<div class="dashed"></div>
<div class="bold sm" style="margin-bottom:3px">PAYMENTS</div>
<div class="kv"><span>CASH</span><span>₹600.00</span></div>
<div class="dashed"></div>
<div class="center" style="margin-top:6px">
  ${cfg.custom_footer_line ? `<div class="sm">${cfg.custom_footer_line}</div>` : ''}
  <div class="bold">${cfg.org_tagline || 'Thank You!'}</div>
  <div class="sm" style="margin-top:4px">${cfg.receipt_footer || ''}</div>
</div>
</body></html>`;
    }

    return (
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', width: '100%' }}>
            {/* Left — Settings */}
            <div style={{ flex: 1, minWidth: 0 }}>

                {/* Printer Setup */}
                <div className="fm-card" style={{ marginBottom: 20 }}>
                    <div className="fm-card__head">
                        <span className="fm-card__title">🖨 Printer Setup</span>
                        {savedPrinter && (
                            <span style={{ fontSize: 12, color: 'var(--t-success)', fontWeight: 600 }}>✓ {savedPrinter}</span>
                        )}
                    </div>
                    <div style={{ padding: '16px 20px' }}>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                            <div style={{ flex: 1, minWidth: 200 }}>
                                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--t-text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
                                    Select Printer
                                </label>
                                <select
                                    style={{ ...inputStyle(false) }}
                                    value={selPrinter}
                                    onChange={e => setSelPrinter(e.target.value)}
                                >
                                    <option value="">— Click Scan first —</option>
                                    {printers.map(p => (
                                        <option key={`${p.vendor_id}:${p.product_id}`} value={`${p.vendor_id}:${p.product_id}`}>
                                            {p.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <button className="btn-secondary" onClick={scanPrinters} disabled={scanning} style={{ height: 36, whiteSpace: 'nowrap' }}>
                                {scanning ? '⏳ Scanning…' : '🔍 Scan Printers'}
                            </button>
                            <button className="btn-primary" onClick={savePrinter} disabled={!selPrinter} style={{ height: 36, whiteSpace: 'nowrap' }}>
                                Set Printer
                            </button>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--t-text-soft)', marginTop: 8 }}>
                            Install ZKP8001 via Windows (Printers &amp; Scanners) then click Scan.
                        </div>
                    </div>
                </div>

                {/* Organisation */}
                <div className="fm-card" style={{ marginBottom: 20 }}>
                    <div className="fm-card__head"><span className="fm-card__title">🏢 Organisation</span></div>
                    <div style={{ padding: '16px 20px' }}>
                        <Field label="Organisation Name" required error={errors.org_name}>
                            <input style={inputStyle(errors.org_name)} maxLength={50}
                                value={cfg.org_name} onChange={e => set('org_name', e.target.value)}
                                placeholder="MTC STUDIO" />
                        </Field>
                        <Field label="Address" error={errors.org_address}>
                            <input style={inputStyle(false)} value={cfg.org_address}
                                onChange={e => set('org_address', e.target.value)} placeholder="123 Main St, Kathmandu" />
                        </Field>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            <Field label="Phone" error={errors.org_phone}>
                                <input style={inputStyle(errors.org_phone)} value={cfg.org_phone}
                                    onChange={e => set('org_phone', e.target.value)} placeholder="+977 98000000" />
                            </Field>
                            <Field label="Email" error={errors.org_email}>
                                <input style={inputStyle(errors.org_email)} type="email" value={cfg.org_email}
                                    onChange={e => set('org_email', e.target.value)} placeholder="info@mtc.com" />
                            </Field>
                            <Field label="GST / VAT No." error={errors.org_gstin}>
                                <input style={inputStyle(false)} value={cfg.org_gstin}
                                    onChange={e => set('org_gstin', e.target.value)} placeholder="22AAAAA0000A1Z5" />
                            </Field>
                            <Field label="PAN No." error={errors.org_pan}>
                                <input style={inputStyle(false)} value={cfg.org_pan}
                                    onChange={e => set('org_pan', e.target.value)} placeholder="123456789" />
                            </Field>
                        </div>
                    </div>
                </div>

                {/* Logo */}
                <div className="fm-card" style={{ marginBottom: 20 }}>
                    <div className="fm-card__head"><span className="fm-card__title">🖼 Logo (ASCII Text)</span></div>
                    <div style={{ padding: '16px 20px' }}>
                        <Toggle label="Show Logo on Receipt" checked={tog('show_logo')}
                            onChange={v => set('show_logo', v)}
                            hint="Logo prints as text art above org name" />
                        {tog('show_logo') && (
                            <Field label="Logo Text" error={errors.logo_text}
                                hint="Max 42 chars per line · Use monospace art · Recommended: 3–5 lines">
                                <textarea
                                    style={{ ...inputStyle(errors.logo_text), fontFamily: "'Courier New', monospace", resize: 'vertical', minHeight: 90 }}
                                    rows={4} maxLength={250}
                                    placeholder={"  ███╗   ███╗████████╗ ██████╗\n  ████╗ ████║╚══██╔══╝██╔════╝\n  ██╔████╔██║   ██║   ██║"}
                                    value={cfg.logo_text}
                                    onChange={e => set('logo_text', e.target.value)}
                                />
                                <div style={{ fontSize: 11, color: 'var(--t-text-soft)', marginTop: 3 }}>
                                    80mm paper ≈ 42 chars/line at 12px · Use a monospace ASCII generator
                                </div>
                            </Field>
                        )}
                    </div>
                </div>

                {/* Content & Layout */}
                <div className="fm-card" style={{ marginBottom: 20 }}>
                    <div className="fm-card__head"><span className="fm-card__title">📋 Content</span></div>
                    <div style={{ padding: '16px 20px' }}>
                        <Toggle label="Show Customer Phone" checked={tog('show_customer_phone')} onChange={v => set('show_customer_phone', v)} />
                        <Toggle label="Show Order Type" checked={tog('show_order_type')} onChange={v => set('show_order_type', v)} hint="e.g. DINE IN / TAKEAWAY" />
                        <Toggle label="Show Table Name" checked={tog('show_table')} onChange={v => set('show_table', v)} />
                        <Toggle label="Group Items by KOT" checked={tog('show_kot_breakdown')} onChange={v => set('show_kot_breakdown', v)} hint="Off = flat item list · On = grouped by KOT #" />
                    </div>
                </div>

                {/* Text */}
                <div className="fm-card" style={{ marginBottom: 20 }}>
                    <div className="fm-card__head"><span className="fm-card__title">✏️ Custom Text</span></div>
                    <div style={{ padding: '16px 20px' }}>
                        <Field label="Custom Header Line" hint="Appears below org name (e.g. 'All Day Breakfast · Dine In · Takeout')">
                            <input style={inputStyle(false)} maxLength={60} value={cfg.custom_header_line}
                                onChange={e => set('custom_header_line', e.target.value)} placeholder="e.g. Open Daily 8am – 10pm" />
                        </Field>
                        <Field label="Tagline" hint="Printed at the end of receipt">
                            <input style={inputStyle(false)} maxLength={60} value={cfg.org_tagline}
                                onChange={e => set('org_tagline', e.target.value)} placeholder="Thank You! Visit Again" />
                        </Field>
                        <Field label="Custom Footer Line" hint="Appears above tagline">
                            <input style={inputStyle(false)} maxLength={60} value={cfg.custom_footer_line}
                                onChange={e => set('custom_footer_line', e.target.value)} placeholder="e.g. Follow us @mtcstudio" />
                        </Field>
                        <Field label="Footer Text" hint="Very bottom — app credit / policy note">
                            <input style={inputStyle(false)} maxLength={80} value={cfg.receipt_footer}
                                onChange={e => set('receipt_footer', e.target.value)} placeholder="Powered by MTC POS" />
                        </Field>
                    </div>
                </div>

                {/* Layout */}
                <div className="fm-card" style={{ marginBottom: 20 }}>
                    <div className="fm-card__head"><span className="fm-card__title">⚙️ Layout</span></div>
                    <div style={{ padding: '16px 20px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                            <Field label="Paper Width (mm)" error={errors.paper_width_mm} hint="58 or 80">
                                <select style={{ ...inputStyle(errors.paper_width_mm) }}
                                    value={cfg.paper_width_mm} onChange={e => set('paper_width_mm', e.target.value)}>
                                    <option value="58">58mm</option>
                                    <option value="80">80mm</option>
                                </select>
                            </Field>
                            <Field label="Font Size (px)" error={errors.font_size_px} hint="10–16">
                                <input style={inputStyle(errors.font_size_px)} type="number" min={10} max={16}
                                    value={cfg.font_size_px} onChange={e => set('font_size_px', e.target.value)} />
                            </Field>
                            <Field label="Print Copies" error={errors.copies} hint="1–5">
                                <input style={inputStyle(errors.copies)} type="number" min={1} max={5}
                                    value={cfg.copies} onChange={e => set('copies', e.target.value)} />
                            </Field>
                        </div>
                    </div>
                </div>

                {/* Save */}
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <button className="btn-primary" onClick={save} disabled={saving}>
                        {saving ? 'Saving…' : '💾 Save Receipt Settings'}
                    </button>
                    <button className="btn-secondary" onClick={() => setShowPreview(p => !p)}>
                        {showPreview ? 'Hide Preview' : '👁 Show Preview'}
                    </button>
                    {toast && (
                        <span style={{ fontSize: 12, fontWeight: 600, color: toast.err ? 'var(--t-danger)' : 'var(--t-success)' }}>
                            {toast.err ? '✗' : '✓'} {toast.msg}
                        </span>
                    )}
                </div>
            </div>

            {/* Right — Live Preview */}
            {showPreview && (
                <div style={{ width: 320, flexShrink: 0, position: 'sticky', top: 20, alignSelf: 'flex-start' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t-text-muted)', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '.05em' }}>
                        Live Preview — {cfg.paper_width_mm}mm
                    </div>
                    <div style={{ background: 'var(--t-surface-3)', padding: 8, borderRadius: 8 }}>
                        <iframe
                            key={JSON.stringify(cfg)}
                            srcDoc={previewHTML()}
                            style={{ width: '100%', height: 620, border: 'none', borderRadius: 4, background: '#fff' }}
                            title="Receipt Preview"
                        />
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--t-text-soft)', marginTop: 6, textAlign: 'center' }}>
                        Preview uses sample order data
                    </div>
                </div>
            )}
        </div>
    );
}
