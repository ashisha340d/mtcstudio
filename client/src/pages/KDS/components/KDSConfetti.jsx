const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#eab308'];

export default function KDSConfetti() {
  const pieces = Array.from({ length: 80 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.35,
    duration: 1.8 + Math.random() * 1.4,
    color: COLORS[i % COLORS.length],
    size: 6 + Math.random() * 7,
    rotate: Math.random() * 360,
    drift: (Math.random() - 0.5) * 240,
  }));

  return (
    <div className="kds-confetti" aria-hidden="true">
      {pieces.map(p => (
        <span
          key={p.id}
          className="kds-confetti__piece"
          style={{
            left: `${p.left}%`,
            background: p.color,
            width: p.size,
            height: p.size * 0.4,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            '--drift': `${p.drift}px`,
            '--rotate': `${p.rotate}deg`,
          }}
        />
      ))}
    </div>
  );
}
