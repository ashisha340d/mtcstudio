import { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router';
import { usePOS, ORDER_TYPE } from '../../context/POSContext';
import { useAuth } from '../../context/AuthContext';
import TableCard from './components/TableCard';
import OrderCard from './components/OrderCard';
import CheckoutModal from './components/SplitTenderCheckoutContainer';
import OrderTypeModal from './components/OrderTypeModal';
import TableMergeModal from './components/TableMergeModal';
import ShiftOrderModal from './components/ShiftOrderModal';
import CashDrawerModal from './components/CashDrawerModal';
import SalesReportModal from './components/SalesReportModal';
import WebOrdersModal from './components/WebOrdersModal';
import AddCustomerModal from './components/AddCustomerModal';
import ScheduleOrderModal from './components/ScheduleOrderModal';
import ScheduledOrderCard from './components/ScheduledOrderCard';
import CakeDashboardWindow from './components/CakeDashboardWindow';
import { cakeDraftItems, cakeDraftDue } from './posShared';
// Lazy — shares the route chunk, idle-prefetched below
const CakeOrderFormWindow = lazy(() => import('../CakeOrders/CakeOrderForm'));
import { getScheduledOrders, convertScheduledOrder, cancelScheduledOrder, deleteScheduledOrder, getBusinessDay } from '../../services/posApi';
import ConfettiBurst from '../../components/ConfettiBurst/ConfettiBurst';
import NepaliDateChip from '../../components/NepaliDateChip/NepaliDateChip';
import NotificationCenter from './components/NotificationCenter';
import { nepalNow } from '../../utils/dateTime';
import './pos.css';

function Clock() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="pos-topbar__clock">{nepalNow()}</span>
  );
}

const TOOLBAR_ORDER_KEY = 'pos_toolbar_btn_order';
const DEFAULT_BTN_ORDER = [
  'takeaway', 'delivery', 'schedule', 'draft', 'cake', 'weborders',
  'tablemerge', 'shift', 'drawer', 'closeday',
];

function noop() { }

const ALL_ORDERS_CARD_ORDER_KEY = 'pos_all_orders_card_order';

function loadCardOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(ALL_ORDERS_CARD_ORDER_KEY));
    if (Array.isArray(saved)) return saved;
  } catch { /* ignore */ }
  return [];
}

function loadBtnOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(TOOLBAR_ORDER_KEY));
    if (Array.isArray(saved)) {
      // merge in any new ids not present in saved order, drop stale ones
      const merged = saved.filter(id => DEFAULT_BTN_ORDER.includes(id));
      DEFAULT_BTN_ORDER.forEach(id => { if (!merged.includes(id)) merged.push(id); });
      return merged;
    }
  } catch { /* ignore */ }
  return [...DEFAULT_BTN_ORDER];
}

/* ── Desktop window panel with OS chrome ──────────────────── */
function DesktopWindow({ title, count, onAdd, onReorder, reorderActive, extra, children }) {
  return (
    <div className="desktop-window">
      <div className="desktop-chrome">
        <span className="desktop-chrome__title">{title}</span>
        {count != null && (
          <span className="desktop-chrome__count">{count}</span>
        )}
        {onAdd && (
          <button className="desktop-chrome__add" onClick={onAdd} title="Add customer">+</button>
        )}
        {onReorder && (
          <button
            className={`desktop-chrome__reorder${reorderActive ? ' desktop-chrome__reorder--active' : ''}`}
            onClick={onReorder}
            title="Reorder cards"
          >
            {reorderActive ? '✓' : '🔀'}
          </button>
        )}
        {extra}
      </div>
      <div className="desktop-window__body">{children}</div>
    </div>
  );
}

