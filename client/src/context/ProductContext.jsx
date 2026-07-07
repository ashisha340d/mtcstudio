import { createContext, useContext, useState, useCallback } from 'react';
import { productsApi } from '../services/api';

const ProductContext = createContext(null);

export function ProductProvider({ children }) {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [meta, setMeta] = useState({ total: 0, totalPages: 1, counts: {} });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (params = {}) => {
    setLoading(true);
    try {
      const res = await productsApi.list(params);
      setProducts(res.data.products);
      setCategories(res.data.categories);
      setMeta({
        total: res.data.total,
        totalPages: res.data.totalPages,
        counts: res.data.counts
      });
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <ProductContext.Provider value={{ products, categories, meta, loading, load }}>
      {children}
    </ProductContext.Provider>
  );
}

export const useProducts = () => useContext(ProductContext);
