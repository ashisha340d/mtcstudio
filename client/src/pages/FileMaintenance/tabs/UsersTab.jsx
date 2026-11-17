import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { nextCell } from './SharedModifiersTab';

const API = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', headers: { 'X-Session-ID': 'dev-session' } });

const ROLE_COLOR = { ADMIN: '#5b21b6', MANAGER: '#1d4ed8', CASHIER: '#065f46', COOK: '#ea580c' };
const ROLE_BG = { ADMIN: '#ede9fe', MANAGER: '#dbeafe', CASHIER: '#d1fae5', COOK: '#ffedd5' };

export default function UsersTab() {
  const [rows, setRows] = useState([]);
  const [edits, setEdits] = useState({});
  const [roles, setRoles] = useState([]);
  const [newRow, setNewRow] = useState({ name: '', employee_id: '', role: '', pin: '' });
  const [showPin, setShowPin] = useState({});
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const addRefs = useRef([]);

  const load = useCallback(() =>
    API.get('/maintenance/users').then(r => setRows(r.data)).catch(() => { }), []);

  const loadRoles = useCallback(() =>
    API.get('/maintenance/roles').then(r => {
      setRoles(r.data);
      setNewRow(prev => ({ ...prev, role: r.data[0]?.name || '' }));
    }).catch(() => { }), []);

  useEffect(() => { loadRoles(); load(); }, [load, loadRoles]);

  function setField(id, field, val) {
    setEdits(e => ({ ...e, [id]: { ...(e[id] ?? {}), [field]: val } }));
  }

  function isDirty(id) { return !!edits[id] && Object.keys(edits[id]).length > 0; }
  const dirtyCount = Object.keys(edits).filter(id => isDirty(Number(id))).length;

  async function saveRow(id) {
    const data = edits[id];
    if (!data) return;
    if (data.pin && (data.pin.length !== 4 || !/^\d{4}$/.test(data.pin))) {
      flash('PIN must be 4 digits', true); return;
    }
    await API.put(`/maintenance/users/${id}`, data);
    setEdits(e => { const n = { ...e }; delete n[id]; return n; });
  }

  async function saveAll() {
    const dirty = Object.keys(edits).filter(id => isDirty(Number(id)));
    if (!dirty.length) return;
    setSaving(true);
    try {
      for (const id of dirty) await saveRow(Number(id));
      await load();
      flash(`${dirty.length} row(s) saved`);
    } catch { flash('Save failed', true); }
    finally { setSaving(false); }
  }

  async function addRow() {
    if (!newRow.name || !newRow.employee_id || !newRow.pin) return setErr('All fields required');
    if (newRow.pin.length !== 4 || !/^\d{4}$/.test(newRow.pin)) return setErr('PIN must be 4 digits');
    setSaving(true);
    try {
      await API.post('/maintenance/users', newRow);
      setNewRow({ name: '', employee_id: '', role: roles[0]?.name || '', pin: '' }); setErr(''); await load(); flash('User added');
    } catch (e) { setErr(e.response?.data?.error ?? 'Error'); }
    finally { setSaving(false); }
  }

  async function deleteRow(id) {
    if (!confirm('Deactivate this user?')) return;
    try {
      await API.delete(`/maintenance/users/${id}`);
      setRows(r => r.map(x => x.id === id ? { ...x, is_active: 0 } : x));
      flash('User deactivated');
    } catch (e) { flash(e.response?.data?.error ?? 'Failed', true); }
  }

  function onAddKeyDown(e, idx, isLast) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isLast) addRow();
      else addRefs.current[idx + 1]?.focus();
    }
  }

  function flash(msg, isErr = false) {
    setToast(isErr ? `❌ ${msg}` : `✓ ${msg}`);
    setTimeout(() => setToast(''), 2500);
  }

  const val = (row, field) => edits[row.id]?.[field] !== undefined ? edits[row.id][field] : row[field];

  return (
    <div className="fm-card">
      <div className="fm-card__head">
        <span className="fm-card__title">POS Users</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {toast && <span style={{ fontSize: 12, color: toast.startsWith('❌') ? 'var(--t-danger)' : 'var(--t-success)' }}>{toast}</span>}
          <span style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>{rows.length} users</span>
          {dirtyCount > 0 && (
            <button className="btn-primary" style={{ padding: '5px 14px', fontSize: 12 }} onClick={saveAll} disabled={saving}>
              {saving ? 'Saving…' : `Save All (${dirtyCount})`}
            </button>
          )}
        </div>
      </div>

      <table className="fm-table">
        <thead>
          <tr>
            <th>Emp ID</th><th>Name</th><th>Role</th><th>New PIN</th><th>Active</th>
            <th style={{ width: 90 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className={isDirty(r.id) ? 'fm-edit-row' : ''}>
              <td><code style={{ fontSize: 12, fontWeight: 700 }}>{r.employee_id}</code></td>
              <td>
                <input
                  className="fm-inline-input"
                  value={val(r, 'name')}
                  onChange={e => setField(r.id, 'name', e.target.value)}
                  onKeyDown={nextCell}
                />
              </td>
              <td>
                <select
                  className="fm-inline-input"
                  value={val(r, 'role')}
                  onChange={e => setField(r.id, 'role', e.target.value)}
                  style={{ padding: '4px 6px' }}
                >
                  {roles.map(ro => <option key={ro.name} value={ro.name}>{ro.name}</option>)}
                </select>
              </td>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    className="fm-inline-input"
                    type={showPin[r.id] ? 'text' : 'password'}
                    maxLength={4}
                    placeholder="New PIN"
                    style={{ width: 90 }}
                    value={edits[r.id]?.pin ?? ''}
                    onChange={e => setField(r.id, 'pin', e.target.value)}
                    onKeyDown={nextCell}
                  />
                  <button className="btn-icon" style={{ fontSize: 12 }}
                    onClick={() => setShowPin(p => ({ ...p, [r.id]: !p[r.id] }))}>
                    {showPin[r.id] ? '🙈' : '👁'}
                  </button>
                </div>
              </td>
              <td>
                <span style={{
                  padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                  background: r.is_active ? ROLE_BG[r.role] : 'var(--t-surface-3)',
                  color: r.is_active ? ROLE_COLOR[r.role] : 'var(--t-text-muted)'
                }}>
                  {r.is_active ? r.role : 'Inactive'}
                </span>
              </td>
              <td>
                <div style={{ display: 'flex', gap: 4 }}>
                  {isDirty(r.id) && (
                    <button className="btn-icon fm-save-icon" title="Save" onClick={() => saveRow(r.id).then(load)}>✓</button>
                  )}
                  {r.is_active ? (
                    <button className="btn-icon btn-icon--danger" title="Deactivate" onClick={() => deleteRow(r.id)}>🗑</button>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--t-text-soft)' }}>Off</span>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="fm-empty">No users</td></tr>}
        </tbody>
      </table>

      <div className="fm-form-row">
        <div className="fm-field">
          <label>Name *</label>
          <input
            ref={el => addRefs.current[0] = el}
            placeholder="Full name"
            value={newRow.name}
            onChange={e => setNewRow(f => ({ ...f, name: e.target.value }))}
            onKeyDown={e => onAddKeyDown(e, 0, false)}
          />
        </div>
        <div className="fm-field" style={{ maxWidth: 130 }}>
          <label>Employee ID *</label>
          <input
            ref={el => addRefs.current[1] = el}
            placeholder="EMP04"
            value={newRow.employee_id}
            onChange={e => setNewRow(f => ({ ...f, employee_id: e.target.value.toUpperCase() }))}
            onKeyDown={e => onAddKeyDown(e, 1, false)}
          />
        </div>
        <div className="fm-field" style={{ maxWidth: 120 }}>
          <label>Role</label>
          <select
            ref={el => addRefs.current[2] = el}
            value={newRow.role}
            onChange={e => setNewRow(f => ({ ...f, role: e.target.value }))}
            onKeyDown={e => onAddKeyDown(e, 2, false)}
          >
            {roles.map(ro => <option key={ro.name} value={ro.name}>{ro.name}</option>)}
          </select>
        </div>
        <div className="fm-field" style={{ maxWidth: 110 }}>
          <label>4-digit PIN *</label>
          <input
            ref={el => addRefs.current[3] = el}
            type="password" maxLength={4} placeholder="••••"
            value={newRow.pin}
            onChange={e => setNewRow(f => ({ ...f, pin: e.target.value }))}
            onKeyDown={e => onAddKeyDown(e, 3, true)}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {err && <span style={{ fontSize: 11, color: 'red' }}>{err}</span>}
          <button className="btn-primary" onClick={addRow} disabled={saving}>+ Add User</button>
        </div>
      </div>
      <div className="fm-hint">Edit cells inline · Enter to save row · 🗑 deactivates the user</div>
    </div>
  );
}
