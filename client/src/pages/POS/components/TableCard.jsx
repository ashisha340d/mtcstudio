import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePOS } from '../../../context/POSContext';
import { toUtcMs } from '../../../utils/dateTime';
import { printReceipt } from './ThermalReceipt';
import { flyToCashStack } from './flyToCashStack';

function fmtDuration(ms) {
  if (!ms || ms <= 0) return null;
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function TableCard({ table, onClick, onDirectCheckout, frozenOrderIds }) {
  const { tableOrderMap, orders, kotsByOrder, isOrderDelayed } = usePOS();
  const orderId = tableOrderMap[table.id];
  const order = orderId ? orders[orderId] : null;

  // Tick every minute so the elapsed-time timer advances on its own
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const derived = useMemo(() => {
    if (!order) return null;
    const kots = kotsByOrder[orderId] || [];
    const allItems = kots.flatMap((k) => k.items || []);
    const total = allItems.filter((i) => i.status !== 'CANCELLED').length;
    const served = allItems.filter((i) => i.status === 'SERVED').length;
    return {
      occupiedMs: Date.now() - toUtcMs(order.created_at),
      total,
      served,
    };
  }, [order, kotsByOrder, orderId, tick]);

  const delayed = orderId ? isOrderDelayed(orderId) : false;
  const isDraft = order?.status === 'SAVED';

  // Treat order as empty if no active KOT items and no draft cart items
  const hasContent = useMemo(() => {
    if (!order) return false;
    const kots = kotsByOrder[orderId] ?? [];
    if (kots.some(k => (k.items ?? []).some(i => i.status !== 'CANCELLED'))) return true;
    try { return order.draft_items && JSON.parse(order.draft_items).length > 0; } catch { return false; }
  }, [order, kotsByOrder, orderId]);

  // Snapshot the last occupied render (data + on-screen rect) so a paid-off
  // table wipes out and sends its total to the cash drawer instead of
  // instantly popping to the empty state. Checkout flips the order to
  // CLOSED (and drops it from tableOrderMap) well before the cashier
  // dismisses the Payment Complete modal — while frozenOrderIds still
  // holds this order's id, keep showing it as occupied so the wipe only
  // plays once that modal is actually gone.
  const lastOccupiedRef = useRef(null);
  const lastRectRef = useRef(null);
  const lastOrderIdRef = useRef(null);
  const wasOccupiedRef = useRef(false);
  if (order && hasContent) {
    lastOccupiedRef.current = { order, derived, isDraft, delayed };
    lastOrderIdRef.current = order.id;
  }
  const measureRef = (el) => { if (el) lastRectRef.current = el.getBoundingClientRect(); };

  const held = (!order || !hasContent) && frozenOrderIds?.has(lastOrderIdRef.current);
  const looksOccupied = (order && hasContent) || held;

  const [wiping, setWiping] = useState(false);
  // useLayoutEffect (not useEffect) so the switch to the wiping snapshot
  // happens before paint — no one-frame flash of the empty table.
  useLayoutEffect(() => {
    if (looksOccupied) { wasOccupiedRef.current = true; return; }
    if (wasOccupiedRef.current) {
      wasOccupiedRef.current = false;
      flyToCashStack(lastRectRef.current, { amount: lastOccupiedRef.current?.order?.total_amount });
      setWiping(true);
      const t = setTimeout(() => setWiping(false), 750);
      return () => clearTimeout(t);
    }
  }, [looksOccupied]);

  function onPrintSlip(e) {
    e.stopPropagation();
    const kots = kotsByOrder[orderId] || [];
    const items = kots.flatMap((k) => k.items || []).filter((i) => i.status !== 'CANCELLED');
    printReceipt({ order: { ...order, table_name: table.name }, items, payments: [] });
  }

  // Empty table — desktop icon style. While held (payment modal still up)
  // or mid-wipe, keep rendering the last occupied snapshot instead.
  if (!order || !hasContent) {
    if (held && lastOccupiedRef.current) {
      const s = lastOccupiedRef.current;
      return (
        <OccupiedCard table={table} onClick={onClick} onPrintSlip={onPrintSlip}
          onDirectCheckout={onDirectCheckout} order={s.order} derived={s.derived}
          isDraft={s.isDraft} delayed={s.delayed} measureRef={measureRef} frozen />
      );
    }
    if (wiping && lastOccupiedRef.current) {
      const s = lastOccupiedRef.current;
      return (
        <OccupiedCard table={table} onClick={onClick} onPrintSlip={onPrintSlip}
          onDirectCheckout={onDirectCheckout} order={s.order} derived={s.derived}
          isDraft={s.isDraft} delayed={s.delayed} wiping />
      );
    }
    return (
      <div className="tc tc--empty tc--empty-in" onClick={() => onClick(table)}>
        <div className="tc__icon-empty">🪑</div>
        <div className="tc__name">{table.name}</div>
        <div className="tc__seats">{table.capacity} seats</div>
        <div className="tc__avail">Available</div>
      </div>
    );
  }

  // Occupied / Draft table
  return (
    <OccupiedCard table={table} onClick={onClick} onPrintSlip={onPrintSlip}
      onDirectCheckout={onDirectCheckout} order={order} derived={derived}
      isDraft={isDraft} delayed={delayed} measureRef={measureRef} />
  );
}

function OccupiedCard({ table, onClick, onPrintSlip, onDirectCheckout, order, derived, isDraft, delayed, wiping, frozen, measureRef }) {
  return (
    <div
      ref={measureRef}
      className={`tc ${isDraft ? 'tc--draft' : 'tc--occupied'}${delayed ? ' tc--delayed' : ''}${wiping ? ' tc--wiping' : ''}`}
      style={frozen ? { pointerEvents: 'none', opacity: 0.85 } : undefined}
      onClick={frozen ? undefined : () => onClick(table)}
    >
      <div className="tc__header">
        <span className="tc__name">{table.name}</span>
        <span className="tc__timer">{fmtDuration(derived.occupiedMs)}</span>
      </div>

      <div className="tc__amount">
        ₹{(order.total_amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
      </div>

      {derived.total > 0 && (
        <div className="tc__progress-row">
          <div className="tc__dots">
            {Array.from({ length: Math.min(derived.total, 10) }, (_, i) => (
              <span
                key={i}
                className={`tc__dot${i < derived.served ? ' tc__dot--served' : ''}`}
              />
            ))}
            {derived.total > 10 && <span className="tc__dots-more">+{derived.total - 10}</span>}
          </div>
          <span className={`tc__ratio${derived.served === derived.total ? ' tc__ratio--all' : derived.served > 0 ? ' tc__ratio--partial' : ''}`}>
            {derived.served}/{derived.total} READY
          </span>
        </div>
      )}

      {isDraft ? (
        <button
          className="tc__checkout-btn"
          onClick={(e) => { e.stopPropagation(); onClick(table); }}
        >
          Open Draft →
        </button>
      ) : (
        <div>
          <button className="tc__slip-btn" onClick={onPrintSlip} title="Print slip"
            style={{
              flex: 1, padding: '6px 8px', borderRadius: 7, border: 'none',
              background: '#ffffff', color: '#000000', fontSize: 10, fontWeight: 800,
              cursor: 'pointer', letterSpacing: '0.03em',
            }}> 🖨 Slip
          </button>
          <button

            onClick={(e) => { e.stopPropagation(); onDirectCheckout(order.id); }}

            style={{
              flex: 1, padding: '6px 8px', borderRadius: 7, border: 'none',
              background: '#ee682f', color: '#fff', fontSize: 10, fontWeight: 800,
              cursor: 'pointer', letterSpacing: '0.03em',
            }}
          >
            💳 Pay

          </button>
        </div>
      )}
      {wiping && (
        <>
          <div className="tc__wipe-sweep" />
          <div className="tc__paid-stamp"><span>PAID ✓</span></div>
        </>
      )}
    </div>
  );
}
