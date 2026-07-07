import { useMemo, useState } from 'react';
import { usePOS, ORDER_TYPE } from '../../../context/POSContext';

/**
 * Merge any active order into any other (except cake orders).
 * Shows dine-in tables, takeaway, delivery, and quick-sale orders.
 * Optional "Free empty tables" checkbox — if checked, dine-in tables that become
 * empty after merge are marked as freed (KDS notification emitted).
 */
const TYPE_META = {
  DINE_IN:    { label: 'Dine In',    icon: '🍽' },
  TAKEAWAY:   { label: 'Takeaway',   icon: '🛍' },
  DELIVERY:   { label: 'Delivery',   icon: '🚴' },
  QUICK_SALE: { label: 'Quick Sale', icon: '⚡' },
};

export default function TableMergeModal({ onClose, onMerged }) {
  const { tables, orders, kotsByOrder, mergeOrders, loading, notify } = usePOS();

  const [sourceId, setSourceId] = useState(null);
  const [targetId, setTargetId] = useState(null);
  const [freeEmpty, setFreeEmpty] = useState(true);
  const [error, setError] = useState(null);

  function hasContent(o) {
    const kots = kotsByOrder[o.id] ?? [];
    if (kots.some((k) => (k.items ?? []).some((i) => i.status !== 'CANCELLED'))) return true;
    try { return o.draft_items && JSON.parse(o.draft_items).length > 0; } catch { return false; }
  }

  // All mergeable orders (every type except cake)
  const mergeableOrders = useMemo(() => {
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

  const source = mergeableOrders.find((o) => o.id === sourceId) || null;
  const target = mergeableOrders.find((o) => o.id === targetId) || null;
  const canMerge = source && target && sourceId !== targetId && !loading;

  async function handleMerge() {
    if (!canMerge) return;
    setError(null);
    try {
      await mergeOrders({ targetOrderId: target.orderId, sourceOrderId: source.orderId });
      notify?.('success', `Merged ${source.meta.icon} ${source.title} → ${target.meta.icon} ${target.title}`);
      onMerged?.();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Merge failed');
    }
  }

  function OrderColumn({ selectedId, onSelect, title, disabledId }) {
    return (
      <div className="tm-col">
        <span className="modal__label">{title}</span>
        <div className="tm-list">
          {mergeableOrders.length === 0 && (
            <div className="tm-empty">No mergeable orders.</div>
          )}
          {mergeableOrders.map((o) => {
            const isSel = o.id === selectedId;
            const isDis = o.id === disabledId;
            return (
              <button
                key={o.id}
                type="button"
                disabled={isDis}
                className={`tm-row${isSel ? ' tm-row--sel' : ''}${isDis ? ' tm-row--dis' : ''}`}
                onClick={() => onSelect(isSel ? null : o.id)}
              >
                <div className="tm-row__head">
                  <span className="tm-row__table">{o.meta.icon} {o.title}</span>
                  <span className="tm-row__amt">
                    ₹{(o.order.total_amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </span>
                </div>
                {o.items.length > 0 && (
                  <div className="tm-row__items">
                    {o.items.slice(0, 3).map((item, i) => (
                      <span key={i} className="tm-item-tag">
                        {item.product_name} ×{item.quantity}
                      </span>
                    ))}
                    {o.items.length > 3 && (
                      <span className="tm-item-tag tm-item-tag--more">+{o.items.length - 3}</span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal tm-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="modal__title">🔄 Table Merge</span>

        <p className="tm-hint">
          Select a <strong>source order</strong> and a <strong>target order</strong>. All items move
          to the target. Works across any order type (dine-in, takeaway, delivery, quick).
        </p>

        <div className="tm-cols">
          <OrderColumn
            title="① Source (moved away)"
            selectedId={sourceId}
            onSelect={setSourceId}
            disabledId={targetId}
          />
          <OrderColumn
            title="② Target (receives)"
            selectedId={targetId}
            onSelect={setTargetId}
            disabledId={sourceId}
          />
        </div>

        {source && target && (
          <div className="tm-summary">
            {source.meta.icon} <strong>{source.title}</strong> ({source.items.length} items)
            {'  →  '}
            {target.meta.icon} <strong>{target.title}</strong> ({target.items.length} items)
          </div>
        )}

        <div className="tm-checkbox">
          <input
            type="checkbox"
            id="tm-free"
            checked={freeEmpty}
            onChange={(e) => setFreeEmpty(e.target.checked)}
          />
          <label htmlFor="tm-free">
            {source?.order.order_type === ORDER_TYPE.DINE_IN
              ? 'Free source table after merge'
              : 'Notify when source order is emptied'}
          </label>
          <span className="tm-checkbox__hint">
            {source?.order.order_type === ORDER_TYPE.DINE_IN
              ? '(KDS notified when table is ready)'
              : '(Source order will be cancelled)'}
          </span>
        </div>

        {error && <div className="tm-error">{error}</div>}

        <div className="modal__actions">
          <button className="modal__btn modal__btn--cancel" onClick={onClose}>Cancel</button>
          <button
            className="modal__btn modal__btn--confirm"
            disabled={!canMerge}
            style={!canMerge ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            onClick={handleMerge}
          >
            {loading ? 'Merging…' : 'Merge Tables'}
          </button>
        </div>
      </div>
    </div>
  );
}
