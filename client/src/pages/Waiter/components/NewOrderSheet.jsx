import { useState, useEffect, useRef } from 'react';
import Icon from './Icon';
import { tapLight, tapMedium } from '../lib/haptics';
import { getNepalDateStr, nepalDateTimeAfterMinutes } from '../../../utils/dateTime';

const NOTIFY_PRESETS = [15, 30, 45, 60];

/* Mirrors the four non-table buttons on the POS dashboard toolbar
   (POSDashboard.jsx TOOLBAR_BTN_DEFS: takeaway/delivery/draft/schedule) so a
   waiter who has used the terminal recognises the same four choices, and a
   converted draft/scheduled row lands in the same order_type the till
   would have given it. */
const ORDER_TYPES = [
  { menuType: 'TAKEAWAY',  orderType: 'TAKEAWAY', kind: null,        icon: 'pack',     label: 'Take away',      hint: 'Punches straight to the kitchen' },
  { menuType: 'DELIVERY',  orderType: 'DELIVERY', kind: null,        icon: 'moped',    label: 'Delivery',       hint: 'Punches straight to the kitchen' },
  { menuType: 'DRAFT',     orderType: 'TAKEAWAY', kind: 'DRAFT',     icon: 'edit',     label: 'Draft order',    hint: 'Saved for the till to process later' },
  { menuType: 'SCHEDULED', orderType: 'DELIVERY', kind: 'SCHEDULED', icon: 'schedule', label: 'Scheduled order', hint: 'Auto-fires to the kitchen at a set time' },
];

const PHONE_RE = /^\+?[1-9]\d{6,14}$/;
const DEBOUNCE_MS = 400;

/* Name + phone with a debounced customer search dropdown — same
   /crm/customers/search endpoint the POS CustomerPicker uses, restyled
   as plain M3 text fields instead of importing POS's modal chrome. */
