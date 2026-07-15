export const API = import.meta.env.VITE_API_URL || '/api';

export const W = {
  desktopBg: '#ddd5c4',
  windowBg: '#fdf9f4',
  windowBg2: '#f5ece0',
  chrome: 'linear-gradient(180deg, #d2c6b2 0%, #b8a890 100%)',
  border: '#a89880',
  borderLight: '#c4b49c',
  text1: '#2a1f12',
  text2: '#6b5640',
  text3: '#9c8870',
  orange: '#c1440e',
  green: '#2d7a2d',
  red: '#c0392b',
  blue: '#1d4ed8',
};

export const fmt = (n) =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Effective variant name for display/storage: drop "Regular" and variants
// that just repeat the product name (otherwise the caption reads "Burger (Burger)").
export const cleanVariantName = (variantName, productName) => {
  if (!variantName) return null;
  const v = String(variantName).trim().toLowerCase();
  if (v === 'regular' || v === String(productName ?? '').trim().toLowerCase()) return null;
  return variantName;
};
