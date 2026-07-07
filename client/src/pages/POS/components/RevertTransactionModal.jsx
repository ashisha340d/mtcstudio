import { useEffect, useState } from 'react';
import { usePOS } from '../../../context/POSContext';
import posApi from '../../../services/posApi';

const Rs = (n) => 'Rs ' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

/**
 * Lists today's CLOSED dine-in/takeaway/delivery/quick orders and cake order
 * advance payments, and lets a manager revert a mistaken one. Revert offsets
 * the payment, reopens the order (or drops it into Quick Order if its table
 * has since been reused), and never touches KOT/KOT item state.
 */
export default function RevertTransactionModal({ onClose, onReverted }) {
  const { revertOrderTransaction, revertCakeTransaction, loading, notify } = usePOS();

  const [data, setData] = useState({ orders: [], cakeOrders: [] });
  const [fetching, setFetching] = useState(true);
  const [target, setTarget] = useState(null); // { kind: 'order'|'cake', row }
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);

  async function load() {
    setFetching(true);
    try {
      const res = await posApi.getTodayTransactions();
      setData(res);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load transactions');
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line

  function paymentSummary(payments) {
    const net = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const methods = [...new Set(payments.map(p => p.method))].join('+');
    return { net, methods };
  }

  async function handleRevert() {
    if (!target) return;
    setError(null);
    try {
      if (target.kind === 'order') {
        await revertOrderTransaction({ orderId: target.row.id, reason });
        notify?.('success', `Order #${target.row.id} reverted`);
      } else {
        await revertCakeTransaction({ cakeOrderId: target.row.id, reason });
        notify?.('success', `Cake order ${target.row.order_number} payment reverted`);
      }
      setTarget(null);
      setReason('');
      load();
      onReverted?.();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Revert failed');
    }
  }

  const orderRows = data.orders.filter(o => paymentSummary(o.payments).net > 0);
  const cakeRows = data.cakeOrders.filter(o => paymentSummary(o.payments).net > 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal merge-modal" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
        <span className="modal__title">↩ Revert Mistaken Transaction</span>
        <p className="merge-hint">
          Pick today's checkout to undo. The payment is offset, the order reopens onto its
          table (or Quick Order if the table's now occupied), and kitchen ticket state is left as-is.
        </p>

        {fetching && <div className="merge-empty">Loading…</div>}

        {!fetching && (
          <div className="merge-list" style={{ maxHeight: 360, overflowY: 'auto' }}>
            {orderRows.length === 0 && cakeRows.length === 0 && (
              <div className="merge-empty">No reversible transactions today.</div>
            )}

            {orderRows.map((o) => {
              const { net, methods } = paymentSummary(o.payments);
              const isSel = target?.kind === 'order' && target.row.id === o.id;
              return (
                <button
                  key={`order-${o.id}`}
                  type="button"
                  className={`merge-row${isSel ? ' merge-row--sel' : ''}`}
                  onClick={() => setTarget(isSel ? null : { kind: 'order', row: o })}
                >
                  <span className="merge-row__icon">{o.order_type === 'DINE_IN' ? '🍽' : o.order_type === 'TAKEAWAY' ? '🛍' : o.order_type === 'DELIVERY' ? '🚴' : '⚡'}</span>
                  <span className="merge-row__title">
                    {o.table_name || o.customer_name || `Order #${o.id}`}
                    <span className="merge-row__sub">{o.order_type} · #{o.id} · {methods} · closed {new Date(o.closed_at).toLocaleTimeString()}</span>
                  </span>
                  <span className="merge-row__amt">{Rs(net)}</span>
                </button>
              );
            })}

            {cakeRows.map((o) => {
              const { net, methods } = paymentSummary(o.payments);
              const isSel = target?.kind === 'cake' && target.row.id === o.id;
              return (
                <button
                  key={`cake-${o.id}`}
                  type="button"
                  className={`merge-row${isSel ? ' merge-row--sel' : ''}`}
                  onClick={() => setTarget(isSel ? null : { kind: 'cake', row: o })}
                >
                  <span className="merge-row__icon">🎂</span>
                  <span className="merge-row__title">
                    {o.customer_name}
                    <span className="merge-row__sub">{o.order_number} · {methods} · status {o.status}</span>
                  </span>
                  <span className="merge-row__amt">{Rs(net)}</span>
                </button>
              );
            })}
          </div>
        )}

        {target && (
          <div className="merge-summary" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <span>
              Reverting {target.kind === 'order' ? `Order #${target.row.id}` : target.row.order_number}
            </span>
            <input
              type="text"
              placeholder="Reason (optional, e.g. wrong payment method entered)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc' }}
            />
          </div>
        )}

        {error && <div className="merge-error">{error}</div>}

        <div className="modal__actions">
          <button className="modal__btn modal__btn--cancel" onClick={onClose}>Close</button>
          <button
            className="modal__btn modal__btn--confirm"
            disabled={!target || loading}
            style={(!target || loading) ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            onClick={handleRevert}
          >
            {loading ? 'Reverting…' : 'Revert Transaction'}
          </button>
        </div>
      </div>
    </div>
  );
}
