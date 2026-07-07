import { createContext, useContext, useState, useCallback } from 'react';
import { blogsApi } from '../services/api';

const BlogContext = createContext(null);

export function BlogProvider({ children }) {
  const [blogs, setBlogs] = useState([]);
  const [topics, setTopics] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (params = {}) => {
    setLoading(true);
    try {
      const res = await blogsApi.list(params);
      setBlogs(res.data.blogs);
      setTopics(res.data.topics);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <BlogContext.Provider value={{ blogs, topics, loading, load }}>
      {children}
    </BlogContext.Provider>
  );
}

export const useBlogs = () => useContext(BlogContext);
