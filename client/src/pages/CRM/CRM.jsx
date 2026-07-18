import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import './CRM.css';

const API = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

const BLANK = {
  phone: '', phone2: '', name: '', address: '',
  birthday: '', email: '', email2: '', notes: ''
};

const TIERS = ['standard', 'silver', 'gold', 'platinum'];
const TIER_CLASS = { standard: 'crm-badge--standard', silver: 'crm-badge--silver', gold: 'crm-badge--gold', platinum: 'crm-badge--platinum' };

const TABS = [
  { key: 'customers', label: '👥 Customers' },
  { key: 'birthdays', label: '🎂 Birthdays' },
];

export default function CRM() {
  const [tab,       setTab]      = useState('customers');
  const [rows,      setRows]     = useState([]);
  const [bdRows,    setBdRows]   = useState([]);
  const [stats,     setStats]    = useState({});
  const [edits,     setEdits]    = useState({});
  const [editMode,  setEditMode] = useState(false);
  const [newRow,    setNewRow]   = useState(BLANK);
  const [search,    setSearch]   = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [saving,    setSaving]   = useState(false);
  const [toast,     setToast]    = useState(null);
  const addRefs = useRef([]);

  const flash = (msg, err = false) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 2800);
  };

  const loadCustomers = useCallback(() => {
    API.get('/crm/customers', { params: { search, status: statusFilter } })
      .then(r => setRows(r.data))
      .catch(() => {});
  }, [search, statusFilter]);

  const loadStats = useCallback(() => {
    API.get('/crm/stats').then(r => setStats(r.data)).catch(() => {});
  }, []);

  const loadBirthdays = useCallback(() => {
    API.get('/crm/birthdays').then(r => setBdRows(r.data)).catch(() => {});
  }, []);

  useEffect(() => { loadCustomers(); loadStats(); }, [loadCustomers, loadStats]);
  useEffect(() => { if (tab === 'birthdays') loadBirthdays(); }, [tab, loadBirthdays]);

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
    if (!confirm(`Deactivate customer ${phone}?`)) return;
    try {
      await API.delete(`/crm/customers/${phone}`);
      loadCustomers(); loadStats();
      flash('Customer deactivated');
    } catch { flash('Failed', true); }
  }

  async function restore(phone) {
    const row = rows.find(r => r.phone === phone);
    if (!row) return;
    try {
      await API.put(`/crm/customers/${phone}`, { ...row, status: 'active' });
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

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="crm-root">
      {/* Header */}
      <div className="crm-header">
        <div>
          <h1>CRM — Customer Management</h1>
          <span style={{ fontSize: 13, color: '#aaa' }}>Customer database, loyalty & birthday club</span>
        </div>
      </div>

      {/* Stats */}
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
      </div>

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
          {/* Toolbar */}
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
              <option value="all">All</option>
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
          </div>

          {/* Grid */}
          <div className={`crm-card ${editMode ? 'edit-mode' : ''}`}>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Phone</th>
                  <th>Phone 2</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Birthday</th>
                  <th>Address</th>
                  <th>Tier</th>
                  <th>Points</th>
                  <th>Delivery Partner</th>
                  <th>Notes</th>
                  <th style={{ width: 72 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.phone} className={[isDirty(r.phone) ? 'dirty' : '', r.status === 'inactive' ? 'inactive' : ''].join(' ')}>
                    <td>
                      <div className="crm-cell-text" style={{ fontWeight: 700 }}>{r.phone}</div>
                    </td>
                    <td>
                      {editMode
                        ? <input className="crm-inline" style={{ maxWidth: 130 }} value={val(r,'phone2')} onChange={e => setField(r.phone,'phone2',e.target.value)} />
                        : <div className="crm-cell-text">{r.phone2 || '—'}</div>}
                    </td>
                    <td>
                      {editMode
                        ? <input className="crm-inline" value={val(r,'name')} onChange={e => setField(r.phone,'name',e.target.value)} />
                        : <div className="crm-cell-text">{r.name}</div>}
                    </td>
                    <td>
                      {editMode ? (
                        <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                          <input className="crm-inline" placeholder="Email 1" value={val(r,'email')} onChange={e => setField(r.phone,'email',e.target.value)} />
                          <input className="crm-inline" placeholder="Email 2" value={val(r,'email2')} onChange={e => setField(r.phone,'email2',e.target.value)} />
                        </div>
                      ) : (
                        <>
                          <div className="crm-cell-text">{r.email || '—'}</div>
                          {r.email2 && <div className="crm-cell-sub">{r.email2}</div>}
                        </>
                      )}
                    </td>
                    <td>
                      {editMode
                        ? <input className="crm-inline" type="date" style={{ maxWidth: 140 }} value={val(r,'birthday')} onChange={e => setField(r.phone,'birthday',e.target.value)} />
                        : <div className="crm-cell-text">{r.birthday || '—'}</div>}
                    </td>
                    <td>
                      {editMode
                        ? <input className="crm-inline" value={val(r,'address')} onChange={e => setField(r.phone,'address',e.target.value)} />
                        : <div className="crm-cell-text">{r.address || '—'}</div>}
                    </td>
                    <td>
                      {editMode ? (
                        <select className="crm-inline" style={{ maxWidth: 110 }} value={val(r,'rewards_tier')} onChange={e => setField(r.phone,'rewards_tier',e.target.value)}>
                          {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      ) : (
                        <span className={`crm-badge ${TIER_CLASS[r.rewards_tier] ?? 'crm-badge--standard'}`}>
                          {r.rewards_tier}
                        </span>
                      )}
                    </td>
                    <td>
                      {editMode ? (
                        <input className="crm-inline" type="number" min="0" style={{ maxWidth: 80 }}
                          value={val(r,'loyalty_points')}
                          onChange={e => setField(r.phone,'loyalty_points', Number(e.target.value))} />
                      ) : (
                        <div className="crm-cell-text">{r.loyalty_points ?? 0}</div>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {editMode ? (
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
                          <input type="checkbox"
                            checked={!!Number(val(r,'is_delivery_partner'))}
                            onChange={e => setField(r.phone,'is_delivery_partner', e.target.checked ? 1 : 0)} />
                          {!!Number(val(r,'is_delivery_partner')) && (
                            <input className="crm-inline" type="number" min="0" max="100" style={{ maxWidth: 56 }}
                              title="Auto discount %"
                              value={val(r,'discount')}
                              onChange={e => setField(r.phone,'discount', Number(e.target.value))} />
                          )}
                        </div>
                      ) : (
                        val(r,'is_delivery_partner')
                          ? <span style={{ color:'#0891b2', fontWeight:700, fontSize:13 }}>🚴 {Number(r.discount) > 0 ? `${Number(r.discount)}%` : 'Yes'}</span>
                          : <span style={{ color:'#ccc' }}>—</span>
                      )}
                    </td>
                    <td>
                      {editMode
                        ? <input className="crm-inline" value={val(r,'notes')} onChange={e => setField(r.phone,'notes',e.target.value)} />
                        : <div className="crm-cell-text" style={{ color:'#999', fontSize:12 }}>{r.notes || ''}</div>}
                    </td>
                    <td>
                      <div style={{ display:'flex', gap:3 }}>
                        {isDirty(r.phone) && (
                          <button className="crm-btn-icon crm-btn-icon--save" title="Save" onClick={() => saveRow(r.phone).then(() => { loadCustomers(); flash('Saved'); })}>✓</button>
                        )}
                        {r.status === 'active'
                          ? <button className="crm-btn-icon crm-btn-icon--del" title="Deactivate" onClick={() => softDelete(r.phone)}>🗑</button>
                          : <button className="crm-btn-icon" title="Restore" style={{ color:'#16a34a' }} onClick={() => restore(r.phone)}>↩</button>
                        }
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={11} className="crm-empty">No customers found</td></tr>
                )}
              </tbody>
            </table>

            {/* Add form */}
            <div className="crm-add-form">
              <div className="crm-field crm-field--required" style={{ maxWidth: 150 }}>
                <label>Phone (primary)</label>
                <input ref={el => addRefs.current[0]=el} placeholder="e.g. 9800000000"
                  value={newRow.phone} onChange={e => setNewRow(f => ({...f, phone: e.target.value}))}
                  onKeyDown={e => addKeyDown(e,0,false)} />
              </div>
              <div className="crm-field" style={{ maxWidth: 140 }}>
                <label>Phone 2</label>
                <input ref={el => addRefs.current[1]=el} placeholder="Alt number"
                  value={newRow.phone2} onChange={e => setNewRow(f => ({...f, phone2: e.target.value}))}
                  onKeyDown={e => addKeyDown(e,1,false)} />
              </div>
              <div className="crm-field crm-field--required">
                <label>Name</label>
                <input ref={el => addRefs.current[2]=el} placeholder="Full name"
                  value={newRow.name} onChange={e => setNewRow(f => ({...f, name: e.target.value}))}
                  onKeyDown={e => addKeyDown(e,2,false)} />
              </div>
              <div className="crm-field">
                <label>Email</label>
                <input ref={el => addRefs.current[3]=el} type="email" placeholder="email@example.com"
                  value={newRow.email} onChange={e => setNewRow(f => ({...f, email: e.target.value}))}
                  onKeyDown={e => addKeyDown(e,3,false)} />
              </div>
              <div className="crm-field" style={{ maxWidth: 150 }}>
                <label>Birthday</label>
                <input ref={el => addRefs.current[4]=el} type="date"
                  value={newRow.birthday} onChange={e => setNewRow(f => ({...f, birthday: e.target.value}))}
                  onKeyDown={e => addKeyDown(e,4,false)} />
              </div>
              <div className="crm-field">
                <label>Address</label>
                <input ref={el => addRefs.current[5]=el} placeholder="Street / area"
                  value={newRow.address} onChange={e => setNewRow(f => ({...f, address: e.target.value}))}
                  onKeyDown={e => addKeyDown(e,5,true)} />
              </div>
              <div style={{ display:'flex', alignItems:'flex-end' }}>
                <button className="btn-primary" onClick={addCustomer} disabled={saving}>+ Add Customer</button>
              </div>
            </div>
            <div style={{ padding:'8px 20px', fontSize:11, color:'#bbb' }}>
              Enable Edit Mode to modify existing records · Phone number is permanent (primary key)
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
                  <tr key={r.phone} style={r.mmdd === todayMMDD ? { background:'#fffbeb' } : {}}>
                    <td><div className="crm-cell-text" style={{ fontWeight: 600 }}>{r.name}</div></td>
                    <td><div className="crm-cell-text">{r.phone}</div></td>
                    <td><div className="crm-cell-text">{r.phone2 || '—'}</div></td>
                    <td><div className="crm-cell-text">{r.email || '—'}</div></td>
                    <td><div className="crm-cell-text">{r.birthday}</div></td>
                    <td>
                      {status && (
                        <span className="crm-badge" style={{ background: r.mmdd === todayMMDD ? '#fef3c7' : '#f0f9ff', color: r.mmdd === todayMMDD ? '#92400e' : '#0369a1' }}>
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
    </div>
  );
}
