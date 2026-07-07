import { useState, useRef, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL || '/api';
const H   = { 'Content-Type': 'application/json', 'X-Session-ID': 'dev-session' };

/**
 * IntelliSense tag input — select from DB options or create new.
 *
 * Props:
 *   tagType     'cream' | 'sponge' | 'shape' | 'theme'
 *   options     string[]  — pre-loaded option list
 *   value       string[]  — selected tags
 *   onChange    (string[]) => void
 *   label       string
 *   placeholder string
 *   accent      string    — hex color for chip bg
 */
export default function TagInput({
  tagType, options = [], value = [], onChange,
  label, placeholder = 'Type and press Enter…', accent = '#c1440e',
}) {
  const [input,    setInput]    = useState('');
  const [dropdown, setDropdown] = useState(false);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef(null);
  const boxRef   = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function h(e) { if (!boxRef.current?.contains(e.target)) setDropdown(false); }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const trimmed = input.trim();
  const filtered = options.filter(
    o => o.toLowerCase().includes(trimmed.toLowerCase()) && !value.includes(o)
  );
  const canCreate = trimmed.length > 1 && !options.some(o => o.toLowerCase() === trimmed.toLowerCase()) && !value.includes(trimmed);

  function addTag(tag) {
    const t = tag.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setInput('');
    setDropdown(false);
    inputRef.current?.focus();
  }

  function removeTag(tag) { onChange(value.filter(v => v !== tag)); }

  async function createAndAdd() {
    if (!trimmed || !tagType || creating) return;
    setCreating(true);
    try {
      const r = await fetch(`${API}/pos/cake-orders/tags/${tagType}`, {
        method: 'POST', headers: H, body: JSON.stringify({ name: trimmed }),
      });
      if (r.ok || r.status === 409) {
        // 409 = already exists — just add to selection
        addTag(trimmed);
      }
    } finally { setCreating(false); }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (filtered[0]) { addTag(filtered[0]); return; }
      if (trimmed) { tagType ? createAndAdd() : addTag(trimmed); }
    }
    if (e.key === 'Backspace' && !input && value.length) {
      removeTag(value[value.length - 1]);
    }
    if (e.key === 'Escape') { setDropdown(false); setInput(''); }
  }

  const accentLight = accent + '22';

  return (
    <div style={{ marginBottom: 14 }}>
      {label && (
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9c8870', marginBottom: 6 }}>
          {label}
        </div>
      )}

      <div
        ref={boxRef}
        style={{
          position: 'relative',
          background: 'rgba(255,255,255,0.7)',
          border: `1.5px solid ${dropdown ? accent : '#c4b49c'}`,
          borderRadius: 9,
          padding: '6px 8px',
          display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center',
          minHeight: 40,
          cursor: 'text',
          transition: 'border-color 0.15s',
        }}
        onClick={() => inputRef.current?.focus()}
      >
        {/* Selected chips */}
        {value.map(tag => (
          <span key={tag} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: accentLight, border: `1px solid ${accent}55`,
            color: accent, borderRadius: 20,
            padding: '2px 8px 2px 10px', fontSize: 12, fontWeight: 700,
          }}>
            {tag}
            <button
              onClick={e => { e.stopPropagation(); removeTag(tag); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: accent, fontSize: 14, lineHeight: 1, padding: 0, display: 'flex', alignItems: 'center' }}
            >×</button>
          </span>
        ))}

        {/* Text input */}
        <input
          ref={inputRef}
          value={input}
          onChange={e => { setInput(e.target.value); setDropdown(true); }}
          onFocus={() => setDropdown(true)}
          onKeyDown={onKeyDown}
          placeholder={value.length ? '' : placeholder}
          style={{
            flex: 1, minWidth: 80, border: 'none', background: 'transparent',
            outline: 'none', fontSize: 13, color: '#2a1f12',
            padding: '2px 2px',
          }}
        />

        {/* Dropdown */}
        {dropdown && (filtered.length > 0 || canCreate) && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 500,
            background: '#fdf9f4', border: '1px solid #a89880', borderRadius: 9,
            boxShadow: '0 8px 24px rgba(42,31,18,0.22)', overflow: 'hidden',
            maxHeight: 200, overflowY: 'auto',
          }}>
            {filtered.map(opt => (
              <button key={opt}
                onMouseDown={e => { e.preventDefault(); addTag(opt); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '8px 12px', border: 'none', background: 'transparent',
                  fontSize: 13, fontWeight: 600, color: '#2a1f12', cursor: 'pointer',
                  borderBottom: '1px solid rgba(160,144,128,0.15)',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = accentLight}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                {opt}
              </button>
            ))}
            {canCreate && (
              <button
                onMouseDown={e => { e.preventDefault(); tagType ? createAndAdd() : addTag(trimmed); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '8px 12px', border: 'none',
                  background: accentLight,
                  fontSize: 12, fontWeight: 700, color: accent, cursor: 'pointer',
                }}
              >
                {creating ? 'Creating…' : `+ Create "${trimmed}"`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
