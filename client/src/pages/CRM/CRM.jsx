import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import axios from 'axios';
import GoogleSync from './GoogleSync';
import GoogleAccountChip from './GoogleAccountChip';
import AddressCardsModal from './AddressCardsModal';
import TagBar from './TagBar';
import MergeModal from './MergeModal';
import MergeManyModal from './MergeManyModal';
import useResizableColumns from '../../hooks/useResizableColumns';
import './CRM.css';

const API = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

const BLANK = {
  phone: '', phone2: '', country_code: '', name: '', company_name: '', job_title: '', address: '',
  birthday: '', anniversary: '', email: '', email2: '', notes: ''
};

// Accepts an optional leading "+<country code>" then digits.
function isValidPhoneInput(v) { return /^\+?\d{7,15}$/.test(String(v || '').trim()); }

const TIERS = ['standard', 'silver', 'gold', 'platinum'];
const TIER_CLASS = { standard: 'crm-badge--standard', silver: 'crm-badge--silver', gold: 'crm-badge--gold', platinum: 'crm-badge--platinum' };

const TABS = [
  { key: 'customers', label: '👥 Customers' },
  { key: 'birthdays', label: '🎂 Birthdays' },
];

// Customer grid columns. `essential` ones can't be hidden. Order here is the
// render order for both header and body.
const COLUMNS = [
  { key: 'phone',               label: 'Phone',            essential: true },
  { key: 'country_code',        label: 'Country' },
  { key: 'phone2',              label: 'Phone 2' },
  { key: 'name',                label: 'Name',             essential: true },
  { key: 'company_name',        label: 'Company' },
  { key: 'job_title',           label: 'Job Title' },
  { key: 'tags',                label: 'Labels' },
  { key: 'email',               label: 'Email' },
  { key: 'birthday',            label: 'Birthday' },
  { key: 'anniversary',         label: 'Anniversary' },
  { key: 'address',             label: 'Address' },
  { key: 'addresses',           label: 'Addresses',        align: true },
  { key: 'rewards_tier',        label: 'Tier' },
  { key: 'loyalty_points',      label: 'Points' },
  { key: 'is_delivery_partner', label: 'Delivery',         align: true },
  { key: 'notes',               label: 'Notes' },
  { key: 'actions',             label: '',                 essential: true, width: 96, pinned: true },
];
const COL_MAP = Object.fromEntries(COLUMNS.map(c => [c.key, c]));
const DEFAULT_ORDER = COLUMNS.map(c => c.key);

const STATE_KEY = 'crm-customers-state';
const savedState = (() => {
  try { return JSON.parse(localStorage.getItem(STATE_KEY)) || {}; } catch { return {}; }
})();

