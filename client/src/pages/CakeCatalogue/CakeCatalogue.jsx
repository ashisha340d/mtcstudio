import { useState, useEffect, useMemo } from 'react';
import { cakeCatalogueApi } from '../../services/api';
import MediaPicker from '../../components/MediaPicker/MediaPicker';
import CakeLookupTab from './CakeLookupTab';
import './CakeCatalogue.css';

// Manages the v3 website's Cake Atelier: cake_designs (+ media/sizes/flavours,
// creams from lookup_master/CREAM_TYPE) and cake_collections. Changes are pushed to the website via the
// manual Sync button (POST /cake-catalogue/sync), not automatically per edit.

function imgUrl(u) {
  if (!u) return null;
  return (u.startsWith('http') || u.startsWith('/')) ? u : `/uploads/${u}`;
}

const csvToArr = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
const arrToCsv = a => a.join(',');

// ── Reusable child-row editor helpers ─────────────────────────────────────────
function RowBtns({ idx, len, onMove, onRemove }) {
  return (
    <span className="ck-row-btns">
      <button type="button" className="ck-mini-btn" disabled={idx === 0} onClick={() => onMove(idx, -1)}>▲</button>
      <button type="button" className="ck-mini-btn" disabled={idx === len - 1} onClick={() => onMove(idx, 1)}>▼</button>
      <button type="button" className="ck-mini-btn ck-mini-danger" onClick={() => onRemove(idx)}>✕</button>
    </span>
  );
}

function useRows(initial) {
  const [rows, setRows] = useState(initial);
  const set = (i, field, val) => setRows(r => r.map((row, idx) => idx === i ? { ...row, [field]: val } : row));
  const add = (row) => setRows(r => [...r, row]);
  const remove = (i) => setRows(r => r.filter((_, idx) => idx !== i));
  const move = (i, dir) => setRows(r => {
    const arr = [...r]; const [m] = arr.splice(i, 1); arr.splice(i + dir, 0, m); return arr;
  });
  return { rows, setRows, set, add, remove, move };
}

