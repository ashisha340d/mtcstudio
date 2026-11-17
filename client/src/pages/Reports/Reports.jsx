import { useState, useEffect, useMemo, useCallback } from 'react';
import posApi from '../../services/posApi';
import MultiSelect from './MultiSelect';
import RankedSummary, { buildRankedColumns, rankedTotals, sortRanked } from './RankedSummary';
import MonthlySummary, { buildMonthlyColumns, monthlyTotals, pivotMonthly } from './MonthlySummary';
import ZeroSales, { buildZeroSalesColumns } from './ZeroSales';
import PaymentRegister, { buildPaymentColumns, paymentTotals } from './PaymentRegister';
import SalesCalendar from './Calendar/SalesCalendar';
import WeeklyPatternChart from './WeeklyPatternChart';
import MonthlyFilterModal from './MonthlyFilterModal';
import MonthlySortModal from './MonthlySortModal';
import {
  todayNepal, periodLabel, resolveRange, fmtStamp, fmtQty, fmtMoney, fmtDate,
  basisOf, measureLabel, weekday, MONTHS, ORDER_TYPE_LABELS, downloadCSV,
} from './reportUtils';
import './Reports.css';

/* Report registry — add a report by appending one entry + its fetch case. */
const REPORTS = [
  { key: 'payment-register', label: 'Sales Register — Daily Tender', title: 'Sales Register — Daily Tender Split', kind: 'payment', period: 'range', measure: false },
  { key: 'weekly-pattern', label: 'Sales Pattern By Hour', title: 'Sales Pattern By Hour', kind: 'weekly-pattern', period: 'range', measure: false },
  { key: 'calendar', label: 'Sales Calendar — Plotted by Time', title: 'Sales Calendar', kind: 'calendar', period: 'range', categories: true, products: true, measure: false },
  { key: 'order-type', label: 'Sales by Order Type', title: 'Sales by Order Type', kind: 'ranked', variant: 'order-type', period: 'range' },
  { key: 'category', label: 'Category Summary', title: 'Category Summary', kind: 'ranked', variant: 'category', period: 'range', categories: true, drill: true },
  { key: 'product', label: 'Product Summary', title: 'Product Summary', kind: 'ranked', variant: 'product', period: 'range', categories: true, products: true },
  { key: 'monthly-item', label: 'Monthly Summary — Item By Month', title: 'Monthly Summary — Item By Month', kind: 'monthly', variant: 'item', filterType: 'products', period: 'year' },
  { key: 'monthly-category', label: 'Monthly Summary — Category By Month', title: 'Monthly Summary — Category By Month', kind: 'monthly', variant: 'category', filterType: 'categories', period: 'year' },
  { key: 'monthly-order-type', label: 'Monthly Summary — Order Type By Month', title: 'Monthly Summary — Order Type By Month', kind: 'monthly', variant: 'order-type', filterType: 'order-types', period: 'year' },
  { key: 'zero-sales', label: 'Zero Sales', title: 'Zero Sales — Items With No Movement', kind: 'zero', period: 'range', categories: true, measure: false },
];
const byKey = (k) => REPORTS.find(r => r.key === k) || REPORTS[0];
const MONTHLY_GROUP_LABEL = { item: 'Item', category: 'Category', 'order-type': 'Order Type' };
const MONTHLY_GROUP_LABEL_PLURAL = { item: 'Items', category: 'Categories', 'order-type': 'Order Types' };

const SORT_KEY = 'mtc_monthly_item_sort';
const loadSort = () => { try { return JSON.parse(localStorage.getItem(SORT_KEY)) || null; } catch { return null; } };

const idList = (arr) => (arr && arr.length ? arr.join(',') : undefined);

