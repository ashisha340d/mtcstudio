import { useEffect, useState, useCallback } from 'react';
import posApi from '../../services/posApi';
import './DayEnd.css';

const METHOD_LABELS = { CASH: 'Cash', CARD: 'Card', QR: 'QR/UPI', WALLET: 'Wallet', LEDGER: 'Credit (Ledger)' };
const TYPE_LABELS = { DINE_IN: 'Dine In', TAKEAWAY: 'Takeaway', DELIVERY: 'Delivery', QUICK_SALE: 'Quick Sale', CAKE_ORDER: 'Cake' };

function todayNepal() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' });
}
const fmt = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const fmtTime = (ts) => ts
  ? new Date(String(ts).replace(' ', 'T') + (String(ts).includes('Z') ? '' : '+05:45'))
      .toLocaleString('en-IN', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: false })
  : '—';

function YesNo({ ok, label }) {
  return (
    <span className={`de-flag ${ok ? 'de-flag--yes' : 'de-flag--no'}`}>
      {ok ? '✓' : '✗'} {label}
    </span>
  );
}

function Section({ code, title, children }) {
  return (
    <section className="de-section">
      <h2><span className="de-section-code">{code}</span>{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value, strong, muted, negative }) {
  return (
    <div className={`de-row${strong ? ' de-row--strong' : ''}${muted ? ' de-row--muted' : ''}`}>
      <span>{label}</span>
      <span className={negative ? 'de-neg' : ''}>{value}</span>
    </div>
  );
}

export default function DayEnd() {
  const [date, setDate]       = useState(todayNepal);
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [busy, setBusy]       = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setData(await posApi.getDayEndReport(date));
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const closeDay = async () => {
    if (!window.confirm(`Close business day ${date}? The report will be frozen as the official record.`)) return;
    try {
      setBusy(true);
      setData(await posApi.closeDayEnd(date));
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to close day');
    } finally {
      setBusy(false);
    }
  };

  const reopenDay = async () => {
    if (!window.confirm(`Reopen business day ${date}? The frozen snapshot will be discarded.`)) return;
    try {
      setBusy(true);
      await posApi.reopenDayEnd(date);
      await load();
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to reopen day');
    } finally {
      setBusy(false);
    }
  };

  const r = data?.report;
  const f = r?.verification?.flags;
  const formattedDate = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <div className="day-end">
      <div className="de-header de-no-print-bg">
        <div>
          <h1>Day End Report</h1>
          <div className="de-date">{formattedDate}</div>
        </div>
        <div className="de-header-actions de-no-print">
          <input type="date" className="de-date-picker" value={date} max={todayNepal()}
                 onChange={e => setDate(e.target.value)} />
          <button className="de-btn" onClick={() => window.print()}>🖨 Print</button>
          {data && !data.closed && (
            <button className="de-btn de-btn--primary" disabled={busy} onClick={closeDay}>Close Day</button>
          )}
          {data?.closed && (
            <button className="de-btn de-btn--ghost" disabled={busy} onClick={reopenDay}>Reopen</button>
          )}
        </div>
      </div>

      {loading && <div className="de-state">⏳ Loading day end data…</div>}
      {!loading && error && (
        <div className="de-state de-state--error">❌ {error} <button className="de-btn" onClick={load}>Retry</button></div>
      )}

      {!loading && !error && r && (
        <div className="de-body">

          {/* ── Closure status ── */}
          <div className={`de-status ${data.closed ? 'de-status--closed' : 'de-status--open'}`}>
            <div className="de-status-line">
              {data.closed
                ? <>🔒 Day closed {fmtTime(data.closed_at)} by {data.closed_by || '—'}</>
                : <>🔓 Day is open — live figures</>}
              <span className={`de-verdict ${f?.day_closed_ok ? 'de-verdict--ok' : 'de-verdict--bad'}`}>
                {f?.day_closed_ok ? 'DAY BALANCED' : 'NOT BALANCED'}
              </span>
            </div>
            <div className="de-flags">
              <YesNo ok={f?.sales_balanced} label="Sales" />
              <YesNo ok={f?.payments_balanced} label="Payments" />
              <YesNo ok={f?.cash_balanced} label="Cash" />
              <YesNo ok={f?.orders_balanced} label="Orders" />
              <YesNo ok={f?.cakes_balanced} label="Cakes" />
              <YesNo ok={f?.credits_balanced} label="Credits" />
              <YesNo ok={f?.till_closed} label="Till Closed" />
            </div>
          </div>

          <div className="de-grid">

            {/* A ── Business Summary */}
            <Section code="A" title="Business Summary">
              {r.business.till_sessions.length === 0 && <Row label="Till" value="Not opened" muted />}
              {r.business.till_sessions.map(t => (
                <Row key={t.id}
                     label={`Till #${t.id} · ${t.opened_by || '—'}`}
                     value={`${fmtTime(t.opened_at)} → ${t.status === 'CLOSED' ? fmtTime(t.closed_at) : 'OPEN'}`} />
              ))}
              <Row label="Total Orders" value={r.business.orders.total} />
              <Row label="Completed" value={r.business.orders.completed} />
              <Row label="Cancelled" value={r.business.orders.cancelled} />
              <Row label="Pending (open/saved)" value={r.business.orders.pending}
                   negative={r.business.orders.pending > 0} />
              <Row label="Refunded Bills" value={`${r.business.refunds.bills} · ${fmt(r.business.refunds.amount)}`} />
              <Row label="Guests (pax)" value={r.business.pax} />
            </Section>

            {/* B ── Sales Summary */}
            <Section code="B" title="Sales Summary">
              <Row label="Gross Sales" value={fmt(r.sales.gross_sales)} />
              <Row label="Bill Discounts" value={`− ${fmt(r.sales.bill_discounts)}`} />
              <Row label="Item Discounts (promo/comp/emp)" value={`− ${fmt(r.sales.item_discounts ?? r.sales.promo_discounts ?? 0)}`} />
              <Row label={`Returns${r.sales.returns_items ? ` (${r.sales.returns_items} items)` : ''}`} value={`− ${fmt(r.sales.returns)}`} />
              <Row label="Net Sales" value={fmt(r.sales.net_sales)} strong />
              <Row label="Cake Revenue (delivered)" value={fmt(r.sales.cake_revenue_delivered)} />
              <Row label="Grand Total" value={fmt(r.sales.grand_total)} strong />
            </Section>

            {/* C ── Payment Reconciliation */}
            <Section code="C" title="Payment Reconciliation">
              <table className="de-table">
                <thead><tr><th>Method</th><th>Txns</th><th>POS</th><th>Cake</th><th>Total</th></tr></thead>
                <tbody>
                  {r.payments.methods.map(m => (
                    <tr key={m.method}>
                      <td>{METHOD_LABELS[m.method] || m.method}</td>
                      <td>{m.txns}</td>
                      <td>{fmt(m.pos_amount)}</td>
                      <td>{fmt(m.cake_amount)}</td>
                      <td>{fmt(m.amount)}</td>
                    </tr>
                  ))}
                  {r.payments.methods.length === 0 && <tr><td colSpan="5" className="de-empty">No payments</td></tr>}
                </tbody>
              </table>
              <Row label="Change Given" value={`− ${fmt(r.payments.change_given)}`} />
              <Row label="Total Collected" value={fmt(r.payments.total - r.payments.change_given)} strong />
            </Section>

            {/* D ── Cash Drawer */}
            <Section code="D" title="Cash Drawer">
              <Row label="Opening Float" value={fmt(r.cash.opening_float)} />
              <Row label="+ Cash Sales (POS)" value={fmt(r.cash.pos_cash)} />
              <Row label="− Change Given" value={fmt(r.cash.change_given)} />
              <Row label="+ Cake Cash (advance/balance)" value={fmt(r.cash.cake_cash)} />
              <Row label="− Cash Refunds" value={fmt(r.cash.cash_refunds)} />
              <Row label="+ Cash In" value={fmt(r.cash.cash_in)} />
              <Row label="+ Credit Repayments (cash)" value={fmt(r.cash.credit_repayments_cash)} />
              <Row label="− Petty Cash" value={fmt(r.cash.petty_cash)} />
              <Row label="− Paid Out" value={fmt(r.cash.paid_out)} />
              <Row label="Expected Cash in Drawer" value={fmt(r.cash.expected)} strong />
              <Row label="Actual Cash Count"
                   value={r.cash.actual === null ? 'Till not closed' : fmt(r.cash.actual)}
                   muted={r.cash.actual === null} />
              <Row label="Cash Difference"
                   value={r.cash.difference === null ? '—' : fmt(r.cash.difference)}
                   strong negative={r.cash.difference !== null && Math.abs(r.cash.difference) > 0.02} />
            </Section>

            {/* E ── Cake Orders */}
            <Section code="E" title="Cake Orders">
              <Row label="Booked" value={`${r.cakes.booked.orders} · ${fmt(r.cakes.booked.value)}`} />
              <Row label="Delivered" value={`${r.cakes.delivered.orders} · ${fmt(r.cakes.delivered.revenue)}`} />
              <Row label="Cancelled" value={`${r.cakes.cancelled.orders} · ${fmt(r.cakes.cancelled.value)}`} />
              <Row label="Advance Received" value={`${r.cakes.advance_received.txns} · ${fmt(r.cakes.advance_received.amount)}`} />
              <Row label="Balance Collected" value={`${r.cakes.balance_collected.txns} · ${fmt(r.cakes.balance_collected.amount)}`} />
              <Row label="Pending Cakes" value={r.cakes.pending.orders} />
              <Row label="Advance Outstanding" value={fmt(r.cakes.pending.advance_outstanding)} strong />
              <Row label="Balance Outstanding" value={fmt(r.cakes.pending.balance_due)} />
              {r.cakes.delivered.unsettled > 0 && (
                <Row label="⚠ Delivered with balance due" value={r.cakes.delivered.unsettled} negative />
              )}
            </Section>

            {/* F ── Order Types */}
            <Section code="F" title="Order Types">
              <table className="de-table">
                <thead><tr><th>Type</th><th>Orders</th><th>Sales</th></tr></thead>
                <tbody>
                  {r.order_types.map(t => (
                    <tr key={t.order_type}>
                      <td>{TYPE_LABELS[t.order_type] || t.order_type}</td>
                      <td>{t.orders}</td>
                      <td>{fmt(t.sales)}</td>
                    </tr>
                  ))}
                  {r.cakes.delivered.orders > 0 && (
                    <tr><td>Cake (delivered)</td><td>{r.cakes.delivered.orders}</td><td>{fmt(r.cakes.delivered.revenue)}</td></tr>
                  )}
                  {r.order_types.length === 0 && r.cakes.delivered.orders === 0 &&
                    <tr><td colSpan="3" className="de-empty">No sales</td></tr>}
                </tbody>
              </table>
            </Section>

            {/* G ── Sales by Category */}
            <Section code="G" title="Sales by Category">
              <table className="de-table">
                <thead><tr><th>Category</th><th>Qty</th><th>Revenue</th><th>%</th></tr></thead>
                <tbody>
                  {r.categories.map(c => (
                    <tr key={c.category}>
                      <td>{c.category}</td><td>{c.qty}</td><td>{fmt(c.revenue)}</td><td>{c.pct}%</td>
                    </tr>
                  ))}
                  {r.categories.length === 0 && <tr><td colSpan="4" className="de-empty">No item sales</td></tr>}
                </tbody>
              </table>
            </Section>

            {/* H ── Top Products */}
            <Section code="H" title="Top Selling Products">
              <table className="de-table">
                <thead><tr><th>Product</th><th>Qty</th><th>Revenue</th></tr></thead>
                <tbody>
                  {r.top_products.map(p => (
                    <tr key={p.product}><td>{p.product}</td><td>{p.qty}</td><td>{fmt(p.revenue)}</td></tr>
                  ))}
                  {r.top_products.length === 0 && <tr><td colSpan="3" className="de-empty">No item sales</td></tr>}
                </tbody>
              </table>
            </Section>

            {/* I ── Staff Performance */}
            <Section code="I" title="Staff Performance">
              <table className="de-table">
                <thead><tr><th>Cashier</th><th>Orders</th><th>Sales</th></tr></thead>
                <tbody>
                  {r.staff.orders.map(s => (
                    <tr key={s.employee_id}><td>{s.name} ({s.employee_id})</td><td>{s.orders}</td><td>{fmt(s.sales)}</td></tr>
                  ))}
                  {r.staff.orders.length === 0 && <tr><td colSpan="3" className="de-empty">No closed orders</td></tr>}
                </tbody>
              </table>
              <table className="de-table" style={{ marginTop: 10 }}>
                <thead><tr><th>KOTs Punched By</th><th>Count</th></tr></thead>
                <tbody>
                  {r.staff.kots.map(s => (
                    <tr key={s.employee_id}><td>{s.name} ({s.employee_id})</td><td>{s.kots}</td></tr>
                  ))}
                  {r.staff.kots.length === 0 && <tr><td colSpan="2" className="de-empty">No KOTs</td></tr>}
                </tbody>
              </table>
            </Section>

            {/* J ── Discounts */}
            <Section code="J" title="Discounts">
              <Row label="Bill Discount" value={fmt(r.discounts.bill ?? 0)} />
              <Row label="Manual Item Discount" value={fmt(r.discounts.manual)} />
              <Row label="Promotion Discount" value={fmt(r.discounts.promotion)} />
              <Row label="Complimentary Items" value={fmt(r.discounts.complimentary)} />
              <Row label="Employee Discount" value={fmt(r.discounts.employee)} />
              <Row label="Total Discount" value={fmt(r.discounts.total)} strong />
            </Section>

            {/* L ── Operational Events */}
            <Section code="L" title="Operational Events">
              <Row label="Bills / Items Edited" value={r.operations.bills_edited} />
              <Row label="Bills Cancelled" value={r.operations.bills_cancelled} />
              <Row label="KOTs Cancelled" value={r.operations.kots_cancelled} />
              <Row label="Items Cancelled" value={r.operations.items_cancelled} />
              <Row label="Returns (all orders)"
                   value={`${r.operations.returns?.items ?? 0} · ${fmt(r.operations.returns?.value)}`} />
              <Row label="Kitchen Waste"
                   value={`${r.operations.waste?.items ?? 0} · ${fmt(r.operations.waste?.value)}`} />
              <Row label="Orders Merged / Shifted" value={`${r.operations.orders_merged} / ${r.operations.orders_shifted}`} />
              <Row label="Transactions Reverted" value={r.operations.reverts} />
              <Row label="Tables Served" value={r.operations.tables_served} />
              <Row label="Average Ticket" value={fmt(r.operations.avg_ticket)} />
              <Row label="Average Prep Time"
                   value={r.operations.avg_prep_minutes === null ? '—' : `${r.operations.avg_prep_minutes} min`} />
            </Section>

            {/* N ── Day End Verification */}
            <Section code="N" title="Day End Verification">
              <Row label="Net Sales" value={fmt(r.verification.sales.sales)} />
              <Row label="Tendered (paid + credit)" value={fmt(r.verification.sales.tendered)} />
              <Row label="Sales Difference" value={fmt(r.verification.sales.difference)}
                   strong negative={Math.abs(r.verification.sales.difference) > 0.02} />
              <Row label="Payments Captured (net)" value={fmt(r.verification.payments.captured)} />
              <Row label="Payments Difference" value={fmt(r.verification.payments.difference)}
                   strong negative={Math.abs(r.verification.payments.difference) > 0.02} />
              <Row label="Expected / Actual Cash"
                   value={`${fmt(r.verification.cash.expected)} / ${r.verification.cash.actual === null ? '—' : fmt(r.verification.cash.actual)}`} />
              <Row label="Credit Extended Today" value={fmt(r.verification.credits.credit_extended)} />
              <Row label="Credit Outstanding (all)"
                   value={`${r.verification.credit_outstanding.customers} cust · ${fmt(r.verification.credit_outstanding.total)}`} />
              <Row label="Cake Advances Outstanding" value={fmt(r.verification.cake_advances_outstanding)} />
            </Section>

          </div>
        </div>
      )}
    </div>
  );
}
