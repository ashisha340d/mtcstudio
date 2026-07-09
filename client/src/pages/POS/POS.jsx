import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { createSocket } from '../../socket';
import SocketStatus from '../../components/SocketStatus';
import { nepalNowFull } from '../../utils/dateTime';
import { useLocation, useNavigate } from 'react-router';
import {
  Search, Plus, Minus, Trash2,
  Image as ImageIcon, Users, Pencil,
  UtensilsCrossed, CreditCard,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import CheckoutModal from './components/SplitTenderCheckoutContainer';
import SalesReportModal from './components/SalesReportModal';
import { printReceipt } from './components/ThermalReceipt';
import './pos.css';

const API = import.meta.env.VITE_API_URL || '/api';
const H = { 'Content-Type': 'application/json', 'X-Session-ID': 'dev-session' };

const fmt = (n) =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ORDER_TYPES = [
  { key: 'DINE_IN', label: 'Dine In' },
  { key: 'TAKEAWAY', label: 'Takeaway' },
  { key: 'DELIVERY', label: 'Delivery' },
  { key: 'QUICK_SALE', label: 'Quick' },
];

const STATUS_COLOR = {
  ORDERSENT: '#c1440e',
  IN_PROGRESS: '#a16207',
  SERVED: '#2d7a2d',
  CANCELLED: '#c0392b',
};

const canEdit = () => true;

let _cartId = 0;
const newId = () => `ci_${++_cartId}`;
const ALL_CAT = '__ALL__';

// Effective variant name for display/storage: drop "Regular" and variants
// that just repeat the product name (otherwise the caption reads "Burger (Burger)").
const cleanVariantName = (variantName, productName) => {
  if (!variantName) return null;
  const v = String(variantName).trim().toLowerCase();
  if (v === 'regular' || v === String(productName ?? '').trim().toLowerCase()) return null;
  return variantName;
};

/* ── Panel layout ────────────────────────────────────────────── */
const PANEL_LAYOUT_KEY = 'posv2_layout';
const DIVIDER_W = 5;
const DEFAULT_WIDTHS = { kot: 480, cat: 140, products: 0 };
const DEFAULT_ORDER = ['kot', 'cat', 'products'];
const MIN_WIDTHS = { kot: 280, cat: 80, products: 200 };

function loadLayout() {
  try {
    const s = JSON.parse(localStorage.getItem(PANEL_LAYOUT_KEY));
    if (s?.order && s?.widths) return s;
  } catch {}
  return null;
}

/* ── Warm palette ────────────────────────────────────────────── */
const W = {
  desktopBg: '#ddd5c4',
  windowBg: '#fdf9f4',
  windowBg2: '#f5ece0',
  chrome: 'linear-gradient(180deg, #d2c6b2 0%, #b8a890 100%)',
  border: '#a89880',
  borderLight: '#c4b49c',
  text1: '#2a1f12',
  text2: '#6b5640',
  text3: '#9c8870',
  orange: '#c1440e',
  green: '#2d7a2d',
  red: '#c0392b',
};

/* ── Draggable · Resizable · Persistent Modal Shell ─────────── */
function ModalShell({ id, defaultWidth = 420, defaultHeight = 500, onClose, children }) {
  const KEY = `posv2_modal_${id}`;
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; } };

  const [pos, setPos] = useState(() => {
    const s = load();
    return {
      x: s.x ?? Math.max(20, (window.innerWidth - (s.w ?? defaultWidth)) / 2),
      y: s.y ?? Math.max(20, (window.innerHeight - (s.h ?? defaultHeight)) / 2),
    };
  });
  const [size, setSize] = useState(() => {
    const s = load();
    return { w: s.w ?? defaultWidth, h: s.h ?? defaultHeight };
  });

  const posRef = useRef(pos);
  const sizeRef = useRef(size);
  const drag = useRef(null);
  const shellRef = useRef(null);

  const persist = () =>
    localStorage.setItem(KEY, JSON.stringify({ x: posRef.current.x, y: posRef.current.y, w: sizeRef.current.w, h: sizeRef.current.h }));

  const startDrag = (e) => {
    if (e.button !== 0) return;
    drag.current = { ox: e.clientX - posRef.current.x, oy: e.clientY - posRef.current.y };
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!drag.current) return;
      const x = Math.max(0, Math.min(window.innerWidth - 100, e.clientX - drag.current.ox));
      const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.current.oy));
      posRef.current = { x, y };
      setPos({ x, y });
    };
    const onUp = () => { if (drag.current) persist(); drag.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!shellRef.current) return;
    const ro = new ResizeObserver(() => {
      if (!shellRef.current) return;
      const w = shellRef.current.offsetWidth;
      const h = shellRef.current.offsetHeight;
      sizeRef.current = { w, h };
      setSize({ w, h });
      persist();
    });
    ro.observe(shellRef.current);
    return () => ro.disconnect();
  }, []); // eslint-disable-line

  return (
    <div
      className="modal-overlay"
      style={{ alignItems: 'flex-start', justifyContent: 'flex-start' }}
      onClick={onClose}
    >
      <div
        ref={shellRef}
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed',
          left: pos.x, top: pos.y,
          width: size.w, height: size.h,
          minWidth: 320, minHeight: 220,
          resize: 'both', overflow: 'hidden',
          borderRadius: 14,
          background: W.windowBg,
          border: `1px solid ${W.border}`,
          boxShadow: '0 20px 60px rgba(42,31,18,0.38), 0 1px 0 rgba(255,255,255,0.65) inset',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {children(startDrag)}
      </div>
    </div>
  );
}

/* ── Shared window chrome title bar ─────────────────────────── */
function ModalChrome({ onDrag, onClose, title, subtitle }) {
  return (
    <div
      onMouseDown={onDrag}
      style={{
        cursor: 'move',
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 16px',
        background: W.chrome,
        borderBottom: `1px solid ${W.border}`,
        flexShrink: 0, userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
        <button
          onClick={onClose}
          style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57', border: '1px solid rgba(0,0,0,0.18)', cursor: 'pointer', padding: 0 }}
        />
        <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e', border: '1px solid rgba(0,0,0,0.18)' }} />
        <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840', border: '1px solid rgba(0,0,0,0.18)' }} />
      </div>

      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#4a3828', letterSpacing: '0.04em', textShadow: '0 1px 0 rgba(255,255,255,0.45)', textTransform: 'uppercase' }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 10, color: W.text3, marginTop: 1 }}>{subtitle}</div>
        )}
      </div>
    </div>
  );
}

