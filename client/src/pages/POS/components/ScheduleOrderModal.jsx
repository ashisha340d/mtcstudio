import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getStoreHours } from '../../../services/posApi';
import { getNepalDateStr, nepalDateTimeAfterMinutes } from '../../../utils/dateTime';
import CustomerPicker from './CustomerPicker';

const NOTIFY_PRESETS = [15, 30, 45, 60];

export default function ScheduleOrderModal({ onProceed, onClose }) {
  const [customer, setCustomer] = useState(null); // { phone, name, address? }
  const [date, setDate]   = useState(getNepalDateStr());
  const [time, setTime]   = useState('');
  const [notifyBefore, setNotifyBefore] = useState(30);
  const [notes, setNotes] = useState('');
  const [hours, setHours] = useState(null); // { is_open, open_time, close_time }
  const [error, setError] = useState('');

  useEffect(() => {
    getStoreHours(date).then(setHours).catch(() => setHours(null));
  }, [date]);

  function setNotifyAndTime(m) {
    setNotifyBefore(m);
    const { date: d, time: t } = nepalDateTimeAfterMinutes(m);
    setDate(d);
    setTime(t);
    setError('');
  }

  function timeValid() {
    if (!time || !hours) return true;
    if (!hours.is_open) return false;
    return time >= hours.open_time && time <= hours.close_time;
  }

  function handleProceed() {
    if (!customer) { setError('Pick or add a customer first'); return; }
    if (!date || !time) { setError('Date and time are required'); return; }
    if (hours && !hours.is_open) { setError('Store is closed on that day'); return; }
    if (!timeValid()) { setError(`Time must be between ${hours.open_time} and ${hours.close_time}`); return; }
    onProceed({
      customerName: customer.name,
      customerPhone: customer.phone,
      scheduledFor: `${date} ${time}:00`,
      notifyBeforeMin: notifyBefore,
      orderNotes: notes.trim() || null,
    });
  }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
        <div className="modal__title">⏰ Schedule Order</div>

        <span className="modal__label">Customer *</span>
        {customer ? (
          <div className="cust-picker__row" style={{ border: '1px solid var(--border, #c4b49c)', borderRadius: 10, marginBottom: 10, cursor: 'default' }}>
            <span className="cust-picker__avatar" style={{ background: 'var(--orange, #c1440e)' }}>
              {(customer.name || '?').charAt(0).toUpperCase()}
            </span>
            <span className="cust-picker__info">
              <span className="cust-picker__name">{customer.name}</span>
              <span className="cust-picker__sub">{customer.phone}{customer.address ? ` · ${customer.address}` : ''}</span>
            </span>
            <button className="modal__btn modal__btn--cancel" style={{ flex: '0 0 auto', padding: '6px 12px' }}
              onClick={() => setCustomer(null)}>
              ✎ Change
            </button>
          </div>
        ) : (
          <CustomerPicker onSelect={(c) => { setCustomer(c); setError(''); }} />
        )}

        {customer && (
          <>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <span className="modal__label">Date *</span>
                <input
                  className="modal__input" type="date" value={date}
                  min={getNepalDateStr()}
                  onChange={e => { setDate(e.target.value); setError(''); }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <span className="modal__label">Time *</span>
                <input
                  className="modal__input" type="time" value={time}
                  onChange={e => { setTime(e.target.value); setError(''); }}
                  style={{ borderColor: time && !timeValid() ? 'var(--red, #c0392b)' : undefined }}
                />
              </div>
            </div>
            {hours && (
              <div style={{ fontSize: 11, color: hours.is_open ? 'var(--text-3, #999)' : 'var(--red, #c0392b)', marginTop: -4, marginBottom: 8 }}>
                {hours.is_open ? `Open ${hours.open_time} – ${hours.close_time}` : '⚠ Store closed that day'}
              </div>
            )}

            <span className="modal__label">Notify KOT Before</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
              {NOTIFY_PRESETS.map(m => (
                <button key={m}
                  className={`partner-pill${notifyBefore === m ? ' partner-pill--active' : ''}`}
                  style={{ padding: '10px 18px', fontSize: 14 }}
                  onClick={() => setNotifyAndTime(m)}
                >
                  {m} min
                </button>
              ))}
              <input
                type="number" min="0" max="720" value={notifyBefore}
                onChange={e => setNotifyAndTime(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="modal__input"
                style={{ width: 70, marginBottom: 0, textAlign: 'center', fontWeight: 700 }}
              />
            </div>

            <span className="modal__label">
              Notes <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(optional)</span>
            </span>
            <textarea
              className="modal__input" rows={2} placeholder="Order notes…"
              value={notes} onChange={e => setNotes(e.target.value)}
            />
          </>
        )}

        {error && <div style={{ color: 'var(--red, #c0392b)', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{error}</div>}

        <div className="modal__actions" style={{ marginTop: 8 }}>
          <button className="modal__btn modal__btn--cancel" onClick={onClose}>Cancel</button>
          <button className="modal__btn modal__btn--confirm" onClick={handleProceed} disabled={!customer}>
            Proceed →
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
