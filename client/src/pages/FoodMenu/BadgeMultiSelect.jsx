import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import './BadgeMultiSelect.css';

/**
 * Multi-select for Product Badges — compact chip cell; clicking it opens a
 * simple centered modal (portaled to <body>) with search + toggle pills.
 *
 * Options come from lookup_master (lookup_type='PRODUCT_BADGE'); the value this
 * component holds/emits is always an array of badge CODES — icon/name are only
 * resolved for display via the `options` catalogue, so a stale/unknown code in
 * `value` is silently skipped rather than rendered broken.
 *
 * Props:
 *   options     [{ code, name, icon }]  — full badge catalogue (already active-only)
 *   value       string[]                — selected codes, order preserved
 *   onChange    (string[]) => void
 *   placeholder string
 */
export default function BadgeMultiSelect({ options = [], value = [], onChange, placeholder = 'Click to add…' }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const searchRef = useRef(null);

  const byCode = useMemo(() => {
    const m = new Map();
    options.forEach(o => m.set(o.code, o));
    return m;
  }, [options]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const query = q.trim().toLowerCase();
  const filtered = useMemo(() => options.filter(o =>
    o.name.toLowerCase().includes(query) || o.code.toLowerCase().includes(query)
  ), [options, query]);

  function toggleBadge(code) {
    onChange(value.includes(code) ? value.filter(c => c !== code) : [...value, code]);
  }

  function removeBadge(code) { onChange(value.filter(c => c !== code)); }

  function close() { setOpen(false); setQ(''); }

  return (
    <div className="bms-wrap">
      <div className="bms-box" onClick={() => setOpen(true)} role="button" tabIndex={0}
           onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); } }}>
        {value.map(code => {
          const b = byCode.get(code);
          if (!b) return null; // unknown/stale code — ignore gracefully
          return (
            <span key={code} className="bms-chip">
              {b.icon && <span className="bms-chip__ico">{b.icon}</span>}
              {b.name}
              <button
                type="button"
                className="bms-chip__x"
                onClick={e => { e.stopPropagation(); removeBadge(code); }}
                aria-label={`Remove ${b.name}`}
              >×</button>
            </span>
          );
        })}
        {!value.length && <span className="bms-placeholder">{placeholder}</span>}
      </div>

      {open && createPortal(
        <div className="bms-overlay" onClick={close}>
          <div className="bms-modal" onClick={e => e.stopPropagation()}>
            <div className="bms-modal__head">
              <span className="bms-modal__title">Select Badges</span>
              <button type="button" className="bms-modal__close" onClick={close} aria-label="Close">×</button>
            </div>
            <input
              ref={searchRef}
              className="bms-modal__search"
              value={q}
              placeholder="Search badges…"
              onChange={e => setQ(e.target.value)}
            />
            <div className="bms-modal__grid">
              {filtered.map(o => {
                const sel = value.includes(o.code);
                return (
                  <button
                    type="button"
                    key={o.code}
                    className={`bms-opt${sel ? ' bms-opt--sel' : ''}`}
                    onClick={() => toggleBadge(o.code)}
                  >
                    {o.icon && <span className="bms-opt__ico">{o.icon}</span>}
                    <span className="bms-opt__name">{o.name}</span>
                    {sel && <span className="bms-opt__check">✓</span>}
                  </button>
                );
              })}
              {!filtered.length && <div className="bms-opt--empty">No matching badges</div>}
            </div>
            <div className="bms-modal__foot">
              <button type="button" className="bms-modal__done" onClick={close}>Done</button>
            </div>
          </div>
        </div>,
        document.querySelector('.desktop-root') || document.body
      )}
    </div>
  );
}
