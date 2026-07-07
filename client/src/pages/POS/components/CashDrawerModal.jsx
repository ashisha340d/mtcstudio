import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../../context/AuthContext';
import posApi from '../../../services/posApi';

const Rs = (n) => 'Rs ' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

const MOVEMENT_META = {
  CASH_IN:         { icon: '💵', label: 'Cash In',        sign: +1 },
  PETTY_CASH:      { icon: '🧾', label: 'Petty Cash',     sign: -1 },
  PAID_OUT:        { icon: '📤', label: 'Paid Out',       sign: -1 },
  CREDIT_RECEIVED: { icon: '🤝', label: 'Credit Rcvd',    sign: +1 },
};

/**
 * Till & cash drawer — open till, record cash movements
 * (Cash In / Petty Cash / Paid Out / Credit Received) and close till
 * with counted cash. Variance needs manager PIN approval.
 */
export default function CashDrawerModal({ onClose }) {
  const { user } = useAuth();
  const isManager = user?.role === 'MANAGER' || user?.role === 'ADMIN';

  const [till, setTill]           = useState(null);
  const [movements, setMovements] = useState([]);
  const [fetching, setFetching]   = useState(true);
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState(null);

  // Open till
  const [openingFloat, setOpeningFloat] = useState('');
  // Movement form
  const [mvType, setMvType]     = useState('CASH_IN');
  const [mvAmount, setMvAmount] = useState('');
  const [mvReason, setMvReason] = useState('');
  const [mvPhone, setMvPhone]   = useState('');
  const [mvName, setMvName]     = useState('');
  // Close till
  const [closing, setClosing]   = useState(false);
  const [counted, setCounted]   = useState('');
  const [approval, setApproval] = useState(null); // { variance, expected, tillId }
  const [managerPin, setManagerPin] = useState('');

  const load = useCallback(async () => {
    setFetching(true);
    setError(null);
    try {
      const [t, m] = await Promise.all([posApi.getCurrentTill(), posApi.getCashMovements()]);
      setTill(t);
      setMovements(m);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load till');
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (fn, okMsg) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      return true;
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleOpenTill = () =>
    run(() => posApi.openTill(parseFloat(openingFloat) || 0));

  const handleAddMovement = async () => {
    const ok = await run(() => posApi.addCashMovement({
      type: mvType,
      amount: parseFloat(mvAmount) || 0,
      reason: mvReason.trim() || null,
      customer_phone: mvType === 'CREDIT_RECEIVED' ? mvPhone.trim() : undefined,
      customer_name:  mvType === 'CREDIT_RECEIVED' ? (mvName.trim() || undefined) : undefined,
    }));
    if (ok) { setMvAmount(''); setMvReason(''); setMvPhone(''); setMvName(''); }
  };

  const handleCloseTill = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await posApi.closeTill(parseFloat(counted) || 0);
      if (res.requiresApproval) {
        setApproval(res);
      } else {
        setClosing(false);
        setCounted('');
        await load();
      }
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to close till');
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async () => {
    const ok = await run(() => posApi.approveTillClose({ till_id: approval.tillId, manager_pin: managerPin }));
    if (ok) { setApproval(null); setManagerPin(''); setClosing(false); setCounted(''); }
  };

  const handleDeleteMovement = async (m) => {
    if (!window.confirm(`Delete ${MOVEMENT_META[m.type]?.label} of ${Rs(m.amount)}?`)) return;
    await run(() => posApi.deleteCashMovement(m.id));
  };

  const inputStyle = { padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc', fontSize: 13 };
  const needsCustomer = mvType === 'CREDIT_RECEIVED';
  const canAdd = (parseFloat(mvAmount) || 0) > 0
    && (mvType === 'CASH_IN' || mvReason.trim())
    && (!needsCustomer || mvPhone.trim());

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal merge-modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <span className="modal__title">💰 Cash Drawer</span>

        {fetching && <div className="merge-empty">Loading…</div>}

        {/* ── No open till → open it ── */}
        {!fetching && !till && (
          <div className="merge-summary" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <span>No open till. Enter the opening float to start the drawer.</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="number" min="0" placeholder="Opening float (Rs)" value={openingFloat}
                     onChange={(e) => setOpeningFloat(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
              <button className="modal__btn modal__btn--confirm" disabled={busy} onClick={handleOpenTill}>
                Open Till
              </button>
            </div>
          </div>
        )}

        {/* ── Open till ── */}
        {!fetching && till && (
          <>
            <div className="merge-summary" style={{ gap: 16, flexWrap: 'wrap' }}>
              <span>Till #{till.id} · {till.opened_by_name}</span>
              <span>Float {Rs(till.opening_float)}</span>
              <span>Sales (cash) {Rs(till.cash_sales)}</span>
              <span>Moves {Rs(till.movements_net)}</span>
              <span style={{ fontWeight: 700 }}>Expected {Rs(till.expected_cash)}</span>
            </div>

            {/* Movement entry */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '10px 0' }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {Object.entries(MOVEMENT_META).map(([key, meta]) => (
                  <button key={key} type="button"
                          className={`merge-row${mvType === key ? ' merge-row--sel' : ''}`}
                          style={{ flex: '1 1 120px', justifyContent: 'center', padding: '8px 6px' }}
                          onClick={() => setMvType(key)}>
                    {meta.icon} {meta.label}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="number" min="0" placeholder="Amount" value={mvAmount}
                       onChange={(e) => setMvAmount(e.target.value)} style={{ ...inputStyle, width: 110 }} />
                <input type="text"
                       placeholder={mvType === 'CASH_IN' ? 'Reason (optional)' : 'Reason (required)'}
                       value={mvReason} onChange={(e) => setMvReason(e.target.value)}
                       style={{ ...inputStyle, flex: 1 }} />
              </div>
              {needsCustomer && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="text" placeholder="Customer phone (required)" value={mvPhone}
                         onChange={(e) => setMvPhone(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                  <input type="text" placeholder="Customer name" value={mvName}
                         onChange={(e) => setMvName(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                </div>
              )}
              <button className="modal__btn modal__btn--confirm" disabled={!canAdd || busy}
                      style={(!canAdd || busy) ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                      onClick={handleAddMovement}>
                {MOVEMENT_META[mvType].sign > 0 ? '+ Add to drawer' : '− Take from drawer'}
              </button>
            </div>

            {/* Today's movements */}
            <div className="merge-list" style={{ maxHeight: 180, overflowY: 'auto' }}>
              {movements.length === 0 && <div className="merge-empty">No cash movements today.</div>}
              {movements.map((m) => {
                const meta = MOVEMENT_META[m.type] || { icon: '•', label: m.type, sign: 1 };
                return (
                  <div key={m.id} className="merge-row" style={{ cursor: 'default' }}>
                    <span className="merge-row__icon">{meta.icon}</span>
                    <span className="merge-row__title">
                      {meta.label}{m.customer_phone ? ` · ${m.customer_name || m.customer_phone}` : ''}
                      <span className="merge-row__sub">
                        {m.reason || '—'} · {m.created_by_name || ''} · {new Date(String(m.created_at).replace(' ', 'T') + '+05:45').toLocaleTimeString('en-IN', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: false })}
                      </span>
                    </span>
                    <span className="merge-row__amt" style={{ color: meta.sign < 0 ? '#dc2626' : '#16a34a' }}>
                      {meta.sign < 0 ? '−' : '+'}{Rs(m.amount)}
                    </span>
                    {isManager && m.till_status === 'OPEN' && (
                      <button type="button" title="Delete movement" disabled={busy}
                              onClick={() => handleDeleteMovement(m)}
                              style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 14 }}>
                        🗑
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Close till */}
            {!closing && !approval && (
              <div className="modal__actions" style={{ justifyContent: 'flex-start' }}>
                <button className="modal__btn modal__btn--cancel" onClick={() => setClosing(true)}>
                  Close Till…
                </button>
              </div>
            )}
            {closing && !approval && (
              <div className="merge-summary" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <span>Count the drawer and enter the actual cash. Expected: <b>{Rs(till.expected_cash)}</b></span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="number" min="0" placeholder="Counted cash (Rs)" value={counted}
                         onChange={(e) => setCounted(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                  <button className="modal__btn modal__btn--confirm" disabled={busy || counted === ''}
                          onClick={handleCloseTill}>
                    Close Till
                  </button>
                  <button className="modal__btn modal__btn--cancel" onClick={() => { setClosing(false); setCounted(''); }}>
                    Back
                  </button>
                </div>
              </div>
            )}
            {approval && (
              <div className="merge-summary" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <span style={{ color: '#dc2626', fontWeight: 700 }}>
                  Variance {Rs(approval.variance)} (expected {Rs(approval.expected ?? till.expected_cash)}) — manager PIN required
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="password" inputMode="numeric" placeholder="Manager PIN" value={managerPin}
                         onChange={(e) => setManagerPin(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                  <button className="modal__btn modal__btn--confirm" disabled={busy || !managerPin}
                          onClick={handleApprove}>
                    Approve & Close
                  </button>
                  <button className="modal__btn modal__btn--cancel" onClick={() => { setApproval(null); setManagerPin(''); }}>
                    Back
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {error && <div className="merge-error">{error}</div>}

        <div className="modal__actions">
          <button className="modal__btn modal__btn--cancel" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
