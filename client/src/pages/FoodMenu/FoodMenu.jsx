import { useState, useEffect, useRef } from 'react';
import { productsApi, liveshelfApi, getFoodMenuStations, getFoodMenuBadges } from '../../services/api';
import { useMsg } from '../../hooks/useApi';
import MediaPicker from '../../components/MediaPicker/MediaPicker';
import BadgeMultiSelect from './BadgeMultiSelect';
import LiveShelfView from './LiveShelfView';
import CategoriesView from './CategoriesView';
import CombosView from './CombosView';
import Tip from '../../components/ui/tip';
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
function VariantImageCell({ product, variant, onPick }) {
  const isTemp = String(product.id).startsWith('new_') || String(variant.id).startsWith('new_');

  return (
    <div className={`fm-var-img-cell${isTemp ? ' fm-var-img-cell--disabled' : ''}`}
      title={isTemp ? 'Save this row first' : (variant.image_url ? 'Click to replace image' : 'Click to add image')}
      onClick={() => !isTemp && onPick(product.id, variant.id)}>
      {variant.image_url
        ? <img src={imgSrc(variant.image_url)} alt="" className="fm-var-img-thumb" />
        : <span className="fm-var-img-plus">+</span>}
    </div>
  );
}

// Variant-level flags — on the product row for single-variant items, per variant line otherwise
const VARIANT_FLAGS = [
  { key: 'auto_entry', label: 'Auto Entry POS', title: 'Auto Entry POS — when ON, this item is added to the cart automatically every time a new table order is opened on POS / Waiter (e.g. water, cover charge). Staff can still remove it.' },
  { key: 'check_on_bill', label: 'Check on Bill', title: 'Check on Bill — when ON, checkout warns the cashier/waiter if this item is NOT on the bill, so commonly forgotten items (water, service, packing) get charged.' },
  { key: 'auto_kds', label: 'Active : KDS', invert: true, title: 'Active : KDS — when ON, this item is sent to the kitchen screen (KDS) to be prepared. Turn OFF for items that need no kitchen prep (water, packaged drinks): they skip KDS and are marked served the moment they are posted.' },
];

