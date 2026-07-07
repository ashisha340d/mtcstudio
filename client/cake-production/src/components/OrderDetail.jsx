import { useEffect, useRef, useState } from 'react';
import { useOrder } from '../hooks';
import { getMeta, setMeta } from '../db/dexie';
import { mutations } from '../sync/syncEngine';
import { STATUS_META, STATUS_CHAIN, getDisplayMeta, getPermissions } from './ProductionBoard';
import PhotoSlot from './PhotoSlot';
import ChecklistPanel from './ChecklistPanel';
import TagEditor from './TagEditor';

const SECTION_LABELS = {
  cakeDetail: 'Cake Detail',
  images: 'Reference Images',
  moveStage: 'Move Stage',
  photos: 'Photos',
  checklist: 'Checklist',
  tags: 'Tags',
  notes: 'Notes',
};
const DEFAULT_SECTION_ORDER = ['cakeDetail', 'images', 'moveStage', 'photos', 'checklist', 'tags', 'notes'];
const SWIPE_THRESHOLD = 90;
const EDGE_RESIST = 60; // px of "rubber-band" give when there's no next/prev order to swipe to
const ANIM_MS = 260;
const EASING = 'cubic-bezier(.22,.61,.36,1)';

function fmtDateWithDay(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtTime(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h)) return t;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export default function OrderDetail({ orderId, list, enterDir, onNavigate, onBack }) {
  const order = useOrder(orderId);
  const [notes, setNotes] = useState('');
  const [sectionOrder, setSectionOrder] = useState(DEFAULT_SECTION_ORDER);
  const notesTimer = useRef(null);
  const notesLoaded = useRef(false);
  const drag = useRef({ startX: 0, startY: 0, moved: false, dragging: false });

  // Carousel slide animation: the page starts off-screen on the side it was
  // entered from (set by the swipe that navigated here), then animates to 0.
  const [slideX, setSlideX] = useState(enterDir === 'right' ? '100%' : enterDir === 'left' ? '-100%' : '0px');
  const [slideAnimate, setSlideAnimate] = useState(false);
  const navTimer = useRef(null);

  useEffect(() => {
    if (!enterDir) return undefined;
    const raf = requestAnimationFrame(() => {
      setSlideAnimate(true);
      setSlideX('0px');
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => clearTimeout(navTimer.current), []);

  useEffect(() => {
    if (order && !notesLoaded.current) {
      setNotes(order.production_notes || '');
      notesLoaded.current = true;
    }
  }, [order]);

  useEffect(() => {
    getMeta('orderDetailSectionOrder', DEFAULT_SECTION_ORDER).then(saved => {
      const known = new Set(DEFAULT_SECTION_ORDER);
      const filtered = (saved || []).filter(k => known.has(k));
      const missing = DEFAULT_SECTION_ORDER.filter(k => !filtered.includes(k));
      setSectionOrder([...filtered, ...missing]);
    });
  }, []);

  function moveSection(key, dir) {
    setSectionOrder(prev => {
      const p = order && getPermissions(order);
      const visible = prev.filter(k => (k !== 'photos' || p?.photosVisible) && (k !== 'checklist' || p?.checklist));
      const visIdx = visible.indexOf(key);
      const swapVisIdx = visIdx + dir;
      if (swapVisIdx < 0 || swapVisIdx >= visible.length) return prev;
      const idx = prev.indexOf(key);
      const otherIdx = prev.indexOf(visible[swapVisIdx]);
      const next = [...prev];
      [next[idx], next[otherIdx]] = [next[otherIdx], next[idx]];
      setMeta('orderDetailSectionOrder', next);
      return next;
    });
  }

  function onNotesChange(val) {
    setNotes(val);
    clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => mutations.notes(orderId, val), 600);
  }

  function goToStatus(target) {
    mutations.status(orderId, target);
  }

  // ── Carousel navigation: swipe left/right moves to the next/previous order
  // in whatever list the board had visible when this order was opened. ──
  const navIdx = (list || []).indexOf(orderId);
  const canPrev = navIdx > 0;
  const canNext = navIdx >= 0 && navIdx < (list?.length || 0) - 1;

  function onPointerDown(e) {
    drag.current = { startX: e.clientX, startY: e.clientY, moved: false, dragging: true };
  }
  function onPointerMove(e) {
    const s = drag.current;
    if (!s.dragging) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (!s.moved && Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    if (Math.abs(dy) > Math.abs(dx)) return; // vertical scroll — let it pass through
    s.moved = true;
    let clamped = dx;
    if (dx < 0 && !canNext) clamped = Math.max(dx, -EDGE_RESIST);
    if (dx > 0 && !canPrev) clamped = Math.min(dx, EDGE_RESIST);
    setSlideAnimate(false);
    setSlideX(`${clamped}px`);
  }
  function onPointerUp(e) {
    const s = drag.current;
    s.dragging = false;
    if (!s.moved) return;
    const dx = e.clientX - s.startX;
    setSlideAnimate(true);
    if (dx <= -SWIPE_THRESHOLD && canNext) {
      const targetId = list[navIdx + 1];
      setSlideX('-100%');
      navTimer.current = setTimeout(() => onNavigate(targetId, 'next'), ANIM_MS);
    } else if (dx >= SWIPE_THRESHOLD && canPrev) {
      const targetId = list[navIdx - 1];
      setSlideX('100%');
      navTimer.current = setTimeout(() => onNavigate(targetId, 'prev'), ANIM_MS);
    } else {
      setSlideX('0px'); // under threshold (or at an edge) — snap back
    }
  }

  if (!order) return <div className="cp-empty">Loading…</div>;

  const meta = getDisplayMeta(order);
  const perms = getPermissions(order);
  const idx = perms.locked ? -1 : STATUS_CHAIN.indexOf(order.production_status);
  const canForward = idx >= 0 && idx < STATUS_CHAIN.length - 1;
  const canBack = idx > 0;
  const forwardStatus = canForward ? STATUS_CHAIN[idx + 1] : null;
  const backStatus = canBack ? STATUS_CHAIN[idx - 1] : null;
  const photoBySlot = new Map((order.photos || []).map(p => [p.slot_number, p]));
  const visibleSections = sectionOrder.filter(k => (k !== 'photos' || perms.photosVisible) && (k !== 'checklist' || perms.checklist));

  function renderSection(key) {
    switch (key) {
      case 'cakeDetail':
        return (
          <>
            <div className="cp-detail-grid">
              <div><span className="cp-info-label">Shape</span><div className="cp-info-value-block">{order.shape_name || '—'}</div></div>
              <div><span className="cp-info-label">Sponge</span><div className="cp-info-value-block">{order.sponge_name || '—'}</div></div>
              <div><span className="cp-info-label">Cream</span><div className="cp-info-value-block">{order.cream_name || '—'}</div></div>
              <div><span className="cp-info-label">Theme</span><div className="cp-info-value-block">{order.theme_name || '—'}</div></div>
              <div><span className="cp-info-label">Dietary</span><div className="cp-info-value-block">{order.dietary_name || '—'}</div></div>
            </div>
            {order.design_notes && <div className="cp-note-block">{order.design_notes}</div>}
            {(order.dietary_notes || order.allergy_notes) && (
              <div className="cp-note-block cp-note-warning">
                ⚠ {[order.dietary_notes, order.allergy_notes].filter(Boolean).join(' · ')}
              </div>
            )}
            {order.internal_notes && (
              <div className="cp-note-block">
                <div className="cp-info-label">Internal Notes (POS)</div>
                {order.internal_notes}
              </div>
            )}
          </>
        );
      case 'images':
        return (order.images || []).length > 0 ? (
          <div className="cp-ref-gallery">
            {order.images.map(img => (
              <a key={img.id} href={img.image_url} target="_blank" rel="noreferrer">
                <img src={img.image_url} alt={img.image_name || ''} className="cp-ref-thumb" />
              </a>
            ))}
          </div>
        ) : (
          <div className="cp-empty" style={{ padding: 0 }}>No reference images.</div>
        );
      case 'moveStage':
        return (
          <div className="cp-status-row">
            {backStatus && (
              <button className="cp-status-btn" onClick={() => goToStatus(backStatus)}>
                ← {STATUS_META[backStatus]?.label || backStatus}
              </button>
            )}
            {forwardStatus && (
              <button className="cp-status-btn" onClick={() => goToStatus(forwardStatus)}>
                {STATUS_META[forwardStatus]?.label || forwardStatus} →
              </button>
            )}
            {!backStatus && !forwardStatus && <div className="cp-empty" style={{ padding: 0 }}>No further stages available.</div>}
          </div>
        );
      case 'photos':
        return (
          <div className="cp-photo-slots">
            {[1, 2, 3].map(slot => (
              <PhotoSlot key={slot} orderId={orderId} slot={slot} photo={photoBySlot.get(slot)} locked={!perms.photosUpload} />
            ))}
          </div>
        );
      case 'checklist':
        return <ChecklistPanel orderId={orderId} checklist={order.state?.checklist} locked={!perms.checklist} />;
      case 'tags':
        return <TagEditor orderId={orderId} tags={order.state?.tags} locked={!perms.tags} />;
      case 'notes':
        return <textarea className="cp-notes-textarea" value={notes} onChange={e => onNotesChange(e.target.value)} placeholder="Production notes…" disabled={!perms.notes} />;
      default:
        return null;
    }
  }

  return (
    <div className="cp-carousel-viewport">
      {canPrev && <div className="cp-carousel-hint cp-carousel-hint-left">‹</div>}
      {canNext && <div className="cp-carousel-hint cp-carousel-hint-right">›</div>}
      <div
        className="cp-carousel-page"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          touchAction: 'pan-y',
          transform: `translateX(${slideX})`,
          transition: slideAnimate ? `transform ${ANIM_MS}ms ${EASING}` : 'none',
        }}
      >
      {/* Fixed: Customer Detail (smaller font) */}
      <div className="cp-fixed-customer">
        <div className="cp-card-order">{order.order_number}</div>
        <div className="cp-customer-name">{order.customer_name}</div>
        <div className="cp-customer-date">
          {fmtDateWithDay(order.delivery_date)}{fmtTime(order.delivery_time) ? ` · ${fmtTime(order.delivery_time)}` : ''}
        </div>
        <span className="cp-status-pill" style={{ background: meta.color + '1a', color: meta.color, border: `1px solid ${meta.color}44` }}>
          {meta.label}
        </span>
      </div>

      {perms.cancelled && <div className="cp-cancelled-banner">CANCELLED</div>}

      {/* Fixed: Cake Section (bigger font) */}
      <div className="cp-fixed-cake">
        {(order.items || []).map((it, i) => (
          <div key={i} className="cp-cake-big-name">
            {it.product_name}{it.variant_name ? ` – ${it.variant_name}` : ''}
            <span className="cp-cake-specs-inline">{it.size ? ` ${it.size}` : ''} ×{it.qty || 1}</span>
          </div>
        ))}
        {order.message_on_cake && <div className="cp-cake-message">"{order.message_on_cake}"</div>}
      </div>

      {visibleSections.map((key, i) => (
        <div className="cp-section" key={key}>
          <div className="cp-section-header-row">
            <div className="cp-section-title">{SECTION_LABELS[key]}</div>
            <div className="cp-reorder-btns">
              <button className="cp-reorder-btn" disabled={i === 0} onClick={() => moveSection(key, -1)}>▲</button>
              <button className="cp-reorder-btn" disabled={i === visibleSections.length - 1} onClick={() => moveSection(key, 1)}>▼</button>
            </div>
          </div>
          {renderSection(key)}
        </div>
      ))}

      <button className="cp-btn cp-btn--ghost" onClick={onBack}>← Back to board</button>
      </div>
    </div>
  );
}
