import { useState, useEffect, useRef } from 'react';
import { Plus, Minus, Image as ImageIcon } from 'lucide-react';
import { API, W, fmt, cleanVariantName } from '../posShared';

/* ── Draggable · Resizable · Persistent Modal Shell ─────────── */
function ModalShell({ id, defaultWidth = 420, defaultHeight = 500, onClose, children }) {
  const KEY = `posv2_modal_${id}`;
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; } };

  const [pos, setPos] = useState(() => {
    const s = load();
    return {
      x: s.x ?? Math.max(20, (window.innerWidth - (s.w ?? defaultWidth)) / 2),
      y: s.y ?? Math.max(20, (window.innerHeight - (s.h ?? defaultHeight)) / 2),
    };
  });
  const [size, setSize] = useState(() => {
    const s = load();
    return { w: s.w ?? defaultWidth, h: s.h ?? defaultHeight };
  });

  const posRef = useRef(pos);
  const sizeRef = useRef(size);
  const drag = useRef(null);
  const shellRef = useRef(null);

  const persist = () =>
    localStorage.setItem(KEY, JSON.stringify({ x: posRef.current.x, y: posRef.current.y, w: sizeRef.current.w, h: sizeRef.current.h }));

  const startDrag = (e) => {
    if (e.button !== 0) return;
    drag.current = { ox: e.clientX - posRef.current.x, oy: e.clientY - posRef.current.y };
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!drag.current) return;
      const x = Math.max(0, Math.min(window.innerWidth - 100, e.clientX - drag.current.ox));
      const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.current.oy));
      posRef.current = { x, y };
      setPos({ x, y });
    };
    const onUp = () => { if (drag.current) persist(); drag.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!shellRef.current) return;
    const ro = new ResizeObserver(() => {
      if (!shellRef.current) return;
      const w = shellRef.current.offsetWidth;
      const h = shellRef.current.offsetHeight;
      sizeRef.current = { w, h };
      setSize({ w, h });
      persist();
    });
    ro.observe(shellRef.current);
    return () => ro.disconnect();
  }, []); // eslint-disable-line

  return (
    <div
      className="modal-overlay"
      style={{ alignItems: 'flex-start', justifyContent: 'flex-start' }}
      onClick={onClose}
    >
      <div
        ref={shellRef}
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed',
          left: pos.x, top: pos.y,
          width: size.w, height: size.h,
          minWidth: 320, minHeight: 220,
          resize: 'both', overflow: 'hidden',
          borderRadius: 14,
          background: W.windowBg,
          border: `1px solid ${W.border}`,
          boxShadow: '0 20px 60px rgba(42,31,18,0.38), 0 1px 0 rgba(255,255,255,0.65) inset',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {children(startDrag)}
      </div>
    </div>
  );
}

