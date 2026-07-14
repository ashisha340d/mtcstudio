import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router';
import StatusTimeline from './components/StatusTimeline';
import CustomerPickerModal from '../POS/components/CustomerPickerModal';
import '../POS/pos.css';
import './cake.css';

const API = import.meta.env.VITE_API_URL || '/api';
const H = { 'Content-Type': 'application/json', 'X-Session-ID': 'dev-session' };
const Rs = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Tiny shared primitives ────────────────────────────────────
function Label({ children }) {
  return <div className="ck-label">{children}</div>;
}
function Input({ value, onChange, type = 'text', placeholder, readOnly, autoFocus }) {
  return (
    <input type={type} value={value ?? ''} onChange={e => onChange?.(e.target.value)}
      placeholder={placeholder} readOnly={readOnly} autoFocus={autoFocus}
      className={`cake-input${readOnly ? ' cake-input--readonly' : ''}`} />
  );
}
function Textarea({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea value={value ?? ''} onChange={e => onChange?.(e.target.value)}
      placeholder={placeholder} rows={rows} className="cake-input cake-textarea" />
  );
}
function Field({ label, children, half, quarter }) {
  return (
    <div className={`ck-field${half ? ' ck-field--half' : quarter ? ' ck-field--quarter' : ''}`}>
      {label && <Label>{label}</Label>}
      {children}
    </div>
  );
}
function Section({ icon, title, action, children }) {
  return (
    <div className="cake-section">
      <div className="cake-section-title">
        <span>{icon}</span> {title}
        {action && <span className="ck-sec-action">{action}</span>}
      </div>
      {children}
    </div>
  );
}

// ── Product search dropdown ───────────────────────────────────
// Full label: "Product" or "Product — Variant" (variant always shown when showVariant=true)
function productLabel(p, showVariant = false) {
  if (!p) return '';
  const hasVariant = p.variant_name && (showVariant ? true : p.variant_name !== 'Regular');
  return hasVariant ? `${p.variant_name} - ${p.product_name}` : p.product_name;
}

// Dropdown uses position:fixed so it escapes overflow:auto table containers
function ProductPicker({ products, value, onChange, placeholder = 'Search product…', showVariant = false }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [dropStyle, setDropStyle] = useState({});
  const inputRef = useRef(null);
  const wrapRef = useRef(null);

  const label = productLabel(value, showVariant);

  const filtered = products.filter(p => {
    if (!search.trim()) return true;
    const full = `${p.product_name} ${p.variant_name || ''}`.toLowerCase();
    return full.includes(search.toLowerCase());
  }).slice(0, 30);

  // Close on outside click
  useEffect(() => {
    function onDown(e) {
      if (!wrapRef.current?.contains(e.target) && !document.getElementById('ck-portal')?.contains(e.target))
        setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  function openPicker() {
    const rect = inputRef.current.getBoundingClientRect();
    // Position dropdown fixed relative to viewport so it escapes any overflow container
    setDropStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      right: 'auto',
      zIndex: 9999,
    });
    setOpen(true);
    setSearch('');
  }

  // Dropdown rendered into a fixed portal div so table overflow can't clip it
  const dropdown = open ? (
    <div className="ck-dropdown" style={dropStyle}>
      {filtered.length > 0
        ? filtered.map(p => {
          const varLabel = p.variant_name && (showVariant ? true : p.variant_name !== 'Regular')
            ? p.variant_name : null;
          return (
            <div key={`${p.product_id}-${p.variant_id}`} className="ck-dropdown-item"
              onMouseDown={e => { e.preventDefault(); onChange(p); setOpen(false); setSearch(''); }}>
              <span className="ck-dropdown-name">{productLabel(p, showVariant)}</span>
              <span className="ck-dropdown-rate">₹{Number(p.rate || 0).toLocaleString('en-IN')}</span>
            </div>
          );
        })

        : <div className="ck-dropdown-empty">No products found</div>
      }
    </div>
  ) : null;

  return (
    <div className="ck-picker" ref={wrapRef}>
      <input
        ref={inputRef}
        className="cake-input"
        value={open ? search : label}
        placeholder={placeholder}
        onFocus={openPicker}
        onChange={e => { setSearch(e.target.value); if (!open) openPicker(); }}
      />
      {value && !open && (
        <button className="ck-picker-clear" onClick={() => { onChange(null); setSearch(''); }}>×</button>
      )}
      {/* Render dropdown outside table via portal-like fixed div */}
      {dropdown}
    </div>
  );
}

// ── Collapsible section (state persisted to localStorage) ────
function useSection(key, defaultOpen) {
  const [open, setOpen] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem('cake_sections') || '{}');
      return s[key] !== undefined ? s[key] : defaultOpen;
    } catch { return defaultOpen; }
  });
  function toggle() {
    setOpen(v => {
      const next = !v;
      try {
        const s = JSON.parse(localStorage.getItem('cake_sections') || '{}');
        localStorage.setItem('cake_sections', JSON.stringify({ ...s, [key]: next }));
      } catch { }
      return next;
    });
  }
  return [open, toggle];
}

function CollapsibleSection({ icon, title, sectionKey, defaultOpen = true, badge, children }) {
  const [open, toggle] = useSection(sectionKey, defaultOpen);
  return (
    <div className="cake-section">
      <div className="cake-section-title ck-collapsible-title" onClick={toggle}>
        <span>{icon}</span> {title}
        {badge ? <span className="ck-sec-badge">{badge}</span> : null}
        <span className="ck-toggle-arrow">{open ? '▾' : '▸'}</span>
      </div>
      {open && children}
    </div>
  );
}

