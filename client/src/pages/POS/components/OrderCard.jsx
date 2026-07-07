import { useMemo } from 'react';
import { usePOS } from '../../../context/POSContext';
import { toUtcMs } from '../../../utils/dateTime';
import { printReceipt } from './ThermalReceipt';

function fmtDuration(ms) {
  if (!ms || ms <= 0) return '0m';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const TYPE_META = {
  TAKEAWAY: { label: 'Takeaway', cls: 'takeaway', icon: '🛍' },
  DELIVERY: { label: 'Delivery', cls: 'delivery', icon: '🚴' },
  CAKE_ORDER: { label: 'Cake Order', cls: 'cake', icon: '🎂' },
  QUICK_SALE: { label: 'Quick Sale', cls: 'quick', icon: '⚡' },
};

export default function OrderCard({ order, index, onClick, onDirectCheckout }) {
  const { kotsByOrder } = usePOS();

  const derived = useMemo(() => {
    const kots = kotsByOrder[order.id] || [];
    const allItems = kots.flatMap((k) => k.items || []);
    const total = allItems.filter((i) => i.status !== 'CANCELLED').length;
    const served = allItems.filter((i) => i.status === 'SERVED').length;
    return {
      occupiedMs: Date.now() - toUtcMs(order.created_at),
      total,
      served,
    };
  }, [order, kotsByOrder]);

  const meta = TYPE_META[order.order_type] || { label: order.order_type, cls: 'quick', icon: '📋' };
  const isDraft = order.status === 'SAVED';

  function onPrintSlip(e) {
    e.stopPropagation();
    const kots = kotsByOrder[order.id] || [];
    const items = kots.flatMap((k) => k.items || []).filter((i) => i.status !== 'CANCELLED');
    printReceipt({ order, items, payments: [] });
  }

  return (
    <div className={`oc oc--${meta.cls}${isDraft ? ' oc--draft' : ''}`} onClick={() => onClick(order)}>
      <div className="oc__header">
        <span className="oc__icon">{meta.icon}</span>
        <div>
          <div className="oc__type">
            {meta.label} #{index + 1}
            {isDraft && <span className="oc__draft-badge">DRAFT</span>}
          </div>
          <div className="oc__timer">{fmtDuration(derived.occupiedMs)} ago</div>
        </div>
      </div>

      {(order.customer_name || order.customer_phone) && (
        <div className="oc__customer">
          {order.customer_name && <span className="oc__cust-name">{order.customer_name}</span>}
          {order.customer_phone && <span className="oc__cust-phone">{order.customer_phone}</span>}
        </div>
      )}

      <div className="oc__amount">
        ₹{(order.total_amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
      </div>

      {derived.total > 0 && (
        <div className="oc__progress-row">
          <div className="oc__dots">
            {Array.from({ length: Math.min(derived.total, 8) }, (_, i) => (
              <span key={i} className={`oc__dot${i < derived.served ? ' oc__dot--served' : ''}`} />
            ))}
          </div>
          <span className="oc__ratio">{derived.served}/{derived.total} Served</span>
        </div>
      )}

      {isDraft ? (
        <button
          className="oc__checkout-btn oc__checkout-btn--draft"
          onClick={(e) => { e.stopPropagation(); onClick(order); }}
          style={{
            flex: 1, padding: '6px 8px', borderRadius: 7,
            border: '1px solid #c4b49c', background: 'rgba(255,255,255,0.65)',
            color: '#6b5640', fontSize: 10, fontWeight: 700, cursor: 'pointer',
            opacity: printing ? 0.6 : 1,
          }}

        >
          Open Draft →
        </button>
      ) : (
        <div className="oc__btn-row">
          <button onClick={onPrintSlip} title="Print slip"
            style={{
              flex: 1, padding: '6px 8px', borderRadius: 7, border: 'none',
              background: '#ffffff', color: '#000000', fontSize: 10, fontWeight: 800,
              cursor: 'pointer', letterSpacing: '0.03em',
            }}
          >
            🖨 Slip
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDirectCheckout(order.id); }} title='Direct Checkout'
            style={{
              flex: 1, padding: '6px 8px', borderRadius: 7, border: 'none',
              background: '#ff6624', color: '#fff', fontSize: 10, fontWeight: 800,
              cursor: 'pointer', letterSpacing: '0.03em',
            }}
          >
            💳 Pay
          </button>
        </div>
      )
      }
    </div >
  );
}
