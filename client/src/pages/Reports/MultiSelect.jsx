import { useState, useRef, useEffect, useMemo, useCallback } from 'react';

const LS_KEY = 'reports.multiselect.layout';
const DEFAULT_LAYOUT = { w: 360, h: 340, nameW: 200 };
const MIN_NAME_W = 80;

function loadLayout() {
  try { return { ...DEFAULT_LAYOUT, ...JSON.parse(localStorage.getItem(LS_KEY)) }; }
  catch { return DEFAULT_LAYOUT; }
}

/**
 * Checkbox dropdown. `value` is an array of ids (empty = "All").
 * options: [{ id, name, group }]
 * Panel is resizable (drag corner) and the name/group split is draggable —
 * both persist to localStorage.
 */
export default function MultiSelect({ value, onChange, options, allLabel = 'All', placeholder = 'Search…', groupLabel = 'Category' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [layout, setLayout] = useState(loadLayout);
  const boxRef = useRef(null);
  const menuRef = useRef(null);

  const save = useCallback((next) => {
    setLayout(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* quota */ }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /* Persist whatever size the user drags the panel to. */
  useEffect(() => {
    if (!open || !menuRef.current) return;
    const el = menuRef.current;
    const ro = new ResizeObserver(() => {
      const w = Math.round(el.offsetWidth);
      const h = Math.round(el.offsetHeight);
      if (w !== layout.w || h !== layout.h) save({ ...layout, w, h });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, layout, save]);

  const startColResize = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = layout.nameW;
    const max = (menuRef.current?.clientWidth ?? 360) - 120;
    const onMove = (ev) => {
      const next = Math.max(MIN_NAME_W, Math.min(max, startW + (ev.clientX - startX)));
      setLayout(l => ({ ...l, nameW: next }));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setLayout(l => { save(l); return l; });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o =>
      o.name.toLowerCase().includes(q) || (o.group || '').toLowerCase().includes(q));
  }, [options, query]);

  const selected = new Set(value.map(String));
  const toggle = (id) => {
    const key = String(id);
    onChange(selected.has(key) ? value.filter(v => String(v) !== key) : [...value, id]);
  };

  const label = !value.length
    ? allLabel
    : value.length === 1
      ? (options.find(o => String(o.id) === String(value[0]))?.name ?? '1 selected')
      : `${value.length} selected`;

  const hasGroups = options.some(o => o.group);
  const gridStyle = { '--rp-ms-name': `${layout.nameW}px` };

  return (
    <div className="rp-ms" ref={boxRef}>
      <button type="button" className="rp-ms-trigger" onClick={() => setOpen(o => !o)} title={label}>
        <span className="rp-ms-label">{label}</span>
        <span className="rp-ms-caret">▾</span>
      </button>

      {open && (
        <div
          className={`rp-ms-menu${hasGroups ? '' : ' rp-ms-menu--nogroup'}`}
          ref={menuRef}
          style={{ width: layout.w, height: layout.h, ...gridStyle }}
        >
          <input
            className="rp-ms-search"
            placeholder={placeholder}
            value={query}
            autoFocus
            onChange={e => setQuery(e.target.value)}
          />

          <div className="rp-ms-actions">
            <button type="button" onClick={() => onChange(filtered.map(o => o.id))}>Select all</button>
            <button type="button" onClick={() => onChange([])}>Clear</button>
            <span className="rp-ms-count">{value.length ? `${value.length} selected` : `${filtered.length} items`}</span>
          </div>

          <div className="rp-ms-head">
            <span />
            <span>Item</span>
            {hasGroups && <>
              <i className="rp-ms-grip" onMouseDown={startColResize} title="Drag to resize column" />
              <span>{groupLabel}</span>
            </>}
          </div>

          <div className="rp-ms-list">
            {!filtered.length && <div className="rp-ms-none">No matches</div>}
            {filtered.map(o => (
              <label key={o.id} className="rp-ms-opt">
                <input type="checkbox" checked={selected.has(String(o.id))} onChange={() => toggle(o.id)} />
                <span className="rp-ms-name" title={o.name}>{o.name}</span>
                {hasGroups && <>
                  <i />
                  <em title={o.group || ''}>{o.group || '—'}</em>
                </>}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