/* ── Add / Edit Product Modal ────────────────────────────────── */
export default function AddProductModal({ product, existingItem, onClose, onConfirm }) {
  const [variants, setVariants] = useState([]);
  const [modifiers, setModifiers] = useState([]);
  const [selVariants, setSelVariants] = useState(
    existingItem?.variant_id
      ? [{ id: existingItem.variant_id, name: existingItem.variant_name, selling_price: existingItem.unit_price }]
      : []
  );
  const [selMods, setSelMods] = useState(existingItem?.modifiers ?? []);
  const [qty, setQty] = useState(existingItem?.quantity ?? 1);
  const [notes, setNotes] = useState(existingItem?.notes ?? '');
  const [rateInput, setRateInput] = useState(existingItem ? String(existingItem.unit_price) : '');
  const [rateFocused, setRateFocused] = useState(false);
  const [homePack, setHomePack] = useState(
    !!(existingItem?.is_homepack ?? existingItem?.is_home_pack ?? false)
  );
  const [discAmt, setDiscAmt] = useState(existingItem?.discount_amount ? String(existingItem.discount_amount) : '');
  const [discType, setDiscType] = useState(existingItem?.discount_type ?? 'PROMO');
  // One product → one image. Always resolve from the product, never the variant.
  const [primaryImage, setPrimaryImage] = useState(product.primary_image ?? null);
  const [loading, setLoading] = useState(true);
  const isEdit = !!existingItem;
  const selVariant = selVariants[0] ?? null;
  const isMulti = selVariants.length > 1;

  useEffect(() => {
    // If the caller couldn't supply the product image, fetch it by product id
    if (!product.primary_image) {
      fetch(`${API}/food-menu/products/${product.id}`)
        .then(r => r.json())
        .then(p => { if (p?.primary_image) setPrimaryImage(p.primary_image); })
        .catch(() => { });
    }
    Promise.all([
      fetch(`${API}/food-menu/products/${product.id}/variants`).then(r => r.json()),
      fetch(`${API}/food-menu/products/${product.id}/modifiers`).then(r => r.json()),
    ]).then(([v, m]) => {
      setVariants(v);
      setModifiers(m);
      if (isEdit) {
        if (existingItem?.variant_id) {
          const found = v.find(vv => vv.id === existingItem.variant_id);
          if (found) setSelVariants([found]);
        } else if (v.length === 1) {
          setSelVariants([v[0]]);
        }
      } else {
        if (v.length === 1) {
          setSelVariants([v[0]]);
          setRateInput(r => r || String(v[0].selling_price ?? product.pos_price ?? 0));
        }
        setRateInput(r => r || String(product.pos_price ?? 0));
      }
      setLoading(false);
    });
  }, [product.id, isEdit]);

  const toggleVariant = (v) => {
    setSelVariants(prev => {
      const exists = prev.find(p => p.id === v.id);
      const next = exists ? prev.filter(p => p.id !== v.id) : [...prev, { ...v, qty: 1 }];
      if (next.length === 1) setRateInput(String(next[0].selling_price ?? next[0].price ?? 0));
      return next;
    });
  };

  const updateVariantQty = (id, delta) =>
    setSelVariants(prev => prev.map(v => v.id === id ? { ...v, qty: Math.max(1, (v.qty ?? 1) + delta) } : v));

  const basePrice = parseFloat(rateInput) || 0;
  const modTotal = selMods.reduce((s, m) => s + (m.price ?? 0), 0);
  const multiAmount = selVariants.reduce((s, v) => s + ((v.selling_price ?? v.price ?? 0) + modTotal) * (v.qty ?? 1), 0);
  const lineGross = isMulti ? multiAmount : (basePrice + modTotal) * qty;
  const discount = isMulti ? 0 : Math.min(Math.max(parseFloat(discAmt) || 0, 0), lineGross);
  const lineTotal = lineGross - discount;

  const toggleMod = (mod) =>
    setSelMods(prev => prev.find(m => m.id === mod.id)
      ? prev.filter(m => m.id !== mod.id)
      : [...prev, mod]);

  function handleConfirm() {
    if (selVariants.length === 0 && variants.length > 1) return;
    if (isMulti) {
      selVariants.forEach(v => {
        onConfirm({
          product_id: product.id,
          product_name: product.name,
          variant_id: v.id,
          variant_name: cleanVariantName(v.name, product.name),
          unit_price: v.selling_price ?? v.price ?? 0,
          quantity: v.qty ?? 1,
          modifiers: selMods.map(m => ({ id: m.id, name: m.name, price: m.price ?? 0 })),
          notes: null,
          is_homepack: false,
          image: primaryImage,
          discount_amount: 0,
          discount_type: null,
        });
      });
      onClose();
      return;
    }
    const v = selVariant ?? variants[0] ?? null;
    onConfirm({
      product_id: product.id,
      product_name: product.name,
      variant_id: v?.id ?? null,
      variant_name: cleanVariantName(v?.name, product.name),
      unit_price: basePrice,
      quantity: qty,
      modifiers: selMods.map(m => ({ id: m.id, name: m.name, price: m.price ?? 0 })),
      notes: notes.trim() || null,
      is_homepack: homePack,
      image: primaryImage,
      discount_amount: discount,
      discount_type: discount > 0 ? discType : null,
    });
    onClose();
  }

  const optionRow = (selected) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '11px 13px', borderRadius: 9,
    border: `1.5px solid ${selected ? W.orange : W.borderLight}`,
    background: selected ? 'rgba(193,68,14,0.08)' : 'rgba(255,255,255,0.65)',
    cursor: 'pointer', transition: 'all 0.1s', width: '100%',
  });

  return (
    <ModalShell id="add-product" defaultWidth={420} defaultHeight={560} onClose={onClose}>
      {(startDrag) => (
        <>
          <div
            onMouseDown={startDrag}
            style={{
              cursor: 'move',
              display: 'flex', alignItems: 'flex-start', gap: 12,
              padding: '9px 16px',
              background: W.chrome,
              borderBottom: `1px solid ${W.border}`,
              flexShrink: 0, userSelect: 'none',
            }}
          >
            <div style={{ display: 'flex', gap: 5, flexShrink: 0, alignSelf: 'center' }}>
              <button onClick={onClose} style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57', border: '1px solid rgba(0,0,0,0.18)', cursor: 'pointer', padding: 0 }} />
              <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e', border: '1px solid rgba(0,0,0,0.18)' }} />
              <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840', border: '1px solid rgba(0,0,0,0.18)' }} />
            </div>

            {primaryImage
              ? <img src={`/uploads/${primaryImage}`} style={{ height: 52, width: 52, borderRadius: 9, objectFit: 'cover', border: `1px solid ${W.border}`, flexShrink: 0 }} alt="" />
              : <div style={{ height: 52, width: 52, borderRadius: 9, background: 'rgba(255,255,255,0.4)', border: `1px solid ${W.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <ImageIcon style={{ width: 22, height: 22, color: W.text3 }} />
              </div>
            }
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: W.text1, lineHeight: 1.3, textShadow: '0 1px 0 rgba(255,255,255,0.45)' }}>{product.name}</div>
              {product.category_name && <div style={{ fontSize: 10, color: W.text3, marginTop: 1 }}>{product.category_name}</div>}
              <div style={{ fontSize: 14, fontWeight: 800, color: W.orange, marginTop: 4 }}>{fmt(isMulti ? multiAmount : (basePrice || product.pos_price))}</div>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 6px' }}>
            {loading
              ? <div style={{ textAlign: 'center', color: W.text3, padding: '24px 0' }}>Loading…</div>
              : variants.length > 1 && (
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: W.text3, marginBottom: 9 }}>
                    Select Variant * {isMulti && <span style={{ color: W.orange }}>· multi</span>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {variants.map(v => {
                      const sel = selVariants.find(sv => sv.id === v.id);
                      const checked = !!sel;
                      return (
                        <div key={v.id} style={optionRow(checked)} onClick={() => toggleVariant(v)}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 15, height: 15, borderRadius: 4, border: `2px solid ${checked ? W.orange : W.text3}`, background: checked ? W.orange : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              {checked && <span style={{ color: '#fff', fontSize: 9, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                            </div>
                            <span style={{ fontSize: 13, fontWeight: 600, color: W.text1 }}>{v.name}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {isMulti && checked && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }} onClick={e => e.stopPropagation()}>
                                <button onClick={() => updateVariantQty(v.id, -1)} style={{ width: 20, height: 20, borderRadius: '50%', background: W.orange, border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                  <Minus style={{ width: 10, height: 10 }} />
                                </button>
                                <span style={{ fontSize: 12, fontWeight: 800, color: W.text1, minWidth: 14, textAlign: 'center' }}>{sel.qty ?? 1}</span>
                                <button onClick={() => updateVariantQty(v.id, +1)} style={{ width: 20, height: 20, borderRadius: '50%', background: W.orange, border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                  <Plus style={{ width: 10, height: 10 }} />
                                </button>
                              </div>
                            )}
                            <span style={{ fontSize: 13, fontWeight: 800, color: W.orange }}>{fmt(v.selling_price ?? v.price)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )
            }

            {!loading && modifiers.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: W.text3, marginBottom: 2 }}>Add-ons</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {modifiers.map(mod => {
                    const checked = !!selMods.find(m => m.id === mod.id);
                    return (
                      <button key={mod.id} onClick={() => toggleMod(mod)} style={optionRow(checked)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 15, height: 15, borderRadius: 4, border: `2px solid ${checked ? W.orange : W.text3}`, background: checked ? W.orange : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {checked && <span style={{ color: '#fff', fontSize: 9, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 600, color: W.text1 }}>{mod.name}</span>
                        </div>
                        {mod.price > 0 && <span style={{ fontSize: 12, color: W.text2 }}>+{fmt(mod.price)}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {!isMulti && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: W.text3, marginBottom: 4 }}>Special Instructions</div>
                <textarea
                  rows={2}
                  placeholder="e.g. Less spicy, No onion…"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  style={{ width: '100%', borderRadius: 9, border: `1px solid ${W.borderLight}`, background: 'rgba(255,255,255,0.75)', color: W.text1, fontSize: 13, padding: '9px 11px', resize: 'none', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            )}

            {/* Item Discount */}
            {!isMulti && (
              <div style={{ marginTop: 2 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: W.text3, marginBottom: 8 }}>Discount</div>
                <div style={{ display: 'flex', gap: 5, marginBottom: 8, flexWrap: 'wrap' }}>
                  {[['PROMO', 'Promo'], ['COMPLIMENTARY', 'Compl.'], ['EMPLOYEE', 'Employee'], ['MANUAL', 'Manual']].map(([key, label]) => (
                    <button key={key} onClick={() => setDiscType(key)}
                      style={{
                        padding: '5px 10px', borderRadius: 20, fontSize: 10, fontWeight: 800,
                        textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer',
                        border: `1.5px solid ${discType === key ? W.orange : W.borderLight}`,
                        background: discType === key ? 'rgba(193,68,14,0.1)' : 'rgba(255,255,255,0.65)',
                        color: discType === key ? W.orange : W.text2,
                      }}>{label}</button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="number" min="0" placeholder="0"
                    value={discAmt}
                    onChange={e => setDiscAmt(e.target.value)}
                    onFocus={e => e.target.select()}
                    style={{ width: 90, padding: '7px 9px', borderRadius: 8, border: `1.5px solid ${discount > 0 ? W.orange : W.borderLight}`, background: 'rgba(255,255,255,0.75)', color: discount > 0 ? W.orange : W.text1, fontSize: 14, fontWeight: 800, outline: 'none', textAlign: 'right', boxSizing: 'border-box' }}
                  />
                  {[10, 20, 50, 100].map(p => (
                    <button key={p} onClick={() => setDiscAmt(String(Math.round(lineGross * p) / 100))}
                      style={{ padding: '6px 8px', borderRadius: 7, fontSize: 10, fontWeight: 800, border: `1px solid ${W.borderLight}`, background: 'rgba(255,255,255,0.65)', color: W.text2, cursor: 'pointer', flexShrink: 0 }}>
                      {p === 100 ? 'FOC' : `${p}%`}
                    </button>
                  ))}
                  {discount > 0 && (
                    <button onClick={() => setDiscAmt('')}
                      style={{ padding: '6px 8px', borderRadius: 7, fontSize: 10, fontWeight: 800, border: 'none', background: 'none', color: W.red, cursor: 'pointer', flexShrink: 0 }}>✕</button>
                  )}
                </div>
                {discount > 0 && (
                  <div style={{ fontSize: 11, fontWeight: 700, color: W.green ?? '#2d7a2d', marginTop: 6 }}>
                    −{fmt(discount)} {discType} → line {fmt(lineTotal)}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ borderTop: `1px solid ${W.border}`, padding: '12px 18px', flexShrink: 0, background: 'rgba(255,255,255,0.4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: W.text3, marginBottom: 5 }}>
                  {isMulti ? 'Amount (₹)' : 'Rate (₹)'}
                </div>
                <input
                  type={rateFocused ? 'number' : 'text'}
                  readOnly={isMulti}
                  value={isMulti
                    ? multiAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : (rateFocused ? rateInput : Number(rateInput || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}
                  onChange={e => setRateInput(e.target.value)}
                  onFocus={e => { setRateFocused(true); e.target.select(); }}
                  onBlur={() => setRateFocused(false)}
                  style={{ width: '100%', padding: '9px 11px', borderRadius: 9, border: `1.5px solid ${W.borderLight}`, background: 'rgba(255,255,255,0.75)', color: W.orange, fontSize: 22, fontWeight: 800, outline: 'none', boxSizing: 'border-box', textAlign: 'right' }}
                />
              </div>
              {!isMulti && (
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: W.text3, marginBottom: 5 }}>Qty</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <button onClick={() => setQty(q => Math.max(1, q - 1))} style={{ width: 34, height: 34, borderRadius: '50%', background: W.orange, border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Minus style={{ width: 15, height: 15 }} />
                    </button>
                    <span style={{ fontSize: 18, fontWeight: 900, color: W.text1, minWidth: 26, textAlign: 'center' }}>{qty}</span>
                    <button onClick={() => setQty(q => q + 1)} style={{ width: 34, height: 34, borderRadius: '50%', background: W.orange, border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Plus style={{ width: 15, height: 15 }} />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Take Out / Pack toggle */}
            {!isMulti && (
              <button
                onClick={() => setHomePack(h => !h)}
                style={{
                  width: '100%', padding: '11px 13px', borderRadius: 9, marginBottom: 10,
                  display: 'flex', alignItems: 'center', gap: 10,
                  border: `1.5px solid ${homePack ? W.orange : W.borderLight}`,
                  background: homePack ? 'rgba(193,68,14,0.08)' : 'rgba(255,255,255,0.65)',
                  cursor: 'pointer', transition: 'all 0.1s',
                }}
              >
                <div style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${homePack ? W.orange : W.text3}`, background: homePack ? W.orange : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {homePack && <span style={{ color: '#fff', fontSize: 11, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                </div>
                <span style={{ fontSize: 13, fontWeight: 800, color: homePack ? W.orange : W.text1, textTransform: 'uppercase', letterSpacing: '0.04em' }}>📦 Take Out / Pack</span>
              </button>
            )}

            {isEdit && (
              <button onClick={() => { onConfirm(null); onClose(); }}
                style={{ width: '100%', padding: '10px', borderRadius: 8, border: `1px solid rgba(192,57,43,0.4)`, background: 'rgba(192,57,43,0.06)', color: W.red, fontSize: 12, fontWeight: 700, cursor: 'pointer', marginBottom: 8 }}>
                Remove Item
              </button>
            )}
            <button
              disabled={loading || (selVariants.length === 0 && variants.length > 1)}
              onClick={handleConfirm}
              style={{
                width: '100%', padding: '13px', borderRadius: 9, border: 'none',
                background: loading || (selVariants.length === 0 && variants.length > 1) ? 'rgba(0,0,0,0.08)' : W.orange,
                color: loading || (selVariants.length === 0 && variants.length > 1) ? W.text3 : '#fff',
                fontSize: 14, fontWeight: 800,
                cursor: loading || (selVariants.length === 0 && variants.length > 1) ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {isEdit ? 'Update Item' : isMulti ? `Add ${selVariants.length} Items` : 'Add to Order'}
              {' — '}{fmt(lineTotal)}
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
}
