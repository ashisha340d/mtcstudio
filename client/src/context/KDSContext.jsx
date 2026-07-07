import { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react';
import { toUtcMs, getNepalTodayStart, getNepalTodayEnd } from '../utils/dateTime';
import { createSocket } from '../socket';

const KOT_STATUS = {
  ORDERSENT: 'ORDERSENT',
  IN_PROGRESS: 'IN_PROGRESS',
  SERVED: 'SERVED',
  CANCELLED: 'CANCELLED',
};

// ── Elapsed helpers ───────────────────────────────────────────
export function elapsedMs(createdAt) {
  return Date.now() - toUtcMs(createdAt);
}

export function formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

export function getDelayState(createdAt, warningMins, criticalMins) {
  const mins = elapsedMs(createdAt) / 60000;
  if (mins >= criticalMins) return 'critical';
  if (mins >= warningMins) return 'warning';
  return 'normal';
}

// ── Order-level helpers ───────────────────────────────────────
export function allItemsInOrder(order) {
  return (order.kots || []).flatMap(k => k.items || []);
}

export function orderAllServed(order) {
  const items = allItemsInOrder(order);
  return items.length > 0 && items.every(
    i => i.status === KOT_STATUS.SERVED || i.status === KOT_STATUS.CANCELLED
  );
}

export function orderEarliestKotAt(order) {
  const times = (order.kots || []).map(k => toUtcMs(k.created_at));
  return times.length ? Math.min(...times) : Date.now();
}

// ── Audio: three independent sounds (new order / warning / critical) ──
// Android Chrome suspends all audio until a user gesture — each Audio element
// is primed silently on first click/touch so later programmatic .play() works.

let _audioCtx = null;

const _audioStore = {
  new_order: { audio: null, src: null, key: 'kds_sound_new_order' },
  warning:   { audio: null, src: null, key: 'kds_sound_warning' },
  critical:  { audio: null, src: null, key: 'kds_sound_critical' },
};

const BEEP_PATTERNS = {
  new_order: [[880, 0, 0.18], [1100, 0.22, 0.18], [880, 0.44, 0.25]],
  warning:   [[660, 0, 0.2], [660, 0.3, 0.2]],
  critical:  [[440, 0, 0.15], [550, 0.2, 0.15], [440, 0.4, 0.15], [550, 0.6, 0.2]],
};

function getAudioCtx() {
  if (!_audioCtx) {
    try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { return null; }
  }
  return _audioCtx;
}

function syncAudio(type) {
  const store = _audioStore[type];
  const src = localStorage.getItem(store.key) || null;
  if (src === store.src) return;
  store.src = src;
  if (!src) { store.audio = null; return; }
  const a = new Audio();
  a.preload = 'auto';
  a.src = src;
  store.audio = a;
}

async function unlockAudio() {
  const ctx = getAudioCtx();
  if (ctx?.state === 'suspended') {
    try { await ctx.resume(); } catch (e) { console.log('[KDS Audio] resume failed', e); }
  }
  for (const type of Object.keys(_audioStore)) {
    syncAudio(type);
    const a = _audioStore[type].audio;
    if (!a) continue;
    try {
      a.volume = 0; await a.play(); a.pause(); a.currentTime = 0; a.volume = 1;
    } catch { }
  }
  console.log('[KDS Audio] unlocked');
}

// Returns true if sound was attempted (audio unlocked), false if context still suspended.
// Callers use the return value to decide whether to mark the order as "already alarmed" —
// if false, we leave it unmarked so the alarm retries on the next tick once audio unlocks.
function playSound(type) {
  syncAudio(type);
  const a = _audioStore[type].audio;
  if (a) {
    a.currentTime = 0;
    a.play().catch(e => console.log(`[KDS Audio] ${type} failed`, e));
    return true;
  }
  const ctx = getAudioCtx();
  if (!ctx || ctx.state === 'suspended') return false; // still locked — caller should retry
  try {
    const pattern = BEEP_PATTERNS[type];
    pattern.forEach(([freq, start, dur]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq; osc.type = 'sine';
      gain.gain.setValueAtTime(0.25, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur);
    });
    return true;
  } catch (e) { console.log(`[KDS Audio] oscillator failed`, e); return false; }
}

// ── Settings ──────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  theme: 'dark',
  activeDepartment: null,
  delayWarningMins: 10,
  delayCriticalMins: 15,
  alarmEnabled: true,
  criticalRepeatSecs: 30,
  pageSize: 999,
  cardDensity: 'normal',
  orderTypeColors: {
    DINE_IN: '#2563eb',
    TAKEAWAY: '#ea580c',
    DELIVERY: '#7c3aed',
    CAKE_ORDER: '#16a34a',
    QUICK_SALE: '#b45309',
  },
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('kds_settings') || '{}');
    return {
      ...DEFAULT_SETTINGS, ...saved,
      orderTypeColors: { ...DEFAULT_SETTINGS.orderTypeColors, ...(saved.orderTypeColors || {}) },
      pageSize: 999,
    };
  } catch { return DEFAULT_SETTINGS; }
}

