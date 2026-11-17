import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { systemApi } from '../../services/api';
import {
  toBS, formatNp, formatEn, toNpDigits, BS_WEEKDAYS_NP, todayNepalAD,
} from '../../lib/nepaliDate';
import './nepaliDateChip.css';

const AD_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const AD_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const fmtAD = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${AD_MONTHS[m - 1]} ${y}`;
};
const weekdayOf = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
};

const awayLabel = (n) => (n === 1 ? 'tomorrow' : `in ${n} days`);

/**
 * Today's Bikram Sambat date + Nepal holiday status, with a click-through
 * panel of upcoming holidays.
 * @param {'menubar'|'chrome'} variant  menubar = dark OS bar, chrome = light window bar
 */
export default function NepaliDateChip({ variant = 'menubar' }) {
  const [today, setToday] = useState(todayNepalAD);
  const [info, setInfo] = useState(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  /* Roll over at midnight without a reload. */
  useEffect(() => {
    const id = setInterval(() => setToday(todayNepalAD()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let dead = false;
    const pull = () => systemApi.holidays({ days: 400, limit: 10 })
      .then(r => { if (!dead) setInfo(r.data); })
      .catch(() => {});
    pull();
    const id = setInterval(pull, 3_600_000);
    return () => { dead = true; clearInterval(id); };
  }, [today]);

  /* The panel is portalled to <body> — POS windows clip their own overflow. */
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    };
    place();
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  const bs = useMemo(() => toBS(today), [today]);
  const isHoliday = !!info?.todayHolidays?.length;
  const upcoming = info?.upcoming || [];

  return (
    <>
      <button
        ref={btnRef}
        className={`nd-chip nd-chip--${variant}${isHoliday ? ' is-holiday' : ''}`}
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        title={bs ? `${formatEn(bs)} BS · ${fmtAD(today)}` : fmtAD(today)}
      >
        <span className="nd-chip__np">{bs ? formatNp(bs) : fmtAD(today)}</span>
        {isHoliday
          ? <span className="nd-chip__flag">बिदा</span>
          : upcoming[0] && <span className="nd-chip__dot" title={`${upcoming[0].title} — ${awayLabel(upcoming[0].daysAway)}`} />}
      </button>

      {open && pos && createPortal(
        <div className="nd-panel" ref={panelRef} style={{ top: pos.top, right: pos.right }}>
          <div className="nd-panel__head">
            <div className="nd-panel__big">{bs ? formatNp(bs) : fmtAD(today)}</div>
            <div className="nd-panel__sub">
              {bs && <>{formatEn(bs)} BS · </>}{fmtAD(today)} · {AD_WEEKDAYS[weekdayOf(today)]}
              {bs && <> ({BS_WEEKDAYS_NP[bs.weekday]})</>}
            </div>
          </div>

          <div className={`nd-panel__status${isHoliday ? ' is-holiday' : ''}`}>
            {isHoliday
              ? <>🎉 Public holiday — {info.todayHolidays.join(', ')}</>
              : <>✅ Working day</>}
          </div>

          <div className="nd-panel__list-title">Upcoming holidays</div>
          <div className="nd-panel__list">
            {upcoming.map(h => {
              const hbs = toBS(h.date);
              return (
                <div key={`${h.date}-${h.title}`} className="nd-panel__row">
                  <span className="nd-panel__row-title" title={h.title}>{h.title}</span>
                  <span className="nd-panel__row-when">
                    <b>{fmtAD(h.date)}</b>
                    {hbs && <i>{formatNp(hbs)}</i>}
                    <em>{awayLabel(h.daysAway)}</em>
                  </span>
                </div>
              );
            })}
            {!upcoming.length && (
              <div className="nd-panel__empty">
                {info ? 'No holidays in the next 400 days.' : 'Loading holiday feed…'}
              </div>
            )}
          </div>

          {info?.count != null && (
            <div className="nd-panel__foot">
              {toNpDigits(info.count)} holidays loaded · officeholidays.com/ics/nepal
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
