import { useMemo } from 'react';
import { tapLight } from '../lib/haptics';
import MotionArt from './MotionArt';
import Icon from './Icon';

const fmt = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

const TYPE_LABEL = {
  TAKEAWAY: 'Take away',
  DELIVERY: 'Delivery',
  DINE_IN:  'Dine in',
};

function when(ts) {
  if (!ts) return '';
  const d = new Date(ts.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

// Everything that isn't a table: take-away + delivery in flight, plus the
// scheduled/draft queue out of pos_scheduled_orders. Sits after the floor.
export default function OpenOrders({ activeOrders, scheduled, loading, onOpen }) {
  const live = useMemo(
    () => (activeOrders.orders || [])
      .filter(o => o.order_type !== 'DINE_IN' && !['CLOSED', 'CANCELLED'].includes(o.status))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    [activeOrders]
  );

  const queued = useMemo(
    () => (scheduled || []).filter(s => !['CONVERTED', 'CANCELLED'].includes(s.status)),
    [scheduled]
  );

  if (loading) return <SkeletonCards n={4} />;

  if (!live.length && !queued.length) return (
    <div className="w-empty">
      <MotionArt kind="orders" size={86} />
      <div className="w-empty-title">No open orders</div>
      <div className="w-empty-sub">Take-away, delivery, scheduled and draft orders land here.</div>
    </div>
  );

  return (
    <div className="w-oo">
      {live.length > 0 && <div className="w-group-label">In flight<span>{live.length}</span></div>}
      {live.map(o => (
        <button key={o.id} className="w-oo-card w-ripple" onClick={() => { tapLight(); onOpen?.(o); }}>
          <span className="w-oo-top">
            <span className="w-oo-type">{TYPE_LABEL[o.order_type] || o.order_type}</span>
            <span className="w-oo-amt">{fmt(o.total_amount)}</span>
          </span>
          <span className="w-oo-name">{o.customer_name || `Order #${o.id}`}</span>
          <span className="w-oo-sub">
            {o.customer_phone ? `${o.customer_phone} · ` : ''}{when(o.created_at)}
            {o.bill_requested_at && <span className="w-oo-flag"><Icon name="receipt" size={13} />bill asked</span>}
          </span>
        </button>
      ))}

      {queued.length > 0 && <div className="w-group-label">Scheduled &amp; drafts<span>{queued.length}</span></div>}
      {queued.map(s => (
        <button key={`s${s.id}`} className="w-oo-card w-ripple is-queued" onClick={() => { tapLight(); onOpen?.(s, true); }}>
          <span className="w-oo-top">
            <span className="w-oo-type">{s.kind === 'SCHEDULED' ? 'Scheduled' : 'Draft'}</span>
            <span className="w-oo-amt">{fmt(s.total_amount)}</span>
          </span>
          <span className="w-oo-name">{s.customer_name || `#${s.id}`}</span>
          <span className="w-oo-sub">
            {s.kind === 'SCHEDULED' && s.scheduled_for ? `for ${when(s.scheduled_for)}` : 'no time set'}
            {s.customer_phone ? ` · ${s.customer_phone}` : ''}
          </span>
        </button>
      ))}
    </div>
  );
}

function SkeletonCards({ n }) {
  return (
    <div className="w-oo">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="w-oo-card is-skeleton">
          <span className="w-sk w-sk-line short" />
          <span className="w-sk w-sk-line" />
        </div>
      ))}
    </div>
  );
}