// ── Modifier chip selector ────────────────────────────────────
function ModifierGroup({ label, lookups, value, onChange }) {
  return (
    <div className="ck-mod-group">
      <Label>{label}</Label>
      <div className="ck-chips">
        {(lookups || []).map(l => {
          const active = value === l.id;
          return (
            <button key={l.id} className={`ck-chip${active ? ' ck-chip--active' : ''}`}
              onClick={() => onChange(active ? null : l.id)}>
              {l.name}
              {l.extra_charge > 0 && (
                <span className="ck-chip-charge">+{l.extra_charge}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Flavour picker — 3-column pill modal over the form ────────
function FlavourPickerModal({ products, onPick, onClose, title = '🎂 Pick Flavour', showVariant = false }) {
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const filtered = q
    ? products.filter(p => `${p.product_name} ${p.variant_name || ''}`.toLowerCase().includes(q))
    : products;

  return (
    <div className="ck-flav-overlay" onClick={onClose}>
      <div className="ck-flav-modal" onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <div className="ck-flav-head">
          <span>{title}</span>
          <button className="ck-flav-close" onClick={onClose}>✕</button>
        </div>
        <input
          className="cake-input"
          autoFocus
          placeholder="🔍 Search flavour…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ marginBottom: 10 }}
        />
        <div className="ck-flav-grid">
          {filtered.map(p => (
            <button
              key={`${p.product_id}-${p.variant_id}`}
              className="ck-flav-pill"
              onClick={() => { onPick(p); onClose(); }}
            >
              <span className="ck-flav-pill-name">{productLabel(p, showVariant)}</span>
              <span className="ck-flav-pill-rate">₹{Number(p.rate || 0).toLocaleString('en-IN')}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="ck-flav-empty">No flavours found</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Advance payment modal — split across methods ──────────────
const PAY_METHODS = [['CASH', '💵 Cash'], ['CARD', '💳 Card'], ['QR', '📱 QR'], ['WALLET', '👛 Wallet']];

function AdvancePaymentModal({ amounts, grandTotal, onConfirm, onClose }) {
  const [local, setLocal] = useState(amounts);
  const total = Object.values(local).reduce((s, v) => s + (parseFloat(v) || 0), 0);

  return (
    <div className="ck-flav-overlay" onClick={onClose}>
      <div className="ck-flav-modal" style={{ width: 360 }} onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <div className="ck-flav-head">
          <span>💳 Advance Payment</span>
          <button className="ck-flav-close" onClick={onClose}>✕</button>
        </div>
        {PAY_METHODS.map(([m, label], i) => (
          <div key={m} className="ck-pay-row">
            <span className="ck-pay-label">{label}</span>
            <input
              className="cake-input cake-input--num"
              type="number" min="0" step="0.01" placeholder="0.00"
              autoFocus={i === 0}
              value={local[m]}
              onFocus={e => e.target.select()}
              onKeyDown={e => { if (e.key === 'Enter' && total > 0) { onConfirm(local); onClose(); } }}
              onChange={e => setLocal(prev => ({ ...prev, [m]: e.target.value }))}
            />
          </div>
        ))}
        <div className="ck-price-row" style={{ marginTop: 8 }}>
          <span>Total Entered</span><span style={{ fontWeight: 800 }}>{Rs(total)}</span>
        </div>
        <div className="ck-price-row">
          <span>Order Total</span><span>{Rs(grandTotal)}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="cake-btn-ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="cake-btn-primary" style={{ flex: 2 }}
            onClick={() => { onConfirm(local); onClose(); }}>
            Confirm {Rs(total)}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Cake item row ─────────────────────────────────────────────
function CakeItemRow({ item, products, onChange, onRemove }) {
  const [showFlav, setShowFlav] = useState(false);
  function set(key, val) { onChange({ ...item, [key]: val }); }
  const amount = (parseFloat(item.rate) || 0) * (parseInt(item.qty) || 1);

  function onProductSelect(p) {
    if (!p) { set('product_id', null); set('product_name', ''); set('variant_id', null); set('variant_name', ''); set('rate', ''); return; }
    onChange({ ...item, product_id: p.product_id, product_name: p.product_name, variant_id: p.variant_id, variant_name: p.variant_name, rate: p.rate || '' });
  }

  const pickerVal = item.product_id
    ? { product_id: item.product_id, product_name: item.product_name, variant_id: item.variant_id, variant_name: item.variant_name }
    : null;

  return (
    <tr className="ck-line-row">
      <td style={{ minWidth: 140 }}>
        <button className={`ck-flavour-btn${pickerVal ? '' : ' ck-flavour-btn--empty'}`} onClick={() => setShowFlav(true)}>
          {pickerVal ? productLabel(pickerVal) : '🎂 Pick flavour…'}
        </button>
        {showFlav && (
          <FlavourPickerModal products={products} onPick={onProductSelect} onClose={() => setShowFlav(false)} />
        )}
      </td>
      <td style={{ width: 70 }}>

        <input className="cake-input cake-input--sm" value={item.size || ''} onChange={e => set('size', e.target.value)} placeholder="1 KG…" />
      </td>
      <td style={{ width: 50 }}>
        <input className="cake-input cake-input--sm" type="number" min="1" value={item.qty || 1}
          onChange={e => set('qty', parseInt(e.target.value) || 1)} />
      </td>
      <td style={{ width: 80 }}>
        <input className="cake-input cake-input--sm cake-input--num" type="number" min="0" step="0.01"
          value={item.rate ?? ''} onChange={e => set('rate', e.target.value)} placeholder="0.00" />
      </td>
      <td style={{ width: 80 }} className="ck-line-amount">{Rs(amount)}</td>
      <td style={{ width: 36 }}>
        <button className="ck-rm-btn" onClick={onRemove}>×</button>
      </td>
    </tr>
  );
}

// ── Accessory row ─────────────────────────────────────────────
function AccessoryRow({ item, products, onChange, onRemove }) {
  const [showPick, setShowPick] = useState(false);
  function set(key, val) { onChange({ ...item, [key]: val }); }
  const amount = (parseFloat(item.rate) || 0) * (parseInt(item.qty) || 1);

  function onProductSelect(p) {
    if (!p) { set('product_id', null); set('product_name', ''); set('variant_id', null); set('variant_name', ''); set('rate', ''); return; }
    onChange({ ...item, product_id: p.product_id, product_name: p.product_name, variant_id: p.variant_id, variant_name: p.variant_name, rate: p.rate || '' });
  }

  const pickerVal = item.product_id
    ? { product_id: item.product_id, product_name: item.product_name, variant_id: item.variant_id, variant_name: item.variant_name }
    : null;

  return (
    <tr className="ck-line-row">
      <td style={{ minWidth: 140 }}>
        <button className={`ck-flavour-btn${pickerVal ? '' : ' ck-flavour-btn--empty'}`} onClick={() => setShowPick(true)}>
          {pickerVal ? productLabel(pickerVal, true) : '🎁 Pick accessory…'}
        </button>
        {showPick && (
          <FlavourPickerModal products={products} onPick={onProductSelect} onClose={() => setShowPick(false)}
            title="🎁 Pick Accessory" showVariant />
        )}
      </td>
      <td style={{ width: 50 }}>
        <input className="cake-input cake-input--sm" type="number" min="1" value={item.qty || 1}
          onChange={e => set('qty', parseInt(e.target.value) || 1)} />
      </td>
      <td style={{ width: 80 }}>
        <input className="cake-input cake-input--sm cake-input--num" type="number" min="0" step="0.01"
          value={item.rate ?? ''} onChange={e => set('rate', e.target.value)} placeholder="0.00" />
      </td>
      <td style={{ width: 80 }} className="ck-line-amount">{Rs(amount)}</td>
      <td style={{ width: 36 }}>
        <button className="ck-rm-btn" onClick={onRemove}>×</button>
      </td>
    </tr>
  );
}

function isNepaliNumber(phone) {
  const p = String(phone || '').replace(/\D/g, '');
  return /^9779[678]\d{8}$/.test(p) || /^9[678]\d{8}$/.test(p) || /^09[678]\d{8}$/.test(p);
}

const newItem = () => ({ _key: Math.random(), product_id: null, product_name: '', variant_id: null, variant_name: '', size: '', unit: 'PCS', qty: 1, rate: '' });
const newAcc = () => ({ _key: Math.random(), product_id: null, product_name: '', variant_id: null, variant_name: '', unit: 'PCS', qty: 1, rate: '' });

// ── Shell: full page (route mode) or draggable/resizable window ──
function WindowShell({ windowed, rect, startMove, startResize, title, onCloseWin, onKeyDown, children }) {
  if (!windowed) return <div className="cake-root" onKeyDown={onKeyDown}>{children}</div>;
  return (
    <div className="ckw-overlay">
      <div
        className="ckw-window"
        style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
        onKeyDown={onKeyDown}
      >
        <div className="ckw-chrome" onMouseDown={startMove}>
          <div className="desktop-chrome__dots">
            <button className="win-dot win-dot--close ckw-dot-btn" onClick={onCloseWin} title="Close" />
            <div className="win-dot win-dot--min" />
            <div className="win-dot win-dot--max" />
          </div>
          <span className="ckw-chrome-title">{title}</span>
        </div>
        <div className="ckw-body">{children}</div>
        <div className="ckw-resize" onMouseDown={startResize} title="Drag to resize">◢</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  Main form
// ═══════════════════════════════════════════════════════════════
export default function CakeOrderForm({ id: propId = null, onClose = null }) {
  const params = useParams();
  const navigate = useNavigate();
  const windowed = !!onClose;                       // rendered as window over dashboard
  const [curId, setCurId] = useState(propId ?? params.id ?? null);
  const id = curId;
  const isNew = !id;

  function exit() { windowed ? onClose() : navigate('/pos'); }

  // Mode: minimal | advanced
  const [mode, setMode] = useState(() => localStorage.getItem('cake_entry_mode') || 'minimal');
  function setModeAndPersist(m) { setMode(m); localStorage.setItem('cake_entry_mode', m); }

  // Double-ESC → close / POS dashboard
  const lastEscRef = useRef(0);
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return;
      const now = Date.now();
      if (now - lastEscRef.current < 420) exit();
      lastEscRef.current = now;
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, windowed]); // eslint-disable-line

  // ── Remote data ────────────────────────────────────────────
  const [lookups, setLookups] = useState({});
  const [baseProducts, setBaseProducts] = useState([]);
  const [accProducts, setAccProducts] = useState([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [errors, setErrors] = useState({});
  const [statusChanging, setStatusChanging] = useState(false);

  // ── Order header ────────────────────────────────────────────
  const [orderNum, setOrderNum] = useState('');
  const [orderDate, setOrderDate] = useState('');
  const [status, setStatus] = useState('PENDING');
  const [sendingWA, setSendingWA] = useState(false);
  const [sendingSMS, setSendingSMS] = useState(false);
  const [history, setHistory] = useState([]);

  // ── Customer ────────────────────────────────────────────────
  const [phone, setPhone] = useState('');
  const [crmId, setCrmId] = useState(null);
  const [crmHint, setCrmHint] = useState('');
  const [custName, setCustName] = useState('');
  const [showCustPicker, setShowCustPicker] = useState(false);

  // ── Delivery ────────────────────────────────────────────────
  const [delivDate, setDelivDate] = useState('');
  const [delivTime, setDelivTime] = useState('');

  // ── Cake items & accessories ────────────────────────────────
  const [items, setItems] = useState([newItem()]);
  const [accessories, setAccessories] = useState([]);

  // ── Modifiers ───────────────────────────────────────────────
  const [creamId, setCreamId] = useState(null);
  const [shapeId, setShapeId] = useState(null);
  const [spongeId, setSpongeId] = useState(null);
  const [themeId, setThemeId] = useState(null);
  const [dietaryId, setDietaryId] = useState(null);

  // ── Cake details ────────────────────────────────────────────
  const [message, setMessage] = useState('');
  const [designNotes, setDesignNotes] = useState('');
  const [dietaryNotes, setDietaryNotes] = useState('');
  const [allergyNotes, setAllergyNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [assignedBaker, setAssignedBaker] = useState('');

  // ── Pricing ─────────────────────────────────────────────────
  const [discount, setDiscount] = useState('0');
  // Advance can be split across methods; follow-ups are collected via POS Dashboard
  const [advAmounts, setAdvAmounts] = useState({ CASH: '', CARD: '', QR: '', WALLET: '' });
  const [showPayModal, setShowPayModal] = useState(false);
  const [followupPaid, setFollowupPaid] = useState(0);
  const [payHistory, setPayHistory] = useState([]);
  // Totals returned from server after save; locally estimated otherwise
  const [serverTotals, setServerTotals] = useState(null);

  // ── Images ──────────────────────────────────────────────────
  const [images, setImages] = useState([]);

  // ── Local pricing estimate ──────────────────────────────────
  const cakeTotal = items.reduce((s, it) => s + (parseFloat(it.rate) || 0) * (parseInt(it.qty) || 1), 0);
  const accTotal = accessories.reduce((s, ac) => s + (parseFloat(ac.rate) || 0) * (parseInt(ac.qty) || 1), 0);
  const modTotal = [creamId, shapeId, spongeId, themeId, dietaryId].reduce((s, lid) => {
    if (!lid) return s;
    const all = Object.values(lookups).flat();
    const lk = all.find(l => l.id === lid);
    return s + (lk?.extra_charge || 0);
  }, 0);
  const disc = parseFloat(discount) || 0;
  const grand = Math.max(0, cakeTotal + accTotal + modTotal - disc);
  const advSum = Object.values(advAmounts).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const advance = advSum + followupPaid;
  const balance = Math.max(0, grand - advance);

  // ── Load meta (lookups + order number) ─────────────────────
  useEffect(() => {
    fetch(`${API}/pos/cake-orders/meta`, { headers: H })
      .then(r => r.json())
      .then(d => {
        setLookups(d.lookups || {});
        if (isNew) { setOrderNum(d.nextOrderNumber); setOrderDate(d.today); setDelivDate(d.today); }
      }).catch(() => { });
    fetch(`${API}/pos/cake-orders/products?type=base`, { headers: H })
      .then(r => r.json()).then(setBaseProducts).catch(() => { });
    fetch(`${API}/pos/cake-orders/products?type=accessory`, { headers: H })
      .then(r => r.json()).then(setAccProducts).catch(() => { });
  }, [isNew]);

  // ── Load existing order ─────────────────────────────────────
  useEffect(() => {
    if (isNew) return;
    setLoading(true);
    fetch(`${API}/pos/cake-orders/${id}`, { headers: H })
      .then(r => r.json())
      .then(d => {
        setOrderNum(d.order_number ?? '');
        setOrderDate(d.order_date ?? '');
        setStatus(d.status ?? 'PENDING');
        setHistory(d.statusHistory ?? []);
        setPhone(d.phone ?? '');
        setCrmId(d.crm_customer_id ?? null);
        setCustName(d.customer_name ?? '');
        setDelivDate(d.delivery_date ?? '');
        setDelivTime(d.delivery_time ?? '');
        setCreamId(d.cream_type_id ?? null);
        setShapeId(d.shape_id ?? null);
        setSpongeId(d.sponge_type_id ?? null);
        setThemeId(d.theme_id ?? null);
        setDietaryId(d.dietary_type_id ?? null);
        setMessage(d.message_on_cake ?? '');
        setDesignNotes(d.design_notes ?? '');
        setDietaryNotes(d.dietary_notes ?? '');
        setAllergyNotes(d.allergy_notes ?? '');
        setInternalNotes(d.internal_notes ?? '');
        setAssignedBaker(d.assigned_baker ?? '');
        setDiscount(String(d.discount ?? '0'));
        // Rebuild advance breakdown + follow-up total from payment rows
        const pays = d.payments ?? [];
        const adv = { CASH: 0, CARD: 0, QR: 0, WALLET: 0 };
        let followup = 0;
        for (const p of pays) {
          if (p.payment_type === 'ADVANCE') adv[p.method] = (adv[p.method] || 0) + Number(p.amount);
          else followup += Number(p.amount);
        }
        if (!pays.some(p => p.payment_type === 'ADVANCE') && Number(d.advance_paid) > followup) {
          // Legacy order without advance rows — show the stored total under its method
          const m = ['CASH', 'CARD', 'QR', 'WALLET'].includes(d.advance_method) ? d.advance_method : 'CASH';
          adv[m] = Number(d.advance_paid) - followup;
        }
        setAdvAmounts(Object.fromEntries(Object.entries(adv).map(([m, v]) => [m, v > 0 ? String(v) : ''])));
        setFollowupPaid(followup);
        setPayHistory(pays);
        setImages((d.images ?? []).map(img => ({ url: img.image_url, name: img.image_name || '' })));
        setServerTotals({ cake_total: d.cake_total, modifier_total: d.modifier_total, accessory_total: d.accessory_total, grand_total: d.grand_total, advance_paid: d.advance_paid, balance_due: d.balance_due });
        // Restore line items
        setItems(d.items?.length
          ? d.items.map(it => ({ _key: Math.random(), product_id: it.product_id, product_name: it.product_name, variant_id: it.variant_id, variant_name: it.variant_name, size: it.size || '', unit: it.unit, qty: it.qty, rate: it.rate }))
          : [newItem()]);
        setAccessories((d.accessories || []).map(ac => ({ _key: Math.random(), product_id: ac.product_id, product_name: ac.product_name, variant_id: ac.variant_id, variant_name: ac.variant_name, unit: ac.unit, qty: ac.qty, rate: ac.rate })));
      })
      .finally(() => setLoading(false));
  }, [id, isNew]);

  // ── CRM phone lookup ────────────────────────────────────────
  const crmTimer = useRef(null);
  function onPhoneChange(val) {
    setPhone(val); setCrmHint('');
    clearTimeout(crmTimer.current);
    if (val.trim().length < 7) return;
    crmTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`${API}/crm/customers/${encodeURIComponent(val.trim())}`, { headers: H });
        if (r.ok) {
          const d = await r.json();
          if (d?.name) { setCrmHint(`✓ ${d.name}`); setCustName(d.name); setCrmId(d.id ?? null); }
        }
      } catch { }
    }, 400);
  }

  // ── Image upload ────────────────────────────────────────────
  async function handleImageUpload(files) {
    if (!files.length) return;
    const form = new FormData();
    for (const f of files) form.append('photos', f);
    try {
      const r = await fetch(`${API}/pos/cake-orders/upload`, { method: 'POST', headers: { 'X-Session-ID': 'dev-session' }, body: form });
      if (r.ok) {
        const d = await r.json();
        setImages(prev => [...prev, ...(d.urls || [])]);
      }
    } catch (e) { alert('Upload failed: ' + e.message); }
  }

  // ── Validation ──────────────────────────────────────────────
  function validate() {
    const e = {};
    if (!custName.trim()) e.custName = 'Required';
    if (!delivDate) e.delivDate = 'Required';
    if (!items.some(it => it.product_name?.trim() || it.rate > 0)) e.items = 'Add at least one cake item';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  // ── Payload ─────────────────────────────────────────────────
  function payload() {
    return {
      crm_customer_id: crmId,
      phone: phone.trim() || null,
      customer_name: custName.trim(),
      delivery_date: delivDate || null,
      delivery_time: delivTime || null,
      shape_id: shapeId, cream_type_id: creamId, sponge_type_id: spongeId,
      theme_id: themeId, dietary_type_id: dietaryId,
      message_on_cake: message.trim() || null,
      design_notes: designNotes.trim() || null,
      dietary_notes: dietaryNotes.trim() || null,
      allergy_notes: allergyNotes.trim() || null,
      internal_notes: internalNotes.trim() || null,
      assigned_baker: assignedBaker.trim() || null,
      discount: parseFloat(discount) || 0,
      advance_paid: advSum,
      advance_payments: Object.entries(advAmounts)
        .filter(([, v]) => (parseFloat(v) || 0) > 0)
        .map(([m, v]) => ({ method: m, amount: parseFloat(v) })),
      items: items.filter(it => it.product_name?.trim() || parseFloat(it.rate) > 0).map(it => ({
        product_id: it.product_id, variant_id: it.variant_id,
        product_name: it.product_name, variant_name: it.variant_name,
        size: it.size || null, unit: it.unit || 'PCS',
        qty: parseInt(it.qty) || 1, rate: parseFloat(it.rate) || 0,
      })),
      accessories: accessories.filter(ac => ac.product_name?.trim()).map(ac => ({
        product_id: ac.product_id, variant_id: ac.variant_id,
        product_name: ac.product_name, variant_name: ac.variant_name,
        unit: ac.unit || 'PCS', qty: parseInt(ac.qty) || 1, rate: parseFloat(ac.rate) || 0,
      })),
      images,
    };
  }

  // ── Save ────────────────────────────────────────────────────
  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      const url = isNew ? `${API}/pos/cake-orders` : `${API}/pos/cake-orders/${id}`;
      const method = isNew ? 'POST' : 'PUT';
      const r = await fetch(url, { method, headers: H, body: JSON.stringify(payload()) });
      if (!r.ok) { const d = await r.json(); alert(d.error || 'Save failed'); return; }
      const saved = await r.json();
      setServerTotals({ cake_total: saved.cake_total, modifier_total: saved.modifier_total, accessory_total: saved.accessory_total, grand_total: saved.grand_total, advance_paid: saved.advance_paid, balance_due: saved.balance_due });
      setPayHistory(saved.payments ?? []);
      if (isNew) {
        if (windowed) setCurId(saved.id);
        else navigate(`/pos/cake/${saved.id}`, { replace: true });
      }
    } finally { setSaving(false); }
  }

  // ── Status transition ────────────────────────────────────────
  async function handleTransition(newStatus) {
    setStatusChanging(true);
    try {
      const r = await fetch(`${API}/pos/cake-orders/${id}/status`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: newStatus }) });
      if (!r.ok) { const d = await r.json(); alert(d.error || 'Status change failed'); return; }
      const d = await r.json();
      setStatus(d.status);
      setHistory(d.statusHistory ?? []);
    } finally { setStatusChanging(false); }
  }

  // ── Print ────────────────────────────────────────────────────
  async function handlePrint() {
    if (!id || printing) return;

    setPrinting(true);

    try {
      console.log('Print URL:', `${API}/pos/cake-orders/${id}/print`);

      const r = await fetch(
        `${API}/pos/cake-orders/${id}/print`,
        { method: 'POST', headers: H }
      );

      console.log('Status:', r.status);
      console.log('OK:', r.ok);

      const text = await r.text();
      console.log('Response:', text);

      if (!r.ok) {
        alert(text || 'Print failed');
      }
    } catch (e) {
      console.error('Print Error:', e);
      alert(e.message);
    } finally {
      setPrinting(false);
    }
  }

  // ── WhatsApp ──────────────────────────────────────────────────
  async function handleSendWhatsApp() {
    if (!id || sendingWA) return;
    setSendingWA(true);
    try {
      const r = await fetch(`${API}/pos/cake-orders/${id}/whatsapp-message`, { headers: H });
      const d = await r.json();
      if (!r.ok) { alert(d.error || 'Could not build WhatsApp message'); return; }
      window.open(`https://wa.me/${d.phone}?text=${encodeURIComponent(d.message)}`, '_blank');
    } finally { setSendingWA(false); }
  }

  // ── SMS (Nepal only) ────────────────────────────────────────────
  async function handleSendSMS() {
    if (!id || sendingSMS) return;
    setSendingSMS(true);
    try {
      const r = await fetch(`${API}/pos/cake-orders/${id}/send-sms`, { method: 'POST', headers: H });
      const d = await r.json();
      if (!r.ok) { alert(d.error || 'Could not send SMS'); return; }
      alert('SMS sent to ' + d.phone);
    } finally { setSendingSMS(false); }
  }

  // ── Delete ────────────────────────────────────────────────────
  async function handleDelete() {
    if (!id || !confirm('Delete this cake order?')) return;
    const r = await fetch(`${API}/pos/cake-orders/${id}`, { method: 'DELETE', headers: H });
    if (r.ok) { windowed ? onClose() : navigate('/pos', { replace: true }); }
  }

  // ── Display totals (prefer server after first save) ──────────
  const totals = serverTotals || { cake_total: cakeTotal, modifier_total: modTotal, accessory_total: accTotal, grand_total: grand, advance_paid: advance, balance_due: balance };

  function handleEnterNext(e) {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;

    const el = e.target;
    if (!el || el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON') return;
    if (!['INPUT', 'SELECT'].includes(el.tagName)) return;

    e.preventDefault();
    const root = e.currentTarget;
    const controls = Array.from(root.querySelectorAll(
      'input:not([type="hidden"]):not([type="file"]), select, textarea'
    )).filter(control => {
      if (control.disabled || control.readOnly) return false;
      if (control.offsetParent === null) return false;
      return true;
    });

    const idx = controls.indexOf(el);
    const next = controls[idx + 1] || controls[0];
    if (!next || next === el) return;

    next.focus();
    if (typeof next.select === 'function' && next.tagName === 'INPUT') next.select();
  }

  /* ── Window rect (windowed mode) — drag + resize, persisted ── */
  const [rect, setRect] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem('cake_win_rect'));
      if (s?.w >= 720) return s;
    } catch { }
    const w = Math.min(1180, window.innerWidth - 60);
    const h = Math.min(780, window.innerHeight - 50);
    return { x: Math.max(10, (window.innerWidth - w) / 2), y: Math.max(10, (window.innerHeight - h) / 2), w, h };
  });
  const rectRef = useRef(rect);
  rectRef.current = rect;
  const dragRef = useRef(null);

  useEffect(() => {
    if (!windowed) return;
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (d.mode === 'move') {
        setRect(r => ({
          ...r,
          x: Math.max(-r.w + 140, Math.min(window.innerWidth - 140, d.start.x + dx)),
          y: Math.max(0, Math.min(window.innerHeight - 60, d.start.y + dy)),
        }));
      } else {
        setRect(r => ({
          ...r,
          w: Math.max(720, Math.min(window.innerWidth, d.start.w + dx)),
          h: Math.max(480, Math.min(window.innerHeight, d.start.h + dy)),
        }));
      }
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.userSelect = '';
      try { localStorage.setItem('cake_win_rect', JSON.stringify(rectRef.current)); } catch { }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [windowed]);

  const startMove = (e) => {
    if (e.target.closest('button')) return; // dots stay clickable
    dragRef.current = { mode: 'move', sx: e.clientX, sy: e.clientY, start: rectRef.current };
    document.body.style.userSelect = 'none';
    e.preventDefault();
  };
  const startResize = (e) => {
    dragRef.current = { mode: 'resize', sx: e.clientX, sy: e.clientY, start: rectRef.current };
    document.body.style.userSelect = 'none';
    e.preventDefault();
    e.stopPropagation();
  };

  /* ── Column split (left/right) — draggable, persisted ── */
  const bodyRef = useRef(null);
  const [leftPct, setLeftPct] = useState(() => {
    const v = parseFloat(localStorage.getItem('cake_split_pct'));
    return Number.isFinite(v) && v >= 25 && v <= 75 ? v : 46;
  });
  const splitDrag = useRef(false);
  useEffect(() => {
    const onMove = (e) => {
      if (!splitDrag.current || !bodyRef.current) return;
      const r = bodyRef.current.getBoundingClientRect();
      setLeftPct(Math.min(75, Math.max(25, ((e.clientX - r.left) / r.width) * 100)));
    };
    const onUp = () => {
      if (!splitDrag.current) return;
      splitDrag.current = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      setLeftPct(p => { try { localStorage.setItem('cake_split_pct', String(p)); } catch { } return p; });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);
  const startSplitDrag = (e) => {
    splitDrag.current = true;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  };

  const shellProps = {
    windowed, rect, startMove, startResize,
    onCloseWin: exit,
    onKeyDown: handleEnterNext,
    title: isNew ? '🎂 New Cake Order' : `🎂 ${orderNum}${custName ? ' · ' + custName : ''}`,
  };

  if (loading) return <WindowShell {...shellProps}><div className="cake-loading">Loading…</div></WindowShell>;

  const isAdvanced = mode === 'advanced';

  // Section badges
  const modCount = [creamId, shapeId, spongeId, themeId, dietaryId].filter(Boolean).length;
  const accCount = accessories.filter(a => a.product_name?.trim()).length;
  const detailCount = [designNotes, dietaryNotes, allergyNotes, assignedBaker, internalNotes].filter(s => s?.trim()).length + images.length;

  return (
    <WindowShell {...shellProps}>

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="cake-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {!windowed && <button className="cake-back-btn" onClick={() => navigate('/pos')}>← POS</button>}
          <div>
            <h1 className="cake-title">
              {isNew ? '🎂 New Cake Order' : `🎂 ${custName || orderNum}`}
            </h1>
            {!isNew && (
              <p className="cake-subtitle">{orderNum} · {orderDate}</p>
            )}
          </div>
        </div>

        <div className="ck-mode-toggle">
          <button className={`ck-mode-btn${!isAdvanced ? ' ck-mode-btn--active' : ''}`} onClick={() => setModeAndPersist('minimal')}>⚡ Minimal</button>
          <button className={`ck-mode-btn${isAdvanced ? ' ck-mode-btn--active' : ''}`} onClick={() => setModeAndPersist('advanced')}>🔧 Advanced</button>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {!isNew && (
            <>
              <button className="cake-btn-ghost" onClick={handlePrint} disabled={printing}>{printing ? '…' : '🖨 Print'}</button>
              {phone?.trim() && status === 'CONFIRMED' && (
                <button className="cake-btn-ghost" onClick={handleSendWhatsApp} disabled={sendingWA}>{sendingWA ? '…' : '📲 WhatsApp'}</button>
              )}
              {phone?.trim() && status === 'CONFIRMED' && isNepaliNumber(phone) && (
                <button className="cake-btn-ghost" onClick={handleSendSMS} disabled={sendingSMS}>{sendingSMS ? '…' : '✉️ SMS'}</button>
              )}
              <button className="cake-btn-danger" onClick={handleDelete}>Delete</button>
            </>
          )}
          <button className="cake-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Create Order' : 'Save'}
          </button>
        </div>
      </div>

      <div className="cake-form-body" ref={bodyRef}>
        {/* ── LEFT ─────────────────────────────────────────── */}
        <div className="cake-form-left" style={{ flex: `0 0 ${leftPct}%` }}>

          {/* ① Customer + Delivery — merged, compact */}
          <Section icon="👤" title="Customer & Delivery">
            <button className="ck-pick-cust" onClick={() => setShowCustPicker(true)}>👥 Pick Customer</button>
            <div className="ck-row">
              <Field label="Phone" half>
                <Input value={phone} onChange={onPhoneChange} type="tel" placeholder="98XXXXXXXX" />
                {crmHint && <div className="cake-crm-hint">{crmHint}</div>}
              </Field>
              <Field label="Name *" half>
                <Input value={custName} onChange={setCustName} placeholder="Full name" />
                {errors.custName && <div className="cake-error">{errors.custName}</div>}
              </Field>
            </div>
            <div className="ck-row">
              <Field label="Delivery Date *" half>
                <Input value={delivDate} onChange={setDelivDate} type="date" />
                {errors.delivDate && <div className="cake-error">{errors.delivDate}</div>}
              </Field>
              <Field label="Delivery Time" half>
                <Input value={delivTime} onChange={setDelivTime} type="time" />
              </Field>
            </div>
          </Section>

          {/* ② Cake Detail — flavour + message + accessories, one panel */}
          <Section icon="🎂" title="Cake Detail"
            action={<button className="ck-add-row" onClick={() => { setItems(prev => [...prev, newItem()]); setServerTotals(null); }}>+ Add Row</button>}>
            {errors.items && <div className="cake-error" style={{ marginBottom: 6 }}>{errors.items}</div>}
            <div className="ck-line-table-wrap">
              <table className="ck-line-table">
                <thead>
                  <tr className="ck-band">
                    <th>Flavour</th><th>Note Size</th><th>Lbl</th><th>Rate Per Pound ₹</th><th>Amt</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <CakeItemRow key={it._key} item={it} products={baseProducts} onChange={v => { setItems(prev => prev.map((x, j) => j === i ? v : x)); setServerTotals(null); }} onRemove={() => { setItems(prev => prev.length > 1 ? prev.filter((_, j) => j !== i) : prev); setServerTotals(null); }} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Message on cake */}
            <div style={{ marginTop: 12 }}>
              <Label>Message on Cake</Label>
              <Input value={message} onChange={setMessage} placeholder="e.g. Happy Birthday Aarav!" />
            </div>

            {/* Accessories — merged here */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '14px 0 8px' }}>
              <button className="ck-add-row" onClick={() => { setAccessories(prev => [...prev, newAcc()]); setServerTotals(null); }}>+ Add Accessory</button>
            </div>
            <div className="ck-line-table-wrap">
              <table className="ck-line-table">
                <thead>
                  <tr className="ck-band">
                    <th>🎁 Accessories{accCount > 0 ? ` · ${accCount}` : ''}</th><th>Qty</th><th>Rate ₹</th><th>Amount</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {accessories.map((ac, i) => (
                    <AccessoryRow key={ac._key} item={ac} products={accProducts}
                      onChange={v => { setAccessories(prev => prev.map((x, j) => j === i ? v : x)); setServerTotals(null); }}
                      onRemove={() => { setAccessories(prev => prev.filter((_, j) => j !== i)); setServerTotals(null); }} />
                  ))}
                  {accessories.length === 0 && (
                    <tr><td colSpan={5} style={{ padding: '10px 8px', color: '#9c8870', fontSize: 11, textAlign: 'center' }}>No accessories yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>

        </div>

        <div className="ck-split-divider" onMouseDown={startSplitDrag} title="Drag to resize" />

        {/* ── RIGHT PANEL ───────────────────────────────────── */}
        <div className="cake-form-right" style={{ flex: 1, minWidth: 0 }}>

          {/* ① Modifiers — collapsible */}
          <CollapsibleSection icon="🏷" title="Modifiers" sectionKey="modifiers" defaultOpen={true}
            badge={modCount > 0 ? `${modCount} selected` : null}>
            <div className="ck-mods">
              <ModifierGroup label="Cream Type" lookups={lookups.CREAM_TYPE} value={creamId} onChange={v => { setCreamId(v); setServerTotals(null); }} />
              <ModifierGroup label="Shape" lookups={lookups.SHAPE_TYPE} value={shapeId} onChange={v => { setShapeId(v); setServerTotals(null); }} />
              {isAdvanced && (
                <>
                  <ModifierGroup label="Sponge" lookups={lookups.SPONGE_TYPE} value={spongeId} onChange={v => { setSpongeId(v); setServerTotals(null); }} />
                  <ModifierGroup label="Theme" lookups={lookups.THEME_TYPE} value={themeId} onChange={v => { setThemeId(v); setServerTotals(null); }} />
                  <ModifierGroup label="Dietary" lookups={lookups.DIETARY_TYPE} value={dietaryId} onChange={v => { setDietaryId(v); setServerTotals(null); }} />
                </>
              )}
            </div>
          </CollapsibleSection>

          {/* ② Details — collapsible, advanced only */}
          {isAdvanced && (
            <CollapsibleSection icon="📝" title="Details" sectionKey="details" defaultOpen={false}
              badge={detailCount > 0 ? `${detailCount} filled` : null}>
              <div className="ck-row">
                <Field label="Design Notes" half>
                  <Textarea value={designNotes} onChange={setDesignNotes} placeholder="Decorations, finishing…" rows={2} />
                </Field>
                <Field label="Dietary / Allergy" half>
                  <Textarea value={dietaryNotes} onChange={setDietaryNotes} placeholder="Eggless, nut-free…" rows={2} />
                  <Input value={allergyNotes} onChange={setAllergyNotes} placeholder="Specific allergy notes…" style={{ marginTop: 6 }} />
                </Field>
              </div>
              {/* Ref images + baker + internal — merged */}
              <div className="ck-row" style={{ marginTop: 8 }}>
                <Field label="Assigned Baker" half>
                  <Input value={assignedBaker} onChange={setAssignedBaker} placeholder="Baker name…" />
                </Field>
                <Field label="Internal Notes" half>
                  <Input value={internalNotes} onChange={setInternalNotes} placeholder="Staff notes…" />
                </Field>
              </div>
              <div style={{ marginTop: 10 }}>
                <Label>Reference Images</Label>
                <div className="cake-photo-area">
                  {images.map((img, i) => (
                    <div key={i} className="cake-photo-thumb">
                      <img src={img.url || img} alt="" />
                      <button className="cake-photo-rm" onClick={() => setImages(p => p.filter((_, j) => j !== i))}>×</button>
                    </div>
                  ))}
                  <label className="cake-photo-add">
                    <input type="file" multiple accept="image/*" style={{ display: 'none' }}
                      onChange={e => handleImageUpload(Array.from(e.target.files))} />
                    <span>📷 Add</span>
                  </label>
                </div>
              </div>
            </CollapsibleSection>
          )}

          {/* Pricing — compact rows; advance split entered via Pick modal */}
          <Section icon="💰" title="Pricing">
            <div className="ck-price-row"><span>Cake Total</span><span>{Rs(totals.cake_total)}</span></div>
            {totals.modifier_total > 0 && <div className="ck-price-row"><span>Modifiers</span><span>+{Rs(totals.modifier_total)}</span></div>}
            {totals.accessory_total > 0 && <div className="ck-price-row"><span>Accessories</span><span>+{Rs(totals.accessory_total)}</span></div>}
            <div className="ck-price-row">
              <span>Discount</span>
              <input className="ck-price-input" type="number" min="0" step="0.01" placeholder="0"
                value={discount} onChange={e => { setDiscount(e.target.value); setServerTotals(null); }} />
            </div>
            <div className="ck-price-row ck-price-grand"><span>Total</span><span>{Rs(totals.grand_total)}</span></div>

            <div className="ck-price-row">
              <span>Advance</span>
              <span className="ck-price-adv">
                <span>{Rs(advSum)}</span>
                <button className="ck-pick-btn" onClick={() => setShowPayModal(true)}>💳 Pick</button>
              </span>
            </div>
            {followupPaid > 0 && (
              <div className="ck-price-row"><span>Follow-up Received</span><span>{Rs(followupPaid)}</span></div>
            )}

            <div className={`ck-price-row ck-price-balance${totals.balance_due > 0 ? ' ck-price-balance--due' : ''}`}>
              <span>Balance Due</span><span>{Rs(totals.balance_due)}</span>
            </div>
            <div style={{ marginTop: 6, fontSize: 10, color: '#9c8870', lineHeight: 1.4 }}>
              Advance is recorded in payments on Save.{!isNew && ' Use POS Dashboard to collect follow-up payments.'}
            </div>

            {payHistory.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="ck-label" style={{ marginBottom: 4 }}>Payment History</div>
                {payHistory.map(p => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 10, color: '#6b5640', padding: '3px 0', borderBottom: '1px solid #f0e8d8' }}>
                    <span>
                      {p.amount < 0 ? 'Reversal' : (p.payment_type === 'ADVANCE' ? 'Advance' : 'Follow-up')} · {p.method}
                      <span style={{ color: '#9c8870', marginLeft: 5 }}>
                        {new Date(String(p.created_at).replace(' ', 'T') + '+05:45').toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </span>
                    <span style={{ fontWeight: 700, color: p.amount < 0 ? '#c0392b' : '#2d7a2d' }}>{Rs(p.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Status — edit mode only */}
          {!isNew && (
            <Section icon="📊" title="Status">
              <StatusTimeline currentStatus={status} onTransition={handleTransition} loading={statusChanging} />
              {history.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div className="ck-label" style={{ marginBottom: 6 }}>History</div>
                  {history.map((h, i) => (
                    <div key={i} className="cake-history-row">
                      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                        {h.old_status && <><span className="cake-history-status cake-history-status--old">{h.old_status}</span><span style={{ color: '#9c8870', fontSize: 11 }}>→</span></>}
                        <span className="cake-history-status cake-history-status--new">{h.new_status}</span>
                      </div>
                      <div style={{ fontSize: 10, color: '#9c8870' }}>
                        {h.changed_by_name && <span>{h.changed_by_name} · </span>}
                        {new Date(h.changed_at + 'Z').toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}
        </div>
      </div>

      {showCustPicker && (
        <CustomerPickerModal
          onClose={() => setShowCustPicker(false)}
          onSelect={(c) => {
            setPhone(c.phone ?? '');
            setCustName(c.name ?? '');
            setCrmId(c.id ?? null);
            setCrmHint(c.name ? `✓ ${c.name}` : '');
          }}
        />
      )}
      {showPayModal && (
        <AdvancePaymentModal
          amounts={advAmounts}
          grandTotal={totals.grand_total}
          onClose={() => setShowPayModal(false)}
          onConfirm={(vals) => { setAdvAmounts(vals); setServerTotals(null); }}
        />
      )}
    </WindowShell>
  );
}
