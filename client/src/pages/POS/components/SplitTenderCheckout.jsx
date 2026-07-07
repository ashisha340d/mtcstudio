import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * @typedef {Object} Customer
 * @property {string} id
 * @property {string} name
 * @property {string} [phone]
 * @property {number} [balance]
 * @property {number} [discount]
 */

/** @typedef {'CASH' | 'QR' | 'WALLET' | 'LEDGER'} PaymentMethod */

/**
 * @typedef {Object} Tender
 * @property {PaymentMethod} method
 * @property {number} amount
 * @property {string} [ref]
 * @property {string} [customer_id]
 */

/**
 * @typedef {Object} CheckoutData
 * @property {number} orderTotal
 * @property {number} discountPercent
 * @property {number} discountAmount
 * @property {number} payableAmount
 * @property {Tender[]} tenders
 * @property {number} changeDue
 * @property {string} [customer_id]
 */

const METHODS = ['CASH', 'QR', 'WALLET', 'LEDGER'];
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmtMoney = (n) => '₹' + round2(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPlain = (n) => round2(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPercent = (n) => round2(n).toFixed(2) + '%';

function sanitizeNumericInput(raw) {
  let v = raw.replace(/[^0-9.]/g, '');
  const firstDot = v.indexOf('.');
  if (firstDot !== -1) v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
  return v;
}

// Enter moves focus to the next [data-focus-order] element inside the modal —
// the chain ends on the Confirm button, where native Enter-on-button already
// fires its click, so checkout only ever happens from that explicit last stop.
function focusNextStop(current) {
  const root = current.closest('.checkout-modal');
  if (!root) return;
  const stops = Array.from(root.querySelectorAll('[data-focus-order]'));
  const idx = stops.indexOf(current);
  if (idx === -1 || idx === stops.length - 1) return;
  const next = stops[idx + 1];
  next.focus();
  if (next.select) next.select();
}

function handleStopEnter(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  focusNextStop(e.currentTarget);
}

function orderTypeLabel(orderMeta) {
  if (!orderMeta) return '';
  const { orderType, label, id } = orderMeta;
  if (label) return label;
  switch (orderType) {
    case 'DINE_IN':     return 'Dine-In';
    case 'TAKEAWAY':    return `Takeaway #${id ?? ''}`;
    case 'DELIVERY':    return `Delivery #${id ?? ''}`;
    case 'CAKE_ORDER':  return `Cake Order #${id ?? ''}`;
    case 'QUICK_SALE':  return `Quick Order #${id ?? ''}`;
    default:            return orderType ? `Order #${id ?? ''}` : '';
  }
}

function CustomerPickerModal({ customers, onSelect, onClose }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.name?.toLowerCase().includes(q) || c.phone?.toLowerCase().includes(q));
  }, [customers, query]);

  return (
    <div
      className="modal-overlay"
      style={{ zIndex: 1010 }}
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); e.stopPropagation(); }}
      data-testid="customer-picker-modal"
    >
      <div className="modal" style={{ minWidth: 360, maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal__title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Select Customer
          <button onClick={onClose} aria-label="Close" data-testid="customer-picker-close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4a3828', fontSize: 14 }}>✕</button>
        </div>
        <input
          ref={inputRef}
          className="modal__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or phone…"
          data-testid="customer-picker-search"
        />
        <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border-light)', borderRadius: 8 }}>
          {filtered.length === 0 && (
            <div style={{ padding: 12, fontSize: 13, color: 'var(--text-3)' }}>No customers found.</div>
          )}
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(c)}
              style={{
                display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center',
                textAlign: 'left', padding: '9px 12px', background: 'none', border: 'none',
                borderBottom: '1px solid var(--border-light)', cursor: 'pointer', fontSize: 13, color: 'var(--text-1)',
              }}
              data-testid={`customer-picker-row-${c.id}`}
            >
              <span>
                {c.name}
                {c.phone ? <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-3)' }}>{c.phone}</span> : null}
              </span>
              {Number(c.discount) > 0 && (
                <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 700 }}>{fmtPercent(c.discount)} off</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * @param {{
 *   orderTotal: number,
 *   onConfirm: (data: CheckoutData) => void,
 *   onCancel: () => void,
 *   customers: Customer[],
 *   prefill?: { customer?: Customer, discountPercent?: number, ledgerAmount?: number },
 *   orderMeta?: { orderType?: string, id?: number|string, label?: string },
 * }} props
 */