function saveSettings(s) {
  try { localStorage.setItem('kds_settings', JSON.stringify(s)); } catch { }
}

const VALID_TABS = ['active', 'served', 'summary'];

const initialState = {
  orders: [],
  servedOrders: [],
  stations: [],
  loading: false,
  servedLoading: false,
  error: null,
  activeTab: (VALID_TABS.includes(localStorage.getItem('kds_tab')) ? localStorage.getItem('kds_tab') : 'active'),
  page: 1,
  searchQuery: '',
  filterStatus: 'all',
  now: Date.now(),
  settingsOpen: false,
  reportOpen: false,
  settings: loadSettings(),
  flashingOrders: {},
};

const A = {
  ORDERS_RECONCILE: 'ORDERS_RECONCILE',
  SERVED_LOADED: 'SERVED_LOADED',
  KOT_ITEM_STATUS: 'KOT_ITEM_STATUS',
  ORDER_REMOVED: 'ORDER_REMOVED',
  ORDER_UPSERT: 'ORDER_UPSERT',   // socket: new-order / order-updated
  STATIONS_LOADED: 'STATIONS_LOADED',
  SET_TAB: 'SET_TAB',
  SET_PAGE: 'SET_PAGE',
  SET_SEARCH: 'SET_SEARCH',
  SET_FILTER: 'SET_FILTER',
  SET_LOADING: 'SET_LOADING',
  SET_SERVED_LOADING: 'SET_SERVED_LOADING',
  SET_ERROR: 'SET_ERROR',
  TICK: 'TICK',
  SETTINGS_OPEN: 'SETTINGS_OPEN',
  SETTINGS_UPDATE: 'SETTINGS_UPDATE',
  REPORT_OPEN: 'REPORT_OPEN',
  FLASH_ORDER: 'FLASH_ORDER',
  UNFLASH_ORDER: 'UNFLASH_ORDER',
  ORDER_COMPLETED: 'ORDER_COMPLETED',
  KOT_ITEM_UPDATED: 'KOT_ITEM_UPDATED',
};

