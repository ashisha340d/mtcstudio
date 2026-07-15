/*NO AI WILL CHANGE THIS STRICKLY PROHIBITTED NO EDITS */
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
function focusStop(current, direction) {
  const root = current.closest('.checkout-modal');
  if (!root) return;
  const stops = Array.from(root.querySelectorAll('[data-focus-order]'));
  const idx = stops.indexOf(current);
  const nextIdx = idx + direction;
  if (idx === -1 || nextIdx < 0 || nextIdx >= stops.length) return;
  const next = stops[nextIdx];
  next.focus();
  if (next.select) next.select();
}

function handleStopEnter(e) {
  if (e.key === 'Enter' || e.key === 'ArrowDown') {
    e.preventDefault();
    focusStop(e.currentTarget, 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    focusStop(e.currentTarget, -1);
  }
}

function orderTypeLabel(orderMeta) {
  if (!orderMeta) return '';
  const { orderType, label, id } = orderMeta;
  if (label) return label;
  switch (orderType) {
    case 'DINE_IN': return 'Dine-In';
    case 'TAKEAWAY': return `Takeaway #${id ?? ''}`;
    case 'DELIVERY': return `Delivery #${id ?? ''}`;
    case 'CAKE_ORDER': return `Cake Order #${id ?? ''}`;
    case 'QUICK_SALE': return `Quick Order #${id ?? ''}`;
    default: return orderType ? `Order #${id ?? ''}` : '';
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
  const [refs, setRefs] = useState({ QR: '', WALLET: '', LEDGER: '' });
  const [customer, setCustomer] = useState(/** @type {Customer | null} */(null));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [focusedField, setFocusedField] = useState(/** @type {string | null} */(null));

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

  // Live-compute the sibling field on every keystroke; max clamp applies only on blur (exit).
  const handlePercentChange = (raw) => {
    const v = sanitizeNumericInput(raw);
    setDiscountPercentInput(v);
    const p = parseFloat(v);
    setDiscountAmountInput(round2(orderTotal * ((Number.isFinite(p) ? p : 0) / 100)).toFixed(2));
  };

  const handlePercentBlur = () => {
    const p = parseFloat(discountPercentInput);
    const clamped = Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 0;
    setDiscountPercentInput(String(clamped));
    setDiscountAmountInput(round2(orderTotal * (clamped / 100)).toFixed(2));
    resetTenders();
  };

  const handleAmountChange = (raw) => {
    const v = sanitizeNumericInput(raw);
    setDiscountAmountInput(v);
    const a = parseFloat(v);
    const pct = orderTotal > 0 ? round2(((Number.isFinite(a) ? a : 0) / orderTotal) * 100) : 0;
    setDiscountPercentInput(pct.toFixed(2));
  };

  const handleAmountBlur = () => {
    const a = parseFloat(discountAmountInput);
    const clamped = Number.isFinite(a) ? Math.min(orderTotal, Math.max(0, a)) : 0;
    setDiscountAmountInput(clamped.toFixed(2));
    const pct = orderTotal > 0 ? round2((clamped / orderTotal) * 100) : 0;
    setDiscountPercentInput(pct.toFixed(2));
    resetTenders();
    handleMoneyBlur();
  };

  function resetTenders() {
    setAmounts({ CASH: '', QR: '', WALLET: '', LEDGER: '' });
    setRefs({ QR: '', WALLET: '', LEDGER: '' });
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
  // setRaw uses a functional update so it reads the just-committed value (e.g. from a
  // sibling field's blur-triggered recompute) instead of a stale render-time closure.
  const handleMoneyFocus = (key, currentNumeric, setRaw) => (e) => {
    setRaw((prev) => {
      const n = parseFloat(prev);
      const fallback = Number.isFinite(n) && n > 0 ? n : currentNumeric;
      return fallback > 0 ? String(fallback) : '';
    });
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
      if (refs[m]) t.ref = refs[m];
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
      <div className="modal checkout-modal" onClick={(e) => e.stopPropagation()} style={{ padding: '0 12px 10px' }}>
        <div className="modal__title" style={{ padding: '6px 12px', margin: '0 -12px 8px' }}>Checkout</div>

        {label && (
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-2)', marginBottom: 4 }} data-testid="order-label">
            {label}
          </div>
        )}
        <div className="checkout-total" data-testid="order-total" style={{ padding: '4px 0', marginBottom: 6, justifyContent: 'flex-end', gap: 6 }}>
          <span className="checkout-total__label" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase' }}>Order Total</span>
          <span className="checkout-total__value" style={{ fontSize: 18 }}>{fmtMoney(orderTotal)}</span>
        </div>

        <div className="modal__row" style={{ marginBottom: 3, gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
          <span className="modal__label" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)', marginBottom: 0, whiteSpace: 'nowrap', textTransform: 'uppercase' }}>Discount</span>
          <input
            data-focus-order
            inputMode="decimal"
            maxLength={3}
            placeholder="0"
            value={discountPercentInput}
            onChange={(e) => handlePercentChange(e.target.value)}
            onFocus={(e) => requestAnimationFrame(() => e.target.select())}
            onBlur={handlePercentBlur}
            onKeyDown={handleStopEnter}
            onWheel={(e) => e.currentTarget.blur()}
            className="checkout-amount-input"
            style={{ fontSize: 18, marginBottom: 0, width: 62, flex: 'none', textAlign: 'right', padding: '3px 4px' }}
            data-testid="discount-percent-input"
          />
          <input
            data-focus-order
            inputMode="decimal"
            placeholder="0.00"
            value={discountDisplay}
            onChange={(e) => handleAmountChange(e.target.value)}
            onFocus={handleMoneyFocus('discountAmount', discountAmount, setDiscountAmountInput)}
            onBlur={handleAmountBlur}
            onKeyDown={handleStopEnter}
            onWheel={(e) => e.currentTarget.blur()}
            className="checkout-amount-input"
            style={{ fontSize: 18, marginBottom: 0, padding: '3px 6px', width: 84, flex: 'none', textAlign: 'right' }}
            data-testid="discount-amount-input"
          />
        </div>
        {discountExceedsTotal && (
          <div style={{ color: 'var(--red)', fontSize: 11, marginBottom: 3, textAlign: 'right' }} data-testid="discount-error">Cannot exceed order total</div>
        )}
        <div style={{ borderTop: '1px dashed var(--border)', marginBottom: 6 }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <span
            style={{
              fontSize: 18, fontWeight: 800, color: 'var(--green)', background: 'var(--bg-card-2)',
              border: '1px solid var(--green)', borderRadius: 999, padding: '3px 14px',
            }}
            data-testid="payable-amount"
          >
            Payable: {fmtMoney(payableAmount)}
          </span>
        </div>

        <span className="modal__label" style={{ fontSize: 11, marginBottom: 2 }}>Payment Methods</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 3 }}>
          {METHODS.map((m) => {
            const isCashField = m === 'CASH';
            const display = focusedField === m ? amounts[m] : (numericAmounts[m] > 0 ? fmtPlain(numericAmounts[m]) : amounts[m]);
            return (
              <div key={m} style={{ display: 'grid', gridTemplateColumns: '60px 1fr', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)', textAlign: 'right' }}>
                  {m}
                  {m === 'LEDGER' && numericAmounts.LEDGER > 0 && <span style={{ color: 'var(--red)', marginLeft: 2 }}>*</span>}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {m !== 'CASH' && (
                    <input
                      data-focus-order
                      value={refs[m]}
                      onChange={(e) => setRefs((prev) => ({ ...prev, [m]: e.target.value }))}
                      onKeyDown={handleStopEnter}
                      placeholder="Ref #"
                      className="modal__input"
                      style={{ width: 80, marginBottom: 0, fontSize: 11, padding: '4px 6px' }}
                      data-testid={`tender-ref-${m}`}
                    />
                  )}
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
                    style={{ fontSize: 18, fontWeight: 800, marginBottom: 0, padding: '4px 8px' }}
                    data-testid={`tender-input-${m}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
        {nonCashExceeds && (
          <div style={{ color: 'var(--red)', fontSize: 11, marginBottom: 4 }} data-testid="noncash-error">
            QR + Wallet + Ledger cannot exceed payable amount
          </div>
        )}

        {ledgerRequiresCustomer && (
          <div style={{ marginBottom: 8 }} data-testid="customer-row">
            <span className="modal__label" style={{ fontSize: 11, marginBottom: 2 }}>Customer <span style={{ color: 'var(--red)' }}>*</span></span>
            {customer ? (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '6px 10px', borderRadius: 8, background: 'var(--bg-card-2)',
                border: '1.5px solid var(--green)', marginBottom: 2,
              }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-1)' }}>{customer.name}</div>
                  {customer.phone && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{customer.phone}</div>}
                </div>
                <button onClick={() => setCustomer(null)} aria-label="Clear customer" data-testid="customer-clear" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 16 }}>✕</button>
              </div>
            ) : (
              <button
                data-focus-order
                onClick={() => setPickerOpen(true)}
                className="modal__input"
                style={{ textAlign: 'left', cursor: 'pointer', color: 'var(--text-3)', padding: '5px 10px', marginBottom: 0 }}
                data-testid="customer-search-trigger"
              >
                🔍 Select customer…
              </button>
            )}
            {!customer && <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 1 }} data-testid="customer-error">Customer required</div>}
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 4, marginBottom: 4 }}>
          <div className="checkout-balance" style={{ alignItems: 'center', marginBottom: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)', textAlign: 'right', flex: 1 }}>Total Tendered</span>
            <span style={{ color: 'var(--text-1)', fontWeight: 700, fontSize: 18, marginLeft: 8 }}>{fmtMoney(totalTendered)}</span>
          </div>
          <div className="checkout-balance" style={{ alignItems: 'center', marginBottom: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)', textAlign: 'right', flex: 1 }}>Remaining Balance</span>
            <span style={{ color: shortfall > 0 ? 'var(--red)' : 'var(--green)', fontWeight: 700, fontSize: 18, marginLeft: 8 }} data-testid="remaining-amount">{fmtMoney(shortfall)}</span>
          </div>
          {shortfall > 0 && (
            <div className="checkout-balance" style={{ alignItems: 'center', marginBottom: 2 }} data-testid="remaining-error">
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)', textAlign: 'right', flex: 1 }}>Short</span>
              <span style={{ color: 'var(--red)', fontWeight: 700, fontSize: 18, marginLeft: 8 }}>{fmtMoney(shortfall)}</span>
            </div>
          )}
          <div className="checkout-balance" style={{ alignItems: 'center', marginTop: 2, marginBottom: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)', textAlign: 'right', flex: 1 }}>Change Due</span>
            <span style={{ color: 'var(--green)', fontWeight: 800, fontSize: 18, marginLeft: 8 }} data-testid="change-due">{fmtMoney(changeDue)}</span>
          </div>
        </div>

        <div className="modal__actions" style={{ marginTop: 4 }}>
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
