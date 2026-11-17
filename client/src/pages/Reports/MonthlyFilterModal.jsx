import { useEffect, useMemo, useState } from 'react';

/**
 * Narrows a Monthly Summary report (Item / Category / Order Type By Month)
 * without ever touching the criteria row — the report itself always defaults
 * to the complete year, unfiltered; this is purely opt-in scoping.
 * Staged locally so Cancel/backdrop-click never mutates the applied filter.
 */
export default function MonthlyFilterModal({ title, options, value, onApply, onClose }) {
  const [staged, setStaged] = useState(() => new Set(value.map(String)));
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.name.toLowerCase().includes(q) || (o.group || '').toLowerCase().includes(q));
  }, [options, query]);

  const toggle = (id) => setStaged(s => {
    const key = String(id);
    const next = new Set(s);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const apply = () => {
    // Ids came in typed (numbers for products/categories, strings for order
    // types) — hand back the same original values, not the Set's string keys.
    onApply(options.filter(o => staged.has(String(o.id))).map(o => o.id));
    onClose();
  };

  return (
    <div className="rp-modal-overlay" onClick={onClose}>
      <div className="rp-modal" onClick={e => e.stopPropagation()}>
        <div className="rp-modal-head">
          <h3>{title}</h3>
          <button className="rp-modal-x" onClick={onClose}>✕</button>
        </div>

        {options.length > 8 && (
          <input
            className="rp-modal-search"
            placeholder="Search…"
            value={query}
            autoFocus
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') apply(); }}
          />
        )}

        <div className="rp-modal-actions">
          <button type="button" onClick={() => setStaged(new Set(filtered.map(o => String(o.id))))}>Select all</button>
          <button type="button" onClick={() => setStaged(new Set())}>Clear</button>
          <span className="rp-modal-count">
            {staged.size ? `${staged.size} selected` : 'None selected — shows everything'}
          </span>
          <button type="button" className="rp-modal-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="rp-modal-apply" onClick={apply}>Apply</button>
        </div>

        <div className="rp-modal-list">
          {!filtered.length && <div className="rp-modal-empty">No matches</div>}
          {filtered.map(o => (
            <label key={o.id} className="rp-modal-opt">
              <input type="checkbox" checked={staged.has(String(o.id))} onChange={() => toggle(o.id)} />
              <span className="rp-modal-opt-name" title={o.name}>{o.name}</span>
              {o.group && <em className="rp-modal-opt-group">{o.group}</em>}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
