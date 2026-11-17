import { useState, useCallback } from 'react';

export function useMsg() {
  const [msg, setMsg] = useState(null);

  const showMsg = useCallback((text, ok = true) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 2500);
  }, []);

  return { msg, showMsg };
}
