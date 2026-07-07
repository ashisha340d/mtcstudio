import { useMemo } from 'react';
import { usePOS } from '../../../context/POSContext';

function fmtDuration(ms) {
  if (!ms || ms <= 0) return null;
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
function fmtTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function TableButton({ table, onClick }) {
  const { tableOrderMap, orders, kotsByOrder, isOrderDelayed } = usePOS();
  const orderId = tableOrderMap[table.id];
  const order   = orderId ? orders[orderId] : null;

  const derived = useMemo(() => {
    if (!order) return null;
    const kots  = kotsByOrder[orderId] || [];
    const now   = Date.now();
    const allItems = kots.flatMap((k) => k.items || []);

    // Served ratio
    const total   = allItems.filter((i) => i.status !== 'CANCELLED').length;
    const served  = allItems.filter((i) => i.status === 'SERVED').length;

    // Last served time
    const servedAts = allItems
      .filter((i) => i.served_at)
      .map((i) => new Date(i.served_at).getTime());
    const lastServedMs = servedAts.length ? Math.max(...servedAts) : null;

    return {
      occupiedMs: now - new Date(order.created_at).getTime(),
      total,
      served,
      lastServed: lastServedMs ? fmtTime(new Date(lastServedMs).toISOString()) : null,
    };
  }, [order, kotsByOrder, orderId]);

  const delayed = orderId ? isOrderDelayed(orderId) : false;

  let cls = 'table-btn';
  if (!order)  cls += ' table-btn--empty';
  else         cls += ' table-btn--occupied';
  if (delayed) cls += ' table-btn--delayed';

  return (
    <button className={cls} onClick={() => onClick(table)}>
      <div className="table-btn__row1">
        <span className="table-btn__name">{table.name}</span>
        {order && (
          <span className="table-btn__total">
            ₹{(order.total_amount || 0).toFixed(0)}
          </span>
        )}
      </div>
      {derived ? (
        <div className="table-btn__meta">
          <span>{fmtDuration(derived.occupiedMs)}</span>
          <span>{derived.lastServed ? `↩ ${derived.lastServed}` : '—'}</span>
        </div>
      ) : (
        <div className="table-btn__meta">
          <span style={{ color: 'var(--text-3)' }}>{table.capacity}×</span>
        </div>
      )}
      {derived && (
        <span className="table-btn__ratio">
          {derived.served}/{derived.total}
        </span>
      )}
    </button>
  );
}
