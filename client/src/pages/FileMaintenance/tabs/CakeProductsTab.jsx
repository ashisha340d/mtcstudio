import { useState, useEffect, useMemo, useCallback } from 'react';
import { nextCell } from './SharedModifiersTab';
import axios from 'axios';

const API = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', headers: { 'X-Session-ID': 'dev-session' } });

const CAKE_TYPE_OPTIONS = [
  { value: '',               label: '— Regular —' },
  { value: 'CAKE_BASE',      label: '🎂 Cake Base' },
  { value: 'CAKE_ACCESSORY', label: '🎁 Accessory' },
];

const CAKE_TYPE_BADGE = {
  CAKE_BASE:      { bg: 'rgba(193,68,14,0.1)',  color: 'var(--t-accent)' },
  CAKE_ACCESSORY: { bg: 'rgba(124,58,237,0.1)', color: '#7c3aed' },
};

// ── Variant sub-row (inline expand) ──────────────────────────
function VariantRows({ productId, onSaved }) {
  const [variants,  setVariants]  = useState(null);   // null = not loaded
  const [varEdits,  setVarEdits]  = useState({});
  const [saving,    setSaving]    = useState(false);

  useEffect(() => {
    API.get(`/maintenance/products/${productId}/variants`)
      .then(r => setVariants(r.data))
      .catch(() => setVariants([]));
  }, [productId]);

  function setVE(id, val) { setVarEdits(e => ({ ...e, [id]: val })); }

  async function saveVariant(v) {
    const type = varEdits[v.id];
    if (type === undefined) return;
    setSaving(true);
    try {
      await API.put(`/maintenance/products/variants/${v.id}/cake-type`, { cake_type: type || null });
      setVarEdits(e => { const n = { ...e }; delete n[v.id]; return n; });
      onSaved?.();
    } finally { setSaving(false); }
  }

  if (!variants) return (
    <tr><td colSpan={5} style={{ paddingLeft: 48, fontSize: 11, color: 'var(--t-text-soft)' }}>Loading…</td></tr>
  );
  if (!variants.length) return (
    <tr><td colSpan={5} style={{ paddingLeft: 48, fontSize: 11, color: 'var(--t-text-soft)' }}>No variants</td></tr>
  );

  return variants.map(v => {
    const currentType = varEdits[v.id] !== undefined ? varEdits[v.id] : (v.cake_type || '');
    const badge = CAKE_TYPE_BADGE[currentType];
    const dirty = varEdits[v.id] !== undefined;
    return (
      <tr key={v.id} style={{ background: 'var(--t-accent-soft)' }}>
        <td style={{ paddingLeft: 36, fontSize: 12, color: 'var(--t-text-muted)' }}>
          ↳ {v.name}
        </td>
        <td style={{ fontSize: 11, color: 'var(--t-text-soft)' }}>variant</td>
        <td style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>
          ₹{Number(v.selling_price || 0).toLocaleString('en-IN')}
        </td>
        <td>
          <select
            className="fm-inline-input"
            style={{ padding: '3px 8px', width: 160, fontSize: 11,
              background: badge ? badge.bg : undefined,
              color: badge ? badge.color : undefined,
              fontWeight: badge ? 700 : undefined,
            }}
            value={currentType}
            onChange={e => setVE(v.id, e.target.value)}
          >
            {CAKE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </td>
        <td>
          {dirty && (
            <button className="btn-icon fm-save-icon" title="Save variant" onClick={() => saveVariant(v)} disabled={saving}>✓</button>
          )}
        </td>
      </tr>
    );
  });
}

// ── Main tab ──────────────────────────────────────────────────
export default function CakeProductsTab() {
  const [products,   setProducts]   = useState([]);
  const [edits,      setEdits]      = useState({});
  const [expanded,   setExpanded]   = useState(new Set());
  const [search,     setSearch]     = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [catFilter,  setCatFilter]  = useState('');
  const [saving,     setSaving]     = useState(false);
  const [toast,      setToast]      = useState('');

  const load = useCallback(() =>
    API.get('/maintenance/products').then(r => setProducts(r.data)).catch(() => {}), []);

  useEffect(() => { load(); }, [load]);

  const categories = useMemo(() =>
    [...new Set(products.map(p => p.category_name).filter(Boolean))].sort(), [products]);

  const visible = useMemo(() => products.filter(p => {
    if (typeFilter === 'tagged'         && !p.cake_type)                        return false;
    if (typeFilter === 'CAKE_BASE'      && p.cake_type !== 'CAKE_BASE')         return false;
    if (typeFilter === 'CAKE_ACCESSORY' && p.cake_type !== 'CAKE_ACCESSORY')    return false;
    if (catFilter  && p.category_name !== catFilter)                            return false;
    if (search     && !p.name.toLowerCase().includes(search.toLowerCase()))     return false;
    return true;
  }), [products, typeFilter, catFilter, search]);

  function setField(id, field, val) {
    setEdits(e => ({ ...e, [id]: { ...(e[id] ?? {}), [field]: val } }));
  }
  function isDirty(id) { return !!edits[id] && Object.keys(edits[id]).length > 0; }
  const dirtyCount = Object.keys(edits).filter(id => isDirty(Number(id))).length;

  async function saveRow(id) {
    if (!edits[id]) return;
    await API.put(`/maintenance/products/${id}`, edits[id]);
    setEdits(e => { const n = { ...e }; delete n[id]; return n; });
  }

  async function saveAll() {
    const dirty = Object.keys(edits).filter(id => isDirty(Number(id)));
    if (!dirty.length) return;
    setSaving(true);
    try {
      await Promise.all(dirty.map(id => saveRow(Number(id))));
      await load();
      flash(`${dirty.length} product(s) saved`);
    } catch { flash('Save failed', true); }
    finally { setSaving(false); }
  }

  function flash(msg, isErr = false) {
    setToast(isErr ? `❌ ${msg}` : `✓ ${msg}`);
    setTimeout(() => setToast(''), 2500);
  }

  function toggleExpand(id) {
    setExpanded(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  const val = (p, field) => edits[p.id]?.[field] !== undefined ? edits[p.id][field] : p[field];
  const baseCount = products.filter(p => p.cake_type === 'CAKE_BASE').length;
  const accCount  = products.filter(p => p.cake_type === 'CAKE_ACCESSORY').length;

  return (
    <div className="fm-card">
      <div className="fm-card__head">
        <span className="fm-card__title">Cake Products</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {toast && <span style={{ fontSize: 12, color: toast.startsWith('❌') ? 'var(--t-danger)' : 'var(--t-success)' }}>{toast}</span>}
          <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 20, background: 'rgba(193,68,14,0.1)', color: 'var(--t-accent)', fontWeight: 700 }}>
            🎂 {baseCount} Base
          </span>
          <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 20, background: 'rgba(124,58,237,0.1)', color: '#7c3aed', fontWeight: 700 }}>
            🎁 {accCount} Accessory
          </span>
          <select className="fm-search" style={{ width: 160 }} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="">All products</option>
            <option value="tagged">Tagged only</option>
            <option value="CAKE_BASE">🎂 Cake Base</option>
            <option value="CAKE_ACCESSORY">🎁 Accessories</option>
          </select>
          <select className="fm-search" style={{ width: 150 }} value={catFilter} onChange={e => setCatFilter(e.target.value)}>
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input className="fm-search" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
          <span style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>{visible.length} shown</span>
          {dirtyCount > 0 && (
            <button className="btn-primary" style={{ padding: '5px 14px', fontSize: 12 }} onClick={saveAll} disabled={saving}>
              {saving ? 'Saving…' : `Save All (${dirtyCount})`}
            </button>
          )}
        </div>
      </div>

      <table className="fm-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Category</th>
            <th>Selling Price</th>
            <th>Cake Type (Product)</th>
            <th style={{ width: 80 }}></th>
          </tr>
        </thead>
        <tbody>
          {visible.map(p => {
            const currentType = val(p, 'cake_type') || '';
            const badge = CAKE_TYPE_BADGE[currentType];
            const isExpanded = expanded.has(p.id);
            return [
              <tr key={p.id} className={isDirty(p.id) ? 'fm-edit-row' : ''}>
                <td style={{ fontWeight: 600 }}>
                  <button
                    onClick={() => toggleExpand(p.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', marginRight: 6, fontSize: 11, color: 'var(--t-text-soft)', padding: '0 2px' }}
                    title="Show variants"
                  >{isExpanded ? '▾' : '▸'}</button>
                  {p.name}
                </td>
                <td style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>{p.category_name}</td>
                <td style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>
                  ₹{Number(p.pos_price || 0).toLocaleString('en-IN')}
                </td>
                <td>
                  <select
                    className="fm-inline-input"
                    style={{ padding: '4px 8px', width: 160,
                      background: badge ? badge.bg : undefined,
                      color: badge ? badge.color : undefined,
                      fontWeight: badge ? 700 : undefined,
                    }}
                    value={currentType}
                    onChange={e => setField(p.id, 'cake_type', e.target.value || null)}
                    onKeyDown={nextCell}
                  >
                    {CAKE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </td>
                <td>
                  {isDirty(p.id) && (
                    <button className="btn-icon fm-save-icon" title="Save" onClick={() => saveRow(p.id).then(load)}>✓</button>
                  )}
                </td>
              </tr>,
              isExpanded && (
                <VariantRows key={`v-${p.id}`} productId={p.id} onSaved={load} />
              ),
            ];
          })}
          {visible.length === 0 && (
            <tr><td colSpan={5} className="fm-empty">No products found</td></tr>
          )}
        </tbody>
      </table>

      <div className="fm-hint">
        <strong>Product level</strong>: tags all variants. <strong>▸ Variant level</strong>: overrides per-variant (expand row to set).
        🎂 Cake Base = flavours (Black Forest, Red Velvet…) · 🎁 Accessory = add-ons (Candle, Knife…).
      </div>
    </div>
  );
}
