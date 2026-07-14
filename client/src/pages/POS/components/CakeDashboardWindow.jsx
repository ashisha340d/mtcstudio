import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import '../pos.css';

const API = import.meta.env.VITE_API_URL || '/api';
const H = { 'Content-Type': 'application/json', 'X-Session-ID': 'dev-session' };

const fmtMoney = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—';

const STATUS_META = {
  INQUIRY: { label: 'Inquiry', color: '#6b7280' },
  CONFIRMED: { label: 'Confirmed', color: '#a16207' },
  IN_PRODUCTION: { label: 'In Production', color: '#d97706' },
  READY: { label: 'Ready', color: '#16a34a' },
  DELIVERED: { label: 'Delivered', color: '#2d7a2d' },
  CANCELLED: { label: 'Cancelled', color: '#c0392b' },
};

const PAYMENT_METHODS = [
  ['CASH', '💵 Cash'],
  ['CARD', '💳 Card'],
  ['QR', '📱 QR'],
  ['WALLET', '👛 Wallet'],
];
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const PAY_TYPE_LABEL = { ADVANCE: 'Advance', REGULAR: 'Follow-up' };

const TABS = [
  { key: 'unpaid', label: "Today's Orders" },
  { key: 'delivery', label: 'Delivery Today' },
  { key: 'total', label: 'Total Orders' },
];

// ── Status badge ──────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const m = STATUS_META[status] ?? { label: status, color: '#6b7280' };
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase',
      padding: '2px 7px', borderRadius: 20,
      background: m.color + '18', color: m.color, border: `1px solid ${m.color}33`,
      whiteSpace: 'nowrap',
    }}>{m.label}</span>
  );
}

