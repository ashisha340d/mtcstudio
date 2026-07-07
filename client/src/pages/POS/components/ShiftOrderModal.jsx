import { useMemo, useState } from 'react';
import { usePOS, ORDER_TYPE } from '../../../context/POSContext';

const TYPE_META = {
  DINE_IN: { label: 'Dine In', icon: '🍽' },
  TAKEAWAY: { label: 'Takeaway', icon: '🛍' },
  DELIVERY: { label: 'Delivery', icon: '🚴' },
  QUICK_SALE: { label: 'Quick Sale', icon: '⚡' },
};

/**
 * Shift (reassign) an order to a different table, or remove it from a table.
 * Works across any order type (dine-in, takeaway, delivery, quick) — never cake.
 * Shifting to a table changes order_type to DINE_IN.
 * Shifting away from a table removes the table_id.
 */

export default function ShiftOrderModal({ onClose, onShifted }) {
  const { tables, orders, kotsByOrder, shiftOrder, loading, notify } = usePOS();

  const [sourceId, setSourceId] = useState(null);
  const [targetTableId, setTargetTableId] = useState(null);
  const [error, setError] = useState(null);

  function hasContent(o) {
    const kots = kotsByOrder[o.id] ?? [];
    if (kots.some((k) => (k.items ?? []).some((i) => i.status !== 'CANCELLED'))) return true;
    try { return o.draft_items && JSON.parse(o.draft_items).length > 0; } catch { return false; }
  }

  // All shiftable orders (every type except cake)
  const shiftableOrders = useMemo(() => {
    const list = [];
    Object.values(orders).forEach((o) => {
      if (o.order_type === ORDER_TYPE.CAKE_ORDER) return; // skip cakes
      if (o.status !== 'OPEN' && o.status !== 'SAVED') return; // skip closed/cancelled
      if (!hasContent(o)) return; // skip empty

      const kots = kotsByOrder[o.id] || [];
      const items = kots.flatMap((k) => k.items || []).filter((i) => i.status !== 'CANCELLED');
      const meta = TYPE_META[o.order_type];

      let title = '';
      if (o.order_type === ORDER_TYPE.DINE_IN) {
        const table = tables.find((t) => t.id === o.table_id);
        title = table ? table.name : `Table ${o.table_id}`;
      } else {
        title = o.customer_name || meta.label;
      }

      list.push({
        id: o.id,
        orderId: o.id,
        order: o,
        meta,
        title,
        items,
        tableId: o.table_id,
      });
    });
    return list.sort((a, b) => {
      // Tables first (by sort order), then others (by order id)
      if (a.order.order_type === ORDER_TYPE.DINE_IN && b.order.order_type !== ORDER_TYPE.DINE_IN) return -1;
      if (a.order.order_type !== ORDER_TYPE.DINE_IN && b.order.order_type === ORDER_TYPE.DINE_IN) return 1;
      if (a.order.order_type === ORDER_TYPE.DINE_IN && b.order.order_type === ORDER_TYPE.DINE_IN) {
        const tA = tables.find((t) => t.id === a.tableId);
        const tB = tables.find((t) => t.id === b.tableId);
        return (tA?.sort_order ?? 0) - (tB?.sort_order ?? 0);
      }
      return a.id - b.id;
    });
  }, [orders, kotsByOrder, tables]);

  // Occupied tables (have OPEN orders)
  const occupiedTableIds = useMemo(() => {
    const set = new Set();
    Object.values(orders).forEach((o) => {
      if (o.order_type === ORDER_TYPE.DINE_IN && o.status === 'OPEN' && o.table_id) {
        set.add(o.table_id);
      }
    });
    return set;
  }, [orders]);

  // Only unoccupied tables
  const availableTables = useMemo(() => {
    return [...tables]
      .filter((t) => !occupiedTableIds.has(t.id))
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [tables, occupiedTableIds]);

  const source = shiftableOrders.find((o) => o.id === sourceId) || null;
  const targetTable = availableTables.find((t) => t.id === targetTableId) || null;
  const canShift = source && targetTableId !== null && !loading;

  async function handleShift() {
    if (!canShift) return;
    setError(null);
    try {
      await shiftOrder({ orderId: source.orderId, targetTableId });
      notify?.('success', `Shifted ${source.meta.icon} ${source.title} → ${targetTable.name}`);
      onShifted?.();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Shift failed');
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal shift-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="modal__title">↔ Shift Order</span>

        <p className="shift-hint">
          Select an <strong>order</strong> and an <strong>unoccupied table</strong>. The order is reassigned
          to that table (order_type becomes dine-in). Works across all order types except cake.
        </p>

        <div className="shift-cols">
          {/* SOURCE ORDERS */}
          <div className="shift-col">
            <span className="modal__label">① Order to Shift</span>
            <div className="shift-list">
              {shiftableOrders.length === 0 && (
                <div className="shift-empty">No shiftable orders.</div>
              )}
              {shiftableOrders.map((o) => {
                const isSel = o.id === sourceId;
                return (
                  <button
                    key={o.id}
                    type="button"
                    className={`shift-row${isSel ? ' shift-row--sel' : ''}`}
                    onClick={() => setSourceId(isSel ? null : o.id)}
                  >
                    <div className="shift-row__head">
                      <span className="shift-row__title">{o.meta.icon} {o.title}</span>
                      <span className="shift-row__amt">
                        ₹{(o.order.total_amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                    {o.items.length > 0 && (
                      <div className="shift-row__items">
                        {o.items.slice(0, 3).map((item, i) => (
                          <span key={i} className="shift-item-tag">
                            {item.product_name} ×{item.quantity}
                          </span>
                        ))}
                        {o.items.length > 3 && (
                          <span className="shift-item-tag shift-item-tag--more">+{o.items.length - 3}</span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* TARGET TABLES */}
          <div className="shift-col">
            <span className="modal__label">② Target Table (unoccupied)</span>
            <div className="shift-list">
              {availableTables.length === 0 && (
                <div className="shift-empty">All tables occupied.</div>
              )}
              {availableTables.map((t) => {
                const isSel = t.id === targetTableId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`shift-row${isSel ? ' shift-row--sel' : ''}`}
                    onClick={() => setTargetTableId(isSel ? null : t.id)}
                  >
                    <span className="shift-row__title">🍽 {t.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {source && targetTable && (
          <div className="shift-summary">
            {source.meta.icon} <strong>{source.title}</strong> → 🍽 <strong>{targetTable.name}</strong>
          </div>
        )}

        {error && <div className="shift-error">{error}</div>}

        <div className="modal__actions">
          <button className="modal__btn modal__btn--cancel" onClick={onClose}>Cancel</button>
          <button
            className="modal__btn modal__btn--confirm"
            disabled={!canShift}
            style={!canShift ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            onClick={handleShift}
          >
            {loading ? 'Shifting…' : 'Shift Order'}
          </button>
        </div>
      </div>
    </div>
  );
}
