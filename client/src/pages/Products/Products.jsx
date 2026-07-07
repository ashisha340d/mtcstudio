import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router';
import { productsApi } from '../../services/api';
import { useMsg } from '../../hooks/useApi';
import './Products.css';

export default function Products() {
  const [data, setData] = useState({ products: [], categories: [], total: 0, totalPages: 1, counts: {} });
  const [filters, setFilters] = useState({ search: '', category: '', status: '', featured: '', sort: 'sort_order', page: 1 });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const { msg, showMsg } = useMsg();
  const navigate = useNavigate();

  async function load(f = filters) {
    setLoading(true);
    try {
      const res = await productsApi.list(f);
      setData(res.data);
    } catch (e) {
      showMsg(e.response?.data?.error || e.message, false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function setFilter(key, val) {
    const next = { ...filters, [key]: val, page: 1 };
    setFilters(next);
    load(next);
  }

  function handleSearch(e) {
    e.preventDefault();
    load({ ...filters, page: 1 });
  }

  async function deleteProduct(id) {
    if (!window.confirm('Delete this product and all its variants?')) return;
    try {
      await productsApi.remove(id);
      showMsg('Deleted');
      load();
    } catch (e) {
      showMsg(e.response?.data?.error || e.message, false);
    }
  }

  async function bulkAction(action) {
    if (!selected.size) return;
    if (action === 'delete' && !window.confirm(`Delete ${selected.size} products?`)) return;
    try {
      await productsApi.bulkAction({ ids: [...selected], action, target: 'product' });
      setSelected(new Set());
      showMsg('Done');
      load();
    } catch (e) {
      showMsg(e.response?.data?.error || e.message, false);
    }
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === data.products.length) setSelected(new Set());
    else setSelected(new Set(data.products.map(p => p.id)));
  }

  const { products, categories, total, totalPages, counts } = data;

  return (
    <div>
      <div className="toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="text"
            value={filters.search}
            onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
            placeholder="Search products, SKU…"
            style={{ width: 200 }}
          />
          <button type="submit" className="btn btn-primary btn-sm">Search</button>
          {filters.search && <button type="button" className="btn btn-clear btn-sm" onClick={() => { const f = {...filters, search:'', page:1}; setFilters(f); load(f); }}>Clear</button>}
        </form>

        <select className="cell" style={{ width: 140 }} value={filters.category} onChange={e => setFilter('category', e.target.value)}>
          <option value="">All Categories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <select className="cell" style={{ width: 140 }} value={filters.status} onChange={e => setFilter('status', e.target.value)}>
          <option value="">All Status</option>
          <option value="active">Active ({counts.active || 0})</option>
          <option value="inactive">Inactive ({counts.inactive || 0})</option>
        </select>

        <select className="cell" style={{ width: 130 }} value={filters.featured} onChange={e => setFilter('featured', e.target.value)}>
          <option value="">All</option>
          <option value="1">Featured ({counts.featured || 0})</option>
          <option value="0">Not Featured</option>
        </select>

        <Link to="/products/new" className="btn btn-add btn-sm">+ Add Product</Link>
        <a href="/api/products/export" className="btn btn-sm" style={{ background: '#555', color: '#fff' }}>Export CSV</a>
        <a href="/api/products/template" className="btn btn-sm" style={{ background: '#555', color: '#fff' }}>Template</a>

        {selected.size > 0 && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#555' }}>{selected.size} selected</span>
            <button className="btn btn-sm btn-save" onClick={() => bulkAction('active')}>Active</button>
            <button className="btn btn-sm btn-warning" onClick={() => bulkAction('inactive')}>Inactive</button>
            <button className="btn btn-sm btn-delete" onClick={() => bulkAction('delete')}>Delete</button>
          </div>
        )}

        {msg && <span className={`msg msg-${msg.ok ? 'ok' : 'err'}`}>{msg.text}</span>}
      </div>

      <div className="table-wrap">
        {loading ? <p style={{ padding: 16 }}>Loading…</p> : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }}><input type="checkbox" checked={selected.size === products.length && products.length > 0} onChange={toggleAll} /></th>
                <th className="col-id">ID</th>
                <th>Image</th>
                <th>Name / SKU / Slug</th>
                <th>Short Description</th>
                <th>Description</th>
                <th>Category</th>
                <th>Price</th>
                <th>Status</th>
                <th>Featured</th>
                <th className="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => {
                const imgSrc = p.primary_image
                  ? (typeof p.primary_image === 'string' ? p.primary_image : `/uploads/${p.primary_image.filename}`)
                  : null;
                return (
                <tr key={p.id}>
                  <td><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} /></td>
                  <td className="col-id">{p.id}</td>
                  <td style={{ width: 50 }}>
                    {imgSrc && (
                      <img src={imgSrc} alt={p.name} style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }} onError={e => e.target.style.display = 'none'} />
                    )}
                  </td>
                  <td>
                    <div style={{ fontWeight: 'bold' }}>{p.name}</div>
                    {p.slug && <div style={{ fontSize: 11, color: '#aaa', marginTop: 1 }}>{p.slug}</div>}
                    {p.variants && p.variants.length > 0 && (
                      <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                        {p.variants.map(v => v.sku).filter(Boolean).join(', ')}
                      </div>
                    )}
                  </td>
                  <td style={{ maxWidth: 160 }}>
                    <div style={{ fontSize: 12, color: '#555', whiteSpace: 'pre-wrap' }}>{p.short_description || '—'}</div>
                  </td>
                  <td style={{ maxWidth: 200 }}>
                    <div style={{ fontSize: 12, color: '#555', maxHeight: 60, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.description || '—'}</div>
                  </td>
                  <td>{p.category_name || '—'}</td>
                  <td>
                    {p.variants && p.variants.length > 0 ? (
                      p.variants.length === 1
                        ? `Rs.${p.variants[0].selling_price}`
                        : `Rs.${Math.min(...p.variants.map(v => v.selling_price))}+`
                    ) : '—'}
                  </td>
                  <td><span className={`badge badge-${p.status}`}>{p.status}</span></td>
                  <td>{p.featured ? '★' : ''}</td>
                  <td className="col-actions">
                    <Link to={`/products/edit/${p.id}`} className="btn btn-sm btn-save">Edit</Link>{' '}
                    <button className="btn btn-sm btn-delete" onClick={() => deleteProduct(p.id)}>Del</button>
                  </td>
                </tr>
              )})}
              {products.length === 0 && (
                <tr><td colSpan={11} style={{ textAlign: 'center', padding: 20, color: '#aaa' }}>No products found</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="pager" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span>Showing {products.length} of {total} products</span>
        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: 4 }}>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(pg => (
              <button
                key={pg}
                className={`btn btn-sm ${filters.page === pg ? 'btn-primary' : 'btn-clear'}`}
                onClick={() => { const f = {...filters, page: pg}; setFilters(f); load(f); }}
              >{pg}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