function kdsReducer(state, { type, payload }) {
  switch (type) {
    case A.ORDERS_RECONCILE:
      return { ...state, orders: payload, loading: false, page: 1 };

    case A.SERVED_LOADED:
      return { ...state, servedOrders: payload, servedLoading: false };

    case A.KOT_ITEM_STATUS: {
      const applyItemUpdate = (ordersList) => ordersList.map(o => {
        const kots = (o.kots || []).map(k => {
          if (k.id !== payload.kotId) return k;
          const items = (k.items || []).map(i =>
            i.id === payload.itemId
              ? { ...i, status: payload.status, served_at: payload.served_at ?? i.served_at }
              : i
          );
          const allDone = items.every(i => i.status === KOT_STATUS.SERVED || i.status === KOT_STATUS.CANCELLED);
          return {
            ...k, items,
            status: allDone ? KOT_STATUS.SERVED
              : items.some(i => i.status === KOT_STATUS.ORDERSENT) ? KOT_STATUS.ORDERSENT
                : KOT_STATUS.IN_PROGRESS,
          };
        });
        return { ...o, kots };
      });
      return { ...state, orders: applyItemUpdate(state.orders), servedOrders: applyItemUpdate(state.servedOrders) };
    }

    case A.KOT_ITEM_UPDATED: {
      const applyFieldUpdate = (ordersList) => ordersList.map(o => ({
        ...o,
        kots: (o.kots || []).map(k => {
          if (k.id !== payload.kotId) return k;
          return {
            ...k,
            items: (k.items || []).map(i =>
              i.id !== payload.itemId ? i : {
                ...i,
                ...(payload.quantity    !== undefined && { quantity: payload.quantity }),
                ...(payload.notes       !== undefined && { notes: payload.notes }),
                ...(payload.is_home_pack !== undefined && { is_home_pack: payload.is_home_pack }),
              }
            ),
          };
        }),
      }));
      return { ...state, orders: applyFieldUpdate(state.orders), servedOrders: applyFieldUpdate(state.servedOrders) };
    }

    case A.ORDER_REMOVED:
      return {
        ...state,
        orders: state.orders.filter(o => o.id !== payload),
        servedOrders: state.servedOrders.filter(o => o.id !== payload),
      };

    case A.ORDER_COMPLETED: {
      // Fired on both POS checkout (paid) AND KDS serve-all.
      // Only drop from active when every item is actually served/cancelled;
      // a paid-but-unserved order stays on screen, flagged CLOSED so the
      // PAID banner shows while staff still prepare & serve the food.
      const order = state.orders.find(o => o.id === payload);
      if (!order || orderAllServed(order)) {
        return {
          ...state,
          orders: state.orders.filter(o => o.id !== payload),
          servedOrders: state.servedOrders.filter(o => o.id !== payload),
        };
      }
      return {
        ...state,
        orders: state.orders.map(o =>
          o.id === payload ? { ...o, order_status: 'CLOSED' } : o
        ),
      };
    }

    case A.ORDER_UPSERT: {
      const exists = state.orders.some(o => o.id === payload.id);
      const orders = exists
        ? state.orders.map(o => o.id === payload.id ? { ...o, ...payload } : o)
        : [payload, ...state.orders];
      return { ...state, orders };
    }

    case A.STATIONS_LOADED:
      return { ...state, stations: payload };

    case A.SET_TAB: {
      localStorage.setItem('kds_tab', payload);
      return { ...state, activeTab: payload, page: 1, searchQuery: '', filterStatus: 'all' };
    }

    case A.SET_PAGE: return { ...state, page: payload };
    case A.SET_SEARCH: return { ...state, searchQuery: payload, page: 1 };
    case A.SET_FILTER: return { ...state, filterStatus: payload, page: 1 };
    case A.SET_LOADING: return { ...state, loading: payload };
    case A.SET_SERVED_LOADING: return { ...state, servedLoading: payload };
    case A.SET_ERROR: return { ...state, error: payload };
    case A.TICK: return { ...state, now: Date.now() };
    case A.SETTINGS_OPEN: return { ...state, settingsOpen: payload };
    case A.REPORT_OPEN: return { ...state, reportOpen: payload };

    case A.SETTINGS_UPDATE: {
      const settings = { ...state.settings, ...payload };
      saveSettings(settings);
      return { ...state, settings, page: 1 };
    }

    case A.FLASH_ORDER:
      return { ...state, flashingOrders: { ...state.flashingOrders, [payload.id]: payload.flashType } };

    case A.UNFLASH_ORDER: {
      const { [payload]: _, ...rest } = state.flashingOrders;
      return { ...state, flashingOrders: rest };
    }

    default: return state;
  }
}

// ── Context ───────────────────────────────────────────────────
const KDSContext = createContext(null);

