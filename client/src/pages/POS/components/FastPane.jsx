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
            <span className="fast-item__price">₹{p.price.toFixed(0)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
