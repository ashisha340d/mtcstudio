import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import MediaPicker from '../../components/MediaPicker/MediaPicker';
import Payroll from '../Payroll/Payroll';
import './HR.css';

const API = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

const LOGO = '/public/img/logo.png';

const TABS = ['Overview', 'Directory', 'Attendance', 'Salary', 'Adjustments', 'Payroll'];

const STATUSES = [
  { key: 'active', label: 'Active' },
  { key: 'on_leave', label: 'On Leave' },
  { key: 'inactive', label: 'Inactive' },
  { key: 'terminated', label: 'Terminated' },
];

/* Attendance codes cycle in this order when a grid cell is clicked. The blank
   entry is the resting state — an unmarked day is a normal worked day. */
const CODES = [
  { key: '', label: '—', name: 'Unmarked' },
  { key: 'FULL', label: 'F', name: 'Full day' },
  { key: 'HALF', label: 'H', name: 'Half day' },
  { key: 'ABSENT', label: 'A', name: 'Absent' },
  { key: 'LEAVE', label: 'L', name: 'Leave' },
  { key: 'OFF', label: 'O', name: 'Weekly off' },
];

const KINDS = [
  { key: 'BONUS', label: 'Bonus', sign: '+' },
  { key: 'PENALTY', label: 'Penalty', sign: '−' },
  { key: 'ADVANCE', label: 'Advance', sign: '−' },
];

const money = (n) => 'Rs ' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const today = () => new Date().toISOString().slice(0, 10);
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const errMsg = (e) => e?.response?.data?.error || e?.message || 'Request failed';
const photoUrl = (row) => (row?.photo_filename ? `/uploads/${row.photo_filename}` : null);

/* Shared field behaviours the whole module opts into:
   focus selects the existing value so typing replaces it, and Enter walks to
   the next control instead of doing nothing in a form with no submit button. */
const selectAll = (e) => e.target.select();

function advanceOnEnter(e) {
  if (e.key !== 'Enter' || e.shiftKey) return;
  if (e.target.tagName === 'TEXTAREA') return;
  const form = e.target.closest('.hr-form-scope');
  if (!form) return;
  e.preventDefault();
  const fields = [...form.querySelectorAll('input:not([type=hidden]), select, textarea, button.hr-submit')]
    .filter(el => !el.disabled && el.offsetParent !== null);
  const next = fields[fields.indexOf(e.target) + 1];
  if (!next) return;
  next.focus();
  if (next.select) next.select();
}

/** Deterministic hue per employee so avatars stay stable across reloads. */
function avatarHue(seed) {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function monthDays(year, month) {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => {
    const d = new Date(Date.UTC(year, month, i + 1));
    return {
      date: d.toISOString().slice(0, 10),
      day: i + 1,
      dow: d.getUTCDay(),
    };
  });
}

/* ════════════════════════════════════════════════════════════ */

