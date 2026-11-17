import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'X-Session-ID': sessionStorage.getItem('mtc_session') || 'dev-session' },
});

export default function TableTagsTab() {
  const [rows,    setRows]    = useState([]);
  const [adding,  setAdding]  = useState(false);
  const [draft,   setDraft]   = useState({ code: '', name: '', value: '' });
  const [edits,   setEdits]   = useState({});
  const [busy,    setBusy]    = useState(false);
  const [toast,   setToast]   = useState('');

  const load = useCallback(() =>
    API.get('/maintenance/cake-lookup')
      .then(r => setRows(r.data.filter(x => x.lookup_type === 'TABLE_TAG')))
      .catch(() => {}),
  []);

  useEffect(() => { load(); }, [load]);

  function flash(msg, err = false) {
    setToast(err ? `❌ ${msg}` : `✓ ${msg}`);
    setTimeout(() => setToast(''), 2500);
  }

  function setEdit(id, field, val) {
    setEdits(e => ({ ...e, [id]: { ...(e[id] ?? {}), [field]: val } }));
  }

  function isDirty(id) { return !!(edits[id] && Object.keys(edits[id]).length); }

  function val(row, field) {
    return edits[row.id]?.[field] !== undefined ? edits[row.id][field] : (row[field] ?? '');
  }

  async function addRow() {
    if (!draft.name.trim()) return;
    setBusy(true);
    try {
      await API.post('/maintenance/cake-lookup', {
        lookup_type: 'TABLE_TAG',
        code:  draft.code.trim()  || draft.name.trim().toUpperCase().replace(/\s+/g,'_'),
        name:  draft.name.trim(),
        value: draft.value.trim() || null,
      });
      setDraft({ code: '', name: '', value: '' });
      setAdding(false);
      await load();
      flash('Tag added');
    } catch (e) { flash(e.response?.data?.error || 'Add failed', true); }
    finally { setBusy(false); }
  }

  async function saveRow(id) {
    if (!edits[id]) return;
    setBusy(true);
    try {
      await API.put(`/maintenance/cake-lookup/${id}`, edits[id]);
      setEdits(e => { const n = { ...e }; delete n[id]; return n; });
      await load();
      flash('Saved');
    } catch (e) { flash(e.response?.data?.error || 'Save failed', true); }
    finally { setBusy(false); }
  }

  async function deleteRow(id, name) {
    if (!window.confirm(`Delete tag "${name}"?`)) return;
    setBusy(true);
    try { await API.delete(`/maintenance/cake-lookup/${id}`); await load(); flash('Deleted'); }
    catch (e) { flash(e.response?.data?.error || 'Delete failed', true); }
    finally { setBusy(false); }
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
        <div>
          <div style={{ fontSize:16, fontWeight:800, color:'var(--t-text)' }}>🏷 Table Tags</div>
          <div style={{ fontSize:12, color:'var(--t-text-soft)', marginTop:4 }}>
            Tags shown in the Waiter App side menu (☰). Stored in <code>lookup_master</code> as <code>TABLE_TAG</code>.
            <br />
            <strong>Value</strong> = emoji displayed · <strong>Code</strong> = internal key · <strong>Name</strong> = label in waiter app.
          </div>
        </div>
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          {toast && (
            <span style={{ fontSize:12, fontWeight:700, color: toast.startsWith('❌') ? 'var(--t-danger)' : 'var(--t-success)' }}>
              {toast}
            </span>
          )}
          <button
            className="btn-primary"
            style={{ padding:'6px 16px', fontSize:12 }}
            onClick={() => setAdding(a => !a)}
          >
            {adding ? '✕ Cancel' : '+ Add Tag'}
          </button>
        </div>
      </div>

      <div className="fm-card">
        <table className="fm-table">
          <thead>
            <tr>
              <th style={{ width: 70 }}>Emoji</th>
              <th style={{ width: 160 }}>Code (key)</th>
              <th>Name (display in app)</th>
              <th style={{ width: 80 }}>Active</th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {/* Add row */}
            {adding && (
              <tr style={{ background:'var(--t-accent-soft)' }}>
                <td>
                  <input
                    className="fm-inline-input"
                    style={{ width:60, textAlign:'center', fontSize:20 }}
                    placeholder="👑"
                    value={draft.value}
                    onChange={e => setDraft(d => ({ ...d, value: e.target.value }))}
                  />
                </td>
                <td>
                  <input
                    className="fm-inline-input"
                    placeholder="VIP (auto from name)"
                    value={draft.code}
                    onChange={e => setDraft(d => ({ ...d, code: e.target.value.toUpperCase() }))}
                    onKeyDown={e => e.key === 'Enter' && addRow()}
                  />
                </td>
                <td>
                  <input
                    className="fm-inline-input"
                    placeholder="Display label…"
                    autoFocus
                    value={draft.name}
                    onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && addRow()}
                  />
                </td>
                <td>—</td>
                <td>
                  <button
                    className="btn-icon fm-save-icon"
                    title="Add"
                    onClick={addRow}
                    disabled={busy || !draft.name.trim()}
                  >✓</button>
                </td>
              </tr>
            )}

            {/* Existing rows */}
            {rows.map(row => (
              <tr key={row.id} className={isDirty(row.id) ? 'fm-edit-row' : ''}>
                <td>
                  <input
                    className="fm-inline-input"
                    style={{ width:60, textAlign:'center', fontSize:20 }}
                    value={val(row, 'value')}
                    onChange={e => setEdit(row.id, 'value', e.target.value)}
                    title="Emoji shown next to tag name"
                  />
                </td>
                <td>
                  <input
                    className="fm-inline-input"
                    value={val(row, 'code')}
                    onChange={e => setEdit(row.id, 'code', e.target.value.toUpperCase())}
                    title="Internal key stored in order"
                  />
                </td>
                <td>
                  <input
                    className="fm-inline-input"
                    value={val(row, 'name')}
                    onChange={e => setEdit(row.id, 'name', e.target.value)}
                  />
                </td>
                <td>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={!!(val(row, 'is_active') === '' ? row.is_active : val(row, 'is_active'))}
                      onChange={e => setEdit(row.id, 'is_active', e.target.checked ? 1 : 0)}
                    />
                    <span className="toggle-slider" />
                  </label>
                </td>
                <td>
                  <div style={{ display:'flex', gap:4 }}>
                    {isDirty(row.id) && (
                      <button
                        className="btn-icon fm-save-icon"
                        title="Save"
                        onClick={() => saveRow(row.id)}
                        disabled={busy}
                      >✓</button>
                    )}
                    <button
                      className="btn-icon btn-icon--danger"
                      title="Delete"
                      onClick={() => deleteRow(row.id, row.name)}
                    >🗑</button>
                  </div>
                </td>
              </tr>
            ))}

            {rows.length === 0 && !adding && (
              <tr>
                <td colSpan={5} className="fm-empty">
                  No table tags yet — click + Add Tag to create one
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Preview */}
      {rows.filter(r => r.is_active).length > 0 && (
        <div style={{ marginTop:20 }}>
          <div style={{ fontSize:12, fontWeight:700, color:'var(--t-text-soft)', textTransform:'uppercase', letterSpacing:1, marginBottom:8 }}>
            Preview — waiter app side menu
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
            {rows.filter(r => r.is_active).sort((a,b) => a.sort_order - b.sort_order).map(tag => (
              <div
                key={tag.id}
                style={{ display:'flex', alignItems:'center', gap:8, background:'var(--t-surface-2)', border:'1.5px solid var(--t-border)', borderRadius:10, padding:'8px 14px', fontSize:14, fontWeight:600, color:'var(--t-text)' }}
              >
                <span style={{ fontSize:20 }}>{tag.value}</span>
                <span>{tag.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
