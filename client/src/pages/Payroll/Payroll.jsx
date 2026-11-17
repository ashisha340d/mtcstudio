import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import './Payroll.css';

const API = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

const TABS = ['Runs', 'Register', 'Commission', 'Settings'];
const SETTLEMENTS = ['UNSETTLED', 'PENDING', 'PAID'];
const RULE_TYPES = ['PRODUCT', 'CATEGORY', 'SALE_CHANNEL', 'MANUAL', 'CUSTOM'];
const RATE_TYPES = ['PERCENTAGE', 'FLAT'];

const money = (n) => 'Rs ' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const signed = (n) => (Number(n) < 0 ? '−' : '') + money(Math.abs(Number(n) || 0));
const errMsg = (e) => e?.response?.data?.error || e?.message || 'Request failed';
const iso = (d) => d.toISOString().slice(0, 10);

/** Presets for the new-run period picker — no more prompt() date typing. */
function periodPresets() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const first = (yy, mm) => iso(new Date(Date.UTC(yy, mm, 1)));
  const last = (yy, mm) => iso(new Date(Date.UTC(yy, mm + 1, 0)));
  const label = (yy, mm) => new Date(Date.UTC(yy, mm, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return [
    { key: 'this', label: `This month · ${label(y, m)}`, start: first(y, m), end: last(y, m) },
    { key: 'last', label: `Last month · ${label(y, m - 1)}`, start: first(y, m - 1), end: last(y, m - 1) },
  ];
}

/* ════════════════════════════════════════════════════════════ */

export default function Payroll({ embedded = false }) {
  const [tab, setTab] = useState('Runs');
  const [runs, setRuns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [printJob, setPrintJob] = useState(null); // { type: 'slip'|'register', ... }

  useEffect(() => {
    if (!printJob) return;
    const t = setTimeout(() => { window.print(); setPrintJob(null); }, 60);
    return () => clearTimeout(t);
  }, [printJob]);

  const flash = useCallback((msg, err = false) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 2800);
  }, []);

  const loadRuns = useCallback(async (keepSelection = true) => {
    try {
      const r = await API.get('/payroll/runs');
      setRuns(r.data);
      setSelected(prev => (keepSelection && prev && r.data.some(x => x.id === prev)) ? prev : (r.data[0]?.id ?? null));
    } catch (e) { flash(errMsg(e), true); }
    finally { setLoading(false); }
  }, [flash]);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  const run = runs.find(r => r.id === selected) || null;

  return (
    <div className={`pay-root${embedded ? ' embedded' : ''}`}>
      {embedded ? (
        <nav className="pay-tabs pay-tabs-embedded">
          {TABS.map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}
        </nav>
      ) : (
        <header className="pay-topbar">
          <div className="pay-brand">
            <span className="pay-brand-mark">Rs</span>
            <div>
              <h2>Payroll</h2>
              <p>{run ? `${run.period_start} → ${run.period_end} · ${run.status}` : 'No payroll run selected'}</p>
            </div>
          </div>
          <nav className="pay-tabs">
            {TABS.map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}
          </nav>
        </header>
      )}

      <div className="pay-content">
        {loading && <div className="pay-empty">Loading…</div>}
        {!loading && tab === 'Runs' && (
          <Runs runs={runs} selected={selected} onSelect={(id) => { setSelected(id); setTab('Register'); }}
            reload={loadRuns} flash={flash} />
        )}
        {!loading && tab === 'Register' && (
          <Register runs={runs} run={run} onSelectRun={setSelected} reload={loadRuns} flash={flash} onPrint={setPrintJob} />
        )}
        {!loading && tab === 'Commission' && <Commission flash={flash} />}
        {!loading && tab === 'Settings' && <Settings flash={flash} />}
      </div>

      {toast && <div className={`pay-toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}

      {printJob?.type === 'slip' && <PrintSlip line={printJob.line} run={printJob.run} />}
      {printJob?.type === 'register' && <PrintRegister lines={printJob.lines} run={printJob.run} />}
    </div>
  );
}

/* ════════════════ RUNS ════════════════ */

function Runs({ runs, selected, onSelect, reload, flash }) {
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // { run, action }

  const act = async (run, action) => {
    setBusy(true);
    try {
      if (action === 'delete') await API.delete(`/payroll/runs/${run.id}`);
      else await API.post(`/payroll/runs/${run.id}/${action}`);
      flash(action === 'recalc' ? 'Run recalculated' : `Run ${action}d`);
      await reload();
    } catch (e) { flash(errMsg(e), true); }
    finally { setBusy(false); setConfirm(null); }
  };

  const totals = runs.reduce((a, r) => ({
    net: a.net + Number(r.total_net || 0),
    drafts: a.drafts + (r.status === 'DRAFT' ? 1 : 0),
  }), { net: 0, drafts: 0 });

  return (
    <>
      <div className="pay-toolbar">
        <div className="pay-headline">
          <strong>{runs.length}</strong> run{runs.length === 1 ? '' : 's'} ·
          <strong> {totals.drafts}</strong> draft · lifetime net <strong>{money(totals.net)}</strong>
        </div>
        <div className="pay-spacer" />
        <button className="pay-btn primary" onClick={() => setCreating(true)}>+ New payroll run</button>
      </div>

      {runs.length === 0 ? (
        <div className="pay-empty">No payroll runs yet. Generate one for a period to price every active employee.</div>
      ) : (
        <div className="pay-runs">
          {runs.map(r => {
            const paidPct = r.line_count ? (r.paid_count / r.line_count) * 100 : 0;
            return (
              <article className={`pay-run${selected === r.id ? ' on' : ''}`} key={r.id}>
                <div className="pay-run-head">
                  <div>
                    <div className="pay-run-period">{r.period_start} <span className="pay-arrow">→</span> {r.period_end}</div>
                    <div className="pay-run-meta">
                      run #{r.id} · {r.line_count} employee{r.line_count === 1 ? '' : 's'}
                      {r.generated_by_name ? ` · by ${r.generated_by_name}` : ''}
                    </div>
                  </div>
                  <span className={`pay-status ${r.status}`}>{r.status}</span>
                </div>

                <div className="pay-run-figs">
                  <div><span>Gross</span><strong>{money(r.total_gross)}</strong></div>
                  <div><span>Deductions</span><strong className="neg">{money(r.total_deductions)}</strong></div>
                  <div><span>Net payable</span><strong className="big">{money(r.total_net)}</strong></div>
                </div>

                <div className="pay-progress" title={`${r.paid_count} of ${r.line_count} settled`}>
                  <div className="pay-progress-fill" style={{ width: `${paidPct}%` }} />
                </div>
                <div className="pay-run-meta">{r.paid_count}/{r.line_count} settled</div>

                <div className="pay-run-actions">
                  <button className="pay-btn-mini" onClick={() => onSelect(r.id)}>Open register</button>
                  {r.status === 'DRAFT' && <button className="pay-btn-mini" disabled={busy} onClick={() => act(r, 'recalc')}>Recalculate</button>}
                  {r.status === 'DRAFT' && <button className="pay-btn-mini ok" disabled={busy} onClick={() => setConfirm({ run: r, action: 'finalize' })}>Finalize</button>}
                  {r.status === 'FINALIZED' && <button className="pay-btn-mini danger" disabled={busy} onClick={() => setConfirm({ run: r, action: 'reverse' })}>Reverse</button>}
                  {r.status !== 'FINALIZED' && <button className="pay-btn-mini danger" disabled={busy} onClick={() => setConfirm({ run: r, action: 'delete' })}>Delete</button>}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {creating && <NewRun onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(false); }} flash={flash} />}
      {confirm && (
        <Confirm
          title={`${confirm.action[0].toUpperCase()}${confirm.action.slice(1)} run #${confirm.run.id}?`}
          body={CONFIRM_TEXT[confirm.action]}
          danger={confirm.action !== 'finalize'}
          onCancel={() => setConfirm(null)}
          onConfirm={() => act(confirm.run, confirm.action)}
        />
      )}
    </>
  );
}

