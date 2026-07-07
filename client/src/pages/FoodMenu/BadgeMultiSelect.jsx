import { useState, useRef, useEffect, useMemo } from 'react';
import './BadgeMultiSelect.css';

/**
 * Searchable multi-select tag input for Product Badges.
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
export default function BadgeMultiSelect({ options = [], value = [], onChange, placeholder = 'Type to search…' }) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function onDocMouseDown(e) {
      if (!boxRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const byCode = useMemo(() => {
    const m = new Map();
    options.forEach(o => m.set(o.code, o));
    return m;
  }, [options]);

  const q = input.trim().toLowerCase();
  const filtered = useMemo(() => options.filter(o =>
    !value.includes(o.code) &&
    (o.name.toLowerCase().includes(q) || o.code.toLowerCase().includes(q))
  ), [options, value, q]);

  // Keep the highlighted row in range whenever the filtered list changes
  useEffect(() => { setHighlight(0); }, [q, open]);

  function addBadge(code) {
    if (!code || value.includes(code)) return; // prevent duplicates
    onChange([...value, code]);
    setInput('');
    setHighlight(0);
    inputRef.current?.focus();
  }

  function removeBadge(code) { onChange(value.filter(c => c !== code)); }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight(h => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && filtered[highlight]) addBadge(filtered[highlight].code);
    } else if (e.key === 'Backspace' && !input && value.length) {
      removeBadge(value[value.length - 1]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setInput('');
    }
  }

  return (
    <div className="bms-wrap" ref={boxRef}>
      <div className={`bms-box${open ? ' bms-box--open' : ''}`} onClick={() => inputRef.current?.focus()}>
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
                onMouseDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); removeBadge(code); }}
                aria-label={`Remove ${b.name}`}
              >×</button>
            </span>
          );
        })}

        <input
          ref={inputRef}
          className="bms-input"
          value={input}
          placeholder={value.length ? '' : placeholder}
          onChange={e => { setInput(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </div>

      {open && filtered.length > 0 && (
        <div className="bms-dropdown">
          {filtered.map((o, i) => (
            <button
              type="button"
              key={o.code}
              className={`bms-option${i === highlight ? ' bms-option--hl' : ''}`}
              onMouseDown={e => e.preventDefault()}
              onClick={() => addBadge(o.code)}
              onMouseEnter={() => setHighlight(i)}
            >
              {o.icon && <span className="bms-option__ico">{o.icon}</span>}
              {o.name}
            </button>
          ))}
        </div>
      )}

      {open && q && filtered.length === 0 && (
        <div className="bms-dropdown">
          <div className="bms-option bms-option--empty">No matching badges</div>
        </div>
      )}
    </div>
  );
}
