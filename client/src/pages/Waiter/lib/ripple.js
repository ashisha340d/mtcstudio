// Material ripple origin tracking.
//
// One capture-phase listener on the document rather than a handler per
// component: the ripple itself is pure CSS (a scaled, faded circle on
// ::after), and all this needs to do is tell that circle where the finger
// landed. Elements opt in with the .w-ripple class.
//
// The single getBoundingClientRect() runs on pointerdown only — never
// during scroll — so it costs one layout read per tap.

let bound = false;

export function initRipple() {
  if (bound || typeof document === 'undefined') return;
  bound = true;

  document.addEventListener('pointerdown', e => {
    const el = e.target?.closest?.('.w-ripple');
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    el.style.setProperty('--rx', `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty('--ry', `${((e.clientY - r.top) / r.height) * 100}%`);
  }, { passive: true, capture: true });
}
