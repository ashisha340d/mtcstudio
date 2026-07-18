import { useState, useEffect, useRef, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const AVATAR_COLORS = ['#c1440e', '#1d4ed8', '#2d7a2d', '#7c3aed', '#a16207', '#0369a1'];
const PHONE_RE = /^\+?[1-9]\d{6,14}$/; // generic E.164-ish, any country
const DEBOUNCE_MS = 500;

function toProperCase(str) {
  return str.trim().toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase());
}

// Bold the substrings of `text` matching any typed token — split() with a
// capturing group interleaves the matches into the result at odd indices.
function highlight(text, tokens) {
  const str = String(text ?? '');
  if (!str || !tokens.length) return str;
  const pattern = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  if (!pattern) return str;
  const parts = str.split(new RegExp(`(${pattern})`, 'gi'));
  if (parts.length <= 1) return str;
  return parts.map((part, i) => (i % 2 === 1 ? <mark key={i} className="cust-picker__hl">{part}</mark> : part));
}

/**
 * Reusable inline customer search + pick + quick-add.
 * Ranked search (phone/email auto-detect, fuzzy name/address match server-side)
 * via GET /crm/customers/search, shows up to `limit` rows, keyboard nav
 * (↑/↓/Enter/Esc), auto-selects a lone high-confidence hit.
 * "＋ New Customer" row on top expands to phone+name quick-add.
 *
 * <CustomerPicker onSelect={(c) => ...} />   c: { phone, name, address, ... }
 */
export default function CustomerPicker({ onSelect, limit = 20, autoFocus = true }) {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1); // 0 = "New Customer" row, 1..n = results
  const [adding, setAdding] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef(null);
  const highConfidenceRef = useRef(250);

  const tokens = search.trim() ? search.trim().split(/\s+/) : [];

  const runSearch = useCallback((q) => {
    const trimmed = q.trim();
    if (!trimmed) { setRows([]); return Promise.resolve([]); }
    setLoading(true);
    return fetch(`${API_BASE}/crm/customers/search?q=${encodeURIComponent(trimmed)}&limit=${limit}`)
      .then(r => r.json())
      .then(data => {
        if (data?.highConfidence != null) highConfidenceRef.current = data.highConfidence;
        const list = Array.isArray(data?.rows) ? data.rows : [];
        setActiveIndex(-1);
        setRows(list);
        return list;
      })
      .catch(() => { setRows([]); return []; })
      .finally(() => setLoading(false));
  }, [limit]);

  // Live search — debounced, skips a request while the box is empty
  useEffect(() => {
    clearTimeout(timer.current);
    if (!search.trim()) { setRows([]); return; }
    timer.current = setTimeout(() => runSearch(search), DEBOUNCE_MS);
    return () => clearTimeout(timer.current);
  }, [search, runSearch]);

  // A single high-confidence hit (own exact-phrase/word match, or exact phone/email)
  // is picked automatically the moment its result set lands — covers both the
  // debounced arrival and the Enter-triggered final search below.
  useEffect(() => {
    if (rows.length === 1 && rows[0].score >= highConfidenceRef.current) onSelect(rows[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  async function handleSaveNew() {
    const phone = newPhone.trim();
    const name = newName.trim();
    if (!phone || !name) { setError('Phone and name required'); return; }
    if (!PHONE_RE.test(phone)) { setError('Invalid phone number'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/crm/customers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, name }),
      });
      if (res.status === 409) {
        // Phone already in CRM — just pick the existing record
        const existing = await fetch(`${API_BASE}/crm/customers/${encodeURIComponent(phone)}`).then(r => r.json());
        onSelect(existing);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Save failed');
        return;
      }
      onSelect({ phone, name });
    } catch {
      setError('Save failed');
    } finally {
      setSaving(false);
    }
  }

  function selectRow(index) {
    if (index === 0) { setAdding(true); return; }
    const c = rows[index - 1];
    if (c) onSelect(c);
  }

  function handleSearchKeyDown(e) {
    const total = rows.length + 1; // +1 for the "New Customer" row
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => (i + 1) % total);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => (i - 1 + total) % total);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0) { selectRow(activeIndex); return; }
      clearTimeout(timer.current); // final search — don't wait out the debounce
      runSearch(search);
    } else if (e.key === 'Escape') {
      setSearch(''); setRows([]); setActiveIndex(-1);
    }
  }

  if (adding) {
    return (
      <div className="cust-picker">
        <div className="cust-picker__add">
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="modal__input cust-picker__phone"
              autoFocus type="tel" placeholder="Phone number — 10 digits"
              value={newPhone}
              onChange={e => { setNewPhone(e.target.value.replace(/(?!^\+)[^\d]/g, '')); setError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') handleSaveNew(); }}
            />
            <button className="modal__btn modal__btn--cancel" style={{ flex: '0 0 auto', marginBottom: 10 }}
              onClick={() => { setAdding(false); setError(''); }}>
              ✕ Cancel
            </button>
          </div>
          <input
            className="modal__input"
            placeholder="Customer full name"
            value={newName}
            onChange={e => { setNewName(e.target.value); setError(''); }}
            onBlur={e => setNewName(toProperCase(e.target.value))}
            onKeyDown={e => { if (e.key === 'Enter') handleSaveNew(); }}
          />
          {error && <div className="cust-picker__error">{error}</div>}
          <button className="modal__btn modal__btn--confirm cust-picker__proceed"
            disabled={saving} onClick={handleSaveNew}>
            {saving ? 'Saving…' : '→ Proceed — Save Customer'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="cust-picker">
      <input
        className="modal__input"
        autoFocus={autoFocus}
        placeholder="🔍 Search by name, phone or email…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        onKeyDown={handleSearchKeyDown}
      />
      <div className="cust-picker__list">
        <button
          type="button"
          className={`cust-picker__row cust-picker__row--new${activeIndex === 0 ? ' cust-picker__row--active' : ''}`}
          onClick={() => selectRow(0)}
        >
          <span className="cust-picker__avatar cust-picker__avatar--new">＋</span>
          <span className="cust-picker__info">
            <span className="cust-picker__name">New Customer</span>
            <span className="cust-picker__sub">Click to add phone &amp; name</span>
          </span>
          <span className="cust-picker__arrow">→</span>
        </button>

        {rows.map((c, i) => (
          <button
            key={c.phone}
            type="button"
            className={`cust-picker__row${activeIndex === i + 1 ? ' cust-picker__row--active' : ''}`}
            onClick={() => selectRow(i + 1)}
          >
            <span className="cust-picker__avatar" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
              {(c.name || '?').charAt(0).toUpperCase()}
            </span>
            <span className="cust-picker__info">
              <span className="cust-picker__name">{highlight(c.name, tokens)}</span>
              <span className="cust-picker__sub">
                {highlight(c.phone, tokens)}{c.address ? <> · {highlight(c.address, tokens)}</> : ''}
              </span>
            </span>
            <span className="cust-picker__arrow">→</span>
          </button>
        ))}

        {loading && <div className="cust-picker__empty">Searching…</div>}
        {!loading && rows.length === 0 && search.trim() && (
          <div className="cust-picker__empty">No customers match “{search.trim()}”</div>
        )}
      </div>
    </div>
  );
}
