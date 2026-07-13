import { useState, useMemo } from 'react';
import { usePOS } from '../../../context/POSContext';
export default function MenuPane() {
  const { products, categories, addToCart } = usePOS();
  const [activeCat, setActiveCat] = useState(null);
  const [search, setSearch]       = useState('');
  const activeProducts = useMemo(() => {
    let list = products.filter((p) => p.is_active !== 0);
    if (activeCat)           list = list.filter((p) => p.category_id === activeCat);
    if (search.trim())       list = list.filter((p) =>
      p.name.toLowerCase().includes(search.toLowerCase())
    );
    return list;
  }, [products, activeCat, search]);

  const activeCats = useMemo(
    () => categories.filter((c) => c.is_active !== 0).sort((a, b) => a.sort_order - b.sort_order),
    [categories]
  );

  return (
    <div className="menu-pane">
      <div className="menu-pane__cats">
        <button
          className={`cat-tab ${!activeCat ? 'cat-tab--active' : ''}`}
          onClick={() => setActiveCat(null)}
        >All</button>
        {activeCats.map((c) => (
          <button
            key={c.id}
            className={`cat-tab ${activeCat === c.id ? 'cat-tab--active' : ''}`}
            onClick={() => setActiveCat(activeCat === c.id ? null : c.id)}
          >{c.name}</button>
        ))}
      </div>

      <div className="menu-pane__search">
         <input style={"font-size:18px;"}
          className="menu-search-input"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="menu-pane__grid">
        {activeProducts.map((p) => (
          <button
            key={p.id}
            className="product-card"
            onClick={() => addToCart(p)}
          >
            <span className="product-card__name">{p.name}</span>
            <span className="product-card__price">₹{Number(p.price ?? 0).toFixed(0)}</span>
            <span className="product-card__prep">{p.prep_time_minutes}m</span>
            {(p.is_fast_moving || (p.variant_count ?? 0) > 1 || p.badge) && (
              <span className="product-card__badges" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {p.is_fast_moving && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 999, background: 'rgba(193,68,14,0.12)', color: '#c1440e' }}>⚡ Fast</span>}
                {(p.variant_count ?? 0) > 1 && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 999, background: 'rgba(45,122,45,0.12)', color: '#2d7a2d' }}>{p.variant_count} sizes</span>}
                {p.badge && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 999, background: 'rgba(29,78,216,0.12)', color: '#1d4ed8' }}>{p.badge}</span>}
              </span>
            )}
          </button>
        ))}
        {activeProducts.length === 0 && (
          <div style={{ color: 'var(--text-3)', fontSize: 13, gridColumn: '1 / -1', paddingTop: 24 }}>
            No items
          </div>
        )}
      </div>
    </div>
  );
}