export default function CRM() {
  const [tab,       setTab]      = useState('customers');
  const [rows,      setRows]     = useState([]);
  const [bdRows,    setBdRows]   = useState([]);
  const [stats,     setStats]    = useState({});
  const [edits,     setEdits]    = useState({});
  const [editMode,  setEditMode] = useState(false);
  const [newRow,    setNewRow]   = useState(BLANK);
  const [search,    setSearch]   = useState(savedState.search ?? '');
  const [debouncedSearch, setDebouncedSearch] = useState(savedState.search ?? '');
  const [statusFilter, setStatusFilter] = useState(savedState.statusFilter ?? 'active');
  const [page,      setPage]     = useState(savedState.page ?? 1);
  const [limit,     setLimit]    = useState(savedState.limit ?? 25);
  const [total,     setTotal]    = useState(0);
  const [saving,    setSaving]   = useState(false);
  const [toast,     setToast]    = useState(null);
  const [phoneEdit, setPhoneEdit] = useState(null);   // phone currently being renamed
  const [phoneEditVal, setPhoneEditVal] = useState('');
  const [addrModal, setAddrModal] = useState(null);   // customer row whose addresses are open
  const [mergeModal, setMergeModal] = useState(null); // source row being merged
  const [mergeMany, setMergeMany] = useState(false);  // bulk merge modal open
  const [allTags, setAllTags] = useState([]);
  const [tagFilter, setTagFilter] = useState(savedState.tagFilter ?? '');
  const [selected, setSelected] = useState(new Set());
  const [gAccount, setGAccount] = useState({ connected: false, account: null });
  const [collapsed, setCollapsed] = useState(() => {
    try { return JSON.parse(localStorage.getItem('crm-collapsed-sections')) || {}; } catch { return {}; }
  });
  const [hiddenCols, setHiddenCols] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('crm-hidden-cols')) || []); } catch { return new Set(); }
  });
  const [colOrder, setColOrder] = useState(() => {
    try { return JSON.parse(localStorage.getItem('crm-col-order')) || DEFAULT_ORDER; } catch { return DEFAULT_ORDER; }
  });
  const [colMenu, setColMenu] = useState(false);
  const colMenuRef = useRef(null);
  const dragKey = useRef(null);
  const [dragOverKey, setDragOverKey] = useState(null);
  const addRefs = useRef([]);
  const gridRef = useResizableColumns('crm.customers');

  function toggleSection(key) {
    setCollapsed(c => {
      const next = { ...c, [key]: !c[key] };
      localStorage.setItem('crm-collapsed-sections', JSON.stringify(next));
      return next;
    });
  }

  const showCol = k => !hiddenCols.has(k);
  function toggleCol(key) {
    setHiddenCols(s => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      localStorage.setItem('crm-hidden-cols', JSON.stringify([...n]));
      return n;
    });
  }

  // Columns in saved order, pinned ones (actions) forced to the end, plus any
  // newly-added column keys the saved order predates.
  const orderedCols = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const k of colOrder) if (COL_MAP[k] && !COL_MAP[k].pinned) { out.push(COL_MAP[k]); seen.add(k); }
    for (const c of COLUMNS) if (!c.pinned && !seen.has(c.key)) out.push(c);
    for (const c of COLUMNS) if (c.pinned) out.push(c);
    return out;
  }, [colOrder]);
  const visibleCols = orderedCols.filter(c => showCol(c.key));

  function reorderCol(fromKey, toKey) {
    if (!fromKey || fromKey === toKey || COL_MAP[toKey]?.pinned) return;
    const base = orderedCols.filter(c => !c.pinned).map(c => c.key);
    const fi = base.indexOf(fromKey), ti = base.indexOf(toKey);
    if (fi < 0 || ti < 0) return;
    base.splice(fi, 1);
    base.splice(ti, 0, fromKey);
    setColOrder(base);
    localStorage.setItem('crm-col-order', JSON.stringify(base));
  }

  const flash = (msg, err = false) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 2800);
  };

  const loadCustomers = useCallback(() => {
    API.get('/crm/customers', { params: { search: debouncedSearch, status: statusFilter, tag: tagFilter || undefined, page, limit } })
      .then(r => { setRows(r.data.rows); setTotal(r.data.total); })
      .catch(() => {});
  }, [debouncedSearch, statusFilter, tagFilter, page, limit]);

  const loadStats = useCallback(() => {
    API.get('/crm/stats').then(r => setStats(r.data)).catch(() => {});
  }, []);

  const loadTags = useCallback(() => {
    API.get('/crm/tags').then(r => setAllTags(r.data)).catch(() => {});
  }, []);

  const loadGoogle = useCallback(() => {
    API.get('/google-status').then(r => setGAccount(r.data)).catch(() => {});
  }, []);

  const loadBirthdays = useCallback(() => {
    API.get('/crm/birthdays').then(r => setBdRows(r.data)).catch(() => {});
  }, []);

  // Same debounce technique as the POS customer picker — don't fire a ranked
  // search request per keystroke, wait for typing to settle.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { loadCustomers(); loadStats(); }, [loadCustomers, loadStats]);
  useEffect(() => { loadTags(); }, [loadTags]);
  useEffect(() => { loadGoogle(); }, [loadGoogle]);
  useEffect(() => { setPage(1); setSelected(new Set()); }, [debouncedSearch, statusFilter, tagFilter, limit]);
  useEffect(() => {
    localStorage.setItem(STATE_KEY, JSON.stringify({ search, statusFilter, tagFilter, page, limit }));
  }, [search, statusFilter, tagFilter, page, limit]);
  useEffect(() => { if (tab === 'birthdays') loadBirthdays(); }, [tab, loadBirthdays]);
  useEffect(() => {
    if (!colMenu) return;
    const h = e => { if (colMenuRef.current && !colMenuRef.current.contains(e.target)) setColMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [colMenu]);

  function setField(phone, field, val) {
    setEdits(e => ({ ...e, [phone]: { ...(e[phone] ?? {}), [field]: val } }));
  }

  function isDirty(phone) { return !!(edits[phone] && Object.keys(edits[phone]).length > 0); }

  const val = (row, field) =>
    edits[row.phone]?.[field] !== undefined ? edits[row.phone][field] : row[field] ?? '';

  async function saveRow(phone) {
    const row = rows.find(r => r.phone === phone);
    if (!row) return;
    const merged = { ...row, ...(edits[phone] ?? {}) };
    await API.put(`/crm/customers/${phone}`, merged);
    setEdits(e => { const n = { ...e }; delete n[phone]; return n; });
  }

  async function saveAll() {
    const dirty = Object.keys(edits).filter(p => isDirty(p));
    if (!dirty.length) return;
    setSaving(true);
    try {
      for (const p of dirty) await saveRow(p);
      loadCustomers(); loadStats();
      flash(`${dirty.length} record(s) saved`);
    } catch { flash('Save failed', true); }
    finally { setSaving(false); }
  }

  // ── Row selection + bulk actions ──
  const pagePhones = rows.map(r => r.phone);
  const allSelected = pagePhones.length > 0 && pagePhones.every(p => selected.has(p));
  function toggleSel(phone) {
    setSelected(s => { const n = new Set(s); n.has(phone) ? n.delete(phone) : n.add(phone); return n; });
  }
  function toggleSelAll() {
    setSelected(s => {
      const n = new Set(s);
      if (allSelected) pagePhones.forEach(p => n.delete(p));
      else pagePhones.forEach(p => n.add(p));
      return n;
    });
  }
  async function bulkStatus(status) {
    const phones = [...selected];
    if (!phones.length) return;
    const verb = status === 'deleted' ? 'Move to bin' : status === 'inactive' ? 'Mark inactive' : 'Mark active';
    if (!confirm(`${verb}: ${phones.length} contact(s)?`)) return;
    try {
      await API.post('/crm/customers/bulk-status', { phones, status });
      setSelected(new Set());
      loadCustomers(); loadStats();
      flash(`${phones.length} contact(s) updated`);
    } catch { flash('Bulk update failed', true); }
  }

  async function addCustomer() {
    if (!newRow.phone || !newRow.name) return flash('Phone and Name are required', true);
    setSaving(true);
    try {
      await API.post('/crm/customers', newRow);
      setNewRow(BLANK);
      loadCustomers(); loadStats();
      flash('Customer added');
    } catch (e) { flash(e.response?.data?.error ?? 'Error', true); }
    finally { setSaving(false); }
  }

  async function softDelete(phone) {
    if (!confirm(`Move ${phone} to the recycle bin?`)) return;
    try {
      await API.delete(`/crm/customers/${phone}`);
      loadCustomers(); loadStats();
      flash('Moved to bin');
    } catch { flash('Failed', true); }
  }

  async function purge(phone) {
    if (!confirm(`Permanently delete ${phone}? This cannot be undone.`)) return;
    try {
      await API.delete(`/crm/customers/${phone}/purge`);
      loadCustomers(); loadStats();
      flash('Permanently deleted');
    } catch (e) { flash(e.response?.data?.error ?? 'Cannot delete', true); }
  }

  function startPhoneEdit(phone) { setPhoneEdit(phone); setPhoneEditVal(phone); }

  async function savePhoneEdit() {
    if (!phoneEdit) return;
    const next = phoneEditVal.trim();
    if (!isValidPhoneInput(next)) return flash('Enter 7–15 digits, optional leading +country code', true);
    if (next === phoneEdit) { setPhoneEdit(null); return; }
    try {
      await API.put(`/crm/customers/${phoneEdit}/phone`, { new_phone: next });
      flash('Phone number updated');
      setPhoneEdit(null);
      loadCustomers(); loadStats();
    } catch (e) {
      flash(e.response?.data?.error ?? 'Could not update phone number', true);
    }
  }

  async function restore(phone) {
    try {
      await API.post(`/crm/customers/${phone}/restore`);
      loadCustomers(); loadStats();
      flash('Customer restored');
    } catch { flash('Failed', true); }
  }

  const dirtyCount = Object.keys(edits).filter(p => isDirty(p)).length;

  function addKeyDown(e, idx, isLast) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isLast) addCustomer();
      else addRefs.current[idx + 1]?.focus();
    }
  }

  // ── Birthday helpers ──────────────────────────────────────────
  const today = new Date();
  const todayMMDD = `${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const thisMonth = String(today.getMonth()+1).padStart(2,'0');

  function bdayStatus(mmdd) {
    if (mmdd === todayMMDD) return '🎂 Today!';
    if (mmdd?.slice(0,2) === thisMonth) return '📅 This month';
    return '';
  }

  // Per-column cell renderer — keyed so columns can be reordered/hidden freely.
  function renderCell(key, r) {
    switch (key) {
      case 'phone':
        return editMode && phoneEdit === r.phone ? (
          <div className="crm-phone-edit">
            <input className="crm-inline" autoFocus value={phoneEditVal}
              onChange={e => setPhoneEditVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') savePhoneEdit(); if (e.key === 'Escape') setPhoneEdit(null); }} />
            <button className="crm-btn-icon crm-btn-icon--save" title="Save" onClick={savePhoneEdit}>✓</button>
            <button className="crm-btn-icon" title="Cancel" onClick={() => setPhoneEdit(null)}>✕</button>
          </div>
        ) : (
          <div className="crm-cell-text crm-phone-cell" style={{ fontWeight: 700 }}>
            {r.phone}
            {editMode && <button className="crm-phone-pencil" title="Edit phone number" onClick={() => startPhoneEdit(r.phone)}>✎</button>}
          </div>
        );
      case 'country_code':
        return editMode
          ? <input className="crm-inline" style={{ maxWidth: 70 }} placeholder="+977" value={val(r,'country_code')} onChange={e => setField(r.phone,'country_code',e.target.value)} />
          : <div className="crm-cell-text">{r.country_code || '—'}</div>;
      case 'phone2':
        return editMode
          ? <input className="crm-inline" style={{ maxWidth: 130 }} value={val(r,'phone2')} onChange={e => setField(r.phone,'phone2',e.target.value)} />
          : <div className="crm-cell-text">{r.phone2 || '—'}</div>;
      case 'name':
        return editMode
          ? <input className="crm-inline" value={val(r,'name')} onChange={e => setField(r.phone,'name',e.target.value)} />
          : <div className="crm-cell-text">{r.name}</div>;
      case 'company_name':
        return editMode
          ? <input className="crm-inline" value={val(r,'company_name')} onChange={e => setField(r.phone,'company_name',e.target.value)} />
          : <div className="crm-cell-text">{r.company_name || '—'}</div>;
      case 'job_title':
        return editMode
          ? <input className="crm-inline" value={val(r,'job_title')} onChange={e => setField(r.phone,'job_title',e.target.value)} />
          : <div className="crm-cell-text">{r.job_title || '—'}</div>;
      case 'tags':
        return <TagBar customer={r} allTags={allTags} api={API} flash={flash} onChange={() => { loadCustomers(); loadTags(); }} />;
      case 'email':
        return editMode ? (
          <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
            <input className="crm-inline" placeholder="Email 1" value={val(r,'email')} onChange={e => setField(r.phone,'email',e.target.value)} />
            <input className="crm-inline" placeholder="Email 2" value={val(r,'email2')} onChange={e => setField(r.phone,'email2',e.target.value)} />
          </div>
        ) : (
          <>
            <div className="crm-cell-text">{r.email || '—'}</div>
            {r.email2 && <div className="crm-cell-sub">{r.email2}</div>}
          </>
        );
      case 'birthday':
        return editMode
          ? <input className="crm-inline" type="date" style={{ maxWidth: 140 }} value={val(r,'birthday')} onChange={e => setField(r.phone,'birthday',e.target.value)} />
          : <div className="crm-cell-text">{r.birthday || '—'}</div>;
      case 'anniversary':
        return editMode
          ? <input className="crm-inline" type="date" style={{ maxWidth: 140 }} value={val(r,'anniversary')} onChange={e => setField(r.phone,'anniversary',e.target.value)} />
          : <div className="crm-cell-text">{r.anniversary || '—'}</div>;
      case 'address':
        return editMode
          ? <input className="crm-inline" value={val(r,'address')} onChange={e => setField(r.phone,'address',e.target.value)} />
          : <div className="crm-cell-text">{r.address || '—'}</div>;
      case 'addresses':
        return <button className="crm-btn-icon" title="Manage addresses" onClick={() => setAddrModal(r)}>🏠</button>;
      case 'rewards_tier':
        return editMode ? (
          <select className="crm-inline" style={{ maxWidth: 110 }} value={val(r,'rewards_tier')} onChange={e => setField(r.phone,'rewards_tier',e.target.value)}>
            {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        ) : (
          <span className={`crm-badge ${TIER_CLASS[r.rewards_tier] ?? 'crm-badge--standard'}`}>{r.rewards_tier}</span>
        );
      case 'loyalty_points':
        return editMode
          ? <input className="crm-inline" type="number" min="0" style={{ maxWidth: 80 }} value={val(r,'loyalty_points')} onChange={e => setField(r.phone,'loyalty_points', Number(e.target.value))} />
          : <div className="crm-cell-text">{r.loyalty_points ?? 0}</div>;
      case 'is_delivery_partner':
        return editMode ? (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
            <input type="checkbox" checked={!!Number(val(r,'is_delivery_partner'))} onChange={e => setField(r.phone,'is_delivery_partner', e.target.checked ? 1 : 0)} />
            {!!Number(val(r,'is_delivery_partner')) && (
              <input className="crm-inline" type="number" min="0" max="100" style={{ maxWidth: 56 }} title="Auto discount %"
                value={val(r,'discount')} onChange={e => setField(r.phone,'discount', Number(e.target.value))} />
            )}
          </div>
        ) : (
          val(r,'is_delivery_partner')
            ? <span className="crm-delivery-badge">🚴 {Number(r.discount) > 0 ? `${Number(r.discount)}%` : 'Yes'}</span>
            : <span className="crm-cell-sub">—</span>
        );
      case 'notes':
        return editMode
          ? <input className="crm-inline" value={val(r,'notes')} onChange={e => setField(r.phone,'notes',e.target.value)} />
          : <div className="crm-cell-sub">{r.notes || ''}</div>;
      case 'actions':
        return (
          <div style={{ display:'flex', gap:3 }}>
            {isDirty(r.phone) && (
              <button className="crm-btn-icon crm-btn-icon--save" title="Save" onClick={() => saveRow(r.phone).then(() => { loadCustomers(); flash('Saved'); })}>✓</button>
            )}
            {r.status === 'deleted' ? (
              <>
                <button className="crm-btn-icon crm-btn-icon--save" title="Restore from bin" onClick={() => restore(r.phone)}>↩</button>
                <button className="crm-btn-icon crm-btn-icon--del" title="Delete permanently" onClick={() => purge(r.phone)}>⨯</button>
              </>
            ) : (
              <>
                {editMode && <button className="crm-btn-icon" title="Merge into another contact" onClick={() => setMergeModal(r)}>⇄</button>}
                {r.status === 'active'
                  ? <button className="crm-btn-icon crm-btn-icon--del" title="Move to bin" onClick={() => softDelete(r.phone)}>🗑</button>
                  : <button className="crm-btn-icon crm-btn-icon--save" title="Reactivate" onClick={() => restore(r.phone)}>↩</button>}
              </>
            )}
          </div>
        );
      default: return null;
    }
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="crm-root">
      {/* Header — compact single line */}
      <div className="crm-header">
        <h1>CRM <span className="crm-subtitle">· {stats.total ?? '—'} customers</span></h1>
        <div className="crm-header-actions">
          <GoogleAccountChip status={gAccount} onChange={loadGoogle} />
          <GoogleSync connected={gAccount.connected} onConnected={loadGoogle} onSynced={() => { loadCustomers(); loadStats(); }} />
        </div>
      </div>

      {/* Stats */}
      <button className="crm-section-toggle" onClick={() => toggleSection('stats')}>
        <span className={`crm-chevron ${collapsed.stats ? 'closed' : ''}`}>▾</span> Overview
      </button>
      {!collapsed.stats && (
      <div className="crm-stats">
        <div className="crm-stat">
          <div className="crm-stat__val">{stats.total ?? '—'}</div>
          <div className="crm-stat__label">Active Customers</div>
        </div>
        <div className="crm-stat">
          <div className="crm-stat__val">{stats.bday_today ?? '—'}</div>
          <div className="crm-stat__label">Birthdays Today</div>
        </div>
        <div className="crm-stat">
          <div className="crm-stat__val">{stats.bday_month ?? '—'}</div>
          <div className="crm-stat__label">Birthdays This Month</div>
        </div>
        <div className="crm-stat">
          <div className="crm-stat__val">{stats.inactive ?? '—'}</div>
          <div className="crm-stat__label">Inactive</div>
        </div>
        <div className="crm-stat">
          <div className="crm-stat__val">{stats.binned ?? '—'}</div>
          <div className="crm-stat__label">In Bin</div>
        </div>
      </div>
      )}

      {/* Add New Customer — top-level section under Overview */}
      <button className="crm-section-toggle" onClick={() => toggleSection('addForm')}>
        <span className={`crm-chevron ${collapsed.addForm ? 'closed' : ''}`}>▾</span> Add New Customer
      </button>
      {!collapsed.addForm && (
      <div className="crm-add-form crm-add-form--panel">
        <div className="crm-field crm-field--required" style={{ maxWidth: 150 }}>
          <label>Phone (primary)</label>
          <input ref={el => addRefs.current[0]=el} placeholder="e.g. 9800000000 or +91…"
            value={newRow.phone} onChange={e => setNewRow(f => ({...f, phone: e.target.value}))}
            onKeyDown={e => addKeyDown(e,0,false)} />
        </div>
        <div className="crm-field" style={{ maxWidth: 90 }}>
          <label>Country</label>
          <input ref={el => addRefs.current[1]=el} placeholder="+977"
            value={newRow.country_code} onChange={e => setNewRow(f => ({...f, country_code: e.target.value}))}
            onKeyDown={e => addKeyDown(e,1,false)} />
        </div>
        <div className="crm-field" style={{ maxWidth: 140 }}>
          <label>Phone 2</label>
          <input ref={el => addRefs.current[2]=el} placeholder="Alt number"
            value={newRow.phone2} onChange={e => setNewRow(f => ({...f, phone2: e.target.value}))}
            onKeyDown={e => addKeyDown(e,2,false)} />
        </div>
        <div className="crm-field crm-field--required">
          <label>Name</label>
          <input ref={el => addRefs.current[3]=el} placeholder="Full name"
            value={newRow.name} onChange={e => setNewRow(f => ({...f, name: e.target.value}))}
            onKeyDown={e => addKeyDown(e,3,false)} />
        </div>
        <div className="crm-field">
          <label>Company Name</label>
          <input ref={el => addRefs.current[4]=el} placeholder="Optional"
            value={newRow.company_name} onChange={e => setNewRow(f => ({...f, company_name: e.target.value}))}
            onKeyDown={e => addKeyDown(e,4,false)} />
        </div>
        <div className="crm-field">
          <label>Job Title</label>
          <input ref={el => addRefs.current[5]=el} placeholder="Optional"
            value={newRow.job_title} onChange={e => setNewRow(f => ({...f, job_title: e.target.value}))}
            onKeyDown={e => addKeyDown(e,5,false)} />
        </div>
        <div className="crm-field">
          <label>Email</label>
          <input ref={el => addRefs.current[6]=el} type="email" placeholder="email@example.com"
            value={newRow.email} onChange={e => setNewRow(f => ({...f, email: e.target.value}))}
            onKeyDown={e => addKeyDown(e,6,false)} />
        </div>
        <div className="crm-field" style={{ maxWidth: 150 }}>
          <label>Birthday</label>
          <input ref={el => addRefs.current[7]=el} type="date"
            value={newRow.birthday} onChange={e => setNewRow(f => ({...f, birthday: e.target.value}))}
            onKeyDown={e => addKeyDown(e,7,false)} />
        </div>
        <div className="crm-field" style={{ maxWidth: 150 }}>
          <label>Anniversary</label>
          <input ref={el => addRefs.current[8]=el} type="date"
            value={newRow.anniversary} onChange={e => setNewRow(f => ({...f, anniversary: e.target.value}))}
            onKeyDown={e => addKeyDown(e,8,false)} />
        </div>
        <div className="crm-field">
          <label>Address</label>
          <input ref={el => addRefs.current[9]=el} placeholder="Street / area"
            value={newRow.address} onChange={e => setNewRow(f => ({...f, address: e.target.value}))}
            onKeyDown={e => addKeyDown(e,9,true)} />
        </div>
        <div style={{ display:'flex', alignItems:'flex-end' }}>
          <button className="btn-primary" onClick={addCustomer} disabled={saving}>+ Add Customer</button>
        </div>
      </div>
      )}

      {/* Tabs */}
      <div className="crm-tabs">
        {TABS.map(t => (
          <button key={t.key}
            className={`crm-tab ${tab === t.key ? 'crm-tab--active' : ''}`}
            onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === 'birthdays' && stats.bday_today > 0 && <span className="crm-bday-dot" />}
          </button>
        ))}
      </div>

      {/* ── CUSTOMERS TAB ── */}
      {tab === 'customers' && (
        <>
          {/* Toolbar + pagination, single row to save space */}
          <div className="crm-toolbar">
            <input
              className="crm-search"
              placeholder="Search by phone, name, email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select className="crm-filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="deleted">🗑 Bin{stats.binned ? ` (${stats.binned})` : ''}</option>
              <option value="all">All</option>
            </select>
            <select className="crm-filter-select" value={tagFilter} onChange={e => setTagFilter(e.target.value)} title="Filter by label">
              <option value="">All labels</option>
              <option value="none">Unlabelled</option>
              {allTags.map(t => <option key={t.id} value={t.id}>{t.name} ({t.count})</option>)}
            </select>

            {dirtyCount > 0 && (
              <button className="btn-primary" onClick={saveAll} disabled={saving}>
                {saving ? 'Saving…' : `Save All (${dirtyCount})`}
              </button>
            )}

            <button
              className={`crm-edit-toggle ${editMode ? 'active' : ''}`}
              onClick={() => setEditMode(m => !m)}
            >
              <span className="dot" />
              {editMode ? 'Edit Mode ON' : 'Edit Mode OFF'}
            </button>

            <div className="crm-colmenu-wrap" ref={colMenuRef}>
              <button className="crm-edit-toggle" onClick={() => setColMenu(o => !o)} title="Show / hide columns">
                ▦ Columns{hiddenCols.size ? ` (${COLUMNS.length - hiddenCols.size}/${COLUMNS.length})` : ''}
              </button>
              {colMenu && (
                <div className="crm-colmenu">
                  {COLUMNS.filter(c => c.label).map(c => (
                    <label key={c.key} className={`crm-colmenu__item ${c.essential ? 'locked' : ''}`}>
                      <input type="checkbox" checked={showCol(c.key)} disabled={c.essential}
                        onChange={() => toggleCol(c.key)} />
                      {c.label}{c.essential && <span className="crm-colmenu__lock">🔒</span>}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="crm-pager">
              <span className="crm-pager__info">
                {total === 0 ? '0 results' : `${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total}`}
              </span>
              <button className="crm-btn-icon" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
              <span className="crm-pager__page">Page {page} / {Math.max(1, Math.ceil(total / limit))}</span>
              <button className="crm-btn-icon" disabled={page * limit >= total} onClick={() => setPage(p => p + 1)}>Next ›</button>
              <select className="crm-filter-select" value={limit} onChange={e => setLimit(Number(e.target.value))}>
                <option value={10}>10 / page</option>
                <option value={25}>25 / page</option>
                <option value={50}>50 / page</option>
                <option value={100}>100 / page</option>
              </select>
            </div>
          </div>

          {/* Bulk action bar */}
          {selected.size > 0 && (
            <div className="crm-bulkbar">
              <span className="crm-bulkbar__count">{selected.size} selected</span>
              {selected.size >= 2 && (
                <button className="crm-bulk-btn accent" onClick={() => setMergeMany(true)}>⇄ Merge Selected</button>
              )}
              <button className="crm-bulk-btn" onClick={() => bulkStatus('active')}>Mark Active</button>
              <button className="crm-bulk-btn" onClick={() => bulkStatus('inactive')}>Mark Inactive</button>
              <button className="crm-bulk-btn danger" onClick={() => bulkStatus('deleted')}>🗑 Move to Bin</button>
              <GoogleSync variant="export" connected={gAccount.connected} onConnected={loadGoogle} phones={[...selected]} exportLabel={statusFilter === 'deleted' ? 'Remove from Google' : 'Export to Google'} onSynced={() => { setSelected(new Set()); loadCustomers(); loadStats(); }} />
              <button className="crm-bulk-btn ghost" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          )}

          {/* Grid */}
          <div className={`crm-card ${editMode ? 'edit-mode' : ''}`}>
            <div className="crm-hint-row">
              Enable Edit Mode to modify existing records · click the phone number in Edit Mode to correct it
            </div>

            <table className="crm-table" ref={gridRef} key={'cols-' + visibleCols.map(c => c.key).join('-')}>
              <thead>
                <tr>
                  <th data-col-key="_select" style={{ width: 34, textAlign: 'center' }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleSelAll} title="Select all on page" />
                  </th>
                  {visibleCols.map(c => (
                    <th key={c.key} data-col-key={c.key}
                      draggable={!c.pinned}
                      onDragStart={() => { dragKey.current = c.key; }}
                      onDragOver={e => { if (!c.pinned) { e.preventDefault(); setDragOverKey(c.key); } }}
                      onDragLeave={() => setDragOverKey(k => k === c.key ? null : k)}
                      onDrop={() => { reorderCol(dragKey.current, c.key); dragKey.current = null; setDragOverKey(null); }}
                      className={`${!c.pinned ? 'crm-th-drag' : ''} ${dragOverKey === c.key ? 'crm-th-dragover' : ''}`}
                      style={c.width ? { width: c.width } : undefined}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.phone} className={[isDirty(r.phone) ? 'dirty' : '', r.status === 'inactive' ? 'inactive' : '', selected.has(r.phone) ? 'crm-row-sel' : ''].join(' ')}>
                    <td style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked={selected.has(r.phone)} onChange={() => toggleSel(r.phone)} />
                    </td>
                    {visibleCols.map(c => (
                      <td key={c.key} style={c.align ? { textAlign: 'center' } : undefined}>{renderCell(c.key, r)}</td>
                    ))}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={visibleCols.length + 1} className="crm-empty">No customers found</td></tr>
                )}
              </tbody>
            </table>
            <div className="crm-hint-row">
              Enable Edit Mode to modify existing records · click the phone number in Edit Mode to correct it
            </div>
          </div>
        </>
      )}

      {/* ── BIRTHDAYS TAB ── */}
      {tab === 'birthdays' && (
        <div className="crm-card">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Phone 2</th>
                <th>Email</th>
                <th>Birthday</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {bdRows.map(r => {
                const status = bdayStatus(r.mmdd);
                return (
                  <tr key={r.phone} className={r.mmdd === todayMMDD ? 'crm-row-today' : ''}>
                    <td><div className="crm-cell-text" style={{ fontWeight: 600 }}>{r.name}</div></td>
                    <td><div className="crm-cell-text">{r.phone}</div></td>
                    <td><div className="crm-cell-text">{r.phone2 || '—'}</div></td>
                    <td><div className="crm-cell-text">{r.email || '—'}</div></td>
                    <td><div className="crm-cell-text">{r.birthday}</div></td>
                    <td>
                      {status && (
                        <span className={`crm-badge ${r.mmdd === todayMMDD ? 'crm-badge--today' : 'crm-badge--soon'}`}>
                          {status}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {bdRows.length === 0 && (
                <tr><td colSpan={6} className="crm-empty">No birthday records — add birthdays when creating customers</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Toast */}
      {toast && <div className={`crm-toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}

      {/* Address cards */}
      {addrModal && (
        <AddressCardsModal
          customer={addrModal}
          api={API}
          flash={flash}
          onClose={() => setAddrModal(null)}
        />
      )}

      {/* Bulk merge */}
      {mergeMany && (
        <MergeManyModal
          contacts={rows.filter(r => selected.has(r.phone))}
          api={API}
          flash={flash}
          onClose={() => setMergeMany(false)}
          onMerged={() => { setMergeMany(false); setSelected(new Set()); loadCustomers(); loadStats(); loadTags(); }}
        />
      )}

      {/* Merge */}
      {mergeModal && (
        <MergeModal
          source={mergeModal}
          api={API}
          flash={flash}
          onClose={() => setMergeModal(null)}
          onMerged={() => { setMergeModal(null); loadCustomers(); loadStats(); loadTags(); }}
        />
      )}
    </div>
  );
}
