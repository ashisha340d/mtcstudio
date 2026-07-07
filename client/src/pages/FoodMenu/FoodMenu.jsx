import { useState, useEffect, useRef } from 'react';
import { productsApi } from '../../services/api';
import { getLookupMaster } from '../../services/posApi';
import { useMsg } from '../../hooks/useApi';
import MediaPicker from '../../components/MediaPicker/MediaPicker';
import BadgeMultiSelect from './BadgeMultiSelect';
import './FoodMenu.css';

const STOREFRONT_CATS = [
  'Ready Made Cakes', 'Pastries', 'Muffins', 'Cookies',
  'Bread', 'Desserts', "Today's Specials",
];

// Keyboard-navigable columns for each context
const P_COLS = ['name', 'short_description', 'description', 'category_id', 'storefront_category', 'status'];
const V_COLS = ['name', 'selling_price', 'status'];

// ── localStorage helpers ──────────────────────────────────────────────────────
function lsGet(key, def) {
  try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : def; } catch { return def; }
}
function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { } }

// products.badge is a comma-separated list of lookup_master PRODUCT_BADGE codes (e.g. "VEG,SPICY")
function parseBadges(str) {
  return String(str || '').split(',').map(s => s.trim()).filter(Boolean);
}

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCsv(text) {
  const rows = text.trim().split(/\r?\n/);
  const headers = rows[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  return rows.slice(1).filter(r => r.trim()).map(row => {
    const vals = row.split(',').map(v => v.replace(/^"|"$/g, '').trim());
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  });
}

// ── Variant Grid ──────────────────────────────────────────────────────────────
function VariantGrid({ product, dirtyVariantIds, setRef, onUpdate, onDelete, onAdd, makeKeyHandler }) {
  const variants = product.variants || [];
  return (
    <div className="fm-variant-wrap" >
      <table className="fm-variant-table">
        <thead>
          <tr>
            <th style={{ minWidth: 100 }}>Name</th>
            <th style={{ width: 80 }}>Price</th>
            <th style={{ width: 80 }}>Status</th>
            <th style={{ width: 90 }}>🌐 Online</th>
            <th style={{ width: 250 }}></th>
          </tr>
        </thead>
        <tbody>
          {variants.map(v => {
            const isDirty = dirtyVariantIds?.has(v.id);
            return (
              <tr key={v.id} className={isDirty ? 'fm-row-dirty' : ''}>
                {V_COLS.map((col, ci) => {
                  const refKey = `v-${v.id}-${ci}`;
                  if (col === 'status') return (
                    <td key={col}>
                      <select ref={el => setRef(refKey, el)} className="cell"
                        value={v[col] ?? 'active'}
                        onChange={e => onUpdate(product.id, v.id, col, e.target.value)}
                        onKeyDown={makeKeyHandler(product.id, v.id, ci, variants)}
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </td>
                  );
                  return (
                    <td key={col}>
                      <input ref={el => setRef(refKey, el)} className="cell"
                        type={col.includes('price') || col === 'stock' ? 'number' : 'text'}
                        value={v[col] ?? ''}
                        onChange={e => onUpdate(product.id, v.id, col, e.target.value)}
                        onKeyDown={makeKeyHandler(product.id, v.id, ci, variants)}
                        onFocus={e => e.target.select()}
                      />
                    </td>
                  );
                })}
                <td>
                  <button
                    onClick={() => onUpdate(product.id, v.id, 'show_online', v.show_online ? 0 : 1)}
                    title="Toggle Storefront visibility"
                    style={{
                      padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                      border: 'none', cursor: 'pointer',
                      background: v.show_online ? '#0f766e' : '#e5e7eb',
                      color: v.show_online ? '#fff' : '#6b7280',
                    }}
                  >
                    {v.show_online ? 'Online' : 'Off'}
                  </button>
                </td>
                <td>
                  <button className="btn btn-sm btn-delete" onClick={() => onDelete(product.id, v.id)}>✕</button>
                </td>
              </tr>
            );
          })}
          {!variants.length && (
            <tr><td colSpan={5} className="fm-variant-empty">No variants — add one below</td></tr>
          )}
        </tbody>
      </table>
      <button className="btn btn-sm btn-add fm-add-variant-btn" onClick={() => onAdd(product.id)}>
        + Add Variant
      </button>
    </div>
  );
}

function imgSrc(raw) {
  if (!raw) return null;
  const str = typeof raw === 'object' ? raw.filename : raw;
  if (!str) return null;
  if (str.startsWith('http')) return str;
  if (str.startsWith('/uploads/')) return str;
  const filename = str.replace(/\\/g, '/').split('/').pop();
  if (!filename) return null;
  return `/uploads/${filename}`;
}

// ── Card View ─────────────────────────────────────────────────────────────────
function CardView({ items, categories, badgeOptions, dirtyProducts, selectedIds, onUpdateProduct, onDeleteProduct, onPickImage, onToggleSel }) {
  return (
    <div className="fm-card-grid">
      {items.map(p => (
        <div key={p.id} className={[
          'fm-card',
          dirtyProducts.has(p.id) ? 'fm-card-dirty' : '',
          selectedIds.has(p.id) ? 'fm-card-selected' : '',
        ].filter(Boolean).join(' ')}>
          <div className="fm-card-img" onClick={() => onPickImage(p.id)}>
            {imgSrc(p.primary_image)
              ? <img src={imgSrc(p.primary_image)} alt={p.name} onError={e => e.target.style.display = 'none'} />
              : <span className="fm-card-no-img">📷</span>}
            <div className="fm-card-img-overlay">Replace Image</div>
          </div>
          <div className="fm-card-body">
            <input className="cell fm-card-name" value={p.name}
              onChange={e => onUpdateProduct(p.id, 'name', e.target.value)}
              placeholder="Item name"
            />
            <input className="cell" value={p.short_description || ''}
              onChange={e => onUpdateProduct(p.id, 'short_description', e.target.value)}
              placeholder="Short description"
              style={{ fontSize: 12 }}
            />
            <textarea className="cell" value={p.description || ''}
              onChange={e => onUpdateProduct(p.id, 'description', e.target.value)}
              placeholder="Description"
              rows={2}
              style={{ fontSize: 12, resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
            />
            <select className="cell fm-card-cat" value={p.category_id || ''}
              onChange={e => onUpdateProduct(p.id, 'category_id', e.target.value)}
            >
              <option value="">No category</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <BadgeMultiSelect
              options={badgeOptions}
              value={parseBadges(p.badge)}
              onChange={codes => onUpdateProduct(p.id, 'badge', codes.join(','))}
              placeholder="Add badges…"
            />
            <div className="fm-card-footer">
              <select className="cell" value={p.status}
                onChange={e => onUpdateProduct(p.id, 'status', e.target.value)}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              <button className={`fm-star${p.featured ? ' fm-star-on' : ''}`}
                onClick={() => onUpdateProduct(p.id, 'featured', !p.featured)}
              >{p.featured ? '★' : '☆'}</button>
              <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => onToggleSel(p.id)} />
              <button className="btn btn-sm btn-delete" onClick={() => onDeleteProduct(p.id)}>✕</button>
            </div>
          </div>
        </div>
      ))}
      {!items.length && <div className="fm-empty">No items found.</div>}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function FoodMenu() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [badgeOptions, setBadgeOptions] = useState([]);
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);

  // Persistent filters
  const [search, setSearch] = useState(() => lsGet('fm_search', ''));
  const [catFilter, setCatFilter] = useState(() => lsGet('fm_cat', ''));
  const [statFilter, setStatFilter] = useState(() => lsGet('fm_stat', ''));
  // CRUD grid defaults to newest record on top (last added first).
  // Migrate the previous 'sort_order' default so existing installs upgrade too.
  const [sort, setSort] = useState(() => {
    const v = lsGet('fm_sort', 'id');
    return v === 'sort_order' ? 'id' : v;
  });
  const [sortDir, setSortDir] = useState(() => {
    const prev = lsGet('fm_sort', 'id');
    return prev === 'sort_order' ? 'desc' : lsGet('fm_sortDir', 'desc');
  });
  const [page, setPage] = useState(() => lsGet('fm_page', 1));
  const [viewMode, setViewMode] = useState(() => lsGet('fm_view', 'table'));
  const [expandedIds, setExpandedIds] = useState(() => new Set(lsGet('fm_expanded', [])));

  // Transient UI state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [dirtyProducts, setDirtyProducts] = useState(new Set());
  const [dirtyVariants, setDirtyVariants] = useState({});
  const [pickerFor, setPickerFor] = useState(null);
  const [importModal, setImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [bulkSel, setBulkSel] = useState('');
  const [dragSrc, setDragSrc] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [groupByCat, setGroupByCat] = useState(() => lsGet('fm_groupByCat', false));
  const [dragSrcId, setDragSrcId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [syncModal, setSyncModal] = useState(null); // null | { status: 'running'|'done'|'error', result?, error? }

  const { msg, showMsg } = useMsg();
  const cellRefs = useRef({});
  const importFile = useRef(null);

  // Persist filters
  useEffect(() => { lsSet('fm_search', search); }, [search]);
  useEffect(() => { lsSet('fm_cat', catFilter); }, [catFilter]);
  useEffect(() => { lsSet('fm_stat', statFilter); }, [statFilter]);
  useEffect(() => { lsSet('fm_sort', sort); }, [sort]);
  useEffect(() => { lsSet('fm_sortDir', sortDir); }, [sortDir]);
  useEffect(() => { lsSet('fm_page', page); }, [page]);
  useEffect(() => { lsSet('fm_view', viewMode); }, [viewMode]);
  useEffect(() => { lsSet('fm_expanded', [...expandedIds]); }, [expandedIds]);

  // ── Data loading ───────────────────────────────────────────────────────────
  async function load(overrides = {}) {
    setLoading(true);
    try {
      const params = {
        search, category: catFilter, status: statFilter,
        sort, sort_dir: sortDir, page, per_page: 50,
        ...overrides,
      };
      const res = await productsApi.list(params);
      setItems(res.data.products || []);
      setCategories(res.data.categories || []);
      setMeta({ total: res.data.total || 0, totalPages: res.data.totalPages || 1 });
    } catch (e) {
      showMsg(e.response?.data?.error || e.message, false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Load the badge catalogue once — lookup_master rows are managed elsewhere (File Maintenance)
  useEffect(() => {
    getLookupMaster('PRODUCT_BADGE')
      .then(rows => setBadgeOptions(
        (rows || [])
          .filter(r => r.is_active)
          .map(r => ({ code: r.code, name: r.name, icon: r.value || '' }))
      ))
      .catch(() => {});
  }, []);

  // Global Ctrl/Cmd+S
  useEffect(() => {
    const h = e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveAll(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [items, dirtyProducts, dirtyVariants]);

  // ── Field mutations ────────────────────────────────────────────────────────
  function updateProduct(id, field, value) {
    setItems(prev => prev.map(p => {
      if (p.id !== id) return p;
      const updated = { ...p, [field]: value };
      // Auto-generate slug when name changes
      if (field === 'name') {
        updated.slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      }
      return updated;
    }));
    setDirtyProducts(prev => new Set([...prev, id]));
  }

  function updateVariant(productId, variantId, field, value) {
    setItems(prev => prev.map(p => p.id !== productId ? p : {
      ...p, variants: p.variants?.map(v => v.id === variantId ? { ...v, [field]: value } : v),
    }));
    setDirtyVariants(prev => ({
      ...prev,
      [productId]: new Set([...(prev[productId] || []), variantId]),
    }));
  }

  // ── Add rows ───────────────────────────────────────────────────────────────
  function addRow() {
    const id = 'new_' + Date.now();
    const vid = 'new_v_' + Date.now();
    const defaultVariant = { id: vid, name: 'Regular', sku: '', selling_price: '', cost_price: '', stock: 0, unit: 'pcs', status: 'active', show_online: 1 };
    const newItem = { id, name: '', slug: '', category_id: '', status: 'active', featured: false, sort_order: 0, primary_image: null, badge: '', variants: [defaultVariant] };
    setItems(prev => [newItem, ...prev]);
    setDirtyProducts(prev => new Set([...prev, id]));
    setDirtyVariants(prev => ({ ...prev, [id]: new Set([vid]) }));
    setTimeout(() => { const el = cellRefs.current[`p-${id}-0`]; el?.focus(); el?.select?.(); }, 60);
  }

  function handleInlinePrice(p, value) {
    if (!p.variants?.length) {
      const vid = 'new_v_' + Date.now();
      const v = { id: vid, name: 'Regular', sku: '', selling_price: value, cost_price: '', stock: 0, unit: 'pcs', status: 'active', show_online: 1 };
      setItems(prev => prev.map(item => item.id === p.id ? { ...item, variants: [v] } : item));
      setDirtyVariants(prev => ({ ...prev, [p.id]: new Set([...(prev[p.id] || []), vid]) }));
    } else {
      updateVariant(p.id, p.variants[0].id, 'selling_price', value);
    }
  }

  function addVariant(productId) {
    const id = 'new_' + Date.now();
    const v = { id, name: '', sku: '', selling_price: '', cost_price: '', stock: 0, unit: 'pcs', status: 'active' };
    setItems(prev => prev.map(p => p.id !== productId ? p : { ...p, variants: [...(p.variants || []), v] }));
    setDirtyVariants(prev => ({ ...prev, [productId]: new Set([...(prev[productId] || []), id]) }));
    setTimeout(() => { const el = cellRefs.current[`v-${id}-0`]; el?.focus(); el?.select?.(); }, 60);
  }

  // ── Save All ───────────────────────────────────────────────────────────────
  async function saveAll() {
    const dirtyPList = items.filter(p => dirtyProducts.has(p.id));
    const varEntries = Object.entries(dirtyVariants);
    if (!dirtyPList.length && !varEntries.length) return;

    // Local mirror so ID remaps are visible within this async function
    let localItems = [...items];
    const idMap = {};  // tempId → realId

    try {
      for (const p of dirtyPList) {
        if (String(p.id).startsWith('new_')) {
          const res = await productsApi.create(p);
          const realId = res.data.product?.id;
          if (realId) {
            idMap[p.id] = realId;
            localItems = localItems.map(item => item.id === p.id ? { ...item, id: realId } : item);
          }
        } else {
          await productsApi.update(p.id, p);
        }
      }

      for (const [productId, vidSet] of varEntries) {
        const realProductId = idMap[productId] ?? productId;
        // Look up by original temp ID or remapped real ID
        const product = localItems.find(p => String(p.id) === String(realProductId))
          ?? localItems.find(p => String(p.id) === String(productId));
        if (!product) continue;
        for (const vid of vidSet) {
          const variant = product.variants?.find(v => String(v.id) === String(vid));
          if (!variant) continue;
          if (String(vid).startsWith('new_')) {
            await productsApi.addVariant(realProductId, variant);
          } else {
            await productsApi.updateVariant(realProductId, vid, variant);
          }
        }
      }

      setDirtyProducts(new Set());
      setDirtyVariants({});
      const n = dirtyPList.length + varEntries.reduce((s, [, v]) => s + v.size, 0);
      showMsg(`Saved ${n} change${n !== 1 ? 's' : ''}!`);
      load();  // Reload from server so all IDs are real and state is clean
    } catch (e) {
      showMsg(e.response?.data?.error || e.message, false);
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  async function deleteProduct(id) {
    if (String(id).startsWith('new_')) {
      setItems(prev => prev.filter(p => p.id !== id));
      setDirtyProducts(prev => { const n = new Set(prev); n.delete(id); return n; });
      return;
    }
    if (!window.confirm('Delete this item?')) return;
    try {
      await productsApi.remove(id);
      setItems(prev => prev.filter(p => p.id !== id));
      showMsg('Deleted');
    } catch (e) { showMsg(e.response?.data?.error || e.message, false); }
  }

  async function deleteVariant(productId, variantId) {
    if (String(variantId).startsWith('new_')) {
      setItems(prev => prev.map(p => p.id !== productId ? p : { ...p, variants: p.variants.filter(v => v.id !== variantId) }));
      return;
    }
    if (!window.confirm('Delete variant?')) return;
    try {
      await productsApi.removeVariant(productId, variantId);
      setItems(prev => prev.map(p => p.id !== productId ? p : { ...p, variants: p.variants.filter(v => v.id !== variantId) }));
    } catch (e) { showMsg(e.response?.data?.error || e.message, false); }
  }

  // ── Bulk actions ───────────────────────────────────────────────────────────
  async function runBulk() {
    if (!bulkSel || !selectedIds.size) return;
    if (bulkSel === 'delete' && !window.confirm(`Delete ${selectedIds.size} item(s)?`)) return;
    try {
      await productsApi.bulkAction({ ids: [...selectedIds], action: bulkSel });
      showMsg('Done!');
      setSelectedIds(new Set());
      setBulkSel('');
      load();
    } catch (e) { showMsg(e.response?.data?.error || e.message, false); }
  }

  // ── Expand / Select ────────────────────────────────────────────────────────
  const toggleExpand = id => setExpandedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const expandAll = () => setExpandedIds(new Set(items.map(p => p.id)));
  const collapseAll = () => setExpandedIds(new Set());
  const toggleSel = id => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelectedIds(prev => prev.size === items.length ? new Set() : new Set(items.map(p => p.id)));

  // ── Image ──────────────────────────────────────────────────────────────────
  function onImageSelect(item) {
    if (!pickerFor) return;
    setItems(prev => prev.map(p => p.id === pickerFor ? { ...p, primary_image: item.url || item.filename } : p));
    setDirtyProducts(prev => new Set([...prev, pickerFor]));
    productsApi.setImage(pickerFor, { media_id: item.id, is_primary: true }).catch(() => { });
    setPickerFor(null);
  }

  // ── Sort / Filter ──────────────────────────────────────────────────────────
  function handleSort(col) {
    const dir = sort === col && sortDir === 'asc' ? 'desc' : 'asc';
    setSort(col); setSortDir(dir);
    load({ sort: col, sort_dir: dir });
  }

  function applyFilter(key, val) {
    if (key === 'cat') { setCatFilter(val); load({ category: val, page: 1 }); }
    if (key === 'stat') { setStatFilter(val); load({ status: val, page: 1 }); }
    setPage(1);
  }

  // ── Import / Export ────────────────────────────────────────────────────────
  function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try { setImportPreview(parseCsv(ev.target.result)); setImportModal(true); }
      catch { showMsg('Invalid CSV file', false); }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function confirmImport() {
    const formData = new FormData();
    formData.append('file', importFile.current.files[0]);
    try {
      await productsApi.importCsv(formData);
      showMsg('Imported successfully!');
      setImportModal(false); setImportPreview(null); load();
    } catch (e) { showMsg(e.response?.data?.error || e.message, false); }
  }

  function handleExport() {
    const p = new URLSearchParams({ search, category: catFilter, status: statFilter });
    window.open(`/api/products/export?${p}`, '_blank');
  }

  async function handleSyncCatalog() {
    setSyncModal({ status: 'running' });
    try {
      const res = await productsApi.syncCatalog();
      setSyncModal({ status: 'done', result: res.data });
    } catch (e) {
      setSyncModal({ status: 'error', error: e.response?.data?.error || e.message });
    }
  }

  // ── Keyboard navigation ────────────────────────────────────────────────────
  function setRef(key, el) {
    if (el) cellRefs.current[key] = el;
    else delete cellRefs.current[key];
  }

  function focusCell(key) {
    const el = cellRefs.current[key];
    if (!el) return;
    el.focus(); el.select?.();
  }

  function makeProductKeyHandler(productId, colIdx) {
    return e => {
      const rIdx = items.findIndex(p => p.id === productId);
      // Enter: move right (or wrap to next row)
      // Shift+Enter: move left (or wrap to previous row)
      // ArrowDown: move to same col, next row
      // ArrowUp: move to same col, previous row
      let c = colIdx, r = rIdx, handled = false;

      if (e.key === 'Enter') {
        handled = true;
        const step = e.shiftKey ? -1 : 1;
        c = colIdx + step;
        if (c >= P_COLS.length) { c = 0; r = Math.min(r + 1, items.length - 1); }
        if (c < 0) { c = P_COLS.length - 1; r = Math.max(r - 1, 0); }
      }
      /*else if (e.key === 'ArrowDown') {
        handled = true;
        r = Math.min(r + 1, items.length - 1);
      }
      else if (e.key === 'ArrowUp') {
        handled = true;
        r = Math.max(r - 1, 0);
      }*/

      if (handled) {
        e.preventDefault();
        focusCell(`p-${items[r].id}-${c}`);
      }
    };
  }

  function makeVariantKeyHandler(productId, variantId, colIdx, variants) {
    return e => {
      const vIdx = variants.findIndex(v => v.id === variantId);
      let c = colIdx, vi = vIdx, handled = false;

      if (e.key === 'Enter') {
        handled = true;
        const step = e.shiftKey ? -1 : 1;
        c = colIdx + step;
        if (c >= V_COLS.length) { c = 0; vi = Math.min(vi + 1, variants.length - 1); }
        if (c < 0) { c = V_COLS.length - 1; vi = Math.max(vi - 1, 0); }
      } else if (e.key === 'ArrowDown') {
        handled = true;
        vi = Math.min(vi + 1, variants.length - 1);
      } else if (e.key === 'ArrowUp') {
        handled = true;
        vi = Math.max(vi - 1, 0);
      }

      if (handled) {
        e.preventDefault();
        focusCell(`v-${variants[vi].id}-${c}`);
      }
    };
  }

  // ── Drag and Drop ──────────────────────────────────────────────────────────
  function onDragStart(e, idx) {
    setDragSrc(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  }
  function onDragOver(e, idx) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOver !== idx) setDragOver(idx);
  }
  function onDragEnd() { setDragSrc(null); setDragOver(null); }
  function onDrop(e, idx) {
    e.preventDefault();
    if (dragSrc === null || dragSrc === idx) { onDragEnd(); return; }
    setItems(prev => {
      const arr = [...prev];
      const [moved] = arr.splice(dragSrc, 1);
      arr.splice(idx, 0, moved);
      arr.forEach((item, i) => { item.sort_order = i + 1; });
      setDirtyProducts(dp => new Set([...dp, ...arr.map(p => p.id)]));
      return arr;
    });
    onDragEnd();
  }

  // ── Computed ───────────────────────────────────────────────────────────────
  const dirtyCount = dirtyProducts.size + Object.values(dirtyVariants).reduce((s, v) => s + v.size, 0);

  function getPriceRange(variants) {
    if (!variants || variants.length === 0) return null;
    const prices = variants.map(v => parseFloat(v.selling_price) || 0).filter(p => p > 0);
    if (prices.length === 0) return null;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return min === max ? `Rs.${min.toFixed(2)}` : `Rs.${min.toFixed(2)} - Rs.${max.toFixed(2)}`;
  }

  function SortTh({ col, label, style }) {
    const active = sort === col;
    return (
      <th className="sortable-th" style={style} onClick={() => handleSort(col)}>
        {label}{active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
      </th>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fm-root" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden', width: '100%' }}>

      {/* ── Toolbar ── */}
      <div className="toolbar fm-toolbar">
        <div className="fm-tb-left">
          <form className="fm-search-form" onSubmit={e => { e.preventDefault(); load(); }}>
            <input
              type="text" value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, SKU, description…"
            />
            <button type="submit" className="btn btn-primary">Search</button>
            {search && (
              <button type="button" className="btn btn-clear" onClick={() => { setSearch(''); load({ search: '' }); }}>✕</button>
            )}
          </form>
          <select value={catFilter} onChange={e => applyFilter('cat', e.target.value)}>
            <option value="">All Categories</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={statFilter} onChange={e => applyFilter('stat', e.target.value)}>
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="fm-tb-right">
          <div className="fm-view-seg">
            <button className={viewMode === 'table' ? 'active' : ''} onClick={() => setViewMode('table')} title="Table view">☰</button>
            <button className={viewMode === 'card' ? 'active' : ''} onClick={() => setViewMode('card')} title="Card view">⊞</button>
          </div>
          <span className="fm-kbd-hint" title="Enter: next cell | Shift+Enter: prev cell | ↑↓: prev/next row">⌨️</span>
          <button className="btn btn-sm btn-clear" onClick={() => expandedIds.size > 0 ? collapseAll() : expandAll()} title="Toggle all rows">
            {expandedIds.size > 0 ? '⊖ Collapse All' : '⊕ Expand All'}
          </button>
          <button className="btn btn-add" onClick={addRow}>+ Add Item</button>
          <button
            className="btn btn-save"
            onClick={saveAll}
            disabled={dirtyCount === 0}
            style={{ opacity: dirtyCount === 0 ? 0.5 : 1 }}
          >
            Save All{dirtyCount > 0 ? ` (${dirtyCount})` : ''}
          </button>
          <input ref={importFile} type="file" accept=".csv,.xlsx" style={{ display: 'none' }} onChange={handleImportFile} />
          <button className="btn btn-sm btn-clear" onClick={() => importFile.current?.click()} title="Import CSV">↑ Import</button>
          <button className="btn btn-sm btn-clear" onClick={handleExport} title="Export CSV">↓ Export</button>
          <button className="btn btn-sm btn-primary" onClick={handleSyncCatalog} title="Sync catalogue to website database">⇅ Sync to Website</button>
        </div>
        {msg && <span className={`msg msg-${msg.ok ? 'ok' : 'err'}`}>{msg.text}</span>}
      </div>

      {/* ── Bulk action bar ── */}
      {selectedIds.size > 0 && (
        <div className="fm-bulk-bar">
          <span className="fm-bulk-count">{selectedIds.size} selected</span>
          <select value={bulkSel} onChange={e => setBulkSel(e.target.value)}>
            <option value="">Bulk Action…</option>
            <option value="featured_on">★ Featured ON</option>
            <option value="featured_off">☆ Featured OFF</option>
            <option value="activate">✓ Activate</option>
            <option value="deactivate">✗ Deactivate</option>
            <option value="delete">🗑 Delete</option>
          </select>
          <button className="btn btn-sm btn-primary" onClick={runBulk} disabled={!bulkSel}>Apply</button>
          <button className="btn btn-sm btn-clear" onClick={() => { setSelectedIds(new Set()); setBulkSel(''); }}>Clear</button>
        </div>
      )}

      {/* ── Main content ── */}
      {loading ? (
        <div className="fm-loading">Loading…</div>
      ) : viewMode === 'table' ? (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', width: '100%' }}>
          <table className="fm-table">
            <thead>
              <tr>
                <th className="fm-th-drag" title="Drag to reorder"></th>
                <th className="fm-th-check">
                  <input type="checkbox"
                    checked={selectedIds.size > 0 && selectedIds.size === items.length}
                    onChange={toggleAll}
                  />
                </th>
                <th className="fm-th-img">Image</th>
                <SortTh col="name" label="Name" />
                <SortTh col="category" label="Category" />
                <th className="fm-th-badges">Badges</th>
                <th>🌐 Live Shop</th>
                <SortTh col="status" label="Status" />
                <th className="fm-th-exp"></th>
                <th className="fm-th-act"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((p, rowIdx) => {
                const isDirty = dirtyProducts.has(p.id);
                const isExp = expandedIds.has(p.id);
                const isSel = selectedIds.has(p.id);
                const isDragSrc = dragSrc === rowIdx;
                const isDragOv = dragOver === rowIdx && dragSrc !== rowIdx;

                return [
                  <tr
                    key={p.id}
                    onDragOver={e => onDragOver(e, rowIdx)}
                    onDragEnd={onDragEnd}
                    onDrop={e => onDrop(e, rowIdx)}
                    className={[
                      isDirty ? 'fm-row-dirty' : '',
                      isSel ? 'fm-row-selected' : '',
                      isDragSrc ? 'fm-row-dragging' : '',
                      isDragOv ? 'fm-row-dragover' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    {/* Drag handle — only this initiates drag */}
                    <td
                      className="fm-drag-handle"
                      draggable
                      onDragStart={e => onDragStart(e, rowIdx)}
                      title="Drag to reorder"
                    >⠿</td>

                    {/* Checkbox */}
                    <td className="fm-td-check">
                      <input type="checkbox" checked={isSel} onChange={() => toggleSel(p.id)} />
                    </td>

                    {/* Image */}
                    <td className="fm-td-img">
                      <div className="fm-img-cell" onClick={() => setPickerFor(p.id)} title="Click to change image">
                        {imgSrc(p.primary_image)
                          ? <img src={imgSrc(p.primary_image)} alt="" className="fm-thumb" onError={e => e.target.style.display = 'none'} />
                          : <span className="fm-no-img">📷</span>}
                        <div className="fm-img-overlay">📷</div>
                      </div>
                    </td>
                    {/* Name / Desc stacked */}
                    <td className="fm-td-name">
                      <input
                        ref={el => setRef(`p-${p.id}-0`, el)}
                        className="cell fm-cell-name"
                        value={p.name}
                        placeholder="Item name"
                        onChange={e => updateProduct(p.id, 'name', e.target.value)}
                        onKeyDown={makeProductKeyHandler(p.id, 0)}
                        onFocus={e => e.target.select()}
                      />
                      <input
                        ref={el => setRef(`p-${p.id}-1`, el)}
                        className="cell fm-cell-sub"
                        value={p.short_description || ''}
                        placeholder="Short description"
                        onChange={e => updateProduct(p.id, 'short_description', e.target.value)}
                        onKeyDown={makeProductKeyHandler(p.id, 1)}
                      />
                      <textarea
                        ref={el => setRef(`p-${p.id}-2`, el)}
                        className="cell fm-cell-sub"
                        value={p.description || ''}
                        placeholder="Description"
                        rows={2}
                        onChange={e => updateProduct(p.id, 'description', e.target.value)}
                        onKeyDown={makeProductKeyHandler(p.id, 2)}
                        style={{ resize: 'vertical' }}
                      />
                    </td>
                    {/* Category */}
                    <td className="fm-td-cat">
                      <select
                        ref={el => setRef(`p-${p.id}-3`, el)}
                        className="cell"
                        value={p.category_id || ''}
                        onChange={e => updateProduct(p.id, 'category_id', e.target.value)}
                        onKeyDown={makeProductKeyHandler(p.id, 3)} >
                        <option value="">—</option>
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <button className={`fm-star${p.featured ? ' fm-star-on' : ''}`}
                        onClick={() => updateProduct(p.id, 'featured', !p.featured)}
                        title="Toggle featured"
                      >{p.featured ? '★' : '☆'}</button>
                    </td>

                    {/* Badges */}
                    <td className="fm-td-badges">
                      <BadgeMultiSelect
                        options={badgeOptions}
                        value={parseBadges(p.badge)}
                        onChange={codes => updateProduct(p.id, 'badge', codes.join(','))}
                        placeholder="Add badges…"
                      />
                    </td>

                    {/* Storefront Category + price (inline for single/none, range for multiple) */}
                    <td>
                      <select
                        ref={el => setRef(`p-${p.id}-4`, el)}
                        className="cell"
                        value={p.storefront_category || ''}
                        onChange={e => updateProduct(p.id, 'storefront_category', e.target.value)}
                        onKeyDown={makeProductKeyHandler(p.id, 4)}
                        style={{ color: p.storefront_category ? '#0f766e' : undefined }}
                      >
                        <option value="">— None —</option>
                        {STOREFRONT_CATS.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      {(!p.variants || p.variants.length <= 1) ? (
                        <input
                          type="number"
                          className="cell fm-inline-price"
                          value={p.variants?.[0]?.selling_price ?? ''}
                          placeholder="Rs. Price"
                          min="0"
                          step="0.01"
                          onChange={e => handleInlinePrice(p, e.target.value)}
                          onFocus={e => e.target.select()}
                        />
                      ) : (
                        <div className="fm-price-range" title="Click to expand and edit variants">
                          {getPriceRange(p.variants)}
                        </div>
                      )}
                    </td>

                    {/* Status */}
                    <td className="fm-td-status">
                      <select
                        ref={el => setRef(`p-${p.id}-5`, el)}
                        className="cell"
                        value={p.status}
                        onChange={e => updateProduct(p.id, 'status', e.target.value)}
                        onKeyDown={makeProductKeyHandler(p.id, 5)}
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </td>

                    {/* Expand toggle */}
                    <td className="fm-td-exp">
                      <button
                        className="fm-exp-btn"
                        onClick={() => toggleExpand(p.id)}
                        title={isExp ? 'Collapse variants' : 'Expand variants'}
                      >
                        {isExp ? '▼' : '▶'}
                        {p.variants?.length > 0 && <span className="fm-var-count">{p.variants.length}</span>}
                      </button>
                    </td>

                    {/* Delete */}
                    <td className="fm-td-act">
                      <button className="btn btn-sm btn-delete" onClick={() => deleteProduct(p.id)} title="Delete item">✕</button>
                    </td>
                  </tr>,

                  // Expanded variant grid row
                  isExp && (
                    <tr key={`exp-${p.id}`} className="fm-exp-row">
                      <td colSpan={12} className="fm-exp-td">
                        <VariantGrid
                          product={p}
                          dirtyVariantIds={dirtyVariants[p.id]}
                          setRef={setRef}
                          onUpdate={updateVariant}
                          onDelete={deleteVariant}
                          onAdd={addVariant}
                          makeKeyHandler={makeVariantKeyHandler}
                        />
                      </td>
                    </tr>
                  ),
                ];
              })}
              {!items.length && (
                <tr><td colSpan={12} className="fm-empty">No items found. <button className="btn btn-sm btn-add" onClick={addRow}>+ Add first item</button></td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <CardView
          items={items}
          categories={categories}
          badgeOptions={badgeOptions}
          dirtyProducts={dirtyProducts}
          selectedIds={selectedIds}
          onUpdateProduct={updateProduct}
          onDeleteProduct={deleteProduct}
          onPickImage={setPickerFor}
          onToggleSel={toggleSel}
        />
      )}

      {/* ── Footer / Pagination ── */}
      <div className="pager fm-pager" style={{ flexShrink: 0 }}>
        <span>Showing {items.length} of {meta.total} item{meta.total !== 1 ? 's' : ''}</span>
        {meta.totalPages > 1 && (
          <div className="fm-pages">
            <button className="btn btn-sm btn-clear" disabled={page <= 1}
              onClick={() => { const p = page - 1; setPage(p); load({ page: p }); }}>‹ Prev</button>
            <span>Page {page} / {meta.totalPages}</span>
            <button className="btn btn-sm btn-clear" disabled={page >= meta.totalPages}
              onClick={() => { const p = page + 1; setPage(p); load({ page: p }); }}>Next ›</button>
          </div>
        )}
        {dirtyCount > 0 && (
          <span className="fm-dirty-hint">{dirtyCount} unsaved change{dirtyCount !== 1 ? 's' : ''} — Ctrl+S to save all</span>
        )}
      </div>

      {/* ── MediaPicker modal ── */}
      {pickerFor && <MediaPicker onSelect={onImageSelect} onClose={() => setPickerFor(null)} />}

      {/* ── Import preview modal ── */}
      {importModal && (
        <div className="modal-overlay" onClick={() => setImportModal(false)}>
          <div className="fm-import-modal" onClick={e => e.stopPropagation()}>
            <div className="fm-import-header">
              <h3>Import Preview</h3>
              <span className="fm-import-count">{importPreview?.length} rows detected</span>
            </div>
            <div className="fm-import-scroll">
              {importPreview?.length > 0 && (
                <table>
                  <thead>
                    <tr>{Object.keys(importPreview[0]).map(h => <th key={h}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {importPreview.slice(0, 10).map((row, i) => (
                      <tr key={i}>{Object.values(row).map((v, j) => <td key={j}>{v}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              )}
              {importPreview?.length > 10 && (
                <p className="fm-import-more">…and {importPreview.length - 10} more rows not shown</p>
              )}
            </div>
            <div className="fm-import-actions">
              <button className="btn btn-primary" onClick={confirmImport}>Confirm Import</button>
              <button className="btn btn-clear" onClick={() => { setImportModal(false); setImportPreview(null); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sync to Website status modal ── */}
      {syncModal && (
        <div className="modal-overlay" onClick={() => syncModal.status !== 'running' && setSyncModal(null)}>
          <div className="fm-import-modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="fm-import-header">
              <h3>Sync to Website</h3>
            </div>
            {syncModal.status === 'running' && <p>Syncing catalogue to the website database…</p>}
            {syncModal.status === 'done' && (
              <table>
                <tbody>
                  <tr><td>Categories</td><td>{syncModal.result.categories}</td></tr>
                  <tr><td>Media Library</td><td>{syncModal.result.media_library}</td></tr>
                  <tr><td>Products</td><td>{syncModal.result.products}</td></tr>
                  <tr><td>Product Variants</td><td>{syncModal.result.product_variants}</td></tr>
                  <tr><td>Product Images</td><td>{syncModal.result.product_images}</td></tr>
                  <tr><td>Modifier Assignments</td><td>{syncModal.result.product_modifier_assignments}</td></tr>
                </tbody>
              </table>
            )}
            {syncModal.status === 'error' && (
              <p className="msg msg-err">Sync failed: {syncModal.error}</p>
            )}
            <div className="fm-import-actions">
              <button className="btn btn-clear" onClick={() => setSyncModal(null)} disabled={syncModal.status === 'running'}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
