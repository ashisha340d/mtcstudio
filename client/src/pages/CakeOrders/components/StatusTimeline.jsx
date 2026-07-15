// Matches the real `status` enum on cake_orders — production sub-stages
// (New/Acknowledged/In Production/Ready for Delivery) live in `production_status`,
// tracked by the separate Kitchen board, not here.
const STATUSES = ['PENDING','CONFIRMED','DELIVERED'];

const STATUS_META = {
  PENDING:      { label: 'Pending',       icon: '⏳', color: '#9c8870' },
  CONFIRMED:    { label: 'Sent to Bakery',icon: '🎂', color: '#a16207' },
  DELIVERED:    { label: 'Delivered',     icon: '🚀', color: '#2d7a2d' },
  CANCELLED:    { label: 'Cancelled',     icon: '❌', color: '#c0392b' },
  REFUNDED:     { label: 'Refunded',      icon: '↩', color: '#7c3aed' },
};

const TRANSITIONS = {
  PENDING:      ['CONFIRMED','CANCELLED'],
  CONFIRMED:    ['PENDING','CANCELLED','DELIVERED'],
  DELIVERED:    ['REFUNDED'],
  CANCELLED:    [],
  REFUNDED:     [],
};

export default function StatusTimeline({ currentStatus, onTransition, loading, compact, hideCancel }) {
  const circle = compact ? 30 : 34;
  const border = compact ? 2.5 : 2.5;
  const icoFont = compact ? 15 : 16;
  const lineW = compact ? 18 : 40;
  const btnPad = compact ? '6px 10px' : '8px 18px';
  const btnFont = compact ? 11 : 12;
  const btnMinW = compact ? 108 : 0;

  if (currentStatus === 'CANCELLED') {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:compact?6:10, padding: compact?0:'12px 0' }}>
        <div style={{ width:compact?24:36, height:compact?24:36, borderRadius:'50%', background:'#fde8e8', border:'2px solid #c0392b', display:'flex', alignItems:'center', justifyContent:'center', fontSize:compact?12:18 }}>❌</div>
        <div style={{ fontSize:compact?12:14, fontWeight:700, color:'#c0392b' }}>Order Cancelled</div>
      </div>
    );
  }
  if (currentStatus === 'REFUNDED') {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:compact?6:10, padding: compact?0:'12px 0' }}>
        <div style={{ width:compact?24:36, height:compact?24:36, borderRadius:'50%', background:'#f3e8ff', border:'2px solid #7c3aed', display:'flex', alignItems:'center', justifyContent:'center', fontSize:compact?12:18 }}>↩</div>
        <div style={{ fontSize:compact?12:14, fontWeight:700, color:'#7c3aed' }}>Order Refunded</div>
      </div>
    );
  }

  const currentIdx = STATUSES.indexOf(currentStatus);

  return (
    <div style={compact ? { display:'flex', alignItems:'center', gap:10 } : undefined}>
      <div style={{ display:'flex', alignItems:'center', marginBottom: compact?0:16, overflowX:'auto', paddingBottom: compact?0:4 }}>
        {STATUSES.map((s, i) => {
          const meta   = STATUS_META[s];
          const done   = i < currentIdx;
          const active = i === currentIdx;
          return (
            <div key={s} style={{ display:'flex', alignItems:'center', flexShrink:0 }}>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                <div style={{
                  width:circle, height:circle, borderRadius:'50%',
                  background: done ? meta.color : active ? meta.color : 'rgba(160,144,128,0.15)',
                  border: `${border}px solid ${done||active ? meta.color : '#c4b49c'}`,
                  display:'flex', alignItems:'center', justifyContent:'center', fontSize:icoFont,
                  boxShadow: active ? `0 0 0 4px ${meta.color}25` : 'none',
                  transition: 'all 0.2s',
                }}>
                  {done ? '✓' : meta.icon}
                </div>
                {!compact && (
                  <span style={{ fontSize:9, fontWeight:700, color:done||active ? meta.color : '#9c8870', letterSpacing:'0.04em', whiteSpace:'nowrap' }}>
                    {meta.label}
                  </span>
                )}
              </div>
              {i < STATUSES.length - 1 && (
                <div style={{ width:lineW, height:2, background: i < currentIdx ? '#c1440e' : '#e0d4c0', margin: compact?'0 4px':'0 4px', marginBottom: compact?0:18, flexShrink:0 }} />
              )}
            </div>
          );
        })}
      </div>

      {onTransition && (TRANSITIONS[currentStatus]||[]).filter(n => n !== 'PENDING' && (!hideCancel || n !== 'CANCELLED')).length > 0 && (
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {(TRANSITIONS[currentStatus]||[]).filter(n => n !== 'PENDING' && (!hideCancel || n !== 'CANCELLED')).map(next => {
            const m = STATUS_META[next];
            const isCancel = next === 'CANCELLED';
            return (
              <button key={next} onClick={() => onTransition(next)} disabled={loading}
                style={{
                  padding:btnPad, minWidth:btnMinW, borderRadius:8, border:`1.5px solid ${m.color}`,
                  background: isCancel ? 'transparent' : m.color,
                  color: isCancel ? m.color : '#fff',
                  fontSize:btnFont, fontWeight:700, cursor:loading?'not-allowed':'pointer',
                  opacity:loading?0.6:1, letterSpacing:'0.04em', transition:'opacity 0.1s',
                  whiteSpace:'nowrap', textAlign:'center',
                }}
              >
                {m.icon} {isCancel ? 'Cancel Order' : `Move to ${m.label}`}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { STATUS_META, STATUSES, TRANSITIONS };
