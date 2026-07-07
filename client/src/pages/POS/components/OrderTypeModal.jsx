import { useState, useRef, useEffect } from 'react';
import { ORDER_TYPE } from '../../../context/POSContext';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const TYPES = [
  { key: ORDER_TYPE.TAKEAWAY,   label: 'Takeaway',   icon: '🛍' },
  { key: ORDER_TYPE.DELIVERY,   label: 'Delivery',   icon: '🛵' },
  { key: ORDER_TYPE.CAKE_ORDER, label: 'Cake Order', icon: '🎂' },
  { key: ORDER_TYPE.QUICK_SALE, label: 'Quick Sale', icon: '⚡' },
];

export default function OrderTypeModal({ initialType, onConfirm, onClose }) {
  const [type,      setType]      = useState(initialType || ORDER_TYPE.TAKEAWAY);
  const [name,      setName]      = useState('');
  const [phone,     setPhone]     = useState('');
  const [address,   setAddress]   = useState('');
  const [crmStatus, setCrmStatus] = useState(''); // '' | 'found' | 'not_found'
  const [partners,  setPartners]  = useState([]);
  const lookupTimer = useRef(null);
  const crmFound    = useRef(false); // tracks if phone matched existing CRM record

  function resetFields() {
    setName(''); setPhone(''); setAddress(''); setCrmStatus('');
    crmFound.current = false;
    clearTimeout(lookupTimer.current);
  }

  // Load delivery partners when type = DELIVERY
  useEffect(() => {
    if (type !== ORDER_TYPE.DELIVERY) return;
    fetch(`${API_BASE}/crm/delivery-partners`)
      .then(r => r.json()).then(setPartners).catch(() => {});
  }, [type]);

  // CRM phone lookup — debounced, 400 ms
  function onPhoneChange(val) {
    setPhone(val);
    setCrmStatus('');
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
            return;
          }
        }
        setCrmStatus('not_found');
      } catch {
        setCrmStatus('not_found');
      }
    }, 400);
  }

  async function handleConfirm() {
    const trimName  = name.trim();
    const trimPhone = phone.trim();

    // Auto-create CRM customer: only when both name + phone given, and phone not already in CRM
    if (type === ORDER_TYPE.TAKEAWAY && trimName && trimPhone && !crmFound.current) {
      fetch(`${API_BASE}/crm/customers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimName, phone: trimPhone }),
      }).catch(() => { /* silent — order proceeds regardless */ });
    }

    onConfirm({
      orderType:       type,
      customerName:    trimName       || null,
      customerPhone:   trimPhone      || null,
      customerAddress: address.trim() || null,
    });
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleConfirm();
    if (e.key === 'Escape') onClose();
  }

  const showNewCrmHint =
    type === ORDER_TYPE.TAKEAWAY &&
    crmStatus === 'not_found' &&
    name.trim() &&
    phone.trim();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="modal__title">New Order</div>

        {/* Type selector */}
        <span className="modal__label">Type</span>
        <div className="order-type-grid" style={{ marginBottom: 20 }}>
          {TYPES.map(t => (
            <button key={t.key}
              className={`order-type-btn order-type-btn--${t.key}`}
              style={type === t.key ? { background: 'var(--bg-hover)', borderWidth: 2, opacity: 1 } : {}}
              onClick={() => { setType(t.key); resetFields(); }}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* QUICK SALE */}
        {type === ORDER_TYPE.QUICK_SALE && (
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 12, padding: '8px 10px', background: 'var(--bg-hover, #f5f5f5)', borderRadius: 7 }}>
            ⚡ Cash sale — no customer details required.
          </div>
        )}

        {/* DELIVERY — partner dropdown */}
        {type === ORDER_TYPE.DELIVERY && (
          <>
            <span className="modal__label">Delivery Partner</span>
            {partners.length > 0 ? (
              <select className="modal__input" style={{ marginBottom: 10 }} autoFocus
                value={phone}
                onChange={e => {
                  const p = partners.find(x => x.phone === e.target.value);
                  setPhone(e.target.value);
                  setName(p?.name ?? '');
                }}>
                <option value="">— Select partner —</option>
                {partners.map(p => <option key={p.phone} value={p.phone}>{p.name}</option>)}
              </select>
            ) : (
              <div style={{ fontSize: 12, color: '#999', marginBottom: 10, padding: '6px 8px', background: '#f9f9f9', borderRadius: 6 }}>
                No delivery partners in CRM. Enable "Delivery Partner" on a customer record first.
              </div>
            )}
            <span className="modal__label">
              Address <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(optional)</span>
            </span>
            <textarea className="modal__input" rows={2} placeholder="Drop-off address…"
              value={address} onChange={e => setAddress(e.target.value)} />
          </>
        )}

        {/* TAKEAWAY / CAKE — phone CRM lookup + free name */}
        {(type === ORDER_TYPE.TAKEAWAY || type === ORDER_TYPE.CAKE_ORDER) && (
          <>
            <span className="modal__label">
              Phone <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(optional)</span>
            </span>
            <input
              className="modal__input"
              style={{ marginBottom: 6 }}
              placeholder="Mobile number — searches CRM"
              type="tel"
              value={phone}
              onChange={e => onPhoneChange(e.target.value)}
              autoFocus
            />
            {crmStatus === 'found' && (
              <div style={{ fontSize: 12, color: '#059669', marginBottom: 6, padding: '4px 8px', background: '#ecfdf5', borderRadius: 6 }}>
                ✓ Customer found in CRM
              </div>
            )}

            <span className="modal__label">
              Name <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(optional)</span>
            </span>
            <input
              className="modal__input"
              style={{ marginBottom: 6 }}
              placeholder="Auto-filled from CRM, or type any name"
              value={name}
              onChange={e => setName(e.target.value)}
            />
            {showNewCrmHint && (
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6, padding: '4px 8px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                ✦ New customer will be saved to CRM
              </div>
            )}
          </>
        )}

        <div className="modal__actions" style={{ marginTop: 8 }}>
          <button className="modal__btn modal__btn--cancel" onClick={onClose}>Cancel</button>
          <button className="modal__btn modal__btn--confirm" onClick={handleConfirm}>Open Order</button>
        </div>
      </div>
    </div>
  );
}
