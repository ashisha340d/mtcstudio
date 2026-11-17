import { useEffect, useState } from 'react';

const OPTIONS = [
  { key: 'item', label: 'Item' },
  { key: 'category', label: 'Category' },
  { key: 'qty', label: 'Qty' },
  { key: 'amount', label: 'Amount' },
];

/** Saved sort → list of levels. Accepts the old single { by, dir } shape too. */
export function normalizeSort(v) {
  const list = Array.isArray(v) ? v : v?.by ? [v] : [];
  return list.flatMap(l => (l.by === 'both' ? [{ by: 'qty', dir: l.dir }, { by: 'amount', dir: l.dir }] : [l]))
    .filter(l => OPTIONS.some(o => o.key === l.by));
}

export default function MonthlySortModal({ value, onSave, onClose }) {
  const [levels, setLevels] = useState(() => {
    const n = normalizeSort(value);
    return n.length ? n : [{ by: 'qty', dir: 'desc' }];
  });

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = (i, patch) => setLevels(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const remove = (i) => setLevels(ls => ls.filter((_, j) => j !== i));
  const move = (i, d) => setLevels(ls => {
    const n = [...ls];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    return n;
  });
  const unused = OPTIONS.filter(o => !levels.some(l => l.by === o.key));
  const add = () => unused.length && setLevels(ls => [...ls, { by: unused[0].key, dir: 'desc' }]);
  const save = () => { onSave(levels); onClose(); };

  return (
    <div className="rp-modal-overlay" onClick={onClose}>
      <div className="rp-modal" onClick={e => e.stopPropagation()}>
        <div className="rp-modal-head">
          <h3>Sort — Items</h3>
          <button className="rp-modal-x" onClick={onClose}>✕</button>
        </div>

        <div className="rp-modal-actions">
          <button type="button" onClick={add} disabled={!unused.length}>+ Add level</button>
          <button type="button" onClick={() => setLevels([])}>Clear</button>
          <span className="rp-modal-count">{levels.length ? `${levels.length} level(s)` : 'Default order'}</span>
          <button type="button" className="rp-modal-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="rp-modal-apply" onClick={save}>Save</button>
        </div>

        <div className="rp-modal-list">
          {levels.map((l, i) => (
            <div key={i} className="rp-sort-level">
              <span className="rp-sort-label">{i === 0 ? 'Sort by' : 'Then by'}</span>
              <select value={l.by} onChange={e => update(i, { by: e.target.value })}>
                {OPTIONS.filter(o => o.key === l.by || !levels.some(x => x.by === o.key)).map(o => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
              <div className="rp-toggle">
                <button type="button" className={l.dir === 'asc' ? 'active' : ''} onClick={() => update(i, { dir: 'asc' })}>↑ Asc</button>
                <button type="button" className={l.dir === 'desc' ? 'active' : ''} onClick={() => update(i, { dir: 'desc' })}>↓ Desc</button>
              </div>
              <button type="button" className="rp-sort-btn" onClick={() => move(i, -1)} disabled={i === 0}>▲</button>
              <button type="button" className="rp-sort-btn" onClick={() => move(i, 1)} disabled={i === levels.length - 1}>▼</button>
              <button type="button" className="rp-sort-btn" onClick={() => remove(i)}>✕</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
