import { useEffect, useMemo, useRef, useState } from 'react';
import { usePOS } from '../../../context/POSContext';
import { toUtcMs } from '../../../utils/dateTime';
import { printReceipt } from './ThermalReceipt';
import CustomerPickerModal from './CustomerPickerModal';
import DeliveryPartnerModal from './OrderTypeModal';
import { flyToCashStack } from './flyToCashStack';

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

const LONG_PRESS_MS = 550;

export default function OrderCard({ order, index, onClick, onDirectCheckout, closing = false }) {
  const { kotsByOrder, updateOrderFields } = usePOS();
  const cardRef = useRef(null);

  useEffect(() => {
    if (!closing || !cardRef.current) return;
    flyToCashStack(cardRef.current.getBoundingClientRect(), { amount: order.total_amount });
  }, [closing]);

  // Tick every minute so the elapsed-time timer advances
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const [editingCaption, setEditingCaption] = useState(false);
  const [captionDraft, setCaptionDraft] = useState('');
  const [showAssign, setShowAssign] = useState(false);
  const pressTimer = useRef(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, kotsByOrder, tick]);

  const meta = TYPE_META[order.order_type] || { label: order.order_type, cls: 'quick', icon: '📋' };
  const isDraft = order.status === 'SAVED';
  const captionLabel = order.order_caption || `${meta.label} #${index + 1}`;
  const isDelivery = order.order_type === 'DELIVERY';

  function onPrintSlip(e) {
    e.stopPropagation();
    const kots = kotsByOrder[order.id] || [];
    const items = kots.flatMap((k) => k.items || []).filter((i) => i.status !== 'CANCELLED');
    printReceipt({ order, items, payments: [] });
  }

  function startPress(e) {
    e.stopPropagation();
    pressTimer.current = setTimeout(() => {
      setCaptionDraft(order.order_caption || '');
      setEditingCaption(true);
    }, LONG_PRESS_MS);
  }
  function cancelPress() {
    clearTimeout(pressTimer.current);
  }

  function commitCaption() {
    setEditingCaption(false);
    const trimmed = captionDraft.trim();
    if (trimmed !== (order.order_caption || '')) {
      updateOrderFields(order.id, { order_caption: trimmed || null });
    }
  }

  return (
    <div ref={cardRef} className={`oc oc--${meta.cls}${isDraft ? ' oc--draft' : ''}${closing ? ' tc--wiping' : ''}`}
      onClick={closing ? undefined : () => onClick(order)}>
      <button
        className="oc__assign-btn"
        title={order.customer_phone ? 'Change customer' : 'Add customer'}
        onClick={(e) => { e.stopPropagation(); setShowAssign(true); }}
      >
        {order.customer_phone ? '✎' : '＋'}
      </button>
      {order.order_notes && (
        <span className="oc__notes-icon" title={order.order_notes}>✉︎</span>
      )}

      <div className="oc__header">
        <span className="oc__icon">{meta.icon}</span>
        <div className="oc__header-text">
          {editingCaption ? (
            <input
              className="oc__caption-input"
              autoFocus
              value={captionDraft}
              onChange={(e) => setCaptionDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={commitCaption}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') setEditingCaption(false);
              }}
            />
          ) : (
            <div
              className="oc__type"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={startPress}
              onMouseUp={cancelPress}
              onMouseLeave={cancelPress}
              onTouchStart={startPress}
              onTouchEnd={cancelPress}
            >
              {captionLabel}
              {isDraft && <span className="oc__draft-badge">DRAFT</span>}
            </div>
          )}
          <div className="oc__timer">{fmtDuration(derived.occupiedMs)} ago</div>
        </div>
      </div>

      <div className="oc__customer">
        <span className="oc__cust-name">{order.customer_name || '—'}</span>
        <span className="oc__cust-phone">{order.customer_phone || '—'}</span>
      </div>

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

      {showAssign && (
        isDelivery ? (
          <DeliveryPartnerModal
            initialName={order.customer_name || ''}
            initialPhone={order.customer_phone || ''}
            initialNotes={order.order_notes || ''}
            confirmLabel="Save"
            onConfirm={({ customerName, customerPhone, orderNotes }) => {
              updateOrderFields(order.id, { customer_name: customerName, customer_phone: customerPhone, order_notes: orderNotes });
              setShowAssign(false);
            }}
            onClose={() => setShowAssign(false)}
          />
        ) : (
          <CustomerPickerModal
            title={order.customer_phone ? '✎ Change Customer' : '＋ Add Customer'}
            onSelect={(c) => updateOrderFields(order.id, { customer_name: c.name, customer_phone: c.phone })}
            onClose={() => setShowAssign(false)}
          />
        )
      )}
      {closing && (
        <>
          <div className="tc__wipe-sweep" />
          <div className="tc__paid-stamp"><span>PAID ✓</span></div>
        </>
      )}
    </div >
  );
}
