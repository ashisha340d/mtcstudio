import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import { createSocket } from '../../socket';
import SocketStatus from '../../components/SocketStatus';
import { nepalNowFull, formatNepalDateTime } from '../../utils/dateTime';
import { useLocation, useNavigate } from 'react-router';
import {
  Search, Plus, Minus, Trash2,
  Image as ImageIcon, Users, Pencil,
  UtensilsCrossed, CreditCard,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import CheckoutModal from './components/SplitTenderCheckoutContainer';
import CustomerPickerModal from './components/CustomerPickerModal';
import SalesReportModal from './components/SalesReportModal';
import AddProductModal from './components/AddProductModal';
import { printReceipt } from './components/ThermalReceipt';
import { API, W, fmt, cleanVariantName } from './posShared';
import { getMenuSnapshot, subscribeMenu, initMenuStore } from '../../stores/menuStore';
import './pos.css';

const H = { 'Content-Type': 'application/json', 'X-Session-ID': 'dev-session' };

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

function getProductBadges(product) {
  const badges = [];
  if (product?.is_fast_moving) badges.push({ label: '⚡ Fast', tone: 'fast' });
  if ((product?.variant_count ?? 0) > 1) badges.push({ label: `${product.variant_count} sizes`, tone: 'multi' });
  const extras = String(product?.badge || product?.badges || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  extras.forEach((code) => badges.push({ label: code, tone: 'tag' }));
  return badges;
}

/* ── Panel layout ────────────────────────────────────────────── */
const PANEL_LAYOUT_KEY = 'posv2_layout';
const DIVIDER_W = 5;
const DEFAULT_WIDTHS = { kot: 480, cat: 140, products: 0 };
const DEFAULT_ORDER = ['kot', 'cat', 'products'];
const MIN_WIDTHS = { kot: 280, cat: 80, products: 200 };

/* Quick Access rail (inside Menu panel) — persisted prefs */
const QUICK_COLS_KEY = 'posv2_quickCols';
const QUICK_W_KEY = 'posv2_quickW';
const QUICK_ON_KEY = 'posv2_quickOn';
const QUICK_MIN_W = 96;
const QUICK_MAX_W = 340;
const quickDefaultW = (cols) => (cols === 2 ? 224 : 118);

function loadLayout() {
  try {
    const s = JSON.parse(localStorage.getItem(PANEL_LAYOUT_KEY));
    if (s?.order && s?.widths) return s;
  } catch { }
  return null;
}

/* ── Menu data comes from the global menuStore (memory + IndexedDB + socket sync) ── */

/* ── Remove Sent Item — classify mistake / return / waste ─────── */
function RemoveItemModal({ item, onConfirm, onClose }) {
  const [kind, setKind] = useState('CANCEL');
  const [reason, setReason] = useState('');
  const KINDS = [
    { key: 'CANCEL', icon: '✏️', label: 'Mistake / not needed', hint: 'Wrong punch or changed before preparation' },
    { key: 'RETURN', icon: '↩️', label: 'Returned by customer', hint: 'Prepared & served, then sent back' },
    { key: 'WASTE', icon: '🗑️', label: 'Kitchen waste', hint: 'Preparation flaw, dropped, unusable' },
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
  if (count === 1) return fmt(product.price ?? product.min_price ?? product.pos_price ?? 0);
  if (count > 1) {
    const lo = product.min_price ?? product.price ?? 0;
    const hi = product.max_price ?? product.price ?? lo;
    return lo === hi ? fmt(lo) : `${fmt(lo)} – ${fmt(hi)}`;
  }
  return fmt(product.price ?? product.pos_price ?? 0);
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
          ? <img src={`/uploads/${product.primary_image}`} loading="lazy" decoding="async" style={{ height: '100%', width: '100%', objectFit: 'cover', display: 'block' }} alt={product.name} />
          : <div style={{ height: '100%', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ImageIcon style={{ height: 36, width: 36, color: W.text3, opacity: 0.5 }} />
          </div>
        }
      </div>
      <div style={{ padding: '8px 9px 10px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <p style={{ fontSize: 13, fontWeight: 800, color: W.orange, marginTop: 0, marginBottom: 3 }}>{productPriceDisplay(product)}</p>
        <p style={{ fontSize: 12, fontWeight: 600, color: W.text1, lineHeight: 1.25, margin: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{product.name}</p>
        {getProductBadges(product).length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            {getProductBadges(product).map((badge) => (
              <span
                key={`${product.id}-${badge.label}`}
                style={{
                  display: 'inline-flex', alignItems: 'center',
                  padding: '2px 6px', borderRadius: 999,
                  fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                  background: badge.tone === 'fast' ? 'rgba(193,68,14,0.12)' : badge.tone === 'multi' ? 'rgba(45,122,45,0.12)' : 'rgba(29,78,216,0.12)',
                  color: badge.tone === 'fast' ? W.orange : badge.tone === 'multi' ? W.green : W.blue,
                }}
              >
                {badge.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

/* ── Quick Access · mini product card (uniform with ProductCard, no badges) ── */
function QuickCard({ product, cartQty, onClick }) {
  return (
    <button
      onClick={() => onClick(product)}
      title={product.name}
      style={{
        position: 'relative',
        display: 'flex', flexDirection: 'column',
        textAlign: 'left',
        borderRadius: 9,
        background: cartQty > 0 ? 'rgba(193,68,14,0.07)' : 'rgba(255,255,255,0.65)',
        border: cartQty > 0 ? `2px solid ${W.orange}` : `1px solid ${W.borderLight}`,
        overflow: 'hidden',
        cursor: 'pointer',
        padding: 0,
        boxShadow: cartQty > 0 ? '0 3px 12px rgba(193,68,14,0.18)' : '0 1px 4px rgba(80,50,20,0.09)',
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => {
        if (cartQty === 0) {
          e.currentTarget.style.background = 'rgba(255,255,255,0.92)';
          e.currentTarget.style.boxShadow = '0 4px 16px rgba(80,50,20,0.16)';
          e.currentTarget.style.transform = 'translateY(-1px)';
        }
      }}
      onMouseLeave={e => {
        if (cartQty === 0) {
          e.currentTarget.style.background = 'rgba(255,255,255,0.65)';
          e.currentTarget.style.boxShadow = '0 1px 4px rgba(80,50,20,0.09)';
          e.currentTarget.style.transform = 'none';
        }
      }}
    >
      {cartQty > 0 && (
        <div style={{
          position: 'absolute', top: 5, right: 5, zIndex: 10,
          height: 17, minWidth: 17, borderRadius: '50%',
          background: W.orange, color: '#fff',
          fontSize: 9, fontWeight: 800,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 4px',
          boxShadow: '0 2px 6px rgba(193,68,14,0.35)',
        }}>
          {cartQty}
        </div>
      )}
      <div style={{ position: 'relative', width: '100%', background: 'rgba(0,0,0,0.04)', overflow: 'hidden', aspectRatio: '1/1' }}>
        {product.primary_image
          ? <img src={`/uploads/${product.primary_image}`} loading="lazy" decoding="async" style={{ height: '100%', width: '100%', objectFit: 'cover', display: 'block' }} alt={product.name} />
          : <div style={{ height: '100%', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ImageIcon style={{ height: 22, width: 22, color: W.text3, opacity: 0.5 }} />
          </div>
        }
      </div>
      <div style={{ padding: '5px 7px 7px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <p style={{ fontSize: 11, fontWeight: 800, color: W.orange, margin: '0 0 2px' }}>{productPriceDisplay(product)}</p>
        <p style={{ fontSize: 10, fontWeight: 600, color: W.text1, lineHeight: 1.25, margin: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{product.name}</p>
      </div>
    </button>
  );
}

/* ── Quick Access rail — fixed column(s) inside the Menu panel.
     Stays put across search & category navigation. 1–2 columns,
     drag-resizable on its inner edge; cols + width persisted. ── */
function QuickAccessRail({ items, qtyByProduct, onPick, side }) {
  const [cols, setCols] = useState(() => {
    try { return Number(localStorage.getItem(QUICK_COLS_KEY)) === 2 ? 2 : 1; } catch { return 1; }
  });
  const [width, setWidth] = useState(() => {
    try {
      const v = Number(localStorage.getItem(QUICK_W_KEY));
      if (v >= QUICK_MIN_W && v <= QUICK_MAX_W) return v;
    } catch { }
    return quickDefaultW(Number(localStorage.getItem(QUICK_COLS_KEY)) === 2 ? 2 : 1);
  });
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef(null);

  useEffect(() => { try { localStorage.setItem(QUICK_COLS_KEY, String(cols)); } catch { } }, [cols]);
  useEffect(() => { try { localStorage.setItem(QUICK_W_KEY, String(width)); } catch { } }, [width]);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e) => {
      if (!dragRef.current) return;
      const delta = e.clientX - dragRef.current.startX;
      const raw = dragRef.current.startW + (side === 'left' ? delta : -delta);
      setWidth(Math.max(QUICK_MIN_W, Math.min(QUICK_MAX_W, raw)));
    };
    const onUp = () => { dragRef.current = null; setResizing(false); };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizing, side]);

  const pickCols = (n) => { setCols(n); setWidth(quickDefaultW(n)); };

  if (!items.length) return null;

  const handleEdge = side === 'left' ? { right: 0 } : { left: 0 };
  const colBtn = (n, glyph) => (
    <button
      key={n}
      onClick={() => pickCols(n)}
      title={`${n} column${n > 1 ? 's' : ''}`}
      style={{
        height: 16, minWidth: 16, padding: '0 3px',
        borderRadius: 4, border: `1px solid ${cols === n ? W.orange : W.borderLight}`,
        background: cols === n ? W.orange : 'rgba(255,255,255,0.55)',
        color: cols === n ? '#fff' : W.text3,
        fontSize: 7, fontWeight: 900, letterSpacing: 1,
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.12s', lineHeight: 1,
      }}
    >{glyph}</button>
  );

  return (
    <div style={{
      position: 'relative', width, flexShrink: 0,
      display: 'flex', flexDirection: 'column', minHeight: 0,
      background: 'linear-gradient(180deg, rgba(193,68,14,0.05) 0%, rgba(193,68,14,0.015) 100%)',
      borderLeft: side === 'right' ? `1px solid ${W.borderLight}` : 'none',
      borderRight: side === 'left' ? `1px solid ${W.borderLight}` : 'none',
    }}>
      {/* Header */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 4, padding: '7px 8px 6px', borderBottom: `1px solid rgba(193,68,14,0.14)`,
      }}>
        <span style={{ fontSize: 8, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: W.orange, whiteSpace: 'nowrap', overflow: 'hidden' }}>
          ⚡ Quick
        </span>
        <span style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
          {colBtn(1, '▮')}
          {colBtn(2, '▮▮')}
        </span>
      </div>

      {/* Cards */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: 7,
        display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: 6, alignContent: 'start',
      }}>
        {items.map(p => (
          <QuickCard key={p.id} product={p} cartQty={qtyByProduct[p.id] ?? 0} onClick={onPick} />
        ))}
      </div>

      {/* Resize handle on the inner edge */}
      <div
        onMouseDown={(e) => { dragRef.current = { startX: e.clientX, startW: width }; setResizing(true); e.preventDefault(); }}
        style={{
          position: 'absolute', top: 0, bottom: 0, width: 5, ...handleEdge,
          cursor: 'col-resize', zIndex: 5,
          background: resizing ? 'rgba(193,68,14,0.35)' : 'transparent',
          transition: 'background 0.12s',
        }}
        onMouseEnter={e => { if (!resizing) e.currentTarget.style.background = 'rgba(193,68,14,0.2)'; }}
        onMouseLeave={e => { if (!resizing) e.currentTarget.style.background = 'transparent'; }}
      />
    </div>
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
function CartLine({ item, isLatest, onQty, onRemove, onNotesChange, onDoubleClick, onHomePack }) {
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
          fontSize: 12, fontWeight: 800, color: isLatest ? W.blue : W.text1,
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

  const _schedItems = (() => {
    try { return initState.scheduledRow?.items_json ? JSON.parse(initState.scheduledRow.items_json) : []; }
    catch { return []; }
  })();
  const _initCart = [...(initState.draftItems ?? []), ..._schedItems].map(i => ({ ...i, _id: newId() }));

  const [categories, setCategories] = useState(() => getMenuSnapshot().cats ?? []);
  const [products, setProducts] = useState(() => getMenuSnapshot().menu ?? []);
  const [quickOn, setQuickOn] = useState(() => {
    try { return localStorage.getItem(QUICK_ON_KEY) !== '0'; } catch { return true; }
  });
  const toggleQuick = useCallback(() => setQuickOn(v => {
    const next = !v;
    try { localStorage.setItem(QUICK_ON_KEY, next ? '1' : '0'); } catch { }
    return next;
  }), []);
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
  const [tables, setTables] = useState(() => getMenuSnapshot().tbls ?? []);
  const [activeTable, setActiveTable] = useState(initState.tableId ? String(initState.tableId) : '');
  /* ── Scheduled / Draft mode — items saved to pos_scheduled_orders,
     never touching pos_orders/pos_kots until conversion ── */
  const scheduleMeta = initState.scheduleMeta ?? null; // new scheduled order (from ScheduleOrderModal)
  const scheduledRow = initState.scheduledRow ?? null; // editing an existing scheduled/draft row
  const schedMode = !!scheduleMeta || !!scheduledRow || !!initState.draftMode;
  const kindIsScheduled = !!scheduleMeta || scheduledRow?.kind === 'SCHEDULED';

  const [customerName, setCustomerName] = useState(
    initState.customerName ?? scheduleMeta?.customerName ?? scheduledRow?.customer_name ?? ''
  );
  const [customerPhone, setCustomerPhone] = useState(
    initState.customerPhone ?? scheduleMeta?.customerPhone ?? scheduledRow?.customer_phone ?? ''
  );
  const [customerAddress, setCustomerAddress] = useState(initState.customerAddress ?? '');
  const [orderNotes, setOrderNotes] = useState(
    initState.orderNotes ?? scheduleMeta?.orderNotes ?? scheduledRow?.order_notes ?? ''
  );
  const [cart, setCart] = useState(_initCart);
  const [productModal, setProductModal] = useState(null);
  const [custModal, setCustModal] = useState(false);
  const [checkoutModal, setCheckoutModal] = useState(false);
  const [showSalesReport, setShowSalesReport] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const searchRef = useRef(null);
  const socketRef = useRef(null);
  const cartScrollRef = useRef(null);

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
    } catch { }
  }, [panelOrder, panelWidths]);

  const resetPanelLayout = useCallback(() => {
    const total = containerRef.current?.offsetWidth ?? window.innerWidth;
    const productsW = Math.max(MIN_WIDTHS.products, total - DEFAULT_WIDTHS.kot - DEFAULT_WIDTHS.cat - DIVIDER_W * 2);
    setPanelOrder([...DEFAULT_ORDER]);
    setPanelWidths({ ...DEFAULT_WIDTHS, products: productsW });
    try { localStorage.removeItem(PANEL_LAYOUT_KEY); } catch { }
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

    socket.on('item-updated', ({ itemId, quantity, notes, is_home_pack }) => {
      setEditableItems(prev => prev.map(i =>
        i.id === itemId ? { ...i, quantity: quantity ?? i.quantity, notes: notes ?? i.notes, is_home_pack: is_home_pack ?? i.is_home_pack } : i
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

  /* ── Auto-focus search on load ──────────────────────────────── */
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  /* ── Auto-scroll cart to bottom when it grows ───────────────── */
  useEffect(() => {
    const el = cartScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [cart.length, editableItems.length]);

  /* ── Menu / categories / tables from global menuStore ─────── */
  // Never fetches if the store already has data (prefetched at boot).
  // Store notifies on socket-driven updates → React re-renders automatically.
  useEffect(() => {
    const apply = () => {
      const { menu, cats, tbls } = getMenuSnapshot();
      if (menu) { setProducts(menu); setLoading(false); }
      if (cats) setCategories(cats);
      if (tbls) setTables(tbls);
    };
    if (!getMenuSnapshot().menu) setLoading(true);
    const unsub = subscribeMenu(apply);
    initMenuStore().finally(() => setLoading(false));
    apply();
    return unsub;
  }, []);

  /* ── Persist active category selection ───────────────────── */
  useEffect(() => {
    try { localStorage.setItem('pos_activeCat', activeCat); } catch { /* best-effort */ }
  }, [activeCat]);

  /* ── Fast-moving items derived from the same list ─────────── */
  const fastProducts = useMemo(() => products.filter(p => p.is_fast_moving), [products]);

  /* ── Category filter + deep search (all client-side, instant) ── */
  const filtered = useMemo(() => {
    if (search) {
      const q = search.toLowerCase();
      return products.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.variant_names || '').toLowerCase().includes(q)
      );
    }
    if (activeCat === ALL_CAT) return products;
    return products.filter(p => String(p.category_id) === String(activeCat));
  }, [products, search, activeCat]);

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

  /* Selecting an occupied table adopts its open order: sent items load into
     the KOT panel and liveOrderId points at it, so Send APPENDS a new KOT
     instead of opening a parallel order on the same table. */
  function unadoptOrder() {
    setLiveOrderId(null);
    setEditableItems([]);
    committedItems.current = [];
    pendingCancels.current = [];
    setExistingDirty(false);
  }

  async function handleTableSelect(tableId) {
    setActiveTable(tableId);
    unadoptOrder();
    if (!tableId) return;
    try {
      const data = await fetch(`${API}/pos/orders/active`, { headers: H }).then(r => r.json());
      const order = (data.orders ?? []).find(
        o => String(o.table_id) === String(tableId) && (o.status === 'OPEN' || o.status === 'SAVED')
      );
      if (!order) return;
      setLiveOrderId(order.id);
      const kots = (data.kots ?? []).filter(k => k.order_id === order.id);
      const items = kots.flatMap(k => (k.items ?? []).filter(i => i.status !== 'CANCELLED'));
      setEditableItems(items);
      committedItems.current = items;
      if (order.customer_name && !customerName) setCustomerName(order.customer_name);
      if (order.customer_phone && !customerPhone) setCustomerPhone(order.customer_phone);
      // Unsent draft items saved on that order → merge into cart
      try {
        const draft = order.draft_items ? JSON.parse(order.draft_items) : [];
        if (draft.length) setCart(prev => [...draft.map(i => ({ ...i, _id: newId() })), ...prev]);
      } catch { /* malformed draft — skip */ }
    } catch { /* offline — proceed as fresh order */ }
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
        order_notes: orderNotes || null,
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

  /* Save into pos_scheduled_orders — scheduled_for/notify only sent on create;
     edits leave the stored trigger time untouched (avoids tz round-trips). */
  async function handleSaveScheduled() {
    if (!cart.length) { navigate('/pos'); return; }
    setSaving(true);
    try {
      const items = cart.map(({ _id, ...rest }) => rest);
      if (scheduledRow) {
        await fetch(`${API}/pos/scheduled/${scheduledRow.id}`, {
          method: 'PATCH', headers: H,
          body: JSON.stringify({
            customer_name: customerName || null,
            customer_phone: customerPhone || null,
            order_notes: orderNotes || null,
            items, total_amount: grandTotal,
          }),
        });
      } else {
        await fetch(`${API}/pos/scheduled`, {
          method: 'POST', headers: H,
          body: JSON.stringify({
            kind: scheduleMeta ? 'SCHEDULED' : 'DRAFT',
            order_type: orderType,
            customer_name: customerName || null,
            customer_phone: customerPhone || null,
            order_notes: orderNotes || null,
            scheduled_for: scheduleMeta?.scheduledFor ?? null,
            notify_before_min: scheduleMeta?.notifyBeforeMin ?? 30,
            items, total_amount: grandTotal,
          }),
        });
      }
      navigate('/pos');
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
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
    // Order already exists in DB — persist immediately, not just local state
    const orderId = liveOrderIdRef.current ?? existingOrderId;
    if (orderId) {
      fetch(`${API}/pos/orders/${orderId}`, {
        method: 'PATCH', headers: H,
        body: JSON.stringify({ customer_name: n || null, customer_phone: p || null }),
      }).catch(() => { });
    }
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
          <span style={{ fontSize: 10, fontWeight: 800, color: W.blue, letterSpacing: '0.02em', flexShrink: 0 }}>{todayStr}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#4a3828', letterSpacing: '0.06em', textTransform: 'uppercase', textShadow: '0 1px 0 rgba(255,255,255,0.45)', flex: 1, textAlign: 'right' }}>
            {schedMode
              ? `${scheduledRow ? 'Edit' : 'New'} ${kindIsScheduled ? 'Scheduled Order' : 'Draft'}`
              : existingOrderId ? 'Edit Order' : 'New Order'} — {orderLabel}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 5 }}>
          {ORDER_TYPES.map(t => (
            <button key={t.key}
              onClick={() => {
                if (existingOrderId || kindIsScheduled) return;
                setOrderType(t.key);
                // Leaving DINE_IN drops any adopted table order
                if (t.key !== 'DINE_IN' && activeTable) { setActiveTable(''); unadoptOrder(); }
              }}
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

        {kindIsScheduled && (
          <div style={{ marginTop: 8, fontSize: 11, fontWeight: 700, color: '#4c5fd5', background: 'rgba(76,95,213,0.08)', border: '1px solid rgba(76,95,213,0.25)', borderRadius: 7, padding: '6px 10px' }}>
            ⏰ {scheduleMeta?.scheduledFor ?? formatNepalDateTime(scheduledRow?.scheduled_for)}
            {' · '}KOT {scheduleMeta?.notifyBeforeMin ?? scheduledRow?.notify_before_min ?? 30} min before
          </div>
        )}

        {orderType === 'DINE_IN' && !initState.tableId && tables.length > 0 && (
          <select
            value={activeTable}
            onChange={e => handleTableSelect(e.target.value)}
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
      <div ref={cartScrollRef} style={{ flex: 1, overflowY: 'auto' }}>
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
            : cart.map((item, idx) => (
              <CartLine key={item._id} item={item} isLatest={idx === 0}
                onQty={changeQty} onRemove={removeItem}
                onNotesChange={changeNotes}
                onDoubleClick={() => handleCartItemClick(item)}
                onHomePack={val => setCart(prev => prev.map(i => i._id === item._id ? { ...i, is_homepack: val } : i))}
              />
            ))
          }
        </div>
      </div>

      {/* Total */}
      <div style={{ padding: '8px 16px', display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: 6, borderTop: `1px solid ${W.border}`, flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: W.text3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Total</span>
        <span style={{ fontSize: 18, fontWeight: 800, color: W.text1 }}>₹{grandTotal.toFixed(0)}</span>
      </div>

      {/* Action buttons */}
      <div style={{ padding: '12px 16px', display: 'flex', gap: 8, borderTop: `1px solid ${W.border}`, flexShrink: 0, background: 'rgba(255,255,255,0.4)' }}>
        {schedMode ? (
          <button
            onClick={handleSaveScheduled}
            disabled={saving}
            style={{
              flex: 1, height: 48,
              borderRadius: 10, border: 'none',
              background: kindIsScheduled ? '#4c5fd5' : W.orange, color: '#fff',
              fontSize: 14, fontWeight: 800,
              cursor: saving ? 'not-allowed' : 'pointer',
              boxShadow: kindIsScheduled ? '0 3px 12px rgba(76,95,213,0.3)' : '0 3px 12px rgba(193,68,14,0.25)',
              transition: 'all 0.15s', letterSpacing: '0.03em',
            }}
          >{saving ? 'Saving…' : kindIsScheduled ? '⏰ Save Scheduled Order' : '📝 Save Draft'}</button>
        ) : (
          <>
            <button
              onClick={liveOrderId ? handleCheckout : () => { }}
              style={{
                flex: 1, height: 48,
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

            <button
              onClick={handleSaveAndSend}
              disabled={saving}
              style={{
                flex: 1, height: 48,
                borderRadius: 10, border: 'none',
                background: W.orange, color: '#fff',
                fontSize: 14, fontWeight: 800,
                cursor: saving ? 'not-allowed' : 'pointer',
                boxShadow: '0 3px 12px rgba(193,68,14,0.25)',
                transition: 'all 0.15s', letterSpacing: '0.03em',
              }}
            >{saving ? 'Sending…' : cart.length ? (liveOrderId ? 'Send More →' : 'Save & Send →') : 'Done →'}</button>
          </>
        )}
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

  const renderProductsPanel = (panelId, panelStyle, onCtx) => {
    // Quick rail hugs the side facing the Category panel so the eye travels
    // Categories → Quick → Grid in one sweep, wherever the panels sit.
    const catIdx = panelOrder.indexOf('cat');
    const prodIdx = panelOrder.indexOf('products');
    const quickSide = catIdx !== -1 && catIdx > prodIdx ? 'right' : 'left';
    const quickRail = quickOn ? (
      <QuickAccessRail
        items={fastProducts}
        qtyByProduct={qtyByProduct}
        onPick={handleProductClick}
        side={quickSide}
      />
    ) : null;

    return (
      <div key={panelId} style={{ ...panelStyle, background: W.windowBg }}>
        {/* Chrome + search */}
        <div
          onContextMenu={onCtx}
          style={{ flexShrink: 0, borderBottom: `1px solid ${W.border}`, background: W.chrome }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderBottom: `1px solid rgba(0,0,0,0.1)` }}>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57', border: '1px solid rgba(0,0,0,0.18)' }} />
              <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e', border: '1px solid rgba(0,0,0,0.18)' }} />
              <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840', border: '1px solid rgba(0,0,0,0.18)' }} />
              <button
                onClick={toggleQuick}
                title={quickOn ? 'Hide Quick Access rail' : 'Show Quick Access rail'}
                style={{
                  marginLeft: 6, height: 17, padding: '0 7px',
                  borderRadius: 20, cursor: 'pointer',
                  fontSize: 9, fontWeight: 800, lineHeight: 1,
                  display: 'flex', alignItems: 'center', gap: 3,
                  border: `1px solid ${quickOn ? W.orange : 'rgba(0,0,0,0.18)'}`,
                  background: quickOn ? W.orange : 'rgba(255,255,255,0.35)',
                  color: quickOn ? '#fff' : '#4a3828',
                  boxShadow: quickOn ? '0 1px 5px rgba(193,68,14,0.35)' : 'none',
                  transition: 'all 0.15s',
                }}
              >⚡</button>
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

        {/* Body: fixed Quick rail + scrolling product grid */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {quickSide === 'left' && quickRail}
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '12px 14px' }}>
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
          {quickSide === 'right' && quickRail}
        </div>
      </div>
    );
  };

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
        <CustomerPickerModal
          title={customerName ? '✎ Change Customer' : '＋ Add Customer'}
          onSelect={(c) => handleCustomerSave(c.name, c.phone)}
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
