import { useMemo } from 'react';
import { usePOS } from '../../../context/POSContext';

export default function FastPane() {
  const { products, addToCart } = usePOS();

  const fastItems = useMemo(
    () => products.filter((p) => p.is_fast_moving && p.is_active !== 0),
    [products]
  );

  return (
    <div className="fast-pane">
      <div className="fast-pane__header">Quick Add</div>
      <div className="fast-pane__list">
        {fastItems.length === 0 && (
          <div style={{ color: 'var(--text-3)', fontSize: 12, padding: '16px 8px' }}>
            Mark items as fast-moving in the menu.
          </div>
        )}
        {fastItems.map((p) => (
          <button
            key={p.id}
            className="fast-item"
            onClick={() => addToCart(p)}
          >
            <span className="fast-item__name">{p.name}</span>
            <span className="fast-item__price">₹{Number(p.price ?? 0).toFixed(0)}</span>
            {(p.is_fast_moving || (p.variant_count ?? 0) > 1 || p.badge) && (
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {p.is_fast_moving && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 999, background: 'rgba(193,68,14,0.12)', color: '#c1440e' }}>⚡</span>}
                {(p.variant_count ?? 0) > 1 && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 999, background: 'rgba(45,122,45,0.12)', color: '#2d7a2d' }}>{p.variant_count}</span>}
                {p.badge && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 999, background: 'rgba(29,78,216,0.12)', color: '#1d4ed8' }}>{p.badge}</span>}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
