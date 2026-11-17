import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { nextCell } from './SharedModifiersTab';

const API = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', headers: { 'X-Session-ID': 'dev-session' } });

const BLANK = { name: '', capacity: 4, section: '', sort_order: 0 };

export default function TablesTab() {
  const [rows,      setRows]    = useState([]);
  const [edits,     setEdits]   = useState({});   // { [id]: partialRow }
  const [newRow,    setNewRow]  = useState(BLANK);
  const [err,       setErr]     = useState('');
  const [saving,    setSaving]  = useState(false);
  const [toast,     setToast]   = useState('');
  const dragId                  = useRef(null);
  const dragOver                = useRef(null);

  // Add-row field refs for Enter navigation
  const addRefs = useRef([]);

  const load = useCallback(() =>
    API.get('/maintenance/tables').then(r => setRows(r.data)).catch(() => {}), []);

  useEffect(() => { load(); }, [load]);

  function setField(id, field, val) {
    setEdits(e => ({ ...e, [id]: { ...(e[id] ?? {}), [field]: val } }));
  }

  function isDirty(id) { return !!edits[id] && Object.keys(edits[id]).length > 0; }
  const dirtyCount = Object.keys(edits).filter(id => isDirty(Number(id))).length;

  async function saveRow(id) {
    if (!edits[id]) return;
    await API.put(`/maintenance/tables/${id}`, edits[id]).catch(e => { throw e; });
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
      await API.post('/maintenance/tables', {
        name: newRow.name.trim(), capacity: newRow.capacity,
        section: newRow.section, sort_order: newRow.sort_order,
      });
      setNewRow(BLANK); setErr(''); await load(); flash('Table added');
    } catch (e) { setErr(e.response?.data?.error ?? 'Error'); }
    finally { setSaving(false); }
  }

  async function deleteRow(id) {
    if (!confirm('Delete this table?')) return;
    try {
      await API.delete(`/maintenance/tables/${id}`);
      setRows(r => r.filter(x => x.id !== id));
      setEdits(e => { const n = { ...e }; delete n[id]; return n; });
      flash('Deleted');
    } catch (e) { flash(e.response?.data?.error ?? 'Delete failed', true); }
  }

  async function toggleActive(row) {
    await API.put(`/maintenance/tables/${row.id}`, { is_active: row.is_active ? 0 : 1 }).catch(() => {});
    load();
  }

  // ── Drag-and-drop sort ──────────────────────────────────────
  function onDragStart(e, id) {
    dragId.current = id;
    e.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(e, id) {
    e.preventDefault();
    dragOver.current = id;
  }
  async function onDrop() {
    if (dragId.current === dragOver.current || !dragId.current || !dragOver.current) return;
    const order = [...rows];
    const fromIdx = order.findIndex(r => r.id === dragId.current);
    const toIdx   = order.findIndex(r => r.id === dragOver.current);
    order.splice(toIdx, 0, order.splice(fromIdx, 1)[0]);
    const reordered = order.map((r, i) => ({ ...r, sort_order: i }));
    setRows(reordered);
    dragId.current = null; dragOver.current = null;
    await API.post('/maintenance/tables/reorder', {
      order: reordered.map(r => ({ id: r.id, sort_order: r.sort_order })),
    }).catch(() => {});
  }

  // ── Enter-key navigation in add row ─────────────────────────
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
        <span className="fm-card__title">Restaurant Tables</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {toast && <span style={{ fontSize: 12, color: toast.startsWith('❌') ? 'var(--t-danger)' : 'var(--t-success)' }}>{toast}</span>}
          <span style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>{rows.length} tables</span>
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
            <th>Name</th><th>Capacity</th><th>Section</th><th>Sort</th><th>Active</th>
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
              <td style={{ color: 'var(--t-text-soft)', fontSize: 16, textAlign: 'center', cursor: 'grab' }}>⋮⋮</td>
              <td>
                <input
                  className="fm-inline-input"
                  value={val(r, 'name')}
                  onChange={e => setField(r.id, 'name', e.target.value)}
                  onKeyDown={nextCell}
                />
              </td>
              <td>
                <input
                  className="fm-inline-input"
                  type="number" style={{ width: 60 }}
                  value={val(r, 'capacity')}
                  onChange={e => setField(r.id, 'capacity', e.target.value)}
                  onKeyDown={nextCell}
                />
              </td>
              <td>
                <input
                  className="fm-inline-input"
                  value={val(r, 'section') ?? ''}
                  onChange={e => setField(r.id, 'section', e.target.value)}
                  onKeyDown={nextCell}
                />
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
                <label className="toggle">
                  <input type="checkbox" checked={!!r.is_active} onChange={() => toggleActive(r)} />
                  <span className="toggle-slider" />
                </label>
              </td>
              <td>
                <div style={{ display: 'flex', gap: 4 }}>
                  {isDirty(r.id) && (
                    <button className="btn-icon fm-save-icon" title="Save row" onClick={() => saveRow(r.id).then(load)}>✓</button>
                  )}
                  <button
                    className="btn-icon"
                    title="Copy customer QR link"
                    onClick={() => {
                      const url = `${window.location.origin}/menu/${r.id}`;
                      navigator.clipboard?.writeText(url).then(() => flash(`QR link copied for ${r.name}`));
                    }}
                  >🔗</button>
                  <button className="btn-icon btn-icon--danger" title="Delete" onClick={() => deleteRow(r.id)}>🗑</button>
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="fm-empty">No tables yet</td></tr>}
        </tbody>
      </table>

      {/* Add row */}
      <div className="fm-form-row">
        <div className="fm-field">
          <label>Name *</label>
          <input
            ref={el => addRefs.current[0] = el}
            placeholder="e.g. T9"
            value={newRow.name}
            onChange={e => setNewRow(f => ({ ...f, name: e.target.value }))}
            onKeyDown={e => onAddKeyDown(e, 0, false)}
          />
        </div>
        <div className="fm-field" style={{ maxWidth: 80 }}>
          <label>Capacity</label>
          <input
            ref={el => addRefs.current[1] = el}
            type="number" value={newRow.capacity}
            onChange={e => setNewRow(f => ({ ...f, capacity: e.target.value }))}
            onKeyDown={e => onAddKeyDown(e, 1, false)}
          />
        </div>
        <div className="fm-field">
          <label>Section</label>
          <input
            ref={el => addRefs.current[2] = el}
            placeholder="Indoor / Terrace"
            value={newRow.section}
            onChange={e => setNewRow(f => ({ ...f, section: e.target.value }))}
            onKeyDown={e => onAddKeyDown(e, 2, false)}
          />
        </div>
        <div className="fm-field" style={{ maxWidth: 80 }}>
          <label>Sort</label>
          <input
            ref={el => addRefs.current[3] = el}
            type="number" value={newRow.sort_order}
            onChange={e => setNewRow(f => ({ ...f, sort_order: e.target.value }))}
            onKeyDown={e => onAddKeyDown(e, 3, true)}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {err && <span style={{ fontSize: 11, color: 'red' }}>{err}</span>}
          <button className="btn-primary" onClick={addRow} disabled={saving}>+ Add Table</button>
        </div>
      </div>
      <div className="fm-hint">Drag ⋮⋮ rows to reorder · Press Enter in row to save · Enter in last add-field to submit</div>
    </div>
  );
}
