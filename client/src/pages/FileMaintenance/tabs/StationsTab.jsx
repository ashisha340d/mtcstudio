import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { nextCell } from './SharedModifiersTab';

const API = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', headers: { 'X-Session-ID': 'dev-session' } });

const BLANK = { name: '', color_hex: '#f97316', sort_order: 0 };

export default function StationsTab() {
  const [rows,    setRows]   = useState([]);
  const [edits,   setEdits]  = useState({});
  const [newRow,  setNewRow] = useState(BLANK);
  const [err,     setErr]    = useState('');
  const [saving,  setSaving] = useState(false);
  const [toast,   setToast]  = useState('');
  const dragId               = useRef(null);
  const dragOver             = useRef(null);
  const addRefs              = useRef([]);

  const load = useCallback(() =>
    API.get('/maintenance/stations').then(r => setRows(r.data)).catch(() => {}), []);

  useEffect(() => { load(); }, [load]);

  function setField(id, field, val) {
    setEdits(e => ({ ...e, [id]: { ...(e[id] ?? {}), [field]: val } }));
  }

  function isDirty(id) { return !!edits[id] && Object.keys(edits[id]).length > 0; }
  const dirtyCount = Object.keys(edits).filter(id => isDirty(Number(id))).length;

  async function saveRow(id) {
    if (!edits[id]) return;
    await API.put(`/maintenance/stations/${id}`, edits[id]);
    setEdits(e => { const n = { ...e }; delete n[id]; return n; });
  }

  async function saveAll() {
    const dirty = Object.keys(edits).filter(id => isDirty(Number(id)));
    if (!dirty.length) return;
    setSaving(true);
    try {
      await Promise.all(dirty.map(id => saveRow(Number(id))));
      await load();
      flash(`${dirty.length} row(s) saved`);
    } catch { flash('Save failed', true); }
    finally { setSaving(false); }
  }

  async function addRow() {
    if (!newRow.name.trim()) return setErr('Name required');
    setSaving(true);
    try {
      await API.post('/maintenance/stations', {
        name: newRow.name.trim(), color_hex: newRow.color_hex, sort_order: newRow.sort_order,
      });
      setNewRow(BLANK); setErr(''); await load(); flash('Station added');
    } catch (e) { setErr(e.response?.data?.error ?? 'Error'); }
    finally { setSaving(false); }
  }

  async function deleteRow(id) {
    if (!confirm('Delete this station? Products linked to it will have their station cleared.')) return;
    try {
      await API.delete(`/maintenance/stations/${id}`);
      setRows(r => r.filter(x => x.id !== id));
      setEdits(e => { const n = { ...e }; delete n[id]; return n; });
      flash('Deleted');
    } catch (e) { flash(e.response?.data?.error ?? 'Delete failed', true); }
  }

  // Drag-and-drop
  function onDragStart(e, id) { dragId.current = id; e.dataTransfer.effectAllowed = 'move'; }
  function onDragOver(e, id)  { e.preventDefault(); dragOver.current = id; }
  async function onDrop() {
    if (dragId.current === dragOver.current || !dragId.current || !dragOver.current) return;
    const order = [...rows];
    const fi = order.findIndex(r => r.id === dragId.current);
    const ti = order.findIndex(r => r.id === dragOver.current);
    order.splice(ti, 0, order.splice(fi, 1)[0]);
    const reordered = order.map((r, i) => ({ ...r, sort_order: i }));
    setRows(reordered);
    dragId.current = null; dragOver.current = null;
    await API.post('/maintenance/stations/reorder', {
      order: reordered.map(r => ({ id: r.id, sort_order: r.sort_order })),
    }).catch(() => {});
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
        <span className="fm-card__title">Kitchen Stations</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {toast && <span style={{ fontSize: 12, color: toast.startsWith('❌') ? '#dc2626' : '#16a34a' }}>{toast}</span>}
          <span style={{ fontSize: 12, color: '#999' }}>{rows.length} stations</span>
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
            <th style={{ width: 24 }}></th>
            <th>Name</th><th>Color</th><th>Sort</th><th>Active</th>
            <th style={{ width: 90 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr
              key={r.id}
              className={isDirty(r.id) ? 'fm-edit-row' : ''}
              draggable
              onDragStart={e => onDragStart(e, r.id)}
              onDragOver={e => onDragOver(e, r.id)}
              onDrop={onDrop}
              style={{ cursor: 'grab' }}
            >
              <td style={{ color: '#ccc', fontSize: 16, textAlign: 'center', cursor: 'grab' }}>⋮⋮</td>
              <td>
                <span className="color-swatch" style={{ background: val(r, 'color_hex') }} />
                <input
                  className="fm-inline-input"
                  style={{ width: 'calc(100% - 28px)' }}
                  value={val(r, 'name')}
                  onChange={e => setField(r.id, 'name', e.target.value)}
                  onKeyDown={nextCell}
                />
              </td>
              <td>
                <input
                  type="color"
                  value={val(r, 'color_hex')}
                  onChange={e => setField(r.id, 'color_hex', e.target.value)}
                  style={{ width: 40, height: 28, padding: 2, border: '1px solid #ddd', borderRadius: 4, cursor: 'pointer' }}
                />
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#999', marginLeft: 6 }}>
                  {val(r, 'color_hex')}
                </span>
              </td>
              <td>
                <input
                  className="fm-inline-input"
                  type="number" style={{ width: 56 }}
                  value={val(r, 'sort_order')}
                  onChange={e => setField(r.id, 'sort_order', e.target.value)}
                  onKeyDown={nextCell}
                />
              </td>
              <td>
                <span className={r.is_active ? 'badge-active' : 'badge-inactive'}>
                  {r.is_active ? 'Active' : 'Off'}
                </span>
              </td>
              <td>
                <div style={{ display: 'flex', gap: 4 }}>
                  {isDirty(r.id) && (
                    <button className="btn-icon fm-save-icon" title="Save row" onClick={() => saveRow(r.id).then(load)}>✓</button>
                  )}
                  <button className="btn-icon btn-icon--danger" title="Delete station" onClick={() => deleteRow(r.id)}>🗑</button>
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="fm-empty">No stations</td></tr>}
        </tbody>
      </table>

      <div className="fm-form-row">
        <div className="fm-field">
          <label>Name *</label>
          <input
            ref={el => addRefs.current[0] = el}
            placeholder="e.g. Tandoor"
            value={newRow.name}
            onChange={e => setNewRow(f => ({ ...f, name: e.target.value }))}
            onKeyDown={e => onAddKeyDown(e, 0, false)}
          />
        </div>
        <div className="fm-field" style={{ maxWidth: 100 }}>
          <label>Color</label>
          <input
            ref={el => addRefs.current[1] = el}
            type="color"
            value={newRow.color_hex}
            onChange={e => setNewRow(f => ({ ...f, color_hex: e.target.value }))}
            onKeyDown={e => onAddKeyDown(e, 1, false)}
            style={{ height: 36, padding: 2, border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer', width: '100%' }}
          />
        </div>
        <div className="fm-field" style={{ maxWidth: 80 }}>
          <label>Sort</label>
          <input
            ref={el => addRefs.current[2] = el}
            type="number"
            value={newRow.sort_order}
            onChange={e => setNewRow(f => ({ ...f, sort_order: e.target.value }))}
            onKeyDown={e => onAddKeyDown(e, 2, true)}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {err && <span style={{ fontSize: 11, color: 'red' }}>{err}</span>}
          <button className="btn-primary" onClick={addRow} disabled={saving}>+ Add Station</button>
        </div>
      </div>
      <div className="fm-hint">Drag ⋮⋮ to reorder · Edit cells inline · Enter to save row · 🗑 to delete</div>
    </div>
  );
}
