import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';

const API = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'X-Session-ID': 'dev-session' },
});

// ── Spreadsheet Enter-nav helper ────────────────────────────
// Call on any input's onKeyDown — moves focus to next .fm-inline-input or .fm-add-input in DOM
export function nextCell(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const all = Array.from(
    e.target.closest('.fm-card')?.querySelectorAll('.fm-inline-input, .fm-add-input') ?? []
  );
  const idx = all.indexOf(e.target);
  const next = all[idx + 1];
  if (next) { next.focus(); next.select?.(); }
}

const BLANK_MOD = { name: '', price: 0, group_id: '', sort_order: 0 };
const BLANK_GRP = { name: '', sort_order: 0 };

export default function SharedModifiersTab() {
  const [groups,  setGroups]  = useState([]);
  const [mods,    setMods]    = useState([]);
  const [gEdits,  setGEdits]  = useState({});
  const [mEdits,  setMEdits]  = useState({});
  const [newGrp,  setNewGrp]  = useState(BLANK_GRP);
  const [newMod,  setNewMod]  = useState(BLANK_MOD);
  const [gErr,    setGErr]    = useState('');
  const [mErr,    setMErr]    = useState('');
  const [saving,  setSaving]  = useState(false);
  const [toast,   setToast]   = useState('');
  const grpAddRefs            = useRef([]);
  const modAddRefs            = useRef([]);

  const loadGroups = useCallback(async () => {
    const r = await API.get('/food-menu/modifier-groups').catch(() => ({ data: [] }));
    setGroups(r.data);
  }, []);

  const loadMods = useCallback(async () => {
    const r = await API.get('/food-menu/shared-modifiers-all').catch(() => ({ data: [] }));
    setMods(r.data);
  }, []);

  useEffect(() => { loadGroups(); loadMods(); }, [loadGroups, loadMods]);

  function flash(msg, isErr = false) {
    setToast(isErr ? `❌ ${msg}` : `✓ ${msg}`);
    setTimeout(() => setToast(''), 2500);
  }

  // ── Groups ───────────────────────────────────────────────
  function setGField(id, field, val) {
    setGEdits(e => ({ ...e, [id]: { ...(e[id] ?? {}), [field]: val } }));
  }
  function isGDirty(id) { return !!gEdits[id] && Object.keys(gEdits[id]).length > 0; }
  const gDirty = Object.keys(gEdits).filter(id => isGDirty(Number(id))).length;

  async function saveGroup(id) {
    if (!gEdits[id]) return;
    await API.put(`/food-menu/modifier-groups/${id}`, gEdits[id]);
    setGEdits(e => { const n = { ...e }; delete n[id]; return n; });
  }
  async function saveAllGroups() {
    const dirty = Object.keys(gEdits).filter(id => isGDirty(Number(id)));
    if (!dirty.length) return;
    setSaving(true);
    try {
      await Promise.all(dirty.map(id => saveGroup(Number(id))));
      await loadGroups(); flash(`${dirty.length} group(s) saved`);
    } catch { flash('Save failed', true); }
    finally { setSaving(false); }
  }
  async function addGroup() {
    if (!newGrp.name.trim()) return setGErr('Name required');
    setSaving(true);
    try {
      await API.post('/food-menu/modifier-groups', { name: newGrp.name.trim(), sort_order: +newGrp.sort_order });
      setNewGrp(BLANK_GRP); setGErr('');
      await loadGroups(); flash('Group added');
    } catch (e) { setGErr(e.response?.data?.error ?? 'Error'); }
    finally { setSaving(false); }
  }
  async function deleteGroup(id) {
    if (!confirm('Delete group? Its modifiers will become ungrouped.')) return;
    await API.delete(`/food-menu/modifier-groups/${id}`);
    await loadGroups(); await loadMods(); flash('Group deleted');
  }

  // ── Shared Modifiers ─────────────────────────────────────
  function setMField(id, field, val) {
    setMEdits(e => ({ ...e, [id]: { ...(e[id] ?? {}), [field]: val } }));
  }
  function isMDirty(id) { return !!mEdits[id] && Object.keys(mEdits[id]).length > 0; }
  const mDirty = Object.keys(mEdits).filter(id => isMDirty(Number(id))).length;

  async function saveMod(id) {
    if (!mEdits[id]) return;
    await API.put(`/food-menu/shared-modifiers/${id}`, mEdits[id]);
    setMEdits(e => { const n = { ...e }; delete n[id]; return n; });
  }
  async function saveAllMods() {
    const dirty = Object.keys(mEdits).filter(id => isMDirty(Number(id)));
    if (!dirty.length) return;
    setSaving(true);
    try {
      await Promise.all(dirty.map(id => saveMod(Number(id))));
      await loadMods(); flash(`${dirty.length} modifier(s) saved`);
    } catch { flash('Save failed', true); }
    finally { setSaving(false); }
  }
  async function addMod() {
    if (!newMod.name.trim()) return setMErr('Name required');
    setSaving(true);
    try {
      await API.post('/food-menu/shared-modifiers', {
        name: newMod.name.trim(),
        price: +newMod.price || 0,
        group_id: newMod.group_id ? +newMod.group_id : null,
        sort_order: +newMod.sort_order || 0,
      });
      setNewMod(BLANK_MOD); setMErr('');
      await loadMods(); flash('Modifier added');
    } catch (e) { setMErr(e.response?.data?.error ?? 'Error'); }
    finally { setSaving(false); }
  }
  async function deleteMod(id) {
    if (!confirm('Delete modifier? All product assignments will be removed.')) return;
    await API.delete(`/food-menu/shared-modifiers/${id}`);
    setMods(m => m.filter(x => x.id !== id));
    flash('Modifier deleted');
  }

  const gVal = (row, f) => gEdits[row.id]?.[f] !== undefined ? gEdits[row.id][f] : row[f];
  const mVal = (row, f) => mEdits[row.id]?.[f] !== undefined ? mEdits[row.id][f] : row[f];

  function grpAddEnter(e, idx, last) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (last) addGroup();
    else grpAddRefs.current[idx + 1]?.focus();
  }
  function modAddEnter(e, idx, last) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (last) addMod();
    else modAddRefs.current[idx + 1]?.focus();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Modifier Groups ─────────────────────────────── */}
      <div className="fm-card">
        <div className="fm-card__head">
          <span className="fm-card__title">Modifier Groups</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {toast && <span style={{ fontSize: 12, color: toast.startsWith('❌') ? 'var(--t-danger)' : 'var(--t-success)' }}>{toast}</span>}
            <span style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>{groups.length} groups</span>
            {gDirty > 0 && (
              <button className="btn-primary" style={{ padding: '5px 14px', fontSize: 12 }} onClick={saveAllGroups} disabled={saving}>
                {saving ? 'Saving…' : `Save All (${gDirty})`}
              </button>
            )}
          </div>
        </div>

        <table className="fm-table">
          <thead>
            <tr><th>Group Name</th><th>Sort</th><th style={{ width: 90 }}></th></tr>
          </thead>
          <tbody>
            {groups.map(g => (
              <tr key={g.id} className={isGDirty(g.id) ? 'fm-edit-row' : ''}>
                <td>
                  <input className="fm-inline-input" value={gVal(g, 'name')}
                    onChange={e => setGField(g.id, 'name', e.target.value)}
                    onKeyDown={nextCell} />
                </td>
                <td>
                  <input className="fm-inline-input" type="number" style={{ width: 64 }}
                    value={gVal(g, 'sort_order')}
                    onChange={e => setGField(g.id, 'sort_order', e.target.value)}
                    onKeyDown={nextCell} />
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {isGDirty(g.id) && (
                      <button className="btn-icon fm-save-icon" onClick={() => saveGroup(g.id).then(loadGroups)}>✓</button>
                    )}
                    <button className="btn-icon btn-icon--danger" onClick={() => deleteGroup(g.id)}>🗑</button>
                  </div>
                </td>
              </tr>
            ))}
            {groups.length === 0 && <tr><td colSpan={3} className="fm-empty">No groups yet</td></tr>}
          </tbody>
        </table>

        <div className="fm-form-row">
          <div className="fm-field">
            <label>Group Name *</label>
            <input className="fm-add-input" ref={el => grpAddRefs.current[0] = el}
              placeholder="e.g. Pizza Toppings" value={newGrp.name}
              onChange={e => setNewGrp(f => ({ ...f, name: e.target.value }))}
              onKeyDown={e => grpAddEnter(e, 0, false)} />
          </div>
          <div className="fm-field" style={{ maxWidth: 80 }}>
            <label>Sort</label>
            <input className="fm-add-input" ref={el => grpAddRefs.current[1] = el}
              type="number" value={newGrp.sort_order}
              onChange={e => setNewGrp(f => ({ ...f, sort_order: e.target.value }))}
              onKeyDown={e => grpAddEnter(e, 1, true)} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {gErr && <span style={{ fontSize: 11, color: 'red' }}>{gErr}</span>}
            <button className="btn-primary" onClick={addGroup} disabled={saving}>+ Add Group</button>
          </div>
        </div>
        <div className="fm-hint">Enter moves to next cell · ✓ saves row · Enter on last add-field submits</div>
      </div>

      {/* ── Shared Modifiers ────────────────────────────── */}
      <div className="fm-card">
        <div className="fm-card__head">
          <span className="fm-card__title">Shared Modifiers</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 12, color: 'var(--t-text-muted)' }}>{mods.length} modifiers</span>
            {mDirty > 0 && (
              <button className="btn-primary" style={{ padding: '5px 14px', fontSize: 12 }} onClick={saveAllMods} disabled={saving}>
                {saving ? 'Saving…' : `Save All (${mDirty})`}
              </button>
            )}
          </div>
        </div>

        <table className="fm-table">
          <thead>
            <tr><th>Name</th><th>Group</th><th>Price (₹)</th><th>Sort</th><th style={{ width: 90 }}></th></tr>
          </thead>
          <tbody>
            {mods.map(m => (
              <tr key={m.id} className={isMDirty(m.id) ? 'fm-edit-row' : ''}>
                <td>
                  <input className="fm-inline-input" value={mVal(m, 'name')}
                    onChange={e => setMField(m.id, 'name', e.target.value)}
                    onKeyDown={nextCell} />
                </td>
                <td>
                  <select className="fm-inline-input" style={{ padding: '4px 6px' }}
                    value={mVal(m, 'group_id') ?? ''}
                    onChange={e => setMField(m.id, 'group_id', e.target.value || null)}
                    onKeyDown={nextCell}>
                    <option value="">— None —</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </td>
                <td>
                  <input className="fm-inline-input" type="number" step="0.5" style={{ width: 80 }}
                    value={mVal(m, 'price')}
                    onChange={e => setMField(m.id, 'price', e.target.value)}
                    onKeyDown={nextCell} />
                </td>
                <td>
                  <input className="fm-inline-input" type="number" style={{ width: 56 }}
                    value={mVal(m, 'sort_order')}
                    onChange={e => setMField(m.id, 'sort_order', e.target.value)}
                    onKeyDown={nextCell} />
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {isMDirty(m.id) && (
                      <button className="btn-icon fm-save-icon" onClick={() => saveMod(m.id).then(loadMods)}>✓</button>
                    )}
                    <button className="btn-icon btn-icon--danger" onClick={() => deleteMod(m.id)}>🗑</button>
                  </div>
                </td>
              </tr>
            ))}
            {mods.length === 0 && <tr><td colSpan={5} className="fm-empty">No modifiers yet</td></tr>}
          </tbody>
        </table>

        <div className="fm-form-row">
          <div className="fm-field">
            <label>Name *</label>
            <input className="fm-add-input" ref={el => modAddRefs.current[0] = el}
              placeholder="e.g. Extra Cheese" value={newMod.name}
              onChange={e => setNewMod(f => ({ ...f, name: e.target.value }))}
              onKeyDown={e => modAddEnter(e, 0, false)} />
          </div>
          <div className="fm-field" style={{ maxWidth: 160 }}>
            <label>Group</label>
            <select className="fm-add-input" ref={el => modAddRefs.current[1] = el}
              value={newMod.group_id}
              onChange={e => setNewMod(f => ({ ...f, group_id: e.target.value }))}
              onKeyDown={e => modAddEnter(e, 1, false)}>
              <option value="">— None —</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div className="fm-field" style={{ maxWidth: 100 }}>
            <label>Price (₹)</label>
            <input className="fm-add-input" ref={el => modAddRefs.current[2] = el}
              type="number" step="0.5" placeholder="0" value={newMod.price}
              onChange={e => setNewMod(f => ({ ...f, price: e.target.value }))}
              onKeyDown={e => modAddEnter(e, 2, false)} />
          </div>
          <div className="fm-field" style={{ maxWidth: 80 }}>
            <label>Sort</label>
            <input className="fm-add-input" ref={el => modAddRefs.current[3] = el}
              type="number" value={newMod.sort_order}
              onChange={e => setNewMod(f => ({ ...f, sort_order: e.target.value }))}
              onKeyDown={e => modAddEnter(e, 3, true)} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {mErr && <span style={{ fontSize: 11, color: 'red' }}>{mErr}</span>}
            <button className="btn-primary" onClick={addMod} disabled={saving}>+ Add Modifier</button>
          </div>
        </div>
        <div className="fm-hint">Enter moves to next cell · ✓ saves row · Enter on last add-field submits</div>
      </div>
    </div>
  );
}