// ── Design edit/create modal ──────────────────────────────────────────────────
function DesignModal({ design, lookups, onSave, onClose }) {
  const [form, setForm] = useState(() => design
    ? {
      name: design.name, slug: design.slug || '', tagline: design.tagline || '',
      description: design.description || '',
      shapes: csvToArr(design.shape_tags), badges: csvToArr(design.badge_tags),
      cream_choice: design.cream_choice ? 1 : 0,
      eggless_available: design.eggless_available ? 1 : 0,
      prep_time_hours: design.prep_time_hours ?? 24,
      is_active: design.is_active ? 1 : 0,
    }
    : {
      name: '', slug: '', tagline: '', description: '', shapes: [], badges: [],
      cream_choice: 1, eggless_available: 1, prep_time_hours: 24, is_active: 1
    });

  const media = useRows(design ? design.media.map(m => ({ url: m.url, alt: m.alt || '', media_id: m.media_id || null })) : []);
  const sizes = useRows(design ? design.sizes.map(s => ({ label: s.label, weight_kg: s.weight_kg, serves: s.serves || '', price: s.price })) : [{ label: '1 kg', weight_kg: 1, serves: '8–10', price: '' }]);
  const flavours = useRows(design ? design.flavours.map(f => ({ name: f.name, surcharge: f.surcharge })) : []);
  const creams = useRows(design ? design.creams.map(c => ({ cream_id: c.cream_id, surcharge: c.surcharge })) : []);

  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [error, setError] = useState('');

  const set = (f, v) => setForm(x => ({ ...x, [f]: v }));
  const toggleIn = (field, val) => setForm(x => ({
    ...x, [field]: x[field].includes(val) ? x[field].filter(v => v !== val) : [...x[field], val],
  }));

  async function save() {
    setError('');
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!sizes.rows.length) { setError('At least one size is required'); return; }
    for (const s of sizes.rows) {
      if (!String(s.label).trim() || !(parseFloat(s.weight_kg) > 0) || s.price === '' || parseFloat(s.price) < 0) {
        setError('Every size needs a label, weight > 0 and a price'); return;
      }
    }
    setSaving(true);
    try {
      await onSave({
        name: form.name, slug: form.slug, tagline: form.tagline, description: form.description,
        shape_tags: arrToCsv(form.shapes), badge_tags: arrToCsv(form.badges),
        cream_choice: form.cream_choice, eggless_available: form.eggless_available,
        prep_time_hours: form.prep_time_hours, is_active: form.is_active,
        media: media.rows, sizes: sizes.rows,
        flavours: flavours.rows.filter(f => String(f.name).trim()),
        creams: creams.rows,
      });
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      setSaving(false);
    }
  }

  return (
    <div className="ck-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ck-modal ck-modal-wide">
        <div className="ck-modal-header">
          <span className="ck-modal-title">{design ? `Edit — ${design.name}` : 'New Cake Design'}</span>
          <button className="ck-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="ck-modal-body">
          {/* Photos */}
          <div className="ck-section">
            <div className="ck-section-title">📷 Photos <span className="ck-hint">first photo = card image on the website</span></div>
            {media.rows.map((m, i) => (
              <div key={i} className="ck-media-row">
                <img src={imgUrl(m.url)} alt="" className="ck-media-thumb" onError={e => { e.target.style.opacity = 0.2; }} />
                <input className="ck-input" value={m.url} onChange={e => media.set(i, 'url', e.target.value)} placeholder="/uploads/…" />
                <input className="ck-input" value={m.alt} onChange={e => media.set(i, 'alt', e.target.value)} placeholder="alt text" style={{ maxWidth: 160 }} />
                <RowBtns idx={i} len={media.rows.length} onMove={media.move} onRemove={media.remove} />
              </div>
            ))}
            <div className="ck-add-row">
              <button type="button" className="ck-icon-btn" onClick={() => setPicking(true)}>📷 Add from Media Library</button>
              <input className="ck-input" placeholder="…or paste an image URL and press +" value={urlDraft} onChange={e => setUrlDraft(e.target.value)} />
              <button type="button" className="ck-icon-btn" disabled={!urlDraft.trim()}
                onClick={() => { media.add({ url: urlDraft.trim(), alt: form.name }); setUrlDraft(''); }}>＋</button>
            </div>
          </div>

          {/* Basics */}
          <div className="ck-form-grid">
            <div className="ck-field">
              <span className="ck-label">Name *</span>
              <input className="ck-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Mystic Pearl" />
            </div>
            <div className="ck-field">
              <span className="ck-label">Slug</span>
              <input className="ck-input" value={form.slug} onChange={e => set('slug', e.target.value)} placeholder="auto-generated from name" />
            </div>
            <div className="ck-field ck-field-full">
              <span className="ck-label">Tagline</span>
              <input className="ck-input" value={form.tagline} onChange={e => set('tagline', e.target.value)} placeholder="short line under the name" />
            </div>
            <div className="ck-field ck-field-full">
              <span className="ck-label">Description</span>
              <textarea className="ck-textarea" rows={3} value={form.description} onChange={e => set('description', e.target.value)} />
            </div>
            <div className="ck-field">
              <span className="ck-label">⏱ Prep Time (hours)</span>
              <input className="ck-input" type="number" min="0" step="1" value={form.prep_time_hours}
                onChange={e => set('prep_time_hours', e.target.value)} placeholder="24" />
            </div>
          </div>

          {/* Tags */}
          <div className="ck-section">
            <div className="ck-section-title">Shapes</div>
            <div className="ck-tag-row">
              {[...new Set([...lookups.shapes, ...form.shapes])].map(s => (
                <label key={s} className={'ck-tag' + (form.shapes.includes(s) ? ' ck-tag-on' : '')}>
                  <input type="checkbox" checked={form.shapes.includes(s)} onChange={() => toggleIn('shapes', s)} />{s}
                </label>
              ))}
            </div>
            <div className="ck-section-title" style={{ marginTop: 10 }}>Badges</div>
            <div className="ck-tag-row">
              {lookups.badges.map(b => (
                <label key={b.code} className={'ck-tag' + (form.badges.includes(b.code) ? ' ck-tag-on' : '')}>
                  <input type="checkbox" checked={form.badges.includes(b.code)} onChange={() => toggleIn('badges', b.code)} />
                  {b.icon ? `${b.icon} ` : ''}{b.name}
                </label>
              ))}
            </div>
          </div>

          {/* Sizes */}
          <div className="ck-section">
            <div className="ck-section-title">⚖ Sizes &amp; Prices * <span className="ck-hint">price = size price + (flavour + cream surcharge) × kg</span></div>
            <div className="ck-cols-head"><span>Label</span><span>Weight (kg)</span><span>Serves</span><span>Price (Rs)</span><span /></div>
            {sizes.rows.map((s, i) => (
              <div key={i} className="ck-cols-row">
                <input className="ck-input" value={s.label} onChange={e => sizes.set(i, 'label', e.target.value)} placeholder="1 kg / 1 Pound" />
                <input className="ck-input" type="number" min="0.1" step="0.1" value={s.weight_kg} onChange={e => sizes.set(i, 'weight_kg', e.target.value)} />
                <input className="ck-input" value={s.serves} onChange={e => sizes.set(i, 'serves', e.target.value)} placeholder="8–10" />
                <input className="ck-input" type="number" min="0" value={s.price} onChange={e => sizes.set(i, 'price', e.target.value)} />
                <RowBtns idx={i} len={sizes.rows.length} onMove={sizes.move} onRemove={sizes.remove} />
              </div>
            ))}
            <button type="button" className="ck-icon-btn" onClick={() => sizes.add({ label: '', weight_kg: 1, serves: '', price: '' })}>＋ Add Size</button>
          </div>

          {/* Flavours */}
          <div className="ck-section">
            <div className="ck-section-title">🍫 Flavours <span className="ck-hint">allowed flavours for this design; surcharge is Rs per kg</span></div>
            {flavours.rows.map((f, i) => (
              <div key={i} className="ck-cols-row ck-cols-2">
                <input className="ck-input" list="ck-flavours" value={f.name} onChange={e => flavours.set(i, 'name', e.target.value)} placeholder="e.g. Black Forest" />
                <input className="ck-input" type="number" min="0" value={f.surcharge} onChange={e => flavours.set(i, 'surcharge', e.target.value)} placeholder="surcharge Rs/kg" />
                <RowBtns idx={i} len={flavours.rows.length} onMove={flavours.move} onRemove={flavours.remove} />
              </div>
            ))}
            <datalist id="ck-flavours">{lookups.flavours.map(f => <option key={f} value={f} />)}</datalist>
            <button type="button" className="ck-icon-btn" onClick={() => flavours.add({ name: '', surcharge: 0 })}>＋ Add Flavour</button>
          </div>

          {/* Creams */}
          <div className="ck-section">
            <div className="ck-section-title">🍦 Creams <span className="ck-hint">tick which creams apply to this design; rate is a per-design Rs/kg override</span></div>
            {lookups.creams.map(c => {
              const idx = creams.rows.findIndex(r => r.cream_id === c.id);
              const sel = idx !== -1 ? creams.rows[idx] : null;
              return (
                <div key={c.id} className="ck-cols-row ck-cols-2">
                  <label className="ck-tag" style={{ justifySelf: 'start' }}>
                    <input type="checkbox" checked={!!sel}
                      onChange={() => sel ? creams.remove(idx) : creams.add({ cream_id: c.id, surcharge: c.surcharge })} />
                    {c.name}
                  </label>
                  {sel && <input className="ck-input" type="number" min="0" value={sel.surcharge}
                    onChange={e => creams.set(idx, 'surcharge', e.target.value)} placeholder="surcharge Rs/kg" />}
                </div>
              );
            })}
          </div>

          {/* Flags */}
          <div className="ck-checkbox-row">
            <input id="ck-cream" type="checkbox" checked={!!form.cream_choice} onChange={e => set('cream_choice', e.target.checked ? 1 : 0)} />
            <label htmlFor="ck-cream">🍦 Customer can choose a cream type</label>
          </div>
          <div className="ck-checkbox-row">
            <input id="ck-eggless" type="checkbox" checked={!!form.eggless_available} onChange={e => set('eggless_available', e.target.checked ? 1 : 0)} style={{ accentColor: '#16a34a' }} />
            <label htmlFor="ck-eggless">🥚 Eggless option available</label>
          </div>
          <div className="ck-checkbox-row">
            <input id="ck-active" type="checkbox" checked={!!form.is_active} onChange={e => set('is_active', e.target.checked ? 1 : 0)} style={{ accentColor: '#e91e8c' }} />
            <label htmlFor="ck-active">Visible on website</label>
          </div>

          {error && <div className="ck-toast-err" style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, fontSize: 12 }}>✕ {error}</div>}
        </div>

        <div className="ck-modal-footer">
          <button className="ck-icon-btn" onClick={onClose}>Cancel</button>
          <button className="ck-btn ck-btn-new" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : design ? '💾 Save Changes' : '➕ Create Design'}
          </button>
        </div>
      </div>

      {picking && <MediaPicker onSelect={m => { media.add({ url: `/uploads/${m.filename}`, alt: m.alt_text || form.name, media_id: m.id }); setPicking(false); }} onClose={() => setPicking(false)} section="cake" />}
    </div>
  );
}

