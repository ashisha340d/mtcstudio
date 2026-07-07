/**
 * Admin dashboard appearance theme (Dashboard/CRM/File Maintenance/CMS only —
 * never applies to POS/KDS, which are separate route trees).
 *
 * Key stored in localStorage:
 *   mtc_ui_theme — 'warm' | 'light' | 'dark' | 'slate'
 */

const LS_KEY = 'mtc_ui_theme';
export const THEMES = ['warm', 'light', 'dark', 'slate'];
const DEFAULT_THEME = 'warm';

export function getTheme() {
  try {
    const v = localStorage.getItem(LS_KEY);
    return THEMES.includes(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(theme) {
  if (!THEMES.includes(theme)) return;
  try { localStorage.setItem(LS_KEY, theme); } catch { /* ignore */ }
}
