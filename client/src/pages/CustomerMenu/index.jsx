import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams } from 'react-router';
import { io } from 'socket.io-client';
import axios from 'axios';
import './menu.css';

const API    = axios.create({ baseURL: '/api/customer' });
const fmt    = n  => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const imgSrc = f  => f ? `/uploads/${f}` : null;

const FOOD_EMOJI = ['🍛','🍜','🍕','🥗','🍰','🥤','🍣','🥩','🍞','☕','🥐','🧆','🍱','🥘','🍮'];
const CAT_EMOJI  = ['🍽️','🍛','🥗','🍰','🥤','🍜','🍣','🥩','🍕','🥐','☕','🍹','🧁','🥞'];
const pEmoji  = id  => FOOD_EMOJI[id % FOOD_EMOJI.length];
const cEmoji  = (c, i) => c.icon || CAT_EMOJI[i % CAT_EMOJI.length];
const cartKey = (pid, vid, mods = '') => `${pid}_${vid ?? 'base'}${mods ? `_${mods}` : ''}`;

const STATUS_LABEL = { OPEN: '🟡 Preparing', CLOSED: '✅ Served', CANCELLED: '❌ Cancelled' };
const STATUS_CLS   = { OPEN: 'open', CLOSED: 'closed', CANCELLED: 'cancelled' };

function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60)    return 'Just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return new Date(iso).toLocaleDateString();
}

const LS_KEY = (tid) => `mtc_orders_${tid || 'guest'}`;
function loadSavedOrders(tableId) {
  try { return JSON.parse(localStorage.getItem(LS_KEY(tableId)) || '[]'); }
  catch { return []; }
}
function saveOrder(tableId, order) {
  try {
    const existing = loadSavedOrders(tableId);
    const idx = existing.findIndex(o => o.order_id === order.order_id);
    let updated;
    if (idx >= 0) {
      // Append KOT to existing record — keep original placed_at, update total
      updated = [...existing];
      updated[idx] = { ...existing[idx], ...order, placed_at: existing[idx].placed_at };
    } else {
      updated = [order, ...existing].slice(0, 10);
    }
    localStorage.setItem(LS_KEY(tableId), JSON.stringify(updated));
  } catch {}
}

function Img({ src, alt, emoji, size = 44 }) {
  const [err, setErr] = useState(false);
  if (!src || err) return <div className="img-fallback" style={{ fontSize: size }}>{emoji}</div>;
  return <img src={src} alt={alt} loading="lazy" onError={() => setErr(true)} />;
}

function Toast({ msg, type }) {
  if (!msg) return null;
  return <div className={`cm-toast${type ? ` cm-toast--${type}` : ''}`}>{msg}</div>;
}

