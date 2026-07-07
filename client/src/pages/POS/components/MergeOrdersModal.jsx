import { useMemo, useState } from 'react';
import { usePOS, ORDER_TYPE } from '../../../context/POSContext';

const TYPE_META = {
  DINE_IN:    { label: 'Dine In',    icon: '🍽' },
  TAKEAWAY:   { label: 'Takeaway',   icon: '🛍' },
  DELIVERY:   { label: 'Delivery',   icon: '🚴' },
  QUICK_SALE: { label: 'Quick Sale', icon: '⚡' },
};

/**
 * Merge one active order into another. Works across Dine-In, Takeaway,
 * Delivery and Quick — never Cake orders. The source order is cancelled and,
 * if it held a table, that table is freed.
 */
export default function MergeOrdersModal({ onClose, onMerged }) {
  const { orders, kotsByOrder, tables, mergeOrders, loading, notify } = usePOS();

  const [sourceId, setSourceId] = useState(null);
  const [targetId, setTargetId] = useState(null);
  const [error, setError]       = useState(null);

  const tableName = (id) => tables.find((t) => t.id === id)?.name || `Table ${id}`;

  function hasContent(o) {
    const kots = kotsByOrder[o.id] ?? [];
    if (kots.some((k) => (k.items ?? []).some((i) => i.status !== 'CANCELLED'))) return true;
    try { return o.draft_items && JSON.parse(o.draft_items).length > 0; } catch { return false; }
  }

  // Every live, non-cake order with something in it — the merge candidates.
  const candidates = useMemo(() => {
    return Object.values(orders)
      .filter((o) =>
        (o.status === 'OPEN' || o.status === 'SAVED') &&
        o.order_type !== ORDER_TYPE.CAKE_ORDER &&
        hasContent(o))
      .map((o) => {
        const meta  = TYPE_META[o.order_type] || { label: o.order_type, icon: '📋' };
        const title = o.order_type === ORDER_TYPE.DINE_IN
          ? tableName(o.table_id)
          : (o.customer_name || meta.label);
        return { id: o.id, order: o, meta, title };
      })
      .sort((a, b) => a.id - b.id);
  }, [orders, kotsByOrder, tables]);

  const source = candidates.find((c) => c.id === sourceId) || null;
  const target = candidates.find((c) => c.id === targetId) || null;
  const canMerge = source && target && source.id !== target.id && !loading;

  async function handleMerge() {
    if (!canMerge) return;
    setError(null);
    try {
      const res = await mergeOrders({ targetOrderId: target.id, sourceOrderId: source.id });
      notify?.('success', `Merged #${source.id} into #${target.id} — ${res.kotsMoved} KOT(s) moved`);
      onMerged?.();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Merge failed');
    }
  }

  function OrderList({ side, selectedId, onSelect, disabledId }) {
    return (
      <div className="merge-list">
        {candidates.length === 0 && (
          <div className="merge-empty">No mergeable orders.</div>
        )}
        {candidates.map((c) => {
          const isSel  = c.id === selectedId;
          const isDis  = c.id === disabledId;
          return (
            <button
              key={c.id}
              type="button"
              disabled={isDis}
              className={`merge-row${isSel ? ' merge-row--sel' : ''}${isDis ? ' merge-row--dis' : ''}`}
              onClick={() => onSelect(isSel ? null : c.id)}
            >
              <span className="merge-row__icon">{c.meta.icon}</span>
              <span className="merge-row__title">
                {c.title}
                <span className="merge-row__sub">{c.meta.label} · #{c.id}</span>
              </span>
              <span className="merge-row__amt">
                Rs {(c.order.total_amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal merge-modal"
        style={{ maxWidth: 620 }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="modal__title">🔀 Merge Orders</span>

        <p className="merge-hint">
          Move everything from the <strong>source</strong> order into the <strong>target</strong>.
          The source is cancelled and its table (if any) is freed. Cake orders can’t be merged.
        </p>

        <div className="merge-cols">
          <div className="merge-col">
            <span className="modal__label">① Source (moved away)</span>
            <OrderList side="source" selectedId={sourceId} onSelect={setSourceId} disabledId={targetId} />
          </div>
          <div className="merge-col">
            <span className="modal__label">② Target (kept)</span>
            <OrderList side="target" selectedId={targetId} onSelect={setTargetId} disabledId={sourceId} />
          </div>
        </div>

        {source && target && (
          <div className="merge-summary">
            {source.meta.icon} <strong>{source.title}</strong> (#{source.id})
            {'  →  '}
            {target.meta.icon} <strong>{target.title}</strong> (#{target.id})
          </div>
        )}

        {error && <div className="merge-error">{error}</div>}

        <div className="modal__actions">
          <button className="modal__btn modal__btn--cancel" onClick={onClose}>Cancel</button>
          <button
            className="modal__btn modal__btn--confirm"
            disabled={!canMerge}
            style={!canMerge ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            onClick={handleMerge}
          >
            {loading ? 'Merging…' : 'Merge Orders'}
          </button>
        </div>
      </div>
    </div>
  );
}
