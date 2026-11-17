import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router';
import StatusTimeline, { TRANSITIONS } from './components/StatusTimeline';
import CustomerPickerModal from '../POS/components/CustomerPickerModal';
import '../POS/pos.css';
import './cake.css';

const API = import.meta.env.VITE_API_URL || '/api';
const H = { 'Content-Type': 'application/json', 'X-Session-ID': 'dev-session' };
const Rs = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Tiny shared primitives ────────────────────────────────────
function Label({ children }) {
  return <div className="ck-label">{children}</div>;
}
function Input({ value, onChange, type = 'text', placeholder, disabled }) {
  return (
    <input type={type} value={value ?? ''} onChange={e => onChange?.(e.target.value)}
      placeholder={placeholder} className="cake-input" disabled={disabled} />
  );
}
function Textarea({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea value={value ?? ''} onChange={e => onChange?.(e.target.value)}
      placeholder={placeholder} rows={rows} className="cake-input cake-textarea" />
  );
}
function Field({ label, children, className }) {
  return (
    <div className={`ck-field${className ? ' ' + className : ''}`}>
      {label && <Label>{label}</Label>}
      {children}
    </div>
  );
}
function Section({ icon, title, action, children, className }) {
  return (
    <div className={`cake-section${className ? ' ' + className : ''}`}>
      <div className="cake-section-title">
        <span>{icon}</span> {title}
        {action && <span className="ck-sec-action">{action}</span>}
      </div>
      {children}
    </div>
  );
}

// ── Product search dropdown ───────────────────────────────────
// Full label: "Product" or "Product — Variant" (variant always shown when showVariant=true)
function productLabel(p, showVariant = false) {
  if (!p) return '';
  const hasVariant = p.variant_name && (showVariant ? true : p.variant_name !== 'Regular');
  return hasVariant ? `${p.variant_name} - ${p.product_name}` : p.product_name;
}

