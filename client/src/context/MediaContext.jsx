import { createContext, useContext, useState, useCallback } from 'react';
import { mediaApi } from '../services/api';

const MediaContext = createContext(null);

export function MediaProvider({ children }) {
  const [media, setMedia] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (params = {}) => {
    setLoading(true);
    try {
      const res = await mediaApi.list(params);
      setMedia(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  const reload = load;

  return (
    <MediaContext.Provider value={{ media, loading, load, reload }}>
      {children}
    </MediaContext.Provider>
  );
}

export const useMedia = () => useContext(MediaContext);