function fetchReport(c) {
  const { from, to } = resolveRange(c);
  const cats = idList(c.categoryIds);
  const prods = idList(c.productIds);
  switch (c.report) {
    case 'calendar': return Promise.resolve([]);
    case 'weekly-pattern': return posApi.getWeeklyPatternReport(from, to);
    case 'payment-register': return posApi.getPaymentRegisterReport(from, to);
    case 'order-type': return posApi.getOrderTypeSummaryReport(from, to);
    case 'category': return posApi.getCategorySummaryReport(from, to, cats);
    case 'product': return posApi.getProductSummaryReport(from, to, cats, prods);
    case 'monthly-item': return posApi.getMonthlySummaryReport({ year: c.year, group: 'item', product_ids: idList(c.monthlyProductIds) });
    case 'monthly-category': return posApi.getMonthlySummaryReport({ year: c.year, group: 'category', category_ids: idList(c.monthlyCategoryIds) });
    case 'monthly-order-type': return posApi.getMonthlySummaryReport({ year: c.year, group: 'order-type', order_types: idList(c.orderTypes) });
    case 'zero-sales': return posApi.getZeroSalesReport(from, to, cats);
    default: return Promise.resolve([]);
  }
}

const initialCriteria = () => ({
  report: 'category',
  mode: 'day',
  date: todayNepal(),
  from: todayNepal(),
  to: todayNepal(),
  month: todayNepal().slice(0, 7),
  year: new Date().getFullYear(),
  categoryIds: [],
  productIds: [],
  orderTypes: [],
  monthlyProductIds: [],
  monthlyCategoryIds: [],
});

