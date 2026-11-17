/* The three calendar surfaces: a Google-style time grid (Day / Week), a month
   grid with a trailing week-total column, and a 12-up year grid. All of them
   report clicks through one `onBlock` callback so the popover stays generic. */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  WEEKDAYS_SHORT, WEEKDAYS_MIN, MONTHS_LONG, hourLabel, hourChipLabel,
  fmtValue, dayNum, dayOfWeek, monthOf, sumHour, sumDays, activeHours,
} from './calendarUtils';
import { MONTHS } from '../reportUtils';

const HOUR_H = 48;

const nepalNow = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => Number(parts.find(p => p.type === t)?.value || 0);
  return get('hour') + get('minute') / 60;
};

/* ── Day / Week ───────────────────────────────────────────── */

export function TimeGrid({ days, series, holidays, today, showTotal, onBlock, onDayClick }) {
  const scrollRef = useRef(null);
  const [now, setNow] = useState(nepalNow);
  const [sbw, setSbw] = useState(0);

  const hours = useMemo(() => Array.from({ length: 24 }, (_, h) => h), []);
  const firstActive = useMemo(() => activeHours(series, days)[0] ?? 8, [series, days]);

  useEffect(() => {
    const id = setInterval(() => setNow(nepalNow()), 60_000);
    return () => clearInterval(id);
  }, []);

  /* Open on the first hour that actually traded, like Google opens on 8am. */
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, (firstActive - 1) * HOUR_H);
  }, [firstActive]);

  /* Header/footer sit outside the scroller — pad them by its scrollbar so all
     three grids keep the same column edges. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setSbw(el.offsetWidth - el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const columns = [
    ...days.map(d => ({ key: d, dates: [d], date: d, isTotal: false })),
    ...(showTotal ? [{ key: '__total', dates: days, date: null, isTotal: true }] : []),
  ];

  const hasHolidays = days.some(d => holidays.has(d));

  return (
    <div className="gc-time" style={{ '--cols': columns.length, '--gc-sbw': `${sbw}px` }}>
      <div className="gc-time-head">
        <div className="gc-tz">GMT+05:45</div>
        {columns.map(col => col.isTotal ? (
          <div key={col.key} className="gc-dayhead gc-dayhead--total">
            <span className="gc-dayhead-dow">WEEK</span>
            <span className="gc-dayhead-num gc-dayhead-num--total">Σ</span>
          </div>
        ) : (
          <div key={col.key} className={`gc-dayhead${col.date === today ? ' is-today' : ''}`}>
            <span className="gc-dayhead-dow">{WEEKDAYS_SHORT[dayOfWeek(col.date)]}</span>
            <button className="gc-dayhead-num" onClick={() => onDayClick?.(col.date)}>
              {dayNum(col.date)}
            </button>
          </div>
        ))}
      </div>

      {hasHolidays && (
        <div className="gc-allday">
          <div className="gc-allday-label">Holiday</div>
          {columns.map(col => (
            <div key={col.key} className="gc-allday-cell">
              {!col.isTotal && (holidays.get(col.date) || []).map(t => (
                <span key={t} className="gc-holiday-chip" title={t}>{t}</span>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="gc-time-body" ref={scrollRef}>
        <div className="gc-time-inner" style={{ height: 24 * HOUR_H }}>
          <div className="gc-gutter">
            {hours.map(h => (
              <div key={h} className="gc-hour-label" style={{ height: HOUR_H }}>
                {h === 0 ? '' : hourLabel(h)}
              </div>
            ))}
          </div>

          {columns.map(col => {
            const isToday = col.date === today;
            return (
              <div key={col.key} className={`gc-col${col.isTotal ? ' gc-col--total' : ''}`}>
                {hours.map(h => <div key={h} className="gc-slot" style={{ height: HOUR_H }} />)}

                {isToday && (
                  <div className="gc-now" style={{ top: now * HOUR_H }}><i /></div>
                )}

                {hours.map(h => {
                  const entries = series
                    .map(s => ({ s, value: col.isTotal ? sumHour(s, col.dates, h) : (s.days.get(col.date)?.hours[h] || 0) }))
                    .filter(e => e.value);
                  if (!entries.length) return null;
                  return entries.map((e, i) => (
                    <button
                      key={`${h}-${e.s.id}`}
                      className="gc-block"
                      style={{
                        top: h * HOUR_H + 1,
                        height: HOUR_H - 3,
                        left: `calc(${(i / entries.length) * 100}% + 2px)`,
                        width: `calc(${100 / entries.length}% - 4px)`,
                        background: e.s.color,
                      }}
                      title={`${e.s.label} · ${hourLabel(h)} — ${fmtValue(e.value, e.s.unit)}`}
                      onClick={(ev) => onBlock({
                        anchorEl: ev.currentTarget,
                        series: e.s,
                        value: e.value,
                        dates: col.dates,
                        hour: h,
                        scope: col.isTotal ? 'week-hour' : 'hour',
                      })}
                    >
                      <span className="gc-block-label">{e.s.label}: {fmtValue(e.value, e.s.unit)}</span>
                      <span className="gc-block-time">{hourChipLabel(h)}</span>
                    </button>
                  ));
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className="gc-time-foot">
        <div className="gc-time-foot-label">Total</div>
        {columns.map(col => (
          <div key={col.key} className={`gc-time-foot-cell${col.isTotal ? ' is-total' : ''}`}>
            {series.map(s => {
              const v = sumDays(s, col.dates);
              if (!v) return null;
              return (
                <span key={s.id} className="gc-foot-pill" style={{ '--c': s.color }}>
                  {s.label}: {fmtValue(v, s.unit)}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Month ────────────────────────────────────────────────── */

