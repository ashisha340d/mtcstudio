import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router';
import { usePOS, ORDER_TYPE } from '../../context/POSContext';
import { useAuth } from '../../context/AuthContext';
import TableCard from './components/TableCard';
import OrderCard from './components/OrderCard';
import CheckoutModal from './components/SplitTenderCheckoutContainer';
import OrderTypeModal from './components/OrderTypeModal';
import TableMergeModal from './components/TableMergeModal';
import ShiftOrderModal from './components/ShiftOrderModal';
import RevertTransactionModal from './components/RevertTransactionModal';
import CashDrawerModal from './components/CashDrawerModal';
import SalesReportModal from './components/SalesReportModal';
import WebOrdersModal from './components/WebOrdersModal';
import AddCustomerModal from './components/AddCustomerModal';
import ScheduleOrderModal from './components/ScheduleOrderModal';
import ScheduledOrderCard from './components/ScheduledOrderCard';
import CakeDashboardWindow from './components/CakeDashboardWindow';
// Lazy — shares the route chunk, idle-prefetched below
const CakeOrderFormWindow = lazy(() => import('../CakeOrders/CakeOrderForm'));
import { getScheduledOrders, convertScheduledOrder, cancelScheduledOrder } from '../../services/posApi';
import ConfettiBurst from '../../components/ConfettiBurst/ConfettiBurst';
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
  'tablemerge', 'shift', 'revert', 'drawer',
];

