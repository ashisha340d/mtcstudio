import { useEffect, useState } from 'react';
import posApi from '../../services/posApi';
import { printReceipt } from '../POS/components/ThermalReceipt';
import './SalesReport.css';

const PAYMENT_LABELS = { CASH: 'Cash', CARD: 'Card', QR: 'QR/UPI', WALLET: 'Wallet', LEDGER: 'Ledger' };

// order.time stays "HH:MM" (24h) for correct string sorting — format to 12h AM/PM only for display
function fmt12h(hhmm) {
  const [h, m] = (hhmm || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

const COL_WIDTHS_KEY = 'salesReport.colWidths';
const DEFAULT_COL_WIDTHS = { sn: 32, id: 54, time: 68, customer: 220, payment: 100, amount: 90, action: 36 };
const MIN_COL_WIDTH = { sn: 24, id: 36, time: 50, customer: 120, payment: 70, amount: 60 };

function loadColWidths() {
  try {
    return { ...DEFAULT_COL_WIDTHS, ...JSON.parse(localStorage.getItem(COL_WIDTHS_KEY)) };
  } catch {
    return DEFAULT_COL_WIDTHS;
  }
}

function todayNepal() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' });
}

export default function SalesReport({
  gridLines = true, actionsEnabled = false, isAdmin = false,
  revertOrderTransaction, revertCakeTransaction, notify,
} = {}) {
  const [date, setDate]                 = useState(todayNepal);
  const [salesData, setSalesData]       = useState(null);
  const [cakeData, setCakeData]         = useState(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [expandedOrder, setExpandedOrder] = useState(null);
  const [search, setSearch]             = useState('');
  const [colWidths, setColWidths]       = useState(loadColWidths);
  const [sort, setSort]                 = useState({ col: 'time', dir: 'desc' });
  const [refreshTick, setRefreshTick]   = useState(0);

  const showActions = actionsEnabled && isAdmin && date === todayNepal();

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      try {
        setLoading(true);
        setError(null);
        const [sales, cake] = await Promise.allSettled([
          posApi.getSalesReport(date),
          posApi.getCakePaymentsReport(date),
        ]);
        if (cancelled) return;
        if (sales.status === 'fulfilled') setSalesData(sales.value);
        else setError(sales.reason?.response?.data?.error || sales.reason?.message || 'Failed to load');
        setCakeData(cake.status === 'fulfilled' ? cake.value : null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetch();
    return () => { cancelled = true; };
  }, [date, refreshTick]);

  async function handleRecall(order, e) {
    e.stopPropagation();
    const input = window.prompt(`Reason for recalling ${order.label} (optional):`);
    if (input === null) return;
    try {
      if (order.source === 'CAKE') await revertCakeTransaction({ cakeOrderId: order.cakeOrderId, reason: input });
      else await revertOrderTransaction({ orderId: order.id, reason: input });
      notify?.('success', `${order.label} recalled`);
      setRefreshTick(t => t + 1);
    } catch (err) {
      notify?.('error', err.response?.data?.error || err.message || 'Recall failed');
    }
  }

  function handlePrint(order, e) {
    e.stopPropagation();
    printReceipt({
      order: {
        id: order.id,
        order_type: order.orderType,
        table_name: order.tableName,
        customer_name: order.customerName,
        customer_phone: order.customerPhone,
        total_amount: order.amount,
        created_at: order.closedAt,
      },
      items: order.items || [],
      payments: order.payments || [],
      isReprint: true,
    });
  }

  const toggleOrder = (id) => setExpandedOrder(prev => prev === id ? null : id);

  const toggleSort = (col) => setSort(prev => prev.col === col
    ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
    : { col, dir: 'asc' });

  const startResize = (col, e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colWidths[col];
    const onMove = (moveEvent) => {
      const newWidth = Math.max(MIN_COL_WIDTH[col], startWidth + (moveEvent.clientX - startX));
      setColWidths(prev => ({ ...prev, [col]: newWidth }));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setColWidths(prev => {
        localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(prev));
        return prev;
      });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const colVarStyle = {
    '--w-sn': `${colWidths.sn}px`,
    '--w-id': `${colWidths.id}px`,
    '--w-time': `${colWidths.time}px`,
    '--w-customer': `${colWidths.customer}px`,
    '--w-payment': `${colWidths.payment}px`,
    '--w-amount': `${colWidths.amount}px`,
    '--w-action': `${showActions ? Math.max(colWidths.action, 84) : colWidths.action}px`,
  };

  // Merge KOT and cake orders into a single list
  const allRows = [
    ...(salesData?.orders || []).map(o => ({
      key: `f-${o.id}`,
      source: 'FOOD',
      id: o.id,
      orderType: o.orderType,
      closedAt: o.closedAt,
      label: `#${o.id}`,
      time: o.time,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      tableName: o.tableName,
      paymentMethod: o.paymentMethod,
      amount: o.amount || 0,
      discount: o.discount || 0,
      payments: o.payments,
      items: o.items,
    })),
    ...(cakeData?.transactions || []).map(t => ({
      key: `c-${t.id}`,
      source: 'CAKE',
      cakeOrderId: t.cakeOrderId,
      label: t.order_number,
      time: t.time,
      customerName: t.customer_name,
      customerPhone: null,
      tableName: null,
      paymentMethod: t.method,
      amount: t.amount || 0,
      discount: 0,
      payments: null,
      items: null,
      deleted: t.deleted,
    })),
  ].sort((a, b) => b.time.localeCompare(a.time));

  const q = search.trim().toLowerCase();
  const filteredOrders = allRows
    .map(o => ({ ...o, itemMatch: !!q && (o.items || []).some(item => (item.name || '').toLowerCase().includes(q)) }))
    .filter(o => !q
      || o.label.toLowerCase().includes(q)
      || (o.customerName || '').toLowerCase().includes(q)
      || (o.customerPhone || '').toLowerCase().includes(q)
      || (o.tableName || '').toLowerCase().includes(q)
      || (PAYMENT_LABELS[o.paymentMethod] || o.paymentMethod || '').toLowerCase().includes(q)
      || o.itemMatch);

  const SORT_ACCESSORS = {
    id: o => o.label,
    time: o => o.time,
    customer: o => o.customerName || '',
    payment: o => PAYMENT_LABELS[o.paymentMethod] || o.paymentMethod || '',
    amount: o => o.amount || 0,
  };
  const sortAcc = SORT_ACCESSORS[sort.col];
  const sortedOrders = sortAcc
    ? [...filteredOrders].sort((a, b) => {
        const av = sortAcc(a), bv = sortAcc(b);
        const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
        return sort.dir === 'asc' ? cmp : -cmp;
      })
    : filteredOrders;

  const formattedDate = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  // QR breakdown — split fully-QR orders from split-tender QR legs (food orders only)
  const qrBreakdown = (salesData?.orders || []).reduce((acc, o) => {
    const pays = o.payments || [];
    const qrLeg = pays.filter(p => p.method === 'QR').reduce((s, p) => s + (p.amount || 0), 0);
    if (!qrLeg) return acc;
    if (pays.some(p => p.method !== 'QR')) { acc.splitAmt += qrLeg; acc.splitCount += 1; }
    else { acc.fullAmt += qrLeg; acc.fullCount += 1; }
    return acc;
  }, { fullAmt: 0, fullCount: 0, splitAmt: 0, splitCount: 0 });

  return (
    <div className={`sales-report${gridLines ? '' : ' sales-report--no-grid'}`}>

      {/* ── Header ── */}
      <div className="sales-report-header">
        <h1>Sales Registry <span className="report-date">— {formattedDate}</span></h1>
        <input
          type="text"
          className="report-search"
          placeholder="Search order #, customer, phone, table, payment (QR, Card, Cash)…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <input
          type="date"
          className="report-date-picker"
          value={date}
          max={todayNepal()}
          onChange={e => { setDate(e.target.value); setExpandedOrder(null); setSearch(''); }}
        />
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div className="report-state">
          <div className="report-state-icon">⏳</div>
          <p>Loading sales data…</p>
        </div>
      )}

      {/* ── Error ── */}
      {!loading && error && (
        <div className="report-state report-state--error">
          <div className="report-state-icon">❌</div>
          <p>{error}</p>
          <button className="btn-retry" onClick={() => setDate(d => d)}>Retry</button>
        </div>
      )}

      {/* ── No orders ── */}
      {!loading && !error && salesData && allRows.length === 0 && (
        <div className="report-state">
          <div className="report-state-icon">📊</div>
          <p>No orders found for this date.</p>
        </div>
      )}

      {/* ── No search matches ── */}
      {!loading && !error && salesData && allRows.length > 0 && sortedOrders.length === 0 && (
        <div className="report-state">
          <div className="report-state-icon">🔍</div>
          <p>No orders match "{search}".</p>
        </div>
      )}

      {/* ── Data ── */}
      {!loading && !error && salesData && allRows.length > 0 && sortedOrders.length > 0 && (
        <>
          {/* ── Orders Table ── */}
          <div className="sales-orders">
            <div className="orders-section-label">
              Orders — {sortedOrders.length}
            </div>
            <div className="orders-table orders-table--listview" style={colVarStyle}>
              <div className="table-header">
                <div className="col-sn">SN<span className="col-resize-handle" onMouseDown={e => startResize('sn', e)} /></div>
                <div className="col-id" onClick={() => toggleSort('id')}>#{sort.col === 'id' && <span className="sort-arrow">{sort.dir === 'asc' ? '▲' : '▼'}</span>}<span className="col-resize-handle" onMouseDown={e => startResize('id', e)} /></div>
                <div className="col-time" onClick={() => toggleSort('time')}>Time{sort.col === 'time' && <span className="sort-arrow">{sort.dir === 'asc' ? '▲' : '▼'}</span>}<span className="col-resize-handle" onMouseDown={e => startResize('time', e)} /></div>
                <div className="col-customer" onClick={() => toggleSort('customer')}>Customer{sort.col === 'customer' && <span className="sort-arrow">{sort.dir === 'asc' ? '▲' : '▼'}</span>}<span className="col-resize-handle" onMouseDown={e => startResize('customer', e)} /></div>
                <div className="col-payment" onClick={() => toggleSort('payment')}>Payment{sort.col === 'payment' && <span className="sort-arrow">{sort.dir === 'asc' ? '▲' : '▼'}</span>}<span className="col-resize-handle" onMouseDown={e => startResize('payment', e)} /></div>
                <div className="col-amount" onClick={() => toggleSort('amount')}>Amount{sort.col === 'amount' && <span className="sort-arrow">{sort.dir === 'asc' ? '▲' : '▼'}</span>}<span className="col-resize-handle" onMouseDown={e => startResize('amount', e)} /></div>
                <div className="col-action">{showActions && 'Action'}</div>
              </div>

              {sortedOrders.map((order, idx) => (
                <div key={order.key} className={`order-row${idx % 2 ? ' order-row--alt' : ''}`}>
                  <div
                    className={`table-row${(expandedOrder === order.key || (q && order.itemMatch)) ? ' table-row--expanded' : ''}${order.deleted ? ' table-row--deleted' : ''}`}
                    onClick={() => order.items && toggleOrder(order.key)}
                    style={{ cursor: order.items ? 'pointer' : 'default' }}
                  >
                    <div className="col-sn">{idx + 1}</div>
                    <div className="col-id">{order.label}</div>
                    <div className="col-time">
                      <div className="order-time">{fmt12h(order.time)}</div>
                    </div>
                    <div className="col-customer">
                      {order.source === 'CAKE' && <div className="table-tag">Cake</div>}
                      {order.deleted && <div className="table-tag table-tag--deleted">Deleted</div>}
                      {order.tableName && <div className="table-tag">Table {order.tableName}</div>}
                      <div className="customer-name">{order.customerName || 'Walk-in'}</div>
                      {order.customerPhone && (
                        <div className="customer-phone">{order.customerPhone}</div>
                      )}
                    </div>
                    <div className="col-payment">
                      {order.payments && order.payments.length > 1 ? (
                        order.payments.map((p, i) => (
                          <span key={i} className={`payment-badge payment-badge--sm payment-${p.method.toLowerCase()}`}>
                            {PAYMENT_LABELS[p.method] || p.method}
                          </span>
                        ))
                      ) : (
                        <span className={`payment-badge payment-${(order.paymentMethod || 'CASH').toLowerCase()}`}>
                          {PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod}
                        </span>
                      )}
                    </div>
                    <div className="col-amount">₹{order.deleted ? 0 : (order.amount || 0).toLocaleString('en-IN')}</div>
                    <div className="col-action">
                      {showActions && !order.deleted && (
                        <>
                          {order.source === 'FOOD' && (
                            <button className="report-action-btn" title="Print receipt" onClick={e => handlePrint(order, e)}>🖨</button>
                          )}
                          <button className="report-action-btn report-action-btn--recall" title="Recall / revert this transaction" onClick={e => handleRecall(order, e)}>↩</button>
                        </>
                      )}
                      {order.items && <span className="expand-chevron">{expandedOrder === order.key ? '▲' : '▼'}</span>}
                    </div>
                  </div>

                  {order.items && (expandedOrder === order.key || (q && order.itemMatch)) && (
                    <div className="order-details">
                      <div className="details-summary">
                        <span>Total: ₹{(order.amount || 0).toLocaleString('en-IN')}</span>
                        <span>Discount: ₹{(order.discount || 0).toLocaleString('en-IN')}</span>
                        <span className="details-summary__payments">
                          {order.payments.map((p, i) => (
                            <span key={i} className={`payment-badge payment-${p.method.toLowerCase()}`}>
                              {PAYMENT_LABELS[p.method] || p.method}: ₹{(p.amount || 0).toLocaleString('en-IN')}
                            </span>
                          ))}
                        </span>
                      </div>
                      {order.items.length === 0 ? (
                        <div style={{ padding: '12px 16px', color: '#94a3b8', fontSize: 12 }}>No items recorded</div>
                      ) : (
                        <div className="details-table">
                          <div className="details-header">
                            <div className="dc-sn">SN</div>
                            <div className="dc-item">Item Name</div>
                            <div className="dc-qty">Qty</div>
                            <div className="dc-rate">Rate</div>
                            <div className="dc-amount">Amount</div>
                          </div>
                          {order.items.map(item => (
                            <div key={item.sn} className="details-row">
                              <div className="dc-sn">{item.sn}</div>
                              <div className="dc-item">{item.name}</div>
                              <div className="dc-qty">{item.qty}</div>
                              <div className="dc-rate">₹{(item.rate || 0).toLocaleString('en-IN')}</div>
                              <div className="dc-amount">₹{(item.amount || 0).toLocaleString('en-IN')}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              <div className="table-footer">
                <span className="footer-chip footer-chip--credit">Credit ₹{(salesData.credit || 0).toLocaleString('en-IN')}</span>
                <span className="footer-chip footer-chip--card">Card ₹{(salesData.card || 0).toLocaleString('en-IN')}</span>
                <span
                  className="footer-chip footer-chip--card"
                  title={`Fully-QR orders: ${qrBreakdown.fullCount} = ₹${qrBreakdown.fullAmt.toLocaleString('en-IN')}\nSplit-tender QR legs: ${qrBreakdown.splitCount} = ₹${qrBreakdown.splitAmt.toLocaleString('en-IN')}`}
                >
                  UPI/QR ₹{(salesData.qr || 0).toLocaleString('en-IN')}
                  {qrBreakdown.splitCount > 0 && (
                    <span className="footer-chip-sub"> ({qrBreakdown.fullCount} full + {qrBreakdown.splitCount} split)</span>
                  )}
                </span>
                <span className="footer-chip footer-chip--cash">Cash ₹{(salesData.cash || 0).toLocaleString('en-IN')}</span>
                <span className="footer-chip footer-chip--total">Total ₹{((salesData.card || 0) + (salesData.qr || 0) + (salesData.cash || 0)).toLocaleString('en-IN')}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
