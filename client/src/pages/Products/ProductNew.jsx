import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { productsApi, categoriesApi } from '../../services/api';

export default function ProductNew() {
  const navigate = useNavigate();
  const [cats, setCats] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: '', slug: '', category_id: '',
    short_description: '', description: '', featured: 0, status: 'active', sort_order: 0,
    variant_name: 'Regular', sku: '', selling_price: 0, stock: 0, reorder_level: 0, unit: ''
  });

  useEffect(() => {
    categoriesApi.list().then(c => setCats(c.data));
  }, []);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name) { setError('Name is required'); return; }
    setSaving(true);
    setError(null);
    try {
      await productsApi.create(form);
      navigate('/products');
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      setSaving(false);
    }
  }

  return (
    <div className="product-form">
      <h2>Add Product</h2>
      {error && <div className="alert alert-error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <div className="form-group">
            <label>Name *</label>
            <input type="text" value={form.name} onChange={e => set('name', e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Slug</label>
            <input type="text" value={form.slug} onChange={e => set('slug', e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Category</label>
            <select value={form.category_id} onChange={e => set('category_id', e.target.value)}>
              <option value="">— None —</option>
              {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label>Short Description</label>
          <input type="text" value={form.short_description} onChange={e => set('short_description', e.target.value)} />
        </div>
        <div className="form-group">
          <label>Description</label>
          <textarea value={form.description} onChange={e => set('description', e.target.value)} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Status</label>
            <select value={form.status} onChange={e => set('status', e.target.value)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div className="form-group">
            <label>Sort Order</label>
            <input type="number" value={form.sort_order} onChange={e => set('sort_order', e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label>
            <input type="checkbox" checked={form.featured == 1} onChange={e => set('featured', e.target.checked ? 1 : 0)} /> Featured
          </label>
        </div>

        <hr style={{ margin: '16px 0', borderColor: '#eee' }} />
        <h3 style={{ marginBottom: 12, fontSize: 14 }}>First Variant</h3>
        <div className="form-row">
          <div className="form-group">
            <label>Variant Name</label>
            <input type="text" value={form.variant_name} onChange={e => set('variant_name', e.target.value)} />
          </div>
          <div className="form-group">
            <label>SKU</label>
            <input type="text" value={form.sku} onChange={e => set('sku', e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Selling Price</label>
            <input type="number" step="0.01" value={form.selling_price} onChange={e => set('selling_price', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Unit</label>
            <input type="text" value={form.unit} onChange={e => set('unit', e.target.value)} placeholder="pcs, kg, g…" />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Stock</label>
            <input type="number" step="0.01" value={form.stock} onChange={e => set('stock', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Reorder Level</label>
            <input type="number" step="0.01" value={form.reorder_level} onChange={e => set('reorder_level', e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button type="submit" className="btn btn-save" disabled={saving}>{saving ? 'Saving…' : 'Save Product'}</button>
          <button type="button" className="btn btn-clear" onClick={() => navigate('/products')}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