function noop() {}

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
function DesktopWindow({ title, count, onAdd, onReorder, reorderActive, children }) {
  return (
    <div className="desktop-window">
      <div className="desktop-chrome">
        <div className="desktop-chrome__dots">
          <div className="win-dot win-dot--close" />
          <div className="win-dot win-dot--min" />
          <div className="win-dot win-dot--max" />
        </div>
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
  } = usePOS();
  const { user, lock } = useAuth();
  const navigate = useNavigate();

  const [checkoutOrderId, setCheckoutOrderId] = useState(null);
  const [orderTypeModal, setOrderTypeModal] = useState(null);
  const [showTableMerge, setShowTableMerge] = useState(false);
  const [showShift, setShowShift] = useState(false);
  const [showRevert, setShowRevert] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [showSalesReport, setShowSalesReport] = useState(false);
  const [showWebOrders, setShowWebOrders] = useState(false);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [cakeWin, setCakeWin] = useState(null);        // null | { id: number|null }
  const [cakeRefresh, setCakeRefresh] = useState(0);   // bump → cake window reloads

  // Scheduled + draft orders live in their own table — polled, not socket-driven
  const [schedOrders, setSchedOrders] = useState([]);
  const loadScheduled = useCallback(() => {
    getScheduledOrders().then(setSchedOrders).catch(() => {});
  }, []);
  useEffect(() => {
    loadScheduled();
    const id = setInterval(loadScheduled, 30000);
    return () => clearInterval(id);
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

  // F8 → toggle Sales Report
  useEffect(() => {
    const h = (e) => {
      if (e.key === 'F8') {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        setShowSalesReport(prev => !prev);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

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

  // Direct Checkout button on card → open checkout modal for that existing order
  function openCheckoutForOrder(orderId) {
    setCheckoutOrderId(orderId);
  }

  // Checkout success → close modal, refresh, and celebrate if it was a table order
  function handleCheckoutSuccess() {
    const order = orders[checkoutOrderId];
    const table = order?.table_id ? tables.find(t => t.id === order.table_id) : null;
    setCheckoutOrderId(null);
    loadActiveOrders();
    if (table) notify('success', `🎉 Table ${table.name} Checked Out`);
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

  const nonTableOrders = Object.values(orders).filter(
    (o) => o.order_type !== ORDER_TYPE.DINE_IN
      && (o.status === 'OPEN' || o.status === 'SAVED')
      && hasContent(o)
  );

  const deliveryOrders = nonTableOrders.filter((o) => o.order_type === ORDER_TYPE.DELIVERY);
  const takeawayOrders = nonTableOrders.filter((o) => o.order_type === ORDER_TYPE.TAKEAWAY);
  const cakeOrders = nonTableOrders.filter((o) => o.order_type === ORDER_TYPE.CAKE_ORDER);
  const quickOrders = nonTableOrders.filter((o) => o.order_type === ORDER_TYPE.QUICK_SALE);

  const occupiedCount = sortedTables.filter(t => tableOrderMap[t.id]).length;
  const tableCountLabel = `${occupiedCount} occupied · ${sortedTables.length} total`;

  const allOrderCards = [...deliveryOrders, ...takeawayOrders, ...quickOrders];
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
    takeaway: {
      className: 'pos-topbar__btn--takeaway', label: '🛍 Takeaway',
      onClick: () => navigate('/pos/entry', { state: { orderType: ORDER_TYPE.TAKEAWAY } }),
    },
    delivery: {
      className: 'pos-topbar__btn--delivery', label: '🚴 Delivery Partner',
      onClick: () => openNonDineIn(ORDER_TYPE.DELIVERY),
    },
    schedule: {
      className: 'pos-topbar__btn--delivery', label: '⏰ Schedule Order',
      onClick: () => setShowSchedule(true),
      title: 'Schedule a delivery — auto-fires to KOT before its time',
      badge: () => schedOrders.filter(r => r.kind === 'SCHEDULED').length,
    },
    draft: {
      className: 'pos-topbar__btn--quick', label: '📝 Draft Order',
      onClick: () => navigate('/pos/entry', { state: { orderType: ORDER_TYPE.TAKEAWAY, draftMode: true } }),
      title: 'Draft order — processed manually later',
      badge: () => schedOrders.filter(r => r.kind === 'DRAFT').length,
    },
    cake: {
      className: 'pos-topbar__btn--cake', label: '🎂 Cake Orders',
      onClick: () => setCakeWin({ id: null }), badge: () => cakeOrders.length,
    },
    weborders: {
      className: 'pos-topbar__btn--delivery', label: '🌐 Web Orders',
      onClick: () => setShowWebOrders(true), badge: () => webOrderCount,
      title: 'Website orders waiting for approval',
    },
    tablemerge: {
      className: 'pos-topbar__btn--table-merge', label: '🔄 Table Merge',
      onClick: () => setShowTableMerge(true), title: 'Merge orders between tables',
    },
    shift: {
      className: 'pos-topbar__btn--shift', label: '↔ Shift Order',
      onClick: () => setShowShift(true), title: 'Shift order to a different table',
    },
    revert: {
      className: 'pos-topbar__btn--shift', label: '↩ Revert Transaction',
      onClick: () => setShowRevert(true), title: 'Revert a mistaken checkout',
      visible: () => user?.role === 'MANAGER' || user?.role === 'ADMIN',
    },
    drawer: {
      className: 'pos-topbar__btn--quick', label: '💰 Drawer',
      onClick: () => setShowDrawer(true), title: 'Till, cash in/out, petty cash & drawer count',
    },
  };

  return (
    <div className="pos-root">
      {/* ── OS Menu Bar ─────────────────────────────────────── */}
      <div className="pos-topbar">
        <span className="pos-topbar__brand">Munch Time Cafe</span>
        <button className="pos-topbar__btn" onClick={() => navigate('/')}>
          ← Dashboard
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
                draggable={reorderMode}
                onDragStart={reorderMode ? onBtnDragStart(id) : undefined}
                onDragOver={reorderMode ? onBtnDragOver(id) : undefined}
                onDragEnd={reorderMode ? onBtnDragEnd : undefined}
              >
                {def.label}
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
          {reorderMode ? '✓ Done' : '🔀 Reorder'}
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

      {/* ── Desktop Workspace ───────────────────────────────── */}
      <div className="pos-dashboard">

        {/* TABLES WINDOW */}
        <DesktopWindow
          title={`🍽  Dine In · Tables`} count={tableCountLabel}>
          <div className="table-card-grid"> {sortedTables.map((t) => (<TableCard key={t.id} table={t} onClick={onTableClick} onDirectCheckout={openCheckoutForOrder} />))}
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
                  onOpen={cardReorderMode ? noop : openScheduledRow}
                  onConvert={cardReorderMode ? noop : convertRowNow}
                  onCancel={cardReorderMode ? noop : cancelScheduledRow}
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
          onClose={() => setCheckoutOrderId(null)}
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
      {showRevert && (
        <RevertTransactionModal
          onClose={() => setShowRevert(false)}
          onReverted={loadActiveOrders}
        />
      )}
      {showDrawer && (
        <CashDrawerModal onClose={() => setShowDrawer(false)} />
      )}
      {showSalesReport && (
        <SalesReportModal onClose={() => setShowSalesReport(false)} />
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
