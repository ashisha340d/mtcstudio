import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import '../FileMaintenance/fm.css';

const API = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', headers: { 'X-Session-ID': 'dev-session' } });

const TYPES = [
  { key: 'CREAM_TYPE',   label: '🍦 Cream Type',   hint: 'e.g. Fresh Cream, Buttercream' },
  { key: 'SHAPE_TYPE',   label: '⬛ Shape',         hint: 'e.g. Round, Heart, Square' },
  { key: 'SPONGE_TYPE',  label: '🟤 Sponge Type',  hint: 'e.g. Vanilla, Chocolate' },
  { key: 'THEME_TYPE',   label: '🎨 Theme',         hint: 'e.g. Birthday, Wedding' },
  { key: 'DIETARY_TYPE', label: '🌿 Dietary',       hint: 'e.g. Eggless, Vegan' },
  { key: 'PRODUCT_BADGE', label: '🏷 Product Badge', hint: 'e.g. VEG, SPICY, NEW' },
];

function LookupGroup({ type, rows, onAdd, onUpdate, onDelete, onReorder }) {
  const [adding, setAdding] = useState(false);
  const [draft,  setDraft]  = useState({ name: '', extra_charge: '', description: '' });
  const [edits,  setEdits]  = useState({});
  const [saving, setSaving] = useState(false);
  const [dragSrcId, setDragSrcId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  function endDrag() { setDragSrcId(null); setDragOverId(null); }
  function rowDragHandlers(row) {
    return {
      draggable: true,
      onDragStart(e) { setDragSrcId(row.id); e.dataTransfer.effectAllowed = 'move'; },
      onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverId !== row.id) setDragOverId(row.id); },
      onDrop(e) {
        e.preventDefault();
        if (dragSrcId == null || dragSrcId === row.id) { endDrag(); return; }
        const arr = [...rows];
        const [moved] = arr.splice(arr.findIndex(x => x.id === dragSrcId), 1);
        arr.splice(arr.findIndex(x => x.id === row.id), 0, moved);
        onReorder(arr.map((x, idx) => ({ id: x.id, sort_order: idx })));
        endDrag();
      },
      onDragEnd: endDrag,
    };
  }

  function setEdit(id, field, val) {
    setEdits(e => ({ ...e, [id]: { ...(e[id] ?? {}), [field]: val } }));
  }

  function isDirty(id) { return !!edits[id] && Object.keys(edits[id]).length > 0; }

  async function save(id) {
    if (!edits[id]) return;
    setSaving(true);
    try { await onUpdate(id, edits[id]); setEdits(e => { const n = { ...e }; delete n[id]; return n; }); }
    finally { setSaving(false); }
  }

  async function add() {
    if (!draft.name.trim()) return;
    setSaving(true);
    try {
      await onAdd({ lookup_type: type.key, ...draft });
      setDraft({ name: '', extra_charge: '', description: '' });
      setAdding(false);
    } finally { setSaving(false); }
  }

  const val = (row, field) => edits[row.id]?.[field] !== undefined ? edits[row.id][field] : row[field];

  return (
    <div className="fm-card" style={{ marginBottom: 20 }}>
      <div className="fm-card__head">
        <span className="fm-card__title">{type.label}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#aaa' }}>{rows.length} entries · {type.hint}</span>
          <button className="btn-primary" style={{ padding: '4px 12px', fontSize: 11 }}
            onClick={() => setAdding(a => !a)}>
            {adding ? '✕ Cancel' : '+ Add'}
          </button>
        </div>
      </div>

      <table className="fm-table">
        <thead>
          <tr>
            <th style={{ width: 28 }}></th>
            <th>Name</th>
            <th style={{ width: 120 }}>Extra Charge (₹)</th>
            <th>Description</th>
            <th style={{ width: 80 }}>Active</th>
            <th style={{ width: 60 }}></th>
          </tr>
        </thead>
        <tbody>
          {/* Add row */}
          {adding && (
            <tr style={{ background: 'rgba(193,68,14,0.04)' }}>
              <td></td>
              <td>
                <input className="fm-inline-input" placeholder="Name…" autoFocus
                  value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && add()} />
              </td>
              <td>
                <input className="fm-inline-input" type="number" min="0" step="0.5" style={{ width: 90 }}
                  placeholder="0" value={draft.extra_charge}
                  onChange={e => setDraft(d => ({ ...d, extra_charge: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && add()} />
              </td>
              <td>
                <input className="fm-inline-input" placeholder="Optional note…"
                  value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && add()} />
              </td>
              <td>—</td>
              <td>
                <button className="btn-icon fm-save-icon" title="Add" onClick={add} disabled={saving || !draft.name.trim()}>✓</button>
              </td>
            </tr>
          )}

          {/* Existing rows */}
          {rows.map(row => (
            <tr key={row.id} {...rowDragHandlers(row)}
              className={(isDirty(row.id) ? 'fm-edit-row' : '') + (dragSrcId === row.id ? ' fm-row-dragging' : '') + (dragOverId === row.id && dragSrcId !== row.id ? ' fm-row-dragover' : '')}>
              <td className="fm-drag-handle" title="Drag to reorder">⠿</td>
              <td>
                <input className="fm-inline-input" value={val(row, 'name')}
                  onChange={e => setEdit(row.id, 'name', e.target.value)} />
              </td>
              <td>
                <input className="fm-inline-input" type="number" min="0" step="0.5" style={{ width: 90 }}
                  value={val(row, 'extra_charge') ?? 0}
                  onChange={e => setEdit(row.id, 'extra_charge', parseFloat(e.target.value) || 0)} />
              </td>
              <td>
                <input className="fm-inline-input" value={val(row, 'description') ?? ''}
                  onChange={e => setEdit(row.id, 'description', e.target.value)} />
              </td>
              <td>
                <label className="toggle">
                  <input type="checkbox" checked={!!(val(row, 'is_active'))}
                    onChange={e => setEdit(row.id, 'is_active', e.target.checked ? 1 : 0)} />
                  <span className="toggle-slider" />
                </label>
              </td>
              <td>
                <div style={{ display: 'flex', gap: 4 }}>
                  {isDirty(row.id) && (
                    <button className="btn-icon fm-save-icon" title="Save" onClick={() => save(row.id)} disabled={saving}>✓</button>
                  )}
                  <button className="btn-icon btn-icon--danger" title="Delete"
                    onClick={() => confirm(`Delete "${row.name}"?`) && onDelete(row.id)}>🗑</button>
                </div>
              </td>
            </tr>
          ))}

          {rows.length === 0 && !adding && (
            <tr><td colSpan={6} className="fm-empty">No entries yet — click + Add</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function CakeLookupTab() {
  const [rows,  setRows]  = useState([]);
  const [toast, setToast] = useState('');

  const load = useCallback(() =>
    API.get('/maintenance/cake-lookup').then(r => setRows(r.data)).catch(() => {}), []);

  useEffect(() => { load(); }, [load]);

  function flash(msg, isErr = false) {
    setToast(isErr ? `❌ ${msg}` : `✓ ${msg}`);
    setTimeout(() => setToast(''), 2500);
  }

  async function handleAdd(data) {
    try { await API.post('/maintenance/cake-lookup', data); await load(); flash('Added'); }
    catch (e) { flash(e.response?.data?.error || 'Add failed', true); throw e; }
  }

  async function handleUpdate(id, data) {
    try { await API.put(`/maintenance/cake-lookup/${id}`, data); await load(); flash('Saved'); }
    catch (e) { flash(e.response?.data?.error || 'Save failed', true); }
  }

  async function handleDelete(id) {
    try { await API.delete(`/maintenance/cake-lookup/${id}`); await load(); flash('Deleted'); }
    catch (e) { flash(e.response?.data?.error || 'Delete failed', true); }
  }

  async function handleReorder(order) {
    const bySortOrder = Object.fromEntries(order.map(o => [o.id, o.sort_order]));
    setRows(rs => rs.map(r => bySortOrder[r.id] !== undefined ? { ...r, sort_order: bySortOrder[r.id] } : r));
    try { await API.post('/maintenance/cake-lookup/reorder', { order }); }
    catch (e) { flash(e.response?.data?.error || 'Reorder failed', true); await load(); }
  }

  const grouped = (type) => rows.filter(r => r.lookup_type === type.key).sort((a,b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#2a1f12' }}>Cake Modifiers</div>
          <div style={{ fontSize: 12, color: '#9c8870', marginTop: 2 }}>
            Lookup values used in Cake Order modifiers. Extra charges are added to the order total automatically.
          </div>
        </div>
        {toast && (
          <span style={{ fontSize: 12, fontWeight: 700, color: toast.startsWith('❌') ? '#dc2626' : '#16a34a' }}>{toast}</span>
        )}
      </div>

      {TYPES.map(type => (
        <LookupGroup
          key={type.key}
          type={type}
          rows={grouped(type)}
          onAdd={handleAdd}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onReorder={handleReorder}
        />
      ))}
    </div>
  );
}
