import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { createSocket } from '../../socket';
import './waiter.css';

// ── Session keys ──────────────────────────────────────────────────────
const S_KEY  = 'waiter_session';
const U_KEY  = 'waiter_user';
const Q_KEY  = 'waiter_offline_queue';
const API    = import.meta.env.VITE_API_URL || '/api';

// ── Axios instance ────────────────────────────────────────────────────
const api = axios.create({ baseURL: API });
api.interceptors.request.use(cfg => {
  const t = localStorage.getItem(S_KEY);
  if (t) cfg.headers['X-Session-ID'] = t;
  return cfg;
});
api.interceptors.response.use(r => r, err => {
  if (err.response?.status === 401) {
    localStorage.removeItem(S_KEY); localStorage.removeItem(U_KEY);
    window.location.reload();
  }
  return Promise.reject(err);
});

// ── PWA ───────────────────────────────────────────────────────────────
function bootPWA() {
  if (!document.querySelector('link[href="/waiter-manifest.json"]')) {
    document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'manifest', href: '/waiter-manifest.json' }));
  }
  let tc = document.querySelector('meta[name="theme-color"]');
  if (!tc) { tc = Object.assign(document.createElement('meta'), { name: 'theme-color' }); document.head.appendChild(tc); }
  tc.content = '#c1440e';
  ['apple-mobile-web-app-capable','apple-mobile-web-app-status-bar-style'].forEach((n,i) => {
    if (!document.querySelector(`meta[name="${n}"]`))
      document.head.appendChild(Object.assign(document.createElement('meta'), { name: n, content: i ? 'black-translucent' : 'yes' }));
  });
  const vp = document.querySelector('meta[name="viewport"]');
  if (vp) vp.content = 'width=device-width,initial-scale=1,viewport-fit=cover';
  if ('serviceWorker' in navigator)
    navigator.serviceWorker.register('/sw.js', { scope: '/waiter' }).catch(() => {});
  document.title = 'MTC Waiter';
}

// ── Helpers ───────────────────────────────────────────────────────────
const fmt     = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const TRIVIAL = new Set(['regular','default','standard','normal']);
const mvFn    = (v=[]) => v.length === 0 ? [] : (v.length === 1 && TRIVIAL.has(v[0].name.toLowerCase()) ? [] : v);
const cartKey = (pid, vid) => `${pid}_${vid ?? 'base'}`;

// Smart category emoji — keyword-based, NOT hardcoded per category name
const CAT_EMOJI_RULES = [
  [/pizza/i,'🍕'],[/burger|sandwich/i,'🍔'],[/momo|dumpling|dim\s*sum/i,'🥟'],
  [/coffee/i,'☕'],[/juice|smoothie/i,'🥤'],[/drink|beverage|soda/i,'🍹'],
  [/chicken/i,'🍗'],[/rice|biryani|fried\s*rice/i,'🍚'],[/pasta|noodle|spaghetti/i,'🍝'],
  [/dessert|pudding/i,'🍮'],[/cake/i,'🎂'],[/ice\s*cream|gelato/i,'🍦'],
  [/salad|veggie|vegetable/i,'🥗'],[/soup/i,'🍲'],[/steak|beef|meat/i,'🥩'],
  [/fish|seafood|prawn|shrimp/i,'🐟'],[/sushi/i,'🍣'],[/bread|bakery|pastry/i,'🥐'],
  [/side|fries|chips/i,'🍟'],[/snack/i,'🍿'],[/starter|appetizer/i,'🥨'],
  [/beer/i,'🍺'],[/wine/i,'🍷'],[/tea/i,'🍵'],[/retail|shop|merch/i,'🛍'],
  [/set\s*meal|combo|meal/i,'🍱'],[/breakfast/i,'🥞'],[/kids|children/i,'🧒'],
  [/sweet|candy/i,'🍬'],[/wrap|roll/i,'🌯'],[/taco|burrito/i,'🌮'],
];
function catEmoji(name, icon) {
  if (icon) return icon; // DB-set icon wins
  for (const [rx, em] of CAT_EMOJI_RULES) if (rx.test(name)) return em;
  return '🍽';
}

