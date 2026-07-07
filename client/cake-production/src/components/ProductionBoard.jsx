import { useRef, useState } from 'react';
import { useOrders, usePendingCounts } from '../hooks';
import { mutations } from '../sync/syncEngine';

export const STATUS_META = {
  New: { label: 'New', color: '#9c8870' },
  Acknowledged: { label: 'Acknowledged', color: '#2563eb' },
  'In Production': { label: 'In Production', color: '#c1440e' },
  'Ready for Delivery': { label: 'Ready', color: '#16a34a' },
};

// Bidirectional production pipeline — one adjacent step per swipe/tap.
// This is `production_status`, owned entirely by this app. POS's own
// `status` (Cancelled/Delivered) is a separate column this app never writes.
export const STATUS_CHAIN = ['New', 'Acknowledged', 'In Production', 'Ready for Delivery'];

// What the chef can see/do on an order, derived from POS `status` (source of
// truth for Cancelled/Delivered) and this app's own `production_status`.
export function getPermissions(order) {
  if (order.status === 'CANCELLED') return { checklist: false, tags: false, notes: false, photosVisible: true, photosUpload: false, cancelled: true, locked: true };
  if (order.status === 'DELIVERED') return { checklist: false, tags: true, notes: false, photosVisible: true, photosUpload: false, cancelled: false, locked: true };
  const ps = order.production_status;
  if (ps === 'Ready for Delivery') return { checklist: false, tags: true, notes: true, photosVisible: true, photosUpload: true, cancelled: false, locked: false };
  if (ps === 'In Production') return { checklist: true, tags: true, notes: true, photosVisible: false, photosUpload: false, cancelled: false, locked: false };
  // New / Acknowledged / unset — checklist & photos not shown yet
  return { checklist: false, tags: true, notes: true, photosVisible: false, photosUpload: false, cancelled: false, locked: false };
}

// Display status pill: POS's Cancelled/Delivered always wins over the
// baker's own production_status, since those are terminal from this app's view.
export function getDisplayMeta(order) {
  if (order.status === 'CANCELLED') return { label: 'Cancelled', color: '#dc2626' };
  if (order.status === 'DELIVERED') return { label: 'Delivered', color: '#6b7280' };
  return STATUS_META[order.production_status] || { label: order.production_status || '—', color: '#6b7280' };
}

const SWIPE_THRESHOLD = 80;
const TAP_TOLERANCE = 10;

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function fmtTime(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h)) return t;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function cardThumb(order) {
  const slot1 = (order.photos || []).find(p => p.slot_number === 1);
  if (slot1) return slot1.image_url;
  if (order.images?.[0]) return order.images[0].image_url;
  return null;
}

