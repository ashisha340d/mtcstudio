import { useEffect, useMemo, useState } from 'react';
import { toUtcMs, formatNepalTime, formatNepalDate, getNepalDateStr } from '../../../utils/dateTime';

function fmtCountdown(ms) {
  if (ms <= 0) return null;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return { h, m, s };
}

export default function ScheduledOrderCard({ row, index, flash, arrive, onOpen, onConvert, onCancel, onDelete }) {
  const isScheduled = row.kind === 'SCHEDULED';

  // Second-level tick so "Send After" counts down live
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isScheduled) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [isScheduled]);

  const items = useMemo(() => {
    try { return row.items_json ? JSON.parse(row.items_json) : []; } catch { return []; }
  }, [row.items_json]);

  const scheduledMs = isScheduled ? toUtcMs(row.scheduled_for) : 0;
  const sendAtMs = scheduledMs - (row.notify_before_min || 0) * 60000;
  const countdown = isScheduled ? fmtCountdown(sendAtMs - Date.now()) : null;

  const caption = row.order_caption || `${isScheduled ? 'Scheduled' : 'Draft'} #${index + 1}`;
  const isToday = isScheduled && String(row.scheduled_for).slice(0, 10) === getNepalDateStr();

  // OCR draft that couldn't resolve items → review card (empty/unmatched), shown red.
  const isReview = !isScheduled && (row.order_caption === 'MK-REVIEW' || items.length === 0);

  return (
    <div
      className={`oc ${isScheduled ? 'oc--scheduledorder' : 'oc--draftpending'}${isReview ? ' oc--review' : ''}${flash ? ' oc--flash' : ''}${arrive ? ' oc--arrive' : ''}`}
      onClick={() => onOpen(row)}
    >
      {row.order_notes && (
        <span className="oc__notes-icon" title={row.order_notes}>✉︎</span>
      )}

      <div className="oc__header">
        <span className="oc__icon">{isScheduled ? '⏰' : '📝'}</span>
        <div className="oc__header-text">
          <div className="oc__type">
            {caption}
            <span className={`oc__draft-badge ${isScheduled ? 'oc__badge--sched' : ''}`}>
              {isScheduled ? 'SCHEDULED' : 'DRAFT'}
            </span>
          </div>
          {isScheduled ? (
            <div className="soc__times">
              <div>Order For: <b>{isToday ? '' : formatNepalDate(row.scheduled_for) + ' '}{formatNepalTime(row.scheduled_for)}</b></div>
              <div>KOT @ <b>{formatNepalTime(sendAtMs)}</b></div>
              {countdown
                ? <div className="soc__ticker">Send After: {countdown.h > 0 && <span className="soc__ticker-num">{countdown.h}H </span>}<span className="soc__ticker-num">{String(countdown.m).padStart(2, '0')}M </span><span className="soc__ticker-num">{String(countdown.s).padStart(2, '0')}S</span></div>
                : <div className="soc__ticker soc__ticker--due">Sending to KOT…</div>}
            </div>
          ) : (
            <div className="oc__timer">Manual process</div>
          )}
        </div>
      </div>

      <div className="oc__customer">
        <span className="oc__cust-name">{row.customer_name || '—'}</span>
        <span className="oc__cust-phone">{row.customer_phone || '—'}</span>
      </div>

      {isReview && (
        <div className="oc__review-note">
          ⚠ {items.length === 0 ? 'No items matched' : 'Verify items'}
        </div>
      )}

      <div className="oc__amount">
        ₹{(row.total_amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
        <span style={{ fontSize: 10, fontWeight: 600, marginLeft: 6, opacity: 0.7 }}>
          {items.length} item{items.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="oc__btn-row">
        <button
          title="Edit items / details"
          onClick={(e) => { e.stopPropagation(); onOpen(row); }}
          style={{
            flex: 1, padding: '4px 6px', borderRadius: 6, border: 'none',
            background: 'var(--fill-3)', color: 'var(--text-1)', fontSize: 9, fontWeight: 800,
            cursor: 'pointer', letterSpacing: '0.03em',
          }}
        >
          ✎ Edit
        </button>
        <button
          title={isScheduled ? 'Send to kitchen now' : 'Process this draft now'}
          onClick={(e) => { e.stopPropagation(); onConvert(row); }}
          style={{
            flex: 1, padding: '4px 6px', borderRadius: 6, border: 'none',
            background: isScheduled ? 'var(--indigo)' : 'var(--orange)', color: 'var(--on-accent)',
            fontSize: 9, fontWeight: 800, cursor: 'pointer', letterSpacing: '0.03em',
          }}
        >
          {isScheduled ? '🔥 Now' : '▶ Process'}
        </button>
        <button
          title="Cancel"
          onClick={(e) => { e.stopPropagation(); onCancel(row); }}
          style={{
            padding: '4px 7px', borderRadius: 6, border: '1px solid var(--red)',
            background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)',
            fontSize: 9, fontWeight: 800, cursor: 'pointer',
          }}
        >
          ✕
        </button>
        {onDelete && (
          <button
            title="Delete — wrong order"
            onClick={(e) => { e.stopPropagation(); onDelete(row); }}
            style={{
              padding: '4px 7px', borderRadius: 6, border: '1px solid var(--red)',
              background: 'color-mix(in srgb, var(--red) 78%, #000)', color: 'var(--on-accent)',
              fontSize: 9, fontWeight: 800, cursor: 'pointer',
            }}
          >
            🗑
          </button>
        )}
      </div>
    </div>
  );
}
