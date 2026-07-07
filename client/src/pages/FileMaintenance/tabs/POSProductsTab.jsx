import { useState, useEffect, useMemo, useCallback } from 'react';
import { nextCell } from './SharedModifiersTab';
import axios from 'axios';

const API = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', headers: { 'X-Session-ID': 'dev-session' } });

export default function POSProductsTab() {
  const [products,  setProducts]  = useState([]);
  const [stations,  setStations]  = useState([]);
  const [edits,     setEdits]     = useState({});
  const [search,    setSearch]    = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [saving,    setSaving]    = useState(false);
  const [toast,     setToast]     = useState('');

  const load = useCallback(() => Promise.all([
    API.get('/maintenance/products').then(r => setProducts(r.data)),
    API.get('/maintenance/stations').then(r => setStations(r.data)),
  ]).catch(() => {}), []);

  useEffect(() => { load(); }, [load]);

  const categories = useMemo(() =>
    [...new Set(products.map(p => p.category_name).filter(Boolean))].sort(), [products]);

  const visible = useMemo(() =>
    products.filter(p => {
      if (catFilter && p.category_name !== catFilter) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    }), [products, catFilter, search]);

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

  async function deleteRow(id) {
    if (!confirm('Hide this product from POS (set POS Active = off)?')) return;
    try {
      await API.put(`/maintenance/products/${id}`, { pos_active: 0 });
      setProducts(ps => ps.map(p => p.id === id ? { ...p, pos_active: 0 } : p));
      setEdits(e => { const n = { ...e }; delete n[id]; return n; });
      flash('Hidden from POS');
    } catch { flash('Failed', true); }
  }

  function flash(msg, isErr = false) {
    setToast(isErr ? `❌ ${msg}` : `✓ ${msg}`);
    setTimeout(() => setToast(''), 2500);
  }

  const val = (p, field) => edits[p.id]?.[field] !== undefined ? edits[p.id][field] : p[field];

  return (
    <div className="fm-card">
      <div className="fm-card__head">
        <span className="fm-card__title">POS Products</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {toast && <span style={{ fontSize: 12, color: toast.startsWith('❌') ? '#dc2626' : '#16a34a' }}>{toast}</span>}
          <select className="fm-search" style={{ width: 150 }} value={catFilter} onChange={e => setCatFilter(e.target.value)}>
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input className="fm-search" placeholder="Search products…" value={search} onChange={e => setSearch(e.target.value)} />
          <span style={{ fontSize: 12, color: '#999' }}>{visible.length} shown</span>
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
            <th>Product</th><th>Category</th><th>POS Price (₹)</th>
            <th>Prep (min)</th><th>Station</th><th>Fast</th><th>Active</th>
            <th title="Show on customer QR menu">QR Menu</th>
            <th title="Max qty per customer order (blank = unlimited)" style={{ width: 70 }}>Max Qty</th>
            <th style={{ width: 80 }}></th>
          </tr>
        </thead>
        <tbody>
          {visible.map(p => (
            <tr key={p.id} className={isDirty(p.id) ? 'fm-edit-row' : ''}>
              <td style={{ fontWeight: 600 }}>{p.name}</td>
              <td style={{ fontSize: 12, color: '#888' }}>{p.category_name}</td>
              <td>
                <input
                  className="fm-inline-input"
                  type="number" step="0.5" style={{ width: 80 }}
                  value={val(p, 'pos_price') ?? 0}
                  onChange={e => setField(p.id, 'pos_price', parseFloat(e.target.value))}
                  onKeyDown={nextCell}
                />
              </td>
              <td>
                <input
                  className="fm-inline-input"
                  type="number" style={{ width: 60 }}
                  value={val(p, 'prep_time_minutes') ?? 10}
                  onChange={e => setField(p.id, 'prep_time_minutes', parseInt(e.target.value))}
                  onKeyDown={nextCell}
                />
              </td>
              <td>
                <select
                  className="fm-inline-input"
                  style={{ padding: '4px 6px' }}
                  value={val(p, 'pos_station_id') ?? ''}
                  onChange={e => setField(p.id, 'pos_station_id', e.target.value || null)}
                >
                  <option value="">— None —</option>
                  {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </td>
              <td>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={!!(val(p, 'is_fast_moving'))}
                    onChange={e => setField(p.id, 'is_fast_moving', e.target.checked ? 1 : 0)}
                  />
                  <span className="toggle-slider" />
                </label>
              </td>
              <td>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={!!(val(p, 'pos_active'))}
                    onChange={e => setField(p.id, 'pos_active', e.target.checked ? 1 : 0)}
                  />
                  <span className="toggle-slider" />
                </label>
              </td>
              <td>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={!!(val(p, 'customer_visible'))}
                    onChange={e => setField(p.id, 'customer_visible', e.target.checked ? 1 : 0)}
                  />
                  <span className="toggle-slider" />
                </label>
              </td>
              <td>
                <input
                  className="fm-inline-input"
                  type="number" min="1" style={{ width: 55 }}
                  placeholder="∞"
                  value={val(p, 'customer_max_qty') ?? ''}
                  onChange={e => setField(p.id, 'customer_max_qty', e.target.value === '' ? null : parseInt(e.target.value))}
                  onKeyDown={nextCell}
                />
              </td>
              <td>
                <div style={{ display: 'flex', gap: 4 }}>
                  {isDirty(p.id) && (
                    <button className="btn-icon fm-save-icon" title="Save" onClick={() => saveRow(p.id).then(load)}>✓</button>
                  )}
                  <button className="btn-icon btn-icon--danger" title="Hide from POS" onClick={() => deleteRow(p.id)}>🗑</button>
                </div>
              </td>
            </tr>
          ))}
          {visible.length === 0 && <tr><td colSpan={10} className="fm-empty">No products found</td></tr>}
        </tbody>
      </table>
      <div className="fm-hint">Edit cells inline · Enter to save row · QR Menu = show on customer ordering page · Max Qty limits quantity per order</div>
    </div>
  );
}
