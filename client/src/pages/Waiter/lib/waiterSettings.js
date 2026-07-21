/**
 * Waiter app preferences — per-device, per-waiter-station.
 *
 * Stored in localStorage under `mtc_waiter_settings`. Everything here is
 * presentation only; nothing in this file reaches the API or changes what
 * an order contains.
 *
 * Layout values are written straight into CSS custom properties on the
 * .waiter-app root (see applySettings), so a slider drag re-lays-out the
 * grid without React re-rendering a single card.
 */

const LS_KEY = 'mtc_waiter_settings';

export const THEMES = [
  { id: 'ember',    label: 'Ember',    hint: 'Warm dark — the default' },
  { id: 'midnight', label: 'Midnight', hint: 'Cool dark, matches the POS' },
  { id: 'daylight', label: 'Daylight', hint: 'Light — for bright floors' },
];

/* Each slider is [min, max, step] in the unit the CSS var expects. */
export const RANGES = {
  tableSize: [96, 220, 4],    // px — .w-floor track minimum
  catSize:   [96, 220, 4],    // px — .w-cat-grid track minimum
  menuScale: [0.85, 1.35, 0.05], // multiplier on menu row height + thumb
  textScale: [0.9, 1.25, 0.05],  // multiplier on root font-size
};

export const DEFAULTS = {
  theme: 'ember',
  tableSize: 116,
  catSize: 116,
  menuScale: 1,
  textScale: 1,
  haptics: true,
  keepAwake: true,   // screen stays on while the app is open
  bigTouch: false,   // enlarges every tap target to 56dp
};

const clamp = (v, [min, max]) => Math.min(max, Math.max(min, v));

export function getSettings() {
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { /* first run */ }

  const s = { ...DEFAULTS, ...raw };
  // A stale or hand-edited value must never be able to break the layout
  if (!THEMES.some(t => t.id === s.theme)) s.theme = DEFAULTS.theme;
  for (const key of Object.keys(RANGES)) {
    const n = Number(s[key]);
    s[key] = Number.isFinite(n) ? clamp(n, RANGES[key]) : DEFAULTS[key];
  }
  for (const key of ['haptics', 'keepAwake', 'bigTouch']) s[key] = !!s[key];
  return s;
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

export function resetSettings() {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  return { ...DEFAULTS };
}

/** Push settings onto the DOM. Cheap enough to call on every slider frame. */
export function applySettings(el, s) {
  if (!el) return;
  el.dataset.wTheme = s.theme;
  el.style.setProperty('--floor-min', `${s.tableSize}px`);
  el.style.setProperty('--cat-min', `${s.catSize}px`);
  el.style.setProperty('--menu-scale', String(s.menuScale));
  el.style.setProperty('--text-scale', String(s.textScale));
  el.dataset.wTouch = s.bigTouch ? 'big' : 'std';
}
