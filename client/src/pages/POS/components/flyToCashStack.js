// Ghost money chip that arcs from a card's on-screen position to the
// "💰 Drawer" toolbar button, then pops the drawer and floats a +amount.
export function flyToCashStack(rect, { amount } = {}) {
  const target = document.querySelector('[data-cash-target="drawer"]');
  if (!rect || !target) return;
  const to = target.getBoundingClientRect();

  const label = amount ? `₹${Math.round(amount).toLocaleString('en-IN')}` : '💰';

  const ghost = document.createElement('div');
  ghost.className = 'cash-fly-ghost';
  ghost.textContent = label;
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${Math.min(rect.height, 52)}px`;
  document.body.appendChild(ghost);

  const dx = (to.left + to.width / 2) - (rect.left + rect.width / 2);
  const dy = (to.top + to.height / 2) - (rect.top + rect.height / 2);
  // Arc: lift the midpoint above the straight line for a thrown-coin feel
  const lift = Math.max(90, Math.abs(dy) * 0.3);

  const anim = ghost.animate([
    { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
    { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - lift}px) scale(0.55) rotate(-6deg)`, opacity: 1, offset: 0.55 },
    { transform: `translate(${dx}px, ${dy}px) scale(0.1) rotate(4deg)`, opacity: 0.5 },
  ], { duration: 650, easing: 'cubic-bezier(.5,.05,.45,1)', fill: 'forwards' });

  anim.onfinish = () => {
    ghost.remove();

    // Drawer button reacts to the catch
    target.classList.remove('cash-target-hit');
    void target.offsetWidth; // restart animation if hit again quickly
    target.classList.add('cash-target-hit');
    setTimeout(() => target.classList.remove('cash-target-hit'), 500);

    if (amount) {
      const pop = document.createElement('div');
      pop.className = 'cash-pop';
      pop.textContent = `+${label}`;
      pop.style.left = `${to.left + to.width / 2}px`;
      pop.style.top = `${to.bottom + 4}px`;
      document.body.appendChild(pop);
      setTimeout(() => pop.remove(), 950);
    }
  };
}