/* ── Customer Modal ─────────────────────────────────────────── */
function CustomerModal({ name, phone, onSave, onClose, required = false }) {
  const [n, setN] = useState(name || '');
  const [p, setP] = useState(phone || '');
  const [err, setErr] = useState('');

  function handleSave() {
    if (!n.trim()) { setErr('Customer name is required.'); return; }
    onSave(n.trim(), p.trim());
    onClose();
  }

  return (
    <ModalShell id="customer" defaultWidth={420} defaultHeight={360} onClose={onClose}>
      {(startDrag) => (
        <>
          <ModalChrome
            onDrag={startDrag}
            onClose={onClose}
            title="Customer Details"
            subtitle={required ? 'Required before checkout' : 'Link a customer to this order'}
          />

          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: W.text3, marginBottom: 8 }}>
                Name <span style={{ color: W.red }}>*</span>
              </div>
              <input
                value={n}
                onChange={e => { setN(e.target.value); setErr(''); }}
                onKeyDown={e => e.key === 'Enter' && handleSave()}
                placeholder="Customer name"
                autoFocus
                style={{ width: '100%', padding: '11px 13px', borderRadius: 9, border: `1.5px solid ${err ? W.red : W.borderLight}`, background: 'rgba(255,255,255,0.75)', color: W.text1, fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
              />
              {err && <div style={{ color: W.red, fontSize: 11, marginTop: 4 }}>{err}</div>}
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: W.text3, marginBottom: 8 }}>Phone</div>
              <input
                value={p}
                onChange={e => setP(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSave()}
                placeholder="Phone number (optional)"
                type="tel"
                style={{ width: '100%', padding: '11px 13px', borderRadius: 9, border: `1.5px solid ${W.borderLight}`, background: 'rgba(255,255,255,0.75)', color: W.text1, fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${W.border}`, padding: '12px 20px', display: 'flex', gap: 8, flexShrink: 0, background: 'rgba(255,255,255,0.4)' }}>
            <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 8, border: `1px solid ${W.borderLight}`, background: 'transparent', color: W.text2, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleSave} style={{ flex: 2, padding: '10px', borderRadius: 8, border: 'none', background: n.trim() ? W.orange : 'rgba(0,0,0,0.08)', color: n.trim() ? '#fff' : W.text3, fontSize: 14, fontWeight: 800, cursor: n.trim() ? 'pointer' : 'not-allowed' }}>Save Customer</button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

/* ── Add / Edit Product Modal ────────────────────────────────── */
function AddProductModal({ product, existingItem, onClose, onConfirm }) {
  const [variants, setVariants] = useState([]);
  const [modifiers, setModifiers] = useState([]);
  const [selVariant, setSelVariant] = useState(
    existingItem?.variant_id
      ? { id: existingItem.variant_id, name: existingItem.variant_name, selling_price: existingItem.unit_price }
      : null
  );
  const [selMods, setSelMods] = useState(existingItem?.modifiers ?? []);
  const [qty, setQty] = useState(existingItem?.quantity ?? 1);
  const [notes, setNotes] = useState(existingItem?.notes ?? '');
  const [rateInput, setRateInput] = useState(existingItem ? String(existingItem.unit_price) : '');
  const [rateFocused, setRateFocused] = useState(false);
  const [homePack, setHomePack] = useState(
    !!(existingItem?.is_homepack ?? existingItem?.is_home_pack ?? false)
  );
  const [discAmt, setDiscAmt]   = useState(existingItem?.discount_amount ? String(existingItem.discount_amount) : '');
  const [discType, setDiscType] = useState(existingItem?.discount_type ?? 'PROMO');
  // One product → one image. Always resolve from the product, never the variant.
  const [primaryImage, setPrimaryImage] = useState(product.primary_image ?? null);
  const [loading, setLoading] = useState(true);
  const isEdit = !!existingItem;

  useEffect(() => {
    // If the caller couldn't supply the product image, fetch it by product id
    if (!product.primary_image) {
      fetch(`${API}/food-menu/products/${product.id}`)
        .then(r => r.json())
        .then(p => { if (p?.primary_image) setPrimaryImage(p.primary_image); })
        .catch(() => {});
    }
    Promise.all([
      fetch(`${API}/food-menu/products/${product.id}/variants`).then(r => r.json()),
      fetch(`${API}/food-menu/products/${product.id}/modifiers`).then(r => r.json()),
    ]).then(([v, m]) => {
      setVariants(v);
      setModifiers(m);
      if (isEdit) {
        if (existingItem?.variant_id) {
          const found = v.find(vv => vv.id === existingItem.variant_id);
          if (found) setSelVariant(found);
        } else if (v.length === 1) {
          setSelVariant(v[0]);
        }
      } else {
        if (v.length === 1) {
          setSelVariant(v[0]);
          setRateInput(r => r || String(v[0].selling_price ?? product.pos_price ?? 0));
        }
        setRateInput(r => r || String(product.pos_price ?? 0));
      }
      setLoading(false);
    });
  }, [product.id, isEdit]);

  const handleVariantSelect = (v) => {
    setSelVariant(v);
    setRateInput(String(v.selling_price ?? v.price ?? 0));
  };

  const basePrice = parseFloat(rateInput) || 0;
  const modTotal = selMods.reduce((s, m) => s + (m.price ?? 0), 0);
  const lineGross = (basePrice + modTotal) * qty;
  const discount = Math.min(Math.max(parseFloat(discAmt) || 0, 0), lineGross);
  const lineTotal = lineGross - discount;

  const toggleMod = (mod) =>
    setSelMods(prev => prev.find(m => m.id === mod.id)
      ? prev.filter(m => m.id !== mod.id)
      : [...prev, mod]);

  function handleConfirm() {
    if (!selVariant && variants.length > 1) return;
    const v = selVariant ?? variants[0] ?? null;
    onConfirm({
      product_id: product.id,
      product_name: product.name,
      variant_id: v?.id ?? null,
      variant_name: cleanVariantName(v?.name, product.name),
      unit_price: basePrice,
      quantity: qty,
      modifiers: selMods.map(m => ({ id: m.id, name: m.name, price: m.price ?? 0 })),
      notes: notes.trim() || null,
      is_homepack: homePack,
      image: primaryImage,
      discount_amount: discount,
      discount_type: discount > 0 ? discType : null,
    });
    onClose();
  }

  const optionRow = (selected) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '11px 13px', borderRadius: 9,
    border: `1.5px solid ${selected ? W.orange : W.borderLight}`,
    background: selected ? 'rgba(193,68,14,0.08)' : 'rgba(255,255,255,0.65)',
    cursor: 'pointer', transition: 'all 0.1s', width: '100%',
  });

  return (
    <ModalShell id="add-product" defaultWidth={420} defaultHeight={560} onClose={onClose}>
      {(startDrag) => (
        <>
          <div
            onMouseDown={startDrag}
            style={{
              cursor: 'move',
              display: 'flex', alignItems: 'flex-start', gap: 12,
              padding: '9px 16px',
              background: W.chrome,
              borderBottom: `1px solid ${W.border}`,
              flexShrink: 0, userSelect: 'none',
            }}
          >
            <div style={{ display: 'flex', gap: 5, flexShrink: 0, alignSelf: 'center' }}>
              <button onClick={onClose} style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57', border: '1px solid rgba(0,0,0,0.18)', cursor: 'pointer', padding: 0 }} />
              <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e', border: '1px solid rgba(0,0,0,0.18)' }} />
              <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840', border: '1px solid rgba(0,0,0,0.18)' }} />
            </div>

            {primaryImage
              ? <img src={`/uploads/${primaryImage}`} style={{ height: 52, width: 52, borderRadius: 9, objectFit: 'cover', border: `1px solid ${W.border}`, flexShrink: 0 }} alt="" />
              : <div style={{ height: 52, width: 52, borderRadius: 9, background: 'rgba(255,255,255,0.4)', border: `1px solid ${W.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <ImageIcon style={{ width: 22, height: 22, color: W.text3 }} />
              </div>
            }
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: W.text1, lineHeight: 1.3, textShadow: '0 1px 0 rgba(255,255,255,0.45)' }}>{product.name}</div>
              {product.category_name && <div style={{ fontSize: 10, color: W.text3, marginTop: 1 }}>{product.category_name}</div>}
              <div style={{ fontSize: 14, fontWeight: 800, color: W.orange, marginTop: 4 }}>{fmt(basePrice || product.pos_price)}</div>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
            {loading
              ? <div style={{ textAlign: 'center', color: W.text3, padding: '24px 0' }}>Loading…</div>
              : variants.length > 1 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: W.text3, marginBottom: 9 }}>Select Variant *</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {variants.map(v => (
                      <button key={v.id} onClick={() => handleVariantSelect(v)} style={optionRow(selVariant?.id === v.id)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 15, height: 15, borderRadius: '50%', border: `2px solid ${selVariant?.id === v.id ? W.orange : W.text3}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {selVariant?.id === v.id && <div style={{ width: 7, height: 7, borderRadius: '50%', background: W.orange }} />}
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 600, color: W.text1 }}>{v.name}</span>
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 800, color: W.orange }}>{fmt(v.selling_price ?? v.price)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            }

            {!loading && modifiers.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: W.text3, marginBottom: 9 }}>Add-ons</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {modifiers.map(mod => {
                    const checked = !!selMods.find(m => m.id === mod.id);
                    return (
                      <button key={mod.id} onClick={() => toggleMod(mod)} style={optionRow(checked)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 15, height: 15, borderRadius: 4, border: `2px solid ${checked ? W.orange : W.text3}`, background: checked ? W.orange : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {checked && <span style={{ color: '#fff', fontSize: 9, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 600, color: W.text1 }}>{mod.name}</span>
                        </div>
                        {mod.price > 0 && <span style={{ fontSize: 12, color: W.text2 }}>+{fmt(mod.price)}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: W.text3, marginBottom: 8 }}>Special Instructions</div>
              <textarea
                rows={2}
                placeholder="e.g. Less spicy, No onion…"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                style={{ width: '100%', borderRadius: 9, border: `1px solid ${W.borderLight}`, background: 'rgba(255,255,255,0.75)', color: W.text1, fontSize: 13, padding: '9px 11px', resize: 'none', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            {/* Item Discount */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: W.text3, marginBottom: 8 }}>Discount</div>
              <div style={{ display: 'flex', gap: 5, marginBottom: 8, flexWrap: 'wrap' }}>
                {[['PROMO', 'Promo'], ['COMPLIMENTARY', 'Compl.'], ['EMPLOYEE', 'Employee'], ['MANUAL', 'Manual']].map(([key, label]) => (
                  <button key={key} onClick={() => setDiscType(key)}
                    style={{
                      padding: '5px 10px', borderRadius: 20, fontSize: 10, fontWeight: 800,
                      textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer',
                      border: `1.5px solid ${discType === key ? W.orange : W.borderLight}`,
                      background: discType === key ? 'rgba(193,68,14,0.1)' : 'rgba(255,255,255,0.65)',
                      color: discType === key ? W.orange : W.text2,
                    }}>{label}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="number" min="0" placeholder="0"
                  value={discAmt}
                  onChange={e => setDiscAmt(e.target.value)}
                  onFocus={e => e.target.select()}
                  style={{ width: 90, padding: '7px 9px', borderRadius: 8, border: `1.5px solid ${discount > 0 ? W.orange : W.borderLight}`, background: 'rgba(255,255,255,0.75)', color: discount > 0 ? W.orange : W.text1, fontSize: 14, fontWeight: 800, outline: 'none', textAlign: 'right', boxSizing: 'border-box' }}
                />
                {[10, 20, 50, 100].map(p => (
                  <button key={p} onClick={() => setDiscAmt(String(Math.round(lineGross * p) / 100))}
                    style={{ padding: '6px 8px', borderRadius: 7, fontSize: 10, fontWeight: 800, border: `1px solid ${W.borderLight}`, background: 'rgba(255,255,255,0.65)', color: W.text2, cursor: 'pointer', flexShrink: 0 }}>
                    {p === 100 ? 'FOC' : `${p}%`}
                  </button>
                ))}
                {discount > 0 && (
                  <button onClick={() => setDiscAmt('')}
                    style={{ padding: '6px 8px', borderRadius: 7, fontSize: 10, fontWeight: 800, border: 'none', background: 'none', color: W.red, cursor: 'pointer', flexShrink: 0 }}>✕</button>
                )}
              </div>
              {discount > 0 && (
                <div style={{ fontSize: 11, fontWeight: 700, color: W.green ?? '#2d7a2d', marginTop: 6 }}>
                  −{fmt(discount)} {discType} → line {fmt(lineTotal)}
                </div>
              )}
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${W.border}`, padding: '12px 18px', flexShrink: 0, background: 'rgba(255,255,255,0.4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: W.text3, marginBottom: 5 }}>Rate (₹)</div>
                <input
                  type={rateFocused ? 'number' : 'text'}
                  value={rateFocused ? rateInput : Number(rateInput || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  onChange={e => setRateInput(e.target.value)}
                  onFocus={e => { setRateFocused(true); e.target.select(); }}
                  onBlur={() => setRateFocused(false)}
                  style={{ width: '100%', padding: '9px 11px', borderRadius: 9, border: `1.5px solid ${W.borderLight}`, background: 'rgba(255,255,255,0.75)', color: W.orange, fontSize: 22, fontWeight: 800, outline: 'none', boxSizing: 'border-box', textAlign: 'right' }}
                />
              </div>
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: W.text3, marginBottom: 5 }}>Qty</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <button onClick={() => setQty(q => Math.max(1, q - 1))} style={{ width: 34, height: 34, borderRadius: '50%', background: W.orange, border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Minus style={{ width: 15, height: 15 }} />
                  </button>
                  <span style={{ fontSize: 18, fontWeight: 900, color: W.text1, minWidth: 26, textAlign: 'center' }}>{qty}</span>
                  <button onClick={() => setQty(q => q + 1)} style={{ width: 34, height: 34, borderRadius: '50%', background: W.orange, border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Plus style={{ width: 15, height: 15 }} />
                  </button>
                </div>
              </div>
            </div>

            {/* Take Out / Pack toggle */}
            <button
              onClick={() => setHomePack(h => !h)}
              style={{
                width: '100%', padding: '11px 13px', borderRadius: 9, marginBottom: 10,
                display: 'flex', alignItems: 'center', gap: 10,
                border: `1.5px solid ${homePack ? W.orange : W.borderLight}`,
                background: homePack ? 'rgba(193,68,14,0.08)' : 'rgba(255,255,255,0.65)',
                cursor: 'pointer', transition: 'all 0.1s',
              }}
            >
              <div style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${homePack ? W.orange : W.text3}`, background: homePack ? W.orange : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {homePack && <span style={{ color: '#fff', fontSize: 11, fontWeight: 900, lineHeight: 1 }}>✓</span>}
              </div>
              <span style={{ fontSize: 13, fontWeight: 800, color: homePack ? W.orange : W.text1, textTransform: 'uppercase', letterSpacing: '0.04em' }}>📦 Take Out / Pack</span>
            </button>

            {isEdit && (
              <button onClick={() => { onConfirm(null); onClose(); }}
                style={{ width: '100%', padding: '10px', borderRadius: 8, border: `1px solid rgba(192,57,43,0.4)`, background: 'rgba(192,57,43,0.06)', color: W.red, fontSize: 12, fontWeight: 700, cursor: 'pointer', marginBottom: 8 }}>
                Remove Item
              </button>
            )}
            <button
              disabled={loading || (!selVariant && variants.length > 1)}
              onClick={handleConfirm}
              style={{
                width: '100%', padding: '13px', borderRadius: 9, border: 'none',
                background: loading || (!selVariant && variants.length > 1) ? 'rgba(0,0,0,0.08)' : W.orange,
                color: loading || (!selVariant && variants.length > 1) ? W.text3 : '#fff',
                fontSize: 14, fontWeight: 800,
                cursor: loading || (!selVariant && variants.length > 1) ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {isEdit ? 'Update Item' : 'Add to Order'}
              {' — '}{fmt(lineTotal)}
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

/* ── Remove Sent Item — classify mistake / return / waste ─────── */
function RemoveItemModal({ item, onConfirm, onClose }) {
  const [kind, setKind] = useState('CANCEL');
  const [reason, setReason] = useState('');
  const KINDS = [
    { key: 'CANCEL', icon: '✏️', label: 'Mistake / not needed', hint: 'Wrong punch or changed before preparation' },
    { key: 'RETURN', icon: '↩️', label: 'Returned by customer', hint: 'Prepared & served, then sent back' },
    { key: 'WASTE',  icon: '🗑️', label: 'Kitchen waste',        hint: 'Preparation flaw, dropped, unusable' },
  ];
  const needReason = kind !== 'CANCEL';
  const canConfirm = !needReason || reason.trim();

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,10,0.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ width: 380, borderRadius: 12, background: W.windowBg, border: `1px solid ${W.border}`, boxShadow: '0 18px 60px rgba(40,25,10,0.4)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '11px 16px', background: W.chrome, borderBottom: `1px solid ${W.border}` }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: W.text1 }}>Remove “{item.product_name}”?</div>
          <div style={{ fontSize: 10, color: W.text3, marginTop: 2 }}>Qty {item.quantity} · {fmt(item.unit_price * item.quantity - (item.discount_amount || 0))} · status {item.status}</div>
        </div>
        <div style={{ padding: '13px 16px', display: 'flex', flexDirection: 'column', gap: 7 }}>
          {KINDS.map(k => (
            <button key={k.key} onClick={() => setKind(k.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                padding: '10px 12px', borderRadius: 9, cursor: 'pointer', transition: 'all 0.1s',
                border: `1.5px solid ${kind === k.key ? W.orange : W.borderLight}`,
                background: kind === k.key ? 'rgba(193,68,14,0.08)' : 'rgba(255,255,255,0.65)',
              }}>
              <span style={{ fontSize: 17, flexShrink: 0 }}>{k.icon}</span>
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 800, color: W.text1 }}>{k.label}</span>
                <span style={{ display: 'block', fontSize: 10, color: W.text3 }}>{k.hint}</span>
              </span>
            </button>
          ))}
          <input
            type="text"
            placeholder={needReason ? 'Reason (required)…' : 'Reason (optional)…'}
            value={reason}
            onChange={e => setReason(e.target.value)}
            style={{ width: '100%', marginTop: 3, borderRadius: 8, border: `1px solid ${needReason && !reason.trim() ? W.red : W.borderLight}`, background: 'rgba(255,255,255,0.75)', color: W.text1, fontSize: 12, padding: '9px 11px', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, padding: '11px 16px', borderTop: `1px solid ${W.border}`, background: 'rgba(255,255,255,0.4)' }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: '10px', borderRadius: 8, border: `1px solid ${W.border}`, background: 'transparent', color: W.text2, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            Keep Item
          </button>
          <button disabled={!canConfirm} onClick={() => onConfirm(kind, reason.trim() || null)}
            style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: canConfirm ? W.red : 'rgba(192,57,43,0.25)', color: '#fff', fontSize: 12, fontWeight: 800, cursor: canConfirm ? 'pointer' : 'not-allowed' }}>
            Remove Item
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Product Card ────────────────────────────────────────────── */
function productPriceDisplay(product) {
  const count = product.variant_count ?? 0;
  if (count === 1) return fmt(product.min_price ?? product.pos_price ?? 0);
  if (count > 1) {
    const lo = product.min_price ?? 0;
    const hi = product.max_price ?? lo;
    return lo === hi ? fmt(lo) : `${fmt(lo)} – ${fmt(hi)}`;
  }
  return fmt(product.pos_price ?? 0);
}

function ProductCard({ product, cartQty, onClick }) {
  return (
    <button
      onClick={() => onClick(product)}
      style={{
        position: 'relative',
        display: 'flex', flexDirection: 'column',
        textAlign: 'left',
        borderRadius: 10,
        background: cartQty > 0 ? 'rgba(193,68,14,0.07)' : 'rgba(255,255,255,0.65)',
        border: cartQty > 0 ? `2px solid ${W.orange}` : `1px solid ${W.borderLight}`,
        overflow: 'hidden',
        cursor: 'pointer',
        boxShadow: cartQty > 0 ? `0 3px 12px rgba(193,68,14,0.18)` : '0 1px 4px rgba(80,50,20,0.09)',
        transition: 'all 0.15s',
      }}
      className="active:scale-95"
      onMouseEnter={e => {
        if (cartQty === 0) {
          e.currentTarget.style.background = 'rgba(255,255,255,0.92)';
          e.currentTarget.style.boxShadow = '0 4px 16px rgba(80,50,20,0.16)';
        }
      }}
      onMouseLeave={e => {
        if (cartQty === 0) {
          e.currentTarget.style.background = 'rgba(255,255,255,0.65)';
          e.currentTarget.style.boxShadow = '0 1px 4px rgba(80,50,20,0.09)';
        }
      }}
    >
      {cartQty > 0 && (
        <div style={{
          position: 'absolute', top: 7, right: 7, zIndex: 10,
          height: 22, minWidth: 22, borderRadius: '50%',
          background: W.orange, color: '#fff',
          fontSize: 11, fontWeight: 800,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 5px',
          boxShadow: '0 2px 6px rgba(193,68,14,0.35)',
        }}>
          {cartQty}
        </div>
      )}
      <div style={{ position: 'relative', width: '100%', background: 'rgba(0,0,0,0.04)', overflow: 'hidden', aspectRatio: '1/1' }}>
        {product.primary_image
          ? <img src={`/uploads/${product.primary_image}`} style={{ height: '100%', width: '100%', objectFit: 'cover', display: 'block' }} alt={product.name} />
          : <div style={{ height: '100%', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ImageIcon style={{ height: 36, width: 36, color: W.text3, opacity: 0.5 }} />
          </div>
        }
      </div>
      <div style={{ padding: '8px 9px 10px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <p style={{ fontSize: 13, fontWeight: 800, color: W.orange, marginTop: 0, marginBottom: 3 }}>{productPriceDisplay(product)}</p>
        <p style={{ fontSize: 12, fontWeight: 600, color: W.text1, lineHeight: 1.25, margin: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{product.name}</p>
      </div>
    </button>
  );
}

/* ── Sent KOT Item Row ───────────────────────────────────────── */
function KotItemRow({ item, onQtyChange, onCancel, onNotesChange, onEdit, onHomePack }) {
  const [hovered, setHovered] = useState(false);
  // Packing is editable only while the item is unserved
  const packLocked = item.status === 'SERVED' || item.status === 'CANCELLED';
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '7px 6px',
        borderBottom: `1px solid ${W.borderLight}`,
        borderRadius: 6,
        background: hovered ? 'rgba(193,68,14,0.05)' : 'transparent',
        transition: 'background 0.1s',
        margin: '0 -6px',
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: 5 }}
        onDoubleClick={onEdit}
        title="Double-click to edit"
      >
        <p style={{
          flex: 1, minWidth: 0, margin: 0,
          fontSize: 12, fontWeight: 800, color: W.text1,
          textTransform: 'uppercase', letterSpacing: '0.02em', lineHeight: 1.2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{item.product_name}</p>
        {item.discount_amount > 0 && (
          <span style={{ fontSize: 9, fontWeight: 800, color: '#2d7a2d', background: 'rgba(45,122,45,0.12)', padding: '2px 6px', borderRadius: 20, flexShrink: 0 }}>
            −{fmt(item.discount_amount)} {item.discount_type ?? ''}
          </span>
        )}
        <span style={{ fontSize: 12, fontWeight: 700, color: W.text2, flexShrink: 0 }}>{fmt(item.unit_price * item.quantity - (item.discount_amount || 0))}</span>
        <button
          onClick={e => { e.stopPropagation(); onCancel(); }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: W.text3, padding: 2, display: 'flex', alignItems: 'center', flexShrink: 0 }}
        >
          <Trash2 style={{ height: 13, width: 13 }} />
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
        <span style={{
          fontSize: 9, fontWeight: 800,
          textTransform: 'uppercase', letterSpacing: '0.06em',
          padding: '2px 6px', borderRadius: 20, flexShrink: 0,
          color: STATUS_COLOR[item.status] ?? W.text3,
          background: (STATUS_COLOR[item.status] ?? W.text3) + '22',
        }}>{item.status}</span>
        <button onClick={() => onQtyChange(-1)} style={{ height: 24, width: 24, borderRadius: '50%', background: W.orange, border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
          <Minus style={{ height: 10, width: 10 }} />
        </button>
        <span style={{ fontSize: 12, fontWeight: 700, color: W.text1, width: 16, textAlign: 'center' }}>{item.quantity}</span>
        <button onClick={() => onQtyChange(+1)} style={{ height: 24, width: 24, borderRadius: '50%', background: W.orange, border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
          <Plus style={{ height: 10, width: 10 }} />
        </button>
        <span style={{ fontSize: 10, color: W.text3 }}>{fmt(item.unit_price)} each</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: packLocked ? 'not-allowed' : 'pointer', flexShrink: 0, opacity: packLocked ? 0.5 : 1 }}
          title={packLocked ? 'Served — packing locked' : 'Mark for takeout / packing'}
          onClick={e => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={!!(item.is_home_pack)}
            disabled={packLocked}
            onChange={e => onHomePack?.(e.target.checked)}
            style={{ width: 12, height: 12, accentColor: W.orange, cursor: packLocked ? 'not-allowed' : 'pointer' }}
          />
          <span style={{ fontSize: 9, fontWeight: 800, color: item.is_home_pack ? W.orange : W.text3, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap', transition: 'color 0.1s' }}>Pack</span>
        </label>
        <input
          type="text"
          placeholder="Add note…"
          value={item.notes ?? ''}
          onChange={e => onNotesChange(e.target.value)}
          onClick={e => e.stopPropagation()}
          style={{ flex: 1, fontSize: 11, color: W.text2, background: 'rgba(255,255,255,0.55)', border: `1px solid ${W.borderLight}`, borderRadius: 6, padding: '4px 8px', outline: 'none', boxSizing: 'border-box' }}
        />
      </div>
    </div>
  );
}

/* ── Cart Line ────────────────────────────────────────────────── */
function CartLine({ item, onQty, onRemove, onNotesChange, onDoubleClick, onHomePack }) {
  const [hovered, setHovered] = useState(false);
  const addonTotal = (item.modifiers ?? []).reduce((s, m) => s + (m.price ?? 0), 0);
  const unitWithAddons = item.unit_price + addonTotal;
  const label = [
    item.product_name,
    item.variant_name ? `(${item.variant_name})` : null,
    item.modifiers?.length > 0 ? `+ ${item.modifiers.map(m => m.name).join(', ')}` : null,
  ].filter(Boolean).join(' ');

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '7px 6px',
        borderBottom: `1px solid ${W.borderLight}`,
        borderRadius: 6,
        background: hovered ? 'rgba(193,68,14,0.05)' : 'transparent',
        transition: 'background 0.1s',
        margin: '0 -6px',
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: 5 }}
        onDoubleClick={onDoubleClick}
        title="Double-click to edit"
      >
        <p style={{
          flex: 1, minWidth: 0, margin: 0,
          fontSize: 12, fontWeight: 800, color: W.text1,
          textTransform: 'uppercase', letterSpacing: '0.02em', lineHeight: 1.2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{label}</p>
        {item.discount_amount > 0 && (
          <span style={{ fontSize: 9, fontWeight: 800, color: '#2d7a2d', background: 'rgba(45,122,45,0.12)', padding: '2px 6px', borderRadius: 20, flexShrink: 0 }}>
            −{fmt(item.discount_amount)} {item.discount_type ?? ''}
          </span>
        )}
        <span style={{ fontSize: 12, fontWeight: 700, color: W.text2, flexShrink: 0 }}>{fmt(unitWithAddons * item.quantity - (item.discount_amount || 0))}</span>
        <button
          onClick={e => { e.stopPropagation(); onRemove(item._id); }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: W.text3, padding: 2, display: 'flex', alignItems: 'center', flexShrink: 0 }}
        >
          <Trash2 style={{ height: 13, width: 13 }} />
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
        <span style={{
          fontSize: 9, fontWeight: 800,
          textTransform: 'uppercase', letterSpacing: '0.06em',
          padding: '2px 6px', borderRadius: 20, flexShrink: 0,
          color: W.orange,
          background: W.orange + '22',
        }}>New</span>
        <button onClick={() => onQty(item._id, -1)} style={{ height: 24, width: 24, borderRadius: '50%', background: W.orange, border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
          <Minus style={{ height: 10, width: 10 }} />
        </button>
        <span style={{ fontSize: 12, fontWeight: 700, color: W.text1, width: 16, textAlign: 'center' }}>{item.quantity}</span>
        <button onClick={() => onQty(item._id, +1)} style={{ height: 24, width: 24, borderRadius: '50%', background: W.orange, border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
          <Plus style={{ height: 10, width: 10 }} />
        </button>
        <span style={{ fontSize: 10, color: W.text3 }}>{fmt(unitWithAddons)} each</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={!!(item.is_homepack)}
            onChange={e => onHomePack?.(e.target.checked)}
            style={{ width: 12, height: 12, accentColor: W.orange, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 9, fontWeight: 800, color: item.is_homepack ? W.orange : W.text3, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap', transition: 'color 0.1s' }}>Pack</span>
        </label>
        <input
          type="text"
          placeholder="Add note…"
          value={item.notes ?? ''}
          onChange={e => onNotesChange(item._id, e.target.value)}
          onClick={e => e.stopPropagation()}
          style={{ flex: 1, fontSize: 11, color: W.text2, background: 'rgba(255,255,255,0.55)', border: `1px solid ${W.borderLight}`, borderRadius: 6, padding: '4px 8px', outline: 'none', boxSizing: 'border-box' }}
        />
      </div>
    </div>
  );
}

/* ── Panel Resize Divider ────────────────────────────────────── */
function PanelDivider({ onMouseDown }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: DIVIDER_W,
        flexShrink: 0,
        cursor: 'col-resize',
        background: hov ? W.orange : W.border,
        position: 'relative',
        transition: 'background 0.15s',
        zIndex: 5,
        userSelect: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, pointerEvents: 'none' }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{ width: 2, height: 2, borderRadius: '50%', background: hov ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)' }} />
        ))}
      </div>
    </div>
  );
}

/* ── Panel Context Menu ──────────────────────────────────────── */
function PanelContextMenu({ x, y, isFirst, isLast, onReset, onSave, onMoveLeft, onMoveRight, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  // Nudge menu back onto screen if it overflows
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) el.style.left = `${x - rect.width}px`;
    if (rect.bottom > window.innerHeight) el.style.top = `${y - rect.height}px`;
  }, [x, y]);

  const item = (label, onClick, disabled = false) => (
    <button
      key={label}
      disabled={disabled}
      onClick={() => { if (!disabled) { onClick(); onClose(); } }}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '7px 14px', border: 'none', background: 'none',
        fontSize: 12, fontWeight: 600,
        color: disabled ? W.text3 : W.text1,
        cursor: disabled ? 'default' : 'pointer',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'rgba(193,68,14,0.09)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
    >
      {label}
    </button>
  );

  return (
    <div
      ref={ref}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed', left: x, top: y, zIndex: 9999,
        background: W.windowBg,
        border: `1px solid ${W.border}`,
        borderRadius: 8,
        boxShadow: '0 8px 32px rgba(42,31,18,0.22), 0 1px 0 rgba(255,255,255,0.6) inset',
        minWidth: 200,
        overflow: 'hidden',
        padding: '4px 0',
        userSelect: 'none',
      }}
    >
      {item('↺  Reset to Default Size', onReset)}
      {item('✓  Save Current Layout', onSave)}
      <div style={{ height: 1, background: W.borderLight, margin: '3px 10px' }} />
      {item('←  Move Left', onMoveLeft, isFirst)}
      {item('→  Move Right', onMoveRight, isLast)}
    </div>
  );
}

/* ── Main Component ────────────────────────────────────────────── */
export default function POS() {
  const location = useLocation();
  const navigate = useNavigate();
  const initState = location.state ?? {};

  const existingOrderId = initState.existingOrderId ?? null;
  const [liveOrderId, setLiveOrderId] = useState(existingOrderId);

  const liveOrderIdRef = useRef(liveOrderId);
  const isCheckingOutRef = useRef(false);
  useEffect(() => { liveOrderIdRef.current = liveOrderId; }, [liveOrderId]);

  const [editableItems, setEditableItems] = useState(
    (initState.existingItems ?? []).filter(i => i.status !== 'CANCELLED')
  );
  const [existingDirty, setExistingDirty] = useState(false);
  const committedItems = useRef((initState.existingItems ?? []).filter(i => i.status !== 'CANCELLED'));

  const _initCart = (initState.draftItems ?? []).map(i => ({ ...i, _id: newId() }));

  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [activeCat, setActiveCat] = useState(() => {
    try {
      const saved = localStorage.getItem('pos_activeCat');
      if (!saved || saved === ALL_CAT) return ALL_CAT;
      const num = Number(saved);
      return isNaN(num) ? ALL_CAT : num;
    } catch { return ALL_CAT; }
  });
  const [search, setSearch] = useState('');
  const [orderType, setOrderType] = useState(initState.orderType ?? 'DINE_IN');
  const [tables, setTables] = useState([]);
  const [activeTable, setActiveTable] = useState(initState.tableId ? String(initState.tableId) : '');
  const [customerName, setCustomerName] = useState(initState.customerName ?? '');
  const [customerPhone, setCustomerPhone] = useState(initState.customerPhone ?? '');
  const [customerAddress, setCustomerAddress] = useState(initState.customerAddress ?? '');
  const [cart, setCart] = useState(_initCart);
  const [productModal, setProductModal] = useState(null);
  const [custModal, setCustModal] = useState(false);
  const [checkoutModal, setCheckoutModal] = useState(false);
  const [showSalesReport, setShowSalesReport] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const searchRef = useRef(null);
  const socketRef = useRef(null);

  /* ── Panel layout state ─────────────────────────────────────── */
  const containerRef = useRef(null);
  const [panelOrder, setPanelOrder] = useState(() => loadLayout()?.order ?? [...DEFAULT_ORDER]);
  const [panelWidths, setPanelWidths] = useState(() => loadLayout()?.widths ?? { ...DEFAULT_WIDTHS });
  const [ctxMenu, setCtxMenu] = useState(null);
  const resizingRef = useRef(null);

  /* ── Init products panel width from container ───────────────── */
  useLayoutEffect(() => {
    if (!loadLayout()?.widths?.products && containerRef.current) {
      const total = containerRef.current.offsetWidth;
      const w = Math.max(MIN_WIDTHS.products, total - DEFAULT_WIDTHS.kot - DEFAULT_WIDTHS.cat - DIVIDER_W * 2);
      setPanelWidths(prev => ({ ...prev, products: w }));
    }
  }, []); // eslint-disable-line

  /* ── Global resize mouse events ─────────────────────────────── */
  useEffect(() => {
    const onMove = (e) => {
      if (!resizingRef.current) return;
      const { leftId, rightId, startX, startWidths } = resizingRef.current;
      const delta = e.clientX - startX;
      const newLeft = Math.max(MIN_WIDTHS[leftId], startWidths[leftId] + delta);
      const actualDelta = newLeft - startWidths[leftId];
      const newRight = Math.max(MIN_WIDTHS[rightId], startWidths[rightId] - actualDelta);
      setPanelWidths(prev => ({ ...prev, [leftId]: newLeft, [rightId]: newRight }));
    };
    const onUp = () => { resizingRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []); // eslint-disable-line

  /* ── Panel layout handlers ───────────────────────────────────── */
  const savePanelLayout = useCallback(() => {
    try {
      localStorage.setItem(PANEL_LAYOUT_KEY, JSON.stringify({ order: panelOrder, widths: panelWidths }));
    } catch {}
  }, [panelOrder, panelWidths]);

  const resetPanelLayout = useCallback(() => {
    const total = containerRef.current?.offsetWidth ?? window.innerWidth;
    const productsW = Math.max(MIN_WIDTHS.products, total - DEFAULT_WIDTHS.kot - DEFAULT_WIDTHS.cat - DIVIDER_W * 2);
    setPanelOrder([...DEFAULT_ORDER]);
    setPanelWidths({ ...DEFAULT_WIDTHS, products: productsW });
    try { localStorage.removeItem(PANEL_LAYOUT_KEY); } catch {}
    setCtxMenu(null);
  }, []);

  const movePanelLeft = useCallback((panelId) => {
    setPanelOrder(prev => {
      const idx = prev.indexOf(panelId);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
    setCtxMenu(null);
  }, []);

  const movePanelRight = useCallback((panelId) => {
    setPanelOrder(prev => {
      const idx = prev.indexOf(panelId);
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
    setCtxMenu(null);
  }, []);

  /* ── Socket.IO ──────────────────────────────────────────── */
  useEffect(() => {
    const token = sessionStorage.getItem('mtc_session') || 'dev-session';
    const socket = createSocket({ role: 'pos', token });
    socketRef.current = socket;

    socket.on('item-served', ({ kotId, itemId, status, served_at }) => {
      setEditableItems(prev => prev.map(i =>
        i.id === itemId ? { ...i, status, served_at: served_at ?? i.served_at } : i
      ));
    });

    socket.on('order-cancelled', ({ orderId }) => {
      const mine = liveOrderIdRef.current ?? existingOrderId;
      if (mine && mine === orderId) navigate('/pos');
    });

    socket.on('order-completed', ({ orderId }) => {
      if (isCheckingOutRef.current) return;
      const mine = liveOrderIdRef.current ?? existingOrderId;
      if (mine && mine === orderId) navigate('/pos');
    });

    return () => { socket.disconnect(); };
  }, []); // eslint-disable-line

  /* ── Keyboard shortcuts ─────────────────────────────────── */
  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape') {
        if (productModal) { setProductModal(null); return; }
        if (custModal) { setCustModal(false); return; }
        if (checkoutModal) { setCheckoutModal(false); return; }
        if (ctxMenu) { setCtxMenu(null); return; }
        navigate('/pos');
        return;
      }
      if (e.key === 'F8' && !productModal && !custModal && !checkoutModal) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        setShowSalesReport(prev => !prev);
        return;
      }
      if (e.key === 'F2' && !productModal && !custModal && !checkoutModal) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [navigate, productModal, custModal, checkoutModal, ctxMenu]);

  /* ── Load categories + tables ───────────────────────────── */
  useEffect(() => {
    Promise.all([
      fetch(`${API}/food-menu/categories`).then(r => r.json()),
      fetch(`${API}/pos/tables`, { headers: H }).then(r => r.json()),
    ]).then(([cats, tbls]) => { setCategories(cats); setTables(tbls); });
  }, []);

  /* ── Persist active category selection ───────────────────── */
  useEffect(() => {
    try { localStorage.setItem('pos_activeCat', activeCat); } catch { /* best-effort */ }
  }, [activeCat]);

  /* ── Load products ──────────────────────────────────────── */
  useEffect(() => {
    setLoading(true);
    const url = activeCat === ALL_CAT
      ? `${API}/food-menu/products`
      : `${API}/food-menu/products?categoryId=${activeCat}`;
    fetch(url)
      .then(r => r.json())
      .then(rows => setProducts(rows.filter(p => p.pos_active)))
      .finally(() => setLoading(false));
  }, [activeCat]);

  /* ── Deep search ────────────────────────────────────────── */
  const filtered = search
    ? products.filter(p => {
      const q = search.toLowerCase();
      return p.name.toLowerCase().includes(q) ||
        (p.variant_names || '').toLowerCase().includes(q);
    })
    : products;

  const qtyByProduct = [...editableItems, ...cart].reduce((acc, i) => {
    if (i.status === 'CANCELLED') return acc;
    acc[i.product_id] = (acc[i.product_id] ?? 0) + i.quantity; return acc;
  }, {});

  /* ── Cart mutations ─────────────────────────────────────── */
  const addToCart = useCallback((item) => setCart(prev => {
    const modKey = (mods) => (mods ?? []).map(m => m.id).sort().join(',');
    // Discounted lines never merge — the absolute discount is line-specific
    const idx = prev.findIndex(i =>
      i.product_id === item.product_id &&
      (i.variant_id ?? null) === (item.variant_id ?? null) &&
      modKey(i.modifiers) === modKey(item.modifiers) &&
      !(i.discount_amount > 0) && !(item.discount_amount > 0)
    );
    if (idx !== -1) {
      return prev.map((i, n) => n === idx ? { ...i, quantity: i.quantity + (item.quantity ?? 1) } : i);
    }
    // New items go to the top of the cart
    return [{ is_homepack: false, ...item, _id: newId() }, ...prev];
  }), []);

  const changeQty = useCallback((_id, d) => setCart(prev => {
    const next = prev.map(i => i._id === _id ? { ...i, quantity: i.quantity + d } : i);
    return next.filter(i => i.quantity > 0);
  }), []);
  const removeItem = useCallback((_id) => setCart(prev => prev.filter(i => i._id !== _id)), []);
  const changeNotes = useCallback((_id, notes) => setCart(prev => prev.map(i => i._id === _id ? { ...i, notes: notes || null } : i)), []);
  const updateCartItem = useCallback((_id, data) => {
    if (!data) { setCart(prev => prev.filter(i => i._id !== _id)); return; }
    setCart(prev => prev.map(i => i._id === _id ? { ...i, ...data, _id } : i));
  }, []);

  const pendingCancels = useRef([]);
  const [removePrompt, setRemovePrompt] = useState(null); // sent item awaiting mistake/return/waste classification

  const doCancelExisting = useCallback((item, kind = 'CANCEL', reason = null) => {
    if (!canEdit(item.status)) return;
    setExistingDirty(true);
    setEditableItems(prev => prev.filter(i => i.id !== item.id));
    pendingCancels.current.push({ kot_id: item.kot_id, id: item.id, kind, reason });
  }, []);

  // Removing a sent item always asks: mistake, return or waste?
  const cancelExistingItem = useCallback((item) => {
    if (!canEdit(item.status)) return;
    setRemovePrompt(item);
  }, []);

  const changeExistingQty = useCallback((item, delta) => {
    if (!canEdit(item.status)) return;
    const next = item.quantity + delta;
    if (next <= 0) { cancelExistingItem(item); return; }
    setExistingDirty(true);
    setEditableItems(prev => prev.map(i => i.id === item.id ? { ...i, quantity: next } : i));
  }, [cancelExistingItem]);

  const updateExistingNotes = useCallback((item, notes) => {
    setExistingDirty(true);
    setEditableItems(prev => prev.map(i => i.id === item.id ? { ...i, notes: notes || null } : i));
  }, []);

  const updateExistingHomePack = useCallback((item, val) => {
    setExistingDirty(true);
    setEditableItems(prev => prev.map(i => i.id === item.id ? { ...i, is_home_pack: val ? 1 : 0 } : i));
  }, []);

  /* ── Totals ─────────────────────────────────────────────── */
  const itemTotal = (i) => (i.unit_price + (i.modifiers ?? []).reduce((s, m) => s + (m.price ?? 0), 0)) * i.quantity - (i.discount_amount || 0);
  const existingTotal = editableItems.filter(i => i.status !== 'CANCELLED').reduce((s, i) => s + i.unit_price * i.quantity - (i.discount_amount || 0), 0);
  const newItemsTotal = cart.reduce((s, i) => s + itemTotal(i), 0);
  const grandTotal = existingTotal + newItemsTotal;

  const tableName = initState.tableName ?? tables.find(t => String(t.id) === String(activeTable))?.name ?? null;
  const orderLabel = orderType === 'DINE_IN' ? (tableName ?? 'Dine In') : ORDER_TYPES.find(t => t.key === orderType)?.label ?? orderType;
  const todayStr = nepalNowFull();

  /* ── Product click ──────────────────────────────────────── */
  async function handleProductClick(product) {
    if ((product.variant_count ?? 1) > 1) { setProductModal({ product }); return; }
    const [variants, mods] = await Promise.all([
      fetch(`${API}/food-menu/products/${product.id}/variants`).then(r => r.json()),
      fetch(`${API}/food-menu/products/${product.id}/modifiers`).then(r => r.json()),
    ]);
    if (mods.length > 0 || variants.length > 1) { setProductModal({ product }); return; }
    addToCart({
      product_id: product.id, product_name: product.name,
      variant_id: variants[0]?.id ?? null,
      variant_name: cleanVariantName(variants[0]?.name, product.name),
      unit_price: variants[0]?.selling_price ?? product.pos_price ?? 0,
      quantity: 1, modifiers: [], notes: null, image: product.primary_image,
    });
  }

  function handleCartItemClick(item) {
    const prod = products.find(p => p.id === item.product_id);
    setProductModal({
      product: {
        id: item.product_id, name: item.product_name,
        pos_price: item.unit_price,
        primary_image: prod?.primary_image ?? item.image ?? null,
        category_name: prod?.category_name ?? null,
      },
      existingItem: item,
    });
  }

  async function handleExistingItemEdit(item) {
    let prod = products.find(p => p.id === item.product_id);
    if (!prod) {
      try { prod = await fetch(`${API}/food-menu/products/${item.product_id}`).then(r => r.json()); }
      catch { prod = null; }
    }
    // Use the CLEAN base product name — never the KOT's decorated "Name (Variant)" string,
    // or the variant suffix compounds on every edit→send cycle.
    const baseName = prod?.name ?? item.product_name;
    setProductModal({
      product: {
        id: item.product_id, name: baseName,
        pos_price: item.unit_price,
        primary_image: prod?.primary_image ?? null,
        category_name: prod?.category_name ?? null,
      },
      existingItem: {
        variant_id: item.variant_id ?? null,
        variant_name: item.variant_name ?? null,
        unit_price: item.unit_price, quantity: item.quantity,
        notes: item.notes, modifiers: item.modifiers ?? [],
        is_home_pack: item.is_home_pack ?? 0,
        discount_amount: item.discount_amount ?? 0,
        discount_type: item.discount_type ?? null,
        _id: null,
      },
      existingKotItem: item,
    });
  }

  function buildKotItems() {
    return cart.map(i => ({
      product_id: i.product_id,
      variant_id: i.variant_id ?? null,
      product_name: i.product_name
        + (i.variant_name ? ` (${i.variant_name})` : '')
        + (i.modifiers?.length ? ` + ${i.modifiers.map(m => m.name).join(', ')}` : ''),
      quantity: i.quantity,
      unit_price: i.unit_price + (i.modifiers ?? []).reduce((s, m) => s + (m.price ?? 0), 0),
      notes: i.notes,
      is_home_pack: i.is_homepack ? 1 : 0,
      prep_time_minutes: 10,
      discount_amount: i.discount_amount || 0,
      discount_type: i.discount_amount > 0 ? (i.discount_type ?? 'MANUAL') : null,
    }));
  }

  async function refreshOrderItems(orderId) {
    try {
      const data = await fetch(`${API}/pos/orders/active`, { headers: H }).then(r => r.json());
      const kots = (data.kots ?? []).filter(k => k.order_id === orderId);
      const items = kots.flatMap(k => (k.items ?? []).filter(i => i.status !== 'CANCELLED'));
      setEditableItems(items);
      committedItems.current = items;
    } catch { /* best-effort */ }
  }

  async function ensureOrder(status = 'OPEN') {
    if (liveOrderId) return liveOrderId;
    const order = await fetch(`${API}/pos/orders`, {
      method: 'POST', headers: H,
      body: JSON.stringify({
        order_type: orderType,
        table_id: orderType === 'DINE_IN' ? (activeTable || null) : null,
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
        customer_address: customerAddress || null,
        status,
      }),
    }).then(r => r.json());
    setLiveOrderId(order.id);
    return order.id;
  }

  async function handleSaveAndSend() {
    if (!cart.length && !existingDirty) { navigate('/pos'); return; }
    setSaving(true);
    try {
      await Promise.all(
        pendingCancels.current.map(({ kot_id, id, kind, reason }) =>
          fetch(`${API}/pos/kots/${kot_id}/items/${id}/status`, {
            method: 'PATCH', headers: H,
            body: JSON.stringify({ status: 'CANCELLED', cancel_kind: kind ?? 'CANCEL', cancel_reason: reason ?? null }),
          })
        )
      );
      pendingCancels.current = [];

      await Promise.all(
        editableItems.map(item => {
          const orig = committedItems.current.find(i => i.id === item.id);
          if (!orig) return Promise.resolve();
          const qtyChanged = orig.quantity !== item.quantity;
          const notesChanged = (orig.notes ?? '') !== (item.notes ?? '');
          const packChanged = (orig.is_home_pack ?? 0) !== (item.is_home_pack ?? 0);
          if (!qtyChanged && !notesChanged && !packChanged) return Promise.resolve();
          return fetch(`${API}/pos/kots/${item.kot_id}/items/${item.id}`, {
            method: 'PATCH', headers: H,
            body: JSON.stringify({
              ...(qtyChanged ? { quantity: item.quantity } : {}),
              ...(notesChanged ? { notes: item.notes } : {}),
              ...(packChanged ? { is_home_pack: item.is_home_pack ? 1 : 0 } : {}),
            }),
          });
        })
      );

      let sentOrderId = liveOrderId;
      if (cart.length) {
        sentOrderId = await ensureOrder('OPEN');
        await fetch(`${API}/pos/kots`, {
          method: 'POST', headers: H,
          body: JSON.stringify({ order_id: sentOrderId, items: buildKotItems() }),
        });
      }

      setCart([]);
      setExistingDirty(false);
      if (sentOrderId) await refreshOrderItems(sentOrderId);
      setSaving(false);
    } catch (e) { console.error(e); setSaving(false); }
  }

  async function handleSaveAsDraft() {
    if (!cart.length) { navigate('/pos'); return; }
    setSaving(true);
    try {
      const orderId = await ensureOrder('SAVED');
      await fetch(`${API}/pos/kots`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ order_id: orderId, items: buildKotItems() }),
      });
      setCart([]);
      await refreshOrderItems(orderId);
      setSaving(false);
    } catch (e) { console.error(e); setSaving(false); }
  }

  function handleCheckout() { isCheckingOutRef.current = true; setCheckoutModal(true); }

  function handlePrint() {
    const allItems = [
      ...editableItems.filter(i => i.status !== 'CANCELLED'),
      ...cart.map(i => ({
        product_name: i.product_name + (i.variant_name ? ` (${i.variant_name})` : ''),
        quantity: i.quantity,
        unit_price: i.unit_price,
        notes: i.notes,
      })),
    ];
    if (!allItems.length) return;
    printReceipt({
      order: {
        id: liveOrderId ?? '—',
        order_type: orderType,
        table_name: tableName,
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
        total_amount: grandTotal,
        paid_amount: 0,
        created_at: new Date().toISOString(),
      },
      items: allItems,
      payments: [],
    });
  }

  function handleCustomerSave(n, p) {
    setCustomerName(n);
    setCustomerPhone(p);
  }

  /* ── Panel render helpers ────────────────────────────────────── */
  const renderKOTPanel = (panelId, panelStyle, onCtx) => (
    <div key={panelId} style={{ ...panelStyle, background: W.windowBg, border: `1px solid ${W.border}`, borderTop: 'none', borderBottom: 'none', borderLeft: 'none', boxShadow: '4px 0 20px rgba(80,50,20,0.15)' }}>
      {/* Chrome */}
      <div
        onContextMenu={onCtx}
        style={{ padding: '9px 16px', background: W.chrome, borderBottom: `1px solid ${W.border}`, flexShrink: 0, userSelect: 'none' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
            <button
              onClick={() => navigate('/pos')}
              title="Back (Esc)"
              style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57', border: '1px solid rgba(0,0,0,0.18)', cursor: 'pointer', padding: 0 }}
            />
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e', border: '1px solid rgba(0,0,0,0.18)' }} />
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840', border: '1px solid rgba(0,0,0,0.18)' }} />
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#4a3828', letterSpacing: '0.06em', textTransform: 'uppercase', textShadow: '0 1px 0 rgba(255,255,255,0.45)', flex: 1 }}>
            {existingOrderId ? 'Edit Order' : 'New Order'} — {orderLabel}
          </span>
          <span style={{ fontSize: 9, color: W.text3 }}>{todayStr}</span>
        </div>

        <div style={{ display: 'flex', gap: 5 }}>
          {ORDER_TYPES.map(t => (
            <button key={t.key}
              onClick={() => !existingOrderId && setOrderType(t.key)}
              style={{
                flex: 1, padding: '5px 4px',
                border: `1.5px solid ${orderType === t.key ? W.orange : W.borderLight}`,
                borderRadius: 6,
                background: orderType === t.key ? W.orange : 'rgba(255,255,255,0.5)',
                color: orderType === t.key ? '#fff' : W.text2,
                fontSize: 10, fontWeight: 700,
                cursor: existingOrderId ? 'default' : 'pointer',
                opacity: existingOrderId ? 0.6 : 1,
                letterSpacing: '0.03em',
                transition: 'all 0.12s',
              }}
            >{t.label}</button>
          ))}
        </div>

        {orderType === 'DINE_IN' && !initState.tableId && tables.length > 0 && (
          <select
            value={activeTable}
            onChange={e => setActiveTable(e.target.value)}
            disabled={!!existingOrderId}
            style={{ width: '100%', height: 34, borderRadius: 7, border: `1px solid ${W.borderLight}`, background: 'rgba(255,255,255,0.7)', padding: '0 10px', fontSize: 12, color: W.text1, marginTop: 8, outline: 'none', cursor: existingOrderId ? 'not-allowed' : 'pointer' }}
          >
            <option value="">Select Table…</option>
            {tables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>

      {/* Customer row */}
      <button
        onClick={() => setCustModal(true)}
        style={{
          flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 16px',
          background: 'transparent',
          cursor: 'pointer', textAlign: 'left', border: 'none',
          borderBottom: `1px solid ${W.borderLight}`,
          transition: 'background 0.1s', width: '100%',
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.5)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <div style={{ height: 30, width: 30, borderRadius: '50%', background: 'rgba(193,68,14,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Users style={{ height: 14, width: 14, color: W.orange }} />
        </div>
        {customerName
          ? <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: W.text1, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{customerName}</p>
            {customerPhone && <p style={{ fontSize: 10, color: W.text3, margin: 0 }}>{customerPhone}</p>}
          </div>
          : <span style={{ fontSize: 12, color: W.orange, fontWeight: 700 }}>+ Add customer</span>
        }
        {customerName && <Pencil style={{ height: 12, width: 12, color: W.text3, flexShrink: 0 }} />}
      </button>

      {/* Scrollable items */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {editableItems.length > 0 && (
          <div style={{ padding: '10px 16px 0' }}>
            <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.14em', color: W.text3, marginBottom: 6, marginTop: 0 }}>Sent to Kitchen</p>
            {editableItems.map(item => (
              <KotItemRow
                key={item.id}
                item={item}
                onQtyChange={d => changeExistingQty(item, d)}
                onCancel={() => cancelExistingItem(item)}
                onNotesChange={notes => updateExistingNotes(item, notes)}
                onEdit={() => handleExistingItemEdit(item)}
                onHomePack={val => updateExistingHomePack(item, val)}
              />
            ))}
          </div>
        )}

        <div style={{ padding: '10px 16px 0' }}>
          {editableItems.length > 0 && cart.length > 0 && (
            <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.14em', color: W.text3, marginBottom: 6, marginTop: 6 }}>Adding Now</p>
          )}
          {cart.length === 0 && editableItems.length === 0
            ? <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', gap: 12, textAlign: 'center' }}>
              <div style={{ height: 52, width: 52, borderRadius: '50%', background: 'rgba(160,144,128,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <UtensilsCrossed style={{ height: 24, width: 24, color: W.text3 }} />
              </div>
              <p style={{ fontSize: 12, color: W.text3, fontWeight: 600, margin: 0 }}>Tap a dish to add it</p>
            </div>
            : cart.map(item => (
              <CartLine key={item._id} item={item}
                onQty={changeQty} onRemove={removeItem}
                onNotesChange={changeNotes}
                onDoubleClick={() => handleCartItemClick(item)}
                onHomePack={val => setCart(prev => prev.map(i => i._id === item._id ? { ...i, is_homepack: val } : i))}
              />
            ))
          }
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8, borderTop: `1px solid ${W.border}`, flexShrink: 0, background: 'rgba(255,255,255,0.4)' }}>
        <button
          onClick={liveOrderId ? handleCheckout : () => { }}
          style={{
            width: '100%', height: 48,
            borderRadius: 10, border: 'none',
            background: liveOrderId ? W.green : 'rgba(45,122,45,0.15)',
            color: liveOrderId ? '#fff' : 'rgba(45,122,45,0.5)',
            fontSize: 14, fontWeight: 800,
            cursor: liveOrderId ? 'pointer' : 'not-allowed',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            boxShadow: liveOrderId ? '0 3px 12px rgba(45,122,45,0.25)' : 'none',
            transition: 'all 0.15s', letterSpacing: '0.04em',
          }}
        >
          <CreditCard style={{ height: 17, width: 17 }} />
          Checkout
        </button>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handlePrint}
            disabled={grandTotal === 0}
            style={{
              flex: 1, height: 44, borderRadius: 9,
              border: `2px solid ${grandTotal > 0 ? W.border : W.borderLight}`,
              background: 'transparent',
              color: grandTotal > 0 ? W.text2 : W.text3,
              fontSize: 12, fontWeight: 700,
              cursor: grandTotal > 0 ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transition: 'all 0.12s',
            }}
          >🖨 Print</button>

          <button
            onClick={handleSaveAndSend}
            disabled={saving}
            style={{
              flex: 2, height: 44,
              borderRadius: 9, border: 'none',
              background: W.orange, color: '#fff',
              fontSize: 13, fontWeight: 800,
              cursor: saving ? 'not-allowed' : 'pointer',
              boxShadow: '0 3px 12px rgba(193,68,14,0.25)',
              transition: 'all 0.15s', letterSpacing: '0.03em',
            }}
          >{saving ? 'Sending…' : cart.length ? (liveOrderId ? 'Send More →' : 'Save & Send →') : 'Done →'}</button>
        </div>
      </div>
    </div>
  );

  const renderCatPanel = (panelId, panelStyle, onCtx) => (
    <div key={panelId} style={{
      ...panelStyle,
      background: 'linear-gradient(180deg, #c8bba8 0%, #b5a892 100%)',
      borderRight: `1px solid ${W.border}`,
      gap: 0,
      boxShadow: '2px 0 8px rgba(80,50,20,0.1)',
    }}>
      <div
        onContextMenu={onCtx}
        style={{ padding: '10px 10px 8px', flexShrink: 0, borderBottom: `1px solid rgba(0,0,0,0.1)` }}
      >
        <p style={{ fontSize: 8, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(74,56,40,0.7)', margin: 0, textAlign: 'center' }}>Categories</p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button
          onClick={() => { setActiveCat(ALL_CAT); setSearch(''); }}
          style={{
            width: '100%', padding: '10px 8px', borderRadius: 8,
            border: `1.5px solid ${activeCat === ALL_CAT ? W.orange : 'rgba(255,255,255,0.3)'}`,
            background: activeCat === ALL_CAT ? W.orange : 'rgba(255,255,255,0.25)',
            color: activeCat === ALL_CAT ? '#fff' : '#4a3828',
            fontSize: 12, fontWeight: 800,
            cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.04em',
            transition: 'all 0.12s',
            boxShadow: activeCat === ALL_CAT ? '0 2px 8px rgba(193,68,14,0.3)' : 'none',
          }}
        >All</button>

        {categories.map(cat => (
          <button
            key={cat.id}
            onClick={() => { setActiveCat(cat.id); setSearch(''); }}
            style={{
              width: '100%', padding: '10px 8px', borderRadius: 8,
              border: `1.5px solid ${activeCat === cat.id ? W.orange : 'rgba(255,255,255,0.3)'}`,
              background: activeCat === cat.id ? W.orange : 'rgba(255,255,255,0.25)',
              color: activeCat === cat.id ? '#fff' : '#4a3828',
              fontSize: 11, fontWeight: 700,
              cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.04em',
              transition: 'all 0.12s', textAlign: 'center',
              wordBreak: 'break-word', lineHeight: 1.25,
              boxShadow: activeCat === cat.id ? '0 2px 8px rgba(193,68,14,0.3)' : 'none',
            }}
          >{cat.name}</button>
        ))}
      </div>
    </div>
  );

  const renderProductsPanel = (panelId, panelStyle, onCtx) => (
    <div key={panelId} style={{ ...panelStyle, background: W.windowBg }}>
      {/* Chrome + search */}
      <div
        onContextMenu={onCtx}
        style={{ flexShrink: 0, borderBottom: `1px solid ${W.border}`, background: W.chrome }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderBottom: `1px solid rgba(0,0,0,0.1)` }}>
          <div style={{ display: 'flex', gap: 5 }}>
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57', border: '1px solid rgba(0,0,0,0.18)' }} />
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e', border: '1px solid rgba(0,0,0,0.18)' }} />
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840', border: '1px solid rgba(0,0,0,0.18)' }} />
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#4a3828', letterSpacing: '0.06em', textTransform: 'uppercase', flex: 1, textAlign: 'center', textShadow: '0 1px 0 rgba(255,255,255,0.45)' }}>
            Menu
          </span>
          <SocketStatus socket={socketRef.current} style={{ flexDirection: 'row', color: W.text3, fontSize: 10 }} />
        </div>

        <div style={{ padding: '10px 14px' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', height: 18, width: 18, color: W.text3 }} />
              <input
                ref={searchRef}
                placeholder="Search dishes… (F2)"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  paddingLeft: 40, paddingRight: 14, height: 44, width: '100%',
                  fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em',
                  borderRadius: 9, border: `1.5px solid ${W.borderLight}`,
                  background: 'rgba(255,255,255,0.75)', color: W.text1,
                  outline: 'none', boxSizing: 'border-box',
                  transition: 'border-color 0.12s, background 0.12s',
                }}
                onFocus={e => { e.target.style.borderColor = W.orange; e.target.style.background = 'rgba(255,255,255,0.95)'; }}
                onBlur={e => { e.target.style.borderColor = W.borderLight; e.target.style.background = 'rgba(255,255,255,0.75)'; }}
              />
            </div>
            {search && (
              <button
                onClick={() => setSearch('')}
                style={{ fontSize: 12, fontWeight: 700, borderRadius: 8, background: 'rgba(255,255,255,0.6)', border: `1px solid ${W.borderLight}`, color: W.text2, padding: '6px 12px', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}
              >Clear</button>
            )}
          </div>
        </div>
      </div>

      {/* Product grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
        {loading
          ? <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 160, color: W.text3, fontSize: 13 }}>Loading…</div>
          : filtered.length === 0
            ? <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 160, color: W.text3, fontSize: 13 }}>No items found</div>
            : <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(145px, 1fr))' }}>
              {filtered.map(p => (
                <ProductCard key={p.id} product={p} cartQty={qtyByProduct[p.id] ?? 0} onClick={handleProductClick} />
              ))}
            </div>
        }
      </div>
    </div>
  );

  /* ─────────────────────── RENDER ──────────────────────────── */
  return (
    <div
      ref={containerRef}
      style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: "'Inter', system-ui, sans-serif", background: W.desktopBg }}
    >
      {panelOrder.flatMap((panelId, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === panelOrder.length - 1;

        const onCtx = (e) => {
          e.preventDefault();
          setCtxMenu({ panelId, x: e.clientX, y: e.clientY, isFirst, isLast });
        };

        // Last panel fills remaining space; others use stored widths
        const panelStyle = isLast
          ? { flex: 1, minWidth: MIN_WIDTHS[panelId], display: 'flex', flexDirection: 'column', overflow: 'hidden' }
          : { width: panelWidths[panelId] || MIN_WIDTHS[panelId], flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' };

        const divider = idx > 0 ? (
          <PanelDivider
            key={`div-${idx}`}
            onMouseDown={(e) => {
              const leftId = panelOrder[idx - 1];
              const rightId = panelId;
              resizingRef.current = {
                leftId, rightId,
                startX: e.clientX,
                startWidths: {
                  [leftId]: panelWidths[leftId] || MIN_WIDTHS[leftId],
                  [rightId]: panelWidths[rightId] || MIN_WIDTHS[rightId],
                },
              };
              e.preventDefault();
            }}
          />
        ) : null;

        const panel = panelId === 'kot'
          ? renderKOTPanel(panelId, panelStyle, onCtx)
          : panelId === 'cat'
            ? renderCatPanel(panelId, panelStyle, onCtx)
            : renderProductsPanel(panelId, panelStyle, onCtx);

        return divider ? [divider, panel] : [panel];
      })}

      {/* Panel context menu */}
      {ctxMenu && (
        <PanelContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          isFirst={ctxMenu.isFirst}
          isLast={ctxMenu.isLast}
          onClose={() => setCtxMenu(null)}
          onReset={resetPanelLayout}
          onSave={savePanelLayout}
          onMoveLeft={() => movePanelLeft(ctxMenu.panelId)}
          onMoveRight={() => movePanelRight(ctxMenu.panelId)}
        />
      )}

      {/* Modals */}
      {productModal && (
        <AddProductModal
          product={productModal.product}
          existingItem={productModal.existingItem ?? null}
          onClose={() => setProductModal(null)}
          onConfirm={(data) => {
            if (productModal.existingKotItem) {
              if (data) {
                // Edit = replace: silent CANCEL, no return/waste prompt
                doCancelExisting(productModal.existingKotItem, 'CANCEL', 'Item edited — replaced');
                addToCart(data);
              } else {
                cancelExistingItem(productModal.existingKotItem);
              }
            } else if (productModal.existingItem?._id) {
              updateCartItem(productModal.existingItem._id, data);
            } else if (data) {
              addToCart(data);
            }
          }}
        />
      )}

      {removePrompt && (
        <RemoveItemModal
          item={removePrompt}
          onClose={() => setRemovePrompt(null)}
          onConfirm={(kind, reason) => {
            doCancelExisting(removePrompt, kind, reason);
            setRemovePrompt(null);
          }}
        />
      )}

      {custModal && (
        <CustomerModal
          name={customerName}
          phone={customerPhone}
          onSave={handleCustomerSave}
          onClose={() => setCustModal(false)}
        />
      )}

      {checkoutModal && (
        <CheckoutModal
          orderId={liveOrderId}
          onClose={() => { isCheckingOutRef.current = false; setCheckoutModal(false); }}
          onSuccess={() => { navigate('/pos', { replace: true }); }}
        />
      )}

      {showSalesReport && (
        <SalesReportModal onClose={() => setShowSalesReport(false)} />
      )}
    </div>
  );
}
