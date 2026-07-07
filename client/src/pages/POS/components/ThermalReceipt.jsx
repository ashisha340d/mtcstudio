// ── Thermal Receipt — ESC/POS via server ────────────────────────
const API_BASE = import.meta.env.VITE_API_URL || '/api';

// Invalidate after saving receipt settings (kept for compatibility)
export function invalidateReceiptConfig() {}

export async function printReceipt({ order, items = [], payments = [], isReprint = false } = {}) {
  try {
    const res = await fetch(`${API_BASE}/settings/print`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        // Real session so the server can attribute reprints in the audit log
        'X-Session-ID': sessionStorage.getItem('mtc_session') ?? localStorage.getItem('kds_session') ?? 'dev-session',
      },
      body:    JSON.stringify({ order, items, payments, isReprint }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert('Print failed: ' + (err.error || `Server error ${res.status}`));
    }
  } catch (e) {
    alert('Print error: ' + (e.message || 'Could not reach server'));
  }
}