const CONFIRM_TEXT = {
  finalize: 'Locks the run and claims every pending bonus, penalty and advance it priced in, so the next run cannot deduct them twice. Lines can still be settled afterwards.',
  reverse: 'Marks the run reversed and releases its adjustments back to pending. Settled lines keep their settlement record.',
  delete: 'Permanently removes the run and all of its payslip lines. Only draft and reversed runs can be deleted.',
};

function NewRun({ onClose, onSaved, flash }) {
  const presets = useMemo(periodPresets, []);
  const [start, setStart] = useState(presets[1].start);
  const [end, setEnd] = useState(presets[1].end);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await API.post('/payroll/runs', { period_start: start, period_end: end });
      flash('Payroll run generated');
      onSaved();
    } catch (e) { flash(errMsg(e), true); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="New payroll run" onClose={onClose} footer={
      <>
        <button className="pay-btn" onClick={onClose}>Cancel</button>
        <button className="pay-btn primary" onClick={save} disabled={busy}>Generate run</button>
      </>
    }>
      <p className="pay-hint">
        Every active employee is priced from their salary on the period end date, minus absences and
        half days, plus commission imports and pending adjustments.
      </p>
      <div className="pay-presets">
        {presets.map(p => (
          <button key={p.key}
            className={`pay-preset${start === p.start && end === p.end ? ' on' : ''}`}
            onClick={() => { setStart(p.start); setEnd(p.end); }}>{p.label}</button>
        ))}
      </div>
      <div className="pay-form grid2">
        <label>Period start<input type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
        <label>Period end<input type="date" value={end} onChange={e => setEnd(e.target.value)} /></label>
      </div>
    </Modal>
  );
}

