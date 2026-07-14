import { useEffect, useMemo, useState } from 'react';
import { usePOS } from '../../../context/POSContext';
import { toUtcMs } from '../../../utils/dateTime';
import { printReceipt } from './ThermalReceipt';

function fmtDuration(ms) {
  if (!ms || ms <= 0) return null;
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function TableCard({ table, onClick, onDirectCheckout }) {
  const { tableOrderMap, orders, kotsByOrder, isOrderDelayed } = usePOS();
  const orderId = tableOrderMap[table.id];
  const order = orderId ? orders[orderId] : null;

  // Tick every minute so the elapsed-time timer advances on its own
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const derived = useMemo(() => {
    if (!order) return null;
    const kots = kotsByOrder[orderId] || [];
    const allItems = kots.flatMap((k) => k.items || []);
    const total = allItems.filter((i) => i.status !== 'CANCELLED').length;
    const served = allItems.filter((i) => i.status === 'SERVED').length;
    return {
      occupiedMs: Date.now() - toUtcMs(order.created_at),
      total,
      served,
    };
  }, [order, kotsByOrder, orderId, tick]);

  const delayed = orderId ? isOrderDelayed(orderId) : false;
  const isDraft = order?.status === 'SAVED';

  function onPrintSlip(e) {
    e.stopPropagation();
    const kots = kotsByOrder[orderId] || [];
    const items = kots.flatMap((k) => k.items || []).filter((i) => i.status !== 'CANCELLED');
    printReceipt({ order: { ...order, table_name: table.name }, items, payments: [] });
  }

  // Treat order as empty if no active KOT items and no draft cart items
  const hasContent = useMemo(() => {
    if (!order) return false;
    const kots = kotsByOrder[orderId] ?? [];
    if (kots.some(k => (k.items ?? []).some(i => i.status !== 'CANCELLED'))) return true;
    try { return order.draft_items && JSON.parse(order.draft_items).length > 0; } catch { return false; }
  }, [order, kotsByOrder, orderId]);

  // Empty table — desktop icon style
  if (!order || !hasContent) {
    return (
      <div className="tc tc--empty" onClick={() => onClick(table)}>
        <div className="tc__icon-empty">🪑</div>
        <div className="tc__name">{table.name}</div>
        <div className="tc__seats">{table.capacity} seats</div>
        <div className="tc__avail">Available</div>
      </div>
    );
  }

  // Occupied / Draft table
  return (
    <div
      className={`tc ${isDraft ? 'tc--draft' : 'tc--occupied'}${delayed ? ' tc--delayed' : ''}`}
      onClick={() => onClick(table)}
    >
      <div className="tc__header">
        <span className="tc__name">{table.name}</span>
        <span className="tc__timer">{fmtDuration(derived.occupiedMs)}</span>
      </div>

      <div className="tc__amount">
        ₹{(order.total_amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
      </div>

      {derived.total > 0 && (
        <div className="tc__progress-row">
          <div className="tc__dots">
            {Array.from({ length: Math.min(derived.total, 10) }, (_, i) => (
              <span
                key={i}
                className={`tc__dot${i < derived.served ? ' tc__dot--served' : ''}`}
              />
            ))}
            {derived.total > 10 && <span className="tc__dots-more">+{derived.total - 10}</span>}
          </div>
          <span className={`tc__ratio${derived.served === derived.total ? ' tc__ratio--all' : derived.served > 0 ? ' tc__ratio--partial' : ''}`}>
            {derived.served}/{derived.total} READY
          </span>
        </div>
      )}

      {isDraft ? (
        <button
          className="tc__checkout-btn"
          onClick={(e) => { e.stopPropagation(); onClick(table); }}
        >
          Open Draft →
        </button>
      ) : (
        <div>
          <button className="tc__slip-btn" onClick={onPrintSlip} title="Print slip"
            style={{
              flex: 1, padding: '6px 8px', borderRadius: 7, border: 'none',
              background: '#ffffff', color: '#000000', fontSize: 10, fontWeight: 800,
              cursor: 'pointer', letterSpacing: '0.03em',
            }}> 🖨 Slip
          </button>
          <button

            onClick={(e) => { e.stopPropagation(); onDirectCheckout(order.id); }}

            style={{
              flex: 1, padding: '6px 8px', borderRadius: 7, border: 'none',
              background: '#ee682f', color: '#fff', fontSize: 10, fontWeight: 800,
              cursor: 'pointer', letterSpacing: '0.03em',
            }}
          >
            💳 Pay

          </button>
        </div>
      )}
    </div>
  );
}
