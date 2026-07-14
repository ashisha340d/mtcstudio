import { useState, useEffect, useRef } from 'react';
import { liveshelfApi } from '../../services/api';
import MediaPicker from '../../components/MediaPicker/MediaPicker';
import './LiveShelf.css';

const STATUS_COLORS = { available: '#16a34a', low_stock: '#ea580c', sold_out: '#dc2626' };
const STATUS_BG     = { available: '#f0fdf4', low_stock: '#fff7ed', sold_out: '#fef2f2' };
const STATUS_LABELS = { available: 'Available', low_stock: 'Low Stock', sold_out: 'Sold Out' };

function imgUrl(image) {
  if (!image) return null;
  if (image.startsWith('http') || image.startsWith('/')) return image;
  return `/uploads/${image}`;
}

function deriveStatus(qty) {
  return qty === 0 ? 'sold_out' : qty <= 3 ? 'low_stock' : 'available';
}

// ── Store Hours Panel ─────────────────────────────────────────────────────────
function StoreSchedule({ flash }) {
  const [schedule, setSchedule] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [syncing,  setSyncing]  = useState(false);
  const [open,     setOpen]     = useState(false);

  useEffect(() => { if (open) loadSchedule(); }, [open]); // eslint-disable-line

  async function loadSchedule() {
    setLoading(true);
    try { setSchedule((await liveshelfApi.getSchedule()).data); }
    catch (e) { flash(e.response?.data?.error || e.message, false); }
    finally   { setLoading(false); }
  }

  function setDay(idx, field, val) {
    setSchedule(prev => prev.map((d, i) => i === idx ? { ...d, [field]: val } : d));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await liveshelfApi.saveSchedule(schedule);
      setSchedule(res.data.days);
      flash('Store hours saved!');
    } catch (e) { flash(e.response?.data?.error || e.message, false); }
    finally { setSaving(false); }
  }

  async function syncToSite() {
    setSyncing(true);
    try {
      const res = await liveshelfApi.syncSchedule();
      flash(res.data.synced > 0 ? `Schedule synced (${res.data.synced} days)` : 'Nothing to sync');
    } catch (e) { flash(e.response?.data?.error || e.message, false); }
    finally { setSyncing(false); }
  }

  const today = new Date().getDay();

  return (
    <div style={{ marginBottom: 20, borderRadius: 10, border: '1.5px solid #e5e7eb', overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', background: open ? '#fff7ed' : '#fff', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: open ? '1.5px solid #e5e7eb' : 'none' }}
      >
        <span style={{ fontSize: 16 }}>🕐</span>
        <span style={{ fontWeight: 700, fontSize: 13, color: '#111', flex: 1 }}>Store Hours &amp; Weekly Plan</span>
        <span style={{ fontSize: 11, color: '#888' }}>{open ? '▲ Hide' : '▼ Show'}</span>
      </button>
      {open && (
        <div style={{ padding: '16px', background: '#fff' }}>
          {loading ? <div style={{ textAlign: 'center', padding: 16, color: '#aaa', fontSize: 13 }}>Loading…</div> : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                {schedule.map((day, idx) => {
                  const isToday = day.day_of_week === today;
                  return (
                    <div key={day.day_of_week} style={{ display: 'grid', gridTemplateColumns: '100px 60px 1fr 1fr 1fr', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: isToday ? '#fff7ed' : '#f9fafb', border: `1.5px solid ${isToday ? '#fed7aa' : '#e5e7eb'}` }}>
                      <div style={{ fontWeight: isToday ? 800 : 600, fontSize: 12, color: isToday ? '#c1440e' : '#333' }}>
                        {day.day_name}{isToday && <span style={{ fontSize: 9, marginLeft: 4, color: '#c1440e' }}>TODAY</span>}
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                        <input type="checkbox" checked={!!day.is_open} onChange={e => setDay(idx, 'is_open', e.target.checked ? 1 : 0)} style={{ accentColor: '#16a34a' }} />
                        <span style={{ fontSize: 11, fontWeight: 600, color: day.is_open ? '#16a34a' : '#dc2626' }}>{day.is_open ? 'Open' : 'Closed'}</span>
                      </label>
                      {[['open_time','Opens','08:00'],['close_time','Closes','20:00']].map(([field, label, def]) => (
                        <div key={field}>
                          <div style={{ fontSize: 9, color: '#888', marginBottom: 2, fontWeight: 600, textTransform: 'uppercase' }}>{label}</div>
                          <input type="time" value={day[field] || def} disabled={!day.is_open} onChange={e => setDay(idx, field, e.target.value)}
                            style={{ padding: '5px 6px', borderRadius: 6, fontSize: 12, border: '1.5px solid #e5e7eb', background: day.is_open ? '#fff' : '#f3f4f6', color: day.is_open ? '#111' : '#aaa', outline: 'none', width: '100%' }} />
                        </div>
                      ))}
                      <div>
                        <div style={{ fontSize: 9, color: '#888', marginBottom: 2, fontWeight: 600, textTransform: 'uppercase' }}>Note</div>
                        <input type="text" value={day.note || ''} placeholder="e.g. Limited hours" onChange={e => setDay(idx, 'note', e.target.value)}
                          style={{ padding: '5px 6px', borderRadius: 6, fontSize: 12, border: '1.5px solid #e5e7eb', background: '#fff', color: '#333', outline: 'none', width: '100%' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={save} disabled={saving} style={{ padding: '8px 18px', borderRadius: 7, border: 'none', background: saving ? '#d1d5db' : '#c1440e', color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}>
                  {saving ? 'Saving…' : '💾 Save Hours'}
                </button>
                <button onClick={syncToSite} disabled={syncing} style={{ padding: '8px 18px', borderRadius: 7, border: 'none', background: syncing ? '#d1d5db' : '#0f766e', color: '#fff', fontSize: 13, fontWeight: 700, cursor: syncing ? 'not-allowed' : 'pointer' }}>
                  {syncing ? 'Syncing…' : '⬆ Sync Hours'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Item Card — inline editable ───────────────────────────────────────────────
function ItemCard({ item, onSaveSync, onRemove, dragHandlers, isDragging, isDragOver, onDirtyChange }) {
  const [stock,      setStock]      = useState(item.stock    ?? 0);
  const [notes,      setNotes]      = useState(item.notes    ?? '');
  const [imageId,    setImageId]    = useState(item.image_id ?? null);
  const [imageSrc,   setImageSrc]   = useState(item.image    ?? null);
  const [dirty,      setDirty]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [pickingImg, setPickingImg] = useState(false);

  useEffect(() => {
    setStock(item.stock ?? 0);
    setNotes(item.notes ?? '');
    setImageId(item.image_id ?? null);
    setImageSrc(item.image ?? null);
    setDirty(false);
    onDirtyChange?.(item.id, null); // clear dirty on reset
  }, [item.stock, item.notes, item.image_id, item.image]); // eslint-disable-line

  const kotSold   = item.kot_sold ?? 0;
  const available = Math.max(0, stock - kotSold);
  const st        = deriveStatus(available);
  const src       = imgUrl(imageSrc);

  function markDirty(newStock, newNotes, newImageId) {
    setDirty(true);
    onDirtyChange?.(item.id, { stock: newStock, notes: newNotes, imageId: newImageId });
  }

  function changeStock(delta) {
    setStock(s => {
      const n = Math.max(0, s + delta);
      markDirty(n, notes, imageId);
      return n;
    });
  }

  function handleStockInput(val) {
    const n = Math.max(0, parseInt(val) || 0);
    setStock(n);
    markDirty(n, notes, imageId);
  }

  function handleImagePick(media) {
    setImageId(media.id);
    setImageSrc(media.filename || media.url);
    markDirty(stock, notes, media.id);
    setPickingImg(false);
  }

  async function save() {
    setSaving(true);
    try {
      await onSaveSync(item, stock, notes, imageId);
      setDirty(false);
      onDirtyChange?.(item.id, null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    <div
      {...dragHandlers}
      className={`ls-card${dirty ? ' ls-card-dirty' : ''}${isDragging ? ' ls-card-dragging' : ''}${isDragOver ? ' ls-card-dragover' : ''}`}
      style={{ borderLeft: `4px solid ${STATUS_COLORS[st]}` }}
    >
      {/* Image */}
      <div className="ls-card-img-wrap" onClick={() => setPickingImg(true)} title="Click to change image" style={{ cursor: 'pointer' }}>
        {src
          ? <img src={src} alt={item.name} className="ls-card-img" onError={e => { e.target.style.display = 'none'; }} />
          : <div className="ls-card-img-placeholder">🖼</div>
        }
        <div className="ls-img-change-overlay">📷 Change</div>
        <button className="ls-remove-btn" onClick={e => { e.stopPropagation(); onRemove(item.id); }} title="Remove from storefront">✕</button>
        <div className={`ls-sync-badge ${item.sync_status ? 'ls-synced' : 'ls-pending'}`}>
          {item.sync_status ? '✓ Synced' : '○ Pending'}
        </div>
        <div className="ls-drag-hint">⠿</div>
      </div>

      {pickingImg && <MediaPicker onSelect={handleImagePick} onClose={() => setPickingImg(false)} section="menu" />}

      {/* Body */}
      <div className="ls-card-body">
        <div className="ls-card-name">{item.name}</div>

        <div className="ls-card-meta">
          <span className="ls-price">Rs.{item.price}</span>
          <span className="ls-status-badge" style={{ color: STATUS_COLORS[st], background: STATUS_BG[st] }}>
            {STATUS_LABELS[st]}
          </span>
        </div>

        {/* Inventory breakdown */}
        <div className="ls-inventory-block">
          {/* Beginning inventory — editable */}

          <div className="ls-inv-row">
            <span className="ls-inv-label">Beg Stock</span>
            <div className="ls-qty-stepper">
              <button className="ls-qty-btn" onClick={() => changeStock(-1)}>−</button>            
              <input
                className="ls-qty-input"
                type="number"
                min="0"
                value={stock}
                onChange={e => handleStockInput(e.target.value)}
                onFocus={e => e.target.select()}
              />

              <button className="ls-qty-btn" onClick={() => changeStock(1)}>+</button>

            </div>
          </div>

          {/* KOT booked today — read-only */}
          <div className="ls-inv-row ls-inv-booked">
            <span className="ls-inv-label">KOT Booked Today</span>
            <span className="ls-inv-value">− {kotSold}</span>
          </div>

          <div className="ls-inv-divider" />

          {/* Available online — read-only, highlighted */}
          <div className="ls-inv-row ls-inv-available">
            <span className="ls-inv-label">Available Online</span>
            <span className="ls-inv-value ls-inv-available-val" style={{ color: STATUS_COLORS[st] }}>
              {available}
            </span>
          </div>
        </div>

        {/* Notes */}
        <textarea
          className="ls-notes"
          value={notes}
          onChange={e => { setNotes(e.target.value); setDirty(true); }}
          placeholder="Add notes…"
          rows={2}
        />

        {dirty && (
          <button className="ls-save-btn" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : '💾 Save & Sync'}
          </button>
        )}
      </div>
    </div>
    </>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function LiveShelf() {
  const [items,    setItems]    = useState([]);
  const [cats,     setCats]     = useState([]);
  const [search,   setSearch]   = useState('');
  const [category, setCategory] = useState('');
  const [loading,  setLoading]  = useState(true);
  const [toast,    setToast]    = useState(null);
  const [syncing,  setSyncing]  = useState(false);
  const [dragSrcId,  setDragSrcId]  = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  // Map of id → { stock, notes, imageId } for cards with unsaved changes
  const dirtyMap = useRef({});

  async function load(s = search, c = category) {
    setLoading(true);
    try {
      const res = await liveshelfApi.list({ search: s, category: c });
      setItems(res.data.items ?? []);
      setCats(res.data.categories ?? []);
    } catch (e) { flash(e.response?.data?.error || e.message, false); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line

  function flash(msg, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }

  // Save a single card's beginning stock, notes, image_id, then sync
  async function onSaveSync(item, stock, notes, imageId) {
    try {
      await liveshelfApi.update(item.id, { quantity: stock, notes, product_id: item.product_id, image_id: imageId });
      setItems(prev => prev.map(it => it.id === item.id
        ? { ...it, stock, notes, image_id: imageId, sync_status: 0 }
        : it
      ));
      // Sync full shelf to remote
      const res = await liveshelfApi.sync();
      const { synced, deleted } = res.data;
      // Mark all items synced in local state
      setItems(prev => prev.map(it => ({ ...it, sync_status: 1 })));
      const parts = [];
      if (synced  > 0) parts.push(`${synced} updated`);
      if (deleted > 0) parts.push(`${deleted} removed from remote`);
      flash(parts.length ? `Saved & synced — ${parts.join(', ')}` : 'Saved & synced');
    } catch (e) {
      flash(e.response?.data?.error || e.message, false);
      throw e; // let card know it failed so it stays dirty
    }
  }

  async function removeFromShelf(id) {
    if (!window.confirm('Remove from storefront? The variant stays in Food Menu.')) return;
    try {
      await liveshelfApi.remove(id);
      setItems(prev => prev.filter(it => it.id !== id));
      flash('Removed from storefront');
    } catch (e) { flash(e.response?.data?.error || e.message, false); }
  }

  async function syncAll() {
    setSyncing(true);
    try {
      // Step 1 — save all cards with unsaved changes
      const dirtyEntries = Object.entries(dirtyMap.current);
      if (dirtyEntries.length > 0) {
        flash(`Saving ${dirtyEntries.length} unsaved card(s)…`);
        await Promise.all(dirtyEntries.map(([id, data]) => {
          const item = items.find(i => String(i.id) === String(id));
          if (!item) return Promise.resolve();
          return liveshelfApi.update(item.id, {
            quantity: data.stock,
            notes:    data.notes,
            product_id: item.product_id,
            image_id: data.imageId,
          }).then(() => {
            setItems(prev => prev.map(it => it.id === item.id
              ? { ...it, stock: data.stock, notes: data.notes, image_id: data.imageId, sync_status: 0 }
              : it
            ));
          });
        }));
        dirtyMap.current = {};
      }

      // Step 2 — sync all to website
      const res = await liveshelfApi.sync();
      const { synced, deleted } = res.data;
      setItems(prev => prev.map(it => ({ ...it, sync_status: 1 })));
      const parts = [];
      if (dirtyEntries.length > 0) parts.push(`${dirtyEntries.length} saved`);
      if (synced  > 0) parts.push(`${synced} synced`);
      if (deleted > 0) parts.push(`${deleted} removed from remote`);
      flash(parts.length ? parts.join(' · ') : 'Already up to date');
    } catch (e) { flash(e.response?.data?.error || e.message, false); }
    finally { setSyncing(false); }
  }

  // ── Drag & Drop ────────────────────────────────────────────────────────────
  function makeDragHandlers(item) {
    return {
      draggable: true,
      onDragStart(e) {
        setDragSrcId(item.id);
        e.dataTransfer.effectAllowed = 'move';
      },
      onDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragOverId !== item.id) setDragOverId(item.id);
      },
      onDrop(e) {
        e.preventDefault();
        if (dragSrcId == null || dragSrcId === item.id) { endDrag(); return; }

        const srcItem = items.find(i => i.id === dragSrcId);
        const tgtItem = item;
        if (!srcItem || srcItem.category !== tgtItem.category) { endDrag(); return; }

        setItems(prev => {
          const arr   = [...prev];
          const srcIdx = arr.findIndex(i => i.id === dragSrcId);
          const tgtIdx = arr.findIndex(i => i.id === tgtItem.id);
          const [moved] = arr.splice(srcIdx, 1);
          arr.splice(tgtIdx, 0, moved);

          // Assign new sort_order within category, persist asynchronously
          const catIds = arr.filter(i => i.category === moved.category);
          const order  = catIds.map((i, idx) => ({ id: i.id, sort_order: idx + 1 }));
          catIds.forEach((i, idx) => { i.sort_order = idx + 1; });

          liveshelfApi.reorder(order).catch(() => {});
          return arr;
        });

        endDrag();
      },
      onDragEnd: endDrag,
    };
  }

  function endDrag() { setDragSrcId(null); setDragOverId(null); }

  // ── Group by category ──────────────────────────────────────────────────────
  const grouped = cats.reduce((acc, c) => {
    const ci = items.filter(i => i.category === c);
    if (ci.length) acc[c] = ci;
    return acc;
  }, {});
  const uncatItems = items.filter(i => !cats.includes(i.category));
  if (uncatItems.length) grouped['Uncategorized'] = uncatItems;

  const pendingSync = items.filter(i => i.sync_status === 0).length;

  return (
    <div className="ls-root">

      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div className="ls-toolbar">
        <form className="ls-search-form" onSubmit={e => { e.preventDefault(); load(search, category); }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="ls-search-input"
          />
          <select
            value={category}
            onChange={e => { setCategory(e.target.value); load(search, e.target.value); }}
            className="ls-cat-select"
          >
            <option value="">All Categories</option>
            {cats.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button type="submit" className="btn-toolbar">Search</button>
          {(search || category) && (
            <button type="button" className="btn-toolbar btn-clear" onClick={() => { setSearch(''); setCategory(''); load('', ''); }}>Clear</button>
          )}
        </form>

        <div className="ls-toolbar-right">
          {pendingSync > 0 && (
            <span className="ls-pending-badge">{pendingSync} pending</span>
          )}
          <button onClick={syncAll} disabled={syncing} className={`btn-sync${syncing ? ' btn-sync-disabled' : ''}`}>
            {syncing ? 'Syncing…' : '⬆ Sync All to Website'}
          </button>
        </div>

        {toast && (
          <div className={`ls-toast ${toast.ok ? 'ls-toast-ok' : 'ls-toast-err'}`}>
            {toast.ok ? '✓' : '✕'} {toast.msg}
          </div>
        )}
      </div>

      {/* ── Info + Schedule ─────────────────────────────────── */}
      <div className="ls-content">
        <div className="ls-info-banner">
          ℹ️ Items here are driven by <strong>Food Menu → Variants → 🌐 Online toggle</strong>. Edit qty &amp; notes directly on each card.
        </div>

        <StoreSchedule flash={flash} />

        {/* ── Grid ──────────────────────────────────────────── */}
        {loading ? (
          <div className="ls-loading">Loading…</div>
        ) : items.length === 0 ? (
          <div className="ls-empty">
            <div className="ls-empty-icon">🛍</div>
            <div className="ls-empty-title">No items on the storefront</div>
            <div className="ls-empty-sub">Go to <strong>Food Menu</strong>, expand a product and toggle <strong>🌐 Online</strong> on a variant.</div>
          </div>
        ) : (
          Object.entries(grouped).map(([cat, catItems]) => (
            <div key={cat} className="ls-cat-section">
              <div className="ls-cat-header">
                <span className="ls-cat-name">{cat}</span>
                <span className="ls-cat-count">{catItems.length}</span>
              </div>
              <div className="ls-grid">
                {catItems.map(item => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    onSaveSync={onSaveSync}
                    onRemove={removeFromShelf}
                    dragHandlers={makeDragHandlers(item)}
                    isDragging={dragSrcId  === item.id}
                    isDragOver={dragOverId === item.id && dragSrcId !== item.id}
                    onDirtyChange={(id, data) => {
                      if (data) dirtyMap.current[id] = data;
                      else delete dirtyMap.current[id];
                    }}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
