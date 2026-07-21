import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { createSocket } from '../../socket';
import { imgSrc } from './lib/img';
import { createAlertPlayer } from '../../utils/alertSound';
import ConfettiBurst from '../../components/ConfettiBurst/ConfettiBurst';
import BottomNav from './components/BottomNav';
import FloorGrid from './components/FloorGrid';
import OpenOrders from './components/OpenOrders';
import ServeBoard from './components/ServeBoard';
import MotionArt from './components/MotionArt';
import Thumb from './components/Thumb';
import Icon from './components/Icon';
import SettingsSheet from './components/SettingsSheet';
import NewOrderSheet from './components/NewOrderSheet';
import { usePullToRefresh } from './lib/usePullToRefresh';
import { initRipple } from './lib/ripple';
import { tapLight, tapMedium, tapSuccess, tapWarn, tapCall, setHapticsEnabled } from './lib/haptics';
import { getSettings, saveSettings, resetSettings, applySettings } from './lib/waiterSettings';
import './waiter.css';

// ── Session keys ──────────────────────────────────────────────────────
const S_KEY  = 'waiter_session';
const U_KEY  = 'waiter_user';
const Q_KEY  = 'waiter_offline_queue';
const API    = import.meta.env.VITE_API_URL || '/api';

// ── Offline menu cache keys ──────────────────────────────────────────
const MK_CAT     = 'waiter_menu_categories';
const MK_PROD    = 'waiter_menu_products';
const MK_MOD     = 'waiter_menu_modifiers';
const MK_SYNCED  = 'waiter_menu_synced_at';
const MENU_IMG_CACHE = 'waiter-menu-images'; // must match sw.js

// ── Axios instance ────────────────────────────────────────────────────
export const api = axios.create({ baseURL: API });
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
  initRipple();
  if (!document.querySelector('link[href="/waiter-manifest.json"]')) {
    document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'manifest', href: '/waiter-manifest.json' }));
  }
  let tc = document.querySelector('meta[name="theme-color"]');
  if (!tc) { tc = Object.assign(document.createElement('meta'), { name: 'theme-color' }); document.head.appendChild(tc); }
  tc.content = '#131317';   /* M3 --surface */
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

// Header/label text for a non-table order in progress (see orderMode state).
// null (DINE_IN via selectedTable) never reaches this map.
const ORDER_MODE_LABEL = {
  TAKEAWAY:  'Take away',
  DELIVERY:  'Delivery',
  DRAFT:     'Draft order',
  SCHEDULED: 'Scheduled order',
};

