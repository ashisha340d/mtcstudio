import { useEffect, useRef } from 'react';
import './confettiBurst.css';

const COLORS = ['#42c2f1', '#fbda4f', '#ab63df', '#5fc581'];

// Small celebratory confetti burst — no GSAP/MorphSVG, just CSS keyframes.
// Fires a fresh burst whenever `trigger` changes identity (pass a new object/id each time).
export default function ConfettiBurst({ trigger, count = 20, scale = 1 }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!trigger) return;
    const el = containerRef.current;
    if (!el) return;

    const pieces = [];
    for (let i = 0; i < count; i++) {
      const piece = document.createElement('span');
      piece.className = 'confetti-piece';
      const size = (6 + Math.random() * 5) * scale;
      piece.style.width = `${size}px`;
      piece.style.height = `${size * 0.6}px`;
      piece.style.background = COLORS[i % COLORS.length];
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.setProperty('--rot', `${Math.random() * 360}deg`);
      piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 120 * scale}px`);
      piece.style.setProperty('--fall', `${140 * scale}px`);
      piece.style.animationDuration = `${0.9 + Math.random() * 0.7}s`;
      piece.style.animationDelay = `${Math.random() * 0.15}s`;
      piece.addEventListener('animationend', () => piece.remove());
      el.appendChild(piece);
      pieces.push(piece);
    }
    return () => pieces.forEach(p => p.remove());
  }, [trigger, count, scale]);

  return <div className="confetti-burst" style={{ height: `${160 * scale}px` }} ref={containerRef} />;
}
