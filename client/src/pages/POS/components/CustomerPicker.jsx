import { useState, useEffect, useRef } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const AVATAR_COLORS = ['#c1440e', '#1d4ed8', '#2d7a2d', '#7c3aed', '#a16207', '#0369a1'];

/**
 * Reusable inline customer search + pick + quick-add.
 * Search on phone / name / address, shows up to `limit` rows,
 * "＋ New Customer" row on top expands to phone+name quick-add.
 *
 * <CustomerPicker onSelect={(c) => ...} />   c: { phone, name, address, ... }
 */
export default function CustomerPicker({ onSelect, limit = 8, autoFocus = true }) {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [adding, setAdding] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      fetch(`${API_BASE}/crm/customers?search=${encodeURIComponent(search.trim())}`)
        .then(r => r.json())
        .then(list => setRows(Array.isArray(list) ? list.slice(0, limit) : []))
        .catch(() => setRows([]));
    }, 250);
    return () => clearTimeout(timer.current);
  }, [search, limit]);

  async function handleSaveNew() {
    const phone = newPhone.trim();
    const name = newName.trim();
    if (!phone || !name) { setError('Phone and name required'); return; }
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

  if (adding) {
    return (
      <div className="cust-picker">
        <div className="cust-picker__add">
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="modal__input cust-picker__phone"
              autoFocus type="tel" placeholder="Phone number — 10 digits"
              value={newPhone}
              onChange={e => { setNewPhone(e.target.value); setError(''); }}
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
        placeholder="🔍 Search by name, phone or address…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <div className="cust-picker__list">
        <button className="cust-picker__row cust-picker__row--new" onClick={() => setAdding(true)}>
          <span className="cust-picker__avatar cust-picker__avatar--new">＋</span>
          <span className="cust-picker__info">
            <span className="cust-picker__name">New Customer</span>
            <span className="cust-picker__sub">Click to add phone &amp; name</span>
          </span>
          <span className="cust-picker__arrow">→</span>
        </button>

        {rows.map((c, i) => (
          <button key={c.phone} className="cust-picker__row" onClick={() => onSelect(c)}>
            <span className="cust-picker__avatar" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
              {(c.name || '?').charAt(0).toUpperCase()}
            </span>
            <span className="cust-picker__info">
              <span className="cust-picker__name">{c.name}</span>
              <span className="cust-picker__sub">
                {c.phone}{c.address ? ` · ${c.address}` : ''}
              </span>
            </span>
            <span className="cust-picker__arrow">→</span>
          </button>
        ))}

        {rows.length === 0 && search.trim() && (
          <div className="cust-picker__empty">No customers match “{search.trim()}”</div>
        )}
      </div>
    </div>
  );
}
