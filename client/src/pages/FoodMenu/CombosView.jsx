import { useState, useEffect, useCallback, useRef } from 'react';
import { combosApi, productsApi, categoriesApi } from '../../services/api';
import { useMsg } from '../../hooks/useApi';
import MediaPicker from '../../components/MediaPicker/MediaPicker';

function imgSrc(raw) {
  if (!raw) return null;
  const str = typeof raw === 'object' ? raw.filename : raw;
  if (!str) return null;
  if (str.startsWith('http')) return str;
  if (str.startsWith('/uploads/')) return str;
  const filename = str.replace(/\\/g, '/').split('/').pop();
  return filename ? `/uploads/${filename}` : null;
}

// Load the full non-combo catalogue (with variants) for the child-item pickers.
async function loadAllProducts() {
  const out = [];
  let page = 1, pages = 1;
  do {
    const res = await productsApi.list({ page, sort: 'name', sortDir: 'asc' });
    (res.data.products || []).forEach(p => out.push(p));
    pages = res.data.totalPages || 1;
    page += 1;
  } while (page <= pages);
  return out;
}

export default function CombosView() {
  const [combos, setCombos] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [editing, setEditing] = useState(null); // combo object | 'new' | null
  const { msg, showMsg } = useMsg();

  const load = useCallback(async (s = '') => {
    setLoading(true);
    try { setCombos((await combosApi.list({ search: s })).data); }
    catch (e) { showMsg(e.response?.data?.error || e.message, false); }
    finally { setLoading(false); }
  }, [showMsg]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    loadAllProducts().then(setProducts).catch(() => {});
    categoriesApi.list({}).then(r => setCategories(r.data)).catch(() => {});
  }, []);

  async function handleDelete(combo) {
    if (!window.confirm(`Delete combo "${combo.name}"? Its composition is removed. Past orders are unaffected.`)) return;
    try { await combosApi.remove(combo.id); showMsg('Combo deleted', true); load(search); }
    catch (e) { showMsg(e.response?.data?.error || e.message, false); }
  }

  return (
    <div className="fm-combos" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="toolbar fm-toolbar">
        <form className="fm-search-form" onSubmit={e => { e.preventDefault(); load(search); }}>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search combos…" />
          <button type="submit" className="btn btn-primary">Search</button>
          {search && <button type="button" className="btn btn-clear" onClick={() => { setSearch(''); load(''); }}>✕</button>}
        </form>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {msg && <span className={`msg msg-${msg.ok ? 'ok' : 'err'}`}>{msg.text}</span>}
          <button className="btn btn-add" onClick={() => setEditing('new')}>＋ New Combo</button>
        </div>
      </div>

      <div className="table-wrap" style={{ flex: 1, minHeight: 0, overflow: 'auto', margin: '10px 12px', border: '1px solid var(--t-border)', borderRadius: 12, background: 'var(--t-surface)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <table className="fm-table combo-table">
          <thead>
            <tr>
              <th style={{ width: 60 }}>Image</th>
              <th style={{ width: '26%' }}>Combo</th>
              <th style={{ width: '16%' }}>Category</th>
              <th style={{ width: '10%' }}>Price</th>
              <th>Contains</th>
              <th style={{ width: 70 }}>POS</th>
              <th style={{ width: 110 }}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="fm-loading">Loading…</td></tr>
            ) : combos.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, opacity: 0.6 }}>No combos yet. Click “＋ New Combo”.</td></tr>
            ) : combos.map(c => (
              <tr key={c.id} className="combo-row" onDoubleClick={() => setEditing(c)}>
                <td>
                  {imgSrc(c.primary_image)
                    ? <img src={imgSrc(c.primary_image)} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6 }} />
                    : <span style={{ opacity: 0.4 }}>📷</span>}
                </td>
                <td><b>{c.name}</b></td>
                <td>{c.category_name || '—'}</td>
                <td>₹{Number(c.pos_price || 0).toLocaleString('en-IN')}</td>
                <td className="combo-contains">
                  {(c.items || []).map(it => (
                    <span key={it.id} className="combo-chip">
                      {it.child_name}{it.variant_name ? ` · ${it.variant_name}` : ''} ×{it.quantity}
                    </span>
                  ))}
                  {(!c.items || c.items.length === 0) && <span style={{ opacity: 0.5 }}>no items</span>}
                </td>
                <td><span className={`badge badge-${c.pos_active ? 'active' : 'inactive'}`}>{c.pos_active ? 'On' : 'Off'}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm" onClick={() => setEditing(c)}>✎ Edit</button>
                  <button className="btn btn-sm btn-delete" onClick={() => handleDelete(c)}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <ComboEditorModal
          combo={editing === 'new' ? null : editing}
          products={products}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(search); }}
          showMsg={showMsg}
        />
      )}
    </div>
  );
}

// ── Modal editor ──────────────────────────────────────────────────────────────
function blankItem() { return { child_product_id: '', child_variant_id: '', quantity: 1 }; }

