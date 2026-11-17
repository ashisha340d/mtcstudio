/* Sales Calendar — Google-Calendar-shaped view of POS sales.
   One fetch per visible range (cached + neighbour-prefetched), then every view
   is rendered from that payload, so switching Day/Week/Month/Year is instant. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import posApi from '../../../services/posApi';
import { TimeGrid, MonthGrid, YearGrid } from './CalendarViews';
import {
  VIEWS, PAYMENT_SERIES, WEEKDAYS_MIN, MONTHS_LONG,
  viewRange, periodTitle, shiftAnchor, buildSeries, holidayIndex,
  addDays, addMonths, startOfMonth, endOfMonth,
  dayNum, dayOfWeek, monthOf, fmtExact, hourLabel, dateLabel,
} from './calendarUtils';
import { todayNepal, fmtMoney, fmtQty } from '../reportUtils';
import './salesCalendar.css';

const LS_KEY = 'reports.calendar.v1';

const loadPrefs = () => {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
};
const savePrefs = (p) => {
  try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch { /* quota */ }
};

export default function SalesCalendar({ seedDate, seedCategoryIds = [], seedProductIds = [], categories = [], products = [] }) {
  const prefs = useRef(loadPrefs()).current;

  const [view, setView] = useState(prefs.view || 'month');
  const [anchor, setAnchor] = useState(seedDate || todayNepal());
  const [sidebar, setSidebar] = useState(prefs.sidebar !== false);
  const [showHolidays, setShowHolidays] = useState(prefs.showHolidays !== false);
  const [selection, setSelection] = useState(() => ({
    payments: prefs.payments || ['TOTAL', 'CASH', 'QR', 'LEDGER'],
    categoryIds: seedCategoryIds.length ? seedCategoryIds.map(String) : (prefs.categoryIds || []),
    categoryMeasure: prefs.categoryMeasure || 'amount',
    productIds: seedProductIds.length ? seedProductIds.map(String) : (prefs.productIds || []),
    productMeasure: prefs.productMeasure || 'qty',
    stationIds: prefs.stationIds || [],
    stationMeasure: prefs.stationMeasure || 'amount',
    badges: prefs.badges || [],
    badgeMeasure: prefs.badgeMeasure || 'qty',
  }));
  const [openSections, setOpenSections] = useState(() => ({
    payments: true, categories: true, items: false, stations: false,
    badges: false, overlays: false, totals: true,
    ...(prefs.openSections || {}),
  }));

  const [meta, setMeta] = useState({ stations: [], badges: [] });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [popover, setPopover] = useState(null);
  const [isFull, setIsFull] = useState(false);

  const rootRef = useRef(null);
  const cache = useRef(new Map());

  const today = todayNepal();
  const range = useMemo(() => viewRange(view, anchor), [view, anchor]);

  useEffect(() => {
    savePrefs({ view, sidebar, showHolidays, openSections, ...selection });
  }, [view, sidebar, showHolidays, openSections, selection]);

  useEffect(() => {
    posApi.getCalendarMeta().then(setMeta).catch(() => {});
  }, []);

  /* ── Fetch ──────────────────────────────────────────────── */
  const include = useMemo(() => {
    const parts = ['payments'];
    if (selection.categoryIds.length) parts.push('categories');
    if (selection.productIds.length) parts.push('products');
    if (selection.stationIds.length) parts.push('stations');
    if (selection.badges.length) parts.push('badges');
    return parts.join(',');
  }, [selection.categoryIds, selection.productIds, selection.stationIds, selection.badges]);

  const params = useCallback((r) => ({
    from: r.from, to: r.to, bucket: r.bucket, include,
    category_ids: selection.categoryIds.join(',') || undefined,
    product_ids: selection.productIds.join(',') || undefined,
    station_ids: selection.stationIds.join(',') || undefined,
    badges: selection.badges.join(',') || undefined,
  }), [include, selection.categoryIds, selection.productIds, selection.stationIds, selection.badges]);

  const load = useCallback(async (r, { silent = false } = {}) => {
    const p = params(r);
    const key = JSON.stringify(p);
    if (cache.current.has(key)) return cache.current.get(key);
    if (!silent) { setLoading(true); setError(null); }
    try {
      const res = await posApi.getCalendarReport(p);
      cache.current.set(key, res);
      return res;
    } catch (err) {
      if (!silent) setError(err.response?.data?.error || err.message || 'Failed to load calendar');
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    let dead = false;
    let timer = null;
    load(range).then(res => {
      if (dead) return;                 // a newer range won the race
      if (res) setData(res);
      // Warm the neighbours so ‹ › lands instantly.
      const prev = viewRange(view, shiftAnchor(view, anchor, -1));
      const next = viewRange(view, shiftAnchor(view, anchor, 1));
      timer = setTimeout(() => { load(prev, { silent: true }); load(next, { silent: true }); }, 400);
    });
    return () => { dead = true; clearTimeout(timer); };
  }, [load, range, view, anchor]);

  const refresh = () => {
    cache.current.clear();
    setData(null);
    load(range).then(res => { if (res) setData(res); });
  };

  /* ── Derived ────────────────────────────────────────────── */
  const series = useMemo(() => buildSeries(data, selection), [data, selection]);
  const holidays = useMemo(
    () => (showHolidays ? holidayIndex(data?.holidays) : new Map()),
    [data, showHolidays]
  );

  const grandTotals = useMemo(
    () => series.map(s => ({ s, v: s.total })).filter(x => x.v),
    [series]
  );

  /* ── Fullscreen ─────────────────────────────────────────── */
  useEffect(() => {
    const onChange = () => setIsFull(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else rootRef.current?.requestFullscreen?.();
  };

  /* ── Keyboard: Google's j/k/t/d/w/m/y shortcuts ──────────── */
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.matches?.('input, textarea, select')) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') return setPopover(null);
      if (k === 'j' || e.key === 'ArrowLeft') setAnchor(a => shiftAnchor(view, a, -1));
      else if (k === 'k' || e.key === 'ArrowRight') setAnchor(a => shiftAnchor(view, a, 1));
      else if (k === 't') setAnchor(today);
      else if (k === 'd') setView('day');
      else if (k === 'w') setView('week');
      else if (k === 'm') setView('month');
      else if (k === 'y') setView('year');
    };
    const el = rootRef.current;
    el?.addEventListener('keydown', onKey);
    return () => el?.removeEventListener('keydown', onKey);
  }, [view, today]);

  /* ── Block click → popover + lazy detail ────────────────── */
  const openBlock = useCallback(async (payload) => {
    const rect = payload.anchorEl.getBoundingClientRect();
    const base = { ...payload, rect, detail: null, detailLoading: false };
    setPopover(base);

    const { scope, dates, hour } = payload;
    let from = null, to = null;
    if (scope === 'hour') {
      from = `${dates[0]} ${String(hour).padStart(2, '0')}:00:00`;
      to = `${dates[0]} ${String(hour).padStart(2, '0')}:59:59`;
    } else if (scope === 'day' || scope === 'week') {
      from = `${dates[0]} 00:00:00`;
      to = `${dates[dates.length - 1]} 23:59:59`;
    }
    if (!from) return;

    setPopover(p => (p ? { ...p, detailLoading: true } : p));
    try {
      const detail = await posApi.getCalendarDetail(from, to);
      setPopover(p => (p && p.anchorEl === payload.anchorEl ? { ...p, detail, detailLoading: false } : p));
    } catch {
      setPopover(p => (p ? { ...p, detailLoading: false } : p));
    }
  }, []);

  const jumpToDay = (date, mode = 'day') => { setAnchor(date); setView(mode); setPopover(null); };

  /* ── Selection helpers ──────────────────────────────────── */
  const toggle = (field, value) => setSelection(s => {
    const list = s[field];
    const key = String(value);
    return { ...s, [field]: list.includes(key) ? list.filter(x => x !== key) : [...list, key] };
  });

  const toggleSection = (key) => setOpenSections(s => ({ ...s, [key]: !s[key] }));

  const gridProps = {
    days: range.days, series, holidays, today, anchor,
    onBlock: openBlock, onDayClick: jumpToDay,
  };

  return (
    <div className={`gc-root${isFull ? ' is-full' : ''}`} ref={rootRef} tabIndex={-1}>
      {/* ── Top bar ──────────────────────────────────────── */}
      <header className="gc-bar">
        <button className="gc-icon" title="Toggle side panel" onClick={() => setSidebar(v => !v)}>☰</button>
        <span className="gc-logo">📅 Sales Calendar</span>

        <button className="gc-today" onClick={() => setAnchor(today)}>Today</button>
        <div className="gc-nav">
          <button className="gc-icon" title="Previous (J)" onClick={() => setAnchor(a => shiftAnchor(view, a, -1))}>‹</button>
          <button className="gc-icon" title="Next (K)" onClick={() => setAnchor(a => shiftAnchor(view, a, 1))}>›</button>
        </div>
        <h2 className="gc-period">{periodTitle(view, anchor)}</h2>

        {loading && <span className="gc-loading">Loading…</span>}
        {error && <span className="gc-error" title={error}>{error}</span>}

        <div className="gc-bar-right">
          <div className="gc-viewtoggle">
            {VIEWS.map(v => (
              <button
                key={v.key}
                className={view === v.key ? 'active' : ''}
                onClick={() => setView(v.key)}
                title={`${v.label} view (${v.label[0]})`}
              >{v.label}</button>
            ))}
          </div>
          <button className="gc-icon" title="Refresh data" onClick={refresh}>⟳</button>
          <button className="gc-icon" title={isFull ? 'Exit full screen' : 'Full screen'} onClick={toggleFull}>
            {isFull ? '⤡' : '⛶'}
          </button>
        </div>
      </header>

      <div className="gc-body">
        {/* ── Side panel ─────────────────────────────────── */}
        {sidebar && (
          <aside className="gc-side">
            <MiniMonth anchor={anchor} today={today} onPick={(d) => setAnchor(d)} />

            <Section
              title="Payments" count={selection.payments.length}
              open={openSections.payments} onToggle={() => toggleSection('payments')}
            >
              {PAYMENT_SERIES.map(p => (
                <label key={p.code} className="gc-check">
                  <input
                    type="checkbox"
                    checked={selection.payments.includes(p.code)}
                    onChange={() => toggle('payments', p.code)}
                    style={{ accentColor: p.color }}
                  />
                  <i className="gc-swatch" style={{ background: p.color }} />
                  <span>{p.label}</span>
                </label>
              ))}
            </Section>

            <PickerSection
              title="Category Sales"
              options={categories.map(c => ({ id: String(c.id), name: c.name }))}
              selected={selection.categoryIds}
              onToggle={(id) => toggle('categoryIds', id)}
              onClear={() => setSelection(s => ({ ...s, categoryIds: [] }))}
              measure={selection.categoryMeasure}
              onMeasure={(m) => setSelection(s => ({ ...s, categoryMeasure: m }))}
              open={openSections.categories}
              onToggleOpen={() => toggleSection('categories')}
            />

            <PickerSection
              title="Item Sales"
              options={products.map(p => ({ id: String(p.id), name: p.name, group: p.category_name }))}
              selected={selection.productIds}
              onToggle={(id) => toggle('productIds', id)}
              onClear={() => setSelection(s => ({ ...s, productIds: [] }))}
              measure={selection.productMeasure}
              onMeasure={(m) => setSelection(s => ({ ...s, productMeasure: m }))}
              open={openSections.items}
              onToggleOpen={() => toggleSection('items')}
            />

            <PickerSection
              title="Stations"
              options={meta.stations}
              selected={selection.stationIds}
              onToggle={(id) => toggle('stationIds', id)}
              onClear={() => setSelection(s => ({ ...s, stationIds: [] }))}
              measure={selection.stationMeasure}
              onMeasure={(m) => setSelection(s => ({ ...s, stationMeasure: m }))}
              open={openSections.stations}
              onToggleOpen={() => toggleSection('stations')}
              search={false}
            />

            <PickerSection
              title="Badges"
              options={meta.badges.map(b => ({ id: b.id, name: b.name, group: `${b.products} items` }))}
              selected={selection.badges}
              onToggle={(id) => toggle('badges', id)}
              onClear={() => setSelection(s => ({ ...s, badges: [] }))}
              measure={selection.badgeMeasure}
              onMeasure={(m) => setSelection(s => ({ ...s, badgeMeasure: m }))}
              open={openSections.badges}
              onToggleOpen={() => toggleSection('badges')}
              search={false}
            />

            <Section
              title="Overlays" count={showHolidays ? 1 : 0}
              open={openSections.overlays} onToggle={() => toggleSection('overlays')}
            >
              <label className="gc-check">
                <input type="checkbox" checked={showHolidays} onChange={() => setShowHolidays(v => !v)} />
                <i className="gc-swatch" style={{ background: '#7a869a' }} />
                <span>Nepal holidays{data?.holidays?.length ? ` (${data.holidays.length})` : ''}</span>
              </label>
            </Section>

            {!!grandTotals.length && (
              <Section
                title={`Period total — ${periodTitle(view, anchor)}`}
                open={openSections.totals} onToggle={() => toggleSection('totals')}
              >
                {grandTotals.map(({ s, v }) => (
                  <div key={s.id} className="gc-sidetotal">
                    <i className="gc-swatch" style={{ background: s.color }} />
                    <span className="gc-sidetotal-label">{s.label}</span>
                    <strong>{fmtExact(v, s.unit)}</strong>
                  </div>
                ))}
              </Section>
            )}
          </aside>
        )}

        {/* ── Grid ───────────────────────────────────────── */}
        <main className="gc-main">
          {!series.length ? (
            <div className="gc-empty">
              <div className="gc-empty-icon">🗓</div>
              <h3>Nothing plotted</h3>
              <p>Pick payment tenders, categories or items in the side panel to plot them on the calendar.</p>
            </div>
          ) : view === 'year' ? (
            <YearGrid {...gridProps} />
          ) : view === 'month' ? (
            <MonthGrid {...gridProps} />
          ) : (
            <TimeGrid {...gridProps} showTotal={view === 'week'} />
          )}
        </main>
      </div>

      {popover && (
        <BlockPopover
          data={popover}
          series={series}
          onClose={() => setPopover(null)}
          onOpenDay={jumpToDay}
        />
      )}
    </div>
  );
}

