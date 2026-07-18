import { useState, useEffect, useRef } from 'react';
import { usePOS } from '../../../context/POSContext';
import { printReceipt } from './ThermalReceipt';
import SplitTenderCheckout from './SplitTenderCheckout';
import FonepayPanel from './FonepayPanel';

const API = import.meta.env.VITE_API_URL || '/api';
const H = { 'Content-Type': 'application/json', 'X-Session-ID': 'dev-session' };

const fmtMoney = (n) =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// SplitTenderCheckout speaks CASH/QR/WALLET/LEDGER; pos_payments only accepts
// CASH/CARD/QR/LEDGER (schema CHECK constraint). WALLET rides in the CARD
// bucket with a note so it's distinguishable on the receipt/audit trail.
const METHOD_TO_DB = { CASH: 'CASH', QR: 'QR', WALLET: 'CARD', LEDGER: 'LEDGER' };

/**
 * Adapter that fits SplitTenderCheckout's (orderTotal, onConfirm, onCancel, customers)
 * interface onto this app's order/checkout/CRM plumbing. Same external props as
 * CheckoutModal (orderId, onClose, onSuccess) so call sites can swap between the two
 * by changing only the import.
 */
export default function SplitTenderCheckoutContainer({ orderId, cakeItems = [], onClose, onSuccess }) {
  const { orders, kotsByOrder, checkout } = usePOS();
  const ctxOrder = orders[orderId];

  const [fetchedOrder, setFetchedOrder] = useState(null);
  const [fetchedKots, setFetchedKots] = useState(null);
  useEffect(() => {
    if ((ctxOrder && kotsByOrder[orderId]) || !orderId) return;
    fetch(`${API}/pos/orders/active`, { headers: H })
      .then(r => r.json())
      .then(data => {
        const found = (data.orders ?? []).find(o => o.id === orderId);
        const kots = (data.kots ?? []).filter(k => k.order_id === orderId);
        if (found) setFetchedOrder(found);
        if (kots.length) setFetchedKots(kots);
      })
      .catch(() => { });
  }, [ctxOrder, orderId]);

  // Cake balance lines from the POS cart — settled against cake_orders, not this order
  const cakeDue = round2(cakeItems.reduce((s, i) => s + (Number(i.unit_price) || 0) * (i.quantity || 1), 0));

  // Cake-only checkout has no pos_order — synthesize a zero-total stand-in
  const order = ctxOrder ?? fetchedOrder ?? (!orderId && cakeItems.length
    ? { id: null, order_type: 'CAKE_ORDER', total_amount: 0, paid_amount: 0, customer_name: cakeItems[0].cake_customer_name || null, customer_phone: null }
    : null);
  const restDue = order ? round2(Number(order.total_amount) - Number(order.paid_amount)) : 0;
  const due = round2(restDue + cakeDue);

  const [customers, setCustomers] = useState([]);
  useEffect(() => {
    fetch(`${API}/crm/customers?limit=200`, { headers: H })
      .then(r => r.json())
      .then(data => {
        const list = Array.isArray(data) ? data : (data.rows ?? []);
        setCustomers(list.map(c => ({ id: c.phone, name: c.name, phone: c.phone, discount: Number(c.discount) || 0, is_delivery_partner: Number(c.is_delivery_partner) || 0 })));
      })
      .catch(() => { });
  }, []);

  // DELIVERY orders already carry customer_phone from order creation — auto-resolve
  // the matching CRM record so the cashier just hits Confirm. Only customers tagged
  // as delivery partners get the auto discount % + ledger prefill.
  const [prefill, setPrefill] = useState(null);
  useEffect(() => {
    if (!order || order.order_type !== 'DELIVERY' || !order.customer_phone || prefill) return;
    const known = customers.find(c => c.phone === order.customer_phone);
    if (known) {
      if (!known.is_delivery_partner) return;
      setPrefill({ customer: known, discountPercent: known.discount });
      return;
    }
    fetch(`${API}/crm/customers/${encodeURIComponent(order.customer_phone)}`, { headers: H })
      .then(r => (r.ok ? r.json() : null))
      .then(c => {
        if (!c || !Number(c.is_delivery_partner)) return;
        setPrefill({
          customer: { id: c.phone, name: c.name, phone: c.phone, discount: Number(c.discount) || 0 },
          discountPercent: Number(c.discount) || 0,
        });
      })
      .catch(() => { });
  }, [order, customers, prefill]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [done, setDone] = useState(false);
  const [closing, setClosing] = useState(false);
  const [showFonepay, setShowFonepay] = useState(false);
  // Retry guards — a failed step never re-charges what already succeeded
  const restaurantPaidRef = useRef(false);
  const paidCakesRef = useRef(new Set());

  if (done) {
    // Done is manual — cashier clicks it (or backdrop/Enter) after printing.
    // A quick fade plays first, then control hands back so the table/card
    // fly-to-drawer animation starts only once this modal is fully gone.
    const onDone = () => {
      setClosing(true);
      setTimeout(() => { if (onSuccess) onSuccess(); else onClose(); }, 180);
    };
    // Print is explicit only — receipt plus one slip per paid cake order
    const printAll = (isReprint) => {
      printReceipt({ ...snapshot, isReprint });
      (snapshot?.cakeIds ?? []).forEach(id =>
        fetch(`${API}/pos/cake-orders/${id}/print`, { method: 'POST', headers: H }).catch(() => { }));
    };
    const hasCakeSlip = (snapshot?.cakeIds ?? []).length > 0;
    return (
      <div className="modal-overlay" onClick={onDone}>
        <div
          className={`modal checkout-modal${closing ? ' modal--closing' : ''}`}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => { if (e.key === 'Enter') onDone(); }}
          tabIndex={-1}
          ref={el => el?.focus()}
        >
          <div className="modal__title" style={{ color: 'var(--green, #16a34a)' }}>✓ Payment Complete</div>

          {(snapshot?.change ?? 0) > 0 && (
            <div className="checkout-total">
              <span className="checkout-total__label">Change to Return</span>
              <span className="checkout-total__value" style={{ color: 'var(--green, #16a34a)' }}>{fmtMoney(snapshot.change)}</span>
            </div>
          )}

          {snapshot?.order?.customer_name && snapshot.order.customer_name !== 'Walk-in' && (
            <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-2)', marginBottom: 16 }}>
              Customer: <strong>{snapshot.order.customer_name}</strong>
            </div>
          )}

          <div className="modal__actions" style={{ flexDirection: 'column', gap: 8 }}>
            <button className="modal__btn modal__btn--confirm" style={{ width: '100%' }} onClick={() => printAll(false)}>
              🖨 Print Receipt{hasCakeSlip ? ' + Cake Slip' : ''}
            </button>
            <button className="modal__btn" style={{ width: '100%', opacity: 0.7 }} onClick={() => printAll(true)}>
              ↩ Reprint
            </button>
            <button className="modal__btn modal__btn--cancel" style={{ width: '100%' }} onClick={onDone}>
              Done →
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal checkout-modal" onClick={e => e.stopPropagation()} style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 13, color: 'var(--text-3,#aaa)' }}>Loading order…</div>
        </div>
      </div>
    );
  }

  async function handleConfirm(data) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // ── Split tenders between cake balances and the restaurant order ──
      // Cake consumes QR/WALLET first, then CASH; cash overshoot (change) and
      // LEDGER always stay with the restaurant checkout, whose server-side
      // validateSplitTender computes change and books the customer ledger.
      const pool = [];
      for (const m of ['QR', 'WALLET', 'CASH']) {
        for (const t of data.tenders) if (t.method === m) pool.push({ method: m, amount: t.amount, ref: t.ref ?? null });
      }
      if (cakeDue > 0) {
        const nonLedger = round2(pool.reduce((s, t) => s + t.amount, 0));
        if (nonLedger + 0.005 < cakeDue)
          throw new Error('Cake balance must be covered by Cash / QR / Wallet — Ledger cannot settle a cake due.');
        if (data.discountAmount > restDue + 0.005)
          throw new Error('Discount cannot exceed the restaurant portion — the cake balance is fixed.');
      }

      const cakeAllocs = [];
      for (const i of cakeItems) {
        let need = round2((Number(i.unit_price) || 0) * (i.quantity || 1));
        const pays = [];
        for (const t of pool) {
          if (need <= 0) break;
          if (t.amount <= 0) continue;
          const take = round2(Math.min(t.amount, need));
          t.amount = round2(t.amount - take);
          need = round2(need - take);
          pays.push({ method: t.method, amount: take, ref: t.ref });
        }
        cakeAllocs.push({ id: i.cake_order_id, order_number: i.cake_order_number, payments: pays });
      }

      const restPayments = [
        ...pool.filter(t => t.amount > 0),
        ...data.tenders.filter(t => t.method === 'LEDGER'),
      ].map(t => ({
        method: METHOD_TO_DB[t.method],
        amount: t.amount,
        reference: t.ref ?? null,
        notes: t.method === 'WALLET' ? 'WALLET' : undefined,
      }));

      const ledgerTender = data.tenders.find(t => t.method === 'LEDGER');
      const selectedCustomer = ledgerTender
        ? customers.find(c => c.id === data.customer_id)
        : null;

      if (orderId && selectedCustomer && (selectedCustomer.name !== (order.customer_name || '') || selectedCustomer.phone !== (order.customer_phone || ''))) {
        await fetch(`${API}/pos/orders/${orderId}`, {
          method: 'PATCH', headers: H,
          body: JSON.stringify({ customer_name: selectedCustomer.name, customer_phone: selectedCustomer.phone }),
        });
      }

      // Receipt payments show the full tender split (cake + restaurant together)
      const payments = data.tenders.map(t => ({
        method: METHOD_TO_DB[t.method],
        amount: t.amount,
        reference: t.ref ?? null,
        notes: t.method === 'WALLET' ? 'WALLET' : undefined,
      }));

      const orderSnap = {
        ...order,
        id: order.id ?? cakeItems[0]?.cake_order_number ?? '—',
        customer_name: selectedCustomer?.name || order.customer_name || 'Walk-in',
        customer_phone: selectedCustomer?.phone || order.customer_phone || null,
        total_amount: data.payableAmount,
        paid_amount: data.payableAmount,
      };
      const allKots = kotsByOrder[orderId]?.length ? kotsByOrder[orderId] : (fetchedKots ?? []);
      const items = [
        ...allKots.flatMap(k => (k.items || []).filter(i => i.status !== 'CANCELLED')),
        ...cakeItems.map(i => ({ product_name: i.product_name, quantity: i.quantity || 1, unit_price: i.unit_price })),
      ];
      setSnapshot({ order: orderSnap, items, payments, change: data.changeDue, cakeIds: cakeItems.map(i => i.cake_order_id) });

      if (orderId && restDue > 0.005 && !restaurantPaidRef.current) {
        await checkout({ orderId, payments: restPayments, discount_amount: data.discountAmount, change_amount: data.changeDue });
        restaurantPaidRef.current = true;
      }

      for (const c of cakeAllocs) {
        if (paidCakesRef.current.has(c.id) || !c.payments.length) continue;
        const r = await fetch(`${API}/pos/cake-orders/${c.id}/payment`, {
          method: 'PATCH', headers: H,
          body: JSON.stringify({ payments: c.payments }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(`Cake ${c.order_number}: ${err.error || 'payment failed'}`);
        }
        paidCakesRef.current.add(c.id);
      }

      // Zero-total order that only carried the cake draft — close it and clear the draft
      if (orderId && restDue <= 0.005) {
        await fetch(`${API}/pos/orders/${orderId}`, {
          method: 'PATCH', headers: H,
          body: JSON.stringify({ status: 'CLOSED', draft_items: null }),
        }).catch(() => { });
      }

      setDone(true);
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Checkout failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const splitTenderPrefill = prefill && {
    customer: prefill.customer,
    discountPercent: prefill.discountPercent,
    ledgerAmount: Math.max(0, round2(due - due * (prefill.discountPercent / 100))),
  };

  const orderMeta = {
    orderType: order.order_type,
    id: order.id,
    label: order.order_type === 'DINE_IN'
      ? (order.table_name ? `Table ${order.table_name}` : 'Dine-In')
      : (!orderId && cakeItems.length
        ? `Cake ${cakeItems[0].cake_order_number}${cakeItems.length > 1 ? ` +${cakeItems.length - 1} more` : ''}`
        : undefined),
  };

  // Enter on a tender amount field (CASH/QR/WALLET/LEDGER) normally just moves to
  // the next focus stop (SplitTenderCheckout's own chain) — but if the amount just
  // entered already covers the payable total (Remaining Balance hits 0), jump
  // straight to Confirm instead of stepping through the rest of the tender chain.
  // Captured here (not inside SplitTenderCheckout — that file is off-limits) so it
  // runs before the input's own onKeyDown.
  function handleTenderEnterCapture(e) {
    if (e.key !== 'Enter') return;
    const testid = e.target?.dataset?.testid;
    if (!testid?.startsWith('tender-input-')) return;
    const root = e.target.closest('.checkout-modal');
    const remainingText = root?.querySelector('[data-testid="remaining-amount"]')?.textContent ?? '';
    const remaining = parseFloat(remainingText.replace(/[^0-9.]/g, '')) || 0;
    if (remaining <= 0) {
      e.preventDefault();
      e.stopPropagation();
      root?.querySelector('[data-testid="confirm-button"]')?.focus();
    }
  }

  return (
    <>
      <div onKeyDownCapture={handleTenderEnterCapture}>
        <SplitTenderCheckout
          orderTotal={due}
          onConfirm={handleConfirm}
          onCancel={onClose}
          customers={customers}
          prefill={splitTenderPrefill}
          orderMeta={orderMeta}
        />
      </div>
      <button
        onClick={() => setShowFonepay(true)}
        title="Read the latest 3 Fonepay payments (read-only)"
        style={{
          position: 'fixed', top: 16, right: 16, zIndex: 2410,
          background: 'var(--yellow, #a16207)', color: '#fff', border: 'none',
          borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
        }}
        data-testid="checkout-fonepay-button"
      >
        💳 Check Fonepay
      </button>
      {showFonepay && (
        <FonepayPanel onClose={() => setShowFonepay(false)} />
      )}
      {error && (
        <div
          style={{
            position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 70,
            background: 'var(--red-bg,#fff1f1)', border: '1px solid var(--red,#dc2626)', color: 'var(--red,#dc2626)',
            padding: '10px 16px', borderRadius: 8, fontSize: 13,
          }}
        >
          ⚠ {error}
        </div>
      )}
    </>
  );
}
