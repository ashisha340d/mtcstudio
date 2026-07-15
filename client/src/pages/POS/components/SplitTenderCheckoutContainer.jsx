import { useState, useEffect } from 'react';
import { usePOS } from '../../../context/POSContext';
import { printReceipt } from './ThermalReceipt';
import SplitTenderCheckout from './SplitTenderCheckout';

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
export default function SplitTenderCheckoutContainer({ orderId, onClose, onSuccess }) {
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

  const order = ctxOrder ?? fetchedOrder;
  const due = order ? Number(order.total_amount) - Number(order.paid_amount) : 0;

  const [customers, setCustomers] = useState([]);
  useEffect(() => {
    fetch(`${API}/crm/customers?limit=200`, { headers: H })
      .then(r => r.json())
      .then(data => {
        const list = Array.isArray(data) ? data : (data.customers ?? []);
        setCustomers(list.map(c => ({ id: c.phone, name: c.name, phone: c.phone, discount: Number(c.discount) || 0 })));
      })
      .catch(() => { });
  }, []);

  // DELIVERY orders already carry customer_phone from order creation — auto-resolve
  // the matching CRM record (with its discount %) so the cashier just hits Confirm.
  const [prefill, setPrefill] = useState(null);
  useEffect(() => {
    if (!order || order.order_type !== 'DELIVERY' || !order.customer_phone || prefill) return;
    const known = customers.find(c => c.phone === order.customer_phone);
    if (known) {
      setPrefill({ customer: known, discountPercent: known.discount });
      return;
    }
    fetch(`${API}/crm/customers/${encodeURIComponent(order.customer_phone)}`, { headers: H })
      .then(r => (r.ok ? r.json() : null))
      .then(c => {
        if (!c) return;
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

  if (done) {
    // Done is manual — cashier clicks it (or backdrop/Enter) after printing.
    // A quick fade plays first, then control hands back so the table/card
    // fly-to-drawer animation starts only once this modal is fully gone.
    const onDone = () => {
      setClosing(true);
      setTimeout(() => { if (onSuccess) onSuccess(); else onClose(); }, 180);
    };
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
            <button className="modal__btn modal__btn--confirm" style={{ width: '100%' }} onClick={() => printReceipt({ ...snapshot, isReprint: false })}>
              🖨 Print Receipt
            </button>
            <button className="modal__btn" style={{ width: '100%', opacity: 0.7 }} onClick={() => printReceipt({ ...snapshot, isReprint: true })}>
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
      const ledgerTender = data.tenders.find(t => t.method === 'LEDGER');
      const selectedCustomer = ledgerTender
        ? customers.find(c => c.id === data.customer_id)
        : null;

      if (selectedCustomer && (selectedCustomer.name !== (order.customer_name || '') || selectedCustomer.phone !== (order.customer_phone || ''))) {
        await fetch(`${API}/pos/orders/${orderId}`, {
          method: 'PATCH', headers: H,
          body: JSON.stringify({ customer_name: selectedCustomer.name, customer_phone: selectedCustomer.phone }),
        });
      }

      const payments = data.tenders.map(t => ({
        method: METHOD_TO_DB[t.method],
        amount: t.amount,
        reference: t.ref ?? null,
        notes: t.method === 'WALLET' ? 'WALLET' : undefined,
      }));

      const orderSnap = {
        ...order,
        customer_name: selectedCustomer?.name || order.customer_name || 'Walk-in',
        customer_phone: selectedCustomer?.phone || order.customer_phone || null,
        total_amount: data.payableAmount,
        paid_amount: data.payableAmount,
      };
      const allKots = kotsByOrder[orderId]?.length ? kotsByOrder[orderId] : (fetchedKots ?? []);
      const items = allKots.flatMap(k => (k.items || []).filter(i => i.status !== 'CANCELLED'));
      setSnapshot({ order: orderSnap, items, payments, change: data.changeDue });

      await checkout({ orderId, payments, discount_amount: data.discountAmount, change_amount: data.changeDue });
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
    label: order.order_type === 'DINE_IN' ? (order.table_name ? `Table ${order.table_name}` : 'Dine-In') : undefined,
  };

  return (
    <>
      <SplitTenderCheckout
        orderTotal={due}
        onConfirm={handleConfirm}
        onCancel={onClose}
        customers={customers}
        prefill={splitTenderPrefill}
        orderMeta={orderMeta}
      />
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