/* ── Side-panel building blocks ─────────────────────────────── */

function Section({ title, children, open = true, onToggle, count = 0, extra }) {
  return (
    <div className="gc-section">
      <div className="gc-section-title">
        <button className="gc-sectbtn" onClick={onToggle} aria-expanded={open}>
          <i className={`gc-caret${open ? ' is-open' : ''}`}>▸</i>
          <span>{title}</span>
          {!open && !!count && <em className="gc-count">{count}</em>}
        </button>
        {open && extra}
      </div>
      {open && children}
    </div>
  );
}

function PickerSection({
  title, options, selected, onToggle, onClear, measure, onMeasure,
  open = true, onToggleOpen, search = true,
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? options.filter(o => o.name.toLowerCase().includes(needle) || (o.group || '').toLowerCase().includes(needle))
      : options;
    return list.slice(0, 300);
  }, [options, q]);

  return (
    <Section
      title={title}
      open={open}
      onToggle={onToggleOpen}
      count={selected.length}
      extra={!!selected.length && <button className="gc-clear" onClick={onClear}>clear ({selected.length})</button>}
    >
      <div className="gc-measure">
        {['qty', 'amount', 'both'].map(m => (
          <button key={m} className={measure === m ? 'active' : ''} onClick={() => onMeasure(m)}>
            {m === 'qty' ? 'QT' : m === 'amount' ? 'Amount' : 'Both'}
          </button>
        ))}
      </div>
      {search && (
        <input className="gc-search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" />
      )}
      <div className="gc-list">
        {filtered.map(o => (
          <label key={o.id} className="gc-check">
            <input
              type="checkbox"
              checked={selected.includes(o.id)}
              onChange={() => onToggle(o.id)}
              style={o.color ? { accentColor: o.color } : undefined}
            />
            {o.color && <i className="gc-swatch" style={{ background: o.color }} />}
            <span className="gc-check-name" title={o.group ? `${o.name} · ${o.group}` : o.name}>{o.name}</span>
          </label>
        ))}
        {!filtered.length && <div className="gc-list-empty">No match</div>}
      </div>
    </Section>
  );
}