function VariantGrid({ product, dirtyVariantIds, setRef, onUpdate, onDelete, onAdd, makeKeyHandler, enableImage, onPickImage, onReorder }) {
  const variants = product.variants || [];
  const showFlags = variants.length > 1;
  const [vDrag, setVDrag] = useState(null);
  const [vOver, setVOver] = useState(null);

  function dropVariant(e, idx) {
    e.preventDefault();
    if (vDrag === null || vDrag === idx) { setVDrag(null); setVOver(null); return; }
    const arr = [...variants];
    const [moved] = arr.splice(vDrag, 1);
    arr.splice(idx, 0, moved);
    onReorder(product.id, arr);
    setVDrag(null); setVOver(null);
  }

  return (
    <div className="fm-variant-wrap" >
      <table className="fm-variant-table">
        <thead>
          <tr>
            <th style={{ width: 28 }} title="Drag to reorder"></th>
            <th style={{ minWidth: 100 }}>Name</th>
            <th style={{ width: 80 }}>Price</th>
            <th style={{ width: 80 }}>Status</th>
            <th style={{ width: 90 }}>🌐 Online</th>
            {showFlags && <th style={{ width: 110 }}>Flags</th>}
            {enableImage && <th style={{ width: 60 }}>Image</th>}
            <th style={{ width: 250 }}></th>
          </tr>
        </thead>
        <tbody>
          {variants.map((v, vIdx) => {
            const isDirty = dirtyVariantIds?.has(v.id);
            const isDragOv = vOver === vIdx && vDrag !== vIdx;
            return (
              <tr
                key={v.id}
                className={isDirty ? 'fm-row-dirty' : ''}
                style={{
                  ...(vDrag === vIdx ? { opacity: 0.4 } : {}),
                  ...(isDragOv ? { outline: '2px solid #2563eb', outlineOffset: -2 } : {}),
                }}
                onDragOver={e => { e.preventDefault(); if (vOver !== vIdx) setVOver(vIdx); }}
                onDragEnd={() => { setVDrag(null); setVOver(null); }}
                onDrop={e => dropVariant(e, vIdx)}
              >
                <td
                  draggable
                  onDragStart={e => { setVDrag(vIdx); e.dataTransfer.effectAllowed = 'move'; }}
                  title="Drag to reorder"
                  style={{ cursor: 'grab', textAlign: 'center', color: '#9ca3af', userSelect: 'none' }}
                >⠿</td>
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
                {showFlags && (
                  <td>
                    <div className="fm-td-toggles">
                      {VARIANT_FLAGS.filter(f => f.key === 'auto_kds').map(f => (
                        <Tip key={f.key} text={f.title}><label className="fm-mini-toggle">
                          <input type="checkbox" checked={!!v[f.key] !== !!f.invert}
                            onChange={e => onUpdate(product.id, v.id, f.key, e.target.checked !== !!f.invert ? 1 : 0)} /> {f.label}
                        </label></Tip>
                      ))}
                    </div>
                  </td>
                )}
                {enableImage && (
                  <td>
                    <VariantImageCell product={product} variant={v} onPick={onPickImage} />
                  </td>
                )}
                <td>
                  <button className="btn btn-sm btn-delete" onClick={() => onDelete(product.id, v.id)}>✕</button>
                </td>
              </tr>
            );
          })}
          {!variants.length && (
            <tr><td colSpan={enableImage ? 7 : 6} className="fm-variant-empty">No variants — add one below</td></tr>
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

// ── Web Menu Preview (mirrors website menu.html: Live Shop / Specials / Menu) ──
function WebMenuView({ categories, showMsg }) {
  const [prods, setProds] = useState([]);
  const [shelf, setShelf] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drag, setDrag] = useState(null);   // { sec, id }
  const [over, setOver] = useState(null);   // id hovered

  useEffect(() => {
    (async () => {
      try {
        // Website only receives status=active + featured=1 products (see menuCatalogSyncService)
        const all = [];
        let pg = 1, pages = 1;
        do {
          const r = await productsApi.list({ status: 'active', featured: 1, sort: 'sort_order', sort_dir: 'asc', page: pg });
          all.push(...(r.data.products || []));
          pages = r.data.totalPages || 1;
          pg += 1;
        } while (pg <= pages);
        setProds(all);
        const ls = await liveshelfApi.list({});
        setShelf((ls.data.items || []));
      } catch (e) {
        showMsg(e.response?.data?.error || e.message, false);
      } finally { setLoading(false); }
    })();
  }, []);

  function priceLabel(p) {
    const prices = (p.variants || []).map(v => parseFloat(v.selling_price) || 0).filter(x => x > 0);
    if (!prices.length) return `Rs. ${p.pos_price || 0}`;
    const lo = Math.min(...prices), hi = Math.max(...prices);
    return lo === hi ? `Rs. ${lo}` : `Rs. ${lo}–${hi}`;
  }

  // Move dragged card before/onto target within one section's ordered list
  function reorderList(list, dragId, targetId) {
    const from = list.findIndex(x => x.id === dragId);
    const to = list.findIndex(x => x.id === targetId);
    if (from < 0 || to < 0 || from === to) return null;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  }

  async function dropShelf(targetId) {
    const next = reorderList(shelf, drag.id, targetId);
    if (!next) return;
    setShelf(next);
    try { await liveshelfApi.reorder(next.map(x => x.id)); showMsg('Live Shop order saved'); }
    catch (e) { showMsg(e.response?.data?.error || e.message, false); }
  }

  async function dropProducts(sectionIds, targetId) {
    const section = prods.filter(p => sectionIds.includes(p.id));
    const next = reorderList(section, drag.id, targetId);
    if (!next) return;
    // splice reordered section back into the master list preserving other rows
    const order = new Map(next.map((p, i) => [p.id, i]));
    setProds(prev => {
      const inSec = prev.filter(p => order.has(p.id)).sort((a, b) => order.get(a.id) - order.get(b.id));
      let i = 0;
      return prev.map(p => order.has(p.id) ? inSec[i++] : p);
    });
    try { await productsApi.reorder(next.map(x => x.id)); showMsg('Menu order saved'); }
    catch (e) { showMsg(e.response?.data?.error || e.message, false); }
  }

  function dragProps(sec, id, onDropFn) {
    return {
      draggable: true,
      onDragStart: () => setDrag({ sec, id }),
      onDragEnd: () => { setDrag(null); setOver(null); },
      onDragOver: e => { if (drag?.sec === sec) { e.preventDefault(); setOver(id); } },
      onDrop: e => { e.preventDefault(); if (drag?.sec === sec) onDropFn(id); setDrag(null); setOver(null); },
      className: `fm-web-card${drag?.id === id ? ' dragging' : ''}${over === id && drag?.sec === sec && drag?.id !== id ? ' dragover' : ''}`,
    };
  }

  if (loading) return <div className="fm-loading">Loading web preview…</div>;

  const specials = prods.filter(p => p.storefront_category === "Today's Specials");
  // Website menu sections group by product category (see menu.html renderSections)
  const byCat = new Map();
  prods.forEach(p => {
    const key = p.category_id ?? 0;
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key).push(p);
  });
  const catOrder = [
    ...categories.filter(c => byCat.has(c.id)).map(c => ({ id: c.id, name: c.name })),
    ...(byCat.has(0) ? [{ id: 0, name: 'Uncategorised' }] : []),
  ];

  const shelfCard = i => (
    <div key={i.id} {...dragProps('shelf', i.id, dropShelf)}>
      {imgSrc(i.image)
        ? <img className="fm-web-img" src={imgSrc(i.image)} alt={i.name} onError={e => e.target.style.display = 'none'} />
        : <div className="fm-web-ph">🧺</div>}
      <div className="fm-web-body">
        <div className="fm-web-name">{i.name}</div>
        <div className="fm-web-price">Rs. {i.price}</div>
      </div>
    </div>
  );

  const prodCard = (p, sec, ids) => (
    <div key={p.id} {...dragProps(sec, p.id, tid => dropProducts(ids, tid))}>
      {imgSrc(p.primary_image)
        ? <img className="fm-web-img" src={imgSrc(p.primary_image)} alt={p.name} onError={e => e.target.style.display = 'none'} />
        : <div className="fm-web-ph">🍽️</div>}
      <div className="fm-web-body">
        <div className="fm-web-name">{p.name}</div>
        <div className="fm-web-price">{priceLabel(p)}</div>
      </div>
    </div>
  );

  return (
    <div className="fm-web-view">
      <div className="fm-web-hint">Drag cards to reorder — the new order saves automatically and syncs to the website on next “⇅ Sync to Website”.</div>

      <section className="fm-web-sec">
        <div className="fm-web-sechead"><h2>🧺 Live Shop</h2><span>{shelf.length} on the shelf</span></div>
        <div className="fm-web-grid">{shelf.map(shelfCard)}</div>
        {!shelf.length && <div className="fm-web-empty">No live shelf items</div>}
      </section>

      <section className="fm-web-sec">
        <div className="fm-web-sechead"><h2>⭐ Today's Specials</h2><span>while they last</span></div>
        <div className="fm-web-grid">{specials.map(p => prodCard(p, 'specials', specials.map(x => x.id)))}</div>
        {!specials.length && <div className="fm-web-empty">No products in “Today's Specials” live shop category</div>}
      </section>

      <section className="fm-web-sec">
        <div className="fm-web-sechead"><h2>🍽️ Menu</h2><span>{[...byCat.values()].reduce((s, a) => s + a.length, 0)} items</span></div>
        {catOrder.map(cat => (
          <div key={cat.id} className="fm-web-cat">
            <h3>{cat.name} <span>{byCat.get(cat.id).length}</span></h3>
            <div className="fm-web-grid">
              {byCat.get(cat.id).map(p => prodCard(p, `cat-${cat.id}`, byCat.get(cat.id).map(x => x.id)))}
            </div>
          </div>
        ))}
        {!catOrder.length && <div className="fm-web-empty">No featured active products</div>}
      </section>
    </div>
  );
}

// ── POS price input — formats to 000.00 on blur, free-typing while focused ──
// ── Collapsible side filter panel ───────────────────────────────────────────
function FilterPanel({
  categories, stations, badgeOptions, catFilter, statFilter, stationFilter,
  liveShopFilter, storefrontCatFilter, qrActiveFilter, blankMaxFilter, badgeFilter, featuredFilter, fastFilter, onApply, onClear, onClose,
}) {
  const Pill = ({ active, onClick, children }) => (
    <button
      type="button"
      className={`fm-pill${active ? ' fm-pill-active' : ''}`}
      onClick={onClick}
    >{children}</button>
  );

  return (
    <div className="fm-filter-panel">
      <div className="fm-filter-panel-head">
        <span>Filters</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-sm btn-clear" onClick={onClear} title="Clear all filters">Clear Filter</button>
          <button className="btn btn-sm btn-clear" onClick={onClose} title="Close">✕</button>
        </div>
      </div>

      <div className="fm-filter-group">
        <div className="fm-filter-label">Quick Access</div>
        <div className="fm-pill-row">
          <Pill active={fastFilter === ''} onClick={() => onApply('fast', '')}>All</Pill>
          <Pill active={fastFilter === 'fast'} onClick={() => onApply('fast', 'fast')}>⚡ Fast</Pill>
        </div>
      </div>

      <div className="fm-filter-group">
        <div className="fm-filter-label">Status</div>
        <div className="fm-pill-row">
          <Pill active={statFilter === ''} onClick={() => onApply('stat', '')}>All</Pill>
          <Pill active={statFilter === 'active'} onClick={() => onApply('stat', 'active')}>Active</Pill>
          <Pill active={statFilter === 'inactive'} onClick={() => onApply('stat', 'inactive')}>Inactive</Pill>
        </div>
      </div>

      <div className="fm-filter-group">
        <div className="fm-filter-label">Live Shop Items</div>
        <div className="fm-pill-row">
          <Pill active={liveShopFilter === ''} onClick={() => onApply('liveShop', '')}>All</Pill>
          <Pill active={liveShopFilter === 'active'} onClick={() => onApply('liveShop', 'active')}>Active</Pill>
          <Pill active={liveShopFilter === 'inactive'} onClick={() => onApply('liveShop', 'inactive')}>Inactive</Pill>
        </div>
      </div>

      <div className="fm-filter-group">
        <div className="fm-filter-label">Featured (Available on Web)</div>
        <div className="fm-pill-row">
          <Pill active={featuredFilter === ''} onClick={() => onApply('featured', '')}>All</Pill>
          <Pill active={featuredFilter === '1'} onClick={() => onApply('featured', '1')}>Yes</Pill>
          <Pill active={featuredFilter === '0'} onClick={() => onApply('featured', '0')}>No</Pill>
        </div>
      </div>

      <div className="fm-filter-group">
        <div className="fm-filter-label">QR / Web</div>
        <div className="fm-pill-row">
          <Pill active={qrActiveFilter === ''} onClick={() => onApply('qrActive', '')}>All</Pill>
          <Pill active={qrActiveFilter === 'active'} onClick={() => onApply('qrActive', 'active')}>Active</Pill>
          <Pill active={qrActiveFilter === 'inactive'} onClick={() => onApply('qrActive', 'inactive')}>Inactive</Pill>
        </div>
      </div>

      <div className="fm-filter-group">
        <div className="fm-filter-label">Max Allowed</div>
        <div className="fm-pill-row">
          <Pill active={blankMaxFilter === ''} onClick={() => onApply('blankMax', '')}>All</Pill>
          <Pill active={blankMaxFilter === 'blank'} onClick={() => onApply('blankMax', 'blank')}>Blank</Pill>
        </div>
      </div>

      <div className="fm-filter-group">
        <div className="fm-filter-label">Live Shop Category</div>
        <div className="fm-pill-row">
          <Pill active={storefrontCatFilter === ''} onClick={() => onApply('storefrontCat', '')}>All</Pill>
          {STOREFRONT_CATS.map(c => (
            <Pill key={c} active={storefrontCatFilter === c} onClick={() => onApply('storefrontCat', c)}>
              {c}
            </Pill>
          ))}
        </div>
      </div>

      <div className="fm-filter-group">
        <div className="fm-filter-label">Category</div>
        <div className="fm-pill-row">
          <Pill active={catFilter === ''} onClick={() => onApply('cat', '')}>All</Pill>
          {categories.map(c => (
            <Pill key={c.id} active={String(catFilter) === String(c.id)} onClick={() => onApply('cat', c.id)}>
              {c.name}
            </Pill>
          ))}
        </div>
      </div>

      <div className="fm-filter-group">
        <div className="fm-filter-label">Station</div>
        <div className="fm-pill-row">
          <Pill active={stationFilter === ''} onClick={() => onApply('station', '')}>All</Pill>
          {stations.map(s => (
            <Pill key={s.id} active={String(stationFilter) === String(s.id)} onClick={() => onApply('station', s.id)}>
              {s.name}
            </Pill>
          ))}
        </div>
      </div>

      <div className="fm-filter-group">
        <div className="fm-filter-label">Badges</div>
        <div className="fm-pill-row">
          <Pill active={badgeFilter === ''} onClick={() => onApply('badge', '')}>All</Pill>
          {badgeOptions.map(b => (
            <Pill key={b.code} active={badgeFilter === b.code} onClick={() => onApply('badge', b.code)}>
              {b.icon} {b.name}
            </Pill>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function FoodMenu() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [badgeOptions, setBadgeOptions] = useState([]);
  const [stations, setStations] = useState([]);
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
  const [viewMode, setViewMode] = useState(() => {
    const v = lsGet('fm_view', 'table');
    return v === 'card' ? 'table' : v;   // card view removed
  });
  const [expandedIds, setExpandedIds] = useState(() => new Set(lsGet('fm_expanded', [])));

  // Side filter panel
  const [filterPanelOpen, setFilterPanelOpen] = useState(() => lsGet('fm_filterPanelOpen', false));
  const [stationFilter, setStationFilter] = useState('');
  const [liveShopFilter, setLiveShopFilter] = useState(''); // '' | 'active' | 'inactive'
  const [storefrontCatFilter, setStorefrontCatFilter] = useState(''); // '' | STOREFRONT_CATS value
  const [qrActiveFilter, setQrActiveFilter] = useState(''); // '' | 'active' | 'inactive'
  const [blankMaxFilter, setBlankMaxFilter] = useState(''); // '' | 'blank'
  const [badgeFilter, setBadgeFilter] = useState('');
  const [featuredFilter, setFeaturedFilter] = useState(''); // '' | '1' | '0'
  const [fastFilter, setFastFilter] = useState(() => lsGet('fm_fast', '')); // '' | 'fast'

  // Transient UI state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [dirtyProducts, setDirtyProducts] = useState(new Set());
  const [dirtyVariants, setDirtyVariants] = useState({});
  const [pickerFor, setPickerFor] = useState(null);
  const [variantPickerFor, setVariantPickerFor] = useState(null); // { productId, variantId }
  const [importModal, setImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [importRawCsv, setImportRawCsv] = useState(null);
  const [bulkSel, setBulkSel] = useState('');
  const [dragSrc, setDragSrc] = useState(null);
  const [dragOver, setDragOver] = useState(null);
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
  useEffect(() => { lsSet('fm_filterPanelOpen', filterPanelOpen); }, [filterPanelOpen]);
  useEffect(() => { lsSet('fm_fast', fastFilter); }, [fastFilter]);

  // ── Data loading ───────────────────────────────────────────────────────────
  async function load(overrides = {}) {
    setLoading(true);
    try {
      const params = {
        search, category: catFilter, status: statFilter,
        station: stationFilter, live_shop: liveShopFilter, storefront_cat: storefrontCatFilter,
        qr_active: qrActiveFilter, blank_max: blankMaxFilter, badge: badgeFilter, featured: featuredFilter,
        fast: fastFilter,
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
    getFoodMenuBadges().then(setBadgeOptions).catch(e => console.error('badges load failed', e));
  }, []);

  // Load POS stations once — pos_stations rows are managed elsewhere (File Maintenance)
  useEffect(() => {
    getFoodMenuStations().then(setStations).catch(e => console.error('stations load failed', e));
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

  function reorderVariants(productId, newVariants) {
    const ordered = newVariants.map((v, i) => ({ ...v, sort_order: i + 1 }));
    setItems(prev => prev.map(p => p.id !== productId ? p : { ...p, variants: ordered }));
    setDirtyVariants(prev => ({
      ...prev,
      [productId]: new Set([...(prev[productId] || []), ...ordered.map(v => v.id)]),
    }));
  }

  function onVariantImageSelect(item) {
    if (!variantPickerFor) return;
    const { productId, variantId } = variantPickerFor;
    // image_id is what persists (media library FK); image_url is display-only
    // and gets re-resolved from that FK on the next load.
    setItems(prev => prev.map(p => p.id !== productId ? p : {
      ...p, variants: p.variants?.map(v => v.id === variantId
        ? { ...v, image_id: item.id, image_url: item.url || item.filename }
        : v),
    }));
    setDirtyVariants(prev => ({
      ...prev,
      [productId]: new Set([...(prev[productId] || []), variantId]),
    }));
    setVariantPickerFor(null);
  }

  // ── Add rows ───────────────────────────────────────────────────────────────
  function addRow() {
    const id = 'new_' + Date.now();
    const vid = 'new_v_' + Date.now();
    const defaultVariant = { id: vid, name: 'Regular', sku: '', selling_price: '', cost_price: '', stock: 0, unit: 'pcs', status: 'active', show_online: 1 };
    const newItem = {
      id, name: '', slug: '', category_id: '', status: 'active', featured: false, sort_order: 0, primary_image: null, badge: '', variants: [defaultVariant],
      pos_price: 0, prep_time_minutes: 10, is_fast_moving: 0, pos_station_id: null, pos_active: 1, customer_visible: 0, customer_max_qty: null,
    };
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
    if (key === 'station') { setStationFilter(val); load({ station: val, page: 1 }); }
    if (key === 'liveShop') { setLiveShopFilter(val); load({ live_shop: val, page: 1 }); }
    if (key === 'storefrontCat') { setStorefrontCatFilter(val); load({ storefront_cat: val, page: 1 }); }
    if (key === 'qrActive') { setQrActiveFilter(val); load({ qr_active: val, page: 1 }); }
    if (key === 'blankMax') { setBlankMaxFilter(val); load({ blank_max: val, page: 1 }); }
    if (key === 'badge') { setBadgeFilter(val); load({ badge: val, page: 1 }); }
    if (key === 'featured') { setFeaturedFilter(val); load({ featured: val, page: 1 }); }
    if (key === 'fast') { setFastFilter(val); load({ fast: val, page: 1 }); }
    setPage(1);
  }

  function clearAllFilters() {
    setCatFilter(''); setStatFilter(''); setStationFilter('');
    setLiveShopFilter(''); setStorefrontCatFilter(''); setQrActiveFilter('');
    setBlankMaxFilter(''); setBadgeFilter(''); setFeaturedFilter(''); setFastFilter('');
    setPage(1);
    load({ category: '', status: '', station: '', live_shop: '', storefront_cat: '', qr_active: '', blank_max: '', badge: '', featured: '', fast: '', page: 1 });
  }

  // Filters are ignored server-side once a search term is present — clear
  // the panel selections on search so the UI doesn't show a stale filter.
  function doSearch(e) {
    e.preventDefault();
    if (search.trim()) {
      setCatFilter(''); setStatFilter(''); setStationFilter('');
      setLiveShopFilter(''); setQrActiveFilter(''); setBlankMaxFilter(''); setBadgeFilter(''); setFeaturedFilter(''); setFastFilter('');
      setPage(1);
      load({ category: '', status: '', station: '', live_shop: '', qr_active: '', blank_max: '', badge: '', featured: '', fast: '', page: 1 });
    } else {
      load();
    }
  }

  // ── Import / Export ────────────────────────────────────────────────────────
  function handleImportFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        setImportRawCsv(ev.target.result);
        setImportPreview(parseCsv(ev.target.result));
        setImportModal(true);
      }
      catch { showMsg('Invalid CSV file', false); }
    };
    reader.readAsText(file);
  }

  async function confirmImport() {
    try {
      await productsApi.importCsv(importRawCsv);
      showMsg('Imported successfully!');
      setImportModal(false); setImportPreview(null); setImportRawCsv(null); load();
    } catch (e) { showMsg(e.response?.data?.error || e.message, false); }
  }

  function handleExport() {
    const p = new URLSearchParams({ search, category: catFilter, status: statFilter });
    window.open(`/api/products/export?${p}`, '_blank');
  }

  // Single Sync All — live shelf + store hours + full catalogue to website
  async function handleSyncAll() {
    if (!window.confirm('Sync live shelf, store hours & full catalogue to the website?')) return;
    setSyncModal({ status: 'running' });
    try {
      const shelf = await liveshelfApi.sync();
      const sched = await liveshelfApi.syncSchedule();
      const res = await productsApi.syncCatalog();
      setSyncModal({
        status: 'done',
        result: { ...res.data, live_shelf: shelf.data.synced ?? 0, store_hours: sched.data.synced ?? 0 },
      });
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
  // Live Shelf & Category views bring their own toolbars — hide product controls there
  const productView = viewMode === 'table' || viewMode === 'web';
  // Sort Orders shows the toolbar for uniform layout but all operations are disabled
  const opsDisabled = viewMode === 'web';

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
    <div className="fm-root" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden', width: '100%' }}
      onFocusCapture={e => {
        const t = e.target;
        const isText = (t.tagName === 'INPUT' && ['text', 'number', 'search'].includes(t.type)) || t.tagName === 'TEXTAREA';
        if (isText && t.value) requestAnimationFrame(() => { try { t.select(); } catch { /* ignore */ } });
      }}>

      {/* ── Row 1 (fixed): sub-module tabs + Sync All ── */}
      <div className="fm-tabbar">
        <div className="fm-view-seg">
          <button className={viewMode === 'table' ? 'active' : ''} onClick={() => setViewMode('table')} title="Food menu table">☰ Food Menu</button>
          <button className={viewMode === 'liveshelf' ? 'active' : ''} onClick={() => setViewMode('liveshelf')} title="Live shelf — today's available items">📡 Live Shelf</button>
          <button className={viewMode === 'web' ? 'active' : ''} onClick={() => setViewMode('web')} title="Sort web menu order">🌐 Sort Orders</button>
          <button className={viewMode === 'combos' ? 'active' : ''} onClick={() => setViewMode('combos')} title="Combo meals — expand into child items">🍔 Combos</button>
          <button className={viewMode === 'category' ? 'active' : ''} onClick={() => setViewMode('category')} title="Product categories">📂 Category</button>
        </div>
        <div className="fm-tabbar-right">
          {msg && <span className={`msg msg-${msg.ok ? 'ok' : 'err'}`} style={{ whiteSpace: 'nowrap' }}>{msg.text}</span>}
          <button className="btn btn-primary fm-sync-btn" disabled={opsDisabled} onClick={handleSyncAll} title="Sync live shelf, store hours & catalogue to website">⇅ Sync All</button>
        </div>
      </div>

      {/* ── Row 2 (fixed): ops toolbar — sub-views render their own toolbar in this slot ── */}
      {productView && (
        <div className="fm-toolbar-row">
          <button
            className={`btn btn-clear${filterPanelOpen ? ' active' : ''}`}
            onClick={() => setFilterPanelOpen(o => !o)}
            disabled={opsDisabled}
            title="Toggle filter panel"
          >☰ Filters</button>
          <form className="fm-search-form" onSubmit={doSearch}>
            <input
              type="text" value={search}
              onChange={e => setSearch(e.target.value)}
              disabled={opsDisabled}
              placeholder="Search name, SKU, description…"
            />
            <button type="submit" className="btn btn-primary" disabled={opsDisabled}>Search</button>
            {search && (
              <button type="button" className="btn btn-clear" disabled={opsDisabled} onClick={() => { setSearch(''); load({ search: '' }); }}>✕</button>
            )}
          </form>
          <button className="btn btn-clear" disabled={opsDisabled} onClick={() => expandedIds.size > 0 ? collapseAll() : expandAll()} title="Toggle all rows">
            {expandedIds.size > 0 ? '⊖ Collapse' : '⊕ Expand'}
          </button>
          <button className="btn btn-add" disabled={opsDisabled} onClick={addRow}>+ Add Item</button>
          <button
            className="btn btn-save"
            onClick={saveAll}
            disabled={dirtyCount === 0 || opsDisabled}
            style={{ opacity: dirtyCount === 0 || opsDisabled ? 0.5 : 1 }}
          >
            Save All{dirtyCount > 0 ? ` (${dirtyCount})` : ''}
          </button>
          <input ref={importFile} type="file" accept=".csv,.xlsx" style={{ display: 'none' }} onChange={handleImportFile} />
          <button className="btn btn-clear" disabled={opsDisabled} onClick={() => importFile.current?.click()} title="Import CSV">↑ Import</button>
          <button className="btn btn-clear" disabled={opsDisabled} onClick={handleExport} title="Export CSV">↓ Export</button>
        </div>
      )}

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

      {/* ── Body: side filter panel + main content ── */}
      <div className="fm-body">
        {filterPanelOpen && viewMode === 'table' && (
          <FilterPanel
            categories={categories}
            stations={stations}
            badgeOptions={badgeOptions}
            catFilter={catFilter}
            statFilter={statFilter}
            stationFilter={stationFilter}
            liveShopFilter={liveShopFilter}
            storefrontCatFilter={storefrontCatFilter}
            qrActiveFilter={qrActiveFilter}
            blankMaxFilter={blankMaxFilter}
            badgeFilter={badgeFilter}
            featuredFilter={featuredFilter}
            fastFilter={fastFilter}
            onApply={applyFilter}
            onClear={clearAllFilters}
            onClose={() => setFilterPanelOpen(false)}
          />
        )}
        <div className="fm-body-main">
          {/* ── Main content ── */}
          {viewMode === 'liveshelf' ? (
            <LiveShelfView />
          ) : viewMode === 'combos' ? (
            <CombosView />
          ) : viewMode === 'category' ? (
            <CategoriesView />
          ) : loading ? (
            <div className="fm-loading">Loading…</div>
          ) : viewMode === 'table' ? (
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', margin: '10px 12px', border: '1px solid var(--t-border)', borderRadius: 12, background: 'var(--t-surface)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
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
                    <th className="fm-th-livecat">🌐 Live Shop Category</th>
                    <th className="fm-th-exp"></th>
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
                          p.status !== 'active' ? 'fm-row-inactive' : '',
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
                          <button className={`fm-star${p.featured ? ' fm-star-on' : ''}`}
                            onClick={() => updateProduct(p.id, 'featured', !p.featured)}
                            title="Toggle featured"
                          >{p.featured ? '★' : '☆'}</button>
                          <Tip text="Active / Inactive"><label className="fm-mini-toggle fm-img-status-toggle">
                            <input
                              type="checkbox"
                              checked={p.status === 'active'}
                              onChange={e => {
                                const next = e.target.checked ? 'active' : 'inactive';
                                updateProduct(p.id, 'status', next);
                                showMsg(next === 'active' ? 'Marked Active' : 'Marked Inactive');
                              }}
                            /> {p.status === 'active' ? 'Active' : 'Inactive'}
                          </label></Tip>
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
                          <div className="fm-td-mini-row">
                            <Tip text="Station — the kitchen station (KDS screen / KOT printer) this item is sent to when ordered."><label className="fm-mini-field">Station
                              <select className="cell" value={p.pos_station_id ?? ''}
                                onChange={e => updateProduct(p.id, 'pos_station_id', e.target.value || null)}
                              >
                                <option value="">—</option>
                                {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                              </select>
                            </label></Tip>
                          </div>
                        </td>

                        {/* Badges */}
                        <td className="fm-td-badges">
                          <BadgeMultiSelect
                            options={badgeOptions}
                            value={parseBadges(p.badge)}
                            onChange={codes => updateProduct(p.id, 'badge', codes.join(','))}
                            placeholder="Add badges…"
                          />
                          <div className="fm-td-toggles">
                            <Tip text="Fast Section — when ON, this item appears in the ⚡ Fast / Quick rail on POS for one-tap ordering of best sellers."><label className="fm-mini-toggle">
                              <input type="checkbox" checked={!!p.is_fast_moving}
                                onChange={e => updateProduct(p.id, 'is_fast_moving', e.target.checked ? 1 : 0)} /> Fast Section
                            </label></Tip>

                            <Tip text="Active : POS — when ON, this product appears on the POS and Waiter menus for ordering. Turn OFF to hide it from staff without deleting it."><label className="fm-mini-toggle">
                              <input type="checkbox" checked={p.pos_active === undefined || p.pos_active === null ? true : !!p.pos_active}
                                onChange={e => updateProduct(p.id, 'pos_active', e.target.checked ? 1 : 0)} /> Active : POS
                            </label></Tip>
                            <Tip text="Active : QR Menu — when ON, customers can see and order this product from the table QR / web menu. Turn OFF to keep it staff-only."><label className="fm-mini-toggle">
                              <input type="checkbox" checked={!!p.customer_visible}
                                onChange={e => updateProduct(p.id, 'customer_visible', e.target.checked ? 1 : 0)} /> Active : QR Menu
                            </label></Tip>
                            {VARIANT_FLAGS.filter(f => f.key !== 'auto_kds' || (p.variants || []).length <= 1).map(f => (
                              <Tip key={f.key} text={f.title}><label className="fm-mini-toggle">
                                <input type="checkbox" checked={(p.variants || []).some(v => !!v[f.key] !== !!f.invert)}
                                  onChange={e => (p.variants || []).forEach(v => updateVariant(p.id, v.id, f.key, e.target.checked !== !!f.invert ? 1 : 0))} /> {f.label}
                              </label></Tip>
                            ))}
                          </div>
                        </td>

                        {/* Storefront Category + price (inline for single/none, range for multiple) */}
                        <td className="fm-td-livecat">
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
                          <div className="fm-td-mini-row">
                            <Tip text="Prep Time — minutes the kitchen needs to make this item. Used for KDS timers and to flag delayed orders."><label className="fm-mini-field">Prep Time (min)
                              <input type="number" className="cell fm-prep-input" min="0"
                                value={p.prep_time_minutes ?? 10}
                                onChange={e => updateProduct(p.id, 'prep_time_minutes', parseInt(e.target.value))}
                                onFocus={e => e.target.select()}
                              />
                            </label></Tip>
                            <Tip text="Max Qty / Order — most a customer can order of this item in one QR / web order. Blank = unlimited. Does not limit POS or Waiter."><label className="fm-mini-field">Max Qty / Order
                              <input type="number" className="cell fm-max-input" min="1" max="99" maxLength="2" placeholder="∞"
                                value={p.customer_max_qty ?? ''}
                                onChange={e => updateProduct(p.id, 'customer_max_qty', e.target.value === '' ? null : parseInt(e.target.value))}
                                onFocus={e => e.target.select()}
                              />
                            </label></Tip>
                          </div>
                        </td>

                        {/* Expand toggle */}
                        <td className="fm-td-exp">
                          <div className="fm-exp-td-col">
                            <button
                              className="fm-exp-btn"
                              onClick={() => toggleExpand(p.id)}
                              title={isExp ? 'Collapse variants' : 'Expand variants'}
                            >
                              {isExp ? '▼' : '▶'}
                              {p.variants?.length > 0 && <span className="fm-var-count">{p.variants.length}</span>}
                            </button>
                            <button className="btn btn-sm btn-delete fm-img-delete-btn" onClick={() => deleteProduct(p.id)} title="Delete item">✕</button>
                          </div>
                        </td>
                      </tr>,

                      // Expanded variant grid row
                      isExp && (
                        <tr key={`exp-${p.id}`} className="fm-exp-row">
                          <td colSpan={12} className="fm-exp-td">
                            <label className="fm-var-img-toggle">
                              <input type="checkbox" checked={!!p.enable_variant_image}
                                onChange={e => updateProduct(p.id, 'enable_variant_image', e.target.checked ? 1 : 0)} />
                              🖼 Enable Variant Image
                            </label>
                            <VariantGrid
                              product={p}
                              dirtyVariantIds={dirtyVariants[p.id]}
                              setRef={setRef}
                              onUpdate={updateVariant}
                              onDelete={deleteVariant}
                              onAdd={addVariant}
                              makeKeyHandler={makeVariantKeyHandler}
                              enableImage={!!p.enable_variant_image}
                              onPickImage={(productId, variantId) => setVariantPickerFor({ productId, variantId })}
                              onReorder={reorderVariants}
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
            <WebMenuView categories={categories} showMsg={showMsg} />
          )}
        </div>
      </div>

      {/* ── Footer / Pagination ── */}
      {viewMode === 'table' && (
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
      )}

      {/* ── MediaPicker modal ── */}
      {pickerFor && <MediaPicker onSelect={onImageSelect} onClose={() => setPickerFor(null)} section="menu" />}
      {variantPickerFor && <MediaPicker onSelect={onVariantImageSelect} onClose={() => setVariantPickerFor(null)} section="menu" />}

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
              <button className="btn btn-clear" onClick={() => { setImportModal(false); setImportPreview(null); setImportRawCsv(null); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sync to Website status modal ── */}
      {syncModal && (
        <div className="modal-overlay" onClick={() => syncModal.status !== 'running' && setSyncModal(null)}>
          <div className="fm-import-modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="fm-import-header">
              <h3>Sync All to Website</h3>
            </div>
            {syncModal.status === 'running' && <p>Syncing live shelf, store hours &amp; catalogue to the website database…</p>}
            {syncModal.status === 'done' && (
              <table>
                <tbody>
                  <tr><td>Live Shelf</td><td>{syncModal.result.live_shelf}</td></tr>
                  <tr><td>Store Hours</td><td>{syncModal.result.store_hours}</td></tr>
                  <tr><td>Categories</td><td>{syncModal.result.categories}</td></tr>
                  <tr><td>Media Library</td><td>{syncModal.result.media_library}</td></tr>
                  <tr><td>Products</td><td>{syncModal.result.products}</td></tr>
                  <tr><td>Product Variants</td><td>{syncModal.result.product_variants}</td></tr>
                  <tr><td>Product Images</td><td>{syncModal.result.product_images}</td></tr>
                  <tr><td>Modifier Assignments</td><td>{syncModal.result.product_modifier_assignments}</td></tr>
                  <tr><td>Cake Lookups</td><td>{syncModal.result.lookup_master}</td></tr>
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
