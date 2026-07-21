import { useMemo, useState } from 'react';
import { tapMedium, tapSuccess } from '../lib/haptics';
import MotionArt from './MotionArt';
import Icon from './Icon';

const PENDING = new Set(['ORDERSENT', 'IN_PROGRESS', 'READY']);

function mins(ts) {
  if (!ts) return 0;
  return Math.floor((Date.now() - new Date(ts + (ts.includes('Z') ? '' : 'Z')).getTime()) / 60000);
}
const ago = m => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`);
const heat = m => (m < 10 ? 'ok' : m < 20 ? 'warm' : 'hot');

// "बाकी" — everything punched but not yet on a guest's table, grouped by kitchen
// department. READY rows float to the top: those are the ones a waiter can act on.
export default function ServeBoard({ activeOrders, stations, onServe, loading }) {
  const [busy, setBusy] = useState({});
  const [dept, setDept] = useState('ALL');

  const stationName = useMemo(() => {
    const m = new Map((stations || []).map(s => [s.id, s.name]));
    return id => m.get(id) || 'Kitchen';
  }, [stations]);

  const rows = useMemo(() => {
    const orderById = new Map((activeOrders.orders || []).map(o => [o.id, o]));
    const out = [];
    for (const k of activeOrders.kots || []) {
      const o = orderById.get(k.order_id);
      if (!o) continue;
      for (const i of k.items || []) {
        if (!PENDING.has(i.status)) continue;
        out.push({
          key: `${k.id}_${i.id}`,
          kotId: k.id,
          itemId: i.id,
          name: i.product_name,
          qty: i.quantity,
          pack: !!i.is_home_pack,
          ready: i.status === 'READY',
          station: stationName(i.station_id),
          where: o.table_name || o.customer_name || `#${o.id}`,
          type: o.order_type,
          round: k.kot_number,
          age: mins(k.created_at),
        });
      }
    }
    // Ready first, then oldest first — the waiter's actual walking order.
    return out.sort((a, b) => (b.ready - a.ready) || (b.age - a.age));
  }, [activeOrders, stationName]);

  const depts = useMemo(() => ['ALL', ...Array.from(new Set(rows.map(r => r.station)))], [rows]);
  const shown = dept === 'ALL' ? rows : rows.filter(r => r.station === dept);

  const serve = async row => {
    if (busy[row.key]) return;
    tapMedium();
    setBusy(b => ({ ...b, [row.key]: true }));
    try { await onServe(row.kotId, row.itemId); tapSuccess(); }
    finally { setBusy(b => { const n = { ...b }; delete n[row.key]; return n; }); }
  };

  if (loading) return <SkeletonRows n={6} />;

  if (!rows.length) return (
    <div className="w-empty">
      <MotionArt kind="done" size={86} />
      <div className="w-empty-title">केही बाकी छैन</div>
      <div className="w-empty-sub">Nothing pending — every punched item is served.</div>
    </div>
  );

  return (
    <>
      {/* M3 filter chips — outlined until selected, then filled with a leading tick */}
      {depts.length > 2 && (
        <div className="w-chips" role="tablist">
          {depts.map(d => (
            <button
              key={d}
              role="tab"
              aria-selected={dept === d}
              className={`w-chip-btn${dept === d ? ' is-on' : ''}`}
              onClick={() => { tapMedium(); setDept(d); }}
            >
              <Icon name="check" size={18} className="w-chip-tick" />
              {d === 'ALL' ? 'All' : d}
              <span className="w-chip-n">{d === 'ALL' ? rows.length : rows.filter(r => r.station === d).length}</span>
            </button>
          ))}
        </div>
      )}

      <ul className="w-serve-list">
        {shown.map(r => (
          <li key={r.key} className={`w-serve-row${r.ready ? ' is-ready' : ''}`}>
            <span className="w-serve-qty">{r.qty}</span>
            <span className="w-serve-main">
              <span className="w-serve-name">
                {r.name}
                {r.pack && <span className="w-serve-pack"><Icon name="pack" size={13} />pack</span>}
              </span>
              <span className="w-serve-meta">
                <b>{r.where}</b>
                <i className={`w-dot ${heat(r.age)}`} />
                {ago(r.age)} · R{r.round} · {r.station}
              </span>
            </span>
            <button
              className={`w-serve-btn${r.ready ? ' is-ready' : ''}`}
              disabled={!!busy[r.key]}
              onClick={() => serve(r)}
              aria-label={`${r.ready ? 'Serve' : 'Mark served'} ${r.name} for ${r.where}`}
            >
              {busy[r.key]
                ? <span className="w-spinner sm" />
                : <><Icon name="check" size={18} />{r.ready ? 'Serve' : 'Mark'}</>}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function SkeletonRows({ n }) {
  return (
    <ul className="w-serve-list">
      {Array.from({ length: n }).map((_, i) => (
        <li key={i} className="w-serve-row is-skeleton">
          <span className="w-sk w-sk-qty" />
          <span className="w-serve-main">
            <span className="w-sk w-sk-line" />
            <span className="w-sk w-sk-line short" />
          </span>
          <span className="w-sk w-sk-btn" />
        </li>
      ))}
    </ul>
  );
}
