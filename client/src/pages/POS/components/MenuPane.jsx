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
            <span className="product-card__price">₹{p.price.toFixed(0)}</span>
            <span className="product-card__prep">{p.prep_time_minutes}m</span>
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