function OrderCard({ order, onOpen, onSwipeStatus }) {
  const pending = usePendingCounts(order.id);
  const meta = getDisplayMeta(order);
  const locked = order.status === 'CANCELLED' || order.status === 'DELIVERED';
  const idx = STATUS_CHAIN.indexOf(order.production_status);
  const canForward = !locked && idx >= 0 && idx < STATUS_CHAIN.length - 1;
  const canBack = !locked && idx > 0;
  const forwardLabel = canForward ? STATUS_META[STATUS_CHAIN[idx + 1]]?.label : null;
  const backLabel = canBack ? STATUS_META[STATUS_CHAIN[idx - 1]]?.label : null;

  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef({ startX: 0, startY: 0, mode: null }); // mode: null | 'swipe' | 'scroll'

  function onPointerDown(e) {
    drag.current = { startX: e.clientX, startY: e.clientY, mode: null };
    setDragging(true);
  }
  function onPointerMove(e) {
    if (!dragging) return;
    const s = drag.current;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (s.mode === null) {
      if (Math.abs(dx) < TAP_TOLERANCE && Math.abs(dy) < TAP_TOLERANCE) return; // still within tap tolerance
      s.mode = Math.abs(dy) > Math.abs(dx) ? 'scroll' : 'swipe';
    }
    if (s.mode === 'scroll') return; // vertical scroll — let it pass through
    const clamped = dx < 0 ? Math.max(dx, canForward ? -140 : -40) : Math.min(dx, canBack ? 140 : 40);
    setDragX(clamped);
  }
  function onPointerUp() {
    setDragging(false);
    const s = drag.current;
    const dx = dragX;
    setDragX(0);
    if (s.mode === 'scroll') return;
    if (s.mode === null) { onOpen(order.id); return; } // never left tap tolerance -> genuine tap
    if (dx <= -SWIPE_THRESHOLD && canForward) onSwipeStatus(order, STATUS_CHAIN[idx + 1]);
    else if (dx >= SWIPE_THRESHOLD && canBack) onSwipeStatus(order, STATUS_CHAIN[idx - 1]);
  }

  const thumb = cardThumb(order);
  const mainItem = order.items?.[0];
  const extraCount = (order.items?.length || 0) - 1;

  return (
    <div className="cp-card-swipe-wrap">
      <div className="cp-card-swipe-bg">
        <span className="cp-card-swipe-back">{backLabel ? `← ${backLabel}` : ''}</span>
        <span className="cp-card-swipe-forward">{forwardLabel ? `${forwardLabel} →` : ''}</span>
      </div>
      <div
        className="cp-card"
        style={{ transform: `translateX(${dragX}px)`, transition: dragging ? 'none' : 'transform 0.2s' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="cp-card-top">
          <div>
            <div className="cp-card-order">{order.order_number}</div>
            <div className="cp-card-name">{order.customer_name}</div>
          </div>
          <span className="cp-status-pill" style={{ background: meta.color + '1a', color: meta.color, border: `1px solid ${meta.color}44` }}>
            {meta.label}
          </span>
        </div>
        <div className="cp-card-datetime">
          <span className="cp-card-date-big">{fmtDate(order.delivery_date)}</span>
          {fmtTime(order.delivery_time) && <span className="cp-card-time">{fmtTime(order.delivery_time)}</span>}
        </div>
        <div className="cp-card-cake-row">
          {thumb && <img src={thumb} className="cp-card-thumb" alt="" />}
          <div className="cp-card-cake-text">
            {mainItem ? (
              <>
                <div className="cp-card-cake-name">
                  {mainItem.product_name}{mainItem.variant_name ? ` – ${mainItem.variant_name}` : ''}
                </div>
                <div className="cp-card-cake-specs">
                  {mainItem.size ? `${mainItem.size} · ` : ''}×{mainItem.qty || 1}
                  {extraCount > 0 ? ` · +${extraCount} more` : ''}
                </div>
              </>
            ) : (
              <div className="cp-card-cake-name">Cake</div>
            )}
          </div>
        </div>
        {(pending.sync > 0 || pending.photos > 0) && (
          <div className="cp-card-pending">
            {pending.sync > 0 && `⏳ ${pending.sync} change${pending.sync > 1 ? 's' : ''} syncing`}
            {pending.sync > 0 && pending.photos > 0 && ' · '}
            {pending.photos > 0 && `📷 ${pending.photos} photo${pending.photos > 1 ? 's' : ''} uploading`}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProductionBoard({ onOpenOrder }) {
  const orders = useOrders();

  function handleSwipeStatus(order, targetStatus) {
    mutations.status(order.id, targetStatus);
  }

  const today = todayStr();
  const visible = orders.filter(o => !o.delivery_date || o.delivery_date >= today); // hide orders whose delivery date has passed
  const visibleIds = visible.map(o => o.id);

  return (
    <div>
      {visible.length === 0 && <div className="cp-empty">No orders to show.</div>}
      {visible.map(o => (
        <OrderCard key={o.id} order={o} onOpen={id => onOpenOrder(id, visibleIds)} onSwipeStatus={handleSwipeStatus} />
      ))}
    </div>
  );
}
