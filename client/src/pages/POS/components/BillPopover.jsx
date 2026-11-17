import { createPortal } from 'react-dom';

// Hover bill preview for an order card — portal so card overflow can't clip it
const ITEM_STATUS = {
  ORDERSENT:   { icon: '○', label: 'Unserved',  color: 'var(--orange)', rank: 0 },
  IN_PROGRESS: { icon: '◐', label: 'Preparing', color: 'var(--orange)', rank: 1 },
  SERVED:      { icon: '✓', label: 'Served',    color: 'var(--green)',  rank: 2 },
  CANCELLED:   { icon: '✕', label: 'Cancelled', color: 'var(--text-3)', rank: 3 },
};

const ORDER_TYPE_ABBR = { DINE_IN: '🍽 DI', TAKEAWAY: '📦 TA', DELIVERY: '🛵 DL', CAKE_ORDER: '🎂 CK', QUICK_SALE: '⚡ QS' };
const fmtAmt = (n) => (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export default function BillPopover({ rect, items, orderType, tableName, order }) {
  if (!items.length) return null;
  const sorted = items.filter((i) => !i.is_combo_child).sort((a, b) => (ITEM_STATUS[a.status]?.rank ?? 0) - (ITEM_STATUS[b.status]?.rank ?? 0));
  const width = Math.max(rect.width, 280);
  const below = rect.bottom + 360 < window.innerHeight;
  const style = {
    position: 'fixed', zIndex: 9999, pointerEvents: 'none', width,
    left: Math.min(rect.left, window.innerWidth - width - 8),
    ...(below ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }),
    maxHeight: 360, overflowY: 'auto', padding: '12px 12px 10px',
    background: '#fffdf7', color: '#222', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11,
    boxShadow: '0 8px 24px rgba(0,0,0,0.3)', borderRadius: 2,
  };
  const dash = { borderTop: '1px dashed #888', margin: '6px 0' };
  const grid = { display: 'grid', gridTemplateColumns: '1fr 26px 48px 54px 14px', gap: 4, alignItems: 'baseline' };
  const right = { textAlign: 'right' };
  const total = sorted.filter((i) => i.status !== 'CANCELLED').reduce((t, i) => t + (Number(i.unit_price) || 0) * (i.quantity || 1), 0);
  return createPortal(
    <div style={style}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}>
        <span>{tableName}{order?.id ? ` · #${order.id}` : ''}</span>
        <abbr title={orderType || 'DINE_IN'} style={{ textDecoration: 'none' }}>{ORDER_TYPE_ABBR[orderType] || orderType || '🍽 DI'}</abbr>
      </div>
      <div style={dash} />
      <div style={{ ...grid, fontWeight: 800 }}>
        <span>ITEM</span><span style={right}>QTY</span><span style={right}>RATE</span><span style={right}>AMT</span><span />
      </div>
      <div style={dash} />
      {sorted.map((i) => {
        const st = ITEM_STATUS[i.status] || { icon: '?', label: i.status, color: '#888' };
        const cancelled = i.status === 'CANCELLED';
        return (
          <div key={i.id} style={{ ...grid, padding: '2px 0', textDecoration: cancelled ? 'line-through' : undefined, opacity: cancelled ? 0.5 : 1 }}>
            <span>{i.product_name}{i.variant_name ? ` (${i.variant_name})` : ''}{!!i.is_home_pack && <abbr title="Parcel" style={{ textDecoration: 'none' }}> 📦</abbr>}</span>
            <span style={right}>{i.quantity}</span>
            <span style={right}>{fmtAmt(i.unit_price)}</span>
            <span style={right}>{fmtAmt((Number(i.unit_price) || 0) * (i.quantity || 1))}</span>
            <abbr title={st.label} style={{ color: st.color, fontWeight: 900, textDecoration: 'none', textAlign: 'center' }}>{st.icon}</abbr>
          </div>
        );
      })}
      <div style={dash} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, fontSize: 12 }}>
        <span>TOTAL</span><span>₹{fmtAmt(total)}</span>
      </div>
      <div style={dash} />
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, fontSize: 9, color: '#666' }}>
        {Object.values(ITEM_STATUS).map((st) => <span key={st.label}><b style={{ color: st.color }}>{st.icon}</b> {st.label}</span>)}
        <span>📦 Parcel</span>
      </div>
    </div>,
    document.body
  );
}