export function MonthGrid({ days, series, holidays, today, anchor, onBlock, onDayClick }) {
  const weeks = useMemo(() => {
    const out = [];
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7));
    return out;
  }, [days]);
  const activeMonth = monthOf(anchor);

  /* The hour a day's value peaked — what the chip prints as its time, so a
     month cell still reads "plotted by time" rather than as a bare total. */
  const peakHour = (s, date) => {
    const cell = s.days.get(date);
    if (!cell) return null;
    let best = -1, bestV = 0;
    for (let h = 0; h < 24; h++) if (cell.hours[h] > bestV) { bestV = cell.hours[h]; best = h; }
    return best < 0 ? null : best;
  };

  return (
    <div className="gc-month">
      <div className="gc-month-head">
        {WEEKDAYS_SHORT.map(d => <div key={d} className="gc-month-dow">{d}</div>)}
        <div className="gc-month-dow gc-month-dow--total">TOTAL</div>
      </div>

      <div className="gc-month-body">
        {weeks.map((week, wi) => (
          <div key={wi} className="gc-month-row">
            {week.map(date => (
              <div
                key={date}
                className={`gc-cell${monthOf(date) === activeMonth ? '' : ' is-outside'}${date === today ? ' is-today' : ''}`}
              >
                <div className="gc-cell-head">
                  <button className="gc-cell-num" onClick={() => onDayClick?.(date)}>
                    {dayNum(date) === 1 ? `${MONTHS[monthOf(date)]} ${dayNum(date)}` : dayNum(date)}
                  </button>
                </div>
                <div className="gc-cell-body">
                  {(holidays.get(date) || []).map(t => (
                    <span key={t} className="gc-holiday-chip" title={t}>{t}</span>
                  ))}
                  {series.map(s => {
                    const v = s.days.get(date)?.total || 0;
                    if (!v) return null;
                    const h = peakHour(s, date);
                    return (
                      <button
                        key={s.id}
                        className="gc-chip"
                        style={{ '--c': s.color }}
                        title={`${s.label} — ${fmtValue(v, s.unit)}`}
                        onClick={(ev) => onBlock({
                          anchorEl: ev.currentTarget,
                          series: s, value: v, dates: [date], hour: null, scope: 'day',
                        })}
                      >
                        <i className="gc-chip-dot" />
                        {h != null && <span className="gc-chip-time">{hourChipLabel(h)}</span>}
                        <span className="gc-chip-text">{s.label}: {fmtValue(v, s.unit)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="gc-cell gc-cell--total">
              <div className="gc-cell-head"><span className="gc-cell-num gc-cell-num--total">W{wi + 1}</span></div>
              <div className="gc-cell-body">
                {series.map(s => {
                  const v = sumDays(s, week);
                  if (!v) return null;
                  return (
                    <button
                      key={s.id}
                      className="gc-chip gc-chip--total"
                      style={{ '--c': s.color }}
                      onClick={(ev) => onBlock({
                        anchorEl: ev.currentTarget,
                        series: s, value: v, dates: week, hour: null, scope: 'week',
                      })}
                    >
                      <i className="gc-chip-dot" />
                      <span className="gc-chip-text">{s.label}: {fmtValue(v, s.unit)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>

      <MonthFooter weeks={weeks} series={series} activeMonth={activeMonth} />
    </div>
  );
}

/** Columnar roll-up under the month grid: every Sunday, every Monday…, plus a
    per-week average. Only days belonging to the month being viewed count. */
function MonthFooter({ weeks, series, activeMonth }) {
  const inMonth = (d) => d && monthOf(d) === activeMonth;
  const cols = WEEKDAYS_SHORT.map((dow, i) => ({
    dow, dates: weeks.map(w => w[i]).filter(inMonth),
  }));
  const allDates = cols.flatMap(c => c.dates);
  const weekCount = weeks.filter(w => w.some(inMonth)).length || 1;

  return (
    <div className="gc-month-foot">
      {cols.map(col => (
        <div key={col.dow} className="gc-month-foot-cell">
          <div className="gc-foot-cap">{col.dow} · {col.dates.length}</div>
          {series.map(s => {
            const total = sumDays(s, col.dates);
            if (!total) return null;
            return (
              <div key={s.id} className="gc-foot-line" style={{ '--c': s.color }}>
                <b>{fmtValue(total, s.unit)}</b>
                <span title={`Average per ${col.dow}`}>⌀ {fmtValue(total / (col.dates.length || 1), s.unit)}</span>
              </div>
            );
          })}
        </div>
      ))}

      <div className="gc-month-foot-cell is-total">
        <div className="gc-foot-cap">MONTH · {weekCount}w</div>
        {series.map(s => {
          const total = sumDays(s, allDates);
          if (!total) return null;
          return (
            <div key={s.id} className="gc-foot-line" style={{ '--c': s.color }}>
              <b>{fmtValue(total, s.unit)}</b>
              <span title="Average per week">⌀ {fmtValue(total / weekCount, s.unit)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Year ─────────────────────────────────────────────────── */

export function YearGrid({ days, series, holidays, today, anchor, onBlock, onDayClick }) {
  const primary = series[0] || null;
  const year = Number(anchor.slice(0, 4));

  const months = useMemo(() => {
    const out = Array.from({ length: 12 }, () => []);
    for (const d of days) out[monthOf(d)].push(d);
    return out;
  }, [days]);

  const max = useMemo(() => {
    if (!primary) return 0;
    let m = 0;
    for (const cell of primary.days.values()) m = Math.max(m, cell.total);
    return m;
  }, [primary]);

  return (
    <div className="gc-year">
      {months.map((dates, mi) => {
        const first = dates[0] || `${year}-${String(mi + 1).padStart(2, '0')}-01`;
        const lead = dayOfWeek(first);
        const monthTotals = series.map(s => ({ s, v: sumDays(s, dates) })).filter(x => x.v);
        return (
          <div key={mi} className="gc-mini">
            <div className="gc-mini-head">
              <button className="gc-mini-title" onClick={() => onDayClick?.(dates[0], 'month')}>
                {MONTHS_LONG[mi]}
              </button>
              {!!monthTotals.length && (
                <span className="gc-mini-total" title={monthTotals.map(x => `${x.s.label}: ${fmtValue(x.v, x.s.unit)}`).join('\n')}>
                  {fmtValue(monthTotals[0].v, monthTotals[0].s.unit)}
                </span>
              )}
            </div>
            <div className="gc-mini-dows">
              {WEEKDAYS_MIN.map((d, i) => <span key={i}>{d}</span>)}
            </div>
            <div className="gc-mini-grid">
              {Array.from({ length: lead }, (_, i) => <span key={`p${i}`} className="gc-mini-pad" />)}
              {dates.map(date => {
                const v = primary ? (primary.days.get(date)?.total || 0) : 0;
                const level = max > 0 && v > 0 ? Math.min(4, Math.ceil((v / max) * 4)) : 0;
                const isHoliday = holidays.has(date);
                return (
                  <button
                    key={date}
                    className={`gc-mini-day lv${level}${date === today ? ' is-today' : ''}${isHoliday ? ' is-holiday' : ''}`}
                    style={{ '--c': primary?.color || 'var(--t-accent)' }}
                    title={[
                      date,
                      ...(holidays.get(date) || []),
                      ...series.map(s => {
                        const sv = s.days.get(date)?.total || 0;
                        return sv ? `${s.label}: ${fmtValue(sv, s.unit)}` : null;
                      }).filter(Boolean),
                    ].join('\n')}
                    onClick={(ev) => (v && primary
                      ? onBlock({ anchorEl: ev.currentTarget, series: primary, value: v, dates: [date], hour: null, scope: 'day' })
                      : onDayClick?.(date))}
                  >
                    {dayNum(date)}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
