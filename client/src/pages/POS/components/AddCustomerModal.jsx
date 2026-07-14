import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export default function AddCustomerModal({ initialPhone = '', initialName = '', initialNotes = '', onClose, onSaved }) {
  const [phone,     setPhone]     = useState(initialPhone);
  const [name,      setName]      = useState(initialName);
  const [notes,     setNotes]     = useState(initialNotes);
  const [crmStatus, setCrmStatus] = useState(''); // '' | 'found' | 'not_found'
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const lookupTimer = useRef(null);
  const crmFound    = useRef(!!initialPhone);

  function onPhoneChange(val) {
    setPhone(val);
    setCrmStatus('');
    setError('');
    crmFound.current = false;
    clearTimeout(lookupTimer.current);
    if (val.trim().length < 7) return;
    lookupTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`${API_BASE}/crm/customers/${encodeURIComponent(val.trim())}`);
        if (r.ok) {
          const data = await r.json();
          if (data?.name) {
            crmFound.current = true;
            setCrmStatus('found');
            setName(data.name);
            setNotes(data.notes || '');
            return;
          }
        }
        setCrmStatus('not_found');
      } catch {
        setCrmStatus('not_found');
      }
    }, 400);
  }

  async function handleSave() {
    const trimPhone = phone.trim();
    const trimName  = name.trim();
    if (!trimPhone || !trimName) { setError('Phone and name are required'); return; }

    setSaving(true);
    setError('');
    try {
      const url = crmFound.current ? `${API_BASE}/crm/customers/${encodeURIComponent(trimPhone)}` : `${API_BASE}/crm/customers`;
      const r = await fetch(url, {
        method: crmFound.current ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: trimPhone, name: trimName, notes: notes.trim() || null }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || 'Save failed');
      }
      onSaved?.({ phone: trimPhone, name: trimName, notes: notes.trim() });
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') handleSave();
    if (e.key === 'Escape') onClose();
  }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="modal__title">{initialPhone ? 'Edit Customer' : 'Add Customer'}</div>

        <span className="modal__label">Phone</span>
        <input
          className="modal__input"
          style={{ marginBottom: 6, fontSize: 22, fontWeight: 800, padding: '12px 10px', letterSpacing: '0.03em' }}
          placeholder="Mobile number"
          type="tel"
          value={phone}
          onChange={e => onPhoneChange(e.target.value)}
          autoFocus
        />
        {crmStatus === 'found' && (
          <div style={{ fontSize: 12, color: '#059669', marginBottom: 6, padding: '4px 8px', background: '#ecfdf5', borderRadius: 6 }}>
            ✓ Existing customer — editing record
          </div>
        )}

        <span className="modal__label">Name</span>
        <input
          className="modal__input"
          style={{ marginBottom: 6 }}
          placeholder="Customer name"
          value={name}
          onChange={e => setName(e.target.value)}
        />

        <span className="modal__label">
          Notes <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(optional)</span>
        </span>
        <textarea
          className="modal__input"
          rows={3}
          placeholder="Preferences, allergies, remarks…"
          value={notes}
          onChange={e => setNotes(e.target.value)}
        />

        {error && (
          <div style={{ fontSize: 12, color: '#c0392b', marginTop: 6 }}>{error}</div>
        )}

        <div className="modal__actions" style={{ marginTop: 8 }}>
          <button className="modal__btn modal__btn--cancel" onClick={onClose}>Cancel</button>
          <button className="modal__btn modal__btn--confirm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Customer'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