function CustomerFields({ api, name, phone, onName, onPhone, autoFocus }) {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    const q = (phone || name).trim();
    if (q.length < 3) { setRows([]); return; }
    timer.current = setTimeout(() => {
      api.get('/crm/customers/search', { params: { q, limit: 5 } })
        .then(r => setRows(Array.isArray(r.data?.rows) ? r.data.rows : []))
        .catch(() => setRows([]));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer.current);
  }, [api, name, phone]);

  const pick = (c) => {
    tapLight();
    onName(c.name || ''); onPhone(c.phone || '');
    setRows([]); setOpen(false);
  };

  return (
    <div className="w-cust-fields">
      <div className="w-field">
        <span className="w-field-label">Customer name</span>
        <input
          className="w-field-input" type="text" autoFocus={autoFocus}
          placeholder="Optional"
          value={name}
          onChange={e => onName(e.target.value)}
          onFocus={() => setOpen(true)}
        />
      </div>
      <div className="w-field">
        <span className="w-field-label">Phone</span>
        <input
          className="w-field-input" type="tel" inputMode="tel"
          placeholder="Optional"
          value={phone}
          onChange={e => onPhone(e.target.value.replace(/(?!^\+)[^\d]/g, ''))}
          onFocus={() => setOpen(true)}
        />
      </div>
      {open && rows.length > 0 && (
        <div className="w-cust-suggest">
          {rows.map(c => (
            <button key={c.phone} type="button" className="w-cust-suggest-row w-ripple" onClick={() => pick(c)}>
              <span className="w-cust-suggest-ava">{(c.name || '?').charAt(0).toUpperCase()}</span>
              <span className="w-cust-suggest-info">
                <span className="w-cust-suggest-name">{c.name}</span>
                <span className="w-cust-suggest-sub">{c.phone}{c.address ? ` · ${c.address}` : ''}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Two-step "New order" sheet: pick a type (mirrors the POS toolbar), then
 * capture whatever that type needs before handing off to the same
 * categories → items → review flow a table uses.
 *
 * onConfirm receives a fully-resolved order-mode object:
 *   { menuType, orderType, kind, label, customerName, customerPhone,
 *     scheduledFor, notifyBeforeMin }
 * kind is null for immediate Takeaway/Delivery, 'DRAFT' or 'SCHEDULED'
 * otherwise — WaiterApp branches its Send action on that field alone.
 */
export default function NewOrderSheet({ api, onConfirm, onClose }) {
  const [step, setStep] = useState('type'); // 'type' | 'details'
  const [picked, setPicked] = useState(null);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [date, setDate] = useState(getNepalDateStr());
  const [time, setTime] = useState('');
  const [notifyBefore, setNotifyBefore] = useState(30);
  const [hours, setHours] = useState(null);
  const [error, setError] = useState('');

  const isScheduled = picked?.kind === 'SCHEDULED';

  useEffect(() => {
    if (!isScheduled) return;
    api.get('/pos/scheduled/hours', { params: { date } })
      .then(r => setHours(r.data)).catch(() => setHours(null));
  }, [api, isScheduled, date]);

  const pickType = (t) => { tapMedium(); setPicked(t); setStep('details'); setError(''); };

  const setNotifyAndTime = (m) => {
    setNotifyBefore(m);
    const { date: d, time: t } = nepalDateTimeAfterMinutes(m);
    setDate(d); setTime(t); setError('');
  };

  const timeValid = () => {
    if (!time || !hours) return true;
    if (!hours.is_open) return false;
    return time >= hours.open_time && time <= hours.close_time;
  };

  const confirm = () => {
    if (isScheduled) {
      if (!customerName.trim() && !customerPhone.trim()) { setError('Add a name or phone for a scheduled order'); return; }
      if (!date || !time) { setError('Pick a date and time'); return; }
      if (hours && !hours.is_open) { setError('Store is closed that day'); return; }
      if (!timeValid()) { setError(`Time must be between ${hours.open_time} and ${hours.close_time}`); return; }
    }
    tapMedium();
    onConfirm({
      menuType: picked.menuType,
      orderType: picked.orderType,
      kind: picked.kind,
      label: picked.label,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      scheduledFor: isScheduled ? `${date} ${time}:00` : null,
      notifyBeforeMin: isScheduled ? notifyBefore : null,
    });
  };

  return (
    <div className="w-sheet-wrap" onClick={onClose}>
      <div className="w-sheet w-neworder-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label="New order">
        <div className="w-sheet-grab" />

        {step === 'type' ? (
          <>
            <div className="w-set-head">
              <span className="w-sheet-title">New order</span>
              <button className="w-icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
            </div>
            <div className="w-ordertype-list">
              {ORDER_TYPES.map(t => (
                <button key={t.menuType} className="w-ordertype-row w-ripple" onClick={() => pickType(t)}>
                  <span className={`w-ordertype-icon w-ordertype-icon--${t.menuType.toLowerCase()}`}>
                    <Icon name={t.icon} size={22} />
                  </span>
                  <span className="w-ordertype-info">
                    <span className="w-ordertype-label">{t.label}</span>
                    <span className="w-ordertype-hint">{t.hint}</span>
                  </span>
                  <Icon name="chevron" size={20} className="w-ordertype-chev" />
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="w-set-head">
              <button className="w-icon-btn" onClick={() => setStep('type')} aria-label="Back"><Icon name="back" /></button>
              <span className="w-sheet-title">{picked.label}</span>
              <button className="w-icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
            </div>

            <CustomerFields
              api={api}
              name={customerName} phone={customerPhone}
              onName={setCustomerName} onPhone={setCustomerPhone}
              autoFocus
            />

            {isScheduled && (
              <>
                <div className="w-cust-fields" style={{ marginTop: 4 }}>
                  <div className="w-field">
                    <span className="w-field-label">Date</span>
                    <input className="w-field-input" type="date" value={date} min={getNepalDateStr()}
                      onChange={e => { setDate(e.target.value); setError(''); }} />
                  </div>
                  <div className="w-field">
                    <span className="w-field-label">Time</span>
                    <input className="w-field-input" type="time" value={time}
                      onChange={e => { setTime(e.target.value); setError(''); }}
                      style={time && !timeValid() ? { borderColor: 'var(--error)' } : undefined} />
                  </div>
                </div>
                {hours && (
                  <div className={`w-hours-note${hours.is_open ? '' : ' is-closed'}`}>
                    {hours.is_open ? `Store open ${hours.open_time}–${hours.close_time}` : '⚠ Store closed that day'}
                  </div>
                )}
                <span className="w-field-label">KOT fires before</span>
                <div className="w-notify-row">
                  {NOTIFY_PRESETS.map(m => (
                    <button key={m} className={`w-notify-chip${notifyBefore === m ? ' is-active' : ''}`} onClick={() => setNotifyAndTime(m)}>
                      {m}m
                    </button>
                  ))}
                </div>
              </>
            )}

            {error && <div className="w-form-error">{error}</div>}

            <button className="w-btn" onClick={confirm}>
              <Icon name="forward" size={20} />Start order
            </button>
          </>
        )}
      </div>
    </div>
  );
}