// ── Design card ───────────────────────────────────────────────────────────────
function DesignCard({ design, badgeMap, onEdit, onDelete, onToggleActive, dragHandlers, isDragging, isDragOver }) {
  const src = imgUrl(design.media[0]?.url);
  const prices = design.sizes.map(s => s.price);
  const from = prices.length ? Math.min(...prices) : null;
  return (
    <div {...dragHandlers}
      className={'ck-card' + (design.is_active ? '' : ' ck-card-inactive') + (isDragging ? ' ck-card-dragging' : '') + (isDragOver ? ' ck-card-dragover' : '')}>
      <div className="ck-card-img-wrap" title="Drag to reorder">
        {src ? <img src={src} alt={design.name} className="ck-card-img" onError={e => { e.target.style.display = 'none'; }} />
          : <div className="ck-card-img-placeholder">🎂</div>}
        {design.media.length > 1 && <div className="ck-variant-chip">📷 {design.media.length}</div>}
        {csvToArr(design.badge_tags).slice(0, 1).map(code => {
          const b = badgeMap[code];
          return <div key={code} className="ck-badge-chip">{b ? `${b.icon || ''} ${b.name}` : code}</div>;
        })}
      </div>
      <div className="ck-card-body">
        <div className="ck-card-name">{design.name}</div>
        {design.tagline && <div className="ck-price-note">{design.tagline}</div>}
        <div className="ck-card-meta">
          {design.sizes.map(s => <span key={s.id ?? s.label} className="ck-chip">{s.label} · Rs.{s.price}</span>)}
        </div>
        <div className="ck-card-meta">
          {design.flavours.map(f => <span key={f.id ?? f.name} className="ck-chip" style={{ background: '#fdf2f8', color: '#be185d' }}>{f.name}</span>)}
          {!!design.eggless_available && <span className="ck-chip" style={{ color: '#16a34a', background: '#f0fdf4' }}>Eggless ✓</span>}
          {!!design.prep_time_hours && <span className="ck-chip" style={{ color: '#9a3412', background: '#fff7ed' }}>⏱ {design.prep_time_hours} hrs ahead</span>}
        </div>
        {from != null && <div className="ck-card-price"><span className="ck-price-val">from Rs.{from}</span></div>}
        <div className="ck-card-actions">
          <button className="ck-icon-btn" onClick={() => onEdit(design)}>✎ Edit</button>
          <button className="ck-icon-btn ck-icon-btn-danger" onClick={() => onDelete(design)}>🗑</button>
          <div className="ck-toggle" onClick={() => onToggleActive(design)} title={design.is_active ? 'Hide from website' : 'Show on website'}>
            <span className="ck-toggle-label" style={{ color: design.is_active ? '#16a34a' : '#9ca3af' }}>{design.is_active ? 'LIVE' : 'HIDDEN'}</span>
            <div className="ck-toggle-track" style={{ background: design.is_active ? '#16a34a' : '#9ca3af' }}>
              <div className="ck-toggle-knob" style={{ left: design.is_active ? 16 : 3 }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Collection modal ──────────────────────────────────────────────────────────
function CollectionModal({ collection, designs, onSave, onClose }) {
  const [form, setForm] = useState(() => collection
    ? {
      title: collection.title, slug: collection.slug || '', kicker: collection.kicker || '',
      intro: collection.intro || '', quote: collection.quote || '', hero_url: collection.hero_url || '',
      hero_media_id: collection.hero_media_id || null,
      sort_order: collection.sort_order || 0, is_active: collection.is_active ? 1 : 0
    }
    : { title: '', slug: '', kicker: '', intro: '', quote: '', hero_url: '', hero_media_id: null, sort_order: 0, is_active: 1 });
  const items = useRows(collection ? collection.items.map(i => ({ design_id: i.design_id, note: i.note || '' })) : []);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const set = (f, v) => setForm(x => ({ ...x, [f]: v }));

  async function save() {
    setError('');
    if (!form.title.trim()) { setError('Title is required'); return; }
    setSaving(true);
    try { await onSave({ ...form, items: items.rows.filter(i => i.design_id) }); }
    catch (e) { setError(e.response?.data?.error || e.message); setSaving(false); }
  }

  return (
    <div className="ck-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ck-modal ck-modal-wide">
        <div className="ck-modal-header">
          <span className="ck-modal-title">{collection ? `Edit — ${collection.title}` : 'New Collection'}</span>
          <button className="ck-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="ck-modal-body">
          <div className="ck-form-grid">
            <div className="ck-field"><span className="ck-label">Title *</span>
              <input className="ck-input" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Wedding Season" /></div>
            <div className="ck-field"><span className="ck-label">Slug</span>
              <input className="ck-input" value={form.slug} onChange={e => set('slug', e.target.value)} placeholder="auto from title" /></div>
            <div className="ck-field"><span className="ck-label">Kicker</span>
              <input className="ck-input" value={form.kicker} onChange={e => set('kicker', e.target.value)} placeholder="small line above the title" /></div>
            <div className="ck-field"><span className="ck-label">Sort Order</span>
              <input className="ck-input" type="number" value={form.sort_order} onChange={e => set('sort_order', e.target.value)} /></div>
            <div className="ck-field ck-field-full"><span className="ck-label">Intro</span>
              <textarea className="ck-textarea" rows={2} value={form.intro} onChange={e => set('intro', e.target.value)} /></div>
            <div className="ck-field ck-field-full"><span className="ck-label">Quote</span>
              <textarea className="ck-textarea" rows={2} value={form.quote} onChange={e => set('quote', e.target.value)} /></div>
            <div className="ck-field ck-field-full"><span className="ck-label">Hero Image</span>
              <div className="ck-add-row">
                {form.hero_url && <img src={imgUrl(form.hero_url)} alt="" className="ck-media-thumb" />}
                <input className="ck-input" value={form.hero_url} onChange={e => set('hero_url', e.target.value)} placeholder="/uploads/…" />
                <button type="button" className="ck-icon-btn" onClick={() => setPicking(true)}>📷</button>
              </div>
            </div>
          </div>

          <div className="ck-section">
            <div className="ck-section-title">🎂 Cakes in this collection</div>
            {items.rows.map((it, i) => (
              <div key={i} className="ck-cols-row ck-cols-2">
                <select className="ck-form-select" value={it.design_id} onChange={e => items.set(i, 'design_id', parseInt(e.target.value, 10) || '')}>
                  <option value="">— pick a design —</option>
                  {designs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <input className="ck-input" value={it.note} onChange={e => items.set(i, 'note', e.target.value)} placeholder="optional note" />
                <RowBtns idx={i} len={items.rows.length} onMove={items.move} onRemove={items.remove} />
              </div>
            ))}
            <button type="button" className="ck-icon-btn" onClick={() => items.add({ design_id: '', note: '' })}>＋ Add Cake</button>
          </div>

          <div className="ck-checkbox-row">
            <input id="ck-col-active" type="checkbox" checked={!!form.is_active} onChange={e => set('is_active', e.target.checked ? 1 : 0)} style={{ accentColor: '#e91e8c' }} />
            <label htmlFor="ck-col-active">Visible on website</label>
          </div>
          {error && <div className="ck-toast-err" style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, fontSize: 12 }}>✕ {error}</div>}
        </div>
        <div className="ck-modal-footer">
          <button className="ck-icon-btn" onClick={onClose}>Cancel</button>
          <button className="ck-btn ck-btn-new" onClick={save} disabled={saving}>{saving ? 'Saving…' : '💾 Save Collection'}</button>
        </div>
      </div>
      {picking && <MediaPicker onSelect={m => { set('hero_url', `/uploads/${m.filename}`); set('hero_media_id', m.id); setPicking(false); }} onClose={() => setPicking(false)} section="cake" />}
    </div>
  );
}

function CollectionsTab({ collections, designs, reload, flash }) {
  const [modal, setModal] = useState(null); // null | 'new' | collection
  const [items, setItems] = useState(collections);
  const [dragSrcId, setDragSrcId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  useEffect(() => { setItems(collections); }, [collections]);

  async function handleSave(data) {
    if (modal === 'new') await cakeCatalogueApi.createCollection(data);
    else await cakeCatalogueApi.updateCollection(modal.id, data);
    setModal(null); flash('Collection saved'); reload();
  }
  async function del(c) {
    if (!window.confirm(`Delete collection "${c.title}"? (Designs themselves are kept.)`)) return;
    try { await cakeCatalogueApi.removeCollection(c.id); flash('Collection deleted'); reload(); }
    catch (e) { flash(e.response?.data?.error || e.message, false); }
  }
  function endDrag() { setDragSrcId(null); setDragOverId(null); }
  function makeDragHandlers(c) {
    return {
      draggable: true,
      onDragStart(e) { setDragSrcId(c.id); e.dataTransfer.effectAllowed = 'move'; },
      onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverId !== c.id) setDragOverId(c.id); },
      onDrop(e) {
        e.preventDefault();
        if (dragSrcId == null || dragSrcId === c.id) { endDrag(); return; }
        setItems(prev => {
          const arr = [...prev];
          const [moved] = arr.splice(arr.findIndex(x => x.id === dragSrcId), 1);
          arr.splice(arr.findIndex(x => x.id === c.id), 0, moved);
          cakeCatalogueApi.reorderCollections(arr.map((x, idx) => ({ id: x.id, sort_order: idx }))).catch(() => { });
          return arr;
        });
        endDrag();
      },
      onDragEnd: endDrag,
    };
  }
  return (
    <div className="ck-panel">
      <div className="ck-info-banner">📚 Collections are the curated "shop by theme" pages on the website (<strong>/collection.html</strong>). Drag cards to reorder.
        <button className="ck-btn ck-btn-new" style={{ marginLeft: 12 }} onClick={() => setModal('new')}>➕ New Collection</button></div>
      <div className="ck-grid">
        {items.map(c => (
          <div key={c.id} {...makeDragHandlers(c)} title="Drag to reorder"
            className={'ck-card' + (c.is_active ? '' : ' ck-card-inactive') + (dragSrcId === c.id ? ' ck-card-dragging' : '') + (dragOverId === c.id && dragSrcId !== c.id ? ' ck-card-dragover' : '')}>
            <div className="ck-card-img-wrap">
              {c.hero_url ? <img src={imgUrl(c.hero_url)} alt="" className="ck-card-img" onError={e => { e.target.style.display = 'none'; }} />
                : <div className="ck-card-img-placeholder">📚</div>}
            </div>
            <div className="ck-card-body">
              <div className="ck-card-name">{c.title}</div>
              {c.kicker && <div className="ck-price-note">{c.kicker}</div>}
              <div className="ck-card-meta">{c.items.map(i => <span key={i.id} className="ck-chip">{i.design_name}</span>)}</div>
              <div className="ck-card-actions">
                <button className="ck-icon-btn" onClick={() => setModal(c)}>✎ Edit</button>
                <button className="ck-icon-btn ck-icon-btn-danger" onClick={() => del(c)}>🗑</button>
                <span className="ck-toggle-label" style={{ marginLeft: 'auto', color: c.is_active ? '#16a34a' : '#9ca3af' }}>{c.is_active ? 'LIVE' : 'HIDDEN'}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {items.length === 0 && <div className="ck-empty"><div className="ck-empty-icon">📚</div><div className="ck-empty-title">No collections yet</div></div>}
      {modal && <CollectionModal collection={modal === 'new' ? null : modal} designs={designs} onSave={handleSave} onClose={() => setModal(null)} />}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function CakeCatalogue() {
  const [tab, setTab] = useState('designs');
  const [designs, setDesigns] = useState([]);
  const [collections, setCollections] = useState([]);
  const [lookups, setLookups] = useState({ creams: [], badges: [], shapes: [], flavours: [] });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null); // null | 'new' | design
  const [dragSrcId, setDragSrcId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const badgeMap = useMemo(() => Object.fromEntries(lookups.badges.map(b => [b.code, b])), [lookups.badges]);

  function flash(msg, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }

  async function load(s = search, st = status) {
    setLoading(true);
    try {
      const [res, cols] = await Promise.all([
        cakeCatalogueApi.list({ search: s, status: st }),
        cakeCatalogueApi.listCollections(),
      ]);
      setDesigns(res.data.designs ?? []);
      setLookups(res.data.lookups ?? lookups);
      setCollections(cols.data.collections ?? []);
    } catch (e) { flash(e.response?.data?.error || e.message, false); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line

  async function handleSave(form) {
    if (modal === 'new') { await cakeCatalogueApi.create(form); flash('Design created — click Sync to push it live'); }
    else { await cakeCatalogueApi.update(modal.id, form); flash('Design saved — click Sync to push it live'); }
    setModal(null);
    load();
  }

  async function handleDelete(d) {
    if (!window.confirm(`Delete "${d.name}"?\nClick Sync afterwards to remove it from the website.`)) return;
    try { await cakeCatalogueApi.remove(d.id); setDesigns(prev => prev.filter(x => x.id !== d.id)); flash('Deleted'); }
    catch (e) { flash(e.response?.data?.error || e.message, false); }
  }

  async function handleSync() {
    setSyncing(true);
    try { await cakeCatalogueApi.sync(); flash('Synced to munchtimecafe.com.np'); }
    catch (e) { flash(e.response?.data?.error || e.message, false); }
    finally { setSyncing(false); }
  }

  async function handleToggleActive(d) {
    try {
      await cakeCatalogueApi.bulkAction({ action: d.is_active ? 'deactivate' : 'activate', ids: [d.id] });
      setDesigns(prev => prev.map(x => x.id === d.id ? { ...x, is_active: x.is_active ? 0 : 1 } : x));
    } catch (e) { flash(e.response?.data?.error || e.message, false); }
  }

  function makeDragHandlers(d) {
    return {
      draggable: true,
      onDragStart(e) { setDragSrcId(d.id); e.dataTransfer.effectAllowed = 'move'; },
      onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverId !== d.id) setDragOverId(d.id); },
      onDrop(e) {
        e.preventDefault();
        if (dragSrcId == null || dragSrcId === d.id) { endDrag(); return; }
        setDesigns(prev => {
          const arr = [...prev];
          const [moved] = arr.splice(arr.findIndex(x => x.id === dragSrcId), 1);
          arr.splice(arr.findIndex(x => x.id === d.id), 0, moved);
          cakeCatalogueApi.reorder(arr.map((x, idx) => ({ id: x.id, sort_order: idx }))).catch(() => { });
          return arr;
        });
        endDrag();
      },
      onDragEnd: endDrag,
    };
  }
  function endDrag() { setDragSrcId(null); setDragOverId(null); }

  return (
    <div className="ck-root">
      <div className="ck-toolbar">
        <div className="ck-tabs">
          {[['designs', '🎂 Designs'], ['collections', '📚 Collections'], ['modifiers', '🏷 Modifiers']].map(([k, label]) => (
            <button key={k} className={'ck-tab' + (tab === k ? ' ck-tab-on' : '')} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>

        <button className="ck-btn ck-btn-new" onClick={handleSync} disabled={syncing}>
          {syncing ? '⏳ Syncing…' : '🔄 Sync'}
        </button>

        {tab === 'designs' && (
          <>
            <form style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} onSubmit={e => { e.preventDefault(); load(); }}>
              <input className="ck-search-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search designs…" />
              <select className="ck-select" value={status} onChange={e => { setStatus(e.target.value); load(search, e.target.value); }}>
                <option value="">All</option>
                <option value="active">Live only</option>
                <option value="inactive">Hidden only</option>
              </select>
              <button type="submit" className="ck-btn ck-btn-refresh">Search</button>
            </form>
            <div className="ck-toolbar-right">
              <button className="ck-btn ck-btn-new" onClick={() => setModal('new')}>➕ New Design</button>
            </div>
          </>
        )}

        {toast && <div className={`ck-toast ${toast.ok ? 'ck-toast-ok' : 'ck-toast-err'}`}>{toast.ok ? '✓' : '✕'} {toast.msg}</div>}
      </div>

      <div className="ck-content">
        {loading ? <div className="ck-loading">Loading…</div> : (
          <>
            {tab === 'designs' && (
              <>
                <div className="ck-info-banner">
                  🎂 The Cake Atelier on <strong>munchtimecafe.com.np/cakes</strong> reads this catalogue — click
                  <strong> 🔄 Sync</strong> above to push your changes live. Final price = size price + (flavour + cream surcharge) × kg. Drag cards to reorder.
                </div>
                {designs.length === 0 ? (
                  <div className="ck-empty"><div className="ck-empty-icon">🎂</div><div className="ck-empty-title">No designs found</div></div>
                ) : (
                  <div className="ck-grid">
                    {designs.map(d => (
                      <DesignCard key={d.id} design={d} badgeMap={badgeMap}
                        onEdit={x => setModal(x)} onDelete={handleDelete} onToggleActive={handleToggleActive}
                        dragHandlers={makeDragHandlers(d)}
                        isDragging={dragSrcId === d.id} isDragOver={dragOverId === d.id && dragSrcId !== d.id} />
                    ))}
                  </div>
                )}
              </>
            )}
            {tab === 'collections' && <CollectionsTab collections={collections} designs={designs} reload={load} flash={flash} />}
            {tab === 'modifiers' && <CakeLookupTab />}
          </>
        )}
      </div>

      {modal && <DesignModal design={modal === 'new' ? null : modal} lookups={lookups} onSave={handleSave} onClose={() => setModal(null)} />}
    </div>
  );
}