// ═══════════════════════════════════════════════════════════════════
//  ROOT
// ═══════════════════════════════════════════════════════════════════
export default function WaiterApp() {

  // ── Auth ────────────────────────────────────────────────────────
  const [user,      setUser]      = useState(null);
  const [pin,       setPin]       = useState('');
  const [loginErr,  setLoginErr]  = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  // ── Offline menu sync ──────────────────────────────────────────────
  const [syncProgress, setSyncProgress] = useState({ stage: 'Menu', done: 0, total: 1 });
  const [syncing,      setSyncing]      = useState(false); // header spin, silent resync

  // ── Navigation ──────────────────────────────────────────────────
  const [screen, setScreen] = useState('login');
  const [homeTab, setHomeTab] = useState('floor');      // floor | open | serve
  const [floorFilter, setFloorFilter] = useState('all'); // all | occupied

  // ── Master data ─────────────────────────────────────────────────
  const [tables,       setTables]       = useState([]);
  const [activeOrders, setActiveOrders] = useState({ orders: [], kots: [] });
  const [categories,   setCategories]   = useState([]);
  const [products,     setProducts]     = useState([]);
  const [stations,     setStations]     = useState([]);
  const [scheduled,    setScheduled]    = useState([]);

  // ── Variants flagged Auto Entry / Check on Bill (floor-table logic only) ──
  const [flaggedVariants, setFlaggedVariants] = useState([]);
  const [forgotList,      setForgotList]      = useState(null); // check_on_bill misses, null = no prompt

  // ── Working state ────────────────────────────────────────────────
  const [selectedTable,    setSelectedTable]    = useState(null);
  const [tableOrder,       setTableOrder]       = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [cart,             setCart]             = useState([]);

  // Non-table order in progress — Takeaway / Delivery / Draft / Scheduled.
  // Mutually exclusive with selectedTable: starting one clears the other.
  // { menuType, orderType, kind, label, customerName, customerPhone,
  //   scheduledFor, notifyBeforeMin } | null
  const [orderMode,    setOrderMode]    = useState(null);
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [schedDetail,  setSchedDetail]  = useState(null); // scheduled/draft row opened from Open Orders

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
  const [toastKind,     setToastKind]     = useState(null);
  const [celebrateId,   setCelebrateId]   = useState(0);
  const [itemSearch,    setItemSearch]    = useState('');
  const [quickCat,      setQuickCat]      = useState(null); // floating category filter
  const [tick,          setTick]          = useState(0);    // for timer updates

  // ── Offline queue ────────────────────────────────────────────────
  const offlineQ = useRef((() => {
    try { return JSON.parse(localStorage.getItem(Q_KEY) || '[]'); } catch { return []; }
  })());
  const [queueCount, setQueueCount] = useState(offlineQ.current.length);

  const toastRef  = useRef(null);
  // Order IDs this waiter just punched in themselves — suppresses the "new order"
  // toast/sound for our own action (still alerts for orders placed from POS/other waiters).
  const selfCreatedOrdersRef = useRef(new Set());
  const touchStart = useRef({ x: 0, y: 0 });

  // ── Settings ─────────────────────────────────────────────────────
  const [settings,     setSettings]     = useState(getSettings);
  const [showSettings, setShowSettings] = useState(false);

  const updateSettings = useCallback((patch) => setSettings(saveSettings(patch)), []);
  const restoreDefaults = useCallback(() => setSettings(resetSettings()), []);

  // Each screen returns its own .waiter-app root, so there is no single
  // element to hang a ref on. Re-querying on screen change costs one DOM
  // lookup per navigation and keeps the 7 render branches untouched.
  useEffect(() => {
    applySettings(document.querySelector('.waiter-app'), settings);
  }, [settings, screen, showSettings]);

  useEffect(() => { setHapticsEnabled(settings.haptics); }, [settings.haptics]);

  // Screen Wake Lock — the single biggest reason this needed to be a native
  // app. Chrome drops the sentinel whenever the tab is hidden, so it is
  // re-acquired on every visibilitychange rather than held once.
  useEffect(() => {
    if (!settings.keepAwake || !('wakeLock' in navigator)) return;
    let sentinel = null, cancelled = false;

    const acquire = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const s = await navigator.wakeLock.request('screen');
        if (cancelled) { s.release(); return; }
        sentinel = s;
      } catch { /* denied, low battery, or no permission — not fatal */ }
    };

    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', acquire);
      sentinel?.release().catch(() => {});
    };
  }, [settings.keepAwake]);

  // ── Timer tick every 30s ────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  // ── Init ─────────────────────────────────────────────────────────
  useEffect(() => {
    bootPWA();
    const sid = localStorage.getItem(S_KEY), usr = localStorage.getItem(U_KEY);
    if (sid && usr) {
      try {
        setUser(JSON.parse(usr));
        if (hydrateMenu()) { setScreen('tables'); syncMenu({ silent: true }); }
        else syncMenu();
      } catch { localStorage.removeItem(S_KEY); localStorage.removeItem(U_KEY); }
    }
  }, []);

  // ── Load active waiter calls on mount ───────────────────────────
  useEffect(() => {
    if (!user) return;
    api.get('/pos/waiter/calls/active').then(r => setCalls(r.data)).catch(() => {});
  }, [user]);

  // ── Centrally-configured "order ready" alert sound ──────────────
  const alertPlayerRef = useRef(null);
  if (!alertPlayerRef.current) alertPlayerRef.current = createAlertPlayer(880);

  // ── Centrally-configured "new order" alert sound (distinct from "ready") ──
  const newOrderPlayerRef = useRef(null);
  if (!newOrderPlayerRef.current) newOrderPlayerRef.current = createAlertPlayer(660);

  useEffect(() => {
    if (!user) return;
    api.get('/settings/kds-sound').then(r => {
      alertPlayerRef.current.setSrc(r.data.waiter_ready);
      newOrderPlayerRef.current.setSrc(r.data.waiter_new_order);
    }).catch(() => {});
  }, [user]);

  useEffect(() => {
    const unlock = () => { alertPlayerRef.current.unlock(); newOrderPlayerRef.current.unlock(); };
    document.addEventListener('click', unlock, { once: true, passive: true });
    document.addEventListener('touchstart', unlock, { once: true, passive: true });
    return () => {
      document.removeEventListener('click', unlock);
      document.removeEventListener('touchstart', unlock);
    };
  }, []);

  // ── Online → drain offline queue ────────────────────────────────
  useEffect(() => {
    const onOnline = () => drainOfflineQueue();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  // ── Toast ──────────────────────────────────────────────────────
  const showToast = (msg, kind = null) => {
    setToast(msg);
    setToastKind(kind);
    if (kind === 'success') setCelebrateId(id => id + 1);
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => { setToast(''); setToastKind(null); }, 2800);
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
      setUser(u); setPin('');
      if (hydrateMenu()) { setScreen('tables'); syncMenu({ silent: true }); }
      else await syncMenu();
    } catch (err) { setLoginErr(err.response?.data?.error || 'Invalid PIN'); setPin(''); }
    finally { setLoginBusy(false); }
  };
  const handleLogout = async () => {
    try { await api.post('/auth/logout', { sessionId: localStorage.getItem(S_KEY) }); } catch {}
    localStorage.removeItem(S_KEY); localStorage.removeItem(U_KEY);
    setUser(null); setCart([]); setSelectedTable(null); setTableOrder(null); setOrderMode(null); setScreen('login');
  };

  // ── Data loaders ───────────────────────────────────────────────
  const loadOrders = useCallback(async () => {
    try { const r = await api.get('/pos/orders/active'); setActiveOrders(r.data); } catch {}
  }, []);
  const loadScheduled = useCallback(async () => {
    try { const r = await api.get('/pos/scheduled'); setScheduled(Array.isArray(r.data) ? r.data : (r.data?.rows ?? [])); }
    catch { /* queue tab just stays empty */ }
  }, []);
  const loadTables = useCallback(async () => {
    setTablesLoading(true);
    try {
      const [tr, or] = await Promise.all([api.get('/pos/tables'), api.get('/pos/orders/active')]);
      setTables(tr.data); setActiveOrders(or.data);
      loadScheduled();
    } catch { showToast('⚠ Failed to load tables'); }
    finally { setTablesLoading(false); }
  }, [loadScheduled]);
  useEffect(() => { if (screen === 'tables') loadTables(); }, [screen, loadTables]);

  // Station names for the बाकी board, and the Auto Entry / Check on Bill variant list.
  useEffect(() => {
    if (!user) return;
    api.get('/pos/stations').then(r => setStations(r.data)).catch(() => {});
    api.get('/food-menu/flagged-variants').then(r => setFlaggedVariants(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, [user]);

  const loadOrdersRef = useRef(loadOrders);
  useEffect(() => { loadOrdersRef.current = loadOrders; });

  // ── Socket ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem(S_KEY);
    const socket = createSocket({ role: 'waiter', token: token ?? undefined });
    const reload = () => loadOrdersRef.current();
    // New order/KOT landed — reload the board, and alert unless we just punched it
    // in ourselves from this Waiter app (POS/other-waiter/customer-QR orders still alert).
    socket.on('new-order', (payload) => {
      reload();
      if (payload?.id != null && selfCreatedOrdersRef.current.has(payload.id)) {
        selfCreatedOrdersRef.current.delete(payload.id);
        return;
      }
      const who = payload?.table_name ? `Table ${payload.table_name}` : (payload?.customer_name || `Order #${payload?.id ?? ''}`);
      tapSuccess();
      newOrderPlayerRef.current.play();
      showToast(`🧾 New order — ${who}`, 'success');
    });
    socket.on('order-updated',      reload);
    socket.on('order-cancelled',    reload);
    socket.on('order-completed',    reload);
    socket.on('item-served', (payload) => {
      reload();
      const { status, orderId, product_name, table_name, customer_name, order_status } = payload;
      if (status !== 'SERVED' || !product_name) return;
      const who = table_name ? `Table ${table_name}` : (customer_name || `Order #${orderId}`);
      const closed = order_status === 'CLOSED' || order_status === 'CANCELLED';
      tapSuccess();
      alertPlayerRef.current.play();
      showToast(closed
        ? `🍽️ ${product_name} ready for ${who} — already checked out, please deliver!`
        : `✅ ${product_name} ready — ${who}`, 'success');
    });
    socket.on('item-updated',       reload);
    socket.on('reconnect',          () => { reload(); drainOfflineQueue(); });
    socket.on('waiter-call', payload => {
      setCalls(prev => [...prev.filter(c => c.table_id !== payload.table_id), payload]);
      tapCall();
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
          const payload = item.tableId != null
            ? { order_type: 'DINE_IN', table_id: item.tableId, status: 'OPEN', pax_count: item.paxCount, table_tags: item.tags }
            : { order_type: item.orderType, customer_name: item.customerName || null, customer_phone: item.customerPhone || null, status: 'OPEN' };
          const r = await api.post('/pos/orders', payload);
          orderId = r.data.id;
        }
        selfCreatedOrdersRef.current.add(orderId);
        setTimeout(() => selfCreatedOrdersRef.current.delete(orderId), 5000);
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
    if (o.bill_requested_at) return 'bill_req';
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
    if (!order) return { status, hasCall, timer: null, tClass: '', heat: 'ok', billAsked: false, amount: 0, sentCount: 0, readyCount: 0 };
    const items = getSentItems(order);
    const sentCount = items.reduce((s, i) => s + i.quantity, 0);
    const readyCount = items.filter(i => i._served).reduce((s, i) => s + i.quantity, 0);
    const tClass = timeClass(order.created_at);
    return {
      status, hasCall,
      timer: elapsedDisplay(order.created_at),
      tClass,
      heat: tClass === 'tc-green' ? 'ok' : tClass === 'tc-orange' ? 'warm' : 'hot',
      billAsked: !!order.bill_requested_at,
      amount: order.total_amount || 0, sentCount, readyCount, order,
    };
  }

  // ── Quick bill (swipe left) ──────────────────────────────────────
  const quickBillTable = async t => {
    const o = getOrderForTable(t);
    if (!o || o.bill_requested_at) return;
    try {
      await api.patch(`/pos/orders/${o.id}/request-bill`);
      tapSuccess();
      showToast(`🧾 Bill requested for ${t.name}`);
      loadOrders();
    } catch { tapWarn(); showToast('⚠ Failed'); }
  };

  // ── Serve a pending item straight off the बाकी board ─────────────
  const serveItem = async (kotId, itemId) => {
    try { await api.patch(`/pos/kots/${kotId}/items/${itemId}/serve`); await loadOrders(); }
    catch { tapWarn(); showToast('⚠ Could not mark served'); }
  };
  const dismissCall = async call => {
    try { await api.patch(`/pos/waiter/calls/${call.id}/resolve`); } catch {}
    setCalls(prev => prev.filter(c => c.id !== call.id));
  };

  // ── Open Orders tab → tap a card ─────────────────────────────────
  // Live Takeaway/Delivery orders reopen straight into the cart to add a
  // round; scheduled/draft rows open a read-only detail sheet instead —
  // editing their items is a till job, this just needs Convert/Cancel.
  const openOrderCard = (row, isScheduled) => {
    tapLight();
    if (isScheduled) { setSchedDetail(row); return; }
    reopenNonTableOrder(row);
  };

  const convertScheduled = async row => {
    try {
      await api.post(`/pos/scheduled/${row.id}/convert`);
      tapSuccess();
      showToast(row.kind === 'SCHEDULED' ? '🔥 Sent to kitchen' : '▶ Draft processed', 'success');
    } catch (e) { tapWarn(); showToast(e.response?.data?.error || '⚠ Failed'); }
    setSchedDetail(null);
    loadScheduled(); loadOrders();
  };

  const cancelScheduled = async row => {
    if (!window.confirm(`Cancel this ${row.kind === 'SCHEDULED' ? 'scheduled order' : 'draft'}?`)) return;
    try { await api.post(`/pos/scheduled/${row.id}/cancel`); showToast('Cancelled'); }
    catch { tapWarn(); showToast('⚠ Failed'); }
    setSchedDetail(null);
    loadScheduled();
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

  // ── Offline menu: local persistence ──────────────────────────────
  function persistMenu(cats, prods, mods) {
    try {
      localStorage.setItem(MK_CAT, JSON.stringify(cats));
      localStorage.setItem(MK_PROD, JSON.stringify(prods));
      localStorage.setItem(MK_MOD, JSON.stringify(mods));
      localStorage.setItem(MK_SYNCED, String(Date.now()));
    } catch {}
  }
  function hydrateMenu() {
    try {
      const cats  = JSON.parse(localStorage.getItem(MK_CAT)  || 'null');
      const prods = JSON.parse(localStorage.getItem(MK_PROD) || 'null');
      if (!cats || !prods) return false;
      setCategories(cats); setProducts(prods);
      modCache.current = JSON.parse(localStorage.getItem(MK_MOD) || '{}');
      menuLoaded.current = true;
      return true;
    } catch { return false; }
  }
  async function cacheMenuImages(urls, onProgress) {
    if (!('caches' in window) || !urls.length) return;
    try {
      const cache = await caches.open(MENU_IMG_CACHE);
      let done = 0;
      await Promise.all(urls.map(async url => {
        try { if (!(await cache.match(url))) { const res = await fetch(url); if (res.ok) await cache.put(url, res); } }
        catch {}
        done++; onProgress?.(done);
      }));
    } catch {}
  }

  // ── Offline menu: download categories/products/modifiers/images ────
  const syncMenu = useCallback(async ({ silent = false } = {}) => {
    if (!silent) { setSyncProgress({ stage: 'Menu', done: 0, total: 1 }); setScreen('downloading'); }
    else setSyncing(true);
    try {
      const [cr, pr] = await Promise.all([api.get('/pos/categories'), api.get('/pos/products')]);
      const cats = cr.data, prods = pr.data;

      const needMods = prods.filter(p => p.has_modifiers);
      const mods = {};
      let modDone = 0;
      if (!silent) setSyncProgress({ stage: 'Options', done: 0, total: needMods.length || 1 });
      await Promise.all(needMods.map(async p => {
        try { const r = await api.get(`/pos/products/${p.id}/modifiers`); mods[p.id] = r.data; }
        catch { mods[p.id] = []; }
        modDone++; if (!silent) setSyncProgress({ stage: 'Options', done: modDone, total: needMods.length });
      }));

      const imgUrls = [...new Set([
        ...cats.map(c => imgSrc(c.image_url)),
        ...prods.map(p => imgSrc(p.image_url)),
        ...prods.flatMap(p => (p.variants || []).map(v => imgSrc(v.image_url))),
      ].filter(Boolean))];
      if (!silent) setSyncProgress({ stage: 'Photos', done: 0, total: imgUrls.length || 1 });
      await cacheMenuImages(imgUrls, done => { if (!silent) setSyncProgress(p => ({ ...p, done })); });

      setCategories(cats); setProducts(prods); modCache.current = mods;
      menuLoaded.current = true;
      persistMenu(cats, prods, mods);
      if (silent) showToast('🔄 Menu synced');
    } catch {
      if (!silent) showToast('⚠ Sync failed — using saved menu');
    } finally {
      if (!silent) setScreen('tables');
      setSyncing(false);
    }
  }, []);

  // ── Select table ─────────────────────────────────────────────────
  const handleTableSelect = t => {
    const order = getOrderForTable(t);
    setOrderMode(null);
    setSelectedTable(t); setTableOrder(order);
    // Fresh table visit → pre-fill the cart with every "Auto Entry" variant.
    // Existing order = later round, those items are already on the bill.
    setCart(order ? [] : autoEntryVariants().map(v => ({
      key: cartKey(v.product_id, v.id),
      product_id: v.product_id, variant_id: v.id,
      product_name: `${v.product_name} (${v.variant_name})`,
      unit_price: Number(v.selling_price) || 0,
      quantity: 1, notes: '', modifiers: [], is_homepack: false,
    })));
    setItemSearch(''); setSelectedCategory(null);
    setShowCurrentOrder(false); setQuickCat(null);
    setPaxCount(order?.pax_count || 0);
    setTableTags(order?.table_tags ? order.table_tags.split(',').filter(Boolean) : []);
    loadMenu(); loadSideMenuTags(); setScreen('categories');
  };
  const handleCategorySelect = cat => {
    setSelectedCategory(cat); setQuickCat(cat); setItemSearch(''); setShowSideMenu(false); setScreen('items');
  };

  // ── Start a non-table order (Takeaway / Delivery / Draft / Scheduled) ──
  // Same categories → items → review screens as a table, minus everything
  // that only makes sense at a physical table (pax count, tags, bill request,
  // Auto Entry pre-fill — see the comment on autoEntryVariants below).
  const startNewOrder = mode => {
    setShowNewOrder(false);
    setOrderMode(mode);
    setSelectedTable(null); setTableOrder(null);
    setCart([]); setPaxCount(0); setTableTags([]);
    setItemSearch(''); setSelectedCategory(null); setShowCurrentOrder(false); setQuickCat(null);
    loadMenu(); setScreen('categories');
  };

  // Reopen an in-flight (already-punched) Takeaway/Delivery order from the
  // Open Orders tab to add another round — mirrors handleTableSelect for
  // the table case, minus pax/tags which don't apply off a table.
  const reopenNonTableOrder = order => {
    setOrderMode({
      menuType: order.order_type, orderType: order.order_type, kind: null,
      label: ORDER_MODE_LABEL[order.order_type] || order.order_type,
      customerName: order.customer_name || '', customerPhone: order.customer_phone || '',
    });
    setSelectedTable(null); setTableOrder(order);
    setCart([]); setItemSearch(''); setSelectedCategory(null); setShowCurrentOrder(false); setQuickCat(null);
    loadMenu(); setScreen('categories');
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
  // Shape shared by the immediate KOT post and the offline-queue payload —
  // one definition so the two can never drift apart.
  const kotItemsPayload = () => cart.map(i => ({
    product_id: i.product_id, variant_id: i.variant_id ?? null, product_name: i.product_name,
    quantity: i.quantity, unit_price: i.unit_price, is_home_pack: i.is_homepack ? 1 : 0,
    notes: [i.notes, ...(i.modifiers?.map(m => m.name) || [])].filter(Boolean).join(', ') || null,
  }));

  const resetOrderContext = () => { setSelectedTable(null); setTableOrder(null); setOrderMode(null); };

  const sendOrder = async () => {
    if (!cart.length || sending) return;
    setSending(true);
    try {
      let orderId = tableOrder?.id;
      if (!orderId) {
        const payload = orderMode
          ? { order_type: orderMode.orderType, customer_name: orderMode.customerName || null, customer_phone: orderMode.customerPhone || null, status: 'OPEN' }
          : { order_type: 'DINE_IN', table_id: selectedTable.id, status: 'OPEN', pax_count: paxCount, table_tags: tableTags.join(',') };
        const r = await api.post('/pos/orders', payload);
        orderId = r.data.id;
      } else if (!orderMode && (paxCount > 0 || tableTags.length > 0)) {
        // Only patch if there's actual meta to save (avoids "Nothing to update" error)
        await api.patch(`/pos/orders/${orderId}`, { pax_count: paxCount, table_tags: tableTags.join(',') });
      }
      selfCreatedOrdersRef.current.add(orderId);
      setTimeout(() => selfCreatedOrdersRef.current.delete(orderId), 5000);
      await api.post('/pos/kots', { order_id: orderId, punched_by: user?.id, items: kotItemsPayload() });
      setCart([]);
      setScreen('success');
      setTimeout(() => { resetOrderContext(); setScreen('tables'); }, 2200);
    } catch (err) {
      if (!navigator.onLine) {
        saveToQueue(orderMode
          ? { orderType: orderMode.orderType, customerName: orderMode.customerName, customerPhone: orderMode.customerPhone, orderId: tableOrder?.id ?? null, items: kotItemsPayload() }
          : { tableId: selectedTable.id, orderId: tableOrder?.id ?? null, items: kotItemsPayload(), paxCount, tags: tableTags.join(',') });
        showToast('📦 Offline — order queued');
        setCart([]); resetOrderContext(); setScreen('tables');
      } else {
        showToast(err.response?.data?.error || '⚠ Failed to send order');
      }
    } finally { setSending(false); }
  };

  // ── Save Draft / Scheduled order ─────────────────────────────────
  // Writes into pos_scheduled_orders instead of a live order — no KOT until
  // the till (or the scheduler, for SCHEDULED) converts it. Requires being
  // online: a draft that only exists in an offline queue would never show
  // up for anyone else to process.
  const saveDraftOrSchedule = async () => {
    if (!cart.length || sending || !orderMode?.kind) return;
    setSending(true);
    try {
      await api.post('/pos/scheduled', {
        kind: orderMode.kind,
        order_type: orderMode.orderType,
        customer_name: orderMode.customerName || null,
        customer_phone: orderMode.customerPhone || null,
        scheduled_for: orderMode.scheduledFor ?? null,
        notify_before_min: orderMode.notifyBeforeMin ?? 30,
        items: cart.map(i => ({
          product_id: i.product_id, variant_id: i.variant_id ?? null, product_name: i.product_name,
          quantity: i.quantity, unit_price: i.unit_price, is_homepack: !!i.is_homepack,
          notes: [i.notes, ...(i.modifiers?.map(m => m.name) || [])].filter(Boolean).join(', ') || null,
        })),
        total_amount: cartTotal,
      });
      tapSuccess();
      showToast(orderMode.kind === 'SCHEDULED' ? '⏰ Order scheduled' : '📝 Draft saved', 'success');
      setCart([]); resetOrderContext();
      setHomeTab('open'); setScreen('tables');
    } catch (e) {
      tapWarn();
      showToast(e.response?.data?.error || '⚠ Failed to save');
    } finally { setSending(false); }
  };

  // ── Bill request ──────────────────────────────────────────────────
  const requestBill = async (skipCheck = false) => {
    if (!tableOrder?.id || billBusy) return;
    // "Check on Bill" variants must be on the bill before it goes out — prompt once.
    if (!skipCheck) {
      const missing = missingCheckOnBill();
      if (missing.length) { tapWarn(); setForgotList(missing); return; }
    }
    setBillBusy(true);
    try {
      await api.patch(`/pos/orders/${tableOrder.id}/request-bill`);
      tapSuccess();
      showToast('🧾 Bill requested!');
      await loadTables();
      setScreen('tables'); setSelectedTable(null); setTableOrder(null);
    }
    catch { tapWarn(); showToast('⚠ Failed'); }
    finally { setBillBusy(false); }
  };

  // ── Auto Entry / Check on Bill (product_variants flags) ─────────────
  // Floor-table logic only: never applied to take-away, delivery or drafts.
  const autoEntryVariants  = () => flaggedVariants.filter(v => v.auto_entry);
  const checkOnBillVariants = () => flaggedVariants.filter(v => v.check_on_bill);

  // Variants flagged check_on_bill that appear neither in the cart nor already sent.
  function missingCheckOnBill() {
    const flagged = checkOnBillVariants();
    if (!flagged.length) return [];
    const sentIds = new Set(getSentItems(tableOrder).map(i => i.variant_id).filter(Boolean));
    const cartIds = new Set(cart.map(i => i.variant_id).filter(Boolean));
    return flagged.filter(v => !sentIds.has(v.id) && !cartIds.has(v.id));
  }

  const addFlaggedToCart = list => {
    for (const v of list) {
      addCartItem({
        product_id: v.product_id, variant_id: v.id,
        product_name: `${v.product_name} (${v.variant_name})`,
        unit_price: Number(v.selling_price) || 0, modifiers: [],
      });
    }
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
  // A query searches the WHOLE menu, not just the open category — matching on
  // the item name, its category and any variant name. Clearing it drops back
  // to the selected category.
  const q = itemSearch.trim().toLowerCase();
  const searching = q.length > 0;
  const filteredProducts = searching
    ? products.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.category_name || '').toLowerCase().includes(q) ||
        (p.variants || []).some(v => v.name.toLowerCase().includes(q)))
    : catProducts;

  // ── Home scroller + pull-to-refresh (hooks must run before any early return) ──
  const homeScrollRef = useRef(null);
  const refreshHome = useCallback(async () => { await loadTables(); }, [loadTables]);
  const ptr = usePullToRefresh(homeScrollRef, refreshHome);

  // Pending (punched, not yet served) item count — drives the बाकी tab badge.
  const pendingCount = (activeOrders.kots || []).reduce(
    (s, k) => s + (k.items || []).filter(i => !['SERVED', 'CANCELLED'].includes(i.status)).length, 0
  );
  const openCount = (activeOrders.orders || []).filter(o => o.order_type !== 'DINE_IN').length
    + (scheduled || []).filter(s => !['CONVERTED', 'CANCELLED'].includes(s.status)).length;

  // ─────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────

  if (screen === 'login') return (
    <div className="waiter-app">
      <LoginScreen pin={pin} onDigit={handleDigit} onBack={() => setPin(p => p.slice(0,-1))} error={loginErr} busy={loginBusy} />
    </div>
  );

  if (screen === 'downloading') {
    const p = Math.min(1, syncProgress.done / (syncProgress.total || 1));
    return (
      <div className="waiter-app">
        <div className="w-content" style={{ display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div
            className="w-downloading"
            role="progressbar"
            aria-valuenow={Math.round(p * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Downloading menu"
          >
            <MotionArt kind="download" size={96} />
            <div className="w-dl-title">Downloading menu…</div>
            <div className="w-dl-sub">{syncProgress.stage} · {syncProgress.done}/{syncProgress.total}</div>
            {/* scaleX on a composited layer — never animates width */}
            <div className="w-dl-bar"><div className="w-dl-bar-fill" style={{ '--p': p }} /></div>
          </div>
        </div>
      </div>
    );
  }

  if (screen === 'success') return (
    <div className="waiter-app">
      <div className="w-content" style={{ display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div className="w-success">
          <MotionArt kind="success" size={104} />
          <div className="w-success-title">Order Sent!</div>
          <div className="w-success-sub">Kitchen notified</div>
        </div>
      </div>
    </div>
  );

  // ── HOME — Floor / Open orders / बाकी ───────────────────────────────
  if (screen === 'tables') {
    return (
      <div className="waiter-app">
        <header className="w-top">
          <span className="w-top-title">
            {homeTab === 'floor' ? 'Floor' : homeTab === 'open' ? 'Open orders' : 'बाकी'}
          </span>
          {queueCount > 0 && <span className="w-pill warn" title="Queued offline orders">{queueCount} queued</span>}
          <button className="w-icon-btn" onClick={() => { tapLight(); syncMenu({ silent: true }); }} disabled={syncing} aria-label="Sync menu">
            <span className={syncing ? 'w-sync-spin' : ''}><Icon name="refresh" /></span>
          </button>
          <button className="w-icon-btn" onClick={() => { tapLight(); openStats(); }} aria-label="My stats">
            <Icon name="insights" />
          </button>
          <button className="w-icon-btn" onClick={() => { tapLight(); setShowSettings(true); }} aria-label="Settings">
            <Icon name="settings" />
          </button>
          <button className="w-icon-btn" onClick={handleLogout} aria-label="Log out">
            <Icon name="power" />
          </button>
        </header>

        {/* Waiter calls stay pinned above the tabs — they outrank whatever is on screen */}
        {calls.length > 0 && (
          <div className="w-calls">
            {calls.map(c => (
              <div key={c.id} className="w-call">
                <Icon name="bell" size={22} />
                <span className="w-call-txt"><b>{c.table_name}</b> needs assistance</span>
                <button className="w-call-ok" onClick={() => { tapMedium(); dismissCall(c); }}>Done</button>
              </div>
            ))}
          </div>
        )}

        <div className="w-scroll" ref={homeScrollRef}>
          <div
            className="w-ptr"
            style={{ transform: `translate3d(0,${ptr.distance}px,0)`, opacity: ptr.distance ? 1 : 0 }}
          >
            <span className={`w-ptr-spin${ptr.refreshing ? ' is-spinning' : ptr.armed ? ' is-armed' : ''}`} />
          </div>

          <div
            className="w-pane"
            key={homeTab}
            style={{ transform: `translate3d(0,${ptr.distance}px,0)` }}
          >
            {homeTab === 'floor' && (
              <FloorGrid
                tables={tables}
                dataFor={getTableData}
                filter={floorFilter}
                onFilterChange={setFloorFilter}
                loading={tablesLoading && !tables.length}
                onSelect={handleTableSelect}
                onSwipeBill={quickBillTable}
              />
            )}

            {homeTab === 'open' && (
              <OpenOrders
                activeOrders={activeOrders}
                scheduled={scheduled}
                loading={tablesLoading && !activeOrders.orders.length}
                onOpen={openOrderCard}
              />
            )}

            {homeTab === 'serve' && (
              <ServeBoard
                activeOrders={activeOrders}
                stations={stations}
                onServe={serveItem}
                loading={tablesLoading && !activeOrders.kots.length}
              />
            )}
          </div>
        </div>

        {/* New non-table order — Takeaway / Delivery / Draft / Scheduled.
            Floor tab only: Open Orders and बाकी have nothing to launch it onto. */}
        {homeTab === 'floor' && (
          <button className="w-fab" onClick={() => { tapMedium(); setShowNewOrder(true); }} aria-label="New order">
            <Icon name="add" size={26} />
          </button>
        )}

        <BottomNav
          tab={homeTab}
          onChange={setHomeTab}
          badges={{ open: openCount, serve: pendingCount }}
        />

        {showNewOrder && (
          <NewOrderSheet
            api={api}
            onConfirm={startNewOrder}
            onClose={() => setShowNewOrder(false)}
          />
        )}

        {schedDetail && (
          <div className="w-sheet-wrap" onClick={() => setSchedDetail(null)}>
            <div className="w-sheet" onClick={e => e.stopPropagation()}>
              <div className="w-sheet-grab" />
              <div className="w-set-head">
                <span className="w-sheet-title">{schedDetail.kind === 'SCHEDULED' ? 'Scheduled order' : 'Draft order'}</span>
                <button className="w-icon-btn" onClick={() => setSchedDetail(null)} aria-label="Close"><Icon name="close" /></button>
              </div>
              <div className="w-sheet-sub">
                {schedDetail.customer_name || 'No name'}{schedDetail.customer_phone ? ` · ${schedDetail.customer_phone}` : ''}
              </div>
              {schedDetail.kind === 'SCHEDULED' && schedDetail.scheduled_for && (
                <div className="w-hours-note">
                  <Icon name="schedule" size={16} /> Fires at {schedDetail.scheduled_for}
                </div>
              )}
              <ul className="w-forgot">
                {(() => {
                  let items = [];
                  try { items = JSON.parse(schedDetail.items_json || '[]'); } catch { items = []; }
                  return items.map((it, i) => (
                    <li key={i}>
                      <span>×{it.quantity} {it.product_name}{it.variant_name ? ` (${it.variant_name})` : ''}</span>
                      <b>{fmt(it.unit_price * it.quantity)}</b>
                    </li>
                  ));
                })()}
              </ul>
              <div className="w-review-total">
                <span className="w-review-total-label">Total</span>
                <span className="w-review-total-val">{fmt(schedDetail.total_amount)}</span>
              </div>
              <div className="w-sheet-actions">
                <button className="w-btn ghost" onClick={() => cancelScheduled(schedDetail)}>Cancel order</button>
                <button className="w-btn" onClick={() => convertScheduled(schedDetail)}>
                  {schedDetail.kind === 'SCHEDULED' ? '🔥 Send now' : '▶ Process'}
                </button>
              </div>
            </div>
          </div>
        )}

        {showSettings && (
          <SettingsSheet
            settings={settings}
            onChange={updateSettings}
            onReset={restoreDefaults}
            onClose={() => setShowSettings(false)}
          />
        )}

        {showStats && (
          <div className="w-sheet-wrap" onClick={() => setShowStats(false)}>
            <div className="w-sheet" onClick={e => e.stopPropagation()}>
              <div className="w-sheet-grab" />
              <div className="w-sheet-title">Today · {user?.name}</div>
              {statsLoading ? (
                <div className="w-stats">
                  {Array.from({ length: 3 }).map((_, i) => <div key={i} className="w-stat is-skeleton"><span className="w-sk w-sk-line" /></div>)}
                </div>
              ) : stats ? (
                <div className="w-stats">
                  <div className="w-stat"><b>{stats.ordersToday}</b><span>orders</span></div>
                  <div className="w-stat"><b>{stats.tablesServed}</b><span>tables</span></div>
                  <div className="w-stat"><b>{stats.avgServiceMin != null ? `${stats.avgServiceMin}m` : '—'}</b><span>avg service</span></div>
                </div>
              ) : (
                <div className="w-empty"><div className="w-empty-title">No data yet today</div></div>
              )}
              <button className="w-btn ghost" onClick={() => setShowStats(false)}>Close</button>
            </div>
          </div>
        )}

        {toast && (
          <div className="w-toast">
            {toast}
            {toastKind === 'success' && <ConfettiBurst trigger={celebrateId} count={32} scale={2} />}
          </div>
        )}
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
          <span className="w-header-title" style={{ paddingLeft: 16 }}>
            {selectedTable ? selectedTable.name : orderMode?.label}
          </span>
          {orderMode && (
            <span className={`w-chip w-chip--${orderMode.menuType.toLowerCase()}`}>
              <Icon name={orderMode.kind ? (orderMode.kind === 'SCHEDULED' ? 'schedule' : 'edit') : (orderMode.menuType === 'DELIVERY' ? 'moped' : 'pack')} size={14} />
              {orderMode.customerName || orderMode.customerPhone || orderMode.label}
            </span>
          )}
          {tableOrder && !orderMode && (
            <span className="w-chip">
              {tableOrder.bill_requested_at ? <><Icon name="receipt" size={16} />Bill</> : <><span className="w-dot" />Open</>}
            </span>
          )}
          {!orderMode && (
            <button className="w-icon-btn" onClick={() => setShowSideMenu(true)} aria-label="Table menu">
              <Icon name="menu" />
            </button>
          )}
        </header>

        {tableOrder?.bill_requested_at && !orderMode && (
          <div className="w-notice-bar">
            <Icon name="receipt" size={18} />
            <span>Bill has been requested</span>
          </div>
        )}

        <div className="w-content">
          {/* ── Pax counter (compact, top) — table orders only ── */}
          {!orderMode && (
            <div className="w-setup-section">
              <div className="w-setup-row">
                <span className="w-setup-label"><Icon name="person" size={20} />Pax</span>
                <div className="w-pax-ctrl">
                  <button className="w-qty-btn minus" aria-label="Fewer guests" onClick={() => { const n=Math.max(0,paxCount-1); setPaxCount(n); saveOrderMeta(n, tableTags); }}><Icon name="remove" size={20} /></button>
                  <span className="w-pax-val">{paxCount || '—'}</span>
                  <button className="w-qty-btn plus" aria-label="More guests" onClick={() => { const n=paxCount+1; setPaxCount(n); saveOrderMeta(n, tableTags); }}><Icon name="add" size={20} /></button>
                </div>
                {/* Active tags shown as chips here */}
                {tableTags.length > 0 && (
                  <div className="w-tag-row w-tag-row-end">
                    {tableTags.map(t => {
                      const tagObj = sideMenuTags.find(x => x.name === t);
                      return <span key={t} className="w-tag-chip active">{tagObj?.value || ''} {t}</span>;
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Current Order (sent, read-only) ── */}
          {totalSentQty > 0 && (
            <div className="w-co-bar">
              <button className="w-co-toggle" onClick={() => setShowCurrentOrder(s => !s)} aria-expanded={showCurrentOrder}>
                <span className="w-co-toggle-label">Current order</span>
                <span className="w-co-count-pill">{totalSentQty} items</span>
                <span className={`w-co-arrow${showCurrentOrder ? ' is-open' : ''}`}><Icon name="expand" size={22} /></span>
              </button>
              {showCurrentOrder && (
                <div className="w-co-list">
                  {Object.entries(byKot).map(([n, items]) => (
                    <div key={n} className="w-co-kot-group">
                      <div className="w-co-kot-label">KOT #{n}</div>
                      {items.map(i => (
                        <div key={i.id} className="w-co-item">
                          <span className="w-co-item-qty">×{i.quantity}</span>
                          <span className="w-co-item-name">{i.product_name}{i.is_home_pack ? ' · pack' : ''}</span>
                          <span className={`w-co-status${i._served ? ' served' : ''}`}>
                            <Icon name={i._served ? 'check' : 'fire'} size={13} />
                            {i._served ? 'Served' : 'Kitchen'}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                  <div className="w-co-footer">Sent items are read-only</div>
                </div>
              )}
            </div>
          )}

          {/* ── Repeat Last Order — table orders only ── */}
          {!tableOrder && !orderMode && (
            <div className="w-inline-actions">
              <button className="w-btn secondary" onClick={repeatLastOrder}>
                <Icon name="replay" size={20} />Repeat last order
              </button>
            </div>
          )}

          <div className="w-section-label">Select category</div>
          {visibleCats.length === 0 ? (
            <div className="w-loading"><MotionArt kind="cooking" size={84} /><span>Loading menu…</span></div>
          ) : (
            <div className="w-cat-grid">
              {visibleCats.map(cat => {
                const count = products.filter(p => p.category_id === cat.id).length;
                const icon  = catEmoji(cat.name, cat.icon);
                return (
                  <div key={cat.id} className="w-cat-card w-ripple" role="button" tabIndex={0} onClick={() => handleCategorySelect(cat)}>
                    <Thumb
                      className="w-cat-media"
                      src={cat.image_url}
                      alt={cat.name}
                      fallback={<span className="w-cat-icon">{icon}</span>}
                    />
                    <div className="w-cat-name">{cat.name}</div>
                    <div className="w-cat-count">{count} item{count !== 1 ? 's' : ''}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="w-bottom-bar">
          <button className="w-bottom-back w-ripple" onClick={() => setScreen('tables')} aria-label="Back">
            <Icon name="back" size={26} />
          </button>
          {cart.length > 0 && (
            <>
              <div className="w-bottom-summary">
                <div className="w-bottom-count">{cartCount} item{cartCount !== 1 ? 's' : ''}</div>
                <div className="w-bottom-total">{fmt(cartTotal)}</div>
              </div>
              <button className="w-btn" onClick={() => setScreen('review')}>Review<Icon name="forward" size={20} /></button>
            </>
          )}
        </div>
        {/* ── Side Menu (≡ → slide-in from right) ── */}
        {showSideMenu && (
          <div className="w-side-overlay" onClick={() => setShowSideMenu(false)}>
            <div className="w-side-panel" onClick={e => e.stopPropagation()}>
              <div className="w-side-header">
                <span className="w-side-title">Table {selectedTable?.name}</span>
                <button className="w-side-close" onClick={() => setShowSideMenu(false)} aria-label="Close menu">
                  <Icon name="close" />
                </button>
              </div>

              {/* Bill action */}
              {tableOrder && !tableOrder.bill_requested_at && (
                <button className="w-side-action danger is-filled w-ripple" onClick={() => { setShowSideMenu(false); requestBill(); }}>
                  <span className="w-side-icon"><Icon name="receipt" size={22} /></span>
                  <span>Request bill</span>
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
                    className={`w-side-action w-ripple${active ? ' active' : ''}`}
                    aria-pressed={active}
                    onClick={() => {
                      const next = active ? tableTags.filter(t => t !== tag.name) : [...tableTags, tag.name];
                      setTableTags(next); saveOrderMeta(paxCount, next);
                    }}
                  >
                    <span className="w-side-icon">{tag.value}</span>
                    <span>{tag.name}</span>
                    {active && <span className="w-side-check"><Icon name="check" size={20} /></span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* "Check on Bill" variants missing from this table's bill */}
        {forgotList && (
          <div className="w-sheet-wrap" onClick={() => setForgotList(null)}>
            <div className="w-sheet" onClick={e => e.stopPropagation()}>
              <div className="w-sheet-grab" />
              <div className="w-sheet-title">Did you forget to add?</div>
              <div className="w-sheet-sub">Not on {selectedTable?.name}'s bill yet.</div>
              <ul className="w-forgot">
                {forgotList.map(v => (
                  <li key={v.id}>
                    <span>{v.product_name} <i>({v.variant_name})</i></span>
                    <b>{fmt(v.selling_price)}</b>
                  </li>
                ))}
              </ul>
              <div className="w-sheet-actions">
                <button className="w-btn ghost" onClick={() => { setForgotList(null); requestBill(true); }}>
                  No, bill it
                </button>
                <button className="w-btn" onClick={() => { addFlaggedToCart(forgotList); setForgotList(null); tapMedium(); setScreen('review'); }}>
                  Add {forgotList.length} item{forgotList.length > 1 ? 's' : ''}
                </button>
              </div>
            </div>
          </div>
        )}

        {toast && (
          <div className="w-toast">
            {toast}
            {toastKind === 'success' && <ConfettiBurst trigger={celebrateId} count={32} scale={2} />}
          </div>
        )}
      </div>
    );
  }

  // ── ITEMS ───────────────────────────────────────────────────────────
  if (screen === 'items') return (
    <div className="waiter-app">
      <header className="w-header">
        <span className="w-header-title" style={{ paddingLeft: 16 }}>{activeCat?.name || 'All'}</span>
        <span className="w-header-sub">{selectedTable ? selectedTable.name : orderMode?.label}</span>
      </header>

      {/* Category strip hides while searching — results span every category */}
      {!searching && (
        <div className="w-qcat-strip">
          {visibleCats.map(c => (
            <button
              key={c.id}
              className={`w-qcat-chip${(quickCat?.id === c.id) ? ' active' : ''}`}
              onClick={() => { setQuickCat(c); setItemSearch(''); }}
            >{c.name}</button>
          ))}
        </div>
      )}

      <div className="w-content" style={{ paddingTop: searching ? 12 : 0 }}>
        {searching && (
          <div className="w-search-note">
            {filteredProducts.length} result{filteredProducts.length !== 1 ? 's' : ''} across the whole menu
          </div>
        )}

        {filteredProducts.length === 0 ? (
          <div className="w-empty">
            <MotionArt kind="search" size={80} />
            <div className="w-empty-title">{searching ? 'No match' : 'No items'}</div>
            <div className="w-empty-text">{searching ? `Nothing on the menu matches “${itemSearch}”.` : 'This category is empty right now.'}</div>
          </div>
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
                  showCategory={searching}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Search docks at the bottom — thumb-reachable, and it stays put when
          the Android keyboard opens because the list above it is what scrolls. */}
      <div className="w-search w-search-dock">
        <button className="w-bottom-back w-ripple" onClick={() => setScreen('categories')} aria-label="Back">
          <Icon name="back" size={26} />
        </button>
        <div className="w-search-wrap">
          <Icon name="search" className="w-search-icon" />
          <input className="w-search-input" type="search"
            placeholder="Search whole menu"
            aria-label="Search whole menu"
            value={itemSearch} onChange={e => setItemSearch(e.target.value)}
          />
          {itemSearch && (
            <button className="w-icon-btn" onClick={() => setItemSearch('')} aria-label="Clear search">
              <Icon name="close" size={20} />
            </button>
          )}
        </div>
      </div>

      {cart.length > 0 && (
        <div className="w-bottom-bar">
          <div className="w-bottom-summary">
            <div className="w-bottom-count">{cartCount} items</div>
            <div className="w-bottom-total">{fmt(cartTotal)}</div>
          </div>
          <button className="w-btn" onClick={() => setScreen('review')}>Review<Icon name="forward" size={20} /></button>
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
      {toast && (
          <div className="w-toast">
            {toast}
            {toastKind === 'success' && <ConfettiBurst trigger={celebrateId} count={32} scale={2} />}
          </div>
        )}
    </div>
  );

  // ── REVIEW ──────────────────────────────────────────────────────────
  if (screen === 'review') return (
    <div className="waiter-app">
      <header className="w-header">
        <span className="w-header-title" style={{ paddingLeft: 16 }}>Review order</span>
        <span className="w-header-sub">{selectedTable ? selectedTable.name : orderMode?.label}</span>
      </header>
      <div className="w-content">
        <div className="w-review-list">
          {cart.map(item => (
            <div key={item.key} className="w-review-card">
              {/* DOM order matches the visual rows so the reading order is
                  name → price → stepper → remove */}
              <div className="w-review-card-top">
                <span className="w-review-card-name">{item.product_name}</span>
                <span className="w-review-card-total">{fmt(item.unit_price * item.quantity)}</span>
                <div className="w-qty-ctrl">
                  <button className="w-qty-btn minus" aria-label={`Decrease ${item.product_name}`} onClick={() => decItem(item.product_id, item.variant_id)}><Icon name="remove" size={20} /></button>
                  <span className="w-qty-val">{item.quantity}</span>
                  <button className="w-qty-btn plus" aria-label={`Increase ${item.product_name}`} onClick={() => incItem(item.product_id, item.variant_id)}><Icon name="add" size={20} /></button>
                </div>
                <button className="w-remove-btn" aria-label={`Remove ${item.product_name}`} onClick={() => removeItem(item.key)}><Icon name="close" size={20} /></button>
              </div>
              <div className="w-review-note">
                <label className="w-review-pack">
                  <input
                    type="checkbox"
                    checked={!!item.is_homepack}
                    onChange={e => updateHomePack(item.key, e.target.checked)}
                    className="w-review-pack-cb"
                  />
                  <span className="w-review-pack-label">Take out / pack</span>
                </label>
                <input className="w-review-note-input" type="text" placeholder="Kitchen note" aria-label="Kitchen note" value={item.notes} onChange={e => updateNotes(item.key, e.target.value)} />
              </div>
            </div>
          ))}
          <div className="w-review-total">
            <span className="w-review-total-label">Order total</span>
            <span className="w-review-total-val">{fmt(cartTotal)}</span>
          </div>
        </div>
      </div>
      <div className="w-bottom-bar">
        <button className="w-bottom-back w-ripple" onClick={() => setScreen('items')} aria-label="Back">
          <Icon name="back" size={26} />
        </button>
        <button className="w-btn secondary" style={{ flexShrink:0 }} onClick={() => setScreen('categories')}>
          <Icon name="add" size={20} />More
        </button>
        {orderMode?.kind ? (
          <button className="w-btn" style={{ flex:1 }} onClick={saveDraftOrSchedule} disabled={sending || !cart.length}>
            {sending
              ? <><span className="w-spinner sm" />Saving…</>
              : orderMode.kind === 'SCHEDULED' ? <><Icon name="schedule" size={20} />Schedule order</> : <><Icon name="edit" size={20} />Save draft</>}
          </button>
        ) : (
          <button className="w-btn" style={{ flex:1 }} onClick={sendOrder} disabled={sending || !cart.length}>
            {sending ? <><span className="w-spinner sm" />Sending…</> : <><Icon name="send" size={20} />Send to kitchen</>}
          </button>
        )}
      </div>
      {toast && (
          <div className="w-toast">
            {toast}
            {toastKind === 'success' && <ConfettiBurst trigger={celebrateId} count={32} scale={2} />}
          </div>
        )}
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
        <div className="w-login-title">MTC Waiter</div>
        <div className="w-login-sub">Restaurant order system</div>
      </div>
      <div className="w-login-card">
        <div className="w-login-prompt">Enter your 4-digit PIN</div>
        <div className="w-pin-dots">
          {[0,1,2,3].map(i => <div key={i} className={`w-pin-dot${pin.length > i ? ' filled' : ''}`} />)}
        </div>
        <div className="w-numpad">
          {['1','2','3','4','5','6','7','8','9'].map(d => (
            <button key={d} className="w-numpad-key w-ripple" onClick={() => onDigit(d)} disabled={busy || pin.length >= 4}>{d}</button>
          ))}
          <button className="w-numpad-key key-del w-ripple" onClick={onBack} disabled={busy} aria-label="Delete">
            <Icon name="backspace" size={26} />
          </button>
          <button className="w-numpad-key w-ripple" onClick={() => onDigit('0')} disabled={busy || pin.length >= 4}>0</button>
          <button className="w-numpad-key" disabled style={{ background:'transparent' }} aria-hidden="true">
            {busy && <span className="w-spinner" />}
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
function ProductRow({ product, totalQty, hasOptions, mvs, cartSubItems=[], onTap, onInc, onDec, onDecCartItem, onIncCartItem, showSimpleQty, simpleQty, showCategory }) {
  const priceRange = mvs.length
    ? (() => { const prices = mvs.map(v=>v.price).filter(p=>p>0); if (!prices.length) return product.price?`₹${product.price}`:''; const mn=Math.min(...prices),mx=Math.max(...prices); return mn===mx?`₹${mn.toLocaleString('en-IN')}`:` ₹${mn.toLocaleString('en-IN')} – ₹${mx.toLocaleString('en-IN')}`; })()
    : product.price ? `₹${Number(product.price).toLocaleString('en-IN')}` : '';

  return (
    <div className={`w-item-card${totalQty > 0 ? ' in-cart' : ''}${hasOptions && cartSubItems.length > 0 ? ' has-sub' : ''}`}>
      <div className="w-item-main-row">
        {/* Always rendered so every row shares one leading rail — the initial
            stands in when the CMS has no photo for the item. */}
        <Thumb
          className="w-item-thumb"
          src={product.image_url}
          alt={product.name}
          fallback={<span className="w-item-initial">{(product.name || '?').trim().charAt(0).toUpperCase()}</span>}
        />
        <div className="w-item-info" onClick={onTap} style={{ cursor:'pointer' }}>
          <div className="w-item-name">{product.name}</div>
          {showCategory && product.category_name && (
            <div className="w-item-cat">{product.category_name}</div>
          )}
          <div className="w-item-meta">
            <span className="w-item-price">{priceRange}</span>
            {hasOptions && <span className="w-opt-pill">{mvs.length ? `${mvs.length} sizes` : 'Options'}</span>}
          </div>
        </div>
        <div className="w-qty-ctrl">
          {showSimpleQty && simpleQty > 0 ? (
            <>
              <button className="w-qty-btn minus" aria-label={`Remove one ${product.name}`} onClick={onDec}><Icon name="remove" size={20} /></button>
              <span className="w-qty-val">{simpleQty}</span>
              <button className="w-qty-btn plus" aria-label={`Add one ${product.name}`} onClick={onInc}><Icon name="add" size={20} /></button>
            </>
          ) : (
            <button className="w-qty-btn plus-solo" aria-label={`Add ${product.name}`} onClick={hasOptions ? onTap : onInc}><Icon name="add" size={20} /></button>
          )}
        </div>
      </div>
      {hasOptions && cartSubItems.length > 0 && (
        <div className="w-item-sub-rows">
          {cartSubItems.map(ci => (
            <div key={ci.key} className="w-item-sub-row">
              <span className="w-item-sub-name">{ci.product_name}</span>
              <div className="w-qty-ctrl sm">
                <button className="w-qty-btn minus" aria-label="Decrease quantity" onClick={e => { e.stopPropagation(); onDecCartItem?.(ci.product_id,ci.variant_id); }}><Icon name="remove" size={18} /></button>
                <span className="w-qty-val">{ci.quantity}</span>
                <button className="w-qty-btn plus" aria-label="Increase quantity" onClick={e => { e.stopPropagation(); onIncCartItem?.(ci.product_id,ci.variant_id); }}><Icon name="add" size={18} /></button>
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
                  <label key={v.id} className={`w-option-row w-ripple${variant?.id===v.id?' selected':''}`}>
                    <input type="radio" name="variant" checked={variant?.id===v.id} onChange={() => onVariantChange(v)} />
                    <span className="w-option-name">{v.name}</span>
                    {v.price>0 && <span className="w-option-price">₹{v.price.toLocaleString('en-IN')}</span>}
                  </label>
                ))}
              </div>
            </div>
          )}
          {modsLoading && <div className="w-inline-load"><span className="w-spinner" />Loading options…</div>}
          {modGroups.map(grp => (
            <div key={grp.id} className="w-option-group">
              <div className="w-option-label">{grp.name}</div>
              <div className="w-option-list">
                {grp.items.map(m => (
                  <label key={m.id} className={`w-option-row w-ripple${modSel[m.id]?' selected':''}`}>
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
              <button className="w-qty-btn minus" aria-label="Decrease quantity" onClick={() => onQtyChange(q => Math.max(1,q-1))}><Icon name="remove" size={20} /></button>
              <span className="w-qty-val">{qty}</span>
              <button className="w-qty-btn plus" aria-label="Increase quantity" onClick={() => onQtyChange(q => q+1)}><Icon name="add" size={20} /></button>
            </div>
          </div>
          {lineTotal > 0 && <div className="w-modal-price">{qty>1&&`${qty} × `}{fmt(base+modTotal)} = <strong>{fmt(lineTotal)}</strong></div>}
        </div>
        <div className="w-modal-footer">
          <button className="w-btn secondary" style={{ flexShrink:0 }} onClick={onCancel}>Cancel</button>
          <button className="w-btn" style={{ flex:1 }} onClick={onConfirm}>
            <Icon name="cart" size={20} />Add to cart {qty>1?`(${qty})`:''}
          </button>
        </div>
      </div>
    </div>
  );
}