/* ════════════════ REGISTER ════════════════ */

function Register({ runs, run, onSelectRun, reload, flash, onPrint }) {
  const [lines, setLines] = useState([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [payslip, setPayslip] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!run) { setLines([]); return; }
    try {
      const r = await API.get(`/payroll/runs/${run.id}/lines`);
      setLines(r.data);
    } catch (e) { flash(errMsg(e), true); }
  }, [run, flash]);

  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return lines.filter(l => {
      if (filter && l.settlement_status !== filter) return false;
      if (!needle) return true;
      return [l.customer_name, l.employee_number, l.customer_phone]
        .some(v => String(v || '').toLowerCase().includes(needle));
    });
  }, [lines, q, filter]);

  const totals = shown.reduce((a, l) => ({
    base: a.base + Number(l.base_salary),
    att: a.att + Number(l.attendance_adjustment),
    deduct: a.deduct + Number(l.penalty_amount) + Number(l.staff_purchase_deduction) + Number(l.advance_deduction),
    net: a.net + Number(l.net_pay),
  }), { base: 0, att: 0, deduct: 0, net: 0 });

  const setSettlement = async (line, status) => {
    setBusy(true);
    try {
      await API.post(`/payroll/runs/lines/${line.id}/settlement`, { settlement_status: status });
      setLines(prev => prev.map(l => l.id === line.id ? { ...l, settlement_status: status } : l));
      reload();
    } catch (e) { flash(errMsg(e), true); }
    finally { setBusy(false); }
  };

  const exportCsv = () => {
    const cols = ['employee_number', 'customer_name', 'customer_phone', 'base_salary', 'days_absent', 'days_half',
      'attendance_adjustment', 'commission_amount', 'bonus_amount', 'penalty_amount',
      'staff_purchase_deduction', 'advance_deduction', 'previous_balance', 'net_pay', 'settlement_status'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...shown.map(l => cols.map(c => esc(l[c])).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-${run.period_start}-to-${run.period_end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!run) return <div className="pay-empty">No payroll run selected — create one from the Runs tab.</div>;

  return (
    <>
      <div className="pay-toolbar">
        <select className="pay-runselect" value={run.id} onChange={e => onSelectRun(Number(e.target.value))}>
          {runs.map(r => <option key={r.id} value={r.id}>#{r.id} · {r.period_start} → {r.period_end} · {r.status}</option>)}
        </select>
        <input className="pay-search" placeholder="Search employee…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="pay-segment">
          <button className={filter === '' ? 'on' : ''} onClick={() => setFilter('')}>All</button>
          {SETTLEMENTS.map(s => (
            <button key={s} className={filter === s ? 'on' : ''} onClick={() => setFilter(s)}>{s[0] + s.slice(1).toLowerCase()}</button>
          ))}
        </div>
        <div className="pay-spacer" />
        <button className="pay-btn" onClick={exportCsv} disabled={!shown.length}>Export CSV</button>
        <button className="pay-btn" onClick={() => onPrint({ type: 'register', lines: shown, run })} disabled={!shown.length}>🖨 Print Register</button>
      </div>

      <div className="pay-stats">
        <Stat label="Employees" value={shown.length} sub={`of ${lines.length} on this run`} />
        <Stat label="Base Salary" value={money(totals.base)} sub="before adjustments" />
        <Stat label="Attendance" value={signed(totals.att)} sub="absence and half-day effect" tone={totals.att < 0 ? 'warn' : ''} />
        <Stat label="Deductions" value={money(totals.deduct)} sub="penalty · staff purchase · advance" tone="danger" />
        <Stat label="Net Payable" value={money(totals.net)} sub="after everything" tone="accent" />
      </div>

      {shown.length === 0 ? <div className="pay-empty">No payslip lines match.</div> : (
        <div className="pay-tablewrap">
          <table className="pay-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th className="num">Base</th>
                <th className="num">Days</th>
                <th className="num">Attendance</th>
                <th className="num">Commission</th>
                <th className="num">Bonus</th>
                <th className="num">Deductions</th>
                <th className="num">Carried</th>
                <th className="num">Net pay</th>
                <th>Settlement</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(l => {
                const deductions = Number(l.penalty_amount) + Number(l.staff_purchase_deduction) + Number(l.advance_deduction);
                return (
                  <tr key={l.id} onClick={() => setPayslip(l)} className="clickable">
                    <td>
                      <div className="pay-emp-name">{l.customer_name}</div>
                      <div className="pay-emp-sub">{l.employee_number}{l.customer_phone ? ` · ${l.customer_phone}` : ''}</div>
                    </td>
                    <td className="num">{money(l.base_salary)}</td>
                    <td className="num">
                      <span className="pay-days">
                        {Number(l.days_absent) > 0 && <em className="neg">{l.days_absent}A</em>}
                        {Number(l.days_half) > 0 && <em className="warn">{l.days_half}H</em>}
                        {Number(l.days_absent) === 0 && Number(l.days_half) === 0 && <em className="muted">full</em>}
                      </span>
                    </td>
                    <td className={`num ${Number(l.attendance_adjustment) < 0 ? 'neg' : 'muted'}`}>{signed(l.attendance_adjustment)}</td>
                    <td className="num">{Number(l.commission_amount) ? money(l.commission_amount) : <span className="muted">—</span>}</td>
                    <td className={`num ${Number(l.bonus_amount) ? 'pos' : 'muted'}`}>{Number(l.bonus_amount) ? money(l.bonus_amount) : '—'}</td>
                    <td className={`num ${deductions ? 'neg' : 'muted'}`}>{deductions ? money(deductions) : '—'}</td>
                    <td className={`num ${Number(l.previous_balance) ? 'warn' : 'muted'}`}>{Number(l.previous_balance) ? money(l.previous_balance) : '—'}</td>
                    <td className="num strong">{money(l.net_pay)}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <select className={`pay-settle ${l.settlement_status}`} value={l.settlement_status} disabled={busy}
                        onChange={e => setSettlement(l, e.target.value)}>
                        {SETTLEMENTS.map(s => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Total · {shown.length} employees</td>
                <td className="num">{money(totals.base)}</td>
                <td />
                <td className="num neg">{signed(totals.att)}</td>
                <td colSpan={3} />
                <td />
                <td className="num strong">{money(totals.net)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {payslip && <Payslip line={payslip} run={run} onClose={() => setPayslip(null)} onPrint={onPrint} />}
    </>
  );
}

function Payslip({ line, run, onClose, onPrint }) {
  const rows = [
    ['Base salary', line.base_salary, 'pos'],
    ['Attendance adjustment', line.attendance_adjustment, Number(line.attendance_adjustment) < 0 ? 'neg' : 'muted'],
    ['Commission', line.commission_amount, 'pos'],
    ['Bonus', line.bonus_amount, 'pos'],
    ['Penalty', -line.penalty_amount, 'neg'],
    ['Staff purchases', -line.staff_purchase_deduction, 'neg'],
    ['Advance recovered', -line.advance_deduction, 'neg'],
    ['Carried forward', line.previous_balance, 'warn'],
  ].filter(([, v]) => Number(v) !== 0);

  return (
    <Modal title={`Payslip · ${line.customer_name}`} onClose={onClose} footer={
      <>
        <button className="pay-btn" onClick={() => onPrint({ type: 'slip', line, run })}>🖨 Print Slip</button>
        <button className="pay-btn primary" onClick={onClose}>Close</button>
      </>
    }>
      <div className="pay-slip-head">
        <div>
          <div className="pay-emp-name">{line.customer_name}</div>
          <div className="pay-emp-sub">{line.employee_number} · {run.period_start} → {run.period_end}</div>
        </div>
        <span className={`pay-status ${line.settlement_status}`}>{line.settlement_status}</span>
      </div>

      <div className="pay-slip-days">
        <div><span>{line.days_full}</span>full</div>
        <div><span>{line.days_half}</span>half</div>
        <div><span className="neg">{line.days_absent}</span>absent</div>
        <div><span>{line.days_leave}</span>leave</div>
        <div><span>{line.days_off}</span>off</div>
        <div><span>{Number(line.payable_days).toFixed(1)}</span>payable / {line.basis_days}</div>
      </div>

      <div className="pay-slip-rows">
        {rows.map(([label, value, tone]) => (
          <div className="pay-slip-row" key={label}>
            <span>{label}</span>
            <strong className={tone}>{signed(value)}</strong>
          </div>
        ))}
        <div className="pay-slip-row total">
          <span>Net pay</span>
          <strong>{money(line.net_pay)}</strong>
        </div>
      </div>

      {line.settlement_note && <p className="pay-hint">Note: {line.settlement_note}</p>}
    </Modal>
  );
}

/* ════════════════ COMMISSION ════════════════ */

function Commission({ flash }) {
  const [rules, setRules] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    try { setRules((await API.get('/payroll/commission-rules')).data); }
    catch (e) { flash(errMsg(e), true); }
  }, [flash]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (rule) => {
    try {
      await API.put(`/payroll/commission-rules/${rule.id}`, { active: !rule.active });
      load();
    } catch (e) { flash(errMsg(e), true); }
  };

  const remove = async (rule) => {
    try { await API.delete(`/payroll/commission-rules/${rule.id}`); load(); }
    catch (e) { flash(errMsg(e), true); }
  };

  return (
    <>
      <div className="pay-toolbar">
        <div className="pay-headline"><strong>{rules.filter(r => r.active).length}</strong> active of {rules.length} rules</div>
        <div className="pay-spacer" />
        <button className="pay-btn primary" onClick={() => setEditing({})}>+ New rule</button>
      </div>

      <p className="pay-hint">
        Rules describe how commission is earned. Amounts reach a payslip through commission imports
        posted against a run, so a rule can be edited without disturbing runs already generated.
      </p>

      {rules.length === 0 ? <div className="pay-empty">No commission rules defined.</div> : (
        <div className="pay-tablewrap">
          <table className="pay-table">
            <thead>
              <tr><th>Rule</th><th>Type</th><th className="num">Rate</th><th>Effective</th><th>State</th><th /></tr>
            </thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.id}>
                  <td className="pay-emp-name">{r.name}</td>
                  <td><span className="pay-chip">{r.rule_type}</span></td>
                  <td className="num strong">{r.rate_type === 'PERCENTAGE' ? `${r.rate_value}%` : money(r.rate_value)}</td>
                  <td className="muted">{r.effective_from}</td>
                  <td><span className={`pay-status ${r.active ? 'ACTIVE' : 'DISABLED'}`}>{r.active ? 'Active' : 'Disabled'}</span></td>
                  <td className="num pay-rowacts">
                    <button className="pay-btn-mini" onClick={() => setEditing(r)}>Edit</button>
                    <button className="pay-btn-mini" onClick={() => toggle(r)}>{r.active ? 'Disable' : 'Enable'}</button>
                    <button className="pay-btn-mini danger" onClick={() => remove(r)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <RuleEditor rule={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} flash={flash} />}
    </>
  );
}

function RuleEditor({ rule, onClose, onSaved, flash }) {
  const [form, setForm] = useState({
    name: rule.name || '',
    rule_type: rule.rule_type || 'PRODUCT',
    rate_type: rule.rate_type || 'PERCENTAGE',
    rate_value: rule.rate_value ?? '',
    effective_from: rule.effective_from || iso(new Date()),
    active: rule.active === undefined ? true : !!rule.active,
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim()) return flash('Rule name required', true);
    setBusy(true);
    try {
      if (rule.id) await API.put(`/payroll/commission-rules/${rule.id}`, form);
      else await API.post('/payroll/commission-rules', form);
      flash('Rule saved');
      onSaved();
    } catch (e) { flash(errMsg(e), true); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={rule.id ? 'Edit commission rule' : 'New commission rule'} onClose={onClose} footer={
      <>
        <button className="pay-btn" onClick={onClose}>Cancel</button>
        <button className="pay-btn primary" onClick={save} disabled={busy}>Save rule</button>
      </>
    }>
      <div className="pay-form grid2">
        <label className="span2">Name<input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Cake upsell commission" /></label>
        <label>Applies to
          <select value={form.rule_type} onChange={e => set('rule_type', e.target.value)}>
            {RULE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>Rate type
          <select value={form.rate_type} onChange={e => set('rate_type', e.target.value)}>
            {RATE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>Rate value
          <input type="number" min="0" step="0.01" value={form.rate_value} onChange={e => set('rate_value', e.target.value)} />
        </label>
        <label>Effective from
          <input type="date" value={form.effective_from} onChange={e => set('effective_from', e.target.value)} />
        </label>
        <label className="pay-check span2">
          <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} />
          Rule is active
        </label>
      </div>
    </Modal>
  );
}

/* ════════════════ SETTINGS ════════════════ */

function Settings({ flash }) {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    API.get('/payroll/settings').then(r => setS(r.data)).catch(e => flash(errMsg(e), true));
  }, [flash]);

  const set = (k, v) => setS(p => ({ ...p, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      const r = await API.put('/payroll/settings', s);
      setS(r.data);
      flash('Settings saved');
    } catch (e) { flash(errMsg(e), true); }
    finally { setBusy(false); }
  };

  if (!s) return <div className="pay-empty">Loading…</div>;

  return (
    <section className="pay-panel narrow">
      <div className="pay-panel-head"><h3>Payroll rules</h3></div>
      <p className="pay-hint">
        These drive every run generated from now on. Existing draft runs pick them up on recalculate;
        finalized runs keep the figures they were locked with.
      </p>

      <div className="pay-form grid2">
        <label>Salary cutoff day
          <input type="number" min="1" max="31" value={s.salary_cutoff_day} onChange={e => set('salary_cutoff_day', e.target.value)} />
        </label>
        <label>Days basis
          <select value={s.days_basis} onChange={e => set('days_basis', e.target.value)}>
            <option value="FIXED">Fixed days per month</option>
            <option value="CALENDAR">Actual calendar days</option>
          </select>
        </label>
        <label>Fixed days
          <input type="number" min="1" max="31" value={s.fixed_days} disabled={s.days_basis !== 'FIXED'}
            onChange={e => set('fixed_days', e.target.value)} />
        </label>
        <label>Half-day pays
          <input type="number" min="0" max="1" step="0.05" value={s.half_day_factor} onChange={e => set('half_day_factor', e.target.value)} />
        </label>
        <label className="pay-check span2">
          <input type="checkbox" checked={!!s.deduct_absent} onChange={e => set('deduct_absent', e.target.checked)} />
          Deduct pay for absent and half days
        </label>
        <label className="pay-check span2">
          <input type="checkbox" checked={!!s.deduct_staff_purchases} onChange={e => set('deduct_staff_purchases', e.target.checked)} />
          Recover staff purchases from salary
        </label>
        <label className="pay-check span2">
          <input type="checkbox" checked={!!s.carry_unsettled} onChange={e => set('carry_unsettled', e.target.checked)} />
          Carry unsettled pay from earlier finalized runs into the next run
        </label>
      </div>

      <button className="pay-btn primary" onClick={save} disabled={busy}>Save settings</button>
    </section>
  );
}

/* ════════════════ 80MM PRINT ════════════════ */

function PrintSlip({ line, run }) {
  const rows = [
    ['Base salary', line.base_salary],
    ['Attendance adj.', line.attendance_adjustment],
    ['Commission', line.commission_amount],
    ['Bonus', line.bonus_amount],
    ['Penalty', -line.penalty_amount],
    ['Staff purchase', -line.staff_purchase_deduction],
    ['Advance recovered', -line.advance_deduction],
    ['Carried forward', line.previous_balance],
  ].filter(([, v]) => Number(v) !== 0);

  return (
    <div className="pay-print-block pay-print-80">
      <div className="pp-center pp-bold pp-lg">MTC Studio</div>
      <div className="pp-center pp-sm">Payroll Slip</div>
      <div className="pp-dashed" />
      <div className="pp-kv"><span>Emp Code</span><span className="pp-bold">{line.employee_number}</span></div>
      <div className="pp-kv"><span>Name</span><span className="pp-bold">{line.customer_name}</span></div>
      <div className="pp-kv"><span>Period</span><span>{run.period_start} – {run.period_end}</span></div>
      <div className="pp-kv"><span>Status</span><span>{line.settlement_status}</span></div>
      <div className="pp-dashed" />
      <div className="pp-kv"><span>Payable days</span><span>{Number(line.payable_days).toFixed(1)} / {line.basis_days}</span></div>
      <div className="pp-kv"><span>Absent / Half</span><span>{line.days_absent}A · {line.days_half}H</span></div>
      <div className="pp-dashed" />
      {rows.map(([label, value]) => (
        <div className="pp-kv" key={label}><span>{label}</span><span>{signed(value)}</span></div>
      ))}
      <div className="pp-double" />
      <div className="pp-kv pp-bold pp-lg"><span>NET PAY</span><span>{money(line.net_pay)}</span></div>
      <div className="pp-dashed" />
      <div className="pp-center pp-sm">Printed {new Date().toLocaleString('en-IN')}</div>
    </div>
  );
}

function PrintRegister({ lines, run }) {
  const total = lines.reduce((a, l) => a + Number(l.net_pay), 0);
  return (
    <div className="pay-print-block pay-print-80">
      <div className="pp-center pp-bold pp-lg">MTC Studio</div>
      <div className="pp-center pp-sm">Payroll Register</div>
      <div className="pp-center pp-sm">{run.period_start} – {run.period_end}</div>
      <div className="pp-dashed" />
      {lines.map(l => (
        <div className="pp-kv" key={l.id}><span>{l.customer_name}</span><span>{money(l.net_pay)}</span></div>
      ))}
      <div className="pp-double" />
      <div className="pp-kv pp-bold"><span>TOTAL ({lines.length})</span><span>{money(total)}</span></div>
      <div className="pp-dashed" />
      <div className="pp-center pp-sm">Printed {new Date().toLocaleString('en-IN')}</div>
    </div>
  );
}

/* ════════════════ SHARED ════════════════ */

function Stat({ label, value, sub, tone }) {
  return (
    <div className={`pay-stat${tone ? ' ' + tone : ''}`}>
      <div className="pay-stat-v">{value}</div>
      <div className="pay-stat-l">{label}</div>
      {sub && <div className="pay-stat-s">{sub}</div>}
    </div>
  );
}

function Modal({ title, children, footer, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="pay-root" style={{ display: 'contents' }}>
    <div className="pay-modal-overlay" onClick={onClose}>
      <div className="pay-modal" onClick={e => e.stopPropagation()}>
        <div className="pay-modal-head">
          <h3>{title}</h3>
          <button className="pay-btn-x" onClick={onClose}>✕</button>
        </div>
        <div className="pay-modal-body">{children}</div>
        <div className="pay-modal-foot">{footer}</div>
      </div>
    </div>
    </div>,
    document.querySelector('.desktop-root') || document.body
  );
}

function Confirm({ title, body, danger, onCancel, onConfirm }) {
  return (
    <Modal title={title} onClose={onCancel} footer={
      <>
        <button className="pay-btn" onClick={onCancel}>Cancel</button>
        <button className={`pay-btn ${danger ? 'danger-solid' : 'primary'}`} onClick={onConfirm}>Confirm</button>
      </>
    }>
      <p className="pay-hint">{body}</p>
    </Modal>
  );
}
