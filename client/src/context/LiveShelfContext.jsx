import { createContext, useContext, useState, useCallback } from 'react';
import { liveshelfApi } from '../services/api';

const LiveShelfContext = createContext(null);

export function LiveShelfProvider({ children }) {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (params = {}) => {
    setLoading(true);
    try {
      const res = await liveshelfApi.list(params);
      setItems(res.data.items);
      setCategories(res.data.categories);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <LiveShelfContext.Provider value={{ items, categories, loading, load }}>
      {children}
    </LiveShelfContext.Provider>
  );
}

export const useLiveShelf = () => useContext(LiveShelfContext);
