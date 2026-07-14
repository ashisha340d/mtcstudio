import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export default function OrderTypeModal({
  initialPhone = '', initialName = '', initialNotes = '',
  confirmLabel = 'Open Order', title = '🚴 Delivery Partner',
  onConfirm, onClose,
}) {
  const [partners, setPartners] = useState([]);
  const [phone,    setPhone]    = useState(initialPhone);
  const [name,     setName]     = useState(initialName);
  const [notes,    setNotes]    = useState(initialNotes);

  useEffect(() => {
    fetch(`${API_BASE}/crm/delivery-partners`)
      .then(r => r.json()).then(setPartners).catch(() => {});
  }, []);

  function selectPartner(p) {
    setPhone(p.phone);
    setName(p.name);
  }

  function handleConfirm() {
    if (!phone) return;
    onConfirm({
      customerName:  name || null,
      customerPhone: phone || null,
      orderNotes:    notes.trim() || null,
    });
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') handleConfirm();
    if (e.key === 'Escape') onClose();
  }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="modal__title">{title}</div>

        <span className="modal__label">Select Partner</span>
        {partners.length > 0 ? (
          <div className="partner-pill-grid">
            {partners.map(p => (
              <button
                key={p.phone}
                className={`partner-pill${phone === p.phone ? ' partner-pill--active' : ''}`}
                onClick={() => selectPartner(p)}
              >
                {p.name}
              </button>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#999', marginBottom: 10, padding: '6px 8px', background: '#f9f9f9', borderRadius: 6 }}>
            No delivery partners in CRM. Enable "Delivery Partner" on a customer record first.
          </div>
        )}

        <span className="modal__label">
          Notes <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(optional)</span>
        </span>
        <textarea
          className="modal__input"
          rows={3}
          placeholder="Order notes…"
          value={notes}
          onChange={e => setNotes(e.target.value)}
        />

        <div className="modal__actions" style={{ marginTop: 8 }}>
          <button className="modal__btn modal__btn--cancel" onClick={onClose}>Cancel</button>
          <button className="modal__btn modal__btn--confirm" onClick={handleConfirm} disabled={!phone}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