function MiniMonth({ anchor, today, onPick }) {
  const [cursor, setCursor] = useState(startOfMonth(anchor));
  useEffect(() => { setCursor(startOfMonth(anchor)); }, [anchor]);

  const first = startOfMonth(cursor);
  const lead = dayOfWeek(first);
  const last = Number(endOfMonth(cursor).slice(8, 10));
  const cells = Array.from({ length: last }, (_, i) => addDays(first, i));

  return (
    <div className="gc-mininav">
      <div className="gc-mininav-head">
        <button className="gc-icon gc-icon--sm" onClick={() => setCursor(c => addMonths(c, -1))}>‹</button>
        <span>{MONTHS_LONG[monthOf(cursor)]} {cursor.slice(0, 4)}</span>
        <button className="gc-icon gc-icon--sm" onClick={() => setCursor(c => addMonths(c, 1))}>›</button>
      </div>
      <div className="gc-mininav-dows">{WEEKDAYS_MIN.map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="gc-mininav-grid">
        {Array.from({ length: lead }, (_, i) => <span key={`p${i}`} />)}
        {cells.map(d => (
          <button
            key={d}
            className={`${d === anchor ? 'is-anchor' : ''}${d === today ? ' is-today' : ''}`}
            onClick={() => onPick(d)}
          >{dayNum(d)}</button>
        ))}
      </div>
    </div>
  );
}

/* ── Detail popover ─────────────────────────────────────────── */

function BlockPopover({ data, series, onClose, onOpenDay }) {
  const ref = useRef(null);
  const { rect, series: s, value, dates, hour, scope, detail, detailLoading } = data;

  useEffect(() => {
    const onDown = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const W = 340;
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - W / 2), window.innerWidth - W - 8);
  const openDown = rect.bottom + 340 < window.innerHeight;
  const style = openDown
    ? { left, top: rect.bottom + 8, width: W }
    : { left, bottom: Math.max(8, window.innerHeight - rect.top + 8), width: W };

  const when = scope === 'hour'
    ? `${dateLabel(dates[0])} · ${hourLabel(hour)} – ${hourLabel((hour + 1) % 24)}`
    : scope === 'week-hour'
      ? `${dateLabel(dates[0])} – ${dateLabel(dates[dates.length - 1])} · ${hourLabel(hour)}`
      : scope === 'week'
        ? `Week of ${dateLabel(dates[0])} – ${dateLabel(dates[dates.length - 1])}`
        : dateLabel(dates[0]);

  return (
    <div className="gc-pop" ref={ref} style={style}>
      <div className="gc-pop-actions">
        <button className="gc-icon gc-icon--sm" title="Open this day" onClick={() => onOpenDay(dates[0])}>⤢</button>
        <button className="gc-icon gc-icon--sm" title="Close" onClick={onClose}>✕</button>
      </div>

      <div className="gc-pop-head">
        <i className="gc-pop-dot" style={{ background: s.color }} />
        <div>
          <h3>{s.label}: {fmtExact(value, s.unit)}</h3>
          <div className="gc-pop-when">{when}</div>
        </div>
      </div>

      {scope === 'week-hour' && (
        <div className="gc-pop-sec">
          <div className="gc-pop-sec-title">Per day at {hourLabel(hour)}</div>
          {dates.map(d => {
            const v = s.days.get(d)?.hours[hour] || 0;
            if (!v) return null;
            return (
              <div key={d} className="gc-pop-row">
                <span>{dateLabel(d)}</span><strong>{fmtExact(v, s.unit)}</strong>
              </div>
            );
          })}
        </div>
      )}

      {scope !== 'week-hour' && (
        <div className="gc-pop-sec">
          <div className="gc-pop-sec-title">Other plotted series</div>
          {series.filter(o => o.id !== s.id).map(o => {
            const v = scope === 'hour'
              ? (o.days.get(dates[0])?.hours[hour] || 0)
              : dates.reduce((a, d) => a + (o.days.get(d)?.total || 0), 0);
            if (!v) return null;
            return (
              <div key={o.id} className="gc-pop-row">
                <span><i className="gc-swatch" style={{ background: o.color }} /> {o.label}</span>
                <strong>{fmtExact(v, o.unit)}</strong>
              </div>
            );
          })}
        </div>
      )}

      {detailLoading && <div className="gc-pop-loading">Loading breakdown…</div>}

      {detail && (
        <>
          <div className="gc-pop-sec">
            <div className="gc-pop-sec-title">Timeframe totals</div>
            <div className="gc-pop-row"><span>Orders</span><strong>{fmtQty(detail.orders)}</strong></div>
            <div className="gc-pop-row"><span>Sales</span><strong>{fmtMoney(detail.amount)}</strong></div>
            {!!detail.discount && <div className="gc-pop-row"><span>Discount</span><strong>{fmtMoney(detail.discount)}</strong></div>}
            {detail.tenders.map(t => (
              <div key={t.method} className="gc-pop-row"><span>{t.method}</span><strong>{fmtMoney(t.amount)}</strong></div>
            ))}
          </div>

          {!!detail.categories.length && (
            <div className="gc-pop-sec">
              <div className="gc-pop-sec-title">Categories</div>
              {detail.categories.slice(0, 8).map(c => (
                <div key={c.name} className="gc-pop-row">
                  <span>{c.name}</span><strong>{fmtQty(c.qty)} · {fmtMoney(c.amount)}</strong>
                </div>
              ))}
            </div>
          )}

          {!!detail.items.length && (
            <div className="gc-pop-sec">
              <div className="gc-pop-sec-title">Top items</div>
              {detail.items.slice(0, 10).map(it => (
                <div key={it.name} className="gc-pop-row">
                  <span title={it.category_name}>{it.name}</span>
                  <strong>{fmtQty(it.qty)} · {fmtMoney(it.amount)}</strong>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