export default function POSDashboard() {
  const {
    tables, orders, tableOrderMap, kotsByOrder, ui,
    loadMasterData, loadActiveOrders, notify,
    webOrderCount, webOrdersRequested, clearShowWebOrdersRequest,
    revertOrderTransaction, revertCakeTransaction,
  } = usePOS();
  const { user, lock } = useAuth();
  const navigate = useNavigate();

  const [checkoutOrderId, setCheckoutOrderId] = useState(null);
  const [closingOrderIds, setClosingOrderIds] = useState(() => new Set());
  const [frozenTableOrderIds, setFrozenTableOrderIds] = useState(() => new Set());
  const [heldOrder, setHeldOrder] = useState(null); // non-table order snapshot kept alive through checkout
  const [orderTypeModal, setOrderTypeModal] = useState(null);
  const [showTableMerge, setShowTableMerge] = useState(false);
  const [showShift, setShowShift] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [showSalesReport, setShowSalesReport] = useState(false);
  const [showWebOrders, setShowWebOrders] = useState(false);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [cakeWin, setCakeWin] = useState(null);        // null | { id: number|null }
  const [cakeRefresh, setCakeRefresh] = useState(0);   // bump → cake window reloads

  // Day gate — POS cannot proceed without an open business day
  useEffect(() => {
    getBusinessDay()
      .then(d => {
        const stale = d.session && d.today && String(d.session.business_date).slice(0, 10) < d.today;
        if (!d.session || d.session.status !== 'OPEN' || stale) navigate('/pos/cash-closing');
      })
      .catch(() => { });
  }, [navigate]);

  // Scheduled + draft orders — socket-driven (server fires 'scheduled-changed'
  // when an OCR draft lands); the 30s poll stays as a safety net.
  const [schedOrders, setSchedOrders] = useState([]);
  const [flashIds, setFlashIds] = useState(() => new Set()); // draft ids flashing ~30s
  const [arriveId, setArriveId] = useState(null);            // clean draft playing fly-in + flowers
  const loadScheduled = useCallback(() => {
    getScheduledOrders().then(setSchedOrders).catch(() => { });
  }, []);
  useEffect(() => {
    loadScheduled();
    const id = setInterval(loadScheduled, 30000);
    const onChanged = (e) => {
      loadScheduled();
      const sid = e?.detail?.scheduledOrderId;
      if (!sid) return;
      // All items resolved (review === false) → celebratory fly-in + flower burst.
      if (e?.detail?.review === false) {
        setArriveId(sid);
        setTimeout(() => setArriveId(prev => (prev === sid ? null : prev)), 2600);
      } else {
        setFlashIds(prev => new Set(prev).add(sid));
        setTimeout(() => setFlashIds(prev => { const n = new Set(prev); n.delete(sid); return n; }), 30000);
      }
    };
    window.addEventListener('mtc:scheduled-changed', onChanged);
    return () => { clearInterval(id); window.removeEventListener('mtc:scheduled-changed', onChanged); };
  }, [loadScheduled]);

  const [btnOrder, setBtnOrder] = useState(loadBtnOrder);
  const [reorderMode, setReorderMode] = useState(false);
  const [dragId, setDragId] = useState(null);

  const toggleReorderMode = useCallback(() => {
    setReorderMode(prev => !prev);
  }, []);

  const onBtnDragStart = useCallback((id) => (e) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const onBtnDragOver = useCallback((id) => (e) => {
    e.preventDefault();
    if (!dragId || dragId === id) return;
    setBtnOrder(prev => {
      const from = prev.indexOf(dragId);
      const to = prev.indexOf(id);
      if (from === -1 || to === -1) return prev;
      const next = [...prev];
      next.splice(from, 1);
      next.splice(to, 0, dragId);
      return next;
    });
  }, [dragId]);

  const onBtnDragEnd = useCallback(() => {
    setDragId(null);
    localStorage.setItem(TOOLBAR_ORDER_KEY, JSON.stringify(btnOrder));
  }, [btnOrder]);

  const [cardOrder, setCardOrder] = useState(loadCardOrder);
  const [cardReorderMode, setCardReorderMode] = useState(false);
  const [dragCardId, setDragCardId] = useState(null);

  const toggleCardReorderMode = useCallback(() => {
    setCardReorderMode(prev => !prev);
  }, []);

  const onCardDragStart = useCallback((id) => (e) => {
    setDragCardId(id);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const onCardDragOver = useCallback((id) => (e) => {
    e.preventDefault();
    if (!dragCardId || dragCardId === id) return;
    setCardOrder(prev => {
      const from = prev.indexOf(dragCardId);
      const to = prev.indexOf(id);
      if (from === -1 || to === -1) return prev;
      const next = [...prev];
      next.splice(from, 1);
      next.splice(to, 0, dragCardId);
      return next;
    });
  }, [dragCardId]);

  const onCardDragEnd = useCallback(() => {
    setDragCardId(null);
    localStorage.setItem(ALL_ORDERS_CARD_ORDER_KEY, JSON.stringify(cardOrder));
  }, [cardOrder]);

  // "Review Now" tapped on the dock while on another /pos/* screen navigates
  // here, then this flag opens the modal once mounted.
  useEffect(() => {
    if (webOrdersRequested) { setShowWebOrders(true); clearShowWebOrdersRequest(); }
  }, [webOrdersRequested, clearShowWebOrdersRequest]);

  useEffect(() => {
    loadMasterData();
    loadActiveOrders();
  }, []); // eslint-disable-line

  // Idle prefetch of likely-next route chunks — click lands on warm code
  useEffect(() => {
    if (navigator.connection?.saveData) return;
    const warm = () => {
      import('../CakeOrders/CakeOrderForm');
      import('../CakeOrders/CakeOrders');
      import('../KDS/KDSDisplay');
      import('../../layouts/AdminLayout');
      import('../Dashboard/Dashboard');
    };
    const idle = 'requestIdleCallback' in window;
    const id = idle ? requestIdleCallback(warm, { timeout: 5000 }) : setTimeout(warm, 3000);
    return () => (idle ? cancelIdleCallback(id) : clearTimeout(id));
  }, []);

  // F8 → open Sales Report (Esc closes it, handled in SalesReportModal) · F2 → Daily Cash Closing
  useEffect(() => {
    const h = (e) => {
      if (e.key !== 'F8' && e.key !== 'F2') return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      e.preventDefault();
      if (e.key === 'F8') setShowSalesReport(true);
      else navigate('/pos/cash-closing');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [navigate]);

  // Table click → go to POS entry; pass existing order data if occupied
  const onTableClick = useCallback((table) => {
    const orderId = tableOrderMap[table.id];
    const order = orderId ? orders[orderId] : null;
    const existingKots = orderId ? (kotsByOrder[orderId] || []) : [];
    const existingItems = existingKots.flatMap(k =>
      (k.items || []).filter(i => i.status !== 'CANCELLED')
    );

    // Restore draft cart items saved on the order (SAVED status orders)
    let draftItems = [];
    if (order?.draft_items) {
      try { draftItems = JSON.parse(order.draft_items); } catch { draftItems = []; }
    }

    navigate('/pos/entry', {
      state: {
        orderType: ORDER_TYPE.DINE_IN,
        tableId: table.id,
        tableName: table.name,
        existingOrderId: orderId ?? null,
        existingTotal: orderId ? (order?.total_amount ?? 0) : 0,
        existingItems,
        draftItems,
      },
    });
  }, [navigate, tableOrderMap, kotsByOrder, orders]);

  // Delivery button → pick delivery partner first
  function openNonDineIn(type) { setOrderTypeModal({ initialType: type }); }

  // After delivery partner picked → navigate to POS entry
  function handleOrderTypeConfirm({ customerName, customerPhone, orderNotes }) {
    setOrderTypeModal(null);
    navigate('/pos/entry', {
      state: { orderType: ORDER_TYPE.DELIVERY, customerName, customerPhone, orderNotes },
    });
  }

  // Schedule Order flow: customer modal (compulsory) → POS entry to punch items
  function onScheduleProceed(meta) {
    setShowSchedule(false);
    navigate('/pos/entry', { state: { orderType: ORDER_TYPE.DELIVERY, scheduleMeta: meta } });
  }

  // Open a scheduled/draft card in POS entry for editing
  function openScheduledRow(row) {
    navigate('/pos/entry', { state: { orderType: row.order_type, scheduledRow: row } });
  }

  // "🔥 Now" / "▶ Process" — convert to a real order + KOT immediately
  async function convertRowNow(row) {
    try {
      await convertScheduledOrder(row.id);
      notify('success', row.kind === 'SCHEDULED' ? '🔥 Scheduled order sent to kitchen' : '▶ Draft processed');
    } catch (e) {
      notify('error', e.response?.data?.error || e.message);
    }
    loadScheduled();
    loadActiveOrders();
  }

  async function cancelScheduledRow(row) {
    if (!window.confirm(`Cancel this ${row.kind === 'SCHEDULED' ? 'scheduled order' : 'draft'}?`)) return;
    try { await cancelScheduledOrder(row.id); } catch { /* refresh below reflects state */ }
    loadScheduled();
  }

  async function deleteScheduledRow(row) {
    if (!window.confirm('Delete this order permanently? Use for wrong-punched orders.')) return;
    try { await deleteScheduledOrder(row.id); notify('success', '🗑 Order deleted'); }
    catch (e) { notify('error', e.response?.data?.error || e.message); }
    loadScheduled();
  }

  // Direct Checkout button on card → open checkout modal for that existing order.
  // Table orders are frozen (kept looking occupied) until the Payment Complete
  // modal actually finishes closing — see handleCheckoutSuccess / handleCheckoutClose.
  // checkoutMetaRef captures orderId/tableId up front because the live socket
  // ('order-completed' → reload) can wipe the closed order out of `orders`
  // before the cashier gets around to clicking Done — reading `orders[id]`
  // at success time would then silently miss the release/fly-out.
  const checkoutMetaRef = useRef(null);
  function openCheckoutForOrder(orderId) {
    setCheckoutOrderId(orderId);
    const o = orders[orderId];
    checkoutMetaRef.current = { orderId, tableId: o?.table_id ?? null };
    if (o?.table_id) {
      setFrozenTableOrderIds(prev => new Set(prev).add(orderId));
    } else if (o) {
      // Same socket race as tables: the reload after checkout drops the paid
      // order from state before Done is clicked — keep a snapshot so the
      // card survives to play its paid animation.
      setHeldOrder(o);
    }
  }

  function handleCheckoutClose() {
    if (checkoutOrderId) {
      setFrozenTableOrderIds(prev => { const n = new Set(prev); n.delete(checkoutOrderId); return n; });
    }
    setHeldOrder(null);
    setCheckoutOrderId(null);
  }

  // Checkout success → close modal, refresh, and celebrate if it was a table order.
  // Table/non-table orders both get a beat to fly to the cash drawer before vanishing.
  function handleCheckoutSuccess() {
    const meta = checkoutMetaRef.current;
    setCheckoutOrderId(null);
    setCakeRefresh(v => v + 1); // any cake dues settled in this checkout drop off the cake window
    const table = meta?.tableId ? tables.find(t => t.id === meta.tableId) : null;
    if (table) {
      notify('success', `🎉 Table ${table.name} Checked Out`);
      setFrozenTableOrderIds(prev => { const n = new Set(prev); n.delete(meta.orderId); return n; });
      loadActiveOrders();
    } else if (meta?.orderId) {
      setClosingOrderIds(prev => new Set(prev).add(meta.orderId));
      setTimeout(() => {
        setClosingOrderIds(prev => { const n = new Set(prev); n.delete(meta.orderId); return n; });
        setHeldOrder(null);
        loadActiveOrders();
      }, 750);
    } else {
      loadActiveOrders();
    }
  }

  // Click an active non-table order card → open it in POS entry (reuse existing order)
  function onActiveOrderClick(order) {
    const existingKots = kotsByOrder[order.id] || [];
    const existingItems = existingKots.flatMap(k =>
      (k.items || []).filter(i => i.status !== 'CANCELLED')
    );
    let draftItems = [];
    if (order?.draft_items) {
      try { draftItems = JSON.parse(order.draft_items); } catch { draftItems = []; }
    }
    navigate('/pos/entry', {
      state: {
        orderType: order.order_type,
        existingOrderId: order.id,
        existingTotal: order.total_amount ?? 0,
        existingItems,
        draftItems,
        customerName: order.customer_name,
        customerPhone: order.customer_phone,
        customerAddress: order.customer_address,
      },
    });
  }

  const sortedTables = [...tables].sort(
    (a, b) => (a.section ?? '').localeCompare(b.section ?? '') || a.sort_order - b.sort_order
  );

  function hasContent(o) {
    const kots = kotsByOrder[o.id] ?? [];
    if (kots.some(k => (k.items ?? []).some(i => i.status !== 'CANCELLED'))) return true;
    try { return o.draft_items && JSON.parse(o.draft_items).length > 0; } catch { return false; }
  }

  let nonTableOrders = Object.values(orders).filter(
    (o) => o.order_type !== ORDER_TYPE.DINE_IN
      && (o.status === 'OPEN' || o.status === 'SAVED' || closingOrderIds.has(o.id))
      && hasContent(o)
  );
  // Paid order already reloaded away? Keep the held snapshot rendered so it
  // can still play the fly-to-drawer animation when Done is clicked.
  if (heldOrder && !nonTableOrders.some(o => o.id === heldOrder.id)) {
    nonTableOrders = [...nonTableOrders, heldOrder];
  }

  const deliveryOrders = nonTableOrders.filter((o) => o.order_type === ORDER_TYPE.DELIVERY);
  const takeawayOrders = nonTableOrders.filter((o) => o.order_type === ORDER_TYPE.TAKEAWAY);
  const cakeOrders = nonTableOrders.filter((o) => o.order_type === ORDER_TYPE.CAKE_ORDER);
  const quickOrders = nonTableOrders.filter((o) => o.order_type === ORDER_TYPE.QUICK_SALE);

  const occupiedCount = sortedTables.filter(t => tableOrderMap[t.id]).length;
  const tableCountLabel = `${occupiedCount} occupied · ${sortedTables.length} total`;

  const allOrderCards = [...deliveryOrders, ...takeawayOrders, ...quickOrders];

  /* Unpaid balance still on this board. Each entry uses the very expression its
     own card prints — TableCard adds the parked cake due, OrderCard does not —
     so the pill always ties out to the amounts on screen. */
  const openOnBoard = [
    ...sortedTables
      .map(t => orders[tableOrderMap[t.id]])
      .filter(o => o && hasContent(o))
      .map(o => ({ order: o, amount: (Number(o.total_amount) || 0) + cakeDraftDue(o) })),
    // heldOrder is a paid snapshot kept only for the fly-to-drawer animation
    ...allOrderCards
      .filter(o => o.id !== heldOrder?.id)
      .map(o => ({ order: o, amount: Number(o.total_amount) || 0 })),
  ];
  // Cards round to whole rupees — round per card too so the pill is exactly
  // the sum of the numbers the cashier can see, not a re-rounded raw total.
  const toCollect = openOnBoard.reduce((sum, e) => sum + Math.round(e.amount), 0);
  const sortedOrderCards = [...allOrderCards].sort((a, b) => {
    const ia = cardOrder.indexOf(a.id);
    const ib = cardOrder.indexOf(b.id);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  // keep saved order list in sync with new/vanished order ids
  useEffect(() => {
    const currentIds = allOrderCards.map(o => o.id);
    const missing = currentIds.filter(id => !cardOrder.includes(id));
    if (missing.length > 0) setCardOrder(prev => [...prev, ...missing]);
  }, [allOrderCards.map(o => o.id).join(',')]); // eslint-disable-line

  const TOOLBAR_BTN_DEFS = {

    cake: {
      className: 'pos-topbar__btn--g1', icon: '🎂', label: 'Cake Orders',
      onClick: () => setCakeWin({ id: null }), badge: () => cakeOrders.length,
    },
    delivery: {
      className: 'pos-topbar__btn--g1', icon: '🚴', label: 'Delivery',
      onClick: () => openNonDineIn(ORDER_TYPE.DELIVERY),
    },
    takeaway: {
      className: 'pos-topbar__btn--g1', icon: '🛍', label: 'Takeaway',
      onClick: () => navigate('/pos/entry', { state: { orderType: ORDER_TYPE.TAKEAWAY } }),
    },


    draft: {
      className: 'pos-topbar__btn--g2', icon: '📝', label: 'Draft Order',
      onClick: () => navigate('/pos/entry', { state: { orderType: ORDER_TYPE.TAKEAWAY, draftMode: true } }),
      title: 'Draft order — processed manually later',
      badge: () => schedOrders.filter(r => r.kind === 'DRAFT').length,
    },

    schedule: {
      className: 'pos-topbar__btn--g2', icon: '⏰', label: 'Sched. Order',
      onClick: () => setShowSchedule(true),
      title: 'Schedule a delivery — auto-fires to KOT before its time',
      badge: () => schedOrders.filter(r => r.kind === 'SCHEDULED').length,
    },
    weborders: {
      className: 'pos-topbar__btn--g2', icon: '🌐', label: 'Web Orders',
      onClick: () => setShowWebOrders(true), badge: () => webOrderCount,
      title: 'Website orders waiting for approval',
    },
    tablemerge: {
      className: 'pos-topbar__btn--g3', icon: '🔄', label: 'Table Merge',
      onClick: () => setShowTableMerge(true), title: 'Merge orders between tables',
    },
    shift: {
      className: 'pos-topbar__btn--g3', icon: '↔', label: 'Shift Order',
      onClick: () => setShowShift(true), title: 'Shift order to a different table',
    },
    drawer: {
      className: 'pos-topbar__btn--g3', icon: '💰', label: 'Drawer',
      onClick: () => setShowDrawer(true), title: 'Cash in / cash out for the open business day',
    },
    closeday: {
      className: 'pos-topbar__btn--g3', icon: '🔒', label: 'Close Day',
      onClick: () => navigate('/pos/cash-closing'),
      title: 'Daily cash closing — open/close the business day (F2)',
    },
  };

  return (
    <div className="pos-root">
      {/* ── OS Menu Bar ─────────────────────────────────────── */}
      <div className="pos-topbar">
        <span className="pos-topbar__brand">Munch Time Cafe</span>
        <button className="pos-topbar__btn" onClick={() => navigate('/')}>
          <span className="pos-topbar__icon">←</span>
          <span className="pos-topbar__label">Dashboard</span>
        </button>

        <div
          className={`pos-topbar__reorder-group${reorderMode ? ' pos-topbar__reorder-group--active' : ''}`}
        >
          {btnOrder.map((id) => {
            const def = TOOLBAR_BTN_DEFS[id];
            if (!def || (def.visible && !def.visible())) return null;
            return (
              <button
                key={id}
                className={`pos-topbar__btn ${def.className}`}
                onClick={reorderMode ? undefined : def.onClick}
                title={def.title}
                data-cash-target={id === 'drawer' ? 'drawer' : undefined}
                draggable={reorderMode}
                onDragStart={reorderMode ? onBtnDragStart(id) : undefined}
                onDragOver={reorderMode ? onBtnDragOver(id) : undefined}
                onDragEnd={reorderMode ? onBtnDragEnd : undefined}
              >
                <span className="pos-topbar__icon">{def.icon}</span>
                <span className="pos-topbar__label">{def.label}</span>
                {def.badge != null && def.badge() > 0 && (
                  <span className="pos-topbar__badge">{def.badge()}</span>
                )}
              </button>
            );
          })}
        </div>

        <button
          className={`pos-topbar__btn pos-topbar__reorder-toggle${reorderMode ? ' pos-topbar__reorder-toggle--active' : ''}`}
          onClick={toggleReorderMode}
          title="Reorder toolbar buttons"
        >
          <span className="pos-topbar__icon">{reorderMode ? '✓' : '🔀'}</span>
          <span className="pos-topbar__label">{reorderMode ? 'Done' : 'Reorder'}</span>
        </button>

        <span className="pos-topbar__spacer" />

        {user && (
          <span className="pos-topbar__user">
            {user.employee_id} · {user.role}
          </span>
        )}
        <button className="pos-topbar__lock" onClick={lock} title="Lock terminal">🔒</button>
        <Clock />
      </div>

      {/* New fully-resolved order landed — flower burst from the right corner */}
      {arriveId && (
        <div className="oc-arrive-fx" aria-hidden>
          <span className="oc-arrive-fx__comet">🌸</span>
          {['🌸', '🌼', '💐', '🌷', '🌺', '✨', '🌸', '🌼'].map((f, i) => (
            <span key={i} className="oc-arrive-fx__petal" style={{ '--i': i }}>{f}</span>
          ))}
        </div>
      )}

      {/* ── Desktop Workspace ───────────────────────────────── */}
      <div className="pos-dashboard">

        {/* TABLES WINDOW */}
        <DesktopWindow
          title="Dine In Tables" count={tableCountLabel}
          extra={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
              <NotificationCenter />
              <NepaliDateChip variant="chrome" />
            </div>
          }>
          <div className="table-card-grid"> {sortedTables.map((t) => (<TableCard key={t.id} table={t} onClick={onTableClick} onDirectCheckout={openCheckoutForOrder} frozenOrderIds={frozenTableOrderIds} />))}
            {tables.length === 0 && (<div className="pos-empty-state">No tables configured.</div>)}
          </div>
        </DesktopWindow>

        {/* ALL OTHER ORDERS WINDOW */}
        {(allOrderCards.length + schedOrders.length) > 0 && (
          <DesktopWindow
            title="📦 All Orders" count={`${allOrderCards.length + schedOrders.length} active`}
            onAdd={() => setShowAddCustomer(true)}
            onReorder={toggleCardReorderMode} reorderActive={cardReorderMode}
          >
            <div
              className={cardReorderMode ? 'pos-orders-grid pos-orders-grid--reorder' : 'pos-orders-grid'}
              style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 168px)', gap: '10px', alignItems: 'start' }}
            >
              {schedOrders.map((row, i) => (
                <ScheduledOrderCard
                  key={`sched-${row.id}`}
                  row={row}
                  index={i}
                  flash={flashIds.has(row.id)}
                  arrive={arriveId === row.id}
                  onOpen={cardReorderMode ? noop : openScheduledRow}
                  onConvert={cardReorderMode ? noop : convertRowNow}
                  onCancel={cardReorderMode ? noop : cancelScheduledRow}
                  onDelete={cardReorderMode ? noop : deleteScheduledRow}
                />
              ))}
              {sortedOrderCards.map((o, i) => (
                <div
                  key={o.id}
                  draggable={cardReorderMode}
                  onDragStart={cardReorderMode ? onCardDragStart(o.id) : undefined}
                  onDragOver={cardReorderMode ? onCardDragOver(o.id) : undefined}
                  onDragEnd={cardReorderMode ? onCardDragEnd : undefined}
                  className={cardReorderMode ? 'pos-order-card-drag' : undefined}
                >
                  <OrderCard
                    order={o}
                    index={i}
                    onClick={cardReorderMode ? noop : onActiveOrderClick}
                    onDirectCheckout={cardReorderMode ? noop : openCheckoutForOrder}
                    closing={closingOrderIds.has(o.id)}
                  />
                </div>
              ))}
            </div>
          </DesktopWindow>
        )}

        {/* CAKE ORDERS WINDOW — hides itself when no cake orders today */}
        <CakeDashboardWindow
          refreshToken={cakeRefresh}
          onOpenOrder={(orderId) => setCakeWin({ id: orderId })}
        />
      </div>

      {/* ── Modals ──────────────────────────────────────────── */}
      {orderTypeModal && (
        <OrderTypeModal
          onConfirm={handleOrderTypeConfirm}
          onClose={() => setOrderTypeModal(null)}
        />
      )}
      {checkoutOrderId && (
        <CheckoutModal
          orderId={checkoutOrderId}
          cakeItems={cakeDraftItems(orders[checkoutOrderId] ?? heldOrder)}
          onClose={handleCheckoutClose}
          onSuccess={handleCheckoutSuccess}
        />
      )}
      {showTableMerge && (
        <TableMergeModal
          onClose={() => setShowTableMerge(false)}
          onMerged={loadActiveOrders}
        />
      )}
      {showShift && (
        <ShiftOrderModal
          onClose={() => setShowShift(false)}
          onShifted={loadActiveOrders}
        />
      )}
      {showDrawer && (
        <CashDrawerModal onClose={() => setShowDrawer(false)} />
      )}
      {showSalesReport && (
        <SalesReportModal
          onClose={() => setShowSalesReport(false)}
          toCollect={toCollect}
          toCollectCount={openOnBoard.length}
          isAdmin={user?.role === 'ADMIN'}
          revertOrderTransaction={revertOrderTransaction}
          revertCakeTransaction={revertCakeTransaction}
          notify={notify}
        />
      )}
      {showWebOrders && (
        <WebOrdersModal
          onClose={() => setShowWebOrders(false)}
          onApproved={loadActiveOrders}
        />
      )}
      {showSchedule && (
        <ScheduleOrderModal
          onProceed={onScheduleProceed}
          onClose={() => setShowSchedule(false)}
        />
      )}
      {showAddCustomer && (
        <AddCustomerModal
          onClose={() => setShowAddCustomer(false)}
          onSaved={() => notify('success', '✓ Customer saved')}
        />
      )}
      {cakeWin && (
        <Suspense fallback={null}>
          <CakeOrderFormWindow
            id={cakeWin.id}
            onClose={() => { setCakeWin(null); setCakeRefresh(t => t + 1); }}
          />
        </Suspense>
      )}


      {ui.notification && (
        <div className={`pos-notification pos-notification--${ui.notification.type}`}>
          {ui.notification.message}
          {ui.notification.type === 'success' && <ConfettiBurst trigger={ui.notification} />}
        </div>
      )}
    </div>
  );
}
