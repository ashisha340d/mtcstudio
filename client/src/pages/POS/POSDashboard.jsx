import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { usePOS, ORDER_TYPE } from '../../context/POSContext';
import { useAuth } from '../../context/AuthContext';
import TableCard from './components/TableCard';
import OrderCard from './components/OrderCard';
import CheckoutModal from './components/SplitTenderCheckoutContainer';
import OrderTypeModal from './components/OrderTypeModal';
import MergeOrdersModal from './components/MergeOrdersModal';
import TableMergeModal from './components/TableMergeModal';
import ShiftOrderModal from './components/ShiftOrderModal';
import RevertTransactionModal from './components/RevertTransactionModal';
import CashDrawerModal from './components/CashDrawerModal';
import CakeDashboardWindow from './components/CakeDashboardWindow';
import SalesReportModal from './components/SalesReportModal';
import WebOrdersModal from './components/WebOrdersModal';
import FastPane from './components/FastPane';
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

/* ── Desktop window panel with OS chrome ──────────────────── */
function DesktopWindow({ title, count, children }) {
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
      </div>
      <div className="desktop-window__body">{children}</div>
    </div>
  );
}

export default function POSDashboard() {
  const {
    tables, orders, tableOrderMap, kotsByOrder, ui,
    loadMasterData, loadActiveOrders, notify,
    webOrderCount, webOrderAlert, clearWebOrderAlert,
  } = usePOS();
  const { user, lock } = useAuth();
  const navigate = useNavigate();

  const [checkoutOrderId, setCheckoutOrderId] = useState(null);
  const [orderTypeModal, setOrderTypeModal] = useState(null);
  const [showMerge, setShowMerge] = useState(false);
  const [showTableMerge, setShowTableMerge] = useState(false);
  const [showShift, setShowShift] = useState(false);
  const [showRevert, setShowRevert] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [showSalesReport, setShowSalesReport] = useState(false);
  const [showWebOrders, setShowWebOrders] = useState(false);

  useEffect(() => {
    loadMasterData();
    loadActiveOrders();
  }, []); // eslint-disable-line

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

  // Non-dine-in buttons → show customer info modal first
  function openNonDineIn(type) { setOrderTypeModal({ initialType: type }); }

  // After customer info collected → navigate to POS entry
  function handleOrderTypeConfirm({ orderType, customerName, customerPhone, customerAddress }) {
    setOrderTypeModal(null);
    navigate('/pos/entry', {
      state: { orderType, customerName, customerPhone, customerAddress },
    });
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

  return (
    <div className="pos-root">
      {/* ── OS Menu Bar ─────────────────────────────────────── */}
      <div className="pos-topbar">
        <span className="pos-topbar__brand">Munch Time Cafe</span>
        <button className="pos-topbar__btn" onClick={() => navigate('/')}>
          ← Dashboard
        </button>

        <button
          className="pos-topbar__btn pos-topbar__btn--takeaway"
          onClick={() => openNonDineIn(ORDER_TYPE.TAKEAWAY)}
        >
          🛍 Takeaway
        </button>

        <button
          className="pos-topbar__btn pos-topbar__btn--delivery"
          onClick={() => openNonDineIn(ORDER_TYPE.DELIVERY)}
        >
          🚴 Delivery
        </button>

        <button
          className="pos-topbar__btn pos-topbar__btn--quick"
          onClick={() =>
            navigate('/pos/entry', {
              state: {
                orderType: ORDER_TYPE.QUICK_SALE,
                customerName: 'Cash',
              },
            })
          }
        >
          ⚡ Quick
        </button>

        <button
          className="pos-topbar__btn pos-topbar__btn--cake"
          onClick={() => navigate('/pos/cake/new')}
        >
          🎂 Cake Orders

          {cakeOrders.length > 0 && (
            <span className="pos-topbar__badge">
              {cakeOrders.length}
            </span>
          )}
        </button>

        <button
          className="pos-topbar__btn pos-topbar__btn--delivery"
          onClick={() => setShowWebOrders(true)}
          title="Website orders waiting for approval"
        >
          🌐 Web Orders
          {webOrderCount > 0 && (
            <span className="pos-topbar__badge">{webOrderCount}</span>
          )}
        </button>

        <button
          className="pos-topbar__btn pos-topbar__btn--merge"
          onClick={() => setShowMerge(true)}
          title="Merge orders across all types"
        >
          🔀 Merge
        </button>

        <button
          className="pos-topbar__btn pos-topbar__btn--table-merge"
          onClick={() => setShowTableMerge(true)}
          title="Merge orders between tables"
        >
          🔄 Table Merge
        </button>

        <button
          className="pos-topbar__btn pos-topbar__btn--shift"
          onClick={() => setShowShift(true)}
          title="Shift order to a different table"
        >
          ↔ Shift Order
        </button>

        {(user?.role === 'MANAGER' || user?.role === 'ADMIN') && (
          <button
            className="pos-topbar__btn pos-topbar__btn--shift"
            onClick={() => setShowRevert(true)}
            title="Revert a mistaken checkout"
          >
            ↩ Revert Transaction
          </button>
        )}

        <button
          className="pos-topbar__btn pos-topbar__btn--quick"
          onClick={() => setShowDrawer(true)}
          title="Till, cash in/out, petty cash & drawer count"
        >
          💰 Drawer
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
        <DesktopWindow title="📦 All Orders" count={`${deliveryOrders.length + takeawayOrders.length + quickOrders.length} active`}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 168px)', gap: '10px', alignItems: 'start' }}>
            {deliveryOrders.map((o, i) => (<OrderCard key={o.id} order={o} index={i} onClick={onActiveOrderClick} onDirectCheckout={openCheckoutForOrder} />))}
            {takeawayOrders.map((o, i) => (<OrderCard key={o.id} order={o} index={i} onClick={onActiveOrderClick} onDirectCheckout={openCheckoutForOrder} />))}
            {quickOrders.map((o, i) => (<OrderCard key={o.id} order={o} index={i} onClick={onActiveOrderClick} onDirectCheckout={openCheckoutForOrder} />))}
          </div>
        </DesktopWindow>


        {/* CAKE ORDERS WINDOW */}
        <CakeDashboardWindow />
      </div>

      {/* ── Modals ──────────────────────────────────────────── */}
      {orderTypeModal && (
        <OrderTypeModal
          initialType={orderTypeModal.initialType}
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
      {showMerge && (
        <MergeOrdersModal
          onClose={() => setShowMerge(false)}
          onMerged={loadActiveOrders}
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

      {/* New web order popup — stays until dismissed or reviewed */}
      {webOrderAlert && !showWebOrders && (
        <div className="modal-overlay" onClick={clearWebOrderAlert}>
          <div className="modal" style={{ maxWidth: 420, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <span className="modal__title">🌐 New Web Order!</span>
            <p style={{ margin: '10px 0 4px', fontSize: 15 }}>
              <strong>{webOrderAlert.orderNumber}</strong> · {webOrderAlert.orderType}
            </p>
            <p style={{ margin: '0 0 6px', fontSize: 14 }}>
              {webOrderAlert.customerName || 'Customer'} · 📞 {webOrderAlert.customerPhone || '—'}
            </p>
            <p style={{ margin: '0 0 12px', fontSize: 14 }}>
              {webOrderAlert.itemCount} item(s) · <strong>Rs {Number(webOrderAlert.grandTotal || 0).toLocaleString('en-IN')}</strong>
            </p>
            <div className="modal__actions" style={{ justifyContent: 'center' }}>
              <button className="modal__btn modal__btn--cancel" onClick={clearWebOrderAlert}>Later</button>
              <button
                className="modal__btn modal__btn--confirm"
                onClick={() => { clearWebOrderAlert(); setShowWebOrders(true); }}
              >
                Review Now
              </button>
            </div>
          </div>
        </div>
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
