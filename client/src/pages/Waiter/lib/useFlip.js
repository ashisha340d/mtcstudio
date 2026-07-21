import { useLayoutEffect, useRef } from 'react';

// FLIP: when the filter changes and cards reflow, every surviving card animates
// from its old box to its new one. Transform/opacity only, so it stays on the
// compositor at 60fps. Cards are matched by their data-flip-key attribute.
export function useFlip(containerRef, dep) {
  const prev = useRef(new Map());

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const nodes = Array.from(el.querySelectorAll('[data-flip-key]'));
    const next  = new Map();

    for (const node of nodes) {
      const key = node.dataset.flipKey;
      const box = node.getBoundingClientRect();
      next.set(key, box);

      const old = prev.current.get(key);
      if (!old) {
        // Entering card — fade/scale in rather than popping.
        node.animate(
          [{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'none' }],
          { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' }
        );
        continue;
      }
      const dx = old.left - box.left;
      const dy = old.top  - box.top;
      if (!dx && !dy) continue;
      node.animate(
        [{ transform: `translate3d(${dx}px, ${dy}px, 0)` }, { transform: 'translate3d(0,0,0)' }],
        { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' }
      );
    }
    prev.current = next;
  }, [containerRef, dep]);
}