export default function CustomerMenu() {
  const { tableId } = useParams();

  // ── Menu data
  const [menu,        setMenu]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');

  // ── Filters
  const [search,      setSearch]      = useState('');
  const [activeCat,   setActiveCat]   = useState('all');

  // ── Cart
  const [cart,        setCart]        = useState({});
  const [cartOpen,    setCartOpen]    = useState(false);

  // ── Detail sheet
  const [detail,      setDetail]      = useState(null);
  const [selVar,      setSelVar]      = useState(null);
  const [dQty,        setDQty]        = useState(1);
  const [dNote,       setDNote]       = useState('');
  const [availMods,   setAvailMods]   = useState([]);
  const [dMods,       setDMods]       = useState({});

  // ── Order placement
  const [custName,    setCustName]    = useState('');
  const [placing,     setPlacing]     = useState(false);
  const [orderErr,    setOrderErr]    = useState('');
  const [confirmed,   setConfirmed]   = useState(null);
  const [orderReady,  setOrderReady]  = useState(false);

  // ── My Orders / sidebar
  const [myOrders,    setMyOrders]    = useState([]);
  const [viewOrder,   setViewOrder]   = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ── Toast
  const [toast, setToast] = useState({ msg: '', type: '' });
  const socketRef = useRef(null);

  const flash = useCallback((msg, type = '', ms = 2800) => {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg: '', type: '' }), ms);
  }, []);

  // ── Load menu
  const load = useCallback(async () => {
    try {
      setLoading(true); setError('');
      const { data } = await API.get('/menu', { params: tableId ? { tableId } : {} });
      setMenu(data);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not load menu.');
    } finally {
      setLoading(false);
    }
  }, [tableId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setMyOrders(loadSavedOrders(tableId)); }, [tableId]);

  // ── Socket — attach after order confirmed
  useEffect(() => {
    if (!confirmed) return;
    const sock = io(window.location.origin, {
      query:        { role: 'customer', orderId: String(confirmed.order_id) },
      transports:   ['websocket', 'polling'],
      reconnection: true,
    });
    socketRef.current = sock;
    sock.on('order-ready',   ()  => { setOrderReady(true); flash('🎉 Your order is ready!', 'green', 10000); });
    sock.on('order-updated', d   => { if (d.status === 'CLOSED' || d.id === confirmed.order_id) setOrderReady(true); });
    return () => { sock.disconnect(); socketRef.current = null; };
  }, [confirmed, flash]);

  // ── Fetch modifiers when product detail opens
  useEffect(() => {
    if (!detail) { setAvailMods([]); setDMods({}); return; }
    API.get(`/product/${detail.id}/modifiers`)
      .then(r => setAvailMods(r.data))
      .catch(() => setAvailMods([]));
  }, [detail?.id]);

  // ── Derived cart values
  const cartItems = useMemo(() => Object.values(cart), [cart]);
  const cartCount = useMemo(() => cartItems.reduce((s, i) => s + i.qty, 0), [cartItems]);
  const cartTotal = useMemo(() => cartItems.reduce((s, i) => s + i.price * i.qty, 0), [cartItems]);

  // ── Filtered products
  const visible = useMemo(() => {
    if (!menu) return [];
    return menu.products.filter(p => {
      if (activeCat !== 'all' && String(p.category_id) !== activeCat) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [menu, activeCat, search]);

  const grouped = useMemo(() => {
    if (!menu || activeCat !== 'all' || search) return null;
    const map = new Map();
    for (const p of menu.products) {
      if (!map.has(p.category_id))
        map.set(p.category_id, { name: p.category_name, icon: p.category_icon, items: [] });
      map.get(p.category_id).items.push(p);
    }
    return [...map.values()];
  }, [menu, activeCat, search]);

  // ── Open product detail — always default to first variant
  function openDetail(p) {
    setDetail(p);
    setSelVar(p.variants.length > 0 ? p.variants[0] : null);
    setDQty(1);
    setDNote('');
    setDMods({});
  }

  function toggleMod(mod) {
    setDMods(prev => {
      const n = { ...prev };
      if (n[mod.id]) delete n[mod.id]; else n[mod.id] = mod;
      return n;
    });
  }

  const modTotal    = Object.values(dMods).reduce((s, m) => s + (m.price || 0), 0);
  const detailPrice = (selVar ? (selVar.price || detail?.base_price || 0) : (detail?.price || 0)) + modTotal;
  const needsVariant = detail?.has_variants && !selVar;

  function addFromDetail() {
    if (!detail) return;
    const v         = selVar;
    const basePrice = v ? (v.price || detail.base_price) : detail.base_price;
    const modsList  = Object.values(dMods);
    const modsExtra = modsList.reduce((s, m) => s + (m.price || 0), 0);
    const price     = basePrice + modsExtra;
    const modKey    = modsList.map(m => m.id).sort().join(',');
    const key       = cartKey(detail.id, v?.id, modKey);
    const max       = detail.customer_max_qty || Infinity;
    const cur       = cart[key]?.qty || 0;
    const add       = Math.min(dQty, max - cur);
    if (add <= 0) { flash(`Max ${detail.customer_max_qty} per order`, 'red'); return; }
    setCart(c => ({
      ...c,
      [key]: {
        key, productId: detail.id, variantId: v?.id ?? null, variantName: v?.name ?? null,
        modifiers: modsList,
        name: detail.name, price, notes: dNote.trim() || null,
        qty: (c[key]?.qty || 0) + add, max: detail.customer_max_qty || null,
        itemType: c[key]?.itemType ?? 'DINE_IN',
      },
    }));
    flash(`Added ${detail.name}${v ? ` · ${v.name}` : ''}`, 'green');
    setDetail(null);
  }

  function quickAdd(p) {
    if (p.has_variants) { openDetail(p); return; }
    const v     = p.variants[0] ?? null;
    const price = v ? (v.price || p.base_price) : p.base_price;
    const key   = cartKey(p.id, v?.id);
    const max   = p.customer_max_qty || Infinity;
    setCart(c => {
      const cur = c[key]?.qty || 0;
      if (cur >= max) { flash(`Max ${p.customer_max_qty} per order`, 'red'); return c; }
      return {
        ...c,
        [key]: {
          key, productId: p.id, variantId: v?.id ?? null, variantName: v?.name ?? null,
          modifiers: [], name: p.name, price, notes: null,
          qty: cur + 1, max: p.customer_max_qty || null,
          itemType: c[key]?.itemType ?? 'DINE_IN',
        },
      };
    });
  }

  function setItemQty(key, qty) {
    setCart(c => {
      const n = { ...c };
      if (qty <= 0) delete n[key]; else n[key] = { ...c[key], qty };
      return n;
    });
  }

  function setItemType(key, type) {
    setCart(c => ({ ...c, [key]: { ...c[key], itemType: type } }));
  }

  // ── Place order
  async function placeOrder() {
    if (!cartCount) return;
    setPlacing(true); setOrderErr('');
    try {
      const allTakeaway   = cartItems.every(i => i.itemType === 'TAKEAWAY');
      const overallType   = allTakeaway ? 'TAKEAWAY' : 'DINE_IN';
      const { data } = await API.post('/order', {
        table_id:      tableId ? Number(tableId) : undefined,
        customer_name: custName.trim() || undefined,
        order_type:    overallType,
        items: cartItems.map(i => {
          // In a mixed DINE_IN order, flag individual TAKEAWAY items in notes
          const packNote = (!allTakeaway && i.itemType === 'TAKEAWAY') ? '[Pack]' : null;
          const noteParts = [packNote, i.notes].filter(Boolean);
          return {
            product_id:   i.productId,
            variant_id:   i.variantId || undefined,
            quantity:     i.qty,
            notes:        noteParts.join(' ') || undefined,
            modifier_ids: i.modifiers?.length ? i.modifiers.map(m => m.id) : undefined,
          };
        }),
      });
      const record = { ...data, placed_at: new Date().toISOString(), status: 'OPEN' };
      saveOrder(tableId, record);
      setMyOrders(loadSavedOrders(tableId));
      setConfirmed(data);
      setCart({});
      setCartOpen(false);
    } catch (e) {
      setOrderErr(e.response?.data?.error || 'Order failed. Please try again.');
    } finally {
      setPlacing(false);
    }
  }

  async function openMyOrder(order) {
    try {
      const { data } = await API.get(`/order/${order.order_id}`);
      setViewOrder({ ...order, live: data.order });
    } catch {
      setViewOrder(order);
    }
  }

  // ── Confirmed screen ──────────────────────────────────────────────────────────
  if (confirmed) {
    return (
      <div className="cm-root">
        <Toast msg={toast.msg} type={toast.type} />
        {orderReady && (
          <div className="cm-ready-banner"><span>🔔</span> Your order is ready!</div>
        )}
        <div className="cm-success">
          <div className="cm-success__icon">{confirmed.is_new_order === false ? '🔔' : '✅'}</div>
          <h1 className="cm-success__h">
            {confirmed.is_new_order === false ? 'Items Added!' : 'Order Placed!'}
          </h1>
          <p className="cm-success__sub">
            {confirmed.is_new_order === false
              ? `Added to Order #${confirmed.order_id}`
              : confirmed.order_type === 'TAKEAWAY'
                ? '🥡 Takeaway order confirmed'
                : confirmed.table_name ? `Table ${confirmed.table_name}` : 'Your order is confirmed'}
          </p>
          <div className="cm-success__card">
            <div className="cm-success__card-head">
              <span>Order #{confirmed.order_id}</span>
              <span>{confirmed.order_type === 'TAKEAWAY' ? '🥡 Takeaway' : confirmed.table_name ? `Table ${confirmed.table_name}` : ''}</span>
            </div>
            {confirmed.items?.map((item, i) => (
              <div key={i} className="cm-success__row">
                <span className="cm-success__row-name">
                  {item.name}
                  {item.variant_name ? ` · ${item.variant_name}` : ''}
                  {item.modifier_names?.length ? ` + ${item.modifier_names.join(', ')}` : ''}
                  {' '}× {item.qty}
                </span>
                <span className="cm-success__row-price">{fmt(item.price * item.qty)}</span>
              </div>
            ))}
            <div className="cm-success__total">
              <span>Total</span><span>{fmt(confirmed.total)}</span>
            </div>
          </div>
          <div className="cm-success__time">
            <span className="cm-success__time-icon">⏱️</span>
            <div>
              <div className="cm-success__time-num">{confirmed.estimated_minutes} min</div>
              <div className="cm-success__time-lbl">Estimated preparation time</div>
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>
            You'll be notified here when your order is ready
          </p>
          <button className="cm-btn-outline"
            onClick={() => { setConfirmed(null); setOrderReady(false); load(); }}>
            Order More
          </button>
        </div>
      </div>
    );
  }

  // ── Skeleton ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="cm-root">
        <div style={{ height: 100, background: 'var(--y)', borderBottom: '2px solid var(--y-dark)' }} />
        <div style={{ height: 44, background: 'var(--card)', borderBottom: '1px solid var(--border)' }} />
        <div className="cm-skeletons">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="cm-skel-card">
              <div className="cm-skel-img cm-sk" />
              <div className="cm-skel-body">
                <div className="cm-sk cm-sk--h" />
                <div className="cm-sk" style={{ width: '55%' }} />
                <div className="cm-sk cm-sk--p" />
                <div className="cm-sk cm-sk--btn" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="cm-root">
        <div className="cm-empty" style={{ minHeight: '100dvh' }}>
          <span className="cm-empty__icon">😕</span>
          <p>{error}</p>
          <button className="cm-btn-outline" onClick={load} style={{ marginTop: 14 }}>Retry</button>
        </div>
      </div>
    );
  }

  const { table, categories } = menu;

  return (
    <div className="cm-root">
      <Toast msg={toast.msg} type={toast.type} />

      {/* ── Sidebar — slides from left ────────────────────────────────────────── */}
      {sidebarOpen && (
        <>
          <div className="cm-sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
          <div className="cm-sidebar">
            <div className="cm-sidebar__head">
              <span className="cm-sidebar__title">🧾 My Orders</span>
              <button className="cm-sidebar__close" onClick={() => setSidebarOpen(false)}>✕</button>
            </div>
            {(() => {
              const visible = myOrders.filter(o => {
                const st = o.live?.status || o.status || 'OPEN';
                return st !== 'CANCELLED';
              });
              if (visible.length === 0) return (
                <div className="cm-sidebar__empty">
                  <span>🧾</span>
                  <p>No orders yet</p>
                  <small>Your orders will appear here</small>
                </div>
              );
              return visible.map((o, i) => {
                const status = o.live?.status || o.status || 'OPEN';
                return (
                  <div key={i} className="cm-sidebar__order"
                    onClick={() => { openMyOrder(o); setSidebarOpen(false); }}>
                    <div className="cm-sidebar__order-row">
                      <span className="cm-sidebar__order-id">Order #{o.order_id}</span>
                      <span className={`cm-order-chip__status cm-order-chip__status--${STATUS_CLS[status] || 'open'}`}>
                        {STATUS_LABEL[status] || status}
                      </span>
                    </div>
                    <div className="cm-sidebar__order-meta">
                      <span>{fmt(o.total)}</span>
                      {o.order_type === 'TAKEAWAY' && <><span>·</span><span>🥡 Takeaway</span></>}
                      <span>·</span>
                      <span>{timeAgo(o.placed_at)}</span>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </>
      )}

      {/* ── Header — sticky, yellow, brand + search ───────────────────────────── */}
      <header className="cm-header">
        <div className="cm-header__brand">
          <div className="cm-header__logo">🍽️</div>
          <div className="cm-header__info">
            <div className="cm-header__name">MTC Studio</div>
            <div className="cm-header__table">
              {table
                ? <><span className="cm-header__table-badge">Table {table.name}</span>{table.section && ` · ${table.section}`}</>
                : 'Scan & Order'}
            </div>
          </div>
          <button className="cm-hamburger" onClick={() => setSidebarOpen(true)} aria-label="My Orders">
            <span className="cm-hamburger__lines">☰</span>
            {myOrders.length > 0 && <span className="cm-hamburger__dot" />}
          </button>
        </div>
        <div className="cm-header__search-row">
          <div className="cm-search">
            <span className="cm-search__icon">🔍</span>
            <input
              type="search"
              placeholder="Search dishes…"
              value={search}
              onChange={e => { setSearch(e.target.value); setActiveCat('all'); }}
            />
            {search && (
              <button className="cm-search__clear" onClick={() => setSearch('')}>✕</button>
            )}
          </div>
        </div>
      </header>

      {/* ── Category pills ────────────────────────────────────────────────────── */}
      {!search && (
        <nav className="cm-cats">
          <button className={`cm-cat-pill${activeCat === 'all' ? ' active' : ''}`}
            onClick={() => setActiveCat('all')}>All</button>
          {categories.map((cat, i) => (
            <button key={cat.id}
              className={`cm-cat-pill${activeCat === String(cat.id) ? ' active' : ''}`}
              onClick={() => setActiveCat(String(cat.id))}>
              {cEmoji(cat, i)} {cat.name}
            </button>
          ))}
        </nav>
      )}

      {/* ── Product grid ──────────────────────────────────────────────────────── */}
      {grouped && !search
        ? grouped.map((g, gi) => (
            <section key={gi}>
              <h2 className="cm-section-head">{g.icon || '🍽️'} {g.name}</h2>
              <div className="cm-grid">
                {g.items.map(p => (
                  <Card key={p.id} p={p}
                    cartQty={cartItems.filter(i => i.productId === p.id).reduce((s, i) => s + i.qty, 0)}
                    onTap={() => openDetail(p)}
                    onAdd={() => quickAdd(p)}
                    onDec={() => {
                      const rel = cartItems.filter(i => i.productId === p.id);
                      if (rel.length === 1) setItemQty(rel[0].key, rel[0].qty - 1);
                      else openDetail(p);
                    }}
                  />
                ))}
              </div>
            </section>
          ))
        : (
          <section>
            {search && visible.length > 0 && (
              <h2 className="cm-section-head">{visible.length} result{visible.length !== 1 ? 's' : ''} for "{search}"</h2>
            )}
            <div className="cm-grid">
              {visible.length
                ? visible.map(p => (
                    <Card key={p.id} p={p}
                      cartQty={cartItems.filter(i => i.productId === p.id).reduce((s, i) => s + i.qty, 0)}
                      onTap={() => openDetail(p)}
                      onAdd={() => quickAdd(p)}
                      onDec={() => {
                        const rel = cartItems.filter(i => i.productId === p.id);
                        if (rel.length === 1) setItemQty(rel[0].key, rel[0].qty - 1);
                        else openDetail(p);
                      }}
                    />
                  ))
                : <div className="cm-empty" style={{ gridColumn: '1/-1' }}>
                    <span className="cm-empty__icon">🍽️</span>
                    <p>{search ? `No results for "${search}"` : 'No items available'}</p>
                  </div>
              }
            </div>
          </section>
        )
      }

      {/* ── Floating cart bar ─────────────────────────────────────────────────── */}
      {cartCount > 0 && !cartOpen && !detail && (
        <div className="cm-cart-bar" onClick={() => setCartOpen(true)} role="button">
          <span className="cm-cart-bar__count">{cartCount}</span>
          <span className="cm-cart-bar__label">View Order</span>
          <span className="cm-cart-bar__price">{fmt(cartTotal)}</span>
        </div>
      )}

      {/* ── Product detail sheet ──────────────────────────────────────────────── */}
      {detail && (
        <div className="cm-overlay" onClick={e => { if (e.target === e.currentTarget) setDetail(null); }}>
          <div className="cm-sheet">
            <div className="cm-sheet__drag" />
            <div className="cm-detail__img">
              <Img src={imgSrc(detail.image_filename)} alt={detail.name} emoji={pEmoji(detail.id)} size={80} />
              <button className="cm-detail__close" onClick={() => setDetail(null)}>✕</button>
            </div>

            <div className="cm-detail__body">
              <div className="cm-detail__badges">
                {detail.is_fast_moving && <span className="cm-badge cm-badge--fast">⚡ Fast</span>}
                {detail.has_variants   && <span className="cm-badge cm-badge--multi">{detail.variants.length} sizes</span>}
              </div>
              <h2 className="cm-detail__name">{detail.name}</h2>
              {detail.description && <p className="cm-detail__desc">{detail.description}</p>}
              {detail.prep_time_minutes && <p className="cm-detail__prep">⏱ ~{detail.prep_time_minutes} min prep time</p>}

              {/* Variants + Modifiers — side by side when both exist */}
              {(detail.variants.length > 0 || availMods.length > 0) && (
                <div className={`cm-options-row${detail.variants.length > 0 && availMods.length > 0 ? ' has-both' : ''}`}>

                  {detail.variants.length > 0 && (
                    <div className="cm-variants">
                      <p className="cm-variants__title">
                        {detail.variants.length > 1 ? 'Choose Size' : 'Variant'}
                      </p>
                      <div className="cm-variants__grid">
                        {detail.variants.map(v => (
                          <button key={v.id}
                            className={`cm-vpill${selVar?.id === v.id ? ' sel' : ''}`}
                            onClick={() => setSelVar(v)}>
                            <span className="cm-vpill__name">{v.name}</span>
                            <span className="cm-vpill__price">{fmt(v.price || detail.base_price)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {availMods.length > 0 && (
                    <div className={detail.variants.length > 0 ? 'cm-mods-col' : 'cm-mods-standalone'}>
                      {availMods.map(group => (
                        <div key={group.id} className="cm-mods">
                          <p className="cm-variants__title">{group.name}</p>
                          <div className="cm-mods__grid">
                            {group.items.map(mod => (
                              <button key={mod.id}
                                className={`cm-modpill${dMods[mod.id] ? ' sel' : ''}`}
                                onClick={() => toggleMod(mod)}>
                                <span className="cm-modpill__check">{dMods[mod.id] ? '✓' : ''}</span>
                                <span className="cm-modpill__name">{mod.name}</span>
                                {mod.price > 0 && <span className="cm-modpill__price">+{fmt(mod.price)}</span>}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="cm-note">
                <span className="cm-note__label">Special Requests</span>
                <textarea className="cm-note__input" rows={2}
                  placeholder="e.g. less spicy, no onion…"
                  value={dNote} onChange={e => setDNote(e.target.value)} maxLength={120} />
              </div>

              {detail.customer_max_qty && (
                <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
                  Max {detail.customer_max_qty} per order
                </p>
              )}
            </div>

            <div className="cm-detail__foot">
              <div className="cm-detail__qty">
                <button className="cm-detail__qty-btn" onClick={() => setDQty(q => Math.max(1, q - 1))}>−</button>
                <span className="cm-detail__qty-val">{dQty}</span>
                <button className="cm-detail__qty-btn"
                  onClick={() => setDQty(q => Math.min(q + 1, detail.customer_max_qty || 99))}>+</button>
              </div>
              <button className="cm-detail__add" onClick={addFromDetail} disabled={needsVariant}>
                <span>{needsVariant ? 'Select a Size' : `Add ${dQty > 1 ? `${dQty} × ` : ''}`}</span>
                {!needsVariant && <span>{fmt(detailPrice * dQty)}</span>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cart sheet ────────────────────────────────────────────────────────── */}
      {cartOpen && (
        <div className="cm-overlay" onClick={e => { if (e.target === e.currentTarget) setCartOpen(false); }}>
          <div className="cm-sheet">
            <div className="cm-sheet__drag" />
            <h2 className="cm-cart-title">Your Order</h2>
            <p className="cm-cart-subtitle">{cartCount} item{cartCount !== 1 ? 's' : ''}</p>

            {cartItems.map(item => (
              <div key={item.key} className="cm-cart-item">
                <div className="cm-cart-item__info">
                  <div className="cm-cart-item__name">{item.name}</div>
                  {item.variantName && <div className="cm-cart-item__variant">{item.variantName}</div>}
                  {item.modifiers?.length > 0 && (
                    <div className="cm-cart-item__mods">
                      + {item.modifiers.map(m => m.name).join(', ')}
                    </div>
                  )}
                  {item.notes && <div className="cm-cart-item__note">📝 {item.notes}</div>}
                  <div className="cm-item-type">
                    <button
                      className={`cm-item-type__btn${item.itemType !== 'TAKEAWAY' ? ' active' : ''}`}
                      onClick={() => setItemType(item.key, 'DINE_IN')}>
                      🪑 Dine In
                    </button>
                    <button
                      className={`cm-item-type__btn${item.itemType === 'TAKEAWAY' ? ' active takeaway' : ''}`}
                      onClick={() => setItemType(item.key, 'TAKEAWAY')}>
                      🥡 Pack
                    </button>
                  </div>
                </div>
                <div className="cm-cart-item__ctl">
                  <button className="cm-item-btn cm-item-btn--del" onClick={() => setItemQty(item.key, 0)}>🗑</button>
                  <button className="cm-item-btn" onClick={() => setItemQty(item.key, item.qty - 1)}>−</button>
                  <span className="cm-item-qty">{item.qty}</span>
                  <button className="cm-item-btn cm-item-btn--y"
                    onClick={() => setItemQty(item.key, item.qty + 1)}
                    disabled={item.max && item.qty >= item.max}>+</button>
                </div>
                <div className="cm-cart-item__price">{fmt(item.price * item.qty)}</div>
              </div>
            ))}

            <div className="cm-cart-totals">
              <div className="cm-cart-row"><span>Subtotal</span><span>{fmt(cartTotal)}</span></div>
              <div className="cm-cart-row cm-cart-row--total"><span>Total</span><span>{fmt(cartTotal)}</span></div>
            </div>

            <div className="cm-cart-name-wrap">
              <input placeholder="Your name (optional)"
                value={custName} onChange={e => setCustName(e.target.value)} maxLength={60} />
            </div>

            {orderErr && <div className="cm-cart-err">⚠️ {orderErr}</div>}

            <button className="cm-cart-place" onClick={placeOrder} disabled={placing || !cartCount}>
              {placing ? 'Placing Order…' : `Place Order · ${fmt(cartTotal)}`}
            </button>
          </div>
        </div>
      )}

      {/* ── My Order detail sheet ─────────────────────────────────────────────── */}
      {viewOrder && (
        <div className="cm-overlay" onClick={e => { if (e.target === e.currentTarget) setViewOrder(null); }}>
          <div className="cm-sheet">
            <div className="cm-sheet__drag" />
            <div className="cm-order-detail__head">
              <span className="cm-order-detail__title">Order #{viewOrder.order_id}</span>
              <button className="cm-order-detail__close" onClick={() => setViewOrder(null)}>✕</button>
            </div>
            {(() => {
              const st  = viewOrder.live?.status || viewOrder.status || 'OPEN';
              const cls = STATUS_CLS[st] || 'open';
              return (
                <div className="cm-order-status-row">
                  <div className={`cm-order-status-dot cm-order-status-dot--${cls}`} />
                  <div>
                    <div className="cm-order-status-text">
                      {st === 'OPEN' ? 'Being Prepared' : st === 'CLOSED' ? 'Served' : 'Cancelled'}
                    </div>
                    {st === 'OPEN'   && <div className="cm-order-status-sub">Kitchen is working on your order</div>}
                    {st === 'CLOSED' && <div className="cm-order-status-sub">Enjoy your meal! 🍽️</div>}
                  </div>
                </div>
              );
            })()}
            {viewOrder.items?.map((item, i) => (
              <div key={i} className="cm-success__row">
                <span className="cm-success__row-name">
                  {item.name}{item.variant_name ? ` · ${item.variant_name}` : ''} × {item.qty}
                </span>
                <span className="cm-success__row-price">{fmt(item.price * item.qty)}</span>
              </div>
            ))}
            <div className="cm-success__total" style={{ margin: '0 0 16px' }}>
              <span>Total</span><span>{fmt(viewOrder.total)}</span>
            </div>
            <p style={{ padding: '0 16px 20px', fontSize: 12, color: 'var(--muted)' }}>
              Placed {timeAgo(viewOrder.placed_at)}
              {viewOrder.table_name ? ` · Table ${viewOrder.table_name}` : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Product card ──────────────────────────────────────────────────────────────
function Card({ p, cartQty, onTap, onAdd, onDec }) {
  return (
    <article className="cm-card" onClick={onTap}>
      <div className="cm-card__img">
        <Img src={imgSrc(p.image_filename)} alt={p.name} emoji={pEmoji(p.id)} size={42} />
        <div className="cm-card__badges">
          {p.is_fast_moving && <span className="cm-badge cm-badge--fast">⚡ Fast</span>}
          {p.has_variants && cartQty === 0 && (
            <span className="cm-badge cm-badge--multi">{p.variants.length} sizes</span>
          )}
        </div>
      </div>
      <div className="cm-card__body">
        <p className="cm-card__name">{p.name}</p>
        {p.has_variants && <span className="cm-card__from">from</span>}
        <span className="cm-card__price">{fmt(p.price)}</span>
        {p.prep_time_minutes ? <p className="cm-card__prep">⏱ {p.prep_time_minutes} min</p> : null}
      </div>
      <div className="cm-card__foot" onClick={e => e.stopPropagation()}>
        {cartQty === 0
          ? <button className="cm-add-btn" onClick={e => { e.stopPropagation(); onAdd(); }}>
              {p.has_variants ? 'CHOOSE' : 'ADD'}
            </button>
          : <div className="cm-counter">
              <button className="cm-counter__btn" onClick={e => { e.stopPropagation(); onDec(); }}>−</button>
              <span className="cm-counter__val">{cartQty}</span>
              <button className="cm-counter__btn" onClick={e => { e.stopPropagation(); onAdd(); }}>+</button>
            </div>
        }
        {p.customer_max_qty ? <p className="cm-card__limit">Max {p.customer_max_qty}</p> : null}
      </div>
    </article>
  );
}
