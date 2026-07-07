import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { STATUS_META } from './components/StatusTimeline';
import '../POS/pos.css';
import './cake.css';

const API = import.meta.env.VITE_API_URL || '/api';
const H   = { 'Content-Type': 'application/json', 'X-Session-ID': 'dev-session' };

const fmtMoney = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtDate  = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

function StatusBadge({ status }) {
  const m = STATUS_META[status] ?? { label: status, color: '#6b7280' };
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
      padding: '3px 9px', borderRadius: 20,
      background: m.color + '1a', color: m.color, border: `1px solid ${m.color}44`,
      whiteSpace: 'nowrap',
    }}>{m.label}</span>
  );
}

const TABS = [
  { key: 'production', label: '🎂 Today Production', filter: 'today' },
  { key: 'delivery',   label: '🚀 Delivery Today',   filter: 'delivery_today' },
  { key: 'all',        label: '📋 All Orders',       filter: 'all' },
];

export default function CakeOrders() {
  const navigate = useNavigate();
  const [tab,     setTab]     = useState('production');
  const [orders,  setOrders]  = useState([]);
  const [search,  setSearch]  = useState('');
  const [loading, setLoading] = useState(false);
  const [stats,   setStats]   = useState({ today: 0, delivery: 0, balance: 0 });
  const [printing, setPrinting] = useState(null);

  const currentTab = TABS.find(t => t.key === tab);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (currentTab?.filter !== 'all') params.set('filter', currentTab?.filter ?? '');
      if (search.trim()) params.set('q', search.trim());
      const r = await fetch(`${API}/pos/cake-orders?${params}`, { headers: H });
      if (r.ok) setOrders(await r.json());
    } finally { setLoading(false); }
  }, [tab, search]); // eslint-disable-line

  // Stats
  const loadStats = useCallback(async () => {
    try {
      const [todayR, deliveryR, allR] = await Promise.all([
        fetch(`${API}/pos/cake-orders?filter=today`, { headers: H }),
        fetch(`${API}/pos/cake-orders?filter=delivery_today`, { headers: H }),
        fetch(`${API}/pos/cake-orders`, { headers: H }),
      ]);
      const today    = todayR.ok    ? await todayR.json()    : [];
      const delivery = deliveryR.ok ? await deliveryR.json() : [];
      const all      = allR.ok      ? await allR.json()      : [];
      const balance  = all.filter(o => !['DELIVERED','CANCELLED'].includes(o.status))
                         .reduce((s, o) => s + (o.balance_due || 0), 0);
      setStats({ today: today.length, delivery: delivery.length, balance });
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadStats(); }, [loadStats]);

  async function printSlip(e, id) {
    e.stopPropagation();
    if (printing) return;
    setPrinting(id);
    try {
      const r = await fetch(`${API}/pos/cake-orders/${id}/print`, { method: 'POST', headers: H });
      if (!r.ok) { const d = await r.json(); alert(d.error || 'Print failed'); }
    } catch (err) { alert(err.message); }
    finally { setPrinting(null); }
  }

  const cols_production = ['Order #','Customer','Phone','Delivery','Time','Flavour','Size','Status','Advance','Balance'];
  const cols_delivery   = ['Order #','Customer','Time','Cake Details','Status',''];

  return (
    <div className="cake-root">
      {/* Header */}
      <div className="cake-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="cake-back-btn" onClick={() => navigate('/pos')}>← Back</button>
          <div>
            <h1 className="cake-title">🎂 Cake Orders</h1>
            <p className="cake-subtitle">Production · Delivery · Management</p>
          </div>
        </div>
        <button className="cake-btn-primary" onClick={() => navigate('/pos/cake/new')}>
          + New Cake Order
        </button>
      </div>

      {/* Stats row */}
      <div className="cake-stats-row">
        <div className="cake-stat-card">
          <div className="cake-stat-icon">🎂</div>
          <div>
            <div className="cake-stat-val">{stats.today}</div>
            <div className="cake-stat-lbl">Today's Orders</div>
          </div>
        </div>
        <div className="cake-stat-card">
          <div className="cake-stat-icon">🚀</div>
          <div>
            <div className="cake-stat-val">{stats.delivery}</div>
            <div className="cake-stat-lbl">Delivering Today</div>
          </div>
        </div>
        <div className="cake-stat-card">
          <div className="cake-stat-icon">💰</div>
          <div>
            <div className="cake-stat-val">{fmtMoney(stats.balance)}</div>
            <div className="cake-stat-lbl">Outstanding Balance</div>
          </div>
        </div>
      </div>

      {/* Tabs + search */}
      <div className="cake-tab-bar">
        <div style={{ display: 'flex', gap: 4 }}>
          {TABS.map(t => (
            <button key={t.key}
              className={`cake-tab${tab === t.key ? ' cake-tab--active' : ''}`}
              onClick={() => setTab(t.key)}
            >{t.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search by name, phone, order #…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="cake-search-input"
          />
        </div>
      </div>

      {/* Table */}
      <div className="cake-table-wrap">
        {loading && <div className="cake-loading">Loading…</div>}
        {!loading && orders.length === 0 && (
          <div className="cake-empty">No orders found.</div>
        )}
        {!loading && orders.length > 0 && (
          <table className="cake-table">
            <thead>
              <tr>
                {(tab === 'delivery' ? cols_delivery : cols_production).map(c => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id} className="cake-row" onClick={() => navigate(`/pos/cake/${o.id}`)}>
                  {tab === 'delivery' ? (
                    <>
                      <td><span className="cake-order-num">{o.order_number}</span></td>
                      <td>
                        <div style={{ fontWeight: 700, color: '#2a1f12' }}>{o.customer_name}</div>
                        <div style={{ fontSize: 11, color: '#9c8870' }}>{o.phone}</div>
                      </td>
                      <td style={{ fontWeight: 700, color: '#c1440e' }}>{o.delivery_time || '—'}</td>
                      <td>
                        <div style={{ fontSize: 12 }}>
                          {[o.flavour, o.size && `${o.size}`, o.quantity > 1 && `×${o.quantity}`].filter(Boolean).join(' · ')}
                        </div>
                        {o.cream_tags?.length > 0 && (
                          <div style={{ fontSize: 11, color: '#6b5640' }}>{o.cream_tags.join(', ')}</div>
                        )}
                      </td>
                      <td><StatusBadge status={o.status} /></td>
                      <td>
                        <button className="cake-print-btn"
                          onClick={e => printSlip(e, o.id)}
                          disabled={printing === o.id}
                        >{printing === o.id ? '…' : '🖨 Slip'}</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td><span className="cake-order-num">{o.order_number}</span></td>
                      <td>
                        <div style={{ fontWeight: 700, color: '#2a1f12' }}>{o.customer_name}</div>
                      </td>
                      <td style={{ fontSize: 12, color: '#6b5640' }}>{o.phone || '—'}</td>
                      <td style={{ fontWeight: 600, color: '#c1440e' }}>{fmtDate(o.delivery_date)}</td>
                      <td style={{ fontSize: 12 }}>{o.delivery_time || '—'}</td>
                      <td style={{ fontSize: 12 }}>{o.flavour || '—'}</td>
                      <td style={{ fontSize: 12 }}>{o.size || '—'}</td>
                      <td><StatusBadge status={o.status} /></td>
                      <td style={{ textAlign: 'right', color: '#2d7a2d', fontWeight: 700 }}>{fmtMoney(o.advance_paid)}</td>
                      <td style={{ textAlign: 'right', color: o.balance_due > 0 ? '#c0392b' : '#2d7a2d', fontWeight: 700 }}>{fmtMoney(o.balance_due)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
