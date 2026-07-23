import { useState, useEffect, useMemo, useCallback } from 'react';
import posApi from '../../services/posApi';
import MultiSelect from './MultiSelect';
import RankedSummary, { buildRankedColumns, rankedTotals, sortRanked } from './RankedSummary';
import MonthlySummary, { buildMonthlyColumns, monthlyTotals, pivotMonthly } from './MonthlySummary';
import ZeroSales, { buildZeroSalesColumns } from './ZeroSales';
import PaymentRegister, { buildPaymentColumns, paymentTotals } from './PaymentRegister';
import {
  todayNepal, periodLabel, resolveRange, fmtStamp, fmtQty, fmtMoney, fmtDate,
  basisOf, measureLabel, weekday, MONTHS, ORDER_TYPE_LABELS, downloadCSV,
} from './reportUtils';
import './Reports.css';

/* Report registry — add a report by appending one entry + its fetch case. */
const REPORTS = [
  { key: 'payment-register', label: 'Sales Register — Daily Tender', title: 'Sales Register — Daily Tender Split', kind: 'payment', period: 'range', measure: false },
  { key: 'order-type', label: 'Sales by Order Type', title: 'Sales by Order Type', kind: 'ranked', variant: 'order-type', period: 'range' },
  { key: 'category', label: 'Category Summary', title: 'Category Summary', kind: 'ranked', variant: 'category', period: 'range', categories: true, drill: true },
  { key: 'product', label: 'Product Summary', title: 'Product Summary', kind: 'ranked', variant: 'product', period: 'range', categories: true, products: true },
  { key: 'monthly', label: 'Monthly Summary', title: 'Monthly Summary — Item by Month', kind: 'monthly', period: 'year', categories: true, products: true },
  { key: 'zero-sales', label: 'Zero Sales', title: 'Zero Sales — Items With No Movement', kind: 'zero', period: 'range', categories: true, measure: false },
];
const byKey = (k) => REPORTS.find(r => r.key === k) || REPORTS[0];

const idList = (arr) => (arr && arr.length ? arr.join(',') : undefined);

function fetchReport(c) {
  const { from, to } = resolveRange(c);
  const cats = idList(c.categoryIds);
  const prods = idList(c.productIds);
  switch (c.report) {
    case 'payment-register': return posApi.getPaymentRegisterReport(from, to);
    case 'order-type': return posApi.getOrderTypeSummaryReport(from, to);
    case 'category': return posApi.getCategorySummaryReport(from, to, cats);
    case 'product': return posApi.getProductSummaryReport(from, to, cats, prods);
    case 'monthly': return posApi.getMonthlySummaryReport(c.year, cats, prods);
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
});

export default function Reports() {
  const [draft, setDraft] = useState(initialCriteria);
  const [applied, setApplied] = useState(null);
  const [drillFrom, setDrillFrom] = useState(null);   // criteria to restore on Back
  const [rows, setRows] = useState([]);
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
    setApplied({ ...criteria, stamp: new Date() });
  }, []);

  useEffect(() => {
    if (!applied) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchReport(applied)
      .then(data => { if (!cancelled) setRows(Array.isArray(data) ? data : []); })
      .catch(err => {
        if (cancelled) return;
        setError(err.response?.data?.error || err.message || 'Failed to generate report');
        setRows([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [applied]);

  /* Category row click → same period, scoped to that category, as Product Summary. */
  const handleDrill = (row) => {
    if (!appliedDef?.drill || !Number.isFinite(Number(row.id))) return;
    setDrillFrom(applied);
    const next = { ...applied, report: 'product', categoryIds: [Number(row.id)], productIds: [] };
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

  const kpis = useMemo(() => {
    if (!applied || !appliedDef || !rows.length) return null;
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
        { label: 'Products', value: fmtQty(pivoted.length) },
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
  }, [applied, appliedDef, rows, metric]);

  const handleExport = () => {
    if (!rows.length || !appliedDef) return;
    const { from, to } = resolveRange(applied);
    const suffix = appliedDef.kind === 'monthly' ? applied.year : `${from}_${to}`;
    const name = `${applied.report}-${suffix}.csv`;

    if (appliedDef.kind === 'monthly') {
      const pivoted = pivotMonthly(rows, metric);
      downloadCSV(name, buildMonthlyColumns(metric, monthlyTotals(pivoted)), pivoted);
    } else if (appliedDef.kind === 'zero') {
      downloadCSV(name, buildZeroSalesColumns(), rows);
    } else if (appliedDef.kind === 'payment') {
      downloadCSV(name, buildPaymentColumns(), rows);
    } else {
      const sorted = sortRanked(rows, metric);
      downloadCSV(name, buildRankedColumns(appliedDef.variant, metric, rankedTotals(sorted)[basisOf(metric)]), sorted);
    }
  };

  const appliedCatNames = (applied?.categoryIds || [])
    .map(id => categories.find(c => String(c.id) === String(id))?.name)
    .filter(Boolean);
  const appliedProdCount = applied?.productIds?.length || 0;

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
      <div className="rp-canvas">
        {!applied && (
          <div className="rp-placeholder">
            <div className="rp-placeholder-icon">▤</div>
            <h2>No report generated</h2>
            <p>Select a report and period above, then click <strong>Generate</strong>.</p>
          </div>
        )}

        {applied && appliedDef && (
          <div className="rp-sheet">
            <div className="rp-sheet-head">
              <div className="rp-sheet-id">
                {drillFrom && (
                  <button className="rp-back" onClick={handleBack}>
                    ← Back to {byKey(drillFrom.report).label}
                  </button>
                )}
                <div className="rp-brand">MTC Studio</div>
                <h1 className="rp-title">{appliedDef.title}</h1>
                <div className="rp-meta">
                  <span><strong>Period:</strong> {appliedDef.kind === 'monthly' ? `Year ${applied.year}` : periodLabel(applied)}</span>
                  {!!appliedCatNames.length && (
                    <span><strong>Categories:</strong> {appliedCatNames.length > 3 ? `${appliedCatNames.length} selected` : appliedCatNames.join(', ')}</span>
                  )}
                  {!!appliedProdCount && <span><strong>Items:</strong> {appliedProdCount} selected</span>}
                  {appliedDef.measure !== false && <span><strong>Measure:</strong> {measureLabel(metric)}</span>}
                  <span><strong>Generated:</strong> {fmtStamp(applied.stamp)}</span>
                </div>
              </div>
              <div className="rp-sheet-actions">
                <button onClick={handleExport} disabled={!rows.length}>Export CSV</button>
                <button onClick={() => window.print()} disabled={!rows.length}>Print</button>
              </div>
            </div>

            {error && <div className="rp-error">{error}</div>}

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

            {loading ? (
              <div className="rp-empty">Generating report…</div>
            ) : appliedDef.kind === 'payment' ? (
              <PaymentRegister key={viewKey} rows={rows} />
            ) : appliedDef.kind === 'zero' ? (
              <ZeroSales key={viewKey} rows={rows} />
            ) : appliedDef.kind === 'monthly' ? (
              <MonthlySummary key={viewKey} rows={rows} metric={metric} />
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
    </div>
  );
}
