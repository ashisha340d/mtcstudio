import { useRef } from 'react';
import { useFlip } from '../lib/useFlip';
import { tapLight, tapMedium } from '../lib/haptics';
import MotionArt from './MotionArt';
import Icon from './Icon';

const fmt = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

// Flat freeform floor — no sections. Toggling "Occupied only" reflows the grid
// and every surviving card animates from its old box to its new one (FLIP).
export default function FloorGrid({
  tables, dataFor, filter, onFilterChange, loading,
  onSelect, onSwipeBill,
}) {
  const gridRef = useRef(null);
  const touch   = useRef({ x: 0, y: 0 });

  const rows = tables.map(t => ({ t, d: dataFor(t) }));
  const occupied = rows.filter(r => r.d.status !== 'vacant');
  const shown = filter === 'occupied' ? occupied : rows;

  useFlip(gridRef, `${filter}:${shown.map(r => r.t.id).join(',')}`);

  const onTouchStart = e => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchEnd = (e, t, status) => {
    const dx = e.changedTouches[0].clientX - touch.current.x;
    const dy = Math.abs(e.changedTouches[0].clientY - touch.current.y);
    if (dy > 40 || Math.abs(dx) < 50) return;      // vertical or short = tap
    if (dx > 0) { tapLight(); onSelect(t); }        // swipe right = open
    else if (status !== 'vacant') { tapMedium(); onSwipeBill(t); } // swipe left = bill
  };

  if (loading) return (
    <div className="w-floor">
      {Array.from({ length: 8 }).map((_, i) => <div key={i} className="w-tcard is-skeleton" />)}
    </div>
  );

  return (
    <>
      {/* M3 segmented button — outlined track, checkmark on the selected end */}
      <div className="w-floor-bar">
        <div className="w-seg" role="group" data-on={filter}>
          <span className="w-seg-thumb" aria-hidden="true" />
          <button
            className={filter === 'all' ? 'is-on' : ''}
            aria-pressed={filter === 'all'}
            onClick={() => { tapLight(); onFilterChange('all'); }}
          >
            <Icon name="check" size={18} className="w-seg-tick" />
            All <span>{rows.length}</span>
          </button>
          <button
            className={filter === 'occupied' ? 'is-on' : ''}
            aria-pressed={filter === 'occupied'}
            onClick={() => { tapLight(); onFilterChange('occupied'); }}
          >
            <Icon name="check" size={18} className="w-seg-tick" />
            Occupied <span>{occupied.length}</span>
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="w-empty">
          <MotionArt kind="floor" size={86} />
          <div className="w-empty-title">All tables free</div>
          <div className="w-empty-sub">Nothing occupied right now.</div>
        </div>
      ) : (
        <div className="w-floor" ref={gridRef}>
          {shown.map(({ t, d }) => (
            <button
              key={t.id}
              data-flip-key={t.id}
              className={`w-tcard w-ripple is-${d.status}${d.hasCall ? ' has-call' : ''}${d.billAsked ? ' has-bill' : ''}`}
              onTouchStart={onTouchStart}
              onTouchEnd={e => onTouchEnd(e, t, d.status)}
              onClick={() => { tapLight(); onSelect(t); }}
            >
              <span className="w-tcard-head">
                <span className="w-tcard-name">{t.name}</span>
                {d.hasCall && <span className="w-tcard-call" aria-label="needs assistance" />}
              </span>

              {d.status === 'vacant' ? (
                <span className="w-tcard-free">Free</span>
              ) : (
                <>
                  <span className="w-tcard-amt">{fmt(d.amount)}</span>
                  <span className="w-tcard-foot">
                    <span className={`w-dot ${d.heat}`} />{d.timer}
                    {d.sentCount > 0 && (
                      <span className="w-tcard-prog">
                        {d.readyCount}/{d.sentCount}
                        <span className="w-bar"><span style={{ transform: `scaleX(${d.sentCount ? d.readyCount / d.sentCount : 0})` }} /></span>
                      </span>
                    )}
                  </span>
                  {d.billAsked && (
                    <span className="w-tcard-bill">
                      <Icon name="receipt" size={12} />Bill
                    </span>
                  )}
                </>
              )}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
