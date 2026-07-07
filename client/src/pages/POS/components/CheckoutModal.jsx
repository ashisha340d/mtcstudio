import { useState, useEffect, useRef } from 'react';
import { usePOS, PAYMENT_METHOD } from '../../../context/POSContext';
import { printReceipt } from './ThermalReceipt';

const API = import.meta.env.VITE_API_URL || '/api';
const H = { 'Content-Type': 'application/json', 'X-Session-ID': 'dev-session' };

const METHODS = [
  { key: PAYMENT_METHOD.CASH, label: 'Cash' },
  { key: PAYMENT_METHOD.CARD, label: 'Card' },
  { key: PAYMENT_METHOD.QR, label: 'QR / UPI' },
  { key: PAYMENT_METHOD.LEDGER, label: 'Ledger' },
];


const fmtMoney = (n) =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CheckoutModal({ orderId, onClose, onSuccess }) {
  const { orders, kotsByOrder, checkout } = usePOS();
  const ctxOrder = orders[orderId];

  // If context hasn't synced yet, fetch directly
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
  const [method, setMethod] = useState(PAYMENT_METHOD.CASH);
  const [amount, setAmount] = useState('');
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [customers, setCustomers] = useState([]);
  const [custSearch, setCustSearch] = useState('');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const amountRef = useRef(null);
  const custSelRef = useRef(null);
  const isLedger = method === PAYMENT_METHOD.LEDGER;
  const [showConfirm, setShowConfirm] = useState(false);
  // Initialise amount + customer once order is available
  useEffect(() => {
    if (!order) return;
    setAmount(prev => prev || (Number(order.total_amount) - Number(order.paid_amount)).toFixed(2));
    setCustName(prev => prev || (order.customer_name || ''));
    setCustPhone(prev => prev || (order.customer_phone || ''));
  }, [order?.id]);

  // Load CRM customers when Ledger selected
  useEffect(() => {
    if (!isLedger) return;
    fetch(`${API}/crm/customers?limit=200`, { headers: H })
      .then(r => r.json())
      .then(data => setCustomers(Array.isArray(data) ? data : (data.customers ?? [])))
      .catch(() => { });
  }, [isLedger]);

  // When method switches to Ledger, force amount to 0
  useEffect(() => {
    if (isLedger) setAmount('0.00');
    else setAmount(due.toFixed(2));
  }, [isLedger]);

  // ADD THIS HERE: Focus amount on load
  useEffect(() => {
    if (order && !isLedger && amountRef.current) {
      setTimeout(() => {
        amountRef.current.focus();
        amountRef.current.select();
      }, 50);
    }
  }, [order, isLedger]);


  // ── ALL hooks above this line — early returns below are now safe ──

  // done check MUST come before !order — after checkout the order is removed
  // from context by loadActiveOrders(), so order becomes null while done=true
  if (done) {
    const onDone = () => { if (onSuccess) onSuccess(); else onClose(); };
    return (
      <div className="modal-overlay" onClick={onDone}>
        <div className="modal checkout-modal" onClick={e => e.stopPropagation()}
          onKeyDown={e => { if (e.key === 'Enter') onDone(); }}
          tabIndex={-1} ref={el => el?.focus()}
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
            <button className="modal__btn modal__btn--confirm" style={{ width: '100%' }} onClick={() => handlePrint(false)}>
              🖨 Print Receipt
            </button>
            <button className="modal__btn" style={{ width: '100%', opacity: 0.7 }} onClick={() => handlePrint(true)}>
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

  const paid = isLedger ? 0 : (parseFloat(amount) || 0);
  const balance = due - paid;
  const change = paid > due ? paid - due : 0;

  const filteredCust = custSearch
    ? customers.filter(c =>
      c.name?.toLowerCase().includes(custSearch.toLowerCase()) ||
      c.phone?.includes(custSearch)
    )
    : customers;

  function validate() {
    const e = {};
    if (isLedger) {
      if (!custPhone) e.cust = 'Select a customer for Ledger payment.';
    } else {
      if (paid <= 0) e.amount = 'Amount Tendered must be greater than zero.';
      if (paid < due) e.amount = `Amount Tendered must be at least ${fmtMoney(due)}.`;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleConfirm() {
    if (!validate()) return;
    setLoading(true);

    try {
      if (custName.trim() !== (order.customer_name || '') || custPhone !== (order.customer_phone || '')) {
        await fetch(`${API}/pos/orders/${orderId}`, {
          method: 'PATCH', headers: H,
          body: JSON.stringify({
            customer_name: custName.trim() || null,
            customer_phone: custPhone || null,
          }),
        });
      }

      const finalPaid = isLedger ? due : paid;
      const payments = [{ method, amount: finalPaid, reference: null }];

      const allKots = kotsByOrder[orderId]?.length ? kotsByOrder[orderId] : (fetchedKots ?? []);
      const items = allKots.flatMap(k => (k.items || []).filter(i => i.status !== 'CANCELLED'));
      const orderSnap = {
        ...order,
        customer_name: custName.trim() || 'Walk-in',
        customer_phone: custPhone || null,
        paid_amount: finalPaid,
      };
      setSnapshot({ order: orderSnap, items, payments, change: isLedger ? 0 : Math.max(0, paid - due) });

      await checkout({ orderId, payments });
      setDone(true);
      // printReceipt({ order: orderSnap, items, payments });
    } catch (err) {
      setErrors({ submit: err?.response?.data?.error || err?.message || 'Checkout failed. Please try again.' });
    } finally {
      setLoading(false);
    }
  }

  function handlePrint(isReprint = false) {
    if (!snapshot) return;
    printReceipt({ ...snapshot, isReprint });
  }

  function selectCustomer(c) {
    setCustName(c.name);
    setCustPhone(c.phone);
    setCustSearch('');
    setErrors(e => ({ ...e, cust: undefined }));
  }

  // ── Payment entry screen ───────────────────────────────────
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal checkout-modal" onClick={e => e.stopPropagation()}>
        <div className="modal__title">Checkout</div>

        {/* Total due */}
        <div className="checkout-total" style={{ marginBottom: 20 }}>
          <span className="checkout-total__label">Total Due</span>
          <span className="checkout-total__value">{fmtMoney(due)}</span>
        </div>

        {/* Payment Method — FIRST */}
        <span className="modal__label">Payment Method</span>
        <div className="checkout-methods" style={{ marginBottom: 20 }}>
          {METHODS.map(m => (
            <button
              key={m.key}
              className={`method-btn ${method === m.key ? 'method-btn--active' : ''}`}
              onClick={() => { setMethod(m.key); setErrors({}); }}
            >{m.label}</button>
          ))}
        </div>

        {/* LEDGER: CRM customer dropdown */}
        {isLedger ? (
          <div style={{ marginBottom: 16 }}>
            <span className="modal__label">
              Customer <span style={{ color: 'var(--red)' }}>*</span>
            </span>
            {/* Search + selected display */}
            {custPhone ? (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', borderRadius: 8,
                background: 'var(--bg-card-2,#f3f4f6)', border: '1.5px solid var(--green,#16a34a)',
                marginBottom: 8,
              }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-1,#111)' }}>{custName}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3,#888)' }}>{custPhone}</div>
                </div>
                <button
                  onClick={() => { setCustName(''); setCustPhone(''); }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-3,#888)', cursor: 'pointer', fontSize: 18 }}
                >✕</button>
              </div>
            ) : (
              <>
                <input
                  ref={custSelRef}
                  className="modal__input"
                  placeholder="Search by name or phone…"
                  value={custSearch}
                  onChange={e => { setCustSearch(e.target.value); setErrors(er => ({ ...er, cust: undefined })); }}
                  autoFocus
                  style={{ marginBottom: 4, borderColor: errors.cust ? 'var(--red)' : '' }}
                />
                {custSearch && (
                  <div style={{
                    maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border,#e5e7eb)',
                    borderRadius: 8, background: '#fff', marginBottom: 8,
                  }}>
                    {filteredCust.length === 0
                      ? <div style={{ padding: '10px 14px', fontSize: 13, color: 'var(--text-3,#aaa)' }}>No customers found</div>
                      : filteredCust.slice(0, 20).map(c => (
                        <button key={c.phone} onClick={() => selectCustomer(c)} style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '9px 14px', background: 'none', border: 'none',
                          borderBottom: '1px solid var(--border,#f0f0f0)', cursor: 'pointer',
                        }}
                          onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
                          onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        >
                          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1,#111)' }}>{c.name}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-3,#aaa)', marginLeft: 8 }}>{c.phone}</span>
                        </button>
                      ))
                    }
                  </div>
                )}
              </>
            )}
            {errors.cust && <div style={{ color: 'var(--red)', fontSize: 11, marginBottom: 8 }}>{errors.cust}</div>}

            {/* Ledger: amount is net zero, disabled */}
            <span className="modal__label">Amount Tendered</span>
            <input
              className="checkout-amount-input"
              type="text"
              value="0.00 — Ledger"
              readOnly
              disabled
              style={{ opacity: 0.5, cursor: 'not-allowed', background: 'var(--bg-card-2,#f3f4f6)' }}
            />
            <div style={{ fontSize: 12, color: 'var(--yellow,#ca8a04)', marginTop: 8, marginBottom: 4 }}>
              Full amount of {fmtMoney(due)} will be posted to customer ledger.
            </div>
          </div>
        ) : (
          /* CASH / CARD / QR */
          <div style={{ marginBottom: 16 }}>
            {/* Optional customer name */}
            <span className="modal__label">
              Customer Name <span style={{ color: 'var(--text-3,#aaa)', fontWeight: 400, fontSize: 10 }}>(optional)</span>
            </span>
            <input
              className="modal__input"
              type="text"
              placeholder="Walk-in customer…"
              value={custName}
              onChange={e => setCustName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); amountRef.current?.select(); amountRef.current?.focus(); } }}
              style={{ marginBottom: 16 }}
            />

            <span className="modal__label">Amount Tendered</span>
            <input
              ref={amountRef}
              className="checkout-amount-input"
              type="number"
              value={amount}
              onChange={e => { setAmount(e.target.value); setErrors(er => ({ ...er, amount: undefined })); }}
              onFocus={e => e.target.select()}
              onKeyDown={e => { if (e.key === 'Enter' && !loading) handleConfirm(); }}
              autoFocus
              style={{ borderColor: errors.amount ? 'var(--red)' : '' }}
            />
            {errors.amount && (
              <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 4, marginBottom: 4 }}>{errors.amount}</div>
            )}
            {change > 0 && (
              <div className="checkout-balance" style={{ color: 'var(--green, #16a34a)', marginTop: 8 }}>
                <span>Change to return</span>
                <span>{fmtMoney(change)}</span>
              </div>
            )}
          </div>
        )}

        {errors.submit && (
          <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 10, padding: '8px 12px', background: 'var(--red-bg,#fff1f1)', borderRadius: 6, border: '1px solid var(--red)' }}>
            ⚠ {errors.submit}
          </div>
        )}

        <div className="modal__actions">
          <button className="modal__btn modal__btn--cancel" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            className="modal__btn modal__btn--confirm"
            onClick={() => { if (validate()) setShowConfirm(true); }}
            disabled={loading}
          >
            {loading ? 'Processing…' : '✓ Confirm  [Enter]'}
          </button>
        </div>
      </div>


      {showConfirm && (
        <div className="modal-overlay" style={{ zIndex: 999 }} onClick={() => setShowConfirm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ padding: 24, textAlign: 'center' }}>
            <h3 style={{ marginBottom: 16 }}>Confirm Checkout?</h3>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button className="modal__btn modal__btn--cancel" onClick={() => setShowConfirm(false)}>
                No, Cancel
              </button>
              <button className="modal__btn modal__btn--confirm" onClick={() => { setShowConfirm(false); handleConfirm(); }}>
                Yes, Confirm
              </button>
            </div>
          </div>
        </div>
      )}


    </div>




  );
}