export default function SplitTenderCheckout({ orderTotal, onConfirm, onCancel, customers = [], prefill, orderMeta }) {
  const [discountPercentInput, setDiscountPercentInput] = useState('0');
  const [discountAmountInput, setDiscountAmountInput] = useState('0.00');
  const [amounts, setAmounts] = useState({ CASH: '', QR: '', WALLET: '', LEDGER: '' });
  const [refs, setRefs] = useState({ QR: '', WALLET: '' });
  const [customer, setCustomer] = useState(/** @type {Customer | null} */ (null));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [focusedField, setFocusedField] = useState(/** @type {string | null} */ (null));

  const cashRef = useRef(null);
  const prefilledRef = useRef(false);

  // First control to receive focus on open is the Cash amount — not discount.
  useEffect(() => { cashRef.current?.focus(); }, []);

  // Delivery prefill — applies once, as soon as the resolved customer arrives.
  useEffect(() => {
    if (prefilledRef.current || !prefill?.customer) return;
    prefilledRef.current = true;
    const pct = round2(prefill.discountPercent ?? 0);
    const amt = round2(orderTotal * (pct / 100));
    setDiscountPercentInput(pct.toFixed(2));
    setDiscountAmountInput(amt.toFixed(2));
    setCustomer(prefill.customer);
    const ledgerAmt = round2(prefill.ledgerAmount ?? Math.max(0, orderTotal - amt));
    setAmounts({ CASH: '', QR: '', WALLET: '', LEDGER: ledgerAmt > 0 ? ledgerAmt.toFixed(2) : '' });
  }, [prefill, orderTotal]);

  const discountPercent = useMemo(() => {
    const p = parseFloat(discountPercentInput);
    return Number.isFinite(p) ? Math.min(100, Math.max(0, round2(p))) : 0;
  }, [discountPercentInput]);

  const discountAmount = useMemo(() => {
    const a = parseFloat(discountAmountInput);
    const safe = Number.isFinite(a) ? Math.max(0, round2(a)) : 0;
    return Math.min(safe, orderTotal);
  }, [discountAmountInput, orderTotal]);

  const discountExceedsTotal = useMemo(() => {
    const a = parseFloat(discountAmountInput);
    return Number.isFinite(a) && a > orderTotal;
  }, [discountAmountInput, orderTotal]);

  const payableAmount = useMemo(() => round2(Math.max(0, orderTotal - discountAmount)), [orderTotal, discountAmount]);

  const handlePercentChange = (raw) => {
    const v = sanitizeNumericInput(raw);
    setDiscountPercentInput(v);
    const p = parseFloat(v);
    const clamped = Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 0;
    setDiscountAmountInput(round2(orderTotal * (clamped / 100)).toFixed(2));
    resetTenders();
  };

  const handleAmountChange = (raw) => {
    const v = sanitizeNumericInput(raw);
    setDiscountAmountInput(v);
    const a = parseFloat(v);
    const clamped = Number.isFinite(a) ? Math.min(orderTotal, Math.max(0, a)) : 0;
    const pct = orderTotal > 0 ? round2((clamped / orderTotal) * 100) : 0;
    setDiscountPercentInput(pct.toFixed(2));
    resetTenders();
  };

  function resetTenders() {
    setAmounts({ CASH: '', QR: '', WALLET: '', LEDGER: '' });
    setRefs({ QR: '', WALLET: '' });
    setCustomer(null);
  }

  const numericAmounts = useMemo(() => {
    /** @type {Record<PaymentMethod, number>} */
    const out = { CASH: 0, QR: 0, WALLET: 0, LEDGER: 0 };
    for (const m of METHODS) {
      const n = parseFloat(amounts[m]);
      out[m] = Number.isFinite(n) && n >= 0 ? round2(n) : 0;
    }
    return out;
  }, [amounts]);

  // Non-cash tenders may never exceed the payable amount — cash is the only
  // method allowed to overshoot, since overshoot becomes change, not debt.
  const nonCashTotal = useMemo(() => round2(numericAmounts.QR + numericAmounts.WALLET + numericAmounts.LEDGER), [numericAmounts]);
  const nonCashExceeds = nonCashTotal > payableAmount;

  const cashRequired = useMemo(() => round2(Math.max(0, payableAmount - nonCashTotal)), [payableAmount, nonCashTotal]);
  const shortfall = useMemo(() => round2(Math.max(0, cashRequired - numericAmounts.CASH)), [cashRequired, numericAmounts.CASH]);
  const changeDue = useMemo(() => round2(Math.max(0, numericAmounts.CASH - cashRequired)), [numericAmounts.CASH, cashRequired]);
  const totalTendered = useMemo(() => round2(METHODS.reduce((s, m) => s + numericAmounts[m], 0)), [numericAmounts]);

  const ledgerRequiresCustomer = numericAmounts.LEDGER > 0;
  const hasNegativeAmount = METHODS.some((m) => { const n = parseFloat(amounts[m]); return Number.isFinite(n) && n < 0; });

  const isValid =
    shortfall === 0 &&
    !nonCashExceeds &&
    !(ledgerRequiresCustomer && !customer) &&
    !hasNegativeAmount &&
    !discountExceedsTotal &&
    payableAmount >= 0;

  const handleAmountInputChange = (method, raw) => {
    let v = sanitizeNumericInput(raw);
    // Only QR/WALLET/LEDGER are individually capped at payable — CASH can exceed it (change).
    if (method !== 'CASH') {
      const n = parseFloat(v);
      if (Number.isFinite(n) && n > payableAmount) v = payableAmount.toFixed(2);
    }
    setAmounts((prev) => ({ ...prev, [method]: v }));
    if (method === 'LEDGER') {
      const n = parseFloat(v);
      if (!Number.isFinite(n) || n <= 0) setCustomer(null);
    }
  };

  // Focus → show the plain editable number, selected; Blur → show it comma-formatted.
  const handleMoneyFocus = (key, currentNumeric, setRaw) => (e) => {
    const plain = currentNumeric > 0 ? String(currentNumeric) : '';
    setRaw(plain);
    setFocusedField(key);
    requestAnimationFrame(() => e.target.select());
  };
  const handleMoneyBlur = () => setFocusedField(null);

  const buildCheckoutData = () => {
    /** @type {Tender[]} */
    const tenders = [];
    for (const m of METHODS) {
      const amt = numericAmounts[m];
      if (amt <= 0) continue;
      /** @type {Tender} */
      const t = { method: m, amount: amt };
      if ((m === 'QR' || m === 'WALLET') && refs[m]) t.ref = refs[m];
      if (m === 'LEDGER' && customer) t.customer_id = customer.id;
      tenders.push(t);
    }
    /** @type {CheckoutData} */
    const data = { orderTotal: round2(orderTotal), discountPercent, discountAmount, payableAmount, tenders, changeDue };
    if (ledgerRequiresCustomer && customer) data.customer_id = customer.id;
    return data;
  };

  const handleConfirm = () => { if (isValid) onConfirm(buildCheckoutData()); };

  const handleOverlayKeyDown = (e) => {
    if (e.key === 'Escape') onCancel();
  };

  const label = orderTypeLabel(orderMeta);
  const discountDisplay = focusedField === 'discountAmount' ? discountAmountInput : (discountAmount > 0 ? fmtPlain(discountAmount) : discountAmountInput);

  return (
    <div className="modal-overlay" onClick={onCancel} onKeyDown={handleOverlayKeyDown} data-testid="split-tender-checkout">
      <div className="modal checkout-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__title">Checkout</div>

        {label && (
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-2)', marginBottom: 4 }} data-testid="order-label">
            {label}
          </div>
        )}
        <div className="checkout-total" data-testid="order-total">
          <span className="checkout-total__label" style={{ fontSize: 15 }}>Order Total</span>
          <span className="checkout-total__value" style={{ fontSize: 34 }}>{fmtMoney(orderTotal)}</span>
        </div>

        <span className="modal__label" style={{ fontSize: 12 }}>Discount</span>
        <div className="modal__row" style={{ marginBottom: 6 }}>
          <input
            data-focus-order
            inputMode="decimal"
            value={discountPercentInput}
            onChange={(e) => handlePercentChange(e.target.value)}
            onFocus={(e) => requestAnimationFrame(() => e.target.select())}
            onKeyDown={handleStopEnter}
            onWheel={(e) => e.currentTarget.blur()}
            className="checkout-amount-input"
            style={{ fontSize: 18, marginBottom: 0 }}
            data-testid="discount-percent-input"
          />
          <input
            data-focus-order
            inputMode="decimal"
            value={discountDisplay}
            onChange={(e) => handleAmountChange(e.target.value)}
            onFocus={handleMoneyFocus('discountAmount', discountAmount, setDiscountAmountInput)}
            onBlur={handleMoneyBlur}
            onKeyDown={handleStopEnter}
            onWheel={(e) => e.currentTarget.blur()}
            className="checkout-amount-input"
            style={{ fontSize: 18, marginBottom: 0 }}
            data-testid="discount-amount-input"
          />
        </div>
        {discountExceedsTotal && (
          <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 6 }} data-testid="discount-error">Cannot exceed order total</div>
        )}
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--green)', marginBottom: 18 }} data-testid="payable-amount">
          Payable: {fmtMoney(payableAmount)}
        </div>

        <span className="modal__label" style={{ fontSize: 12 }}>Payment Methods</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 6 }}>
          {METHODS.map((m) => {
            const isCashField = m === 'CASH';
            const display = focusedField === m ? amounts[m] : (numericAmounts[m] > 0 ? fmtPlain(numericAmounts[m]) : amounts[m]);
            return (
              <div key={m} style={{ display: 'grid', gridTemplateColumns: '84px 1fr', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-2)' }}>
                  {m}
                  {m === 'LEDGER' && numericAmounts.LEDGER > 0 && <span style={{ color: 'var(--red)', marginLeft: 2 }}>*</span>}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    ref={isCashField ? cashRef : undefined}
                    data-focus-order
                    inputMode="decimal"
                    value={display}
                    placeholder="0.00"
                    onChange={(e) => handleAmountInputChange(m, e.target.value)}
                    onFocus={handleMoneyFocus(m, numericAmounts[m], (v) => setAmounts((prev) => ({ ...prev, [m]: v })))}
                    onBlur={handleMoneyBlur}
                    onKeyDown={handleStopEnter}
                    onWheel={(e) => e.currentTarget.blur()}
                    className="checkout-amount-input"
                    style={{ fontSize: 22, fontWeight: 800, marginBottom: 0 }}
                    data-testid={`tender-input-${m}`}
                  />
                  {(m === 'QR' || m === 'WALLET') && (
                    <input
                      data-focus-order
                      value={refs[m]}
                      onChange={(e) => setRefs((prev) => ({ ...prev, [m]: e.target.value }))}
                      onKeyDown={handleStopEnter}
                      placeholder="Ref #"
                      className="modal__input"
                      style={{ width: 90, marginBottom: 0, fontSize: 11 }}
                      data-testid={`tender-ref-${m}`}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {nonCashExceeds && (
          <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 10 }} data-testid="noncash-error">
            QR + Wallet + Ledger cannot exceed payable amount
          </div>
        )}

        {ledgerRequiresCustomer && (
          <div style={{ marginBottom: 16 }} data-testid="customer-row">
            <span className="modal__label" style={{ fontSize: 12 }}>Customer <span style={{ color: 'var(--red)' }}>*</span></span>
            {customer ? (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', borderRadius: 8, background: 'var(--bg-card-2)',
                border: '1.5px solid var(--green)', marginBottom: 4,
              }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-1)' }}>{customer.name}</div>
                  {customer.phone && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{customer.phone}</div>}
                </div>
                <button onClick={() => setCustomer(null)} aria-label="Clear customer" data-testid="customer-clear" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 16 }}>✕</button>
              </div>
            ) : (
              <button
                data-focus-order
                onClick={() => setPickerOpen(true)}
                className="modal__input"
                style={{ textAlign: 'left', cursor: 'pointer', color: 'var(--text-3)' }}
                data-testid="customer-search-trigger"
              >
                🔍 Select customer…
              </button>
            )}
            {!customer && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 2 }} data-testid="customer-error">Customer required</div>}
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginBottom: 16 }}>
          <div className="checkout-balance" style={{ fontSize: 14 }}>
            <span>Total Tendered</span>
            <span style={{ color: 'var(--text-1)', fontWeight: 700 }}>{fmtMoney(totalTendered)}</span>
          </div>
          <div className="checkout-balance" style={{ fontSize: 14 }}>
            <span>Remaining Balance</span>
            <span style={{ color: shortfall > 0 ? 'var(--red)' : 'var(--green)', fontWeight: 700 }} data-testid="remaining-amount">{fmtMoney(shortfall)}</span>
          </div>
          {shortfall > 0 && <div style={{ color: 'var(--red)', fontSize: 12 }} data-testid="remaining-error">{fmtMoney(shortfall)} short</div>}
          <div className="checkout-balance" style={{ alignItems: 'baseline', marginTop: 4 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-2)' }}>Change Due</span>
            <span style={{ color: 'var(--green)', fontWeight: 800, fontSize: 26 }} data-testid="change-due">{fmtMoney(changeDue)}</span>
          </div>
        </div>

        <div className="modal__actions">
          <button className="modal__btn modal__btn--cancel" onClick={onCancel} data-testid="cancel-button">Cancel</button>
          <button data-focus-order className="modal__btn modal__btn--confirm" onClick={handleConfirm} disabled={!isValid} data-testid="confirm-button">
            Confirm Payment [Enter]
          </button>
        </div>
      </div>

      {pickerOpen && (
        <CustomerPickerModal
          customers={customers}
          onSelect={(c) => { setCustomer(c); setPickerOpen(false); }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
