import { useState, useEffect } from 'react';
import axios from 'axios';

const API  = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', headers: { 'X-Session-ID': 'dev-session' } });
const FAPI = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', headers: { 'X-Session-ID': 'dev-session' } });

export default function ModifiersTab() {
  const [products, setProducts] = useState([]);
  const [search,   setSearch]   = useState('');
  const [expanded, setExpanded] = useState(null);   // product id
  const [mods,     setMods]     = useState({});      // { [productId]: modifier[] }
  const [modForms, setModForms] = useState({});      // { [productId]: { name, price } }
  const [editMod,  setEditMod]  = useState(null);   // { id, name, price }
  const [err,      setErr]      = useState('');

  useEffect(() => {
    API.get('/maintenance/products').then(r => setProducts(r.data)).catch(() => {});
  }, []);

  async function loadMods(productId) {
    const res = await FAPI.get(`/food-menu/products/${productId}/modifiers`).catch(() => ({ data: [] }));
    setMods(m => ({ ...m, [productId]: res.data }));
  }

  function toggleProduct(id) {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    loadMods(id);
    setModForms(f => ({ ...f, [id]: f[id] ?? { name: '', price: '' } }));
    setErr('');
    setEditMod(null);
  }

  async function addModifier(productId) {
    const form = modForms[productId] ?? {};
    if (!form.name?.trim()) return setErr('Modifier name is required');
    await FAPI.post(`/food-menu/products/${productId}/modifiers`, {
      name:       form.name.trim(),
      price:      parseFloat(form.price) || 0,
      sort_order: (mods[productId]?.length ?? 0),
    });
    setModForms(f => ({ ...f, [productId]: { name: '', price: '' } }));
    setErr('');
    loadMods(productId);
  }

  async function saveEditMod(productId) {
    if (!editMod?.name?.trim()) return setErr('Name required');
    await FAPI.patch(`/food-menu/modifiers/${editMod.id}`, {
      name:  editMod.name.trim(),
      price: parseFloat(editMod.price) || 0,
    });
    setEditMod(null);
    setErr('');
    loadMods(productId);
  }

  async function deleteMod(productId, modId) {
    await FAPI.delete(`/food-menu/modifiers/${modId}`);
    loadMods(productId);
  }

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.category_name ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fm-card">
      <div className="fm-card__head">
        <span className="fm-card__title">Modifiers</span>
        <span style={{ fontSize: 12, color: '#999' }}>Add-ons &amp; extras per product</span>
      </div>

      <div style={{ padding: '0 0 12px' }}>
        <input
          placeholder="Search products…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, boxSizing: 'border-box' }}
        />
      </div>

      {err && <div style={{ color: 'red', fontSize: 12, marginBottom: 8 }}>{err}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {filtered.map(p => (
          <div key={p.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
            {/* Product row */}
            <div
              onClick={() => toggleProduct(p.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                background: expanded === p.id ? '#fff7ed' : '#fff',
                cursor: 'pointer', userSelect: 'none',
              }}
            >
              <span style={{ fontWeight: 700, flex: 1, fontSize: 14, color: '#111' }}>{p.name}</span>
              <span style={{ fontSize: 11, color: '#999', marginRight: 8 }}>{p.category_name}</span>
              <span style={{ fontSize: 12, color: expanded === p.id ? '#f97316' : '#999' }}>
                {expanded === p.id ? '▲' : '▼'}
              </span>
            </div>

            {/* Expanded: modifier list + form */}
            {expanded === p.id && (
              <div style={{ borderTop: '1px solid #f3f4f6', background: '#fafafa', padding: '12px 14px' }}>
                {(mods[p.id] ?? []).length === 0 ? (
                  <div style={{ color: '#aaa', fontSize: 12, marginBottom: 10 }}>No modifiers yet.</div>
                ) : (
                  <table className="fm-table" style={{ marginBottom: 12 }}>
                    <thead>
                      <tr><th>Name</th><th>Price (₹)</th><th></th></tr>
                    </thead>
                    <tbody>
                      {(mods[p.id] ?? []).map(mod => editMod?.id === mod.id ? (
                        <tr className="fm-edit-row" key={mod.id}>
                          <td>
                            <input value={editMod.name}
                              onChange={e => setEditMod(m => ({ ...m, name: e.target.value }))} />
                          </td>
                          <td>
                            <input type="number" value={editMod.price}
                              onChange={e => setEditMod(m => ({ ...m, price: e.target.value }))}
                              style={{ width: 90 }} />
                          </td>
                          <td style={{ display: 'flex', gap: 6 }}>
                            <button className="btn-primary" style={{ padding: '4px 12px', fontSize: 12 }}
                              onClick={() => saveEditMod(p.id)}>Save</button>
                            <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }}
                              onClick={() => { setEditMod(null); setErr(''); }}>✕</button>
                          </td>
                        </tr>
                      ) : (
                        <tr key={mod.id}>
                          <td style={{ fontWeight: 600 }}>{mod.name}</td>
                          <td>{mod.price > 0 ? `₹${mod.price.toFixed(2)}` : '—'}</td>
                          <td style={{ display: 'flex', gap: 6 }}>
                            <button className="btn-icon"
                              onClick={() => { setEditMod({ id: mod.id, name: mod.name, price: String(mod.price) }); setErr(''); }}>✎</button>
                            <button className="btn-icon" style={{ color: '#dc2626' }}
                              onClick={() => deleteMod(p.id, mod.id)}>✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* Add modifier form */}
                <div className="fm-form-row" style={{ paddingTop: 0 }}>
                  <div className="fm-field" style={{ flex: 2 }}>
                    <label>Modifier Name *</label>
                    <input
                      placeholder="e.g. Extra Cheese"
                      value={modForms[p.id]?.name ?? ''}
                      onChange={e => setModForms(f => ({ ...f, [p.id]: { ...f[p.id], name: e.target.value } }))}
                    />
                  </div>
                  <div className="fm-field" style={{ maxWidth: 110 }}>
                    <label>Price (₹)</label>
                    <input
                      type="number"
                      placeholder="0"
                      value={modForms[p.id]?.price ?? ''}
                      onChange={e => setModForms(f => ({ ...f, [p.id]: { ...f[p.id], price: e.target.value } }))}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
                    <button className="btn-primary" onClick={() => addModifier(p.id)}>+ Add</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="fm-empty">No products found.</div>
        )}
      </div>
    </div>
  );
}