export default function Reports() {
  const [draft, setDraft] = useState(initialCriteria);
  const [applied, setApplied] = useState(null);
  const [drillFrom, setDrillFrom] = useState(null);   // criteria to restore on Back
  const [rows, setRows] = useState([]);
  const [chartData, setChartData] = useState(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [itemSort, setItemSort] = useState(loadSort);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [metric, setMetric] = useState('qty');
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);

  const draftDef = byKey(draft.report);
  const appliedDef = applied ? byKey(applied.report) : null;
  const showMeasure = draftDef.measure !== false;

  useEffect(() => {
    posApi.getCategories().then(setCategories).catch(() => setCategories([]));
    posApi.getProducts().then(setProducts).catch(() => setProducts([]));
  }, []);

  const set = (patch) => setDraft(d => ({ ...d, ...patch }));

  const run = useCallback((criteria, { keepDrill = false } = {}) => {
    if (!keepDrill) setDrillFrom(null);
    // Nothing explicitly picked in the Categories / Items filters a report
    // uses → select all of them, so "Generate" with nothing touched still
    // reads as an explicit all-selected choice instead of an implicit
    // empty filter (the checkboxes reflect it too, not just the query).
    // The Calendar report has its own opt-in plot picker (and its own
    // persisted preferences) — an empty selection there means "nothing
    // plotted yet", not "everything", so it's excluded from this default.
    // Monthly Summary's Filter modal is opt-in scoping on top of an
    // already-complete year — it has no `categories`/`products` flag here,
    // so it's naturally out of this default too.
    const def = byKey(criteria.report);
    let next = criteria;
    let changed = false;
    if (def.kind !== 'calendar' && def.categories && !criteria.categoryIds.length && categories.length) {
      next = { ...next, categoryIds: categories.map(c => c.id) };
      changed = true;
    }
    if (def.kind !== 'calendar' && def.products && !criteria.productIds.length && products.length) {
      next = { ...next, productIds: products.map(p => p.id) };
      changed = true;
    }
    if (changed) setDraft(next);
    setApplied({ ...next, stamp: new Date() });
  }, [categories, products]);

  useEffect(() => {
    if (!applied) return;
    const kind = byKey(applied.report).kind;
    // The calendar owns its own fetching — it re-queries as the user navigates.
    if (kind === 'calendar') { setRows([]); setChartData(null); setError(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchReport(applied)
      .then(data => {
        if (cancelled) return;
        if (kind === 'weekly-pattern') { setChartData(data || null); setRows([]); }
        else if (kind === 'monthly') {
          const raw = Array.isArray(data?.rows) ? data.rows : [];
          // Order-type rows key on the raw enum (DINE_IN, …) — the pivot's
          // display name is built straight from `name`, so label it here.
          const monthlyRows = byKey(applied.report).variant === 'order-type'
            ? raw.map(r => ({ ...r, name: ORDER_TYPE_LABELS[r.name] || r.name }))
            : raw;
          setRows(monthlyRows);
          setChartData(null);
        } else { setRows(Array.isArray(data) ? data : []); setChartData(null); }
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.response?.data?.error || err.message || 'Failed to generate report');
        setRows([]);
        setChartData(null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [applied]);

  /* Category row click → same period, scoped to that category, as Product Summary
     — with every product under it pre-checked, not left as an implicit "all". */
  const handleDrill = (row) => {
    if (!appliedDef?.drill || !Number.isFinite(Number(row.id))) return;
    setDrillFrom(applied);
    const catId = Number(row.id);
    const productIds = products.filter(p => Number(p.category_id) === catId).map(p => p.id);
    const next = { ...applied, report: 'product', categoryIds: [catId], productIds };
    setDraft(next);
    setApplied({ ...next, stamp: new Date() });
  };

  const handleBack = () => {
    if (!drillFrom) return;
    setDraft(drillFrom);
    setApplied({ ...drillFrom, stamp: new Date() });
    setDrillFrom(null);
  };

  const productOptions = useMemo(
    () => products.map(p => ({ id: p.id, name: p.name, group: p.category_name })),
    [products]
  );
  const categoryOptions = useMemo(
    () => categories.map(c => ({ id: c.id, name: c.name })),
    [categories]
  );
  const orderTypeOptions = useMemo(
    () => Object.entries(ORDER_TYPE_LABELS).map(([id, name]) => ({ id, name })),
    []
  );
  const filterOptions = { products: productOptions, categories: categoryOptions, 'order-types': orderTypeOptions };
  const filterField = { products: 'monthlyProductIds', categories: 'monthlyCategoryIds', 'order-types': 'orderTypes' };
  const filterModalTitle = { products: 'Filter — Items', categories: 'Filter — Categories', 'order-types': 'Filter — Order Types' };

  const kpis = useMemo(() => {
    if (!applied || !appliedDef) return null;

    if (appliedDef.kind === 'weekly-pattern') {
      const days = (chartData?.weekdays || []).filter(w => w.days > 0);
      if (!days.length) return null;
      let total = 0, peakDay = days[0], peakDayTotal = -1, peakHour = null, peakHourVal = -1;
      for (const w of days) {
        const dayTotal = w.hours.reduce((s, v) => s + v, 0);
        total += dayTotal * w.days;
        if (dayTotal > peakDayTotal) { peakDayTotal = dayTotal; peakDay = w; }
        w.hours.forEach((v, h) => { if (v > peakHourVal) { peakHourVal = v; peakHour = { label: w.label, h }; } });
      }
      const hh = (h) => `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`;
      return [
        { label: 'Total Sales (period)', value: fmtMoney(total) },
        { label: 'Busiest Weekday', value: peakDay.label },
        { label: 'Peak Hour', value: peakHour ? `${peakHour.label} ${hh(peakHour.h)}` : '—' },
        { label: 'Weekdays With Sales', value: fmtQty(days.length) },
      ];
    }

    if (!rows.length) return null;
    const basis = basisOf(metric);

    if (appliedDef.kind === 'payment') {
      const t = paymentTotals(rows);
      const busiest = [...rows].sort((a, b) => b.total - a.total)[0];
      return [
        { label: 'Total Sales', value: fmtMoney(t.total) },
        { label: 'Days', value: fmtQty(rows.length) },
        { label: 'Cash Share', value: `${t.total ? ((t.CASH / t.total) * 100).toFixed(1) : '0.0'}%` },
        { label: 'Busiest Day', value: `${fmtDate(busiest.date)} · ${weekday(busiest.date)}` },
      ];
    }

    if (appliedDef.kind === 'zero') {
      const never = rows.filter(r => !r.last_sold).length;
      return [
        { label: 'Items With No Sales', value: fmtQty(rows.length) },
        { label: 'Never Sold', value: fmtQty(never) },
        { label: 'Previously Sold', value: fmtQty(rows.length - never) },
      ];
    }

    if (appliedDef.kind === 'monthly') {
      const pivoted = pivotMonthly(rows, metric);
      const t = monthlyTotals(pivoted);
      const bestIdx = t.months.reduce((best, m, i) => (m[basis] > t.months[best][basis] ? i : best), 0);
      return [
        { label: 'Total Amount', value: fmtMoney(t.amount) },
        { label: 'Total Qty', value: fmtQty(t.qty) },
        { label: MONTHLY_GROUP_LABEL_PLURAL[appliedDef.variant] || 'Items', value: fmtQty(pivoted.length) },
        { label: 'Peak Month', value: MONTHS[bestIdx] },
      ];
    }

    const t = rankedTotals(rows);
    const top = sortRanked(rows, metric)[0];
    const topName = appliedDef.variant === 'order-type'
      ? (ORDER_TYPE_LABELS[top.name] || top.name)
      : top.name;
    return [
      { label: 'Total Amount', value: fmtMoney(t.amount) },
      { label: 'Total Qty', value: fmtQty(t.qty) },
      { label: appliedDef.variant === 'order-type' ? 'Orders' : 'Lines', value: fmtQty(appliedDef.variant === 'order-type' ? t.orders : rows.length) },
      { label: `Top by ${basis === 'qty' ? 'Qty' : 'Amount'}`, value: topName },
    ];
  }, [applied, appliedDef, rows, metric, chartData]);

  const handleExport = () => {
    if (!rows.length || !appliedDef) return;
    const { from, to } = resolveRange(applied);
    const suffix = appliedDef.kind === 'monthly' ? applied.year : `${from}_${to}`;
    const name = `${applied.report}-${suffix}.csv`;

    if (appliedDef.kind === 'monthly') {
      const pivoted = pivotMonthly(rows, metric, applied.report === 'monthly-item' ? itemSort : null);
      downloadCSV(name, buildMonthlyColumns(metric, monthlyTotals(pivoted), MONTHLY_GROUP_LABEL[appliedDef.variant] || 'Item'), pivoted);
    } else if (appliedDef.kind === 'zero') {
      downloadCSV(name, buildZeroSalesColumns(), rows);
    } else if (appliedDef.kind === 'payment') {
      downloadCSV(name, buildPaymentColumns(), rows);
    } else {
      const sorted = sortRanked(rows, metric);
      downloadCSV(name, buildRankedColumns(appliedDef.variant, metric, rankedTotals(sorted)[basisOf(metric)]), sorted);
    }
  };

  const isMonthly = appliedDef?.kind === 'monthly';
  const appliedCatIds = isMonthly ? (appliedDef.filterType === 'categories' ? applied.monthlyCategoryIds : []) : (appliedDef?.categories ? applied.categoryIds : []);
  const appliedCatNames = (appliedCatIds || [])
    .map(id => categories.find(c => String(c.id) === String(id))?.name)
    .filter(Boolean);
  const appliedProdCount = (isMonthly ? (appliedDef.filterType === 'products' ? applied.monthlyProductIds : []) : (appliedDef?.products ? applied.productIds : []))?.length || 0;
  const appliedOrderTypeNames = (appliedDef?.filterType === 'order-types' ? applied.orderTypes || [] : []).map(id => ORDER_TYPE_LABELS[id] || id);

  /* Remount the view whenever report or measure changes so no stale rows survive. */
  const viewKey = `${applied?.report}-${metric}-${applied?.stamp?.getTime()}`;

  return (
    <div className="rp-reports">
      {/* ── Criteria panel ─────────────────────────────── */}
      <div className="rp-criteria">
        <div className="rp-criteria-row">
          <label className="rp-field">
            <span>Report</span>
            <select value={draft.report} onChange={e => set({ report: e.target.value })}>
              {REPORTS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </label>

          {draftDef.period === 'range' ? (
            <>
              <label className="rp-field">
                <span>View By</span>
                <select value={draft.mode} onChange={e => set({ mode: e.target.value })}>
                  <option value="day">For the Day</option>
                  <option value="range">From Date — To Date</option>
                  <option value="month">Month</option>
                  <option value="year">Year</option>
                </select>
              </label>

              {draft.mode === 'day' && (
                <label className="rp-field">
                  <span>Date</span>
                  <input type="date" value={draft.date} max={todayNepal()} onChange={e => set({ date: e.target.value })} />
                </label>
              )}
              {draft.mode === 'range' && (
                <>
                  <label className="rp-field">
                    <span>From</span>
                    <input type="date" value={draft.from} max={draft.to} onChange={e => set({ from: e.target.value })} />
                  </label>
                  <label className="rp-field">
                    <span>To</span>
                    <input type="date" value={draft.to} min={draft.from} max={todayNepal()} onChange={e => set({ to: e.target.value })} />
                  </label>
                </>
              )}
              {draft.mode === 'month' && (
                <label className="rp-field">
                  <span>Month</span>
                  <input type="month" value={draft.month} max={todayNepal().slice(0, 7)} onChange={e => set({ month: e.target.value })} />
                </label>
              )}
              {draft.mode === 'year' && (
                <label className="rp-field">
                  <span>Year</span>
                  <input type="number" min="2000" max="2100" value={draft.year} onChange={e => set({ year: Number(e.target.value) })} />
                </label>
              )}
            </>
          ) : (
            <label className="rp-field">
              <span>Year</span>
              <input type="number" min="2000" max="2100" value={draft.year} onChange={e => set({ year: Number(e.target.value) })} />
            </label>
          )}

          {/* plain divs, not <label> — a wrapping label would forward clicks
              into the dropdown's checkboxes and re-toggle them */}
          {draftDef.categories && (
            <div className="rp-field">
              <span>Categories</span>
              <MultiSelect
                value={draft.categoryIds}
                onChange={ids => set({ categoryIds: ids })}
                options={categoryOptions}
                allLabel="All Categories"
                placeholder="Search category…"
              />
            </div>
          )}

          {draftDef.products && (
            <div className="rp-field">
              <span>Items</span>
              <MultiSelect
                value={draft.productIds}
                onChange={ids => set({ productIds: ids })}
                options={productOptions}
                allLabel="All Items"
                placeholder="Search item…"
              />
            </div>
          )}

          {draftDef.filterType && (
            <div className="rp-field">
              <span>Filter</span>
              <button type="button" className="rp-filter-btn" onClick={() => setFilterOpen(true)}>
                {{ products: '🔍 Items', categories: '🔍 Categories', 'order-types': '🔍 Order Types' }[draftDef.filterType]}
                {!!draft[filterField[draftDef.filterType]].length && (
                  <span className="rp-filter-btn__count">{draft[filterField[draftDef.filterType]].length}</span>
                )}
              </button>
            </div>
          )}

          {showMeasure && (
            <div className="rp-field">
              <span>Measure</span>
              <div className="rp-toggle">
                <button type="button" className={metric === 'qty' ? 'active' : ''} onClick={() => setMetric('qty')}>Qty</button>
                <button type="button" className={metric === 'amount' ? 'active' : ''} onClick={() => setMetric('amount')}>Amount</button>
                <button type="button" className={metric === 'both' ? 'active' : ''} onClick={() => setMetric('both')}>Both</button>
              </div>
            </div>
          )}

          <button className="rp-generate" onClick={() => run(draft)} disabled={loading}>
            {loading ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>

      {/* ── Report canvas ──────────────────────────────── */}
      <div className={`rp-canvas${appliedDef?.kind === 'calendar' ? ' rp-canvas--flush' : ''}`}>
        {!applied && (
          <div className="rp-placeholder">
            <div className="rp-placeholder-icon">▤</div>
            <h2>No report generated</h2>
            <p>Select a report and period above, then click <strong>Generate</strong>.</p>
          </div>
        )}

        {applied && appliedDef?.kind === 'calendar' && (
          <SalesCalendar
            key={viewKey}
            seedDate={resolveRange(applied).from}
            seedCategoryIds={applied.categoryIds}
            seedProductIds={applied.productIds}
            categories={categories}
            products={products}
          />
        )}

        {applied && appliedDef && appliedDef.kind !== 'calendar' && (
          <div className="rp-sheet">
            <div className="rp-sheet-head">
              <div className="rp-sheet-id">
                {drillFrom && (
                  <button className="rp-back" onClick={handleBack}>
                    ← Back to {byKey(drillFrom.report).label}
                  </button>
                )}
                <div className="rp-meta">
                  <span><strong>Period:</strong> {appliedDef.kind === 'monthly' ? `Year ${applied.year}` : periodLabel(applied)}</span>
                  {!!appliedCatNames.length && (
                    <span><strong>Categories:</strong> {appliedCatNames.length > 3 ? `${appliedCatNames.length} selected` : appliedCatNames.join(', ')}</span>
                  )}
                  {!!appliedProdCount && <span><strong>Items:</strong> {appliedProdCount} selected</span>}
                  {!!appliedOrderTypeNames.length && (
                    <span><strong>Order Types:</strong> {appliedOrderTypeNames.join(', ')}</span>
                  )}
                  {appliedDef.measure !== false && <span><strong>Measure:</strong> {measureLabel(metric)}</span>}
                  <span><strong>Generated:</strong> {fmtStamp(applied.stamp)}</span>
                </div>
              </div>
              {kpis && !loading && (
                <div className="rp-kpis">
                  {kpis.map(k => (
                    <div key={k.label} className="rp-kpi">
                      <span className="rp-kpi-label">{k.label}</span>
                      <span className="rp-kpi-value" title={k.value}>{k.value}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="rp-sheet-actions">
                {applied.report === 'monthly-item' && <button onClick={() => setSortOpen(true)}>⇅ Sort</button>}
                <button onClick={handleExport} disabled={!rows.length}>Export CSV</button>
                <button onClick={() => window.print()} disabled={!rows.length && !chartData?.weekdays?.length}>Print</button>
              </div>
            </div>

            {error && <div className="rp-error">{error}</div>}

            {loading ? (
              <div className="rp-empty">Generating report…</div>
            ) : appliedDef.kind === 'weekly-pattern' ? (
              <WeeklyPatternChart key={viewKey} data={chartData} />
            ) : appliedDef.kind === 'payment' ? (
              <PaymentRegister key={viewKey} rows={rows} />
            ) : appliedDef.kind === 'zero' ? (
              <ZeroSales key={viewKey} rows={rows} />
            ) : appliedDef.kind === 'monthly' ? (
              <MonthlySummary key={viewKey} rows={rows} metric={metric} groupLabel={MONTHLY_GROUP_LABEL[appliedDef.variant] || 'Item'} sort={applied.report === 'monthly-item' ? itemSort : null} />
            ) : (
              <RankedSummary
                key={viewKey}
                variant={appliedDef.variant}
                rows={rows}
                metric={metric}
                onRowClick={appliedDef.drill ? handleDrill : undefined}
              />
            )}

            {appliedDef.drill && !!rows.length && !loading && (
              <div className="rp-hint">Click any category row to drill down to its product summary.</div>
            )}
            <div className="rp-footnote">
              {appliedDef.kind === 'zero'
                ? 'Active POS items with no closed sales line in the period. Values in NPR.'
                : 'Figures cover closed (settled) orders only. Values in NPR.'}
            </div>
          </div>
        )}
      </div>

      {sortOpen && (
        <MonthlySortModal
          value={itemSort}
          onSave={(v) => { localStorage.setItem(SORT_KEY, JSON.stringify(v)); setItemSort(v); }}
          onClose={() => setSortOpen(false)}
        />
      )}

      {filterOpen && draftDef.filterType && (
        <MonthlyFilterModal
          title={filterModalTitle[draftDef.filterType]}
          options={filterOptions[draftDef.filterType]}
          value={draft[filterField[draftDef.filterType]]}
          onApply={(ids) => set({ [filterField[draftDef.filterType]]: ids })}
          onClose={() => setFilterOpen(false)}
        />
      )}
    </div>
  );
}
