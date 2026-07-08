import { useEffect, useState } from 'react';
import posApi from '../../services/posApi';
import './SalesReport.css';

const PAYMENT_LABELS = { CASH: 'Cash', CARD: 'Card', QR: 'QR/UPI', WALLET: 'Wallet', LEDGER: 'Ledger' };
const CAKE_TYPE_LABELS = { ADVANCE: 'Advance', FOLLOWUP: 'Follow-up', REVERSAL: 'Reversal' };

function todayNepal() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' });
}

export default function SalesReport() {
  const [date, setDate]                 = useState(todayNepal);
  const [salesData, setSalesData]       = useState(null);
  const [cakeData, setCakeData]         = useState(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [expandedOrder, setExpandedOrder] = useState(null);
  const [search, setSearch]             = useState('');

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
  }, [date]);

  const toggleOrder = (id) => setExpandedOrder(prev => prev === id ? null : id);

  const totalSales = salesData
    ? (salesData.cash || 0) + (salesData.card || 0) + (salesData.credit || 0)
    : 0;

  const q = search.trim().toLowerCase();
  const filteredOrders = (salesData?.orders || []).filter(o => !q
    || String(o.id).includes(q)
    || (o.customerName || '').toLowerCase().includes(q)
    || (o.customerPhone || '').toLowerCase().includes(q)
    || (o.tableName || '').toLowerCase().includes(q));

  const totalOrders = filteredOrders.reduce((s, o) => s + (o.amount || 0), 0);

  const formattedDate = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <div className="sales-report">

      {/* ── Header ── */}
      <div className="sales-report-header">
        <h1>Sales Report <span className="report-date">— {formattedDate}</span></h1>
        <input
          type="text"
          className="report-search"
          placeholder="Search order #, customer, phone, table…"
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
      {!loading && !error && salesData && salesData.orders.length === 0 && (
        <div className="report-state">
          <div className="report-state-icon">📊</div>
          <p>No closed orders found for this date.</p>
        </div>
      )}

      {/* ── No search matches ── */}
      {!loading && !error && salesData && salesData.orders.length > 0 && filteredOrders.length === 0 && (
        <div className="report-state">
          <div className="report-state-icon">🔍</div>
          <p>No orders match "{search}".</p>
        </div>
      )}

      {/* ── Data ── */}
      {!loading && !error && salesData && salesData.orders.length > 0 && filteredOrders.length > 0 && (
        <>
          {/* ── Summary ── */}
          <div className="sales-summary">
            <div className="summary-breakdown">
              <div className="summary-item summary-item--credit">
                <div className="summary-label">Credit (Ledger)</div>
                <div className="summary-amount">₹{(salesData.credit || 0).toLocaleString('en-IN')}</div>
              </div>
              <div className="summary-item summary-item--card">
                <div className="summary-label">Card / QR / UPI</div>
                <div className="summary-amount">₹{(salesData.card || 0).toLocaleString('en-IN')}</div>
              </div>
              <div className="summary-item summary-item--cash">
                <div className="summary-label">Cash Collection</div>
                <div className="summary-amount">₹{(salesData.cash || 0).toLocaleString('en-IN')}</div>
              </div>
              <div className="summary-item summary-item--total">
                <div className="summary-label">Total Sales</div>
                <div className="summary-amount">₹{totalSales.toLocaleString('en-IN')}</div>
              </div>
            </div>
          </div>

          {/* ── Orders Table ── */}
          <div className="sales-orders">
            <div className="orders-section-label">
              Orders — {filteredOrders.length} closed
            </div>
            <div className="orders-table">
              <div className="table-header">
                <div className="col-id">#</div>
                <div className="col-time">Time</div>
                <div className="col-customer">Customer</div>
                <div className="col-payment">Payment</div>
                <div className="col-amount">Amount</div>
                <div className="col-action"></div>
              </div>

              {filteredOrders.map(order => (
                <div key={order.id} className="order-row">
                  <div
                    className={`table-row${expandedOrder === order.id ? ' table-row--expanded' : ''}`}
                    onClick={() => toggleOrder(order.id)}
                  >
                    <div className="col-id">#{order.id}</div>
                    <div className="col-time">
                      <div className="order-time">{order.time}</div>
                    </div>
                    <div className="col-customer">
                      {order.tableName && <div className="table-tag">Table {order.tableName}</div>}
                      <div className="customer-name">{order.customerName || 'Walk-in'}</div>
                      {order.customerPhone && (
                        <div className="customer-phone">{order.customerPhone}</div>
                      )}
                    </div>
                    <div className="col-payment">
                      <span className={`payment-badge payment-${(order.paymentMethod || 'CASH').toLowerCase()}`}>
                        {PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod}
                      </span>
                    </div>
                    <div className="col-amount">₹{(order.amount || 0).toLocaleString('en-IN')}</div>
                    <div className="col-action">
                      <span className="expand-chevron">{expandedOrder === order.id ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {expandedOrder === order.id && (
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
            </div>

            <div className="total-row">
              <span>Total Collected</span>
              <span>₹{totalOrders.toLocaleString('en-IN')}</span>
            </div>
          </div>
        </>
      )}

      {/* ── Cake Collections ── */}
      {!loading && !error && cakeData && (cakeData.transactions.length > 0 || cakeData.outstanding.balance_due > 0 || cakeData.booked.orders > 0) && (
        <div style={{ marginTop: 28 }}>
          <div className="orders-section-label">Cake Orders — Collections</div>

          <div className="sales-summary">
            <div className="summary-breakdown">
              <div className="summary-item summary-item--cash">
                <div className="summary-label">Advance Received ({cakeData.collections.advance.txns} txn)</div>
                <div className="summary-amount">₹{cakeData.collections.advance.amount.toLocaleString('en-IN')}</div>
              </div>
              <div className="summary-item summary-item--card">
                <div className="summary-label">Follow-up Received ({cakeData.collections.followup.txns} txn)</div>
                <div className="summary-amount">₹{cakeData.collections.followup.amount.toLocaleString('en-IN')}</div>
              </div>
              <div className="summary-item summary-item--total">
                <div className="summary-label">Total Cake Collections</div>
                <div className="summary-amount">₹{cakeData.collections.total.toLocaleString('en-IN')}</div>
              </div>
              <div className="summary-item summary-item--credit">
                <div className="summary-label">Delivered Revenue ({cakeData.delivered.orders})</div>
                <div className="summary-amount">₹{cakeData.delivered.revenue.toLocaleString('en-IN')}</div>
              </div>
            </div>
          </div>

          {/* Method breakdown + day stats */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '10px 0 16px', fontSize: 12 }}>
            {[...cakeData.collections.advance.methods.map(m => ({ ...m, t: 'Advance' })),
              ...cakeData.collections.followup.methods.map(m => ({ ...m, t: 'Follow-up' }))].map((m, i) => (
              <span key={i} style={{ padding: '3px 10px', borderRadius: 20, background: 'rgba(100,116,139,0.12)', color: '#475569', fontWeight: 600 }}>
                {m.t} · {PAYMENT_LABELS[m.method] || m.method}: ₹{m.amount.toLocaleString('en-IN')}
              </span>
            ))}
            <span style={{ padding: '3px 10px', borderRadius: 20, background: 'rgba(100,116,139,0.12)', color: '#475569', fontWeight: 600 }}>
              Booked: {cakeData.booked.orders} (₹{cakeData.booked.value.toLocaleString('en-IN')})
            </span>
            {cakeData.cancelled.orders > 0 && (
              <span style={{ padding: '3px 10px', borderRadius: 20, background: 'rgba(220,38,38,0.1)', color: '#b91c1c', fontWeight: 600 }}>
                Cancelled: {cakeData.cancelled.orders}
              </span>
            )}
            <span style={{ padding: '3px 10px', borderRadius: 20, background: 'rgba(217,119,6,0.12)', color: '#b45309', fontWeight: 600 }}>
              Balance Outstanding: ₹{cakeData.outstanding.balance_due.toLocaleString('en-IN')} ({cakeData.outstanding.orders} orders)
            </span>
            <span style={{ padding: '3px 10px', borderRadius: 20, background: 'rgba(217,119,6,0.12)', color: '#b45309', fontWeight: 600 }}>
              Advances Held (undelivered): ₹{cakeData.outstanding.advances_held.toLocaleString('en-IN')}
            </span>
          </div>

          {/* Transactions */}
          {cakeData.transactions.length > 0 && (
            <div className="sales-orders">
              <div className="orders-section-label">Cake Payments — {cakeData.transactions.length} transactions</div>
              <div style={{ border: '1px solid rgba(100,116,139,0.2)', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '70px 130px 1fr 100px 90px 110px', gap: 8, padding: '8px 14px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b', background: 'rgba(100,116,139,0.08)' }}>
                  <span>Time</span><span>Order</span><span>Customer</span><span>Type</span><span>Method</span><span style={{ textAlign: 'right' }}>Amount</span>
                </div>
                {cakeData.transactions.map(t => (
                  <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '70px 130px 1fr 100px 90px 110px', gap: 8, padding: '8px 14px', fontSize: 13, borderTop: '1px solid rgba(100,116,139,0.12)' }}>
                    <span>{t.time}</span>
                    <span>{t.order_number}</span>
                    <span>{t.customer_name}</span>
                    <span>{CAKE_TYPE_LABELS[t.type] || t.type}</span>
                    <span>{PAYMENT_LABELS[t.method] || t.method}</span>
                    <span style={{ textAlign: 'right', fontWeight: 700, color: t.amount < 0 ? '#b91c1c' : 'inherit' }}>
                      ₹{t.amount.toLocaleString('en-IN')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
