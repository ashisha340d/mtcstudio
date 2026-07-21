export const API = import.meta.env.VITE_API_URL || '/api';

export const W = {
  desktopBg: 'var(--desktop-bg)',
  windowBg: 'var(--window-bg)',
  windowBg2: 'var(--bg-card-2)',
  chrome: 'linear-gradient(180deg, var(--window-chrome) 0%, var(--window-chrome-2) 100%)',
  border: 'var(--window-border)',
  borderLight: 'var(--window-border-light)',
  text1: 'var(--text-1)',
  text2: 'var(--text-2)',
  text3: 'var(--text-3)',
  orange: 'var(--orange)',
  green: 'var(--green)',
  red: 'var(--red)',
  blue: 'var(--blue)',
  // Panel fills layered over window chrome, subtle → solid.
  // Dark theme re-maps these three; nothing here needs a per-widget patch.
  fill1: 'var(--fill-1)',
  fill2: 'var(--fill-2)',
  fill3: 'var(--fill-3)',
  accentSoft: 'var(--accent-soft)',
  emboss: 'var(--text-emboss)',
};

export const fmt = (n) =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Cake payment lines parked in an order's draft cart (never sent to KOT)
export const cakeDraftItems = (order) => {
  try { return (JSON.parse(order?.draft_items || '[]') || []).filter(i => i && i.is_cake_payment); }
  catch { return []; }
};
export const cakeDraftDue = (order) =>
  cakeDraftItems(order).reduce((s, i) => s + (Number(i.unit_price) || 0) * (i.quantity || 1), 0);

// Effective variant name for display/storage: drop "Regular" and variants
// that just repeat the product name (otherwise the caption reads "Burger (Burger)").
export const cleanVariantName = (variantName, productName) => {
  if (!variantName) return null;
  const v = String(variantName).trim().toLowerCase();
  if (v === 'regular' || v === String(productName ?? '').trim().toLowerCase()) return null;
  return variantName;
};