export function KDSProvider({ children, apiService, pollIntervalMs = 8000 }) {
  const [state, dispatch] = useReducer(kdsReducer, initialState);
  const alarmedOrderIds = useRef(new Set());
  const criticalLastPlayed = useRef(new Map()); // orderId -> last alarm timestamp, for repeat
  const knownOrderIds = useRef(null); // null = first load; Set<id> thereafter
  const sseRef = useRef(null);
  const socketRef = useRef(null);

  // ── Unlock audio on first existing user interaction (Android Chrome) ──────
  // Reuses any click/touch already in the app — no new UI elements added.
  useEffect(() => {
    const unlock = () => unlockAudio();
    document.addEventListener('click', unlock, { once: true, passive: true });
    document.addEventListener('touchstart', unlock, { once: true, passive: true });
    return () => {
      document.removeEventListener('click', unlock);
      document.removeEventListener('touchstart', unlock);
    };
  }, []);

  // ── Initial load ──────────────────────────────────────────
  const loadKOTs = useCallback(async () => {
    try {
      dispatch({ type: A.SET_LOADING, payload: true });
      const [orders, stations] = await Promise.all([
        apiService.getActiveKOTs(),
        apiService.getStations(),
      ]);
      dispatch({ type: A.STATIONS_LOADED, payload: stations });
      dispatch({ type: A.ORDERS_RECONCILE, payload: orders });

      // After first load, flash orders that weren't previously known.
      // knownOrderIds stays updated so neither SSE-triggered reloads nor
      // polling ever double-flash an order the socket already handled.
      if (knownOrderIds.current !== null) {
        orders
          .filter(o => !knownOrderIds.current.has(o.id))
          .forEach(o => {
            dispatch({ type: A.FLASH_ORDER, payload: { id: o.id, flashType: 'new_order' } });
            setTimeout(() => dispatch({ type: A.UNFLASH_ORDER, payload: o.id }), 3200);
          });
      }
      knownOrderIds.current = new Set(orders.map(o => o.id));
    } catch (err) {
      dispatch({ type: A.SET_ERROR, payload: err.message });
      dispatch({ type: A.SET_LOADING, payload: false });
    }
  }, [apiService]);

  // ── Load served orders ────────────────────────────────────
  const loadServedKOTs = useCallback(async () => {
    try {
      dispatch({ type: A.SET_SERVED_LOADING, payload: true });
      const orders = await apiService.getServedKOTs();
      dispatch({ type: A.SERVED_LOADED, payload: orders });
    } catch {
      dispatch({ type: A.SET_SERVED_LOADING, payload: false });
    }
  }, [apiService]);

  // ── SSE subscription for real-time updates ────────────────
  useEffect(() => {
    const token = localStorage.getItem('kds_session') || sessionStorage.getItem('mtc_session');
    if (!token || token === 'dev-session') return;

    const apiBase = import.meta.env.VITE_API_URL || '/api';
    const url = `${apiBase}/pos/kots/events?token=${encodeURIComponent(token)}`;

    const connect = () => {
      const es = new EventSource(url);
      sseRef.current = es;

      es.addEventListener('new_kot', () => {
        loadKOTs();
        loadServedKOTs();
        playSound('new_order');
        dispatch({ type: A.SET_TAB, payload: 'active' });
      });

      es.addEventListener('item_served', (e) => {
        const { kotId, itemId, status, served_at } = JSON.parse(e.data);
        dispatch({ type: A.KOT_ITEM_STATUS, payload: { kotId, itemId, status, served_at } });
      });

      es.onerror = () => {
        es.close();
        setTimeout(connect, 5000);
      };
    };

    connect();
    return () => { sseRef.current?.close(); };
  }, []); // eslint-disable-line

  // ── Socket.IO real-time connection ────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('kds_session') || sessionStorage.getItem('mtc_session') || 'dev-session';
    const socket = createSocket({ role: 'kds', token });
    socketRef.current = socket;

    socket.on('new-order', (order) => {
      dispatch({ type: A.ORDER_UPSERT, payload: order });
      // Register immediately so loadKOTs (called by SSE) won't double-flash
      if (knownOrderIds.current) knownOrderIds.current.add(order.id);
      playSound('new_order');
      dispatch({ type: A.FLASH_ORDER, payload: { id: order.id, flashType: 'new_order' } });
      setTimeout(() => dispatch({ type: A.UNFLASH_ORDER, payload: order.id }), 3200);
      dispatch({ type: A.SET_TAB, payload: 'active' });
    });

    socket.on('order-updated', (order) => {
      dispatch({ type: A.ORDER_UPSERT, payload: order });
    });

    socket.on('item-served', ({ kotId, itemId, status, served_at }) => {
      dispatch({ type: A.KOT_ITEM_STATUS, payload: { kotId, itemId, status, served_at } });
    });

    socket.on('item-updated', ({ kotId, itemId, quantity, notes, is_home_pack }) => {
      dispatch({ type: A.KOT_ITEM_UPDATED, payload: { kotId, itemId, quantity, notes, is_home_pack } });
    });

    socket.on('order-completed', ({ orderId }) => {
      dispatch({ type: A.ORDER_COMPLETED, payload: orderId });
      loadServedKOTs();
    });

    socket.on('order-cancelled', ({ orderId }) => {
      dispatch({ type: A.ORDER_REMOVED, payload: orderId });
    });

    return () => { socket.disconnect(); };
  }, []); // eslint-disable-line

  // ── Fallback poll ─────────────────────────────────────────
  // ── Poll only when socket is disconnected ────────────────
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    let pollId = null;

    const startPolling = () => {
      if (!pollId) {
        pollId = setInterval(loadKOTs, pollIntervalMs);
        console.log('[KDS] Polling started');
      }
    };

    const stopPolling = () => {
      if (pollId) {
        clearInterval(pollId);
        pollId = null;
        console.log('[KDS] Polling stopped');
      }
    };

    if (socket.connected) {
      stopPolling();
    } else {
      startPolling();
    }

    socket.on('connect', stopPolling);
    socket.on('disconnect', startPolling);

    return () => {
      socket.off('connect', stopPolling);
      socket.off('disconnect', startPolling);
      stopPolling();
    };
  }, [loadKOTs, pollIntervalMs]);


  // ── Initial load ──────────────────────────────────────────
  useEffect(() => { loadKOTs(); }, []); // eslint-disable-line

  // ── Tick every 1s for live elapsed timers ────────────────
  // Browsers throttle setInterval in background/inactive tabs, which can make
  // the ticker appear frozen on an always-on kiosk display. Force a tick the
  // moment the tab regains visibility so it snaps back to the correct value.
  useEffect(() => {
    const id = setInterval(() => dispatch({ type: A.TICK }), 1000);
    const onVisible = () => { if (document.visibilityState === 'visible') dispatch({ type: A.TICK }); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // ── Alarm: warning + critical thresholds, each fires once per order ──
  // playSound() returns false when audio is still locked (no user gesture yet).
  // In that case we do NOT add to the set, so the alarm retries next tick.
  useEffect(() => {
    if (!state.settings.alarmEnabled) return;
    for (const order of state.orders) {
      if (orderAllServed(order)) continue;
      const mins = (Date.now() - orderEarliestKotAt(order)) / 60000;
      if (mins >= state.settings.delayCriticalMins) {
        const lastPlayed = criticalLastPlayed.current.get(order.id);
        const repeatMs = Math.max(1, state.settings.criticalRepeatSecs) * 1000;
        const due = lastPlayed === undefined || (Date.now() - lastPlayed) >= repeatMs;
        if (due && playSound('critical')) {
          criticalLastPlayed.current.set(order.id, Date.now());
          const id = order.id;
          dispatch({ type: A.FLASH_ORDER, payload: { id, flashType: 'critical' } });
          setTimeout(() => dispatch({ type: A.UNFLASH_ORDER, payload: id }), 3000);
        }
      }
      if (mins >= state.settings.delayWarningMins && !alarmedOrderIds.current.has(order.id)) {
        if (playSound('warning')) {
          alarmedOrderIds.current.add(order.id);
          const id = order.id;
          dispatch({ type: A.FLASH_ORDER, payload: { id, flashType: 'warning' } });
          setTimeout(() => dispatch({ type: A.UNFLASH_ORDER, payload: id }), 3000);
        }
      }
    }
  }, [state.now, state.orders, state.settings]);

  // ── Mark item served ──────────────────────────────────────
  const markItemServed = useCallback(async ({ kotId, itemId }) => {
    dispatch({ type: A.KOT_ITEM_STATUS, payload: { kotId, itemId, status: KOT_STATUS.SERVED, served_at: new Date().toISOString() } });
    try {
      await apiService.markItemServed({ kotId, itemId });
    } catch (err) {
      dispatch({ type: A.KOT_ITEM_STATUS, payload: { kotId, itemId, status: KOT_STATUS.ORDERSENT, served_at: null } });
      dispatch({ type: A.SET_ERROR, payload: err.message });
    }
  }, [apiService]);

  // ── Undo served ───────────────────────────────────────────
  const unserveItem = useCallback(async ({ kotId, itemId }) => {
    dispatch({ type: A.KOT_ITEM_STATUS, payload: { kotId, itemId, status: KOT_STATUS.ORDERSENT, served_at: null } });
    try {
      await apiService.unserveItem({ kotId, itemId });
      // Reload active KOTs so a previously-fully-served order reappears in the active view
      loadKOTs();
    } catch (err) {
      dispatch({ type: A.KOT_ITEM_STATUS, payload: { kotId, itemId, status: KOT_STATUS.SERVED, served_at: new Date().toISOString() } });
      dispatch({ type: A.SET_ERROR, payload: err.message });
    }
  }, [apiService, loadKOTs]);

  // ── Close order: serve all remaining items, remove from view ─
  const closeOrder = useCallback(async (orderId) => {
    dispatch({ type: A.ORDER_REMOVED, payload: orderId });
    try {
      await apiService.serveAllKots(orderId);
      loadServedKOTs();
    } catch {
      loadKOTs();
    }
  }, [apiService, loadKOTs, loadServedKOTs]);

  // ── Derived state ─────────────────────────────────────────
  const { settings, searchQuery, filterStatus, page } = state;
  const { delayWarningMins, delayCriticalMins } = settings;
  const stationId = settings.activeDepartment ?? null;

  // Today bounds (Nepal time) — recomputed on every render tick
  const todayStart = getNepalTodayStart().getTime();
  const todayEnd = getNepalTodayEnd().getTime();
  const isToday = (order) => {
    const t = orderEarliestKotAt(order);
    return t >= todayStart && t <= todayEnd;
  };

  // Active Orders: today-only + unserved-only + station filter
  const activeFiltered = (stationId
    ? state.orders.filter(o =>
      (o.kots || []).some(k =>
        (k.items || []).some(i =>
          i.station_id === stationId &&
          i.status !== KOT_STATUS.SERVED && i.status !== KOT_STATUS.CANCELLED
        )
      )
    )
    : state.orders.filter(o => !orderAllServed(o))
  ).filter(isToday);

  const activeSearched = searchQuery.trim()
    ? activeFiltered.filter(o => {
      const q = searchQuery.toLowerCase();
      return (
        String(o.id).includes(q) ||
        (o.table_name || '').toLowerCase().includes(q) ||
        (o.customer_name || '').toLowerCase().includes(q) ||
        (o.kots || []).some(k => String(k.kot_number).includes(q))
      );
    })
    : activeFiltered;

  const statusFiltered = activeSearched.filter(o => {
    const earliest = orderEarliestKotAt(o);
    const mins = (state.now - earliest) / 60000;
    if (filterStatus === 'delayed') return mins >= delayWarningMins;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(statusFiltered.length / settings.pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleKOTs = statusFiltered.slice(
    (safePage - 1) * settings.pageSize,
    safePage * settings.pageSize
  );

  // Served Orders: today-only + station filter + no cancelled orders
  const servedFiltered = (stationId
    ? state.servedOrders.filter(o =>
      (o.kots || []).some(k =>
        (k.items || []).some(i => i.station_id === stationId)
      )
    )
    : state.servedOrders
  ).filter(isToday).filter(o => o.order_status !== 'CANCELLED');

  const servedSearched = searchQuery.trim()
    ? servedFiltered.filter(o => {
      const q = searchQuery.toLowerCase();
      return (
        String(o.id).includes(q) ||
        (o.table_name || '').toLowerCase().includes(q) ||
        (o.customer_name || '').toLowerCase().includes(q) ||
        (o.kots || []).some(k => String(k.kot_number).includes(q))
      );
    })
    : servedFiltered;

  const activeStationName = stationId
    ? (state.stations.find(s => s.id === stationId)?.name ?? `Station ${stationId}`)
    : 'All Stations';

  const kdsUser = (() => {
    try { return JSON.parse(localStorage.getItem('kds_user') || 'null'); } catch { return null; }
  })();

  const activeCount = activeFiltered.length;
  const delayedCount = activeFiltered.filter(o =>
    (Date.now() - orderEarliestKotAt(o)) / 60000 >= delayWarningMins
  ).length;
  const servedCount = servedFiltered.length;

  // ── Active Order Summary ──────────────────────────────────
  // Aggregate UNSERVED items across all active orders for this station:
  // group by product name → total qty + list of tables/customers ordering it.
  const activeSummary = (() => {
    const map = new Map();
    for (const o of activeFiltered) {
      const who = o.order_type === 'DINE_IN'
        ? (o.table_name || 'TABLE')
        : (o.customer_name || o.order_type);
      for (const k of (o.kots || [])) {
        for (const i of (k.items || [])) {
          if (stationId && i.station_id !== stationId) continue;
          if (i.status === KOT_STATUS.SERVED || i.status === KOT_STATUS.CANCELLED) continue;
          const key = i.product_name;
          let e = map.get(key);
          if (!e) { e = { name: i.product_name, qty: 0, tables: new Map() }; map.set(key, e); }
          e.qty += (i.quantity || 0);
          e.tables.set(who, (e.tables.get(who) || 0) + (i.quantity || 0));
        }
      }
    }
    return [...map.values()]
      .map(e => ({ name: e.name, qty: e.qty, tables: [...e.tables.keys()] }))
      .sort((a, b) => b.qty - a.qty);
  })();

  const value = {
    ...state,
    visibleKOTs,
    servedSearched,
    totalPages,
    safePage,
    activeCount,
    delayedCount,
    servedCount,
    activeSummary,
    activeStationName,
    kdsUser,

    socket: socketRef.current,
    loadKOTs,
    loadServedKOTs,
    markItemServed,
    unserveItem,
    closeOrder,
    setTab: (tab) => dispatch({ type: A.SET_TAB, payload: tab }),
    setPage: (p) => dispatch({ type: A.SET_PAGE, payload: p }),
    setSearch: (q) => dispatch({ type: A.SET_SEARCH, payload: q }),
    setFilter: (f) => dispatch({ type: A.SET_FILTER, payload: f }),
    openSettings: () => dispatch({ type: A.SETTINGS_OPEN, payload: true }),
    closeSettings: () => dispatch({ type: A.SETTINGS_OPEN, payload: false }),
    openReport: () => dispatch({ type: A.REPORT_OPEN, payload: true }),
    closeReport: () => dispatch({ type: A.REPORT_OPEN, payload: false }),
    updateSettings: (s) => dispatch({ type: A.SETTINGS_UPDATE, payload: s }),

    getDelayState: (createdAt) => getDelayState(createdAt, delayWarningMins, delayCriticalMins),
    formatElapsed,
    elapsedMs,
    orderAllServed,
    orderEarliestKotAt,
  };

  return <KDSContext.Provider value={value}>{children}</KDSContext.Provider>;
}

export function useKDS() {
  const ctx = useContext(KDSContext);
  if (!ctx) throw new Error('useKDS must be used within KDSProvider');
  return ctx;
}

export default KDSContext;
