import { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react';
import { createSocket } from '../socket';

// ── Constants ─────────────────────────────────────────────────
export const ORDER_TYPE = {
  DINE_IN:    'DINE_IN',
  TAKEAWAY:   'TAKEAWAY',
  DELIVERY:   'DELIVERY',
  CAKE_ORDER: 'CAKE_ORDER',
  QUICK_SALE: 'QUICK_SALE',
};

export const ORDER_STATUS = {
  OPEN:      'OPEN',
  SAVED:     'SAVED',
  CLOSED:    'CLOSED',
  CANCELLED: 'CANCELLED',
};

export const KOT_STATUS = {
  ORDERSENT:     'ORDERSENT',
  IN_PROGRESS: 'IN_PROGRESS',
  SERVED:      'SERVED',
  CANCELLED:   'CANCELLED',
};

export const PAYMENT_METHOD = {
  CASH:   'CASH',
  CARD:   'CARD',
  QR:     'QR',
  LEDGER: 'LEDGER',
};

// ── Initial State ─────────────────────────────────────────────
const initialState = {
  // Master data (loaded once)
  tables:     [],   // [{ id, name, capacity, section, sort_order }]
  products:   [],   // [{ id, name, category_id, station_id, price, prep_time_minutes, is_fast_moving }]
  categories: [],   // [{ id, name, sort_order }]
  stations:   [],   // [{ id, name, color_hex }]

  // Live orders keyed by order id
  orders: {},       // { [orderId]: Order }

  // All KOTs keyed by order id → array
  kotsByOrder: {},  // { [orderId]: KOT[] }

  // Table → active order id map (quick lookup)
  tableOrderMap: {},// { [tableId]: orderId }

  // Active cart being assembled before SEND
  cart: {
    orderId:    null,
    orderType:  null,
    tableId:    null,
    customerName: null,
    items: [],  // CartItem[]
    // CartItem: { tempId, productId, name, price, qty, notes, isHomePack, prepTime, stationId }
  },

  // UI focus
  ui: {
    screen: 'DASHBOARD',  // 'DASHBOARD' | 'ORDER_ENTRY' | 'CHECKOUT'
    activeOrderId: null,
    notification: null,   // { type: 'success'|'error'|'info', message }
  },

  loading: false,
  error: null,
};

// ── Action Types ──────────────────────────────────────────────
const A = {
  // Master data
  LOAD_MASTER:          'LOAD_MASTER',

  // Orders
  ORDERS_LOADED:        'ORDERS_LOADED',
  ORDER_CREATED:        'ORDER_CREATED',
  ORDER_UPDATED:        'ORDER_UPDATED',
  ORDER_CLOSED:         'ORDER_CLOSED',
  ORDER_CANCELLED:      'ORDER_CANCELLED',

  // KOTs
  KOT_SENT:             'KOT_SENT',
  KOT_STATUS_CHANGED:   'KOT_STATUS_CHANGED',
  KOT_ITEM_SERVED:      'KOT_ITEM_SERVED',

  // Cart
  CART_OPEN:            'CART_OPEN',
  CART_ADD_ITEM:        'CART_ADD_ITEM',
  CART_UPDATE_ITEM:     'CART_UPDATE_ITEM',
  CART_REMOVE_ITEM:     'CART_REMOVE_ITEM',
  CART_CLEAR:           'CART_CLEAR',

  // UI
  SET_SCREEN:           'SET_SCREEN',
  SET_NOTIFICATION:     'SET_NOTIFICATION',
  CLEAR_NOTIFICATION:   'CLEAR_NOTIFICATION',

  SET_LOADING:          'SET_LOADING',
  SET_ERROR:            'SET_ERROR',
};

// ── Helpers ───────────────────────────────────────────────────
let tempIdCounter = 0;
const nextTempId = () => `tmp_${++tempIdCounter}`;

function calcCartTotal(items) {
  return items.reduce((sum, i) => sum + i.price * i.qty, 0);
}

function buildTableOrderMap(orders) {
  const map = {};
  Object.values(orders).forEach((o) => {
    if (o.table_id && o.status === ORDER_STATUS.OPEN) {
      map[o.table_id] = o.id;
    }
  });
  return map;
}

// ── Reducer ───────────────────────────────────────────────────
function posReducer(state, { type, payload }) {
  switch (type) {

    case A.LOAD_MASTER:
      return { ...state, ...payload };

    case A.ORDERS_LOADED: {
      const orders = {};
      const kotsByOrder = {};
      payload.orders.forEach((o) => { orders[o.id] = o; });
      payload.kots.forEach((k) => {
        if (!kotsByOrder[k.order_id]) kotsByOrder[k.order_id] = [];
        kotsByOrder[k.order_id].push(k);
      });
      return {
        ...state,
        orders,
        kotsByOrder,
        tableOrderMap: buildTableOrderMap(orders),
      };
    }

    case A.ORDER_CREATED: {
      const orders = { ...state.orders, [payload.id]: payload };
      return {
        ...state,
        orders,
        tableOrderMap: buildTableOrderMap(orders),
      };
    }

    case A.ORDER_UPDATED: {
      const orders = {
        ...state.orders,
        [payload.id]: { ...state.orders[payload.id], ...payload },
      };
      return {
        ...state,
        orders,
        tableOrderMap: buildTableOrderMap(orders),
      };
    }

    case A.ORDER_CLOSED:
    case A.ORDER_CANCELLED: {
      const status = type === A.ORDER_CLOSED ? ORDER_STATUS.CLOSED : ORDER_STATUS.CANCELLED;
      const orders = {
        ...state.orders,
        [payload.orderId]: { ...state.orders[payload.orderId], status },
      };
      return {
        ...state,
        orders,
        tableOrderMap: buildTableOrderMap(orders),
      };
    }

    case A.KOT_SENT: {
      // payload: { orderId, kot }
      const existing = state.kotsByOrder[payload.orderId] || [];
      return {
        ...state,
        kotsByOrder: {
          ...state.kotsByOrder,
          [payload.orderId]: [...existing, payload.kot],
        },
        cart: { ...initialState.cart },
        ui: { ...state.ui, screen: 'ORDER_ENTRY' }, // stay on order entry
      };
    }

    case A.KOT_STATUS_CHANGED: {
      // payload: { orderId, kotId, status }
      const kots = (state.kotsByOrder[payload.orderId] || []).map((k) =>
        k.id === payload.kotId ? { ...k, status: payload.status } : k
      );
      return {
        ...state,
        kotsByOrder: { ...state.kotsByOrder, [payload.orderId]: kots },
      };
    }

    case A.KOT_ITEM_SERVED: {
      // payload: { orderId, kotId, itemId }
      const kots = (state.kotsByOrder[payload.orderId] || []).map((k) => {
        if (k.id !== payload.kotId) return k;
        const items = (k.items || []).map((i) =>
          i.id === payload.itemId ? { ...i, status: KOT_STATUS.SERVED } : i
        );
        const allDone = items.every((i) =>
          i.status === KOT_STATUS.SERVED || i.status === KOT_STATUS.CANCELLED
        );
        return { ...k, items, status: allDone ? KOT_STATUS.SERVED : k.status };
      });
      return {
        ...state,
        kotsByOrder: { ...state.kotsByOrder, [payload.orderId]: kots },
      };
    }

    // ── Cart ────────────────────────────────────────────────
    case A.CART_OPEN:
      return {
        ...state,
        cart: {
          ...initialState.cart,
          orderId:      payload.orderId,
          orderType:    payload.orderType,
          tableId:      payload.tableId ?? null,
          customerName: payload.customerName ?? null,
        },
        ui: { ...state.ui, screen: 'ORDER_ENTRY', activeOrderId: payload.orderId },
      };

    case A.CART_ADD_ITEM: {
      // Merge with existing line for same product+notes+isHomePack
      const existing = state.cart.items.find(
        (i) =>
          i.productId === payload.productId &&
          i.notes     === (payload.notes ?? null) &&
          i.isHomePack === (payload.isHomePack ?? false)
      );
      const items = existing
        ? state.cart.items.map((i) =>
            i === existing ? { ...i, qty: i.qty + (payload.qty ?? 1) } : i
          )
        : [...state.cart.items, { tempId: nextTempId(), ...payload, qty: payload.qty ?? 1 }];
      return { ...state, cart: { ...state.cart, items } };
    }

    case A.CART_UPDATE_ITEM: {
      // payload: { tempId, changes: Partial<CartItem> }
      const items = state.cart.items.map((i) =>
        i.tempId === payload.tempId ? { ...i, ...payload.changes } : i
      );
      return { ...state, cart: { ...state.cart, items } };
    }

    case A.CART_REMOVE_ITEM: {
      const items = state.cart.items.filter((i) => i.tempId !== payload.tempId);
      return { ...state, cart: { ...state.cart, items } };
    }

    case A.CART_CLEAR:
      return { ...state, cart: { ...initialState.cart } };

    // ── UI ──────────────────────────────────────────────────
    case A.SET_SCREEN:
      return { ...state, ui: { ...state.ui, screen: payload } };

    case A.SET_NOTIFICATION:
      return { ...state, ui: { ...state.ui, notification: payload } };

    case A.CLEAR_NOTIFICATION:
      return { ...state, ui: { ...state.ui, notification: null } };

    case A.SET_LOADING:
      return { ...state, loading: payload };

    case A.SET_ERROR:
      return { ...state, error: payload };

    default:
      return state;
  }
}

// ── Context ───────────────────────────────────────────────────
const POSContext = createContext(null);

export function POSProvider({ children, apiService, activeUser = null }) {
  const [state, dispatch] = useReducer(posReducer, initialState);
  // Track which KOT items are delayed to avoid re-triggering notifications
  const alarmSet      = useRef(new Set());
  const orangeSet     = useRef(new Set());

  // ── Master data load ──────────────────────────────────────
  const loadMasterData = useCallback(async () => {
    try {
      const [tables, products, categories, stations] = await Promise.all([
        apiService.getTables(),
        apiService.getProducts(),
        apiService.getCategories(),
        apiService.getStations(),
      ]);
      dispatch({ type: A.LOAD_MASTER, payload: { tables, products, categories, stations } });
    } catch (err) {
      dispatch({ type: A.SET_ERROR, payload: err.message });
    }
  }, [apiService]);

  const loadActiveOrders = useCallback(async () => {
    try {
      dispatch({ type: A.SET_LOADING, payload: true });
      const { orders, kots } = await apiService.getActiveOrders();
      dispatch({ type: A.ORDERS_LOADED, payload: { orders, kots } });
    } catch (err) {
      dispatch({ type: A.SET_ERROR, payload: err.message });
    } finally {
      dispatch({ type: A.SET_LOADING, payload: false });
    }
  }, [apiService]);

  // ── Order actions ─────────────────────────────────────────
  const openOrder = useCallback(({ orderType, tableId, customerName }) => {
    // For DINE_IN: reuse existing open order for that table if any
    const existingId = tableId ? state.tableOrderMap[tableId] : null;
    if (existingId) {
      const existing = state.orders[existingId];
      dispatch({
        type: A.CART_OPEN,
        payload: { orderId: existingId, orderType: existing.order_type, tableId, customerName },
      });
      return;
    }
    // QUICK_SALE / new order — orderId will be returned from API after sendToKitchen
    dispatch({
      type: A.CART_OPEN,
      payload: { orderId: null, orderType, tableId: tableId ?? null, customerName: customerName ?? null },
    });
  }, [state.tableOrderMap, state.orders]);

  /**
   * SEND — creates a new KOT from current cart.
   * If no orderId yet (new order), creates the order first.
   */
  const sendToKitchen = useCallback(async () => {
    const { cart } = state;
    if (!cart.items.length) return;

    try {
      dispatch({ type: A.SET_LOADING, payload: true });

      let orderId = cart.orderId;

      if (!orderId) {
        const newOrder = await apiService.createOrder({
          order_type:    cart.orderType,
          table_id:      cart.tableId,
          customer_name: cart.customerName,
        });
        orderId = newOrder.id;
        dispatch({ type: A.ORDER_CREATED, payload: newOrder });
      }

      const existingKots = state.kotsByOrder[orderId] || [];
      const kotNumber    = existingKots.length + 1;

      const kot = await apiService.createKOT({
        order_id:     orderId,
        kot_number:   kotNumber,
        punched_by:   activeUser?.id ?? null,
        items:        cart.items.map((i) => ({
          product_id:        i.productId,
          product_name:      i.name,
          quantity:          i.qty,
          unit_price:        i.price,
          notes:             i.notes ?? null,
          is_home_pack:      i.isHomePack ?? false,
          prep_time_minutes: i.prepTime,
        })),
      });

      dispatch({ type: A.KOT_SENT, payload: { orderId, kot } });

      // Re-open cart for same order so more items can be added
      dispatch({
        type: A.CART_OPEN,
        payload: {
          orderId,
          orderType: cart.orderType,
          tableId:   cart.tableId,
          customerName: cart.customerName,
        },
      });
    } catch (err) {
      dispatch({ type: A.SET_ERROR, payload: err.message });
    } finally {
      dispatch({ type: A.SET_LOADING, payload: false });
    }
  }, [state, apiService]);

  /**
   * SAVE & WAIT — persist order without sending to kitchen.
   */
  const saveOrder = useCallback(async () => {
    const { cart } = state;
    if (!cart.items.length) return;
    try {
      let orderId = cart.orderId;
      if (!orderId) {
        const newOrder = await apiService.createOrder({
          order_type:    cart.orderType,
          table_id:      cart.tableId,
          customer_name: cart.customerName,
          status:        ORDER_STATUS.SAVED,
        });
        orderId = newOrder.id;
        dispatch({ type: A.ORDER_CREATED, payload: { ...newOrder, status: ORDER_STATUS.SAVED } });
      } else {
        await apiService.updateOrderStatus(orderId, ORDER_STATUS.SAVED);
        dispatch({ type: A.ORDER_UPDATED, payload: { id: orderId, status: ORDER_STATUS.SAVED } });
      }
      dispatch({ type: A.CART_CLEAR });
      dispatch({ type: A.SET_SCREEN, payload: 'DASHBOARD' });
    } catch (err) {
      dispatch({ type: A.SET_ERROR, payload: err.message });
    }
  }, [state, apiService]);

  /**
   * CHECKOUT — mark order closed, record payments.
   * Allows partial payment → remainder goes to ledger.
   */
  const checkout = useCallback(async ({ orderId, payments, discount_amount, change_amount }) => {
    dispatch({ type: A.SET_LOADING, payload: true });
    try {
      await apiService.checkout({ orderId, payments, discount_amount, change_amount });
      dispatch({ type: A.ORDER_CLOSED, payload: { orderId } });
      dispatch({ type: A.SET_SCREEN, payload: 'DASHBOARD' });
    } catch (err) {
      dispatch({ type: A.SET_ERROR, payload: err.message });
      throw err;  // re-throw so CheckoutModal can detect failure
    } finally {
      dispatch({ type: A.SET_LOADING, payload: false });
    }
  }, [apiService]);

  /**
   * MERGE — fold one order's KOTs + draft items into another.
   * Source is cancelled (and its table freed). Cake orders are rejected server-side.
   */
  const mergeOrders = useCallback(async ({ targetOrderId, sourceOrderId }) => {
    dispatch({ type: A.SET_LOADING, payload: true });
    try {
      const res = await apiService.mergeOrders({ targetOrderId, sourceOrderId });
      const { orders, kots } = await apiService.getActiveOrders();
      dispatch({ type: A.ORDERS_LOADED, payload: { orders, kots } });
      return res;
    } catch (err) {
      dispatch({ type: A.SET_ERROR, payload: err.response?.data?.error || err.message });
      throw err;
    } finally {
      dispatch({ type: A.SET_LOADING, payload: false });
    }
  }, [apiService]);

  /**
   * SHIFT — reassign an order to a different table or remove from table.
   * Changes table_id and/or order_type as needed.
   */
  const shiftOrder = useCallback(async ({ orderId, targetTableId }) => {
    dispatch({ type: A.SET_LOADING, payload: true });
    try {
      await apiService.shiftOrder({ orderId, targetTableId });
      const { orders, kots } = await apiService.getActiveOrders();
      dispatch({ type: A.ORDERS_LOADED, payload: { orders, kots } });
    } catch (err) {
      dispatch({ type: A.SET_ERROR, payload: err.response?.data?.error || err.message });
      throw err;
    } finally {
      dispatch({ type: A.SET_LOADING, payload: false });
    }
  }, [apiService]);

  /**
   * REVERT — undo a mistaken checkout. Offsets the payment and reopens the
   * order (onto its table, or into Quick Order if the table's since been
   * reused). KOT/KOT item state is left untouched.
   */
  const revertOrderTransaction = useCallback(async ({ orderId, reason }) => {
    dispatch({ type: A.SET_LOADING, payload: true });
    try {
      const res = await apiService.revertOrderTransaction({ orderId, reason });
      const { orders, kots } = await apiService.getActiveOrders();
      dispatch({ type: A.ORDERS_LOADED, payload: { orders, kots } });
      return res;
    } catch (err) {
      dispatch({ type: A.SET_ERROR, payload: err.response?.data?.error || err.message });
      throw err;
    } finally {
      dispatch({ type: A.SET_LOADING, payload: false });
    }
  }, [apiService]);

  const revertCakeTransaction = useCallback(async ({ cakeOrderId, reason }) => {
    dispatch({ type: A.SET_LOADING, payload: true });
    try {
      return await apiService.revertCakeTransaction({ cakeOrderId, reason });
    } catch (err) {
      dispatch({ type: A.SET_ERROR, payload: err.response?.data?.error || err.message });
      throw err;
    } finally {
      dispatch({ type: A.SET_LOADING, payload: false });
    }
  }, [apiService]);

  const cancelOrder = useCallback(async ({ orderId, reason }) => {
    try {
      await apiService.cancelOrder({ orderId, reason });
      dispatch({ type: A.ORDER_CANCELLED, payload: { orderId } });
      dispatch({ type: A.SET_SCREEN, payload: 'DASHBOARD' });
    } catch (err) {
      dispatch({ type: A.SET_ERROR, payload: err.message });
    }
  }, [apiService]);

  // ── Cart helpers (synchronous) ────────────────────────────
  const addToCart = useCallback((product, opts = {}) => {
    dispatch({
      type: A.CART_ADD_ITEM,
      payload: {
        productId:  product.id,
        name:       product.name,
        price:      product.price,
        prepTime:   product.prep_time_minutes,
        stationId:  product.station_id,
        notes:      opts.notes ?? null,
        isHomePack: opts.isHomePack ?? false,
        qty:        opts.qty ?? 1,
      },
    });
  }, []);

  const updateCartItem = useCallback((tempId, changes) => {
    dispatch({ type: A.CART_UPDATE_ITEM, payload: { tempId, changes } });
  }, []);

  const removeFromCart = useCallback((tempId) => {
    dispatch({ type: A.CART_REMOVE_ITEM, payload: { tempId } });
  }, []);

  const clearCart = useCallback(() => dispatch({ type: A.CART_CLEAR }), []);

  // ── Notification helper ───────────────────────────────────
  const notify = useCallback((type, message) => {
    dispatch({ type: A.SET_NOTIFICATION, payload: { type, message } });
    setTimeout(() => dispatch({ type: A.CLEAR_NOTIFICATION }), 4000);
  }, []);

  // ── KDS feedback → POS state ──────────────────────────────
  /**
   * Called by KDSContext when an item is marked served.
   * If ALL items in the order are served → play kitchen-update chime.
   */
  const onItemServed = useCallback(({ orderId, kotId, itemId }) => {
    dispatch({ type: A.KOT_ITEM_SERVED, payload: { orderId, kotId, itemId } });

    // Check if the whole order is now served
    const kots = state.kotsByOrder[orderId] || [];
    const allServed = kots.every(
      (k) =>
        k.id === kotId
          ? (k.items || []).every(
              (i) => i.id === itemId || i.status === KOT_STATUS.SERVED || i.status === KOT_STATUS.CANCELLED
            )
          : k.status === KOT_STATUS.SERVED || k.status === KOT_STATUS.CANCELLED
    );
  }, [state.kotsByOrder]);

  // ── Derived helpers ───────────────────────────────────────

  /** Returns the open order for a table, or null. */
  const getTableOrder = useCallback(
    (tableId) => {
      const orderId = state.tableOrderMap[tableId];
      return orderId ? state.orders[orderId] : null;
    },
    [state.tableOrderMap, state.orders]
  );

  /**
   * Returns true if any KOT item for the order is in a delayed state.
   * Used to apply the red-border alert on the table button.
   */
  const isOrderDelayed = useCallback(
    (orderId) => {
      const kots = state.kotsByOrder[orderId] || [];
      const now  = Date.now();
      return kots.some((k) =>
        (k.items || []).some((item) => {
          if (item.status === KOT_STATUS.SERVED || item.status === KOT_STATUS.CANCELLED) return false;
          const elapsed = (now - new Date(k.created_at).getTime()) / 60000;
          return elapsed > item.prep_time_minutes;
        })
      );
    },
    [state.kotsByOrder]
  );

  const cartTotal = calcCartTotal(state.cart.items);

  // ── Socket.IO — real-time order updates ──────────────────
  // When any order-related event arrives from the server, re-sync active
  // orders so the dashboard table map stays current without manual refresh.
  const loadActiveOrdersRef = useRef(loadActiveOrders);
  useEffect(() => { loadActiveOrdersRef.current = loadActiveOrders; });

  const loadMasterDataRef = useRef(loadMasterData);
  useEffect(() => { loadMasterDataRef.current = loadMasterData; });

  useEffect(() => {
    const token = sessionStorage.getItem('mtc_session') ?? localStorage.getItem('kds_session');
    const socket = createSocket({ role: 'pos', token: token ?? undefined });

    const reload = () => loadActiveOrdersRef.current();

    socket.on('new-order',       reload);
    socket.on('order-updated',   reload);
    socket.on('order-cancelled', reload);
    socket.on('order-completed', reload);
    socket.on('reconnect',       reload); // re-sync after connection drop
    socket.on('tables-updated',  () => loadMasterDataRef.current());

    return () => socket.disconnect();
  }, []); // connect once per POSProvider lifetime

  // ── Delay monitoring — tracks delayed items ───────────────
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      Object.entries(state.kotsByOrder).forEach(([, kots]) => {
        kots.forEach((kot) => {
          if (kot.status === KOT_STATUS.SERVED || kot.status === KOT_STATUS.CANCELLED) return;
          const kotAge = (now - new Date(kot.created_at).getTime()) / 60000;
          (kot.items || []).forEach((item) => {
            if (item.status === KOT_STATUS.SERVED || item.status === KOT_STATUS.CANCELLED) {
              alarmSet.current.delete(item.id);
              orangeSet.current.delete(item.id);
              return;
            }
            const ratio = kotAge / item.prep_time_minutes;
            if (ratio >= 1) alarmSet.current.add(item.id);
            else if (ratio >= 0.8) orangeSet.current.add(item.id);
          });
        });
      });
    };
    const interval = setInterval(tick, 15000);
    return () => clearInterval(interval);
  }, [state.kotsByOrder]);

  // ── Context value ─────────────────────────────────────────
  const value = {
    // State
    ...state,
    cartTotal,

    // Loaders
    loadMasterData,
    loadActiveOrders,

    // Order actions
    openOrder,
    sendToKitchen,
    saveOrder,
    checkout,
    mergeOrders,
    shiftOrder,
    cancelOrder,
    revertOrderTransaction,
    revertCakeTransaction,

    // Cart
    addToCart,
    updateCartItem,
    removeFromCart,
    clearCart,

    // KDS feedback
    onItemServed,

    // Derived
    getTableOrder,
    isOrderDelayed,

    // UI
    notify,
    setScreen: (s) => dispatch({ type: A.SET_SCREEN, payload: s }),
  };

  return <POSContext.Provider value={value}>{children}</POSContext.Provider>;
}

export function usePOS() {
  const ctx = useContext(POSContext);
  if (!ctx) throw new Error('usePOS must be used within POSProvider');
  return ctx;
}

export default POSContext;
