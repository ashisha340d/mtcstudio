import { createContext, useContext, useState, useCallback } from 'react';
import { categoriesApi } from '../services/api';

const CategoryContext = createContext(null);

export function CategoryProvider({ children }) {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (params = {}) => {
    setLoading(true);
    try {
      const res = await categoriesApi.list(params);
      setCategories(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <CategoryContext.Provider value={{ categories, loading, load }}>
      {children}
    </CategoryContext.Provider>
  );
}

export const useCategories = () => useContext(CategoryContext);
