import { useEffect, useState, useCallback } from 'react';
import { usePOS } from '../../../context/POSContext';
import posApi from '../../../services/posApi';

const Rs = (n) => 'Rs ' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const timeOf = (s) => (s ? new Date(String(s).replace(' ', 'T')).toLocaleString() : '—');

const TABS = [
  { key: 'PENDING_APPROVAL', label: 'Pending' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
];

/**
 * Web Orders approval queue. Orders arrive from the website in real time via
 * the WS bridge and sit here until a cashier approves (→ POS order + KOT via
 * the existing workflows) or rejects them.
 */
export default function WebOrdersModal({ onClose, onApproved }) {
  const { notify, refreshWebOrderCount, webOrderAlert } = usePOS();

  const [tab, setTab] = useState('PENDING_APPROVAL');
  const [rows, setRows] = useState([]);
  const [fetching, setFetching] = useState(true);
  const [openId, setOpenId] = useState(null);      // expanded detail row
  const [rejectId, setRejectId] = useState(null);  // row awaiting reject reason
  const [reason, setReason] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async (status = tab) => {
    setFetching(true);
    setError(null);
    try {
      setRows(await posApi.getWebOrders(status));
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load web orders');
    } finally {
      setFetching(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);
  // A new order arriving while the modal is open refreshes the pending list live
  useEffect(() => { if (webOrderAlert && tab === 'PENDING_APPROVAL') load(); }, [webOrderAlert]); // eslint-disable-line

  async function handleApprove(row) {
    setBusyId(row.id);
    setError(null);
    try {
      const r = await posApi.approveWebOrder(row.id);
      notify?.('success', `🌐 ${row.order_number} approved → POS order #${r.posOrderId}, KOT sent to kitchen`);
      await load();
      refreshWebOrderCount();
      onApproved?.();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Approve failed');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(row) {
    setBusyId(row.id);
    setError(null);
    try {
      await posApi.rejectWebOrder(row.id, reason);
      notify?.('error', `${row.order_number} rejected`);
      setRejectId(null);
      setReason('');
      await load();
      refreshWebOrderCount();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Reject failed');
    } finally {
      setBusyId(null);
    }
  }

  function parseMods(json) {
    try { return JSON.parse(json || '[]'); } catch { return []; }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal merge-modal" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
        <span className="modal__title">🌐 Web Orders</span>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '6px 0 10px' }}>
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              className={`merge-row${tab === t.key ? ' merge-row--sel' : ''}`}
              style={{ flex: 'none', padding: '6px 14px' }}
              onClick={() => { setTab(t.key); setOpenId(null); setRejectId(null); }}
            >
              {t.label}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <button type="button" className="merge-row" style={{ flex: 'none', padding: '6px 14px' }} onClick={() => load()}>
            🔄 Refresh
          </button>
        </div>

        {fetching && <div className="merge-empty">Loading…</div>}

        {!fetching && (
          <div className="merge-list" style={{ maxHeight: 420, overflowY: 'auto' }}>
            {rows.length === 0 && (
              <div className="merge-empty">
                {tab === 'PENDING_APPROVAL' ? 'No web orders waiting for approval.' : `No ${tab.toLowerCase()} web orders.`}
              </div>
            )}

            {rows.map((o) => {
              const isOpen = openId === o.id;
              const isRejecting = rejectId === o.id;
              return (
                <div key={o.id} style={{ border: '1px solid #e3d9c8', borderRadius: 8, marginBottom: 8, background: '#fffdf8' }}>
                  <button
                    type="button"
                    className="merge-row"
                    style={{ width: '100%', border: 'none', marginBottom: 0 }}
                    onClick={() => setOpenId(isOpen ? null : o.id)}
                  >
                    <span className="merge-row__icon">{o.order_type === 'Delivery' ? '🚴' : '🛍'}</span>
                    <span className="merge-row__title">
                      {o.order_number} · {o.customer_name || 'Customer'}
                      <span className="merge-row__sub">
                        {o.order_type} · 📞 {o.customer_phone || '—'} · {timeOf(o.ordered_at || o.received_at)}
                        {' · '}{o.payment_method} / {o.payment_status}
                        {o.status !== 'PENDING_APPROVAL' ? ` · ${o.status}` : ''}
                      </span>
                    </span>
                    <span className="merge-row__amt">{Rs(o.grand_total)}</span>
                  </button>

                  {isOpen && (
                    <div style={{ padding: '4px 12px 10px', fontSize: 13, color: '#3d3428' }}>
                      {(o.items || []).map((it) => {
                        const mods = parseMods(it.modifiers_json);
                        return (
                          <div key={it.id} style={{ display: 'flex', gap: 8, padding: '3px 0', borderBottom: '1px dashed #eee2cf' }}>
                            <span style={{ flex: 1 }}>
                              {it.item_name}{it.variant_name ? ` (${it.variant_name})` : ''}
                              {!it.product_id && <strong style={{ color: '#b3261e' }}> ⚠ unmatched</strong>}
                              {mods.length > 0 && <div style={{ fontSize: 12, opacity: 0.75 }}>➕ {mods.join(', ')}</div>}
                              {it.special_note && <div style={{ fontSize: 12, opacity: 0.75 }}>📝 {it.special_note}</div>}
                            </span>
                            <span>{it.quantity} × {Rs(it.unit_price)}</span>
                            <span style={{ minWidth: 80, textAlign: 'right', fontWeight: 600 }}>{Rs(it.line_total)}</span>
                          </div>
                        );
                      })}

                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, paddingTop: 6, fontSize: 12.5 }}>
                        <span>Subtotal {Rs(o.subtotal)}</span>
                        {+o.discount > 0 && <span>Discount −{Rs(o.discount)}</span>}
                        {+o.delivery_charge > 0 && <span>Delivery {Rs(o.delivery_charge)}</span>}
                        <strong>Total {Rs(o.grand_total)}</strong>
                      </div>

                      {o.customer_address && <div style={{ paddingTop: 4 }}>📍 {o.customer_address}{o.landmark ? ` (${o.landmark})` : ''}</div>}
                      {o.customer_notes && <div style={{ paddingTop: 2 }}>📝 {o.customer_notes}</div>}
                      {o.status === 'REJECTED' && o.reject_reason && <div style={{ paddingTop: 2, color: '#b3261e' }}>Rejected: {o.reject_reason}</div>}
                      {o.status === 'APPROVED' && o.pos_order_id && <div style={{ paddingTop: 2, color: '#2e7d32' }}>POS order #{o.pos_order_id}</div>}

                      {o.status === 'PENDING_APPROVAL' && !isRejecting && (
                        <div style={{ display: 'flex', gap: 8, paddingTop: 10 }}>
                          <button
                            className="modal__btn modal__btn--confirm"
                            disabled={busyId === o.id}
                            onClick={() => handleApprove(o)}
                          >
                            {busyId === o.id ? 'Approving…' : '✓ Approve & Send to Kitchen'}
                          </button>
                          <button
                            className="modal__btn modal__btn--cancel"
                            disabled={busyId === o.id}
                            onClick={() => { setRejectId(o.id); setReason(''); }}
                          >
                            ✕ Reject
                          </button>
                        </div>
                      )}

                      {isRejecting && (
                        <div style={{ display: 'flex', gap: 8, paddingTop: 10, alignItems: 'center' }}>
                          <input
                            type="text"
                            autoFocus
                            placeholder="Reason (e.g. item unavailable, outside delivery area)"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            style={{ flex: 1, padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc' }}
                          />
                          <button className="modal__btn modal__btn--cancel" disabled={busyId === o.id} onClick={() => handleReject(o)}>
                            {busyId === o.id ? 'Rejecting…' : 'Confirm Reject'}
                          </button>
                          <button className="modal__btn" onClick={() => { setRejectId(null); setReason(''); }}>Back</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {error && <div className="merge-error">{error}</div>}

        <div className="modal__actions">
          <button className="modal__btn modal__btn--cancel" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
