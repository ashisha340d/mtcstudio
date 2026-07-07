const STATUSES = ['PENDING','CONFIRMED','IN_PRODUCTION','READY','DELIVERED'];

const STATUS_META = {
  PENDING:      { label: 'Pending',      icon: '⏳', color: '#9c8870' },
  CONFIRMED:    { label: 'Confirmed',    icon: '✅', color: '#a16207' },
  IN_PRODUCTION:{ label: 'In Production',icon: '🎂', color: '#d97706' },
  READY:        { label: 'Ready',        icon: '📦', color: '#16a34a' },
  DELIVERED:    { label: 'Delivered',    icon: '🚀', color: '#2d7a2d' },
  CANCELLED:    { label: 'Cancelled',    icon: '❌', color: '#c0392b' },
  REFUNDED:     { label: 'Refunded',     icon: '↩', color: '#7c3aed' },
};

const TRANSITIONS = {
  PENDING:      ['CONFIRMED','CANCELLED'],
  CONFIRMED:    ['IN_PRODUCTION','CANCELLED'],
  IN_PRODUCTION:['READY','CANCELLED'],
  READY:        ['DELIVERED','CANCELLED'],
  DELIVERED:    ['REFUNDED'],
  CANCELLED:    [],
  REFUNDED:     [],
};

export default function StatusTimeline({ currentStatus, onTransition, loading }) {
  if (currentStatus === 'CANCELLED') {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 0' }}>
        <div style={{ width:36, height:36, borderRadius:'50%', background:'#fde8e8', border:'2px solid #c0392b', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>❌</div>
        <div style={{ fontSize:14, fontWeight:700, color:'#c0392b' }}>Order Cancelled</div>
      </div>
    );
  }
  if (currentStatus === 'REFUNDED') {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 0' }}>
        <div style={{ width:36, height:36, borderRadius:'50%', background:'#f3e8ff', border:'2px solid #7c3aed', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>↩</div>
        <div style={{ fontSize:14, fontWeight:700, color:'#7c3aed' }}>Order Refunded</div>
      </div>
    );
  }

  const currentIdx = STATUSES.indexOf(currentStatus);

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', marginBottom:16, overflowX:'auto', paddingBottom:4 }}>
        {STATUSES.map((s, i) => {
          const meta   = STATUS_META[s];
          const done   = i < currentIdx;
          const active = i === currentIdx;
          return (
            <div key={s} style={{ display:'flex', alignItems:'center', flexShrink:0 }}>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                <div style={{
                  width:34, height:34, borderRadius:'50%',
                  background: done ? meta.color : active ? meta.color : 'rgba(160,144,128,0.15)',
                  border: `2.5px solid ${done||active ? meta.color : '#c4b49c'}`,
                  display:'flex', alignItems:'center', justifyContent:'center', fontSize:16,
                  boxShadow: active ? `0 0 0 4px ${meta.color}25` : 'none',
                  transition: 'all 0.2s',
                }}>
                  {done ? '✓' : meta.icon}
                </div>
                <span style={{ fontSize:9, fontWeight:700, color:done||active ? meta.color : '#9c8870', letterSpacing:'0.04em', whiteSpace:'nowrap' }}>
                  {meta.label}
                </span>
              </div>
              {i < STATUSES.length - 1 && (
                <div style={{ width:40, height:2, background: i < currentIdx ? '#c1440e' : '#e0d4c0', margin:'0 4px', marginBottom:18, flexShrink:0 }} />
              )}
            </div>
          );
        })}
      </div>

      {onTransition && (TRANSITIONS[currentStatus]||[]).length > 0 && (
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {(TRANSITIONS[currentStatus]||[]).map(next => {
            const m = STATUS_META[next];
            const isCancel = next === 'CANCELLED';
            return (
              <button key={next} onClick={() => onTransition(next)} disabled={loading}
                style={{
                  padding:'8px 18px', borderRadius:8, border:`1.5px solid ${m.color}`,
                  background: isCancel ? 'transparent' : m.color,
                  color: isCancel ? m.color : '#fff',
                  fontSize:12, fontWeight:700, cursor:loading?'not-allowed':'pointer',
                  opacity:loading?0.6:1, letterSpacing:'0.04em', transition:'opacity 0.1s',
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
