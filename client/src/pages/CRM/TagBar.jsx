import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

// Per-row Google-Contacts-style label chips with an add/create picker.
// The picker renders in a portal with fixed positioning so it is never clipped
// by the table cell's overflow. System tags render as read-only chips.
export default function TagBar({ customer, allTags, api, flash, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const popRef = useRef(null);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const W = 240;
    const left = Math.min(r.left, window.innerWidth - W - 8);
    setPos({ top: r.bottom + 4, left: Math.max(8, left) });
  }, []);

  const [vars, setVars] = useState(null);

  useEffect(() => {
    if (!open) return;
    // Popover portals to <body>, outside the .desktop-root subtree that scopes
    // --t-* theme tokens, so var(--t-*) resolves to nothing there (invisible/
    // transparent). Read the live computed values off the real shell and pass
    // them down as inline vars instead of relying on class/attribute matching.
    const root = document.querySelector('.desktop-root');
    const cs = root && getComputedStyle(root);
    const grab = (name, fallback) => (cs && cs.getPropertyValue(name).trim()) || fallback;
    setVars({
      '--t-surface': grab('--t-surface', '#fff'),
      '--t-surface-2': grab('--t-surface-2', '#f2f2f2'),
      '--t-border': grab('--t-border', '#ddd'),
      '--t-text': grab('--t-text', '#1a1a1a'),
      '--t-text-muted': grab('--t-text-muted', '#666'),
      '--t-accent': grab('--t-accent', '#2d7a2d'),
      '--t-accent-soft': grab('--t-accent-soft', 'rgba(45,122,45,.12)'),
      '--t-radius-sm': grab('--t-radius-sm', '6px'),
      '--t-radius-md': grab('--t-radius-md', '8px'),
      '--t-shadow-md': grab('--t-shadow-md', '0 8px 24px rgba(0,0,0,.25)'),
    });
    place();
    const onDown = e => {
      if (btnRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, place]);

  const mine = customer.tags || [];
  const mineIds = new Set(mine.map(t => t.id));
  const query = q.trim().toLowerCase();
  const assignable = allTags.filter(t => t.source !== 'system' && !mineIds.has(t.id) && t.name.toLowerCase().includes(query));
  const exactExists = allTags.some(t => t.name.toLowerCase() === query);

  async function add(tagId) {
    try { await api.post(`/crm/customers/${customer.phone}/tags`, { tag_id: tagId }); onChange(); }
    catch (e) { flash(e.response?.data?.error ?? 'Failed', true); }
  }
  async function remove(tagId) {
    try { await api.delete(`/crm/customers/${customer.phone}/tags/${tagId}`); onChange(); }
    catch (e) { flash(e.response?.data?.error ?? 'Failed', true); }
  }
  async function createAndAdd() {
    const name = q.trim();
    if (!name) return;
    try {
      const r = await api.post('/crm/tags', { name });
      await api.post(`/crm/customers/${customer.phone}/tags`, { tag_id: r.data.id });
      setQ(''); onChange();
    } catch (e) { flash(e.response?.data?.error ?? 'Failed', true); }
  }

  return (
    <div className="crm-tagbar">
      {mine.map(t => (
        <span key={t.id} className="crm-tagchip" style={{ '--chip': t.color }}>
          {t.name}
          {t.source !== 'system' && (
            <button className="crm-tagchip__x" title="Remove label" onClick={() => remove(t.id)}>×</button>
          )}
        </span>
      ))}
      <button ref={btnRef} className="crm-tag-add" title="Add label"
        onClick={() => { setQ(''); setOpen(o => !o); }}>+ Label</button>

      {open && vars && createPortal(
        <div className="crm-tag-pop" ref={popRef} style={{ top: pos.top, left: pos.left, ...vars }}>
          <input className="crm-tag-search" autoFocus placeholder="Find or create label…"
            value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && query && !exactExists) createAndAdd(); }} />
          <div className="crm-tag-list">
            {assignable.map(t => (
              <button key={t.id} className="crm-tag-opt" onClick={() => add(t.id)}>
                <span className="crm-tag-dot" style={{ background: t.color }} /> {t.name}
              </button>
            ))}
            {query && !exactExists && (
              <button className="crm-tag-opt crm-tag-opt--new" onClick={createAndAdd}>+ Create “{q.trim()}”</button>
            )}
            {!assignable.length && !query && <div className="crm-tag-empty">Type to find or create a label</div>}
            {!assignable.length && query && exactExists && <div className="crm-tag-empty">Already added</div>}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