// ── Payment Modal ─────────────────────────────────────────────────────
function CakePaymentModal({ order, onClose, onSuccess }) {
  const balanceDue = round2(Math.max(0, order.balance_due ?? 0));
  const [amounts, setAmounts] = useState({ CASH: String(balanceDue || ''), CARD: '', QR: '', WALLET: '' });
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch(`${API}/pos/cake-orders/${order.id}/payments`, { headers: H })
      .then(r => r.ok ? r.json() : [])
      .then(setHistory)
      .catch(() => { });
  }, [order.id]);

  const tenders = PAYMENT_METHODS
    .map(([m]) => ({ method: m, amount: round2(amounts[m]) }))
    .filter(t => t.amount > 0);
  const total = round2(tenders.reduce((s, t) => s + t.amount, 0));
  const remaining = round2(Math.max(0, balanceDue - total));
  const overpays = total > balanceDue + 0.005;
  const valid = total > 0 && !overpays;

  async function confirm() {
    if (!valid) { setErr(overpays ? 'Amount exceeds balance due' : 'Enter a valid amount'); return; }
    setLoading(true);
    setErr('');
    try {
      const r = await fetch(`${API}/pos/cake-orders/${order.id}/payment`, {
        method: 'PATCH',
        headers: H,
        body: JSON.stringify({ payments: tenders }),
      });
      if (!r.ok) { const d = await r.json(); setErr(d.error || 'Payment failed'); return; }
      onSuccess();
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fdf9f4', borderRadius: 14, padding: '24px 28px', width: 360,
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)', border: '1px solid #c4b49c',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#2a1f12' }}>💳 Record Payment</div>
            <div style={{ fontSize: 11, color: '#9c8870', marginTop: 2 }}>
              {order.order_number} · {order.customer_name}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#9c8870', lineHeight: 1 }}>✕</button>
        </div>

        {/* Summary */}
        <div style={{ background: '#f0e8d8', borderRadius: 8, padding: '10px 14px', marginBottom: 18, fontSize: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: '#6b5640' }}>Total Amount</span>
            <span style={{ fontWeight: 700 }}>{fmtMoney(order.total_amount)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: '#6b5640' }}>Advance Paid</span>
            <span style={{ fontWeight: 700, color: '#2d7a2d' }}>{fmtMoney(order.advance_paid)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #c4b49c', paddingTop: 6, marginTop: 4 }}>
            <span style={{ color: '#c0392b', fontWeight: 700 }}>Balance Due</span>
            <span style={{ color: '#c0392b', fontWeight: 800, fontSize: 14 }}>{fmtMoney(order.balance_due)}</span>
          </div>
        </div>

        {/* Split tender — amount per method */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#6b5640', display: 'block', marginBottom: 6 }}>
            PAYMENT — SPLIT ACROSS METHODS
          </label>
          {PAYMENT_METHODS.map(([m, label], i) => (
            <div key={m} style={{ display: 'grid', gridTemplateColumns: '86px 1fr', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#6b5640' }}>{label}</span>
              <input
                type="number" min="0" step="0.01"
                value={amounts[m]}
                autoFocus={i === 0}
                onChange={e => setAmounts(prev => ({ ...prev, [m]: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && confirm()}
                onFocus={e => e.target.select()}
                placeholder="0.00"
                style={{
                  width: '100%', padding: '7px 12px', borderRadius: 7, fontSize: 16,
                  fontWeight: 800, border: '1.5px solid #c4b49c', background: '#fff',
                  color: '#2a1f12', textAlign: 'right', boxSizing: 'border-box', outline: 'none',
                }}
              />
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 8 }}>
            <span style={{ color: '#6b5640' }}>Total Entered</span>
            <span style={{ fontWeight: 800, color: overpays ? '#c0392b' : '#2a1f12' }}>{fmtMoney(total)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: '#6b5640' }}>Remaining After</span>
            <span style={{ fontWeight: 800, color: remaining > 0 ? '#c0392b' : '#2d7a2d' }}>{fmtMoney(remaining)}</span>
          </div>
          {overpays && (
            <div style={{ color: '#c0392b', fontSize: 11, fontWeight: 600, marginTop: 4 }}>Cannot exceed balance due</div>
          )}
        </div>

        {/* Payment history — advance + follow-ups so far */}
        {history.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#6b5640', display: 'block', marginBottom: 6 }}>
              PAYMENTS SO FAR
            </label>
            <div style={{ maxHeight: 110, overflowY: 'auto', border: '1px solid #e3d5be', borderRadius: 7 }}>
              {history.map(p => (
                <div key={p.id} style={{
                  display: 'flex', justifyContent: 'space-between', gap: 8,
                  padding: '5px 10px', fontSize: 11, borderBottom: '1px solid #f0e8d8',
                }}>
                  <span style={{ color: '#6b5640' }}>
                    {p.amount < 0 ? 'Reversal' : (PAY_TYPE_LABEL[p.payment_type] || p.payment_type)} · {p.method}
                    <span style={{ color: '#9c8870', marginLeft: 6 }}>
                      {new Date(String(p.created_at).replace(' ', 'T') + '+05:45').toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </span>
                  <span style={{ fontWeight: 700, color: p.amount < 0 ? '#c0392b' : '#2d7a2d' }}>{fmtMoney(p.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {err && (
          <div style={{ color: '#c0392b', fontSize: 11, marginBottom: 10, fontWeight: 600 }}>{err}</div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: '10px', borderRadius: 8, border: '1px solid #c4b49c',
              background: 'rgba(255,255,255,0.6)', color: '#6b5640', fontWeight: 700, cursor: 'pointer', fontSize: 12,
            }}
          >Cancel</button>
          <button
            onClick={confirm}
            disabled={loading || !valid}
            style={{
              flex: 2, padding: '10px', borderRadius: 8, border: 'none',
              background: '#c1440e', color: '#fff', fontWeight: 800, cursor: 'pointer',
              fontSize: 12, opacity: (loading || !valid) ? 0.65 : 1,
            }}
          >{loading ? 'Processing…' : `Confirm ${fmtMoney(total)}`}</button>
        </div>
      </div>
    </div>
  );
}

// ── Cake Dash Card ────────────────────────────────────────────────────
function CakeDashCard({ order, onPay, onRefresh, onOpen = null }) {
  const navigate = useNavigate();
  const [printing, setPrinting] = useState(false);
  const openOrder = () => (onOpen ? onOpen(order.id) : navigate(`/pos/cake/${order.id}`));

  async function printSlip(e) {
    e.stopPropagation();
    if (printing) return;
    setPrinting(true);
    try {
      const r = await fetch(`${API}/pos/cake-orders/${order.id}/print`, { method: 'POST', headers: H });
      if (!r.ok) { const d = await r.json(); alert(d.error || 'Print failed'); }
      else onRefresh?.();
    } catch (err) { alert(err.message); }
    finally { setPrinting(false); }
  }

  const hasBalance = (order.balance_due ?? 0) > 0;

  return (
    <div
      className="tc"
      style={{ minHeight: 210, cursor: 'pointer' }}
      onClick={openOrder}
    >
      {/* Order # + Status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: '#c1440e', letterSpacing: '0.05em' }}>
          {order.order_number}
        </span>
        <StatusBadge status={order.status} />
      </div>

      {/* Customer name */}
      <div style={{ fontSize: 14, fontWeight: 800, color: '#2a1f12', marginBottom: 4, lineHeight: 1.2 }}>
        {order.customer_name}
      </div>

      {/* Phone */}
      {order.phone && (
        <div style={{ fontSize: 10, color: '#9c8870', marginBottom: 5 }}>{order.phone}</div>
      )}

      {/* Message on cake */}
      {order.message_on_cake && (
        <div style={{
          fontSize: 10, color: '#9c8870', fontStyle: 'italic', marginBottom: 7,
          lineHeight: 1.3, overflow: 'hidden',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>
          "{order.message_on_cake}"
        </div>
      )}

      {/* Delivery date + time */}
      <div style={{ display: 'flex', gap: 5, marginBottom: 6, flexWrap: 'wrap' }}>
        {order.delivery_date && (
          <span style={{
            fontSize: 10, fontWeight: 700, color: '#6b5640',
            background: '#f0e8d8', borderRadius: 5, padding: '2px 7px',
          }}>
            📅 {fmtDate(order.delivery_date)}
          </span>
        )}
        {order.delivery_time && (
          <span style={{
            fontSize: 10, fontWeight: 700, color: '#6b5640',
            background: '#f0e8d8', borderRadius: 5, padding: '2px 7px',
          }}>
            🕐 {order.delivery_time}
          </span>
        )}
      </div>

      <div style={{ flex: 1 }} />

      {/* Balance */}
      <div style={{
        fontSize: 15, fontWeight: 800, marginBottom: 10,
        color: hasBalance ? '#c0392b' : '#2d7a2d',
      }}>
        {hasBalance ? `${fmtMoney(order.balance_due)} due` : '✓ Paid'}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
        {hasBalance && (
          <button
            onClick={(e) => { e.stopPropagation(); onPay(order); }}
            style={{
              flex: 1, padding: '6px 8px', borderRadius: 7, border: 'none',
              background: '#c1440e', color: '#fff', fontSize: 10, fontWeight: 800,
              cursor: 'pointer', letterSpacing: '0.03em',
            }}
          >💳 Pay</button>
        )}
        <button
          onClick={printSlip}
          disabled={printing}
          style={{
            flex: 1, padding: '6px 8px', borderRadius: 7,
            border: '1px solid #c4b49c', background: 'rgba(255,255,255,0.65)',
            color: '#6b5640', fontSize: 10, fontWeight: 700, cursor: 'pointer',
            opacity: printing ? 0.6 : 1,
          }}
        >{printing ? '…' : '🖨 Slip'}</button>

      </div>
    </div>
  );
}

// In-memory cache — later mounts paint instantly, refresh happens silently
let cakeCache = null; // { today, delivery }

// ── Main: Cake Dashboard Window ───────────────────────────────────────
export default function CakeDashboardWindow({ onOpenOrder = null, refreshToken = 0 }) {
  const [tab, setTab] = useState('unpaid');
  const [todayOrders, setTodayOrders] = useState(() => cakeCache?.today ?? []);
  const [deliveryOrders, setDeliveryOrders] = useState(() => cakeCache?.delivery ?? []);
  const [loading, setLoading] = useState(false);
  const [payTarget, setPayTarget] = useState(null);

  const load = useCallback(async () => {
    if (!cakeCache) setLoading(true);
    try {
      const [todayR, delivR] = await Promise.all([
        fetch(`${API}/pos/cake-orders?filter=today`, { headers: H }),
        fetch(`${API}/pos/cake-orders?filter=delivery_today`, { headers: H }),
      ]);
      const today = todayR.ok ? await todayR.json() : [];
      const delivery = delivR.ok ? await delivR.json() : [];
      cakeCache = { today, delivery };
      setTodayOrders(today);
      setDeliveryOrders(delivery);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load, refreshToken]);

  // Derive per-tab lists
  const unpaidOrders = todayOrders.filter(
    o => (o.balance_due ?? 0) > 0 && !['DELIVERED', 'CANCELLED'].includes(o.status)
  );
  const totalOrders = [...todayOrders, ...deliveryOrders].reduce((acc, o) => {
    if (!acc.find(x => x.id === o.id)) acc.push(o);
    return acc;
  }, []);

  const visibleOrders =
    tab === 'unpaid' ? unpaidOrders :
      tab === 'delivery' ? deliveryOrders :
        totalOrders;

  const tabCounts = {
    unpaid: unpaidOrders.length,
    delivery: deliveryOrders.length,
    total: totalOrders.length,
  };

  const outstandingBalance = unpaidOrders.reduce((s, o) => s + (o.balance_due ?? 0), 0);

  function onPaySuccess() {
    setPayTarget(null);
    load();
  }

  // No cake orders today — hide the window entirely
  if (!loading && totalOrders.length === 0) return null;

  return (
    <>
      <div className="desktop-window">
        {/* Chrome */}
        <div className="desktop-chrome">
          <div className="desktop-chrome__dots">
            <div className="win-dot win-dot--close" />
            <div className="win-dot win-dot--min" />
            <div className="win-dot win-dot--max" />
          </div>
          <span className="desktop-chrome__title">🎂  Cake Orders</span>
          {outstandingBalance > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 800, color: '#c0392b',
              background: 'rgba(192,57,43,0.12)', padding: '2px 9px',
              borderRadius: 20, border: '1px solid rgba(192,57,43,0.25)',
            }}>
              {fmtMoney(outstandingBalance)} outstanding
            </span>
          )}
          <span className="desktop-chrome__count">
            {totalOrders.length} today
          </span>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #c4b49c', background: '#f5ece0', padding: '0 16px' }}>
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: '8px 14px', fontSize: 11, fontWeight: 700, border: 'none',
                borderBottom: tab === t.key ? '2px solid #c1440e' : '2px solid transparent',
                background: 'none', color: tab === t.key ? '#c1440e' : '#9c8870',
                cursor: 'pointer', letterSpacing: '0.02em',
                display: 'flex', alignItems: 'center', gap: 5, transition: 'color 0.12s',
              }}
            >
              {t.label}
              {tabCounts[t.key] > 0 && (
                <span style={{
                  fontSize: 9, fontWeight: 900, borderRadius: 20, padding: '1px 5px', minWidth: 14,
                  textAlign: 'center', color: '#fff',
                  background: tab === t.key ? '#c1440e' : '#9c8870',
                }}>{tabCounts[t.key]}</span>
              )}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="desktop-window__body">
          {loading && (
            <div style={{ textAlign: 'center', padding: '20px 0', color: '#9c8870', fontSize: 12 }}>Loading…</div>
          )}
          {!loading && visibleOrders.length === 0 && (
            <div className="pos-empty-state">
              {tab === 'unpaid'
                ? 'No unpaid cake orders for today.'
                : tab === 'delivery'
                  ? 'No deliveries scheduled for today.'
                  : 'No cake orders found for today.'}
            </div>
          )}
          {!loading && visibleOrders.length > 0 && (
            <div className="table-card-grid">
              {visibleOrders.map(o => (
                <CakeDashCard
                  key={o.id}
                  order={o}
                  onPay={setPayTarget}
                  onRefresh={load}
                  onOpen={onOpenOrder}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {payTarget && (
        <CakePaymentModal
          order={payTarget}
          onClose={() => setPayTarget(null)}
          onSuccess={onPaySuccess}
        />
      )}
    </>
  );
}
