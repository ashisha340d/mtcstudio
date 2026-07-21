// The CMS stores an image as a bare filename, a /uploads/ path, or an
// absolute URL depending on how it was added. Normalise all three.
export function imgSrc(raw) {
  if (!raw) return null;
  const s = typeof raw === 'object' ? raw.filename : raw;
  if (!s) return null;
  if (s.startsWith('http') || s.startsWith('/uploads/')) return s;
  const file = String(s).replace(/\\/g, '/').split('/').pop();
  return file ? `/uploads/${file}` : null;
}

// The "Make For App" export mirrors every menu (category/product/variant)
// image into /uploads/forapp as a compressed, size-capped webp with the same
// filename stem — same manifest the companion Android app syncs from. Prefer
// it (lighter, faster to cache offline); imgSrc() above is the fallback for
// images that haven't been exported yet.
export function imgSrcForApp(raw) {
  const full = imgSrc(raw);
  if (!full || full.startsWith('http')) return full;
  const file = full.split('/').pop();
  const stem = file.replace(/\.[^.]+$/, '');
  return `/uploads/forapp/${stem}.webp`;
}
