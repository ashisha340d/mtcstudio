import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { productsApi } from '../../services/api';
import { useMsg } from '../../hooks/useApi';
import MediaPicker from '../../components/MediaPicker/MediaPicker';

export default function ProductEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { msg, showMsg } = useMsg();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cats, setCats] = useState([]);
  const [variants, setVariants] = useState([]);
  const [images, setImages] = useState([]);
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState(null);

  const [form, setForm] = useState({
    name: '', slug: '', category_id: '',
    short_description: '', description: '', featured: 0, status: 'active', sort_order: 0
  });

  useEffect(() => {
    productsApi.get(id).then(res => {
      const { product, categories } = res.data;
      setForm({
        name: product.name, slug: product.slug || '', category_id: product.category_id || '',
        short_description: product.short_description || '',
        description: product.description || '', featured: product.featured, status: product.status,
        sort_order: product.sort_order
      });
      setVariants(product.variants || []);
      setImages(product.images || []);
      setCats(categories);
    }).finally(() => setLoading(false));
  }, [id]);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function saveProduct(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await productsApi.update(id, form);
      showMsg('Saved!');
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setSaving(false); }
  }

  function updateVariant(vid, key, val) {
    setVariants(prev => prev.map(v => v.id === vid ? { ...v, [key]: val } : v));
  }

  async function saveVariant(v) {
    try {
      await productsApi.updateVariant(id, v.id, v);
      showMsg('Variant saved!');
    } catch (e) {
      showMsg(e.response?.data?.error || e.message, false);
    }
  }

  async function deleteVariant(vid) {
    if (!window.confirm('Delete this variant?')) return;
    try {
      await productsApi.removeVariant(id, vid);
      setVariants(prev => prev.filter(v => v.id !== vid));
      showMsg('Deleted');
    } catch (e) {
      showMsg(e.response?.data?.error || e.message, false);
    }
  }

  async function addVariant() {
    try {
      const res = await productsApi.addVariant(id, { name: 'New Variant', selling_price: 0, status: 'active' });
      setVariants(prev => [...prev, { id: res.data.variant_id, name: 'New Variant', sku: '', selling_price: 0, cost_price: 0, stock: 0, reorder_level: 0, unit: '', status: 'active', sort_order: 0 }]);
    } catch (e) {
      showMsg(e.response?.data?.error || e.message, false);
    }
  }

  async function setImage(mediaId) {
    try {
      await productsApi.setImage(id, { media_id: mediaId });
      setImages(prev => prev.map(img => ({ ...img, is_primary: img.media_id === mediaId ? 1 : 0 })));
      if (mediaId && !images.find(i => i.media_id === mediaId)) {
        productsApi.get(id).then(res => setImages(res.data.product.images || []));
      }
      showMsg('Image set!');
    } catch (e) {
      showMsg(e.response?.data?.error || e.message, false);
    }
    setShowPicker(false);
  }

  if (loading) return <p style={{ padding: 20 }}>Loading…</p>;

  return (
    <div className="product-form">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>Edit Product #{id}</h2>
        <button className="btn btn-clear btn-sm" onClick={() => navigate('/products')}>← Back</button>
      </div>

      {msg && <div className={`alert alert-${msg.ok ? 'success' : 'error'}`}>{msg.text}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={saveProduct}>
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
        <button type="submit" className="btn btn-save" disabled={saving}>{saving ? 'Saving…' : 'Save Product'}</button>
      </form>

      {/* Images */}
      <div style={{ marginTop: 28 }}>
        <h3 style={{ fontSize: 14, marginBottom: 10 }}>Product Images</h3>
        <div className="img-grid">
          {images.map(img => (
            <img
              key={img.id}
              className={`img-thumb${img.is_primary ? ' primary' : ''}`}
              src={`/uploads/${img.filename}`}
              alt={img.alt_text || img.title}
              title={img.is_primary ? 'Primary image' : 'Click to set as primary'}
              onClick={() => setImage(img.media_id)}
            />
          ))}
          <button className="btn btn-add btn-sm" onClick={() => setShowPicker(true)}>+ Add Image</button>
        </div>
      </div>

      {/* Variants */}
      <div className="variants-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ fontSize: 14 }}>Variants</h3>
          <button className="btn btn-add btn-sm" onClick={addVariant}>+ Add Variant</button>
        </div>
        <div className="table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th><th>SKU</th><th>Price</th><th>Cost</th><th>Stock</th><th>Unit</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {variants.map(v => (
                <tr key={v.id}>
                  <td><input className="cell" value={v.name} onChange={e => updateVariant(v.id, 'name', e.target.value)} /></td>
                  <td><input className="cell" value={v.sku || ''} onChange={e => updateVariant(v.id, 'sku', e.target.value)} /></td>
                  <td><input className="cell" type="number" step="0.01" value={v.selling_price} onChange={e => updateVariant(v.id, 'selling_price', e.target.value)} /></td>
                  <td><input className="cell" type="number" step="0.01" value={v.cost_price} onChange={e => updateVariant(v.id, 'cost_price', e.target.value)} /></td>
                  <td><input className="cell" type="number" step="0.01" value={v.stock} onChange={e => updateVariant(v.id, 'stock', e.target.value)} /></td>
                  <td><input className="cell" value={v.unit || ''} onChange={e => updateVariant(v.id, 'unit', e.target.value)} /></td>
                  <td>
                    <select className="cell" value={v.status} onChange={e => updateVariant(v.id, 'status', e.target.value)}>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </td>
                  <td>
                    <button className="btn btn-sm btn-save" onClick={() => saveVariant(v)}>Save</button>{' '}
                    <button className="btn btn-sm btn-delete" onClick={() => deleteVariant(v.id)}>Del</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showPicker && (
        <MediaPicker
          onSelect={m => setImage(m.id)}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
