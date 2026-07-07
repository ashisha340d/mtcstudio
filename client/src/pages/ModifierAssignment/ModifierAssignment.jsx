'use client';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import axios from 'axios';
import './ModifierAssignment.css';

const API = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'X-Session-ID': 'dev-session' },
});

// Deterministic category badge color from name
const BADGE_COLORS = [
  { bg: '#dcfce7', text: '#166534' },
  { bg: '#dbeafe', text: '#1e40af' },
  { bg: '#fef9c3', text: '#854d0e' },
  { bg: '#fce7f3', text: '#9d174d' },
  { bg: '#f3e8ff', text: '#6b21a8' },
  { bg: '#ffedd5', text: '#9a3412' },
  { bg: '#e0f2fe', text: '#075985' },
  { bg: '#d1fae5', text: '#065f46' },
  { bg: '#fef3c7', text: '#92400e' },
  { bg: '#ede9fe', text: '#4c1d95' },
];
function categoryColor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return BADGE_COLORS[Math.abs(h) % BADGE_COLORS.length];
}

function useDebounce(value, delay = 200) {
  const [dv, setDv] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDv(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return dv;
}

function ProductRow({ p, checkedIds, expandedIds, removingKey, modifierById, toggleProduct, toggleExpand, removeAssignment, categoryColor }) {
  const checked        = checkedIds.has(p.id);
  const expanded       = expandedIds.has(p.id);
  const color          = categoryColor(p.category_name ?? '');
  const assignedIds    = p.assigned_modifier_ids ?? [];
  const hasAssignments = assignedIds.length > 0;

  return (
    <div className="ma-product-block">
      <div
        className={`ma-product-row ${checked ? 'ma-product-row-checked' : ''}`}
        onClick={() => toggleProduct(p.id)}
        onKeyDown={e => e.key === ' ' && (e.preventDefault(), toggleProduct(p.id))}
        tabIndex={0}
        role="checkbox"
        aria-checked={checked}
      >
        <span className="ma-col-check">
          <span className={`ma-checkbox ${checked ? 'ma-checkbox-checked' : ''}`}>
            {checked && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
          </span>
        </span>
        <span className="ma-col-star">
          {hasAssignments && (
            <button
              className={`ma-expand-btn ${expanded ? 'ma-expand-btn-open' : ''}`}
              onClick={e => toggleExpand(p.id, e)}
              title={expanded ? 'Hide assigned modifiers' : `${assignedIds.length} modifier(s) — click to view`}
              aria-label="Toggle assigned modifiers"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points={expanded ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
              </svg>
              <span className="ma-expand-count">{assignedIds.length}</span>
            </button>
          )}
        </span>
        <span className="ma-col-name ma-product-name">{p.name}</span>
        <span className="ma-col-cat">
          {p.category_name && (
            <span className="ma-cat-badge" style={{ background: color.bg, color: color.text }}>
              {p.category_name}
            </span>
          )}
        </span>
      </div>

      {expanded && hasAssignments && (
        <div className="ma-assigned-list">
          {assignedIds.map(mid => {
            const mod = modifierById[mid];
            const key = `${p.id}-${mid}`;
            const removing = removingKey === key;
            return (
              <span key={mid} className={`ma-assigned-tag ${removing ? 'ma-assigned-tag-removing' : ''}`}>
                {mod ? mod.name : `#${mid}`}
                {mod?.group_name && <span className="ma-assigned-group"> · {mod.group_name}</span>}
                <button
                  className="ma-assigned-remove"
                  onClick={e => removeAssignment(p.id, mid, e)}
                  disabled={removing}
                  aria-label={`Remove ${mod?.name ?? mid}`}
                >
                  {removing ? '…' : '×'}
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ModifierAssignment({ embedded = false }) {
  // ── data ────────────────────────────────────────────────────
  const [modifiers, setModifiers]       = useState([]);  // shared modifiers
  const [products, setProducts]         = useState([]);  // all products

  // ── left panel state ────────────────────────────────────────
  const [selected, setSelected]         = useState([]);  // selected modifier objects
  const [modSearch, setModSearch]       = useState('');
  const [dropOpen, setDropOpen]         = useState(false);
  const [dropIdx, setDropIdx]           = useState(0);
  const inputRef                        = useRef(null);
  const dropRef                         = useRef(null);

  // ── right panel state ───────────────────────────────────────
  const [productSearch, setProductSearch] = useState('');
  const [checkedIds, setCheckedIds]       = useState(new Set());
  const [replaceMode, setReplaceMode]     = useState(false);
  const [expandedIds, setExpandedIds]     = useState(new Set());
  const [assignedOpen, setAssignedOpen]   = useState(true);
  const [unassignedOpen, setUnassignedOpen] = useState(true);
  const [removingKey, setRemovingKey]     = useState(null); // `${pid}-${mid}`

  // ── ui state ────────────────────────────────────────────────
  const [saving, setSaving]             = useState(false);
  const [toast, setToast]               = useState(null);

  const debouncedModSearch     = useDebounce(modSearch, 150);
  const debouncedProductSearch = useDebounce(productSearch, 150);

  // ── load data ───────────────────────────────────────────────
  useEffect(() => {
    API.get('/food-menu/shared-modifiers').then(r => setModifiers(r.data)).catch(() => {});
    API.get('/food-menu/products-with-assignments').then(r => setProducts(r.data)).catch(() => {});
  }, []);

  // ── dropdown modifier results ────────────────────────────────
  const selectedIds = useMemo(() => new Set(selected.map(m => m.id)), [selected]);

  const dropResults = useMemo(() => {
    const q = debouncedModSearch.toLowerCase().trim();
    return modifiers
      .filter(m => !selectedIds.has(m.id) && (!q || m.name.toLowerCase().includes(q) || m.group_name?.toLowerCase().includes(q)))
      .slice(0, 50);
  }, [modifiers, selectedIds, debouncedModSearch]);

  // reset drop index when results change
  useEffect(() => setDropIdx(0), [dropResults]);

  // close dropdown on outside click
  useEffect(() => {
    const handler = e => {
      if (!dropRef.current?.contains(e.target) && !inputRef.current?.contains(e.target)) {
        setDropOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── modifier tag input handlers ──────────────────────────────
  function addModifier(mod) {
    setSelected(s => [...s, mod]);
    setModSearch('');
    setDropOpen(false);
    inputRef.current?.focus();
  }

  function removeModifier(id) {
    setSelected(s => s.filter(m => m.id !== id));
  }

  function handleInputKeyDown(e) {
    if (e.key === 'Escape') { setModSearch(''); setDropOpen(false); return; }
    if (!dropOpen || !dropResults.length) {
      if (e.key === 'ArrowDown') { setDropOpen(true); return; }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setDropIdx(i => Math.min(i + 1, dropResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setDropIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (dropResults[dropIdx]) addModifier(dropResults[dropIdx]);
    } else if (e.key === 'Backspace' && !modSearch && selected.length) {
      removeModifier(selected[selected.length - 1].id);
    }
  }

  // ── product list filtering ───────────────────────────────────
  const filteredProducts = useMemo(() => {
    const q = debouncedProductSearch.toLowerCase().trim();
    if (!q) return products;
    return products.filter(p =>
      p.name.toLowerCase().includes(q) || p.category_name?.toLowerCase().includes(q)
    );
  }, [products, debouncedProductSearch]);

  // ── product selection ────────────────────────────────────────
  function toggleProduct(id) {
    setCheckedIds(s => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAll() {
    setCheckedIds(new Set(filteredProducts.map(p => p.id)));
  }

  function clearSelection() {
    setCheckedIds(new Set());
  }

  const modifierById = useMemo(() => {
    const map = {};
    for (const m of modifiers) map[m.id] = m;
    return map;
  }, [modifiers]);

  function toggleExpand(id, e) {
    e.stopPropagation();
    setExpandedIds(s => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function removeAssignment(productId, modifierId, e) {
    e.stopPropagation();
    const key = `${productId}-${modifierId}`;
    setRemovingKey(key);
    try {
      await API.delete('/food-menu/modifier-assignments', {
        data: { product_ids: [productId], modifier_ids: [modifierId] },
      });
      setProducts(prev => prev.map(p => {
        if (p.id !== productId) return p;
        const next = (p.assigned_modifier_ids ?? []).filter(id => id !== modifierId);
        // auto-collapse if no assignments left
        if (next.length === 0) setExpandedIds(s => { const ns = new Set(s); ns.delete(productId); return ns; });
        return { ...p, assigned_modifier_ids: next };
      }));
      showToast('Modifier removed.', 'success');
    } catch {
      showToast('Remove failed. Please try again.', 'error');
    } finally {
      setRemovingKey(null);
    }
  }

  // ── grouped products ─────────────────────────────────────────
  const { assignedProducts, unassignedProducts } = useMemo(() => {
    const assigned   = [];
    const unassigned = [];
    for (const p of filteredProducts) {
      (p.assigned_modifier_ids?.length > 0 ? assigned : unassigned).push(p);
    }
    return { assignedProducts: assigned, unassignedProducts: unassigned };
  }, [filteredProducts]);

  // Ctrl+A shortcut
  useEffect(() => {
    const handler = e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && document.activeElement?.closest('.ma-product-panel')) {
        e.preventDefault();
        selectAll();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  });

  // ── save ────────────────────────────────────────────────────
  async function handleSave() {
    if (!selected.length)     return showToast('Select at least one modifier.', 'error');
    if (!checkedIds.size)     return showToast('Select at least one product.', 'error');

    setSaving(true);
    try {
      const res = await API.post('/food-menu/modifier-assignments', {
        product_ids:  [...checkedIds],
        modifier_ids: selected.map(m => m.id),
        replace:      replaceMode,
      });
      showToast(`Assigned ${res.data.modifiers} modifier(s) to ${res.data.products} product(s). ${res.data.inserted} new assignment(s) created.`, 'success');
      // refresh product assignments
      const updated = await API.get('/food-menu/products-with-assignments');
      setProducts(updated.data);
    } catch {
      showToast('Save failed. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  function handleClear() {
    setSelected([]);
    setCheckedIds(new Set());
    setModSearch('');
    setReplaceMode(false);
  }

  // group modifier dropdown results
  const groupedDrop = useMemo(() => {
    const groups = {};
    for (const m of dropResults) {
      const g = m.group_name ?? 'Ungrouped';
      if (!groups[g]) groups[g] = [];
      groups[g].push(m);
    }
    return groups;
  }, [dropResults]);

  // flat index for keyboard nav still uses dropResults
  let flatIdx = 0;

  return (
    <div className="ma-root">
      {/* ── Page Header ─────────────────────────────────────── */}
      {!embedded && (
        <div className="ma-topbar">
          <div className="ma-topbar-left">
            <h1 className="ma-title">Modifier Assignment</h1>
            <div className="ma-breadcrumb">
              <span>Home</span>
              <span className="ma-bc-sep">›</span>
              <span>Modifier Assignment</span>
            </div>
          </div>
          <div className="ma-topbar-right">
            <button className="ma-btn-secondary" onClick={handleClear}>Clear</button>
            <button className="ma-btn-primary" onClick={handleSave} disabled={saving}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              {saving ? 'Saving…' : 'Save Assignment'}
            </button>
          </div>
        </div>
      )}
      {embedded && (
        <div className="ma-topbar" style={{ paddingTop: 20, paddingLeft: 28, paddingRight: 28 }}>
          <div className="ma-topbar-left">
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#374151' }}>Assign Modifiers to Products</h2>
          </div>
          <div className="ma-topbar-right">
            <button className="ma-btn-secondary" onClick={handleClear}>Clear</button>
            <button className="ma-btn-primary" onClick={handleSave} disabled={saving}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              {saving ? 'Saving…' : 'Save Assignment'}
            </button>
          </div>
        </div>
      )}

      {/* ── Toast ───────────────────────────────────────────── */}
      {toast && (
        <div className={`ma-toast ma-toast-${toast.type}`}>
          {toast.type === 'success'
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>
          }
          {toast.msg}
        </div>
      )}

      <div className="ma-panels">
        {/* ══════════════ LEFT PANEL ══════════════ */}
        <div className="ma-panel ma-modifier-panel">
          <h2 className="ma-panel-title">1. Select Modifiers</h2>

          {/* Tag input + dropdown */}
          <div className="ma-tag-input-wrap" onClick={() => inputRef.current?.focus()}>
            <div className="ma-tags-row">
              {selected.map(mod => (
                <span key={mod.id} className="ma-tag">
                  {mod.name}
                  <button
                    className="ma-tag-remove"
                    onClick={e => { e.stopPropagation(); removeModifier(mod.id); }}
                    aria-label={`Remove ${mod.name}`}
                  >×</button>
                </span>
              ))}
              <input
                ref={inputRef}
                className="ma-tag-input"
                value={modSearch}
                placeholder={selected.length ? '' : 'Type to search modifiers…'}
                onChange={e => { setModSearch(e.target.value); setDropOpen(true); }}
                onFocus={() => { if (modSearch || dropResults.length) setDropOpen(true); }}
                onKeyDown={handleInputKeyDown}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="ma-input-hint">Type to search modifiers. Press ENTER to add.</div>
          </div>

          {/* Dropdown */}
          {dropOpen && dropResults.length > 0 && (
            <div className="ma-dropdown" ref={dropRef}>
              {Object.entries(groupedDrop).map(([groupName, items]) => {
                return (
                  <div key={groupName} className="ma-drop-group">
                    <div className="ma-drop-group-label">{groupName}</div>
                    {items.map(m => {
                      const isActive = flatIdx++ === dropIdx;
                      return (
                        <button
                          key={m.id}
                          className={`ma-drop-item ${isActive ? 'ma-drop-item-active' : ''}`}
                          onMouseDown={e => { e.preventDefault(); addModifier(m); }}
                          onMouseEnter={() => setDropIdx(dropResults.indexOf(m))}
                        >
                          <span className="ma-drop-img">
                            {m.name.charAt(0)}
                          </span>
                          <span className="ma-drop-info">
                            <span className="ma-drop-name">{m.name}</span>
                            <span className="ma-drop-group-tag">{m.group_name}</span>
                          </span>
                          {m.price > 0 && <span className="ma-drop-price">+{m.price}</span>}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

          {/* Selected modifiers grid */}
          <div className="ma-selected-header">
            <span>Selected Modifiers</span>
            {selected.length > 0 && <span className="ma-count-badge">{selected.length}</span>}
          </div>

          {selected.length === 0 ? (
            <div className="ma-empty-modifiers">No modifiers selected yet.</div>
          ) : (
            <div className="ma-selected-grid">
              <div className="ma-selected-grid-head">
                <span>#</span>
                <span>Modifier Name</span>
                <span>Group</span>
                <span></span>
              </div>
              {selected.map((mod, i) => (
                <div key={mod.id} className="ma-selected-row">
                  <span className="ma-row-num">{i + 1}</span>
                  <span className="ma-row-name">{mod.name}</span>
                  <span className="ma-row-group">{mod.group_name ?? '—'}</span>
                  <button className="ma-row-remove" onClick={() => removeModifier(mod.id)} aria-label="Remove">×</button>
                </div>
              ))}
            </div>
          )}

          {/* Replace mode toggle */}
          <div className="ma-replace-toggle">
            <label className="ma-toggle-label">
              <input
                type="checkbox"
                checked={replaceMode}
                onChange={e => setReplaceMode(e.target.checked)}
                className="ma-toggle-checkbox"
              />
              <span className="ma-toggle-track">
                <span className="ma-toggle-thumb" />
              </span>
              <span className="ma-toggle-text">Replace Existing Assignments</span>
            </label>
            {replaceMode && (
              <div className="ma-replace-warning">
                ⚠ This will remove all existing modifier assignments for selected products before saving.
              </div>
            )}
          </div>

          <div className="ma-info-box">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            These selected modifiers will be assigned to all applicable products on the right.
          </div>
        </div>

        {/* ══════════════ RIGHT PANEL ══════════════ */}
        <div className="ma-panel ma-product-panel">
          <h2 className="ma-panel-title">2. Select Applicable Products</h2>

          <div className="ma-product-toolbar">
            <div className="ma-search-wrap">
              <svg className="ma-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                className="ma-product-search"
                placeholder="Search products…"
                value={productSearch}
                onChange={e => setProductSearch(e.target.value)}
                onKeyDown={e => e.key === 'Escape' && setProductSearch('')}
              />
            </div>
            <button className="ma-btn-select-all" onClick={selectAll}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              Select All ({filteredProducts.length})
            </button>
            <button className="ma-btn-clear-sel" onClick={clearSelection}>Clear</button>
          </div>

          <div className="ma-product-list-wrap">
            <div className="ma-product-list-head">
              <span className="ma-col-check"></span>
              <span className="ma-col-star"></span>
              <span className="ma-col-name">Product Name</span>
              <span className="ma-col-cat">Category</span>
            </div>

            <div className="ma-product-list">
              {filteredProducts.length === 0 && (
                <div className="ma-no-products">No products match your search.</div>
              )}

              {/* ── Assigned Group ── */}
              {assignedProducts.length > 0 && (
                <div className="ma-group">
                  <button className="ma-group-header" onClick={() => setAssignedOpen(o => !o)}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points={assignedOpen ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
                    </svg>
                    <span>Assigned</span>
                    <span className="ma-group-badge ma-group-badge-assigned">{assignedProducts.length}</span>
                  </button>

                  {assignedOpen && assignedProducts.map(p => <ProductRow key={p.id} p={p} checkedIds={checkedIds} expandedIds={expandedIds} removingKey={removingKey} modifierById={modifierById} toggleProduct={toggleProduct} toggleExpand={toggleExpand} removeAssignment={removeAssignment} categoryColor={categoryColor} />)}
                </div>
              )}

              {/* ── Unassigned Group ── */}
              {unassignedProducts.length > 0 && (
                <div className="ma-group">
                  <button className="ma-group-header" onClick={() => setUnassignedOpen(o => !o)}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points={unassignedOpen ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
                    </svg>
                    <span>Unassigned</span>
                    <span className="ma-group-badge ma-group-badge-unassigned">{unassignedProducts.length}</span>
                  </button>

                  {unassignedOpen && unassignedProducts.map(p => <ProductRow key={p.id} p={p} checkedIds={checkedIds} expandedIds={expandedIds} removingKey={removingKey} modifierById={modifierById} toggleProduct={toggleProduct} toggleExpand={toggleExpand} removeAssignment={removeAssignment} categoryColor={categoryColor} />)}
                </div>
              )}
            </div>
          </div>

          <div className="ma-product-footer">
            <span>Selected Products: <strong>{checkedIds.size}</strong></span>
            {checkedIds.size > 0 && selected.length > 0 && (
              <span className="ma-assignment-preview">
                → {selected.length} modifier(s) × {checkedIds.size} product(s) = {selected.length * checkedIds.size} assignment(s)
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
