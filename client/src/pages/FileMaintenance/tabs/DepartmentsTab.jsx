import { useState, useEffect } from 'react';
import axios from 'axios';

const API = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', headers: { 'X-Session-ID': 'dev-session' } });

export default function DepartmentsTab() {
  const [rows,     setRows]     = useState([]);
  const [stations, setStations] = useState([]);
  const [editId,   setEditId]   = useState(null);
  const [editData, setEditData] = useState({});
  const [form,     setForm]     = useState({ name: '', station_id: '', sort_order: 0 });
  const [err,      setErr]      = useState('');

  const load = () => API.get('/maintenance/departments').then(r => setRows(r.data)).catch(() => {});

  useEffect(() => {
    load();
    API.get('/maintenance/stations').then(r => setStations(r.data.filter(s => s.is_active))).catch(() => {});
  }, []);

  async function create() {
    if (!form.name.trim()) return setErr('Name required');
    try {
      await API.post('/maintenance/departments', {
        name:       form.name.trim(),
        station_id: form.station_id ? parseInt(form.station_id) : null,
        sort_order: parseInt(form.sort_order) || 0,
      });
      setForm({ name: '', station_id: '', sort_order: 0 });
      setErr('');
      load();
    } catch (e) { setErr(e.response?.data?.error ?? 'Error'); }
  }

  async function save(id) {
    const payload = { ...editData };
    if (payload.station_id !== undefined) payload.station_id = payload.station_id ? parseInt(payload.station_id) : null;
    await API.put(`/maintenance/departments/${id}`, payload).catch(() => {});
    setEditId(null);
    load();
  }

  async function deactivate(id) {
    await API.delete(`/maintenance/departments/${id}`).catch(() => {});
    load();
  }

  return (
    <div className="fm-card">
      <div className="fm-card__head">
        <span className="fm-card__title">Departments</span>
        <span style={{ fontSize: 12, color: '#999' }}>{rows.length} departments — linked to POS stations</span>
      </div>

      <table className="fm-table">
        <thead>
          <tr><th>#</th><th>Name</th><th>POS Station</th><th>Sort</th><th>Active</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map(r => editId === r.id ? (
            <tr className="fm-edit-row" key={r.id}>
              <td>{r.id}</td>
              <td>
                <input value={editData.name ?? r.name}
                  onChange={e => setEditData(d => ({ ...d, name: e.target.value }))} />
              </td>
              <td>
                <select value={editData.station_id ?? r.station_id ?? ''}
                  onChange={e => setEditData(d => ({ ...d, station_id: e.target.value }))}>
                  <option value="">— None —</option>
                  {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </td>
              <td>
                <input type="number" value={editData.sort_order ?? r.sort_order}
                  onChange={e => setEditData(d => ({ ...d, sort_order: e.target.value }))}
                  style={{ width: 60 }} />
              </td>
              <td>—</td>
              <td style={{ display: 'flex', gap: 6 }}>
                <button className="btn-primary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => save(r.id)}>Save</button>
                <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setEditId(null)}>✕</button>
              </td>
            </tr>
          ) : (
            <tr key={r.id}>
              <td style={{ color: '#aaa' }}>{r.id}</td>
              <td style={{ fontWeight: 600 }}>{r.name}</td>
              <td>
                {r.station_name
                  ? <span style={{ fontSize: 12, background: '#fff7ed', color: '#f97316', borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>{r.station_name}</span>
                  : <span style={{ color: '#ccc', fontSize: 12 }}>—</span>
                }
              </td>
              <td>{r.sort_order}</td>
              <td><span className={r.is_active ? 'badge-active' : 'badge-inactive'}>{r.is_active ? 'Active' : 'Off'}</span></td>
              <td style={{ display: 'flex', gap: 6 }}>
                <button className="btn-icon" onClick={() => { setEditId(r.id); setEditData({}); }}>✎</button>
                {r.is_active === 1 && (
                  <button className="btn-icon" style={{ color: '#dc2626' }} onClick={() => deactivate(r.id)} title="Deactivate">✕</button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="fm-empty">No departments yet</td></tr>}
        </tbody>
      </table>

      <div className="fm-form-row">
        <div className="fm-field">
          <label>Department Name *</label>
          <input placeholder="e.g. Kitchen" value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div className="fm-field">
          <label>POS Station</label>
          <select value={form.station_id}
            onChange={e => setForm(f => ({ ...f, station_id: e.target.value }))}>
            <option value="">— None —</option>
            {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="fm-field" style={{ maxWidth: 80 }}>
          <label>Sort</label>
          <input type="number" value={form.sort_order}
            onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {err && <span style={{ fontSize: 11, color: 'red' }}>{err}</span>}
          <button className="btn-primary" onClick={create}>+ Add Department</button>
        </div>
      </div>
    </div>
  );
}
