import { memo } from 'react';
import { tapLight } from '../lib/haptics';
import Icon from './Icon';

// Material 3 navigation bar: 80dp tall, 24dp icon inside a pill-shaped
// active indicator, label underneath. The indicator is one element that
// slides between slots on transform alone.
const TABS = [
  { id: 'floor', icon: 'grid',    label: 'Floor' },
  { id: 'open',  icon: 'receipt', label: 'Orders' },
  { id: 'serve', icon: 'service', label: 'बाकी' },
];

function BottomNav({ tab, onChange, badges = {} }) {
  const idx = TABS.findIndex(t => t.id === tab);

  return (
    <nav className="wn" role="tablist">
      {/* Sliding M3 active indicator — sits behind the icons */}
      <span className="wn-pill" style={{ '--i': idx < 0 ? 0 : idx }} aria-hidden="true" />

      {TABS.map(t => {
        const active = tab === t.id;
        const n = badges[t.id] || 0;
        return (
          <button
            key={t.id}
            role="tab"
            className={`wn-item${active ? ' is-active' : ''}`}
            onClick={() => { if (!active) { tapLight(); onChange(t.id); } }}
            aria-selected={active}
            aria-label={`${t.label}${n > 0 ? `, ${n} pending` : ''}`}
          >
            <span className="wn-icon">
              <Icon name={t.icon} size={24} />
              {/* key={n} remounts on every change so the pop animation replays */}
              {n > 0 && (
                <span key={n} className={`wn-badge${n > 9 ? ' is-wide' : ''}`}>
                  {n > 99 ? '99+' : n}
                </span>
              )}
            </span>
            <span className="wn-label">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default memo(BottomNav);
