import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../../context/AuthContext';
import posApi from '../../../services/posApi';

const Rs = (n) => 'NPR ' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TABS = {
  IN:  { label: '⬇ Cash In',  types: ['CASH_IN', 'CREDIT_RECEIVED'] },
  OUT: { label: '⬆ Cash Out', types: ['PETTY_CASH', 'PAID_OUT'] },
};
const TYPE_META = {
  CASH_IN:         { icon: '💵', label: 'Cash In' },
  CREDIT_RECEIVED: { icon: '🤝', label: 'Credit Received' },
  PETTY_CASH:      { icon: '🧾', label: 'Petty Cash' },
  PAID_OUT:        { icon: '📤', label: 'Paid Out' },
};

/**
 * Cash In / Cash Out manager for the open business day.
 * Day open/close itself lives in the Daily Cash Closing page (/pos/cash-closing).
 */
export default function CashDrawerModal({ onClose, initialTab = 'IN' }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isManager = user?.role === 'MANAGER' || user?.role === 'ADMIN';

  const [tab, setTab]             = useState(TABS[initialTab] ? initialTab : 'IN');
  const [day, setDay]             = useState(null);
  const [fetching, setFetching]   = useState(true);
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState(null);

  // Add form
  const [mvType, setMvType]     = useState(TABS[initialTab]?.types[0] || 'CASH_IN');
  const [mvAmount, setMvAmount] = useState('');
  const [mvReason, setMvReason] = useState('');
  const [mvPhone, setMvPhone]   = useState('');
  const [mvName, setMvName]     = useState('');
  // Inline edit
  const [editId, setEditId]         = useState(null);
  const [editAmount, setEditAmount] = useState('');
  const [editReason, setEditReason] = useState('');

  const load = useCallback(async () => {
    setFetching(true);
    setError(null);
    try {
      setDay(await posApi.getBusinessDay());
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load');
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try { await fn(); await load(); return true; }
    catch (e) { setError(e.response?.data?.error || e.message || 'Failed'); return false; }
    finally { setBusy(false); }
  };

  const switchTab = (t) => { setTab(t); setMvType(TABS[t].types[0]); setEditId(null); };

  const handleAdd = async () => {
    const ok = await run(() => posApi.addCashMovement({
      type: mvType,
      amount: parseFloat(mvAmount) || 0,
      reason: mvReason.trim() || null,
      customer_phone: mvType === 'CREDIT_RECEIVED' ? mvPhone.trim() : undefined,
      customer_name:  mvType === 'CREDIT_RECEIVED' ? (mvName.trim() || undefined) : undefined,
    }));
    if (ok) { setMvAmount(''); setMvReason(''); setMvPhone(''); setMvName(''); }
  };

  const handleSaveEdit = async (m) => {
    const ok = await run(() => posApi.updateCashMovement(m.id, {
      amount: parseFloat(editAmount) || 0,
      reason: editReason.trim() || null,
    }));
    if (ok) setEditId(null);
  };

  const handleDelete = async (m) => {
    if (!window.confirm(`Delete ${TYPE_META[m.type]?.label} of ${Rs(m.amount)}?`)) return;
    await run(() => posApi.deleteCashMovement(m.id));
  };

  const inputStyle = { padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc', fontSize: 13 };
  const needsCustomer = mvType === 'CREDIT_RECEIVED';
  const canAdd = (parseFloat(mvAmount) || 0) > 0
    && (mvType === 'CASH_IN' || mvReason.trim())
    && (!needsCustomer || mvPhone.trim());

  const session   = day?.session;
  const dayOpen   = session?.status === 'OPEN';
  const movements = (day?.movements || []).filter(m => TABS[tab].types.includes(m.type));
  const tabTotal  = movements.reduce((s, m) => s + Number(m.amount || 0), 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal merge-modal" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
        <span className="modal__title">💰 Cash In / Cash Out</span>

        {fetching && <div className="merge-empty">Loading…</div>}

        {/* ── Day not open ── */}
        {!fetching && !dayOpen && (
          <div className="merge-summary" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
            <span>
              {session?.status === 'CLOSED'
                ? '🔒 Business day is closed — cash entries are frozen.'
                : 'Business day is not open yet. Open the day to record cash activity.'}
            </span>
            <button className="modal__btn modal__btn--confirm"
                    onClick={() => { onClose?.(); navigate('/pos/cash-closing'); }}>
              Go to Daily Cash Closing
            </button>
          </div>
        )}

        {!fetching && dayOpen && (
          <>
            {/* Summary strip */}
            <div className="merge-summary" style={{ gap: 16, flexWrap: 'wrap' }}>
              <span>Opening {Rs(session.opening_float)}</span>
              <span>Cash Sales {Rs(session.cash_sales)}</span>
              <span style={{ color: '#16a34a' }}>In {Rs(session.cash_in)}</span>
              <span style={{ color: '#dc2626' }}>Out {Rs(session.cash_out)}</span>
              <span style={{ fontWeight: 700 }}>Expected {Rs(session.expected_cash)}</span>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 6, margin: '10px 0 8px' }}>
              {Object.entries(TABS).map(([key, t]) => (
                <button key={key} type="button"
                        className={`merge-row${tab === key ? ' merge-row--sel' : ''}`}
                        style={{ flex: 1, justifyContent: 'center', padding: '9px 6px', fontWeight: 700 }}
                        onClick={() => switchTab(key)}>
                  {t.label} · {Rs(key === 'IN' ? session.cash_in : session.cash_out)}
                </button>
              ))}
            </div>

            {/* Add form */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {TABS[tab].types.map((key) => (
                  <button key={key} type="button"
                          className={`merge-row${mvType === key ? ' merge-row--sel' : ''}`}
                          style={{ flex: 1, justifyContent: 'center', padding: '7px 6px' }}
                          onClick={() => setMvType(key)}>
                    {TYPE_META[key].icon} {TYPE_META[key].label}
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
                <button className="modal__btn modal__btn--confirm" disabled={!canAdd || busy}
                        style={(!canAdd || busy) ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                        onClick={handleAdd}>
                  {tab === 'IN' ? '+ Add' : '− Add'}
                </button>
              </div>
              {needsCustomer && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="text" placeholder="Customer phone (required)" value={mvPhone}
                         onChange={(e) => setMvPhone(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                  <input type="text" placeholder="Customer name" value={mvName}
                         onChange={(e) => setMvName(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                </div>
              )}
            </div>

            {/* List */}
            <div className="merge-list" style={{ maxHeight: 230, overflowY: 'auto' }}>
              {movements.length === 0 && (
                <div className="merge-empty">No {tab === 'IN' ? 'cash in' : 'cash out'} entries today.</div>
              )}
              {movements.map((m) => {
                const meta = TYPE_META[m.type] || { icon: '•', label: m.type };
                const editing = editId === m.id;
                return (
                  <div key={m.id} className="merge-row" style={{ cursor: 'default' }}>
                    <span className="merge-row__icon">{meta.icon}</span>
                    {!editing && (
                      <span className="merge-row__title">
                        {meta.label}{m.customer_phone ? ` · ${m.customer_name || m.customer_phone}` : ''}
                        <span className="merge-row__sub">
                          {m.reason || '—'} · {m.created_by_name || ''} · {new Date(String(m.created_at).replace(' ', 'T') + '+05:45').toLocaleTimeString('en-IN', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: false })}
                        </span>
                      </span>
                    )}
                    {editing && (
                      <span className="merge-row__title" style={{ display: 'flex', gap: 6 }}>
                        <input type="number" min="0" value={editAmount}
                               onChange={(e) => setEditAmount(e.target.value)} style={{ ...inputStyle, width: 100 }} />
                        <input type="text" value={editReason} placeholder="Reason"
                               onChange={(e) => setEditReason(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                        <button className="modal__btn modal__btn--confirm" disabled={busy}
                                style={{ padding: '4px 10px' }} onClick={() => handleSaveEdit(m)}>✓</button>
                        <button className="modal__btn modal__btn--cancel"
                                style={{ padding: '4px 10px' }} onClick={() => setEditId(null)}>✕</button>
                      </span>
                    )}
                    {!editing && (
                      <span className="merge-row__amt" style={{ color: tab === 'OUT' ? '#dc2626' : '#16a34a' }}>
                        {tab === 'OUT' ? '−' : '+'}{Rs(m.amount)}
                      </span>
                    )}
                    {!editing && isManager && m.type !== 'CREDIT_RECEIVED' && (
                      <button type="button" title="Edit entry" disabled={busy}
                              onClick={() => { setEditId(m.id); setEditAmount(String(m.amount)); setEditReason(m.reason || ''); }}
                              style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 14 }}>
                        ✎
                      </button>
                    )}
                    {!editing && isManager && (
                      <button type="button" title="Delete entry" disabled={busy}
                              onClick={() => handleDelete(m)}
                              style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 14 }}>
                        🗑
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="merge-summary" style={{ justifyContent: 'flex-end', fontWeight: 700 }}>
              Total {tab === 'IN' ? 'Cash In' : 'Cash Out'}: {Rs(tabTotal)}
            </div>
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