// ── Modifier chip selector — multi-select per group ────────────
function ModifierGroup({ label, lookups, value, onChange }) {
  const selected = value || [];
  const limit = lookups?.[0]?.multiselect || 0; // 0 = unlimited
  function toggle(id) {
    if (selected.includes(id)) { onChange(selected.filter(v => v !== id)); return; }
    if (limit === 1) { onChange([id]); return; } // single-select — replaces current pick
    if (limit > 1 && selected.length >= limit) return; // cap reached
    onChange([...selected, id]);
  }
  return (
    <div className="ck-mod-group">
      <Label>{label}{limit > 0 ? ` (max ${limit})` : ''}</Label>
      <div className="ck-chips">
        {(lookups || []).map(l => {
          const active = selected.includes(l.id);
          return (
            <button key={l.id} onClick={() => toggle(l.id)}
              style={{
                padding: '8px 16px',
                borderRadius: 999,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.02em',
                border: active ? '1px solid #8a5a12' : '1px solid #c9bda3',
                color: active ? '#fff' : '#6b5640',
                background: active
                  ? 'linear-gradient(180deg, #e8a63c 0%, #c1440e 100%)'
                  : 'linear-gradient(180deg, #ffffff 0%, #ece2cf 100%)',
                boxShadow: active
                  ? 'inset 0 1px 1px rgba(255,255,255,0.4), inset 0 -2px 3px rgba(0,0,0,0.25), 0 2px 3px rgba(0,0,0,0.2)'
                  : 'inset 0 1px 1px rgba(255,255,255,0.8), inset 0 -2px 2px rgba(0,0,0,0.08), 0 2px 3px rgba(0,0,0,0.12)',
                transform: active ? 'translateY(1px)' : 'translateY(0)',
                transition: 'all 0.1s',
              }}>
              {l.name}
              {l.extra_charge > 0 && (
                <span style={{ marginLeft: 6, opacity: 0.85, fontSize: 10 }}>+{l.extra_charge}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Deterministic warm gradient per card index — swappable for real product photos later (p.image_url)
const CARD_GRADIENTS = [
  'linear-gradient(135deg, #f3d5a5 0%, #e0a458 100%)',
  'linear-gradient(135deg, #f4b9a5 0%, #d97652 100%)',
  'linear-gradient(135deg, #e6c99f 0%, #c1440e 100%)',
  'linear-gradient(135deg, #f0d9c0 0%, #a67c52 100%)',
  'linear-gradient(135deg, #f6cf8e 0%, #b3652a 100%)',
  'linear-gradient(135deg, #edc2b1 0%, #8f4a2c 100%)',
];

// Small variant image card shown in line rows — falls back to gradient + initial
function VariantThumb({ item, products }) {
  const prod = products.find(p => p.product_id === item.product_id && (p.variant_id ?? null) === (item.variant_id ?? null));
  const img = prod?.image_url;
  return (
    <span className="ck-thumb" style={img ? undefined : { background: CARD_GRADIENTS[(item.product_id || 0) % CARD_GRADIENTS.length] }}>
      {img ? <img src={img} alt="" /> : (item.product_name || '?').charAt(0).toUpperCase()}
    </span>
  );
}

// ── Flavour picker — professional card-grid modal over the form ──
// multi: clicking toggles selection instead of closing; confirm via "Add N" button
function FlavourPickerModal({ products, onPick, onClose, title = '🎂 Pick Flavour', showVariant = false, multi = false, value = null, existingKeys = [] }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);
  const valueKey = value ? `${value.product_id}-${value.variant_id}` : null;
  const q = search.trim().toLowerCase();
  const filtered = q
    ? products.filter(p => `${p.product_name} ${p.variant_name || ''}`.toLowerCase().includes(q))
    : products;

  function keyOf(p) { return `${p.product_id}-${p.variant_id}`; }
  function qtyOf(p) { return selected.find(s => keyOf(s) === keyOf(p))?.qty || 0; }
  function setQty(p, qty) {
    const key = keyOf(p);
    setSelected(prev => {
      const idx = prev.findIndex(s => keyOf(s) === key);
      if (qty <= 0) return prev.filter((_, i) => i !== idx);
      if (idx >= 0) { const next = [...prev]; next[idx] = { ...next[idx], qty }; return next; }
      return [...prev, { ...p, qty }];
    });
  }
  const totalQty = selected.reduce((s, x) => s + x.qty, 0);

  return (
    <div className="ck-flav-overlay" onClick={onClose}>
      <div className="ck-flav-modal ck-flav-modal--cards" onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <div className="ck-flav-head">
          <div>
            <span>{title}</span>
            <span className="ck-flav-head-count">{filtered.length} item{filtered.length !== 1 ? 's' : ''}</span>
          </div>
          <button className="ck-flav-close" onClick={onClose}>✕</button>
        </div>
        <input
          className="cake-input ck-flav-search"
          autoFocus
          placeholder="🔍 Search…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="ck-flav-card-grid">
          {filtered.map((p, i) => {
            const key = `${p.product_id}-${p.variant_id}`;
            const already = multi && existingKeys.includes(key);
            const qty = multi ? qtyOf(p) : 0;
            const isSel = multi ? (already || qty > 0) : key === valueKey;
            const Card = multi ? 'div' : 'button';
            return (
              <Card
                key={key}
                className={`ck-flav-card${isSel ? ' ck-flav-card--sel' : ''}${already ? ' ck-flav-card--disabled' : ''}`}
                {...(multi ? {} : { disabled: already })}
                onClick={() => { if (already) return; multi ? setQty(p, qty + 1) : (onPick(p), onClose()); }}
              >
                <div className="ck-flav-card-img" style={{ background: p.image_url ? undefined : CARD_GRADIENTS[i % CARD_GRADIENTS.length] }}>
                  {p.image_url
                    ? <img src={p.image_url} alt="" />
                    : <span className="ck-flav-card-mono">{(p.product_name || '?').charAt(0).toUpperCase()}</span>}
                  {!multi && isSel && <span className="ck-flav-card-check">✓</span>}
                </div>
                <div className="ck-flav-card-body">
                  <span className="ck-flav-card-name">{productLabel(p, showVariant)}</span>
                  <span className="ck-flav-card-rate">₹{Number(p.rate || 0).toLocaleString('en-IN')}</span>
                </div>
                {multi && !already && qty > 0 && (
                  <div className="ck-flav-card-stepper" onClick={e => e.stopPropagation()}>
                    <button type="button" onClick={() => setQty(p, qty - 1)}>−</button>
                    <span>{qty}</span>
                    <button type="button" onClick={() => setQty(p, qty + 1)}>+</button>
                  </div>
                )}
              </Card>
            );
          })}
          {filtered.length === 0 && (
            <div className="ck-flav-empty">No items found</div>
          )}
        </div>
        {multi && (
          <div className="ck-flav-footer">
            <span className="ck-flav-footer-count">{totalQty > 0 ? `${totalQty} selected` : 'Nothing selected yet'}</span>
            <div className="ck-flav-footer-btns">
              <button className="ck-flav-btn-cancel" onClick={onClose}>Cancel</button>
              <button className="ck-flav-btn-add" disabled={totalQty === 0}
                onClick={() => { onPick(selected); onClose(); }}>
                + Add {totalQty || ''}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Modifiers modal — cream/shape/sponge/theme/dietary, multi-select per group ──
function ModifiersModal({ lookups, values, onChange, onClose }) {
  const total = values.creamIds.length + values.shapeIds.length + values.spongeIds.length + values.themeIds.length + values.dietaryIds.length;
  return (
    <div className="ck-flav-overlay" onClick={onClose}>
      <div className="ck-flav-modal ck-flav-modal--mods" onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <div className="ck-flav-head">
          <div>
            <span>🏷 Modifiers</span>
            <span className="ck-flav-head-count">{total} selected</span>
          </div>
          <button className="ck-flav-close" onClick={onClose}>✕</button>
        </div>
        <div className="ck-mods">
          <ModifierGroup label="Cream Type" lookups={lookups.CREAM_TYPE} value={values.creamIds} onChange={onChange.creamIds} />
          <ModifierGroup label="Shape" lookups={lookups.SHAPE_TYPE} value={values.shapeIds} onChange={onChange.shapeIds} />
          <ModifierGroup label="Sponge" lookups={lookups.SPONGE_TYPE} value={values.spongeIds} onChange={onChange.spongeIds} />
          <ModifierGroup label="Theme" lookups={lookups.THEME_TYPE} value={values.themeIds} onChange={onChange.themeIds} />
          <ModifierGroup label="Dietary" lookups={lookups.DIETARY_TYPE} value={values.dietaryIds} onChange={onChange.dietaryIds} />
        </div>
        <div className="ck-flav-footer">
          <span className="ck-flav-footer-count">Tap a chip to toggle it — pick as many as you need per category</span>
          <div className="ck-flav-footer-btns">
            <button className="ck-flav-btn-add" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Details modal — single-column form, max 3 reference images ──
function DetailsModal({ values, onChange, images, onUpload, onRemoveImage, onClose }) {
  return (
    <div className="ck-flav-overlay" onClick={onClose}>
      <div className="ck-flav-modal ck-flav-modal--mods" onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <div className="ck-flav-head">
          <div><span>📝 Cake Order Detail</span></div>
          <button className="ck-flav-close" onClick={onClose}>✕</button>
        </div>
        <div className="ck-mods">
          <Field label="Design Notes">
            <Textarea value={values.designNotes} onChange={onChange.designNotes} placeholder="Decorations, finishing…" rows={2} />
          </Field>
          <Field label="Dietary Notes">
            <Textarea value={values.dietaryNotes} onChange={onChange.dietaryNotes} placeholder="Eggless, nut-free…" rows={2} />
          </Field>
          <Field label="Internal Notes">
            <Input value={values.internalNotes} onChange={onChange.internalNotes} placeholder="Staff notes…" />
          </Field>
          <Field label={`Reference Images (${images.length}/3)`}>
            <div className="cake-photo-area">
              {images.map((img, i) => (
                <div key={i} className="cake-photo-thumb">
                  <img src={img.url || img} alt="" />
                  <button className="cake-photo-rm" onClick={() => onRemoveImage(i)}>×</button>
                </div>
              ))}
              {images.length < 3 && (
                <label className="cake-photo-add">
                  <input type="file" multiple accept="image/*" style={{ display: 'none' }}
                    onChange={e => onUpload(Array.from(e.target.files).slice(0, 3 - images.length))} />
                  <span>📷 Add</span>
                </label>
              )}
            </div>
          </Field>
        </div>
        <div className="ck-flav-footer">
          <span className="ck-flav-footer-count" />
          <div className="ck-flav-footer-btns">
            <button className="ck-flav-btn-add" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Advance payment modal — split across methods ──────────────
const PAY_METHODS = [['CASH', '💵 Cash'], ['CARD', '💳 Card'], ['QR', '📱 QR'], ['WALLET', '👛 Wallet']];

// ── Payment options modal — totals + discount + advance split, one panel ──
function PricingModal({ totals, discount, onDiscountChange, amounts, advLocked, readOnly, followupPaid, payHistory, onConfirm, onClose }) {
  const [local, setLocal] = useState(amounts);
  const advEntered = Object.values(local).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const paid = advEntered + followupPaid;
  const locked = advLocked || readOnly;

  return (
    <div className="ck-flav-overlay" onClick={onClose}>
      <div className="ck-flav-modal ck-flav-modal--pay" onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <div className="ck-flav-head">
          <span>💰 Payment Options</span>
          <button className="ck-flav-close" onClick={onClose}>✕</button>
        </div>
        {/* Two columns: totals left, advance split + history right — everything visible at once */}
        <div className="ck-pay-grid">
          <div className="ck-pay-col">
            <div className="ck-price-row"><span>Cake Total</span><span>{Rs(totals.cake_total)}</span></div>
            {totals.modifier_total > 0 && <div className="ck-price-row"><span>Modifiers</span><span>+{Rs(totals.modifier_total)}</span></div>}
            {totals.accessory_total > 0 && <div className="ck-price-row"><span>Accessories</span><span>+{Rs(totals.accessory_total)}</span></div>}
            <div className="ck-price-row">
              <span>Discount</span>
              <input className="ck-price-input" type="number" min="0" step="0.01" placeholder="0"
                disabled={readOnly} value={discount} onChange={e => onDiscountChange(e.target.value)} />
            </div>
            <div className="ck-price-row ck-price-grand"><span>Total</span><span>{Rs(totals.grand_total)}</span></div>
            <div className="ck-price-row"><span>Paid</span><span>{Rs(paid)}</span></div>
            <div className={`ck-price-row ck-price-balance${totals.grand_total - paid > 0 ? ' ck-price-balance--due' : ''}`}>
              <span>Balance</span><span>{Rs(totals.grand_total - paid)}</span>
            </div>
          </div>

          <div className="ck-pay-col">
            <div className="ck-label">Advance</div>
            {PAY_METHODS.map(([m, label], i) => (
              <div key={m} className="ck-pay-row">
                <span className="ck-pay-label">{label}</span>
                <input
                  id={`ck-adv-${m}`}
                  className="cake-input cake-input--num"
                  type="number" min="0" step="0.01" placeholder="0.00"
                  disabled={locked}
                  value={local[m]}
                  onFocus={e => e.target.select()}
                  onKeyDown={e => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    if (i < PAY_METHODS.length - 1) document.getElementById(`ck-adv-${PAY_METHODS[i + 1][0]}`)?.focus();
                    else if (!locked) { onConfirm(local); onClose(); }
                  }}
                  onChange={e => setLocal(prev => ({ ...prev, [m]: e.target.value }))}
                />
              </div>
            ))}
            {advLocked && <div className="cake-subtitle">🔒 Advance locked — business day closed. Reopen the day to change it.</div>}
            {readOnly && <div className="cake-subtitle">🔒 Sent to bakery — further payment via POS Dashboard.</div>}

            {payHistory.length > 0 && (
              <div className="ck-pay-hist">
                <div className="ck-label">Payment History</div>
                {payHistory.map(p => (
                  <div key={p.id} className="ck-pay-hist-row">
                    <span>
                      {p.amount < 0 ? 'Reversal' : (p.payment_type === 'ADVANCE' ? 'Advance' : 'Follow-up')} · {p.method}
                      <span className="ck-pay-hist-when">
                        {new Date(String(p.created_at).replace(' ', 'T') + '+05:45').toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </span>
                    <span className={`ck-pay-hist-amt${p.amount < 0 ? ' ck-pay-hist-amt--neg' : ''}`}>{Rs(p.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="ck-flav-footer">
          <span className="ck-flav-footer-count" />
          <div className="ck-flav-footer-btns">
            <button className="ck-flav-btn-cancel" onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</button>
            {!readOnly && <button className="ck-flav-btn-add" onClick={() => { onConfirm(local); onClose(); }}>Confirm</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Cake item row ─────────────────────────────────────────────
function CakeItemRow({ item, products, onChange, onRemove }) {
  const [showFlav, setShowFlav] = useState(false);
  function set(key, val) { onChange({ ...item, [key]: val }); }
  const amount = (parseFloat(item.rate) || 0) * (parseInt(item.qty) || 1);

  function onProductSelect(p) {
    if (!p) { set('product_id', null); set('product_name', ''); set('variant_id', null); set('variant_name', ''); set('rate', ''); return; }
    onChange({ ...item, product_id: p.product_id, product_name: p.product_name, variant_id: p.variant_id, variant_name: p.variant_name, rate: p.rate || '' });
  }

  const pickerVal = item.product_id
    ? { product_id: item.product_id, product_name: item.product_name, variant_id: item.variant_id, variant_name: item.variant_name }
    : null;

  return (
    <tr className="ck-line-row">
      <td style={{ minWidth: 140 }}>
        <button className={`ck-flavour-btn${pickerVal ? '' : ' ck-flavour-btn--empty'}`} onClick={() => setShowFlav(true)}>
          {pickerVal
            ? <><VariantThumb item={item} products={products} /><span className="ck-flavour-name">{productLabel(pickerVal)}</span></>
            : '🎂 Pick flavour…'}
        </button>
        {showFlav && (
          <FlavourPickerModal products={products} onPick={onProductSelect} onClose={() => setShowFlav(false)} value={pickerVal} />
        )}
      </td>
      <td style={{ width: 70 }}>
        <input className="cake-input cake-input--sm" value={item.size || ''} onChange={e => set('size', e.target.value)} placeholder="1 lbs…" />
      </td>
      <td style={{ width: 50 }}>
        <input className="cake-input cake-input--sm" type="number" min="1" value={item.qty || 1}
          onChange={e => set('qty', parseInt(e.target.value) || 1)} />
      </td>
      <td style={{ width: 80 }}>
        <input className="cake-input cake-input--sm cake-input--num" type="number" min="0" step="0.01"
          value={item.rate ?? ''} onChange={e => set('rate', e.target.value)} placeholder="0.00" />
      </td>
      <td style={{ width: 80 }} className="ck-line-amount">{Rs(amount)}</td>
      <td style={{ width: 36 }}>
        <button className="ck-rm-btn" onClick={onRemove}>×</button>
      </td>
    </tr>
  );
}

// ── Accessory row ─────────────────────────────────────────────
function AccessoryRow({ item, products, onChange, onRemove }) {
  const [showPick, setShowPick] = useState(false);
  function set(key, val) { onChange({ ...item, [key]: val }); }
  const amount = (parseFloat(item.rate) || 0) * (parseInt(item.qty) || 1);

  function onProductSelect(p) {
    if (!p) { set('product_id', null); set('product_name', ''); set('variant_id', null); set('variant_name', ''); set('rate', ''); return; }
    onChange({ ...item, product_id: p.product_id, product_name: p.product_name, variant_id: p.variant_id, variant_name: p.variant_name, rate: p.rate || '' });
  }

  const pickerVal = item.product_id
    ? { product_id: item.product_id, product_name: item.product_name, variant_id: item.variant_id, variant_name: item.variant_name }
    : null;

  return (
    <tr className="ck-line-row">
      <td style={{ minWidth: 140 }}>
        <button className={`ck-flavour-btn${pickerVal ? '' : ' ck-flavour-btn--empty'}`} onClick={() => setShowPick(true)}>
          {pickerVal
            ? <><VariantThumb item={item} products={products} /><span className="ck-flavour-name">{productLabel(pickerVal, true)}</span></>
            : '🎁 Pick accessory…'}
        </button>
        {showPick && (
          <FlavourPickerModal products={products} onPick={onProductSelect} onClose={() => setShowPick(false)}
            title="🎁 Pick Accessory" showVariant value={pickerVal} />
        )}
      </td>
      <td style={{ width: 70 }} className="ck-line-dash">—</td>
      <td style={{ width: 50 }}>
        <input className="cake-input cake-input--sm" type="number" min="1" value={item.qty || 1}
          onChange={e => set('qty', parseInt(e.target.value) || 1)} />
      </td>
      <td style={{ width: 80 }}>
        <input className="cake-input cake-input--sm cake-input--num" type="number" min="0" step="0.01"
          value={item.rate ?? ''} onChange={e => set('rate', e.target.value)} placeholder="0.00" />
      </td>
      <td style={{ width: 80 }} className="ck-line-amount">{Rs(amount)}</td>
      <td style={{ width: 36 }}>
        <button className="ck-rm-btn" onClick={onRemove}>×</button>
      </td>
    </tr>
  );
}

function isNepaliNumber(phone) {
  const p = String(phone || '').replace(/\D/g, '');
  return /^9779[678]\d{8}$/.test(p) || /^9[678]\d{8}$/.test(p) || /^09[678]\d{8}$/.test(p);
}

const newItem = () => ({ _key: Math.random(), product_id: null, product_name: '', variant_id: null, variant_name: '', size: '', unit: 'PCS', qty: 1, rate: '' });
const newAcc = () => ({ _key: Math.random(), product_id: null, product_name: '', variant_id: null, variant_name: '', unit: 'PCS', qty: 1, rate: '' });

// ── Shell: full page (route mode) or draggable/resizable window ──
function WindowShell({ windowed, rect, startMove, startResize, title, onCloseWin, onKeyDown, children }) {
  if (!windowed) return <div className="cake-root" onKeyDown={onKeyDown}>{children}</div>;
  return (
    <div className="ckw-overlay">
      <div
        className="ckw-window"
        style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
        onKeyDown={onKeyDown}
      >
        <div className="ckw-chrome" onMouseDown={startMove}>
          <div className="desktop-chrome__dots">
            <button className="win-dot win-dot--close ckw-dot-btn" onClick={onCloseWin} title="Close" />
            <div className="win-dot win-dot--min" />
            <div className="win-dot win-dot--max" />
          </div>
          <span className="ckw-chrome-title">{title}</span>
        </div>
        <div className="ckw-body">{children}</div>
        <div className="ckw-resize" onMouseDown={startResize} title="Drag to resize">◢</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  Main form
// ═══════════════════════════════════════════════════════════════
export default function CakeOrderForm({ id: propId = null, onClose = null }) {
  const params = useParams();
  const navigate = useNavigate();
  const windowed = !!onClose;                       // rendered as window over dashboard
  const [curId, setCurId] = useState(propId ?? params.id ?? null);
  const id = curId;
  const isNew = !id;

  function exit() { windowed ? onClose() : navigate('/pos'); }

  const [showModifiersModal, setShowModifiersModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showAddAccModal, setShowAddAccModal] = useState(false);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [showStatusSticky, setShowStatusSticky] = useState(false);

  // Double-ESC → close / POS dashboard
  const lastEscRef = useRef(0);
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return;
      const now = Date.now();
      if (now - lastEscRef.current < 420) exit();
      lastEscRef.current = now;
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, windowed]); // eslint-disable-line

  // ── Remote data ────────────────────────────────────────────
  const [lookups, setLookups] = useState({});
  const [baseProducts, setBaseProducts] = useState([]);
  const [accProducts, setAccProducts] = useState([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [errors, setErrors] = useState({});
  const [statusChanging, setStatusChanging] = useState(false);

  // ── Order header ────────────────────────────────────────────
  const [orderNum, setOrderNum] = useState('');
  const [orderDate, setOrderDate] = useState('');
  const [status, setStatus] = useState('PENDING');
  const [sendingWA, setSendingWA] = useState(false);
  const [sendingSMS, setSendingSMS] = useState(false);
  const [history, setHistory] = useState([]);

  // ── Customer ────────────────────────────────────────────────
  const [phone, setPhone] = useState('');
  const [crmId, setCrmId] = useState(null);
  const [crmHint, setCrmHint] = useState('');
  const [custName, setCustName] = useState('');
  const [showCustPicker, setShowCustPicker] = useState(false);

  // ── Delivery ────────────────────────────────────────────────
  const [delivDate, setDelivDate] = useState('');
  const [delivTime, setDelivTime] = useState('');

  // ── Cake items & accessories ────────────────────────────────
  const [items, setItems] = useState([]);
  const [accessories, setAccessories] = useState([]);

  // ── Modifiers ───────────────────────────────────────────────
  const [creamIds, setCreamIds] = useState([]);
  const [shapeIds, setShapeIds] = useState([]);
  const [spongeIds, setSpongeIds] = useState([]);
  const [themeIds, setThemeIds] = useState([]);
  const [dietaryIds, setDietaryIds] = useState([]);

  // ── Cake details ────────────────────────────────────────────
  const [message, setMessage] = useState('');
  const [designNotes, setDesignNotes] = useState('');
  const [dietaryNotes, setDietaryNotes] = useState('');
  const [allergyNotes, setAllergyNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [assignedBaker, setAssignedBaker] = useState('');

  // ── Pricing ─────────────────────────────────────────────────
  const [discount, setDiscount] = useState('0');
  // Advance can be split across methods; follow-ups are collected via POS Dashboard
  const [advAmounts, setAdvAmounts] = useState({ CASH: '', CARD: '', QR: '', WALLET: '' });
  const [advLocked, setAdvLocked] = useState(false); // advance rows on a closed business day — frozen
  const [showPayModal, setShowPayModal] = useState(false);
  const [followupPaid, setFollowupPaid] = useState(0);
  const [payHistory, setPayHistory] = useState([]);
  // Totals returned from server after save; locally estimated otherwise
  const [serverTotals, setServerTotals] = useState(null);

  // ── Images ──────────────────────────────────────────────────
  const [images, setImages] = useState([]);

  // ── Local pricing estimate ──────────────────────────────────
  const cakeTotal = items.reduce((s, it) => s + (parseFloat(it.rate) || 0) * (parseInt(it.qty) || 1), 0);
  const accTotal = accessories.reduce((s, ac) => s + (parseFloat(ac.rate) || 0) * (parseInt(ac.qty) || 1), 0);
  const modTotal = [...creamIds, ...shapeIds, ...spongeIds, ...themeIds, ...dietaryIds].reduce((s, lid) => {
    const all = Object.values(lookups).flat();
    const lk = all.find(l => l.id === lid);
    return s + (lk?.extra_charge || 0);
  }, 0);
  const disc = parseFloat(discount) || 0;
  const grand = Math.max(0, cakeTotal + accTotal + modTotal - disc);
  const advSum = Object.values(advAmounts).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const advance = advSum + followupPaid;
  const balance = Math.max(0, grand - advance);

  // ── Load meta (lookups + order number) ─────────────────────
  useEffect(() => {
    fetch(`${API}/pos/cake-orders/meta`, { headers: H })
      .then(r => r.json())
      .then(d => {
        setLookups(d.lookups || {});
        if (isNew) { setOrderNum(d.nextOrderNumber); setOrderDate(d.today); setDelivDate(d.today); }
      }).catch(() => { });
    fetch(`${API}/pos/cake-orders/products?type=base`, { headers: H })
      .then(r => r.json()).then(setBaseProducts).catch(() => { });
    fetch(`${API}/pos/cake-orders/products?type=accessory`, { headers: H })
      .then(r => r.json()).then(setAccProducts).catch(() => { });
  }, [isNew]);

  // ── Load existing order ─────────────────────────────────────
  useEffect(() => {
    if (isNew) return;
    setLoading(true);
    fetch(`${API}/pos/cake-orders/${id}`, { headers: H })
      .then(r => r.json())
      .then(d => {
        setOrderNum(d.order_number ?? '');
        setOrderDate(d.order_date ?? '');
        setStatus(d.status ?? 'PENDING');
        setHistory(d.statusHistory ?? []);
        setPhone(d.phone ?? '');
        setCrmId(d.crm_customer_id ?? null);
        setCustName(d.customer_name ?? '');
        setDelivDate(d.delivery_date ?? '');
        setDelivTime(d.delivery_time ?? '');
        setCreamIds(d.cream_ids ?? []);
        setShapeIds(d.shape_ids ?? []);
        setSpongeIds(d.sponge_ids ?? []);
        setThemeIds(d.theme_ids ?? []);
        setDietaryIds(d.dietary_ids ?? []);
        setMessage(d.message_on_cake ?? '');
        setDesignNotes(d.design_notes ?? '');
        setDietaryNotes(d.dietary_notes ?? '');
        setAllergyNotes(d.allergy_notes ?? '');
        setInternalNotes(d.internal_notes ?? '');
        setAssignedBaker(d.assigned_baker ?? '');
        setDiscount(String(d.discount ?? '0'));
        // Rebuild advance breakdown + follow-up total from payment rows
        const pays = d.payments ?? [];
        const adv = { CASH: 0, CARD: 0, QR: 0, WALLET: 0 };
        let followup = 0;
        for (const p of pays) {
          if (p.payment_type === 'ADVANCE') adv[p.method] = (adv[p.method] || 0) + Number(p.amount);
          else followup += Number(p.amount);
        }
        if (!pays.some(p => p.payment_type === 'ADVANCE') && Number(d.advance_paid) > followup) {
          // Legacy order without advance rows — show the stored total under its method
          const m = ['CASH', 'CARD', 'QR', 'WALLET'].includes(d.advance_method) ? d.advance_method : 'CASH';
          adv[m] = Number(d.advance_paid) - followup;
        }
        setAdvAmounts(Object.fromEntries(Object.entries(adv).map(([m, v]) => [m, v > 0 ? String(v) : ''])));
        setAdvLocked(!!d.advance_locked);
        setFollowupPaid(followup);
        setPayHistory(pays);
        setImages((d.images ?? []).map(img => ({ url: img.image_url, name: img.image_name || '' })));
        setServerTotals({ cake_total: d.cake_total, modifier_total: d.modifier_total, accessory_total: d.accessory_total, grand_total: d.grand_total, advance_paid: d.advance_paid, balance_due: d.balance_due });
        // Restore line items
        setItems((d.items || []).map(it => ({ _key: Math.random(), product_id: it.product_id, product_name: it.product_name, variant_id: it.variant_id, variant_name: it.variant_name, size: it.size || '', unit: it.unit, qty: it.qty, rate: it.rate })));
        setAccessories((d.accessories || []).map(ac => ({ _key: Math.random(), product_id: ac.product_id, product_name: ac.product_name, variant_id: ac.variant_id, variant_name: ac.variant_name, unit: ac.unit, qty: ac.qty, rate: ac.rate })));
      })
      .finally(() => setLoading(false));
  }, [id, isNew]);

  // ── CRM phone lookup ────────────────────────────────────────
  const crmTimer = useRef(null);
  function onPhoneChange(val) {
    setPhone(val); setCrmHint('');
    clearTimeout(crmTimer.current);
    if (val.trim().length < 7) return;
    crmTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`${API}/crm/customers/${encodeURIComponent(val.trim())}`, { headers: H });
        if (r.ok) {
          const d = await r.json();
          if (d?.name) { setCrmHint(`✓ ${d.name}`); setCustName(d.name); setCrmId(d.id ?? null); }
        }
      } catch { }
    }, 400);
  }

  // ── Image upload ────────────────────────────────────────────
  async function handleImageUpload(files) {
    if (!files.length) return;
    const form = new FormData();
    for (const f of files) form.append('photos', f);
    try {
      const r = await fetch(`${API}/pos/cake-orders/upload`, { method: 'POST', headers: { 'X-Session-ID': 'dev-session' }, body: form });
      if (r.ok) {
        const d = await r.json();
        setImages(prev => [...prev, ...(d.urls || [])]);
      }
    } catch (e) { alert('Upload failed: ' + e.message); }
  }

  // ── Validation ──────────────────────────────────────────────
  function validate() {
    const e = {};
    if (!custName.trim()) e.custName = 'Required';
    if (!delivDate) e.delivDate = 'Required';
    if (!items.some(it => it.product_name?.trim() || it.rate > 0)) e.items = 'Add at least one cake item';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  // ── Payload ─────────────────────────────────────────────────
  function payload() {
    return {
      crm_customer_id: crmId,
      phone: phone.trim() || null,
      customer_name: custName.trim(),
      delivery_date: delivDate || null,
      delivery_time: delivTime || null,
      shape_id: shapeIds, cream_type_id: creamIds, sponge_type_id: spongeIds,
      theme_id: themeIds, dietary_type_id: dietaryIds,
      message_on_cake: message.trim() || null,
      design_notes: designNotes.trim() || null,
      dietary_notes: dietaryNotes.trim() || null,
      allergy_notes: allergyNotes.trim() || null,
      internal_notes: internalNotes.trim() || null,
      assigned_baker: assignedBaker.trim() || null,
      discount: parseFloat(discount) || 0,
      advance_paid: advSum,
      advance_payments: Object.entries(advAmounts)
        .filter(([, v]) => (parseFloat(v) || 0) > 0)
        .map(([m, v]) => ({ method: m, amount: parseFloat(v) })),
      items: items.filter(it => it.product_name?.trim() || parseFloat(it.rate) > 0).map(it => ({
        product_id: it.product_id, variant_id: it.variant_id,
        product_name: it.product_name, variant_name: it.variant_name,
        size: it.size || null, unit: it.unit || 'PCS',
        qty: parseInt(it.qty) || 1, rate: parseFloat(it.rate) || 0,
      })),
      accessories: accessories.filter(ac => ac.product_name?.trim()).map(ac => ({
        product_id: ac.product_id, variant_id: ac.variant_id,
        product_name: ac.product_name, variant_name: ac.variant_name,
        unit: ac.unit || 'PCS', qty: parseInt(ac.qty) || 1, rate: parseFloat(ac.rate) || 0,
      })),
      images,
    };
  }

  // ── Save ────────────────────────────────────────────────────
  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      const url = isNew ? `${API}/pos/cake-orders` : `${API}/pos/cake-orders/${id}`;
      const method = isNew ? 'POST' : 'PUT';
      const r = await fetch(url, { method, headers: H, body: JSON.stringify(payload()) });
      if (!r.ok) { const d = await r.json(); alert(d.error || 'Save failed'); return; }
      const saved = await r.json();
      setServerTotals({ cake_total: saved.cake_total, modifier_total: saved.modifier_total, accessory_total: saved.accessory_total, grand_total: saved.grand_total, advance_paid: saved.advance_paid, balance_due: saved.balance_due });
      setPayHistory(saved.payments ?? []);
      if (isNew) {
        if (windowed) setCurId(saved.id);
        else navigate(`/pos/cake/${saved.id}`, { replace: true });
      }
    } finally { setSaving(false); }
  }

  // ── Status transition ────────────────────────────────────────
  async function handleTransition(newStatus) {
    setStatusChanging(true);
    try {
      const r = await fetch(`${API}/pos/cake-orders/${id}/status`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: newStatus }) });
      if (!r.ok) { const d = await r.json(); alert(d.error || 'Status change failed'); return; }
      const d = await r.json();
      setStatus(d.status);
      setHistory(d.statusHistory ?? []);
      if (newStatus === 'CONFIRMED' && !(Number(d.advance_paid) > 0)) setShowPayModal(true); // no payment yet → collect it before sending to bakery
    } finally { setStatusChanging(false); }
  }

  // ── Print ────────────────────────────────────────────────────
  async function handlePrint() {
    if (!id || printing) return;
    setPrinting(true);
    try {
      const r = await fetch(`${API}/pos/cake-orders/${id}/print`, { method: 'POST', headers: H });
      if (!r.ok) alert((await r.text()) || 'Print failed');
    } catch (e) {
      alert(e.message);
    } finally {
      setPrinting(false);
    }
  }

  // ── WhatsApp ──────────────────────────────────────────────────
  async function handleSendWhatsApp() {
    if (!id || sendingWA) return;
    setSendingWA(true);
    try {
      const r = await fetch(`${API}/pos/cake-orders/${id}/whatsapp-message`, { headers: H });
      const d = await r.json();
      if (!r.ok) { alert(d.error || 'Could not build WhatsApp message'); return; }
      window.open(`https://wa.me/${d.phone}?text=${encodeURIComponent(d.message)}`, '_blank');
    } finally { setSendingWA(false); }
  }

  // ── Viber ─────────────────────────────────────────────────────
  function handleSendViber() {
    if (!phone?.trim()) return;
    const p = String(phone).replace(/\D/g, '');
    window.open(`viber://chat?number=%2B977${p.slice(-10)}`, '_blank');
  }

  // ── SMS (Nepal only) ────────────────────────────────────────────
  async function handleSendSMS() {
    if (!id || sendingSMS) return;
    setSendingSMS(true);
    try {
      const r = await fetch(`${API}/pos/cake-orders/${id}/send-sms`, { method: 'POST', headers: H });
      const d = await r.json();
      if (!r.ok) { alert(d.error || 'Could not send SMS'); return; }
      alert('SMS sent to ' + d.phone);
    } finally { setSendingSMS(false); }
  }

  // ── Display totals (prefer server after first save) ──────────
  const totals = serverTotals || { cake_total: cakeTotal, modifier_total: modTotal, accessory_total: accTotal, grand_total: grand, advance_paid: advance, balance_due: balance };

  function addAccessoryFromPick(picked) {
    const rows = (Array.isArray(picked) ? picked : [picked]).map(p =>
      ({ ...newAcc(), product_id: p.product_id, product_name: p.product_name, variant_id: p.variant_id, variant_name: p.variant_name, rate: p.rate || '', qty: p.qty || 1 }));
    setAccessories(prev => [...prev, ...rows]);
    setServerTotals(null);
  }

  function addItemsFromPick(picked) {
    const rows = (Array.isArray(picked) ? picked : [picked]).map(p =>
      ({ ...newItem(), product_id: p.product_id, product_name: p.product_name, variant_id: p.variant_id, variant_name: p.variant_name, rate: p.rate || '', qty: p.qty || 1 }));
    setItems(prev => [...prev, ...rows]);
    setServerTotals(null);
  }

  function handleEnterNext(e) {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;

    const el = e.target;
    if (!el || el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON') return;
    if (!['INPUT', 'SELECT'].includes(el.tagName)) return;

    e.preventDefault();
    const root = e.currentTarget;
    const controls = Array.from(root.querySelectorAll(
      'input:not([type="hidden"]):not([type="file"]), select, textarea'
    )).filter(control => {
      if (control.disabled || control.readOnly) return false;
      if (control.offsetParent === null) return false;
      return true;
    });

    const idx = controls.indexOf(el);
    const next = controls[idx + 1] || controls[0];
    if (!next || next === el) return;

    next.focus();
    if (typeof next.select === 'function' && next.tagName === 'INPUT') next.select();
  }

  /* ── Window rect (windowed mode) — drag + resize, persisted ── */
  const [rect, setRect] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem('cake_win_rect'));
      if (s?.w >= 720) return s;
    } catch { }
    const w = Math.min(1064, window.innerWidth - 60);
    const h = Math.min(600, window.innerHeight - 50);
    return { x: Math.max(10, (window.innerWidth - w) / 2), y: Math.max(10, (window.innerHeight - h) / 2), w, h };
  });
  const rectRef = useRef(rect);
  rectRef.current = rect;
  const dragRef = useRef(null);

  useEffect(() => {
    if (!windowed) return;
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (d.mode === 'move') {
        setRect(r => ({
          ...r,
          x: Math.max(-r.w + 140, Math.min(window.innerWidth - 140, d.start.x + dx)),
          y: Math.max(0, Math.min(window.innerHeight - 60, d.start.y + dy)),
        }));
      } else {
        setRect(r => ({
          ...r,
          w: Math.max(720, Math.min(window.innerWidth, d.start.w + dx)),
          h: Math.max(480, Math.min(window.innerHeight, d.start.h + dy)),
        }));
      }
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.userSelect = '';
      try { localStorage.setItem('cake_win_rect', JSON.stringify(rectRef.current)); } catch { }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [windowed]);

  const startMove = (e) => {
    if (e.target.closest('button')) return; // dots stay clickable
    dragRef.current = { mode: 'move', sx: e.clientX, sy: e.clientY, start: rectRef.current };
    document.body.style.userSelect = 'none';
    e.preventDefault();
  };
  const startResize = (e) => {
    dragRef.current = { mode: 'resize', sx: e.clientX, sy: e.clientY, start: rectRef.current };
    document.body.style.userSelect = 'none';
    e.preventDefault();
    e.stopPropagation();
  };

  const shellProps = {
    windowed, rect, startMove, startResize,
    onCloseWin: exit,
    onKeyDown: handleEnterNext,
    title: isNew ? '🎂 New Cake Order' : `🎂 ${orderNum}${custName ? ' · ' + custName : ''}`,
  };

  if (loading) return <WindowShell {...shellProps}><div className="cake-loading">Loading…</div></WindowShell>;

  // Section badges
  const modCount = creamIds.length + shapeIds.length + spongeIds.length + themeIds.length + dietaryIds.length;
  const detailCount = [designNotes, dietaryNotes, internalNotes].filter(s => s?.trim()).length + images.length;

  // Customer + delivery must be filled before items/modifiers/pricing unlock
  const custReady = !!(custName.trim() && delivDate && delivTime);
  const hasAmount = items.some(it => (parseFloat(it.rate) || 0) > 0);
  const payReady = custReady && hasAmount;
  const locked = !isNew && status !== 'PENDING'; // sent to bakery — Unsend to edit
  const lockHint = locked ? 'Order sent to bakery — Unsend to edit'
    : (!custReady ? 'Fill customer name, delivery date & time first'
    : (!hasAmount ? 'Add a cake line item with an amount first' : undefined));

  // Selected modifiers, resolved to names — shown as a read-only grid on the bill
  const selectedMods = [
    ['Cream', lookups.CREAM_TYPE, creamIds, setCreamIds],
    ['Shape', lookups.SHAPE_TYPE, shapeIds, setShapeIds],
    ['Sponge', lookups.SPONGE_TYPE, spongeIds, setSpongeIds],
    ['Theme', lookups.THEME_TYPE, themeIds, setThemeIds],
    ['Dietary', lookups.DIETARY_TYPE, dietaryIds, setDietaryIds],
  ].flatMap(([group, list, ids, setIds]) =>
    ids.map(id => {
      const l = (list || []).find(x => x.id === id);
      return l ? { group, name: l.name, extra_charge: l.extra_charge, onRemove: () => { setIds(ids.filter(x => x !== id)); setServerTotals(null); } } : null;
    }).filter(Boolean)
  );

  // Detail fields formatted into a readable paragraph, shown under the modifiers grid
  const detailParts = [
    ['Design', designNotes, setDesignNotes, 'ck-detail-box--design'],
    ['Dietary', dietaryNotes, setDietaryNotes, 'ck-detail-box--dietary'],
    ['Notes', internalNotes, setInternalNotes, 'ck-detail-box--notes'],
  ].filter(([, v]) => v?.trim());

  return (
    <WindowShell {...shellProps}>

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="cake-header">
        {!windowed && <button className="cake-back-btn" onClick={() => navigate('/pos')}>← POS</button>}

        <div className="ck-toolbar">
          {!isNew && (
            <div className="ck-status-ribbon">
              <button className="cake-btn-ghost" onClick={handlePrint} disabled={printing}>{printing ? '…' : '🖨 Print'}</button>
              <button className="cake-btn-ghost" onClick={handleSendWhatsApp} disabled={sendingWA || !phone?.trim() || status !== 'CONFIRMED'}>{sendingWA ? '…' : '📲 WhatsApp'}</button>
              <button className="cake-btn-ghost" onClick={handleSendViber} disabled={!phone?.trim()}>📞 Viber</button>
              <button className="cake-btn-ghost" onClick={handleSendSMS} disabled={sendingSMS || !phone?.trim() || status !== 'CONFIRMED' || !isNepaliNumber(phone)}>{sendingSMS ? '…' : '✉️ SMS'}</button>
              {status === 'CONFIRMED' && (
                <button className="cake-btn-ghost" onClick={() => handleTransition('PENDING')} disabled={statusChanging}>↩ Unsend</button>
              )}
              {(TRANSITIONS[status] || []).includes('CANCELLED') && (
                <button className="cake-btn-danger" onClick={() => handleTransition('CANCELLED')} disabled={statusChanging}>❌ Cancel</button>
              )}
              <button className="cake-btn-primary" onClick={handleSave} disabled={saving || locked} title={locked ? lockHint : undefined}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
          {isNew && (
            <button className="cake-btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Create Order'}
            </button>
          )}
        </div>
      </div>

      {/* ── Single-column body ───────────────────────────────── */}
      <div className="cake-form-body">
        <Section icon="🎂" title={isNew ? 'New Cake Order' : `${orderNum}${orderDate ? ' · ' + orderDate : ''}`}
          action={<>
            <button className="cake-btn-ghost" disabled={!custReady || locked} title={lockHint} onClick={() => setShowAddItemModal(true)}>🎂Cake</button>
            <button className="cake-btn-ghost" disabled={!custReady || locked} title={lockHint} onClick={() => setShowAddAccModal(true)}>🎉Accessory</button>
            <button className="cake-btn-ghost" disabled={!custReady || locked} title={lockHint} onClick={() => setShowModifiersModal(true)}>
              🔧 Modify Cake{modCount > 0 ? ` · ${modCount}` : ''}
            </button>
            <button className="cake-btn-ghost" disabled={!custReady || locked} title={lockHint} onClick={() => setShowDetailsModal(true)}>
              📝 Detail{detailCount > 0 ? ` · ${detailCount}` : ''}
            </button>
            {!isNew && history.length > 0 && (
              <button type="button" className="ck-pin-btn" title="Status History" onClick={() => setShowStatusSticky(v => !v)}>
                📌 History<span className="ck-sec-badge">{history.length}</span>
              </button>
            )}
          </>}>

          {/* Customer + delivery — everything else unlocks once this row is complete; locks again once sent to bakery */}
          <div className="ck-row ck-row--cust">
            <div className={`ck-row ck-cust-fields${locked ? ' ck-locked' : ''}`} title={locked ? lockHint : undefined}>
              <Field label="Phone" className="ck-field--phone">
                <Input value={phone} onChange={onPhoneChange} type="tel" placeholder="98XXXXXXXX" />
                {crmHint && <div className="cake-crm-hint">{crmHint}</div>}
              </Field>

              <Field label="Name *" className="ck-field--grow">
                <Input value={custName} onChange={setCustName} placeholder="Full name" />
                {errors.custName && <div className="cake-error">{errors.custName}</div>}
              </Field>

              <button type="button" className="ck-pick-cust" title="Pick from customers"
                onClick={() => setShowCustPicker(true)}>👥</button>

              <Field label="Delivery Date *" className="ck-field--date">
                <Input value={delivDate} onChange={setDelivDate} type="date" />
                {errors.delivDate && <div className="cake-error">{errors.delivDate}</div>}
              </Field>
              <Field label="Delivery Time *" className="ck-field--time">
                <Input value={delivTime} onChange={setDelivTime} type="time" />
              </Field>
            </div>

            {!isNew && (
              <StatusTimeline currentStatus={status} onTransition={handleTransition} loading={statusChanging} compact hideCancel />
            )}

            {/* Payment strip — always-visible totals, opens the payment options modal */}
            <button type="button" className="ck-price-strip ck-price-strip--olive" disabled={!payReady} title={lockHint}
              onClick={() => setShowPayModal(true)}>
              <span className="ck-price-strip-item"><em>Total</em><b>{Rs(totals.grand_total)}</b></span>
              <span className="ck-price-strip-item"><em>Paid</em><b>{Rs(totals.advance_paid)}</b></span>
              <span className={`ck-price-strip-item${totals.balance_due > 0 ? ' ck-price-strip-item--due' : ''}`}>
                <em>Balance</em><b>{Rs(totals.balance_due)}</b>
              </span>
              <span className="ck-price-strip-open">💰 Payment ›</span>
            </button>
          </div>

          <Field label="Message on Cake">
            <Input value={message} onChange={setMessage} placeholder="e.g. Happy Birthday Message!" disabled={locked} />
          </Field>

          {errors.items && <div className="cake-error" style={{ marginBottom: 6 }}>{errors.items}</div>}
          <div className={`ck-line-table-wrap${locked ? ' ck-locked' : ''}`} title={locked ? lockHint : undefined}>
            <table className="ck-line-table">
              <tbody>
                {items.map((it, i) => (
                  <CakeItemRow key={it._key} item={it} products={baseProducts} onChange={v => { setItems(prev => prev.map((x, j) => j === i ? v : x)); setServerTotals(null); }} onRemove={() => { setItems(prev => prev.filter((_, j) => j !== i)); setServerTotals(null); }} />
                ))}
                {accessories.map((ac, i) => (
                  <AccessoryRow key={ac._key} item={ac} products={accProducts}
                    onChange={v => { setAccessories(prev => prev.map((x, j) => j === i ? v : x)); setServerTotals(null); }}
                    onRemove={() => { setAccessories(prev => prev.filter((_, j) => j !== i)); setServerTotals(null); }} />
                ))}
              </tbody>
            </table>
          </div>

          {selectedMods.length > 0 && (
            <div className="ck-mod-summary">
              {selectedMods.map((m, i) => (
                <span key={i} className="ck-mod-summary-tag">
                  <span className="ck-mod-summary-group">{m.group}</span> {m.name}
                  {m.extra_charge > 0 && <span className="ck-mod-summary-charge">+{m.extra_charge}</span>}
                  <button type="button" className="ck-mod-summary-x" onClick={m.onRemove}>✕</button>
                </span>
              ))}
            </div>
          )}

          {detailParts.length > 0 && (
            <div className="ck-detail-list">
              {detailParts.map(([caption, msg, setter, shadeClass]) => (
                <div key={caption} className={`ck-detail-pill ${shadeClass}`}>
                  <span><strong>{caption}:</strong> <em>{msg.trim()}</em></span>
                  <button type="button" className="ck-detail-pill-x" onClick={() => { setter(''); setServerTotals(null); }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* Status history — floating sticky note, pinned open via the 📌 History button */}
      {showStatusSticky && !isNew && history.length > 0 && (
        <div className="ck-sticky-note">
          <span className="ck-sticky-pin">📌</span>
          <button type="button" className="ck-sticky-close" onClick={() => setShowStatusSticky(false)}>✕</button>
          <div className="ck-sticky-title">📊 Status History</div>
          <div className="ck-sticky-body">
            {history.map((h, i) => (
              <div key={i} className="cake-history-row">
                <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                  {h.old_status && <><span className="cake-history-status cake-history-status--old">{h.old_status}</span><span style={{ color: '#9c8870', fontSize: 11 }}>→</span></>}
                  <span className="cake-history-status cake-history-status--new">{h.new_status}</span>
                </div>
                <div style={{ fontSize: 10, color: '#9c8870' }}>
                  {h.changed_by_name && <span>{h.changed_by_name} · </span>}
                  {new Date(h.changed_at + 'Z').toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCustPicker && (
        <CustomerPickerModal
          onClose={() => setShowCustPicker(false)}
          onSelect={(c) => {
            setPhone(c.phone ?? '');
            setCustName(c.name ?? '');
            setCrmId(c.id ?? null);
            setCrmHint(c.name ? `✓ ${c.name}` : '');
          }}
        />
      )}
      {showPayModal && (
        <PricingModal
          totals={totals}
          discount={discount}
          onDiscountChange={v => { setDiscount(v); setServerTotals(null); }}
          amounts={advAmounts}
          advLocked={advLocked}
          readOnly={locked}
          followupPaid={followupPaid}
          payHistory={payHistory}
          onClose={() => setShowPayModal(false)}
          onConfirm={(vals) => { setAdvAmounts(vals); setServerTotals(null); }}
        />
      )}
      {showModifiersModal && (
        <ModifiersModal
          lookups={lookups}
          values={{ creamIds, shapeIds, spongeIds, themeIds, dietaryIds }}
          onChange={{
            creamIds: v => { setCreamIds(v); setServerTotals(null); },
            shapeIds: v => { setShapeIds(v); setServerTotals(null); },
            spongeIds: v => { setSpongeIds(v); setServerTotals(null); },
            themeIds: v => { setThemeIds(v); setServerTotals(null); },
            dietaryIds: v => { setDietaryIds(v); setServerTotals(null); },
          }}
          onClose={() => setShowModifiersModal(false)}
        />
      )}
      {showDetailsModal && (
        <DetailsModal
          values={{ designNotes, dietaryNotes, internalNotes }}
          onChange={{
            designNotes: setDesignNotes,
            dietaryNotes: setDietaryNotes,
            internalNotes: setInternalNotes,
          }}
          images={images}
          onUpload={handleImageUpload}
          onRemoveImage={i => setImages(p => p.filter((_, j) => j !== i))}
          onClose={() => setShowDetailsModal(false)}
        />
      )}
      {showAddAccModal && (
        <FlavourPickerModal products={accProducts} onPick={addAccessoryFromPick}
          onClose={() => setShowAddAccModal(false)} title="🎁 Pick Accessories" showVariant multi
          existingKeys={accessories.map(ac => `${ac.product_id}-${ac.variant_id}`)} />
      )}
      {showAddItemModal && (
        <FlavourPickerModal products={baseProducts} onPick={addItemsFromPick}
          onClose={() => setShowAddItemModal(false)} title="🎂 Pick Flavours" multi
          existingKeys={items.map(it => `${it.product_id}-${it.variant_id}`)} />
      )}
    </WindowShell>
  );
}