function elapsedDisplay(createdAt) {
  const ms  = Date.now() - new Date(createdAt + (createdAt.includes('Z') ? '' : 'Z')).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

function timeClass(createdAt) {
  const min = Math.floor((Date.now() - new Date(createdAt + (createdAt.includes('Z') ? '' : 'Z')).getTime()) / 60000);
  if (min < 30) return 'tc-green';
  if (min < 60) return 'tc-orange';
  return 'tc-red';
}

// TABLE_TAGS now loaded from lookup_master (TABLE_TAG type) via /api/pos/waiter/table-tags

// ═══════════════════════════════════════════════════════════════════
//  ROOT
// ═══════════════════════════════════════════════════════════════════
export default function WaiterApp() {

  // ── Auth ────────────────────────────────────────────────────────
  const [user,      setUser]      = useState(null);
  const [pin,       setPin]       = useState('');
  const [loginErr,  setLoginErr]  = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  // ── Navigation ──────────────────────────────────────────────────
  const [screen, setScreen] = useState('login');

  // ── Master data ─────────────────────────────────────────────────
  const [tables,       setTables]       = useState([]);
  const [activeOrders, setActiveOrders] = useState({ orders: [], kots: [] });
  const [categories,   setCategories]   = useState([]);
  const [products,     setProducts]     = useState([]);

  // ── Working state ────────────────────────────────────────────────
  const [selectedTable,    setSelectedTable]    = useState(null);
  const [tableOrder,       setTableOrder]       = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [cart,             setCart]             = useState([]);

  // ── Table setup (per visit) ──────────────────────────────────────
  const [paxCount,  setPaxCount]  = useState(0);
  const [tableTags, setTableTags] = useState([]);

  // ── Product picker ───────────────────────────────────────────────
  const [pickerProd,    setPickerProd]    = useState(null);
  const [pickerVariant, setPickerVariant] = useState(null);
  const [pickerModGrps, setPickerModGrps] = useState([]);
  const [pickerModSel,  setPickerModSel]  = useState({});
  const [pickerQty,     setPickerQty]     = useState(1);
  const [pickerModLoad, setPickerModLoad] = useState(false);
  const modCache = useRef({});

  // ── Waiter calls ─────────────────────────────────────────────────
  const [calls, setCalls] = useState([]);

  // ── Stats ────────────────────────────────────────────────────────
  const [showStats,    setShowStats]    = useState(false);
  const [stats,        setStats]        = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // ── Current order panel ──────────────────────────────────────────
  const [showCurrentOrder, setShowCurrentOrder] = useState(false);
  const [showSideMenu,    setShowSideMenu]    = useState(false);
  const [sideMenuTags,    setSideMenuTags]    = useState([]); // loaded from lookup_master

  // ── UI ────────────────────────────────────────────────────────────
  const [tablesLoading, setTablesLoading] = useState(false);
  const [sending,       setSending]       = useState(false);
  const [billBusy,      setBillBusy]      = useState(false);
  const [toast,         setToast]         = useState('');
  const [itemSearch,    setItemSearch]    = useState('');
  const [quickCat,      setQuickCat]      = useState(null); // floating category filter
  const [tick,          setTick]          = useState(0);    // for timer updates

  // ── Offline queue ────────────────────────────────────────────────
  const offlineQ = useRef((() => {
    try { return JSON.parse(localStorage.getItem(Q_KEY) || '[]'); } catch { return []; }
  })());
  const [queueCount, setQueueCount] = useState(offlineQ.current.length);

  const toastRef  = useRef(null);
  const touchStart = useRef({ x: 0, y: 0 });

  // ── Timer tick every 30s ────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  // ── Init ─────────────────────────────────────────────────────────
  useEffect(() => {
    bootPWA();
    const sid = localStorage.getItem(S_KEY), usr = localStorage.getItem(U_KEY);
    if (sid && usr) { try { setUser(JSON.parse(usr)); setScreen('tables'); } catch { localStorage.removeItem(S_KEY); localStorage.removeItem(U_KEY); } }
  }, []);

  // ── Load active waiter calls on mount ───────────────────────────
  useEffect(() => {
    if (!user) return;
    api.get('/pos/waiter/calls/active').then(r => setCalls(r.data)).catch(() => {});
  }, [user]);

  // ── Online → drain offline queue ────────────────────────────────
  useEffect(() => {
    const onOnline = () => drainOfflineQueue();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  // ── Toast ──────────────────────────────────────────────────────
  const showToast = msg => {
    setToast(msg);
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(''), 2800);
  };

  // ── Auth ───────────────────────────────────────────────────────
  const handleDigit = digit => {
    if (loginBusy || pin.length >= 4) return;
    const next = pin + digit;
    setPin(next); setLoginErr('');
    if (next.length === 4) doLogin(next);
  };
  const doLogin = async pinStr => {
    setLoginBusy(true);
    try {
      const res = await axios.post(`${API}/auth/pin`, { pin: pinStr });
      const { sessionId, user: u } = res.data;
      localStorage.setItem(S_KEY, sessionId); localStorage.setItem(U_KEY, JSON.stringify(u));
      setUser(u); setPin(''); setScreen('tables');
    } catch (err) { setLoginErr(err.response?.data?.error || 'Invalid PIN'); setPin(''); }
    finally { setLoginBusy(false); }
  };
  const handleLogout = async () => {
    try { await api.post('/auth/logout', { sessionId: localStorage.getItem(S_KEY) }); } catch {}
    localStorage.removeItem(S_KEY); localStorage.removeItem(U_KEY);
    setUser(null); setCart([]); setSelectedTable(null); setTableOrder(null); setScreen('login');
  };

  // ── Data loaders ───────────────────────────────────────────────
  const loadOrders = useCallback(async () => {
    try { const r = await api.get('/pos/orders/active'); setActiveOrders(r.data); } catch {}
  }, []);
  const loadTables = useCallback(async () => {
    setTablesLoading(true);
    try {
      const [tr, or] = await Promise.all([api.get('/pos/tables'), api.get('/pos/orders/active')]);
      setTables(tr.data); setActiveOrders(or.data);
    } catch { showToast('⚠ Failed to load tables'); }
    finally { setTablesLoading(false); }
  }, []);
  useEffect(() => { if (screen === 'tables') loadTables(); }, [screen, loadTables]);

  const loadOrdersRef = useRef(loadOrders);
  useEffect(() => { loadOrdersRef.current = loadOrders; });

  // ── Socket ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem(S_KEY);
    const socket = createSocket({ role: 'waiter', token: token ?? undefined });
    const reload = () => loadOrdersRef.current();
    socket.on('new-order',          reload);
    socket.on('order-updated',      reload);
    socket.on('order-cancelled',    reload);
    socket.on('order-completed',    reload);
    socket.on('item-served',        reload);
    socket.on('reconnect',          () => { reload(); drainOfflineQueue(); });
    socket.on('waiter-call', payload => {
      setCalls(prev => [...prev.filter(c => c.table_id !== payload.table_id), payload]);
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      showToast(`📢 Table ${payload.table_name} needs assistance!`);
    });
    socket.on('waiter-call-resolved', payload => {
      setCalls(prev => prev.filter(c => c.id !== payload.id));
    });
    socket.on('tables-updated', loadTables);
    return () => socket.disconnect();
  }, [user]);

  // ── Stats ───────────────────────────────────────────────────────
  const loadStats = async () => {
    if (!user) return;
    setStatsLoading(true);
    try { const r = await api.get('/pos/waiter/stats', { params: { userId: user.id } }); setStats(r.data); }
    catch { setStats(null); }
    finally { setStatsLoading(false); }
  };
  const openStats = () => { setShowStats(true); loadStats(); };

  // ── Offline queue ───────────────────────────────────────────────
  const saveToQueue = item => {
    const q = [...offlineQ.current, { ...item, _qid: Date.now() }];
    offlineQ.current = q;
    localStorage.setItem(Q_KEY, JSON.stringify(q));
    setQueueCount(q.length);
  };
  const drainOfflineQueue = async () => {
    const q = offlineQ.current;
    if (!q.length || !navigator.onLine) return;
    const failed = [];
    for (const item of q) {
      try {
        let orderId = item.orderId;
        if (!orderId) {
          const r = await api.post('/pos/orders', { order_type: 'DINE_IN', table_id: item.tableId, status: 'OPEN', pax_count: item.paxCount, table_tags: item.tags });
          orderId = r.data.id;
        }
        await api.post('/pos/kots', { order_id: orderId, items: item.items });
      } catch { failed.push(item); }
    }
    offlineQ.current = failed;
    localStorage.setItem(Q_KEY, JSON.stringify(failed));
    setQueueCount(failed.length);
    if (failed.length < q.length) { showToast(`✅ ${q.length - failed.length} queued order(s) sent`); loadOrdersRef.current(); }
  };

  // ── Table helpers ───────────────────────────────────────────────
  function hasContent(o) {
    const kots = (activeOrders.kots || []).filter(k => k.order_id === o.id);
    if (kots.some(k => (k.items || []).some(i => i.status !== 'CANCELLED'))) return true;
    try { return o.draft_items && JSON.parse(o.draft_items).length > 0; } catch { return false; }
  }
  function getOrderForTable(t) {
    const o = (activeOrders.orders || []).find(x => x.table_id === t.id && !['CLOSED','CANCELLED'].includes(x.status));
    return (!o || !hasContent(o)) ? null : o;
  }
  function getTableStatus(t) {
    const o = getOrderForTable(t);
    if (!o) return 'vacant';
    if (o.status === 'BILL_REQUESTED') return 'bill_req';
    return 'occupied';
  }
  function getSentItems(order) {
    if (!order) return [];
    return (activeOrders.kots || []).filter(k => k.order_id === order.id).flatMap(k =>
      (k.items || []).filter(i => i.status !== 'CANCELLED').map(i => ({ ...i, _kotNum: k.kot_number, _served: i.status === 'SERVED' }))
    );
  }
  function getTableData(t) {
    const order = getOrderForTable(t);
    const status = getTableStatus(t);
    const hasCall = calls.some(c => c.table_id === t.id);
    if (!order) return { status, hasCall, timer: null, tClass: '', amount: 0, sentCount: 0, readyCount: 0 };
    const items = getSentItems(order);
    const sentCount = items.reduce((s, i) => s + i.quantity, 0);
    const readyCount = items.filter(i => i._served).reduce((s, i) => s + i.quantity, 0);
    return { status, hasCall, timer: elapsedDisplay(order.created_at), tClass: timeClass(order.created_at), amount: order.total_amount || 0, sentCount, readyCount, order };
  }

  // ── Quick bill (swipe left) ──────────────────────────────────────
  const quickBillTable = async t => {
    const o = getOrderForTable(t);
    if (!o || o.status === 'BILL_REQUESTED') return;
    try {
      await api.patch(`/pos/orders/${o.id}/status`, { status: 'BILL_REQUESTED' });
      showToast(`🧾 Bill requested for ${t.name}`);
      loadOrders();
    } catch { showToast('⚠ Failed'); }
  };
  const dismissCall = async call => {
    try { await api.patch(`/pos/waiter/calls/${call.id}/resolve`); } catch {}
    setCalls(prev => prev.filter(c => c.id !== call.id));
  };

  // ── Menu ────────────────────────────────────────────────────────
  const menuLoaded = useRef(false);
  const loadMenu = useCallback(async () => {
    if (menuLoaded.current) return;
    try {
      const [cr, pr] = await Promise.all([api.get('/pos/categories'), api.get('/pos/products')]);
      setCategories(cr.data); setProducts(pr.data); menuLoaded.current = true;
    } catch { showToast('⚠ Failed to load menu'); }
  }, []);

  // ── Select table ─────────────────────────────────────────────────
  const handleTableSelect = t => {
    const order = getOrderForTable(t);
    setSelectedTable(t); setTableOrder(order);
    setCart([]); setItemSearch(''); setSelectedCategory(null);
    setShowCurrentOrder(false); setQuickCat(null);
    setPaxCount(order?.pax_count || 0);
    setTableTags(order?.table_tags ? order.table_tags.split(',').filter(Boolean) : []);
    loadMenu(); loadSideMenuTags(); setScreen('categories');
  };
  const handleCategorySelect = cat => {
    setSelectedCategory(cat); setQuickCat(cat); setItemSearch(''); setShowSideMenu(false); setScreen('items');
  };

  // Load TABLE_TAG items once from lookup_master
  const sideTagsLoaded = useRef(false);
  const loadSideMenuTags = useCallback(async () => {
    if (sideTagsLoaded.current) return;
    try { const r = await api.get('/pos/waiter/table-tags'); setSideMenuTags(r.data); sideTagsLoaded.current = true; }
    catch {}
  }, []);

  // ── Repeat last order ────────────────────────────────────────────
  const repeatLastOrder = async () => {
    if (!selectedTable) return;
    try {
      const res = await api.get(`/pos/waiter/table/${selectedTable.id}/last-order`);
      if (!res.data?.items?.length) { showToast('No previous order found'); return; }
      for (const item of res.data.items) {
        addCartItem({ product_id: item.product_id, variant_id: item.variant_id ?? null, product_name: item.product_name, unit_price: item.unit_price, modifiers: [] });
      }
      showToast(`🔁 ${res.data.items.length} items loaded`);
      setScreen('review');
    } catch { showToast('⚠ Could not load last order'); }
  };

  // ── Pax & tags auto-save on existing order ───────────────────────
  const saveOrderMeta = useCallback(async (pax, tags) => {
    if (!tableOrder?.id) return;
    try { await api.patch(`/pos/orders/${tableOrder.id}`, { pax_count: pax, table_tags: tags.join(',') }); }
    catch {}
  }, [tableOrder]);

  // ── Product picker ────────────────────────────────────────────────
  const openPicker = async product => {
    const mvs = mvFn(product.variants);
    setPickerProd(product); setPickerVariant(mvs[0] ?? null); setPickerModSel({}); setPickerQty(1); setPickerModGrps([]);
    if (!product.has_modifiers) return;
    if (modCache.current[product.id] !== undefined) { setPickerModGrps(modCache.current[product.id]); return; }
    setPickerModLoad(true);
    try { const r = await api.get(`/pos/products/${product.id}/modifiers`); modCache.current[product.id] = r.data; setPickerModGrps(r.data); }
    catch { modCache.current[product.id] = []; }
    finally { setPickerModLoad(false); }
  };
  const handleProductTap = product => {
    if (mvFn(product.variants).length || product.has_modifiers) openPicker(product);
    else addCartItem({ product_id: product.id, variant_id: null, product_name: product.name, unit_price: product.price || 0, modifiers: [] });
  };
  const closePicker = () => { setPickerProd(null); setPickerVariant(null); setPickerModGrps([]); setPickerModSel({}); setPickerQty(1); };
  const confirmPicker = () => {
    if (!pickerProd) return;
    const mvs = mvFn(pickerProd.variants);
    const variant = mvs.length ? (pickerVariant || mvs[0]) : null;
    const selMods = pickerModGrps.flatMap(g => g.items.filter(m => pickerModSel[m.id])).map(m => ({ id: m.id, name: m.name, price: m.price }));
    const modPrice = selMods.reduce((s, m) => s + m.price, 0);
    let name = pickerProd.name;
    if (variant) name += ` (${variant.name})`;
    if (selMods.length) name += ' + ' + selMods.map(m => m.name).join(', ');
    for (let i = 0; i < pickerQty; i++) {
      addCartItem({ product_id: pickerProd.id, variant_id: variant?.id ?? null, product_name: name, unit_price: (variant ? variant.price : (pickerProd.price || 0)) + modPrice, modifiers: selMods });
    }
    closePicker();
  };

  // ── Cart ─────────────────────────────────────────────────────────
  const addCartItem = ({ product_id, variant_id, product_name, unit_price, modifiers }) => {
    const key = cartKey(product_id, variant_id);
    setCart(prev => {
      const ex = prev.find(i => i.key === key);
      if (ex) return prev.map(i => i.key === key ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { key, product_id, variant_id, product_name, unit_price, quantity: 1, notes: '', modifiers: modifiers || [], is_homepack: false }];
    });
  };
  const cartTotal = cart.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);
  const getQty    = (pid, vid) => cart.find(i => i.key === cartKey(pid, vid))?.quantity || 0;
  const incItem   = (pid, vid) => { const k = cartKey(pid, vid); setCart(p => p.map(i => i.key === k ? { ...i, quantity: i.quantity + 1 } : i)); };
  const decItem   = (pid, vid) => {
    const k = cartKey(pid, vid);
    setCart(p => { const ex = p.find(i => i.key === k); if (!ex) return p; return ex.quantity <= 1 ? p.filter(i => i.key !== k) : p.map(i => i.key === k ? { ...i, quantity: i.quantity - 1 } : i); });
  };
  const removeItem      = key => setCart(p => p.filter(i => i.key !== key));
  const updateNotes     = (key, notes) => setCart(p => p.map(i => i.key === key ? { ...i, notes } : i));
  const updateHomePack  = (key, val)   => setCart(p => p.map(i => i.key === key ? { ...i, is_homepack: val } : i));

  // ── Send order ────────────────────────────────────────────────────
  const sendOrder = async () => {
    if (!cart.length || sending) return;
    setSending(true);
    try {
      let orderId = tableOrder?.id;
      if (!orderId) {
        const r = await api.post('/pos/orders', { order_type: 'DINE_IN', table_id: selectedTable.id, status: 'OPEN', pax_count: paxCount, table_tags: tableTags.join(',') });
        orderId = r.data.id;
      } else if (paxCount > 0 || tableTags.length > 0) {
        // Only patch if there's actual meta to save (avoids "Nothing to update" error)
        await api.patch(`/pos/orders/${orderId}`, { pax_count: paxCount, table_tags: tableTags.join(',') });
      }
      await api.post('/pos/kots', {
        order_id: orderId, punched_by: user?.id,
        items: cart.map(i => ({ product_id: i.product_id, variant_id: i.variant_id ?? null, product_name: i.product_name, quantity: i.quantity, unit_price: i.unit_price, is_home_pack: i.is_homepack ? 1 : 0, notes: [i.notes, ...(i.modifiers?.map(m => m.name) || [])].filter(Boolean).join(', ') || null })),
      });
      setCart([]);
      setScreen('success');
      setTimeout(() => { setSelectedTable(null); setTableOrder(null); setScreen('tables'); }, 2200);
    } catch (err) {
      if (!navigator.onLine) {
        saveToQueue({ tableId: selectedTable.id, orderId: tableOrder?.id ?? null, items: cart.map(i => ({ product_id: i.product_id, variant_id: i.variant_id ?? null, product_name: i.product_name, quantity: i.quantity, unit_price: i.unit_price, is_home_pack: i.is_homepack ? 1 : 0, notes: [i.notes, ...(i.modifiers?.map(m => m.name)||[])].filter(Boolean).join(', ')||null })), paxCount, tags: tableTags.join(',') });
        showToast('📦 Offline — order queued');
        setCart([]); setScreen('tables');
      } else {
        showToast(err.response?.data?.error || '⚠ Failed to send order');
      }
    } finally { setSending(false); }
  };

  // ── Bill request ──────────────────────────────────────────────────
  const requestBill = async () => {
    if (!tableOrder?.id || billBusy) return;
    setBillBusy(true);
    try { await api.patch(`/pos/orders/${tableOrder.id}/status`, { status: 'BILL_REQUESTED' }); showToast('🧾 Bill requested!'); await loadTables(); setScreen('tables'); setSelectedTable(null); setTableOrder(null); }
    catch { showToast('⚠ Failed'); }
    finally { setBillBusy(false); }
  };

  // ── Swipe handlers ────────────────────────────────────────────────
  const onTouchStart = e => { touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchEnd   = (e, t, status) => {
    const dx = e.changedTouches[0].clientX - touchStart.current.x;
    const dy = Math.abs(e.changedTouches[0].clientY - touchStart.current.y);
    if (dy > 40 || Math.abs(dx) < 50) return; // too vertical or too short = tap
    if (dx > 0) handleTableSelect(t);             // swipe right = open
    else if (status !== 'vacant') quickBillTable(t); // swipe left = bill
  };

  // ── Derived data ──────────────────────────────────────────────────
  const activeCatIds = new Set(products.map(p => p.category_id));
  const visibleCats  = categories.filter(c => activeCatIds.has(c.id));
  // Items for current quickCat or selectedCategory
  const activeCat    = quickCat || selectedCategory;
  const catProducts  = activeCat ? products.filter(p => p.category_id === activeCat.id) : products;
  const filteredProducts = itemSearch.trim() ? catProducts.filter(p => p.name.toLowerCase().includes(itemSearch.toLowerCase())) : catProducts;

  // ─────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────

  if (screen === 'login') return (
    <div className="waiter-app">
      <LoginScreen pin={pin} onDigit={handleDigit} onBack={() => setPin(p => p.slice(0,-1))} error={loginErr} busy={loginBusy} />
    </div>
  );

  if (screen === 'success') return (
    <div className="waiter-app">
      <div className="w-content" style={{ display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div className="w-success">
          <div className="w-success-icon">✅</div>
          <div className="w-success-title">Order Sent!</div>
          <div className="w-success-sub">Kitchen notified</div>
        </div>
      </div>
    </div>
  );

  // ── TABLES ─────────────────────────────────────────────────────────
  if (screen === 'tables') {
    const grouped = {};
    for (const t of tables) (grouped[t.section || 'Hall'] ??= []).push(t);
    const sections = Object.keys(grouped);
    return (
      <div className="waiter-app">
        <header className="w-header">
          <span className="w-header-title">🍽 Tables</span>
          {queueCount > 0 && <span className="w-offline-badge" title="Queued offline orders">{queueCount} queued</span>}
          <button className="w-header-btn" onClick={openStats}>📊</button>
          <span className="w-chip">{user?.name?.split(' ')[0] || 'Waiter'}</span>
          <button className="w-header-btn" onClick={handleLogout}>Logout</button>
        </header>

        <div className="w-content">
          {/* Call alerts banner */}
          {calls.length > 0 && (
            <div className="w-call-banner">
              {calls.map(c => (
                <div key={c.id} className="w-call-item">
                  <span>📢 <strong>{c.table_name}</strong> needs assistance</span>
                  <button className="w-call-dismiss" onClick={() => dismissCall(c)}>✓ Done</button>
                </div>
              ))}
            </div>
          )}

          <div className="w-legend">
            <span className="w-legend-item"><span className="w-legend-dot vacant"/>Vacant</span>
            <span className="w-legend-item"><span className="w-legend-dot occupied"/>Occupied</span>
            <span className="w-legend-item"><span className="w-legend-dot bill"/>Bill</span>
          </div>

          {tablesLoading ? (
            <div className="w-loading"><div className="w-spinner"/><span>Loading…</span></div>
          ) : sections.map(sec => (
            <div key={sec}>
              {sections.length > 1 && <div className="w-section-label">{sec}</div>}
              <div className="w-table-grid">
                {grouped[sec].map(t => {
                  const d = getTableData(t);
                  return (
                    <div
                      key={t.id}
                      className={`w-table-card ${d.status} ${d.status !== 'vacant' ? d.tClass : ''} ${d.hasCall ? 'has-call' : ''}`}
                      onTouchStart={onTouchStart}
                      onTouchEnd={e => onTouchEnd(e, t, d.status)}
                      onClick={() => handleTableSelect(t)}
                    >
                      {d.hasCall && <div className="w-call-dot">📢</div>}
                      <div className="w-table-emoji">
                        {d.status === 'vacant' ? '🟢' : d.status === 'bill_req' ? '🧾' : '🟠'}
                      </div>
                      <div className="w-table-name">{t.name}</div>
                      {d.status !== 'vacant' ? (
                        <div className="w-table-meta">
                          {d.timer && <span className="w-table-timer">{d.timer}</span>}
                          {d.amount > 0 && <span className="w-table-amt">{fmt(d.amount)}</span>}
                          {d.sentCount > 0 && (
                            <span className={`w-ready-dot${d.readyCount === d.sentCount ? ' w-ready-all' : d.readyCount > 0 ? ' w-ready-partial' : ' w-ready-none'}`}>
                              {d.readyCount}/{d.sentCount} READY
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="w-table-badge">Vacant</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div style={{ height: 20 }} />
        </div>

        {/* Stats modal */}
        {showStats && (
          <div className="w-modal-overlay" onClick={() => setShowStats(false)}>
            <div className="w-modal-sheet" onClick={e => e.stopPropagation()}>
              <div className="w-modal-header">
                <div className="w-modal-title">📊 My Performance Today</div>
                <div className="w-modal-subtitle">{user?.name}</div>
              </div>
              <div className="w-modal-body">
                {statsLoading ? (
                  <div className="w-loading"><div className="w-spinner"/></div>
                ) : stats ? (
                  <div className="w-stats-grid">
                    <div className="w-stat-card">
                      <div className="w-stat-val">{stats.ordersToday}</div>
                      <div className="w-stat-label">Orders Today</div>
                    </div>
                    <div className="w-stat-card">
                      <div className="w-stat-val">{stats.tablesServed}</div>
                      <div className="w-stat-label">Tables Served</div>
                    </div>
                    <div className="w-stat-card">
                      <div className="w-stat-val">{stats.avgServiceMin != null ? `${stats.avgServiceMin}m` : '—'}</div>
                      <div className="w-stat-label">Avg Service Time</div>
                    </div>
                  </div>
                ) : (
                  <div className="w-empty"><div className="w-empty-text">No data yet today</div></div>
                )}
              </div>
              <div className="w-modal-footer">
                <button className="w-btn" style={{ flex:1 }} onClick={() => setShowStats(false)}>Close</button>
              </div>
            </div>
          </div>
        )}

        {toast && <div className="w-toast">{toast}</div>}
      </div>
    );
  }

  // ── CATEGORIES ──────────────────────────────────────────────────────
  if (screen === 'categories') {
    const sent = getSentItems(tableOrder);
    const totalSentQty = sent.reduce((s,i) => s + i.quantity, 0);
    const byKot = {};
    for (const i of sent) (byKot[i._kotNum] ??= []).push(i);

    return (
      <div className="waiter-app">
        <header className="w-header">
          <button className="w-header-back" onClick={() => setScreen('tables')}>‹</button>
          <span className="w-header-title">{selectedTable?.name}</span>
          {tableOrder && <span className="w-chip" style={{ fontSize:11 }}>{tableOrder.status === 'BILL_REQUESTED' ? '🧾 Bill' : '● Open'}</span>}
          {/* ≡ three-dot / hamburger → side menu */}
          <button className="w-header-btn" style={{ fontSize:18, padding:'4px 10px' }} onClick={() => setShowSideMenu(true)}>☰</button>
        </header>

        {tableOrder?.status === 'BILL_REQUESTED' && (
          <div className="w-notice-bar" style={{ background:'#fff1f2', borderBottomColor:'#fca5a5', color:'#991b1b' }}>
            <span>Bill has been requested</span>
          </div>
        )}

        <div className="w-content">
          {/* ── Pax counter (compact, top) ── */}
          <div className="w-setup-section">
            <div className="w-setup-row">
              <span className="w-setup-label">👥 Pax</span>
              <div className="w-pax-ctrl">
                <button className="w-qty-btn minus" style={{ width:32, height:32 }} onClick={() => { const n=Math.max(0,paxCount-1); setPaxCount(n); saveOrderMeta(n, tableTags); }}>−</button>
                <span className="w-pax-val">{paxCount || '—'}</span>
                <button className="w-qty-btn plus"  style={{ width:32, height:32 }} onClick={() => { const n=paxCount+1; setPaxCount(n); saveOrderMeta(n, tableTags); }}>+</button>
              </div>
              {/* Active tags shown as chips here */}
              {tableTags.length > 0 && (
                <div style={{ display:'flex', gap:4, flexWrap:'wrap', flex:1, justifyContent:'flex-end' }}>
                  {tableTags.map(t => {
                    const tagObj = sideMenuTags.find(x => x.name === t);
                    return <span key={t} className="w-tag-chip active" style={{ fontSize:11, padding:'3px 8px' }}>{tagObj?.value || ''} {t}</span>;
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Current Order (sent, read-only) ── */}
          {totalSentQty > 0 && (
            <div className="w-co-bar">
              <button className="w-co-toggle" onClick={() => setShowCurrentOrder(s => !s)}>
                <span className="w-co-toggle-label">📋 Current Order</span>
                <span className="w-co-count-pill">{totalSentQty} items</span>
                <span className="w-co-arrow">{showCurrentOrder ? '▲' : '▼'}</span>
              </button>
              {showCurrentOrder && (
                <div className="w-co-list">
                  {Object.entries(byKot).map(([n, items]) => (
                    <div key={n} className="w-co-kot-group">
                      <div className="w-co-kot-label">KOT #{n}</div>
                      {items.map(i => (
                        <div key={i.id} className="w-co-item">
                          <span className="w-co-item-qty">×{i.quantity}</span>
                          <span className="w-co-item-name">{i.product_name}{i.is_home_pack ? ' 📦' : ''}</span>
                          <span className={`w-co-status${i._served ? ' served' : ''}`}>{i._served ? '✓ Served' : '🔥 Kitchen'}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                  <div className="w-co-footer">Sent items are read-only</div>
                </div>
              )}
            </div>
          )}

          {/* ── Repeat Last Order ── */}
          {!tableOrder && (
            <div style={{ padding:'0 12px 8px', display:'flex', gap:8 }}>
              <button className="w-btn secondary" style={{ flex:1, fontSize:13 }} onClick={repeatLastOrder}>
                🔁 Repeat Last Order
              </button>
            </div>
          )}

          <div className="w-section-label">Select Category</div>
          {visibleCats.length === 0 ? (
            <div className="w-loading"><div className="w-spinner"/><span>Loading menu…</span></div>
          ) : (
            <div className="w-cat-grid">
              {visibleCats.map(cat => {
                const count = products.filter(p => p.category_id === cat.id).length;
                const icon  = catEmoji(cat.name, cat.icon);
                return (
                  <div key={cat.id} className="w-cat-card" onClick={() => handleCategorySelect(cat)}>
                    <div className="w-cat-icon">{icon}</div>
                    <div className="w-cat-name">{cat.name}</div>
                    <div className="w-cat-count">{count} item{count !== 1 ? 's' : ''}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {cart.length > 0 && (
          <div className="w-bottom-bar">
            <div className="w-bottom-summary">
              <div className="w-bottom-count">{cartCount} item{cartCount !== 1 ? 's' : ''}</div>
              <div className="w-bottom-total">{fmt(cartTotal)}</div>
            </div>
            <button className="w-btn" onClick={() => setScreen('review')}>Review →</button>
          </div>
        )}
        {/* ── Side Menu (≡ → slide-in from right) ── */}
        {showSideMenu && (
          <div className="w-side-overlay" onClick={() => setShowSideMenu(false)}>
            <div className="w-side-panel" onClick={e => e.stopPropagation()}>
              <div className="w-side-header">
                <span className="w-side-title">Table {selectedTable?.name}</span>
                <button className="w-side-close" onClick={() => setShowSideMenu(false)}>✕</button>
              </div>

              {/* Bill action */}
              {tableOrder && tableOrder.status !== 'BILL_REQUESTED' && (
                <button className="w-side-action danger" onClick={() => { setShowSideMenu(false); requestBill(); }}>
                  <span className="w-side-icon">🧾</span>
                  <span>Request Bill</span>
                </button>
              )}

              {/* Divider */}
              {sideMenuTags.length > 0 && <div className="w-side-divider">Table Tags</div>}

              {/* Tags from lookup_master TABLE_TAG */}
              {sideMenuTags.map(tag => {
                const active = tableTags.includes(tag.name);
                return (
                  <button
                    key={tag.id}
                    className={`w-side-action${active ? ' active' : ''}`}
                    onClick={() => {
                      const next = active ? tableTags.filter(t => t !== tag.name) : [...tableTags, tag.name];
                      setTableTags(next); saveOrderMeta(paxCount, next);
                    }}
                  >
                    <span className="w-side-icon">{tag.value}</span>
                    <span>{tag.name}</span>
                    {active && <span className="w-side-check">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {toast && <div className="w-toast">{toast}</div>}
      </div>
    );
  }

  // ── ITEMS ───────────────────────────────────────────────────────────
  if (screen === 'items') return (
    <div className="waiter-app">
      <header className="w-header">
        <button className="w-header-back" onClick={() => setScreen('categories')}>‹</button>
        <span className="w-header-title">{activeCat?.name || 'All'}</span>
        <span className="w-header-sub">{selectedTable?.name}</span>
      </header>

      {/* ── Floating Quick Category Strip ── */}
      <div className="w-qcat-strip">
        {visibleCats.map(c => (
          <button
            key={c.id}
            className={`w-qcat-chip${(quickCat?.id === c.id) ? ' active' : ''}`}
            onClick={() => { setQuickCat(c); setItemSearch(''); }}
          >{c.name}</button>
        ))}
      </div>

      <div className="w-content" style={{ paddingTop: 0 }}>
        <div className="w-search">
          <input className="w-search-input" type="search"
            placeholder="Search…"
            value={itemSearch} onChange={e => setItemSearch(e.target.value)}
          />
        </div>

        {filteredProducts.length === 0 ? (
          <div className="w-empty"><div className="w-empty-icon">🍽</div><div className="w-empty-text">{itemSearch ? 'No match' : 'No items'}</div></div>
        ) : (
          <div className="w-items-list">
            {filteredProducts.map(p => {
              const mvs = mvFn(p.variants);
              const hasOpts = mvs.length > 0 || !!p.has_modifiers; // !! converts SQLite 0/1 to boolean
              const totalQty = cart.filter(i => i.product_id === p.id).reduce((s,i) => s + i.quantity, 0);
              const productCartItems = hasOpts ? cart.filter(i => i.product_id === p.id) : [];
              return (
                <ProductRow
                  key={p.id}
                  product={p} totalQty={totalQty} hasOptions={hasOpts} mvs={mvs}
                  cartSubItems={productCartItems}
                  onTap={() => handleProductTap(p)}
                  onInc={() => {
                    if (hasOpts) { openPicker(p); return; }
                    // addCartItem increments if already in cart, adds if not
                    addCartItem({ product_id: p.id, variant_id: null, product_name: p.name, unit_price: p.price || 0, modifiers: [] });
                  }}
                  onDec={() => decItem(p.id, null)}
                  onDecCartItem={(pid, vid) => decItem(pid, vid)}
                  onIncCartItem={(pid, vid) => incItem(pid, vid)}
                  showSimpleQty={!hasOpts}
                  simpleQty={getQty(p.id, null)}
                />
              );
            })}
          </div>
        )}
      </div>

      {cart.length > 0 && (
        <div className="w-bottom-bar">
          <div className="w-bottom-summary">
            <div className="w-bottom-count">{cartCount} items</div>
            <div className="w-bottom-total">{fmt(cartTotal)}</div>
          </div>
          <button className="w-btn" onClick={() => setScreen('review')}>Review →</button>
        </div>
      )}

      {pickerProd && (
        <ProductPickerModal
          product={pickerProd} mvs={mvFn(pickerProd.variants)}
          variant={pickerVariant} onVariantChange={setPickerVariant}
          modGroups={pickerModGrps} modSel={pickerModSel}
          onModToggle={id => setPickerModSel(p => ({ ...p, [id]: !p[id] }))}
          qty={pickerQty} onQtyChange={setPickerQty}
          modsLoading={pickerModLoad} onCancel={closePicker} onConfirm={confirmPicker}
        />
      )}
      {toast && <div className="w-toast">{toast}</div>}
    </div>
  );

  // ── REVIEW ──────────────────────────────────────────────────────────
  if (screen === 'review') return (
    <div className="waiter-app">
      <header className="w-header">
        <button className="w-header-back" onClick={() => setScreen('items')}>‹</button>
        <span className="w-header-title">Review Order</span>
        <span className="w-header-sub">{selectedTable?.name}</span>
      </header>
      <div className="w-content">
        <div className="w-review-list">
          {cart.map(item => (
            <div key={item.key} className="w-review-card">
              <div className="w-review-card-top">
                <div className="w-qty-ctrl" style={{ gap:4 }}>
                  <button className="w-qty-btn minus" style={{ width:34,height:34 }} onClick={() => decItem(item.product_id, item.variant_id)}>−</button>
                  <span className="w-qty-val" style={{ fontSize:16 }}>{item.quantity}</span>
                  <button className="w-qty-btn plus"  style={{ width:34,height:34 }} onClick={() => incItem(item.product_id, item.variant_id)}>+</button>
                </div>
                <span className="w-review-card-name">{item.product_name}</span>
                <span className="w-review-card-total">{fmt(item.unit_price * item.quantity)}</span>
                <button className="w-remove-btn" onClick={() => removeItem(item.key)}>×</button>
              </div>
              <div className="w-review-note">
                <label className="w-review-pack">
                  <input
                    type="checkbox"
                    checked={!!item.is_homepack}
                    onChange={e => updateHomePack(item.key, e.target.checked)}
                    className="w-review-pack-cb"
                  />
                  <span className="w-review-pack-label">Take Out / Pack</span>
                </label>
                <input className="w-review-note-input" type="text" placeholder="Kitchen note…" value={item.notes} onChange={e => updateNotes(item.key, e.target.value)} />
              </div>
            </div>
          ))}
          <div className="w-review-total">
            <span className="w-review-total-label">Order Total</span>
            <span className="w-review-total-val">{fmt(cartTotal)}</span>
          </div>
        </div>
      </div>
      <div className="w-bottom-bar">
        <button className="w-btn secondary" style={{ flexShrink:0 }} onClick={() => setScreen('categories')}>+ More</button>
        <button className="w-btn" style={{ flex:1 }} onClick={sendOrder} disabled={sending || !cart.length}>
          {sending ? 'Sending…' : '▶ Send to Kitchen'}
        </button>
      </div>
      {toast && <div className="w-toast">{toast}</div>}
    </div>
  );

  return null;
}

// ═══════════════════════════════════════════════════════════════════
//  LoginScreen
// ═══════════════════════════════════════════════════════════════════
function LoginScreen({ pin, onDigit, onBack, error, busy }) {
  return (
    <div className="w-login">
      <div className="w-login-brand">
        <div className="w-login-icon">🍽</div>
        <div className="w-login-title">MTC WAITER</div>
        <div className="w-login-sub">Restaurant Order System</div>
      </div>
      <div className="w-login-card">
        <div className="w-login-prompt">Enter 4-digit PIN</div>
        <div className="w-pin-dots">
          {[0,1,2,3].map(i => <div key={i} className={`w-pin-dot${pin.length > i ? ' filled' : ''}`} />)}
        </div>
        <div className="w-numpad">
          {['1','2','3','4','5','6','7','8','9'].map(d => (
            <button key={d} className="w-numpad-key" onClick={() => onDigit(d)} disabled={busy || pin.length >= 4}>{d}</button>
          ))}
          <button className="w-numpad-key key-del" onClick={onBack} disabled={busy}>⌫</button>
          <button className="w-numpad-key" onClick={() => onDigit('0')} disabled={busy || pin.length >= 4}>0</button>
          <button className="w-numpad-key" disabled style={{ background:'transparent' }}>
            {busy && <span className="w-spinner" style={{ width:22, height:22, borderWidth:2 }} />}
          </button>
        </div>
        <div className="w-login-error">{error}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  ProductRow
// ═══════════════════════════════════════════════════════════════════
function ProductRow({ product, totalQty, hasOptions, mvs, cartSubItems=[], onTap, onInc, onDec, onDecCartItem, onIncCartItem, showSimpleQty, simpleQty }) {
  const priceRange = mvs.length
    ? (() => { const prices = mvs.map(v=>v.price).filter(p=>p>0); if (!prices.length) return product.price?`₹${product.price}`:''; const mn=Math.min(...prices),mx=Math.max(...prices); return mn===mx?`₹${mn.toLocaleString('en-IN')}`:` ₹${mn.toLocaleString('en-IN')} – ₹${mx.toLocaleString('en-IN')}`; })()
    : product.price ? `₹${Number(product.price).toLocaleString('en-IN')}` : '';

  return (
    <div className={`w-item-card${totalQty > 0 ? ' in-cart' : ''}${hasOptions && cartSubItems.length > 0 ? ' has-sub' : ''}`}>
      <div className="w-item-main-row">
        <div className="w-item-info" onClick={onTap} style={{ cursor:'pointer' }}>
          <div className="w-item-name">{product.name}</div>
          <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap', marginTop:2 }}>
            <span className="w-item-price">{priceRange}</span>
            {hasOptions && <span className="w-opt-pill">{mvs.length ? `${mvs.length} sizes` : 'Options'}</span>}
          </div>
        </div>
        <div className="w-qty-ctrl">
          {showSimpleQty && simpleQty > 0 ? (
            <><button className="w-qty-btn minus" onClick={onDec}>−</button><span className="w-qty-val">{simpleQty}</span><button className="w-qty-btn plus" onClick={onInc}>+</button></>
          ) : (
            <button className="w-qty-btn plus-solo" onClick={hasOptions ? onTap : onInc}>+</button>
          )}
        </div>
      </div>
      {hasOptions && cartSubItems.length > 0 && (
        <div className="w-item-sub-rows">
          {cartSubItems.map(ci => (
            <div key={ci.key} className="w-item-sub-row">
              <span className="w-item-sub-name">{ci.product_name}</span>
              <div className="w-qty-ctrl" style={{ gap:4 }}>
                <button className="w-qty-btn minus" style={{ width:30,height:30,fontSize:18 }} onClick={e => { e.stopPropagation(); onDecCartItem?.(ci.product_id,ci.variant_id); }}>−</button>
                <span className="w-qty-val" style={{ fontSize:14,minWidth:22 }}>{ci.quantity}</span>
                <button className="w-qty-btn plus"  style={{ width:30,height:30,fontSize:18 }} onClick={e => { e.stopPropagation(); onIncCartItem?.(ci.product_id,ci.variant_id); }}>+</button>
              </div>
              <span className="w-item-sub-price">{fmt(ci.unit_price*ci.quantity)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  ProductPickerModal
// ═══════════════════════════════════════════════════════════════════
function ProductPickerModal({ product, mvs, variant, onVariantChange, modGroups, modSel, onModToggle, qty, onQtyChange, modsLoading, onCancel, onConfirm }) {
  const selMods  = modGroups.flatMap(g => g.items.filter(m => modSel[m.id]));
  const modTotal = selMods.reduce((s,m) => s+m.price, 0);
  const base     = variant ? variant.price : (product.price || 0);
  const lineTotal = (base + modTotal) * qty;
  return (
    <div className="w-modal-overlay" onClick={onCancel}>
      <div className="w-modal-sheet" onClick={e => e.stopPropagation()}>
        <div className="w-modal-header">
          <div className="w-modal-title">{product.name}</div>
          {variant && <div className="w-modal-subtitle">{variant.name} · ₹{variant.price.toLocaleString('en-IN')}</div>}
        </div>
        <div className="w-modal-body">
          {mvs.length > 0 && (
            <div className="w-option-group">
              <div className="w-option-label">Choose Size / Variant</div>
              <div className="w-option-list">
                {mvs.map(v => (
                  <label key={v.id} className={`w-option-row${variant?.id===v.id?' selected':''}`}>
                    <input type="radio" name="variant" checked={variant?.id===v.id} onChange={() => onVariantChange(v)} />
                    <span className="w-option-name">{v.name}</span>
                    {v.price>0 && <span className="w-option-price">₹{v.price.toLocaleString('en-IN')}</span>}
                  </label>
                ))}
              </div>
            </div>
          )}
          {modsLoading && <div style={{ display:'flex',gap:8,alignItems:'center',padding:'12px 0',color:'#7a6555',fontSize:13 }}><span className="w-spinner" style={{ width:18,height:18,borderWidth:2 }}/>Loading options…</div>}
          {modGroups.map(grp => (
            <div key={grp.id} className="w-option-group">
              <div className="w-option-label">{grp.name}</div>
              <div className="w-option-list">
                {grp.items.map(m => (
                  <label key={m.id} className={`w-option-row${modSel[m.id]?' selected':''}`}>
                    <input type="checkbox" checked={!!modSel[m.id]} onChange={() => onModToggle(m.id)} />
                    <span className="w-option-name">{m.name}</span>
                    {m.price>0 && <span className="w-option-price">+₹{m.price.toLocaleString('en-IN')}</span>}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div className="w-modal-qty-row">
            <span className="w-modal-qty-label">Quantity</span>
            <div className="w-qty-ctrl">
              <button className="w-qty-btn minus" onClick={() => onQtyChange(q => Math.max(1,q-1))}>−</button>
              <span className="w-qty-val">{qty}</span>
              <button className="w-qty-btn plus"  onClick={() => onQtyChange(q => q+1)}>+</button>
            </div>
          </div>
          {lineTotal > 0 && <div className="w-modal-price">{qty>1&&`${qty} × `}{fmt(base+modTotal)} = <strong>{fmt(lineTotal)}</strong></div>}
        </div>
        <div className="w-modal-footer">
          <button className="w-btn secondary" style={{ flexShrink:0 }} onClick={onCancel}>Cancel</button>
          <button className="w-btn" style={{ flex:1 }} onClick={onConfirm}>Add to Cart {qty>1?`(${qty})`:''}</button>
        </div>
      </div>
    </div>
  );
}