export default function HR() {
  const [tab, setTab] = useState('Overview');
  const [employees, setEmployees] = useState([]);
  const [summary, setSummary] = useState(null);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);

  const flash = useCallback((msg, err = false) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 2800);
  }, []);

  const loadEmployees = useCallback(async () => {
    try {
      const [emp, sum] = await Promise.all([API.get('/hr/employees'), API.get('/hr/summary')]);
      setEmployees(emp.data);
      setSummary(sum.data);
    } catch (e) {
      flash(errMsg(e), true);
    } finally {
      setLoading(false);
    }
  }, [flash]);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);

  return (
    <div className="hr-root">
      <header className="hr-topbar">
        <div className="hr-brand">
          <span className="hr-brand-mark">HR</span>
          <div>
            <h2>People &amp; Attendance</h2>
            <p>{summary ? `${summary.staff.active} active of ${summary.staff.total} on staff` : 'Loading team…'}</p>
          </div>
        </div>
        <nav className="hr-tabs">
          {TABS.map(t => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>
          ))}
        </nav>
      </header>

      <div className="hr-content">
        {loading && <div className="hr-empty">Loading…</div>}
        {!loading && tab === 'Overview' && <Overview summary={summary} employees={employees} onGo={setTab} />}
        {!loading && tab === 'Directory' && <Directory employees={employees} reload={loadEmployees} flash={flash} />}
        {!loading && tab === 'Attendance' && <Attendance employees={employees} flash={flash} />}
        {!loading && tab === 'Salary' && <Salary employees={employees} reload={loadEmployees} flash={flash} />}
        {!loading && tab === 'Adjustments' && <Adjustments employees={employees} reload={loadEmployees} flash={flash} />}
        {!loading && tab === 'Payroll' && <Payroll embedded />}
      </div>

      {toast && <div className={`hr-toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}

/* ════════════════ OVERVIEW ════════════════ */

function Overview({ summary, employees, onGo }) {
  if (!summary) return <div className="hr-empty">No data.</div>;
  const att = summary.attendance;
  const recent = [...employees].sort((a, b) => (b.join_date || '').localeCompare(a.join_date || '')).slice(0, 6);
  const byDept = employees.reduce((acc, e) => {
    const k = e.department || 'Unassigned';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const deptMax = Math.max(1, ...Object.values(byDept));

  return (
    <>
      <div className="hr-stats">
        <Stat label="Active Staff" value={summary.staff.active} sub={`${summary.staff.total} total profiles`} tone="accent" />
        <Stat label="Days Present" value={att.present} sub={`of ${att.possible} possible · ${(att.rate * 100).toFixed(0)}%`} tone="ok" />
        <Stat label="Days Absent" value={att.absent} sub={`${att.half} half · ${att.leave} leave`} tone={att.absent ? 'danger' : ''} />
        <Stat label="Monthly Payroll" value={money(summary.monthly_cost)} sub="current salaries, active staff" />
        <Stat label="On Leave" value={summary.staff.on_leave} sub={`${summary.staff.inactive} inactive`} />
        <Stat label="Pending Advances" value={money(summary.pending.advances)} sub="not yet deducted" tone="warn" />
        <Stat label="Pending Bonuses" value={money(summary.pending.bonuses)} sub={`penalties ${money(summary.pending.penalties)}`} />
        <Stat label="Unsettled Pay" value={money(summary.unsettled.amount)} sub={`${summary.unsettled.lines} payslips`} tone="danger" />
      </div>

      <section className="hr-panel">
        <div className="hr-panel-head">
          <h3>Attendance · month to date</h3>
          <span className="hr-muted">{att.days_elapsed} day{att.days_elapsed === 1 ? '' : 's'} elapsed in {att.month}</span>
        </div>
        <div className="hr-attbar" title={`${att.present} present of ${att.possible} possible staff-days`}>
          {[['present', att.present], ['half', att.half], ['leave', att.leave], ['off', att.off], ['absent', att.absent]]
            .filter(([, n]) => n > 0)
            .map(([k, n]) => <div key={k} className={`hr-attbar-seg ${k}`} style={{ flexGrow: n }} title={`${n} ${k}`} />)}
          {att.possible === 0 && <div className="hr-attbar-seg empty" style={{ flexGrow: 1 }} />}
        </div>
        <div className="hr-attkeys">
          {[['present', att.present], ['half', att.half], ['absent', att.absent], ['leave', att.leave], ['off', att.off]].map(([k, n]) => (
            <button key={k} className="hr-attkey" onClick={() => onGo('Attendance')}>
              <i className={`hr-swatch ${k}`} /><strong>{n}</strong>{k}
            </button>
          ))}
        </div>
      </section>

      <div className="hr-cols">
        <section className="hr-panel">
          <div className="hr-panel-head"><h3>Headcount by department</h3></div>
          {Object.keys(byDept).length === 0 && <div className="hr-empty">No employees yet.</div>}
          {Object.entries(byDept).sort((a, b) => b[1] - a[1]).map(([dept, n]) => (
            <div className="hr-meter" key={dept}>
              <span className="hr-meter-l">{dept}</span>
              <div className="hr-meter-track"><div className="hr-meter-fill" style={{ width: `${(n / deptMax) * 100}%` }} /></div>
              <span className="hr-meter-v">{n}</span>
            </div>
          ))}
        </section>

        <section className="hr-panel">
          <div className="hr-panel-head">
            <h3>Newest joiners</h3>
            <button className="hr-btn-mini" onClick={() => onGo('Directory')}>Open directory</button>
          </div>
          {recent.length === 0 && <div className="hr-empty">No employees yet.</div>}
          <div className="hr-mini-list">
            {recent.map(e => (
              <div className="hr-mini-row" key={e.customer_id}>
                <Avatar name={e.customer_name} seed={e.employee_number} />
                <div className="hr-mini-main">
                  <div className="hr-mini-name">{e.customer_name}</div>
                  <div className="hr-mini-sub">{e.designation || e.employee_number}</div>
                </div>
                <span className="hr-mini-date">{e.join_date}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function Stat({ label, value, sub, tone }) {
  return (
    <div className={`hr-stat${tone ? ' ' + tone : ''}`}>
      <div className="hr-stat-v">{value}</div>
      <div className="hr-stat-l">{label}</div>
      {sub && <div className="hr-stat-s">{sub}</div>}
    </div>
  );
}

function Avatar({ name, seed, size, photo }) {
  const hue = avatarHue(seed || name);
  const style = { '--av-h': hue, ...(size ? { width: size, height: size, fontSize: size / 2.7 } : null) };
  if (photo) return <span className="hr-avatar photo" style={style}><img src={photo} alt={name} /></span>;
  return <span className="hr-avatar" style={style}>{initials(name)}</span>;
}

function StatusPill({ status }) {
  return <span className={`hr-pill ${status}`}>{STATUSES.find(s => s.key === status)?.label || status}</span>;
}

/* ════════════════ DIRECTORY ════════════════ */

function Directory({ employees, reload, flash }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [detail, setDetail] = useState(null);   // customer_id
  const [adding, setAdding] = useState(false);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return employees.filter(e => {
      if (filter && e.status !== filter) return false;
      if (!needle) return true;
      return [e.customer_name, e.employee_number, e.customer_phone, e.department, e.designation]
        .some(v => String(v || '').toLowerCase().includes(needle));
    });
  }, [employees, q, filter]);

  return (
    <>
      <div className="hr-toolbar">
        <input className="hr-search" placeholder="Search name, number, phone, department…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="hr-segment">
          <button className={filter === '' ? 'on' : ''} onClick={() => setFilter('')}>All</button>
          {STATUSES.map(s => (
            <button key={s.key} className={filter === s.key ? 'on' : ''} onClick={() => setFilter(s.key)}>{s.label}</button>
          ))}
        </div>
        <button className="hr-btn primary" onClick={() => setAdding(true)}>+ Add employee</button>
      </div>

      {shown.length === 0 && <div className="hr-empty">No employees match.</div>}

      <div className="hr-cards">
        {shown.map(e => (
          <button className="hr-card" key={e.customer_id} onClick={() => setDetail(e.customer_id)}
            style={{ '--av-h': avatarHue(e.employee_number || e.customer_name) }}>
            <div className="hr-card-band">
              <img className="hr-card-logo" src={LOGO} alt="MTC" />
              <StatusPill status={e.status} />
            </div>
            <div className="hr-card-portrait">
              <Avatar name={e.customer_name} seed={e.employee_number} size={72} photo={photoUrl(e)} />
            </div>
            <div className="hr-card-name">{e.customer_name}</div>
            <div className="hr-card-role">{e.designation || 'No designation'}</div>
            {e.department && <span className="hr-card-dept">{e.department}</span>}
            <div className="hr-card-foot">
              <span className="hr-code">{e.employee_number}</span>
              <span className="hr-card-salary">{e.current_salary ? money(e.current_salary) : '—'}</span>
            </div>
          </button>
        ))}
      </div>

      {adding && <AddEmployee onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} flash={flash} />}
      {detail && (
        <EmployeeDrawer
          customerId={detail}
          onClose={() => setDetail(null)}
          onChanged={reload}
          flash={flash}
        />
      )}
    </>
  );
}

/** Distinct department / designation values plus the server's date ceiling.
 *  The server clock is authoritative — a terminal with a skewed date must not
 *  be able to backdate or post-date staff records. */
function useTaxonomy() {
  const [tax, setTax] = useState({ departments: [], designations: [], today: today() });
  useEffect(() => { API.get('/hr/taxonomy').then(r => setTax(r.data)).catch(() => { }); }, []);
  return tax;
}

/** Free-text input backed by a suggestion list — pick an existing value or type
 *  a brand-new one. Used for department and designation. */
function Combo({ value, onChange, options, listId, placeholder }) {
  return (
    <>
      <input list={listId} value={value} placeholder={placeholder}
        onFocus={selectAll} onChange={e => onChange(e.target.value)} />
      <datalist id={listId}>
        {options.map(o => <option key={o} value={o} />)}
      </datalist>
    </>
  );
}

function AddEmployee({ onClose, onSaved, flash }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [picked, setPicked] = useState(null);
  const [form, setForm] = useState({
    employee_number: '', department: '', designation: '',
    join_date: today(), status: 'active', salary: '', notes: '',
    photo_media_id: null, photo_filename: null,
  });
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const tax = useTaxonomy();
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults([]); return; }
    timer.current = setTimeout(() => {
      API.get('/hr/candidates', { params: { q } }).then(r => setResults(r.data)).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timer.current);
  }, [q]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!picked) return flash('Pick a customer record first', true);
    if (!form.employee_number.trim()) return flash('Employee number required', true);
    if (form.join_date > tax.today) return flash('Join date cannot be in the future', true);
    setBusy(true);
    try {
      await API.post('/hr/employees', { customer_id: picked.id, ...form });
      flash(`${picked.name} added to staff`);
      onSaved();
    } catch (e) { flash(errMsg(e), true); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Add employee" onClose={onClose} footer={
      <>
        <button className="hr-btn" onClick={onClose}>Cancel</button>
        <button className="hr-btn primary" onClick={save} disabled={busy || !picked}>Add to staff</button>
      </>
    }>
      <p className="hr-hint">An employee is a customer record promoted to staff — search the CRM directory below.</p>

      {picked ? (
        <div className="hr-picked">
          <Avatar name={picked.name} seed={picked.phone} size={38} />
          <div className="hr-mini-main">
            <div className="hr-mini-name">{picked.name}</div>
            <div className="hr-mini-sub">{picked.phone}</div>
          </div>
          <button className="hr-btn-mini" onClick={() => setPicked(null)}>Change</button>
        </div>
      ) : (
        <>
          <input className="hr-search wide" autoFocus placeholder="Search customers by name or phone…" value={q} onChange={e => setQ(e.target.value)} />
          <div className="hr-picker">
            {q.trim().length < 2 && <div className="hr-empty small">Type at least 2 characters.</div>}
            {q.trim().length >= 2 && results.length === 0 && <div className="hr-empty small">No unassigned customer matches.</div>}
            {results.map(c => (
              <button className="hr-picker-row" key={c.id} onClick={() => setPicked(c)}>
                <Avatar name={c.name} seed={c.phone} size={30} />
                <span className="hr-mini-name">{c.name}</span>
                <span className="hr-mini-sub">{c.phone}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="hr-photorow">
        <Avatar name={picked?.name || '?'} seed={form.employee_number} size={58}
          photo={form.photo_filename ? `/uploads/${form.photo_filename}` : null} />
        <div className="hr-mini-main">
          <div className="hr-mini-name">Staff photo</div>
          <div className="hr-mini-sub">Stored in the media library under “Employee”.</div>
        </div>
        <button className="hr-btn-mini" onClick={() => setPicking(true)}>Choose…</button>
        {form.photo_media_id && (
          <button className="hr-btn-ghost danger" title="Remove photo"
            onClick={() => setForm(f => ({ ...f, photo_media_id: null, photo_filename: null }))}>✕</button>
        )}
      </div>

      <div className="hr-form grid2 hr-form-scope" onKeyDown={advanceOnEnter}>
        <label>Employee number
          <input value={form.employee_number} onFocus={selectAll} onChange={e => set('employee_number', e.target.value)} placeholder="EMP-001" />
        </label>
        <label>Join date
          <input type="date" max={tax.today} value={form.join_date} onChange={e => set('join_date', e.target.value)} />
        </label>
        <label>Department
          <Combo value={form.department} onChange={v => set('department', v)}
            options={tax.departments} listId="hr-dept-new" placeholder="Kitchen" />
        </label>
        <label>Designation
          <Combo value={form.designation} onChange={v => set('designation', v)}
            options={tax.designations} listId="hr-desig-new" placeholder="Line Cook" />
        </label>
        <label>Starting salary
          <input className="hr-money" type="number" min="0" value={form.salary}
            onFocus={selectAll} onChange={e => set('salary', e.target.value)} placeholder="0" />
        </label>
        <label>Status
          <select value={form.status} onChange={e => set('status', e.target.value)}>
            {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      </div>

      {picking && (
        <MediaPicker section="employee" onClose={() => setPicking(false)}
          onSelect={(item) => { setForm(f => ({ ...f, photo_media_id: item.id, photo_filename: item.filename })); setPicking(false); }} />
      )}
    </Modal>
  );
}

function EmployeeDrawer({ customerId, onClose, onChanged, flash }) {
  const [emp, setEmp] = useState(null);
  const [history, setHistory] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const tax = useTaxonomy();

  const load = useCallback(async () => {
    try {
      const [e, h] = await Promise.all([
        API.get(`/hr/employees/${customerId}`),
        API.get(`/hr/employees/${customerId}/salary-history`),
      ]);
      setEmp(e.data);
      setHistory(h.data);
      setDirty(false);
    } catch (e) { flash(errMsg(e), true); }
  }, [customerId, flash]);

  useEffect(() => { load(); }, [load]);

  const set = (k, v) => { setEmp(p => ({ ...p, [k]: v })); setDirty(true); };

  const save = async () => {
    if (emp.join_date > tax.today) return flash('Join date cannot be in the future', true);
    setBusy(true);
    try {
      await API.put(`/hr/employees/${customerId}`, emp);
      flash('Employee saved');
      setDirty(false);
      onChanged();
    } catch (e) { flash(errMsg(e), true); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await API.delete(`/hr/employees/${customerId}`);
      flash('Employee removed from staff');
      onChanged();
      onClose();
    } catch (e) { flash(errMsg(e), true); }
    finally { setBusy(false); }
  };

  return createPortal(
    <div className="hr-root" style={{ display: 'contents' }}>
    <div className="hr-drawer-overlay" onClick={onClose}>
      <aside className="hr-drawer" onClick={e => e.stopPropagation()}>
        {!emp ? <div className="hr-empty">Loading…</div> : (
          <>
            <header className="hr-drawer-head">
              <Avatar name={emp.customer_name} seed={emp.employee_number} size={52} photo={photoUrl(emp)} />
              <div className="hr-drawer-id">
                <h3>{emp.customer_name}</h3>
                <p>{emp.customer_phone} · joined {emp.join_date}</p>
              </div>
              <StatusPill status={emp.status} />
              <button className="hr-btn-x" onClick={onClose}>✕</button>
            </header>

            <div className="hr-drawer-body">
              <div className="hr-photorow">
                <Avatar name={emp.customer_name} seed={emp.employee_number} size={58} photo={photoUrl(emp)} />
                <div className="hr-mini-main">
                  <div className="hr-mini-name">Staff photo</div>
                  <div className="hr-mini-sub">{emp.photo_filename || 'No photo set'}</div>
                </div>
                <button className="hr-btn-mini" onClick={() => setPicking(true)}>Choose…</button>
                {emp.photo_media_id && (
                  <button className="hr-btn-ghost danger" title="Remove photo"
                    onClick={() => { setEmp(p => ({ ...p, photo_media_id: null, photo_filename: null })); setDirty(true); }}>✕</button>
                )}
              </div>

              <div className="hr-form grid2 hr-form-scope" onKeyDown={advanceOnEnter}>
                <label>Employee number
                  <input value={emp.employee_number || ''} onFocus={selectAll} onChange={e => set('employee_number', e.target.value)} />
                </label>
                <label>Join date
                  <input type="date" max={tax.today} value={emp.join_date || ''} onChange={e => set('join_date', e.target.value)} />
                </label>
                <label>Department
                  <Combo value={emp.department || ''} onChange={v => set('department', v)}
                    options={tax.departments} listId="hr-dept-edit" placeholder="Kitchen" />
                </label>
                <label>Designation
                  <Combo value={emp.designation || ''} onChange={v => set('designation', v)}
                    options={tax.designations} listId="hr-desig-edit" placeholder="Line Cook" />
                </label>
                <label className="span2">Status
                  <select value={emp.status || 'active'} onChange={e => set('status', e.target.value)}>
                    {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </label>
                <label className="span2">Notes
                  <textarea rows={3} value={emp.notes || ''} onChange={e => set('notes', e.target.value)} />
                </label>
              </div>

              <h4 className="hr-subhead">Salary history</h4>
              {history.length === 0 && <div className="hr-empty small">No salary recorded — set one from the Salary tab.</div>}
              <div className="hr-timeline">
                {history.map((h, i) => (
                  <div className={`hr-tl-item${i === 0 ? ' current' : ''}`} key={h.id}>
                    <div className="hr-tl-dot" />
                    <div className="hr-tl-body">
                      <div className="hr-tl-amount">{money(h.salary)}{i === 0 && <span className="hr-chip">current</span>}</div>
                      <div className="hr-tl-meta">from {h.effective_from}{h.notes ? ` · ${h.notes}` : ''}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <footer className="hr-drawer-foot">
              <button className="hr-btn danger" onClick={remove} disabled={busy}>Remove</button>
              <div className="hr-spacer" />
              <button className="hr-btn" onClick={onClose}>Close</button>
              <button className="hr-btn primary" onClick={save} disabled={!dirty || busy}>Save changes</button>
            </footer>

            {picking && (
              <MediaPicker section="employee" onClose={() => setPicking(false)}
                onSelect={(item) => {
                  setEmp(p => ({ ...p, photo_media_id: item.id, photo_filename: item.filename }));
                  setDirty(true);
                  setPicking(false);
                }} />
            )}
          </>
        )}
      </aside>
    </div>
    </div>,
    document.querySelector('.desktop-root') || document.body
  );
}

/* ════════════════ ATTENDANCE ════════════════ */

function Attendance({ employees, flash }) {
  const tax = useTaxonomy();
  const cutoff = tax.today;                      // server date — the hard ceiling
  const capYear = Number(cutoff.slice(0, 4));
  const capMonth = Number(cutoff.slice(5, 7)) - 1;
  const [year, setYear] = useState(capYear);
  const [month, setMonth] = useState(capMonth);
  const [marks, setMarks] = useState({});        // `${cid}|${date}` → code
  const [pending, setPending] = useState({});    // same key → code (unsaved)
  const [busy, setBusy] = useState(false);
  const [paintCode, setPaintCode] = useState('ABSENT');
  const [menu, setMenu] = useState(null);        // { x, y, cid, date }
  const [activeDate, setActiveDate] = useState(null); // the one column unlocked for editing
  const [warnDate, setWarnDate] = useState(null);      // backdate pending confirmation

  // The server clock lands after first paint — snap the view forward if the
  // component mounted on a stale local date.
  useEffect(() => { setYear(capYear); setMonth(capMonth); }, [capYear, capMonth]);
  // Switching months drops the unlocked column — re-pick deliberately each time.
  useEffect(() => { setActiveDate(null); setWarnDate(null); }, [year, month]);

  const days = useMemo(() => monthDays(year, month), [year, month]);
  const from = days[0].date;
  const to = days[days.length - 1].date;
  const staff = useMemo(() => employees.filter(e => e.status !== 'terminated'), [employees]);

  // Attendance records the past, never the future: no month beyond the current
  // one, and inside the current month no day beyond today.
  const atCapMonth = year === capYear && month === capMonth;
  const canGoForward = !atCapMonth;
  const isFuture = (date) => date > cutoff;
  const openDays = useMemo(() => days.filter(d => !isFuture(d.date)), [days, cutoff]); // eslint-disable-line

  const load = useCallback(async () => {
    try {
      const r = await API.get('/hr/attendance', { params: { from, to } });
      const map = {};
      r.data.forEach(a => { map[`${a.customer_id}|${String(a.attendance_date).slice(0, 10)}`] = a.attendance_code; });
      setMarks(map);
      setPending({});
    } catch (e) { flash(errMsg(e), true); }
  }, [from, to, flash]);

  useEffect(() => { load(); }, [load]);

  const codeAt = (cid, date) => {
    const k = `${cid}|${date}`;
    return k in pending ? pending[k] : (marks[k] || '');
  };

  const setCell = (cid, date, code) => {
    if (isFuture(date)) return;
    setPending(p => ({ ...p, [`${cid}|${date}`]: code }));
  };

  const cycle = (cid, date) => {
    // Click paints the selected code; clicking a cell that already holds it clears.
    setCell(cid, date, codeAt(cid, date) === paintCode ? '' : paintCode);
  };

  // Only the unlocked column may be bulk-cleared — same one-day-at-a-time rule
  // that gates every other edit.
  const fillRow = (cid) => {
    if (!activeDate) return;
    setCell(cid, activeDate, '');
  };

  // Clicking a column header's ✎ unlocks that single day for editing; every
  // other column stays locked. Today unlocks immediately, a past date warns
  // first since it rewrites history that payroll may already have used.
  const toggleActive = (date) => {
    if (isFuture(date)) return;
    if (date === activeDate) { setActiveDate(null); return; }
    if (date === cutoff) { setActiveDate(date); return; }
    setWarnDate(date);
  };

  const save = async () => {
    const cells = Object.entries(pending).map(([k, code]) => {
      const [customer_id, attendance_date] = k.split('|');
      return { customer_id: Number(customer_id), attendance_date, attendance_code: code || null };
    });
    if (!cells.length) return;
    setBusy(true);
    try {
      await API.post('/hr/attendance/bulk', { cells });
      flash(`${cells.length} day${cells.length === 1 ? '' : 's'} saved`);
      await load();
      setActiveDate(null);
    } catch (e) { flash(errMsg(e), true); }
    finally { setBusy(false); }
  };

  const shiftMonth = (delta) => {
    if (delta > 0 && !canGoForward) return;
    const d = new Date(Date.UTC(year, month + delta, 1));
    if (d.getUTCFullYear() > capYear || (d.getUTCFullYear() === capYear && d.getUTCMonth() > capMonth)) return;
    setYear(d.getUTCFullYear());
    setMonth(d.getUTCMonth());
  };

  const rowTotals = (cid) => {
    const t = { FULL: 0, HALF: 0, ABSENT: 0, LEAVE: 0, OFF: 0 };
    openDays.forEach(d => { const c = codeAt(cid, d.date); if (c) t[c]++; });
    // Unmarked elapsed days are worked days, so present = elapsed minus every
    // marked exception. Half days count as half a day present.
    t.PRESENT = openDays.length - t.HALF - t.ABSENT - t.LEAVE - t.OFF + t.HALF * 0.5;
    return t;
  };

  const dayClass = (d) => [
    d.dow === 6 || d.dow === 0 ? 'weekend' : '',
    isFuture(d.date) ? 'future' : '',
    !isFuture(d.date) && d.date !== activeDate ? 'locked' : '',
    d.date === activeDate ? 'active' : '',
    d.date === cutoff ? 'today' : '',
  ].filter(Boolean).join(' ');

  // Column total — how many of the team were present on that single day.
  const dayPresent = (date) => {
    let n = 0;
    staff.forEach(e => {
      const c = codeAt(e.customer_id, date);
      if (c === 'ABSENT' || c === 'LEAVE' || c === 'OFF') return;
      n += c === 'HALF' ? 0.5 : 1;
    });
    return n;
  };

  // Right-click a cell for the full code list without changing the paint colour.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', close);
    };
  }, [menu]);

  const pendingCount = Object.keys(pending).length;
  const monthLabel = new Date(Date.UTC(year, month, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <>
      <div className="hr-toolbar">
        <div className="hr-monthnav">
          <button className="hr-btn-mini" onClick={() => shiftMonth(-1)}>‹</button>
          <span className="hr-month">{monthLabel}</span>
          <button className="hr-btn-mini" onClick={() => shiftMonth(1)} disabled={!canGoForward}
            title={canGoForward ? 'Next month' : 'Current payroll month — attendance cannot be marked ahead'}>›</button>
        </div>
        <div className="hr-paint">
          <span className="hr-paint-l">Paint</span>
          {CODES.filter(c => c.key).map(c => (
            <button key={c.key} title={c.name}
              className={`hr-code-btn ${c.key}${paintCode === c.key ? ' on' : ''}`}
              onClick={() => setPaintCode(c.key)}>{c.label}</button>
          ))}
        </div>
        <div className="hr-spacer" />
        {pendingCount > 0 && <span className="hr-dirty">{pendingCount} unsaved</span>}
        <button className="hr-btn" onClick={load} disabled={busy}>Reset</button>
        <button className="hr-btn primary" onClick={save} disabled={busy || !pendingCount}>Save attendance</button>
      </div>

      {staff.length === 0 ? <div className="hr-empty">Add employees before marking attendance.</div> : (
        <div className="hr-gridwrap">
          <table className="hr-grid">
            <thead>
              <tr>
                <th className="hr-sticky-l">Employee</th>
                {days.map(d => (
                  <th key={d.date} className={dayClass(d)}>
                    <span className="hr-dow">{'SMTWTFS'[d.dow]}</span>
                    {d.day}
                    {!isFuture(d.date) && (
                      <button type="button" className={`hr-col-record${d.date === activeDate ? ' on' : ''}`}
                        onClick={() => toggleActive(d.date)}
                        title={d.date === activeDate ? `Lock ${d.date} again`
                          : d.date === cutoff ? `Record attendance for today`
                          : `Record attendance for ${d.date} — a past date`}>
                        {d.date === activeDate ? '🔓' : '✎'}
                      </button>
                    )}
                  </th>
                ))}
                <th className="hr-sticky-r">Summary</th>
              </tr>
            </thead>
            <tbody>
              {staff.map(e => {
                const t = rowTotals(e.customer_id);
                return (
                  <tr key={e.customer_id}>
                    <td className="hr-sticky-l">
                      <div className="hr-grid-emp">
                        <Avatar name={e.customer_name} seed={e.employee_number} size={26} photo={photoUrl(e)} />
                        <div>
                          <div className="hr-mini-name">{e.customer_name}</div>
                          <div className="hr-mini-sub">{e.employee_number}</div>
                        </div>
                        <button className="hr-btn-ghost" title={activeDate ? `Clear ${activeDate} for this row` : 'Unlock a day first — click ✎ on a column header'}
                          disabled={!activeDate} onClick={() => fillRow(e.customer_id)}>⟲</button>
                      </div>
                    </td>
                    {days.map(d => {
                      const code = codeAt(e.customer_id, d.date);
                      const isPending = `${e.customer_id}|${d.date}` in pending;
                      const editable = !isFuture(d.date) && d.date === activeDate;
                      return (
                        <td key={d.date} className={dayClass(d)}>
                          <button
                            className={`hr-cell ${code || 'none'}${isPending ? ' pending' : ''}`}
                            disabled={!editable}
                            onClick={() => cycle(e.customer_id, d.date)}
                            onContextMenu={(ev) => {
                              if (!editable) return;
                              ev.preventDefault();
                              setMenu({ x: ev.clientX, y: ev.clientY, cid: e.customer_id, date: d.date, name: e.customer_name });
                            }}
                            title={isFuture(d.date) ? `${d.date} — future date, not markable`
                              : !editable ? `${d.date} — click ✎ in the column header to unlock`
                              : `${d.date} — ${CODES.find(c => c.key === code)?.name || 'Unmarked'} · right-click for all codes`}>
                            {CODES.find(c => c.key === code)?.label || ''}
                          </button>
                        </td>
                      );
                    })}
                    <td className="hr-sticky-r">
                      <div className="hr-totals">
                        <span className="t-present" title="Days present (half days count as 0.5)">{Number(t.PRESENT.toFixed(1))}P</span>
                        <span className="t-absent" title="Absent">{t.ABSENT}A</span>
                        <span className="t-half" title="Half days">{t.HALF}H</span>
                        <span className="t-leave" title="Leave">{t.LEAVE}L</span>
                        <span className="t-off" title="Weekly off">{t.OFF}O</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="hr-grid-totalrow">
                <td className="hr-sticky-l">Present / day</td>
                {days.map(d => (
                  <td key={d.date} className={dayClass(d)}>
                    {isFuture(d.date) ? '' : Number(dayPresent(d.date).toFixed(1))}
                  </td>
                ))}
                <td className="hr-sticky-r" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="hr-legend">
        {CODES.filter(c => c.key).map(c => (
          <span key={c.key}><i className={`hr-swatch ${c.key}`} />{c.name}</span>
        ))}
        <span className="hr-legend-note">Unmarked days count as worked · click ✎ on a column header to unlock that day · right-click a cell for all codes · nothing past {cutoff}.</span>
      </div>

      {menu && (
        <div className="hr-ctxmenu" style={{ left: menu.x, top: menu.y }} onClick={e => e.stopPropagation()}>
          <div className="hr-ctxmenu-head">{menu.name}<span>{menu.date}</span></div>
          {CODES.map(c => (
            <button key={c.key || 'clear'} className={`hr-ctxmenu-item ${c.key || 'none'}`}
              onClick={() => { setCell(menu.cid, menu.date, c.key); if (c.key) setPaintCode(c.key); setMenu(null); }}>
              <i className={`hr-swatch ${c.key}`} />{c.name}
              <em>{c.label}</em>
            </button>
          ))}
        </div>
      )}

      {warnDate && (
        <Modal title="Editing a past date" onClose={() => setWarnDate(null)} footer={
          <>
            <button className="hr-btn" onClick={() => setWarnDate(null)}>Cancel</button>
            <button className="hr-btn primary" onClick={() => { setActiveDate(warnDate); setWarnDate(null); }}>Unlock {warnDate}</button>
          </>
        }>
          <p className="hr-hint">
            {warnDate} is a past date. Changing it rewrites history that payroll may already
            have used — only continue if you're correcting a mistake.
          </p>
        </Modal>
      )}
    </>
  );
}

/* ════════════════ SALARY ════════════════ */

function Salary({ employees, reload, flash }) {
  const [sel, setSel] = useState(employees[0]?.customer_id ?? null);
  const [history, setHistory] = useState([]);
  const [form, setForm] = useState({ effective_from: today(), salary: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const tax = useTaxonomy();

  const load = useCallback(async (cid) => {
    if (!cid) return setHistory([]);
    try {
      const r = await API.get(`/hr/employees/${cid}/salary-history`);
      setHistory(r.data);
    } catch (e) { flash(errMsg(e), true); }
  }, [flash]);

  useEffect(() => { load(sel); }, [sel, load]);

  const emp = employees.find(e => e.customer_id === sel);

  const save = async () => {
    if (!sel) return;
    if (!(parseFloat(form.salary) >= 0)) return flash('Enter a salary amount', true);
    setBusy(true);
    try {
      await API.post(`/hr/employees/${sel}/salary-history`, form);
      flash('Salary revision recorded');
      setForm({ effective_from: today(), salary: '', notes: '' });
      await load(sel);
      reload();
    } catch (e) { flash(errMsg(e), true); }
    finally { setBusy(false); }
  };

  const remove = async (id) => {
    setBusy(true);
    try {
      await API.delete(`/hr/salary-history/${id}`);
      await load(sel);
      reload();
    } catch (e) { flash(errMsg(e), true); }
    finally { setBusy(false); }
  };

  return (
    <div className="hr-split">
      <aside className="hr-sidelist">
        {employees.map(e => (
          <button key={e.customer_id} className={`hr-side-row${sel === e.customer_id ? ' on' : ''}`} onClick={() => setSel(e.customer_id)}>
            <Avatar name={e.customer_name} seed={e.employee_number} size={30} photo={photoUrl(e)} />
            <div className="hr-mini-main">
              <div className="hr-mini-name">{e.customer_name}</div>
              <div className="hr-mini-sub">{e.current_salary ? money(e.current_salary) : 'unset'}</div>
            </div>
          </button>
        ))}
        {employees.length === 0 && <div className="hr-empty small">No employees.</div>}
      </aside>

      <section className="hr-panel">
        {!emp ? <div className="hr-empty">Select an employee.</div> : (
          <>
            <div className="hr-panel-head">
              <h3>{emp.customer_name} — salary</h3>
              <span className="hr-code">{emp.employee_number}</span>
            </div>

            <div className="hr-form grid3 hr-form-scope" onKeyDown={advanceOnEnter}>
              <label>Effective from
                <input type="date" max={tax.today} value={form.effective_from} onChange={e => setForm(f => ({ ...f, effective_from: e.target.value }))} />
              </label>
              <label>Monthly salary
                <input className="hr-money" type="number" min="0" value={form.salary} onFocus={selectAll}
                  onChange={e => setForm(f => ({ ...f, salary: e.target.value }))} placeholder="0" />
              </label>
              <label>Note
                <input value={form.notes} onFocus={selectAll} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Annual revision" />
              </label>
              <button className="hr-btn primary hr-submit span3" onClick={save} disabled={busy}>Record revision</button>
            </div>

            <h4 className="hr-subhead">History</h4>
            {history.length === 0 && <div className="hr-empty small">No salary recorded yet.</div>}
            <div className="hr-timeline">
              {history.map((h, i) => (
                <div className={`hr-tl-item${i === 0 ? ' current' : ''}`} key={h.id}>
                  <div className="hr-tl-dot" />
                  <div className="hr-tl-body">
                    <div className="hr-tl-amount">
                      {money(h.salary)}
                      {i === 0 && <span className="hr-chip">current</span>}
                      <button className="hr-btn-ghost danger" onClick={() => remove(h.id)} title="Delete revision">✕</button>
                    </div>
                    <div className="hr-tl-meta">from {h.effective_from}{h.notes ? ` · ${h.notes}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/* ════════════════ ADJUSTMENTS ════════════════ */

function Adjustments({ employees, reload, flash }) {
  const [rows, setRows] = useState([]);
  const [pendingOnly, setPendingOnly] = useState(true);
  const [form, setForm] = useState({ customer_id: '', kind: 'BONUS', amount: '', adj_date: today(), note: '' });
  const [busy, setBusy] = useState(false);
  const tax = useTaxonomy();

  const load = useCallback(async () => {
    try {
      const r = await API.get('/hr/adjustments', { params: pendingOnly ? { pending: 1 } : {} });
      setRows(r.data);
    } catch (e) { flash(errMsg(e), true); }
  }, [pendingOnly, flash]);

  useEffect(() => { load(); }, [load]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const add = async () => {
    if (!form.customer_id) return flash('Pick an employee', true);
    if (!(parseFloat(form.amount) > 0)) return flash('Amount must be greater than zero', true);
    setBusy(true);
    try {
      await API.post('/hr/adjustments', form);
      flash('Adjustment recorded');
      setForm({ customer_id: '', kind: form.kind, amount: '', adj_date: today(), note: '' });
      await load();
      reload();
    } catch (e) { flash(errMsg(e), true); }
    finally { setBusy(false); }
  };

  const remove = async (id) => {
    setBusy(true);
    try {
      await API.delete(`/hr/adjustments/${id}`);
      await load();
      reload();
    } catch (e) { flash(errMsg(e), true); }
    finally { setBusy(false); }
  };

  const totals = KINDS.map(k => ({
    ...k,
    total: rows.filter(r => r.kind === k.key).reduce((s, r) => s + Number(r.amount), 0),
  }));

  return (
    <>
      <div className="hr-stats compact">
        {totals.map(t => <Stat key={t.key} label={t.label} value={money(t.total)} sub={pendingOnly ? 'awaiting payroll' : 'in range'} />)}
      </div>

      <section className="hr-panel">
        <div className="hr-panel-head"><h3>Record an adjustment</h3></div>
        <div className="hr-form grid5 hr-form-scope" onKeyDown={advanceOnEnter}>
          <label>Employee
            <select value={form.customer_id} onChange={e => set('customer_id', e.target.value)}>
              <option value="">Select…</option>
              {employees.map(e => <option key={e.customer_id} value={e.customer_id}>{e.customer_name} ({e.employee_number})</option>)}
            </select>
          </label>
          <label>Type
            <select value={form.kind} onChange={e => set('kind', e.target.value)}>
              {KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </label>
          <label>Amount
            <input className="hr-money" type="number" min="0" value={form.amount} onFocus={selectAll}
              onChange={e => set('amount', e.target.value)} placeholder="0" />
          </label>
          <label>Date
            <input type="date" max={tax.today} value={form.adj_date} onChange={e => set('adj_date', e.target.value)} />
          </label>
          <label>Note
            <input value={form.note} onFocus={selectAll} onChange={e => set('note', e.target.value)} placeholder="Festival bonus" />
          </label>
          <button className="hr-btn primary hr-submit" onClick={add} disabled={busy}>Add adjustment</button>
        </div>
      </section>

      <section className="hr-panel">
        <div className="hr-panel-head">
          <h3>Ledger</h3>
          <label className="hr-check">
            <input type="checkbox" checked={pendingOnly} onChange={e => setPendingOnly(e.target.checked)} />
            Pending only
          </label>
        </div>
        {rows.length === 0 ? <div className="hr-empty small">Nothing recorded.</div> : (
          <table className="hr-table">
            <thead>
              <tr><th>Date</th><th>Employee</th><th>Type</th><th className="num">Amount</th><th>Note</th><th>State</th><th /></tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const kind = KINDS.find(k => k.key === r.kind);
                return (
                  <tr key={r.id}>
                    <td>{r.adj_date}</td>
                    <td>{r.customer_name} <span className="hr-muted">{r.employee_number}</span></td>
                    <td><span className={`hr-pill kind-${r.kind}`}>{kind?.label || r.kind}</span></td>
                    <td className={`num ${r.kind === 'BONUS' ? 'pos' : 'neg'}`}>{kind?.sign}{money(r.amount)}</td>
                    <td className="hr-muted">{r.note || '—'}</td>
                    <td>{r.payroll_run_id ? <span className="hr-chip">run #{r.payroll_run_id}</span> : <span className="hr-chip warn">pending</span>}</td>
                    <td className="num">
                      {!r.payroll_run_id && <button className="hr-btn-ghost danger" onClick={() => remove(r.id)}>✕</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

/* ════════════════ SHARED ════════════════ */

function Modal({ title, children, footer, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="hr-root" style={{ display: 'contents' }}>
    <div className="hr-modal-overlay" onClick={onClose}>
      <div className="hr-modal" onClick={e => e.stopPropagation()}>
        <div className="hr-modal-head">
          <h3>{title}</h3>
          <button className="hr-btn-x" onClick={onClose}>✕</button>
        </div>
        <div className="hr-modal-body">{children}</div>
        <div className="hr-modal-foot">{footer}</div>
      </div>
    </div>
    </div>,
    document.querySelector('.desktop-root') || document.body
  );
}
