import { useEffect, useMemo, useRef, useState } from 'react';
import { usePOS } from '../../../context/POSContext';

const SEEN_KEY = 'pos.notifications.seen';

const ICONS = { success: '✓', error: '⚠', info: 'ℹ' };

const timeOf = (iso) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

/** '2026-07-26T15:20:00Z' → '3 PM' — the hour bucket a row is filed under. */
const hourOf = (iso) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });

/**
 * Bottom-right bell + slide-in history of everything notify() raised today.
 * The log lives in POSContext (persisted per business day); this only reads it.
 */
export default function NotificationCenter() {
  const { ui, clearNotifications } = usePOS();
  const log = ui.notifications || [];

  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState(() => localStorage.getItem(SEEN_KEY) || '');
  const panelRef = useRef(null);

  const unread = useMemo(
    () => (seenAt ? log.filter(n => n.at > seenAt).length : log.length),
    [log, seenAt]
  );

  /* Opening the panel is the "read" event. */
  useEffect(() => {
    if (!open) return;
    const now = new Date().toISOString();
    setSeenAt(now);
    try { localStorage.setItem(SEEN_KEY, now); } catch { /* quota */ }
  }, [open, log.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e) => { if (!panelRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  /* Newest first, bucketed by the hour it landed in. */
  const groups = useMemo(() => {
    const out = [];
    for (const n of log) {
      const label = hourOf(n.at);
      if (out[out.length - 1]?.label !== label) out.push({ label, items: [] });
      out[out.length - 1].items.push(n);
    }
    return out;
  }, [log]);

  return (
    <>
      <button
        className={`nc-bell${unread ? ' has-unread' : ''}`}
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        title={`Notifications — ${log.length} today`}
        aria-label="Notification history"
      >
        🔔
        {unread > 0 && <span className="nc-bell__badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      <div className={`nc-panel${open ? ' is-open' : ''}`} ref={panelRef} aria-hidden={!open}>
        <div className="nc-panel__head">
          <div>
            <div className="nc-panel__title">Notifications</div>
            <div className="nc-panel__sub">
              {log.length ? `${log.length} today` : 'Nothing yet today'}
            </div>
          </div>
          <div className="nc-panel__actions">
            {!!log.length && (
              <button className="nc-panel__clear" onClick={clearNotifications}>Clear all</button>
            )}
            <button className="nc-panel__close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
          </div>
        </div>

        <div className="nc-panel__body">
          {groups.map(g => (
            <div key={g.label} className="nc-group">
              <div className="nc-group__label">{g.label}</div>
              {g.items.map(n => (
                <div key={n.id} className={`nc-row nc-row--${n.type}`}>
                  <span className="nc-row__icon">{ICONS[n.type] || 'ℹ'}</span>
                  <span className="nc-row__msg">{n.message}</span>
                  <span className="nc-row__time">{timeOf(n.at)}</span>
                </div>
              ))}
            </div>
          ))}

          {!log.length && (
            <div className="nc-empty">
              <div className="nc-empty__icon">🔕</div>
              <p>Alerts raised today — checkouts, drafts, kitchen updates — land here.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