function ComboEditorModal({ combo, products, categories, onClose, onSaved, showMsg }) {
  const [name, setName] = useState(combo?.name || '');
  const [categoryId, setCategoryId] = useState(combo?.category_id || '');
  const [price, setPrice] = useState(combo?.pos_price ?? 0);
  const [posActive, setPosActive] = useState(combo ? !!combo.pos_active : true);
  const [qrVisible, setQrVisible] = useState(combo ? !!combo.customer_visible : false);
  const [image, setImage] = useState(combo?.primary_image || null);
  const [mediaId, setMediaId] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [items, setItems] = useState(
    combo?.items?.length
      ? combo.items.map(it => ({ child_product_id: it.child_product_id, child_variant_id: it.child_variant_id || '', quantity: it.quantity }))
      : [blankItem()]
  );
  const [saving, setSaving] = useState(false);
  const rootRef = useRef(null);

  const prodById = useCallback(id => products.find(p => p.id === Number(id)), [products]);

  // Enter advances to the next field (reused UX from CakeOrderForm.handleEnterNext).
  function handleEnterNext(e) {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    const el = e.target;
    if (!el || el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON') return;
    if (!['INPUT', 'SELECT'].includes(el.tagName)) return;
    e.preventDefault();
    const controls = Array.from(rootRef.current.querySelectorAll('input:not([type="hidden"]), select'))
      .filter(c => !c.disabled && !c.readOnly && c.offsetParent !== null);
    const idx = controls.indexOf(el);
    const next = controls[idx + 1] || controls[0];
    if (next && next !== el) { next.focus(); if (next.select) next.select(); }
  }

  function setItem(i, patch) { setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it)); }
  function addItem() { setItems(prev => [...prev, blankItem()]); }
  function removeItem(i) { setItems(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev); }

  function onPickProduct(i, pid) {
    const p = prodById(pid);
    const firstVar = p?.variants?.[0]?.id || '';
    setItem(i, { child_product_id: pid ? Number(pid) : '', child_variant_id: firstVar });
  }

  async function save() {
    if (!name.trim()) return showMsg('Combo name required', false);
    const cleanItems = items
      .filter(it => it.child_product_id)
      .map((it, idx) => ({
        child_product_id: Number(it.child_product_id),
        child_variant_id: it.child_variant_id ? Number(it.child_variant_id) : null,
        quantity: Math.max(1, Number(it.quantity) || 1),
        sequence: idx,
      }));
    if (!cleanItems.length) return showMsg('Add at least one child item', false);
    const payload = {
      name: name.trim(), category_id: categoryId || null, pos_price: Number(price) || 0,
      pos_active: posActive ? 1 : 0, customer_visible: qrVisible ? 1 : 0, items: cleanItems,
      ...(mediaId ? { media_id: mediaId } : {}),
    };
    setSaving(true);
    try {
      if (combo) await combosApi.update(combo.id, payload);
      else await combosApi.create(payload);
      showMsg('Combo saved', true);
      onSaved();
    } catch (e) { showMsg(e.response?.data?.error || e.message, false); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="combo-modal" onClick={e => e.stopPropagation()} onKeyDown={handleEnterNext} ref={rootRef}>
        <div className="combo-modal__title">{combo ? 'Edit Combo' : 'New Combo'}</div>

        <div className="combo-modal__body">
          <div className="combo-head">
            <div className="combo-field" onClick={() => setPickerOpen(true)} style={{ cursor: 'pointer' }} title="Click to set image">
              <span>Image</span>
              {imgSrc(image)
                ? <img src={imgSrc(image)} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6 }} />
                : <div style={{ width: 56, height: 56, borderRadius: 6, background: '#f1f1f1', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>📷</div>}
            </div>
            <label className="combo-field combo-field--wide">
              <span>Name</span>
              <input autoFocus value={name} onChange={e => setName(e.target.value)} onFocus={e => e.target.select()} placeholder="Burger + Cola Combo" />
            </label>
            <label className="combo-field">
              <span>Price</span>
              <input type="number" min="0" value={price} onChange={e => setPrice(e.target.value)} onFocus={e => e.target.select()} />
            </label>
            <label className="combo-field">
              <span>Category</span>
              <select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                <option value="">—</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="combo-toggle"><input type="checkbox" checked={posActive} onChange={e => setPosActive(e.target.checked)} /> On POS</label>
            <label className="combo-toggle"><input type="checkbox" checked={qrVisible} onChange={e => setQrVisible(e.target.checked)} /> QR Menu</label>
          </div>

          <div className="combo-items">
            <div className="combo-items__head"><span>Contains</span><span className="combo-items__hint">Enter → next field</span></div>
            {items.map((it, i) => {
              const p = prodById(it.child_product_id);
              return (
                <div className="combo-item-row" key={i}>
                  <span className="combo-item-row__seq">{i + 1}</span>
                  <select value={it.child_product_id} onChange={e => onPickProduct(i, e.target.value)} className="combo-item-row__prod">
                    <option value="">Select product…</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <select value={it.child_variant_id} onChange={e => setItem(i, { child_variant_id: e.target.value })} className="combo-item-row__var" disabled={!p?.variants?.length}>
                    {!p?.variants?.length && <option value="">—</option>}
                    {p?.variants?.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                  <input type="number" min="1" value={it.quantity} onChange={e => setItem(i, { quantity: e.target.value })} onFocus={e => e.target.select()} className="combo-item-row__qty" title="Quantity" />
                  <button type="button" className="combo-item-row__del" onClick={() => removeItem(i)} title="Remove" tabIndex={-1}>✕</button>
                </div>
              );
            })}
            <button type="button" className="btn btn-clear combo-add-item" onClick={addItem}>＋ Add item</button>
          </div>
        </div>

        <div className="combo-modal__foot">
          <button type="button" className="btn btn-clear" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Combo'}</button>
        </div>
      </div>

      {pickerOpen && (
        <MediaPicker
          section="menu"
          onSelect={item => { setImage(item.url || item.filename); setMediaId(item.id); setPickerOpen(false); }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
