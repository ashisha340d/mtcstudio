import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import posApi from '../../services/posApi';
import CashDrawerModal from './components/CashDrawerModal';
import SalesReportModal from './components/SalesReportModal';
import './CashClosing.css';

const DENOMS = [1000, 500, 100, 50, 20, 10, 5, 2, 1];

const npr = (n) => 'NPR ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtTime = (ts) => ts
  ? new Date(String(ts).replace(' ', 'T') + (String(ts).includes('Z') ? '' : '+05:45'))
      .toLocaleTimeString('en-IN', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: true })
  : '—';
const fmtDate = (d) => d
  ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  : '—';

export default function CashClosing() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isManager = user?.role === 'MANAGER' || user?.role === 'ADMIN';

  const [day, setDay]         = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);

  const [qty, setQty]           = useState({});      // { denom: qty }
  const [cashTaken, setCashTaken] = useState('');
  const [note, setNote]         = useState('');
  const [openingInput, setOpeningInput] = useState('');
  const [editOpening, setEditOpening]   = useState(false);
  const [drawerTab, setDrawerTab]       = useState(null);   // 'IN' | 'OUT' | null
  const [pinAsk, setPinAsk]     = useState(null);    // { variance }
  const [managerPin, setManagerPin] = useState('');
  const [reopenAsk, setReopenAsk]   = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [lastSaved, setLastSaved]   = useState(null);
  const [showSalesReport, setShowSalesReport] = useState(false);

  const s = day?.session;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await posApi.getBusinessDay();
      setDay(d);
      if (d.session) {
        if (d.session.denominations) {
          const q = {};
          Object.entries(d.session.denominations).forEach(([k, v]) => { q[k] = v ? String(v) : ''; });
          setQty(q);
        }
        setCashTaken(d.session.cash_taken ? String(d.session.cash_taken) : '');
        setNote(d.session.closing_note || '');
      } else {
        setOpeningInput(d.previous?.closing_balance != null ? String(d.previous.closing_balance) : '');
      }
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Esc closes the topmost dialog, then the form itself
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F8') { e.preventDefault(); setShowSalesReport(prev => !prev); return; }
      if (e.key !== 'Escape') return;
      if (showSalesReport) { setShowSalesReport(false); }
      else if (pinAsk)          { setPinAsk(null); setManagerPin(''); }
      else if (reopenAsk)  { setReopenAsk(false); }
      else if (drawerTab)  { setDrawerTab(null); load(); }
      else if (editOpening) { setEditOpening(false); }
      else navigate('/pos');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pinAsk, reopenAsk, drawerTab, editOpening, showSalesReport, navigate, load]);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try { await fn(); return true; }
    catch (e) { setError(e.response?.data?.error || e.message || 'Failed'); return false; }
    finally { setBusy(false); }
  };

  const counted  = useMemo(() => DENOMS.reduce((sum, d) => sum + d * (parseInt(qty[d], 10) || 0), 0), [qty]);
  const expected = s?.expected_cash ?? 0;
  const variance = Math.round((counted - expected) * 100) / 100;
  const taken    = parseFloat(cashTaken) || 0;
  const closingBalance = Math.round((counted - taken) * 100) / 100;

  const denomsPayload = () => {
    const out = {};
    DENOMS.forEach(d => { const q = parseInt(qty[d], 10) || 0; if (q > 0) out[d] = q; });
    return out;
  };

  const handleOpenDay = () =>
    run(async () => { await posApi.openBusinessDay(parseFloat(openingInput) || 0); await load(); });

  const handleSaveDraft = () =>
    run(async () => {
      await posApi.saveDayDraft({ denominations: denomsPayload(), cash_taken: taken, note });
      setLastSaved(new Date());
    });

  const doClose = (pin) =>
    run(async () => {
      await posApi.closeBusinessDay({ denominations: denomsPayload(), cash_taken: taken, note, manager_pin: pin || undefined });
      setPinAsk(null);
      setManagerPin('');
      await load();
      try { await posApi.printDayClosing(); } catch { /* printer optional */ }
    });

  const handleCloseDay = () => {
    if (!window.confirm('Close business day? Orders and tables will be locked until the day is reopened.')) return;
    if (Math.abs(variance) > 0.005) { setPinAsk({ variance }); return; }
    doClose();
  };

  const handleReopen = () =>
    run(async () => {
      await posApi.reopenBusinessDay(String(s.business_date).slice(0, 10), reopenReason.trim());
      setReopenAsk(false);
      setReopenReason('');
      await load();
    });

  const handleEditOpening = () =>
    run(async () => {
      await posApi.updateDayOpening(parseFloat(openingInput) || 0);
      setEditOpening(false);
      await load();
    });

  const handlePrint = () => run(() => posApi.printDayClosing());

  const isClosed = s?.status === 'CLOSED';

  return (
    <div className="cash-closing">
      <div className="cc-modal">
      {/* ── Header ── */}
      <header className="cc-header">
        <div className="cc-header__title">
          <h1>Daily Cash Closing</h1>
          <span>Close your business day and reconcile cash</span>
        </div>
        <div className="cc-header__actions">
          <button className="cc-btn" onClick={() => navigate('/pos')}>← POS</button>
          {s && <button className="cc-btn" disabled={busy} onClick={handlePrint}>🖨 Print</button>}
          {s && !isClosed && (
            <button className="cc-btn cc-btn--primary" disabled={busy} onClick={handleCloseDay}>🔒 Close Day</button>
          )}
          {isClosed && isManager && (
            <button className="cc-btn cc-btn--warn" disabled={busy} onClick={() => setReopenAsk(true)}>Reopen Day…</button>
          )}
        </div>
      </header>

      {loading && <div className="cc-state">⏳ Loading…</div>}
      {error && <div className="cc-error">❌ {error}</div>}

      {/* ── Day not opened ── */}
      {!loading && !s && (
        <div className="cc-open-grid">
          <section className="cc-card cc-card--open">
            <h2>🔓 Open Business Day — {fmtDate(day?.business_date)}</h2>
            <p>The day cannot proceed until it is opened. Enter the opening cash to start.</p>
            <label className="cc-field">
              <span>Opening Cash (NPR)</span>
              <input type="number" min="0" value={openingInput}
                     onChange={e => setOpeningInput(e.target.value)} />
            </label>
            {day?.previous && (
              <div className="cc-hint">Prefilled from yesterday's closing balance.</div>
            )}
            <button className="cc-btn cc-btn--primary" disabled={busy} onClick={handleOpenDay}>
              Open Day
            </button>
          </section>

          {day?.previous && (
            <section className="cc-card">
              <h2>🔒 Previous Closing — {fmtDate(day.previous.business_date)}</h2>
              <div className="cc-row"><span>Opening Cash</span><b>{npr(day.previous.opening_float)}</b></div>
              <div className="cc-row"><span>Cash Sales</span><b>{npr(day.previous.cash_sales)}</b></div>
              <div className="cc-row"><span>Counted Cash</span><b>{npr(day.previous.closing_counted)}</b></div>
              <div className="cc-row"><span>Variance</span>
                <b className={Number(day.previous.variance) ? 'cc-neg' : ''}>{npr(day.previous.variance)}</b></div>
              <div className="cc-row"><span>Cash Taken</span><b>− {npr(day.previous.cash_taken)}</b></div>
              <div className="cc-row cc-row--strong"><span>Closing Balance</span><b>{npr(day.previous.closing_balance)}</b></div>
              <div className="cc-row cc-row--muted">
                <span>Closed</span><b>{fmtTime(day.previous.closed_at)} · {day.previous.closed_by_name || '—'}</b>
              </div>
            </section>
          )}
        </div>
      )}

      {/* ── Day open / closed ── */}
      {!loading && s && (
        <>
          {!isClosed && day.today && String(s.business_date).slice(0, 10) < day.today && (
            <div className="cc-error" style={{ background: '#fef9c3', color: '#a16207' }}>
              ⚠ This business day ({fmtDate(s.business_date)}) is still open from an earlier date —
              close it before opening today.
            </div>
          )}
          <div className="cc-infobar">
            <div className="cc-info"><span>Business Date</span><b>{fmtDate(s.business_date)}</b></div>
            <div className="cc-info"><span>Terminal</span><b>{day.terminal}</b></div>
            <div className="cc-info"><span>Status</span>
              <b className={`cc-chip ${isClosed ? 'cc-chip--closed' : 'cc-chip--open'}`}>{s.status}</b></div>
            <div className="cc-info"><span>Opened At</span><b>{fmtTime(s.opened_at)} · {s.opened_by_name || '—'}</b></div>
            {s.reopen_count > 0 && (
              <div className="cc-info"><span>Reopened ×{s.reopen_count}</span>
                <b title={s.reopen_reason}>{s.reopened_by_name} — {s.reopen_reason}</b></div>
            )}
          </div>

          <div className="cc-grid">
            {/* Left column */}
            <div className="cc-col">
              <section className="cc-card">
                <h2>Opening
                  {!isClosed && isManager && !editOpening && (
                    <button className="cc-btn cc-btn--sm" onClick={() => { setOpeningInput(String(s.opening_float)); setEditOpening(true); }}>✎ Edit</button>
                  )}
                </h2>
                <div className="cc-row"><span>Open Time</span><b>{fmtTime(s.opened_at)}</b></div>
                {!editOpening && (
                  <div className="cc-row cc-row--strong"><span>Opening Cash</span><b className="cc-blue">{npr(s.opening_float)}</b></div>
                )}
                {editOpening && (
                  <div className="cc-inline-edit">
                    <input type="number" min="0" value={openingInput} onChange={e => setOpeningInput(e.target.value)} />
                    <button className="cc-btn cc-btn--sm cc-btn--primary" disabled={busy} onClick={handleEditOpening}>Save</button>
                    <button className="cc-btn cc-btn--sm" onClick={() => setEditOpening(false)}>Cancel</button>
                  </div>
                )}
              </section>

              <section className="cc-card">
                <h2>Expected Cash</h2>
                <div className="cc-row"><span>Opening Cash</span><b>{npr(s.opening_float)}</b></div>
                <div className="cc-row"><span>+ Cash Sales</span><b>{npr(s.cash_sales)}</b></div>
                <div className="cc-row"><span>+ Cash In</span><b>{npr(s.cash_in)}</b></div>
                <div className="cc-row"><span>− Cash Out</span><b className="cc-neg">{npr(s.cash_out)}</b></div>
                <div className="cc-row cc-row--strong"><span>Expected Cash</span><b className="cc-blue">{npr(expected)}</b></div>
              </section>

              <section className="cc-card">
                <h2>Notes</h2>
                <textarea maxLength={250} rows={3} placeholder="Write any closing notes here…"
                          value={note} disabled={isClosed}
                          onChange={e => setNote(e.target.value)} />
                <div className="cc-hint" style={{ textAlign: 'right' }}>{note.length} / 250</div>
              </section>

              {isClosed && (
                <section className="cc-card cc-card--closedinfo">
                  <h2>Closing Info</h2>
                  <div className="cc-row"><span>Closed By</span><b>{s.closed_by_name || '—'}</b></div>
                  <div className="cc-row"><span>Closed Time</span><b>{fmtTime(s.closed_at)}</b></div>
                </section>
              )}
            </div>

            {/* Middle column */}
            <div className="cc-col cc-col--wide">
              <section className="cc-card">
                <h2>Cash Activity</h2>
                <div className="cc-activity">
                  <div className="cc-activity__icon cc-activity__icon--sales">📈</div>
                  <div className="cc-activity__label">
                    <b>Cash Sales</b><span>Total cash sales for the day</span>
                  </div>
                  <b>{npr(s.cash_sales)}</b>
                </div>
                <div className="cc-activity">
                  <div className="cc-activity__icon cc-activity__icon--in">⬇</div>
                  <div className="cc-activity__label">
                    <b>Cash In</b><span>Total cash added to till</span>
                  </div>
                  <b>{npr(s.cash_in)}</b>
                  {!isClosed && <button className="cc-btn cc-btn--sm" onClick={() => setDrawerTab('IN')}>Manage</button>}
                </div>
                <div className="cc-activity">
                  <div className="cc-activity__icon cc-activity__icon--out">⬆</div>
                  <div className="cc-activity__label">
                    <b>Cash Out</b><span>Total cash out from till</span>
                  </div>
                  <b>{npr(s.cash_out)}</b>
                  {!isClosed && <button className="cc-btn cc-btn--sm" onClick={() => setDrawerTab('OUT')}>Manage</button>}
                </div>
              </section>

              <section className="cc-card cc-card--denoms">
                <h2>Denomination Count</h2>
                <table className="cc-denoms">
                  <thead><tr><th>Denomination</th><th>Qty</th><th>Total (NPR)</th></tr></thead>
                  <tbody>
                    {DENOMS.map(d => (
                      <tr key={d}>
                        <td>NPR {d}</td>
                        <td>
                          <input id={`cc-qty-${d}`} className="cc-qty" type="number" min="0"
                                 value={qty[d] ?? ''} disabled={isClosed} placeholder="0"
                                 onChange={e => setQty(prev => ({ ...prev, [d]: e.target.value }))}
                                 onKeyDown={e => {
                                   if (e.key !== 'Enter') return;
                                   e.preventDefault();
                                   const next = DENOMS[DENOMS.indexOf(d) + 1] ?? DENOMS[0];
                                   const el = document.getElementById(`cc-qty-${next}`);
                                   el?.focus(); el?.select();
                                 }}
                                 onFocus={e => e.target.select()} />
                        </td>
                        <td className="cc-denoms__total">{(d * (parseInt(qty[d], 10) || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>

            {/* Right column */}
            <div className="cc-col">
              <section className="cc-card cc-card--summary">
                <h2>🪙 Count Summary</h2>
                <div className="cc-summary__label">Counted Cash</div>
                <div className="cc-summary__counted">{npr(isClosed ? s.closing_counted : counted)}</div>
                <span className="cc-chip cc-chip--auto">Auto calculated</span>

                <div className="cc-summary__label">Variance</div>
                {(() => {
                  const v = isClosed ? s.variance : variance;
                  return (
                    <>
                      <div className={`cc-summary__variance ${v < 0 ? 'cc-neg' : v > 0 ? 'cc-pos' : ''}`}>
                        {v < 0 ? '−' : ''}{npr(Math.abs(v))}
                      </div>
                      {Math.abs(v) > 0.005 && (
                        <span className={`cc-chip ${v < 0 ? 'cc-chip--short' : 'cc-chip--over'}`}>{v < 0 ? 'Short' : 'Over'}</span>
                      )}
                    </>
                  );
                })()}

                <div className="cc-summary__rows">
                  <div className="cc-row"><span>Expected Cash</span><b>{npr(expected)}</b></div>
                  <div className="cc-row"><span>Counted Cash</span><b>{npr(isClosed ? s.closing_counted : counted)}</b></div>
                  <div className="cc-row">
                    <span>Cash Taken</span>
                    {isClosed
                      ? <b>− {npr(s.cash_taken)}</b>
                      : <input className="cc-taken" type="number" min="0" placeholder="0.00"
                               value={cashTaken} onChange={e => setCashTaken(e.target.value)} />}
                  </div>
                  <div className="cc-row cc-row--strong">
                    <span>Closing Balance</span>
                    <b className="cc-blue">{npr(isClosed ? s.closing_balance : closingBalance)}</b>
                  </div>
                </div>
                <div className="cc-hint">
                  Closing balance = counted cash − cash taken. It becomes tomorrow's opening cash.
                </div>
              </section>
            </div>
          </div>

          {/* ── Footer ── */}
          {!isClosed && (
            <footer className="cc-footer">
              <span className="cc-hint">ℹ Make sure all cash in/out entries are correct before closing the day.</span>
              <span className="cc-footer__saved">
                {lastSaved && <>Last saved: {lastSaved.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} ✅</>}
              </span>
              <button className="cc-btn" disabled={busy} onClick={handleSaveDraft}>💾 Save Draft</button>
              <button className="cc-btn cc-btn--primary" disabled={busy} onClick={handleCloseDay}>🔒 Close Day</button>
            </footer>
          )}
          {isClosed && (
            <footer className="cc-footer cc-footer--closed">
              <span>🔒 Day closed — orders and tables are locked until the day is reopened.</span>
            </footer>
          )}
        </>
      )}

      {/* ── Cash In/Out manage modal ── */}
      {drawerTab && (
        <CashDrawerModal initialTab={drawerTab}
                         onClose={() => { setDrawerTab(null); load(); }} />
      )}

      {/* ── Sales Report (F8) ── */}
      {showSalesReport && (
        <SalesReportModal onClose={() => setShowSalesReport(false)} />
      )}

      {/* ── Manager PIN (variance) ── */}
      {pinAsk && (
        <div className="cc-overlay" onClick={() => setPinAsk(null)}>
          <div className="cc-dialog" onClick={e => e.stopPropagation()}>
            <h3>Variance {npr(pinAsk.variance)} — Manager approval required</h3>
            <input type="password" inputMode="numeric" placeholder="Manager PIN" autoFocus
                   value={managerPin} onChange={e => setManagerPin(e.target.value)} />
            <div className="cc-dialog__actions">
              <button className="cc-btn" onClick={() => { setPinAsk(null); setManagerPin(''); }}>Cancel</button>
              <button className="cc-btn cc-btn--primary" disabled={busy || !managerPin}
                      onClick={() => doClose(managerPin)}>Approve & Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reopen reason ── */}
      {reopenAsk && (
        <div className="cc-overlay" onClick={() => setReopenAsk(false)}>
          <div className="cc-dialog" onClick={e => e.stopPropagation()}>
            <h3>Reopen business day — reason required (audit trail)</h3>
            <input type="text" placeholder="Why is the day being reopened?" autoFocus
                   value={reopenReason} onChange={e => setReopenReason(e.target.value)} />
            <div className="cc-dialog__actions">
              <button className="cc-btn" onClick={() => setReopenAsk(false)}>Cancel</button>
              <button className="cc-btn cc-btn--warn" disabled={busy || !reopenReason.trim()}
                      onClick={handleReopen}>Reopen Day</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
