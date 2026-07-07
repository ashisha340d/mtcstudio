import { useEffect, useRef } from 'react';
import { useKDS } from '../../../context/KDSContext';
import { formatNepalTime, formatNepalTime24, toUtcMs } from '../../../utils/dateTime';

const TYPE_LABEL = {
  DINE_IN: 'TABLE ORDER',
  TAKEAWAY: 'TAKEAWAY',
  DELIVERY: 'DELIVERY',
  CAKE_ORDER: 'CAKE ORDER',
  QUICK_SALE: 'QUICK SALE',
};

/** Live ticker: MM:SS or HH:MM:SS */
function fmtTicker(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${String(h).padStart(2, '0')}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

/** Compact served duration: 15m 07s or 1h 02m 15s */
function fmtServedDuration(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  return `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

function ItemRow({ item, kot, isCheckedOut }) {
  const { markItemServed, unserveItem, elapsedMs, settings } = useKDS();
  const isServed = item.status === 'SERVED';
  const isCancelled = item.status === 'CANCELLED';

  const activeMsVal = elapsedMs(kot.created_at);
  const warnMs = (settings.delayWarningMins ?? 10) * 60000;
  const critMs = (settings.delayCriticalMins ?? 15) * 60000;
  const elapsedCls = activeMsVal > critMs ? 'item-elapsed--crit'
    : activeMsVal > warnMs ? 'item-elapsed--warn'
      : 'item-elapsed--ok';

  const servedDuration = isServed && item.served_at
    ? toUtcMs(item.served_at) - toUtcMs(kot.created_at)
    : 0;

  return (
    <div className={`ticket-item ${isServed ? 'ticket-item--served' : ''} ${isCancelled ? 'ticket-item--cancelled' : ''}`}>
      <div className="ticket-item__row">
        <span className="ticket-item__qty">{item.quantity}x</span>
        <span className={`ticket-item__name${isServed ? ' ticket-item__name--served' : ''}`}>
          {item.product_name}
          {item.is_home_pack ? <span className="ticket-item__hp">📦</span> : null}
        </span>
        {!isCancelled && (
          isServed ? (
            <span className="ticket-item__elapsed ticket-item__elapsed--served">
              ✓ {fmtServedDuration(servedDuration)}
            </span>
          ) : (
            <span className={`ticket-item__elapsed ticket-item__ticker ${elapsedCls}`}>
              {fmtTicker(activeMsVal)}
            </span>
          )
        )}
        {!isCancelled && (
          isServed ? (
            isCheckedOut ? (
              <span className="ticket-serve-btn ticket-serve-btn--locked">PAID</span>
            ) : (
              <button
                className="ticket-serve-btn ticket-serve-btn--undo"
                onClick={() => unserveItem({ kotId: kot.id, itemId: item.id })}
              >
                MARK UNSERVED
              </button>
            )
          ) : (
            <button
              className="ticket-serve-btn ticket-serve-btn--serve"
              onClick={() => markItemServed({ kotId: kot.id, itemId: item.id })}
            >
              MARK SERVED
            </button>
          )
        )}
      </div>
      {item.notes && (
        <div className="ticket-item__notes">Notes: {item.notes}</div>
      )}
    </div>
  );
}

// One card per pos_order — contains all KOTs
export default function KOTCard({ kot: order, showServed = false }) {
  const { settings, orderEarliestKotAt, elapsedMs, flashingOrders } = useKDS();

  const stationId = settings.activeDepartment ?? null;
  const isCheckedOut = order.order_status === 'CLOSED';

  // Build station-filtered KOT list, no cancelled.
  //  • Active view  (showServed=false): keep ALL items — served ones stay
  //    visible (struck through) so the whole order card remains on screen
  //    until every station item is served.
  //  • Served view  (showServed=true): show only served items.
  const visibleKots = (order.kots || []).reduce((acc, kot) => {
    const visibleItems = (stationId
      ? (kot.items || []).filter(i => i.station_id === stationId)
      : (kot.items || [])
    ).filter(i => i.status !== 'CANCELLED' && (!showServed || i.status === 'SERVED'));
    if (visibleItems.length === 0) return acc;
    acc.push({ ...kot, items: visibleItems });
    return acc;
  }, []);

  if (visibleKots.length === 0) return null;

  const earliest = orderEarliestKotAt(order);
  const elapsedMsV = elapsedMs(new Date(earliest).toISOString());
  const headerColor = settings.orderTypeColors?.[order.order_type] ?? '#2563eb';

  const who = order.order_type === 'DINE_IN'
    ? (order.table_name || 'TABLE')
    : (order.customer_name || TYPE_LABEL[order.order_type] || order.order_type);

  const inTime = formatNepalTime(earliest);

  const warnMs = (settings.delayWarningMins ?? 10) * 60000;
  const critMs = (settings.delayCriticalMins ?? 15) * 60000;
  const delayClass = elapsedMsV > critMs ? 'ticket--crit'
    : elapsedMsV > warnMs ? 'ticket--warn'
      : '';

  const flashType = flashingOrders?.[order.id];
  const flashClass = flashType === 'new_order' ? 'ticket--flash-new'
    : flashType === 'warning' ? 'ticket--flash-warn'
      : flashType === 'critical' ? 'ticket--flash-crit'
        : '';

  // Auto-scroll a freshly arrived order into view — staff on mobile can't
  // see the whole grid at once, so a new order at the bottom would go unnoticed.
  const cardRef = useRef(null);
  useEffect(() => {
    if (flashType === 'new_order') {
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [flashType]);

  return (
    <div ref={cardRef} className={`order-ticket ${delayClass} ${flashClass}`}>
      {/* ── Header ───────────────────────────── */}
      <div className="order-ticket__header" style={{ background: headerColor }}>
        <span className="order-ticket__who">{who}</span>
        <span className="order-ticket__intime">In Time- {inTime}</span>
      </div>

      {/* ── Checked-out banner ── */}
      {isCheckedOut && (
        <div className="order-ticket__paid-bar">
          ✓ PAID — CHECKED OUT
        </div>
      )}

      {/* ── KOT sections ── */}
      {visibleKots.map(kot => (
        <div key={kot.id} className="order-ticket__kot">
          <div className="order-ticket__kot-hdr">
            <div className="order-ticket__kot-left">
              <span className="order-ticket__kot-num">KOT  #{kot.kot_number}</span>
              <span className="order-ticket__kot-time">{formatNepalTime24(kot.created_at)}</span>
            </div>
            {kot.punched_by_emp && (
              <span className="order-ticket__server">Server : {kot.punched_by_emp}</span>
            )}
          </div>
          <div className="order-ticket__divider" />
          <div className="order-ticket__items">
            {kot.items.map(item => (
              <ItemRow key={item.id} item={item} kot={kot} isCheckedOut={isCheckedOut} />
            ))}
          </div>
        </div>
      ))}

      {/* ── Footer ───────────────────────────── */}

    </div>
  );
}
