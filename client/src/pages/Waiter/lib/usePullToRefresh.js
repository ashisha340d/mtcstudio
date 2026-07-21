import { useEffect, useRef, useState } from 'react';
import { tapLight, tapSuccess } from './haptics';

const THRESHOLD = 72;   // px of pull needed to arm the refresh
const MAX       = 110;  // rubber-band ceiling

// Pull-to-refresh for a scroll container. Returns { distance, refreshing } for
// the indicator; the transform is applied by the caller on a composited layer.
export function usePullToRefresh(scrollRef, onRefresh) {
  const [distance, setDistance]     = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY  = useRef(0);
  const pulling = useRef(false);
  const armed   = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onStart = e => {
      if (el.scrollTop > 0 || refreshing) return;
      startY.current = e.touches[0].clientY;
      pulling.current = true;
      armed.current = false;
    };
    const onMove = e => {
      if (!pulling.current) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) { setDistance(0); return; }
      // Rubber band: resistance grows with distance, never exceeds MAX.
      const d = Math.min(MAX, dy * 0.5);
      setDistance(d);
      if (d >= THRESHOLD && !armed.current) { armed.current = true; tapLight(); }
      if (d > 4 && e.cancelable) e.preventDefault();
    };
    const onEnd = async () => {
      if (!pulling.current) return;
      pulling.current = false;
      if (armed.current) {
        setRefreshing(true);
        setDistance(THRESHOLD);
        try { await onRefresh(); } catch { /* indicator still needs to retract */ }
        tapSuccess();
        setRefreshing(false);
      }
      setDistance(0);
      armed.current = false;
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove',  onMove,  { passive: false });
    el.addEventListener('touchend',   onEnd,   { passive: true });
    el.addEventListener('touchcancel', onEnd,  { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove',  onMove);
      el.removeEventListener('touchend',   onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [scrollRef, onRefresh, refreshing]);

  return { distance, refreshing, armed: distance >= THRESHOLD };
}
