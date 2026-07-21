// Animated vector art for loading / empty / success states.
// Hand-built inline SVG rather than Lottie: no runtime dependency, no JSON
// fetch (this PWA runs offline mid-shift), and every moving part is a
// transform/opacity keyframe so it composites on the GPU.
// Motion lives in waiter.css under "MOTION ART".

const S = { display: 'block' };

function Cooking() {
  return (
    <svg className="ma ma-cooking" viewBox="0 0 96 96" style={S} aria-hidden="true">
      <g className="ma-steam">
        <path d="M36 34c0-6 6-6 6-12s-6-6-6-12" />
        <path d="M48 34c0-7 7-7 7-14s-7-7-7-14" />
        <path d="M60 34c0-6 6-6 6-12s-6-6-6-12" />
      </g>
      <g className="ma-pot">
        <rect className="ma-pot-body" x="20" y="42" width="56" height="34" rx="12" />
        <rect className="ma-pot-lid" x="15" y="36" width="66" height="9" rx="4.5" />
        <circle className="ma-pot-knob" cx="48" cy="32" r="3.5" />
      </g>
    </svg>
  );
}

function Floor() {
  return (
    <svg className="ma ma-floor" viewBox="0 0 96 96" style={S} aria-hidden="true">
      <g className="ma-tiles">
        {[[18, 18], [54, 18], [18, 54], [54, 54]].map(([x, y], i) => (
          <rect key={i} x={x} y={y} width="24" height="24" rx="8" style={{ '--i': i }} />
        ))}
      </g>
    </svg>
  );
}

function Orders() {
  return (
    <svg className="ma ma-orders" viewBox="0 0 96 96" style={S} aria-hidden="true">
      <circle className="ma-dial" cx="48" cy="48" r="28" />
      <circle className="ma-sweep" cx="48" cy="48" r="28" />
      <line className="ma-hand" x1="48" y1="48" x2="48" y2="30" />
      <circle className="ma-pin" cx="48" cy="48" r="3" />
    </svg>
  );
}

function Done() {
  return (
    <svg className="ma ma-done" viewBox="0 0 96 96" style={S} aria-hidden="true">
      <circle className="ma-ring" cx="48" cy="48" r="30" />
      <path className="ma-tick" d="M33 49.5 43.5 60 64 37" />
    </svg>
  );
}

function Success() {
  return (
    <svg className="ma ma-success" viewBox="0 0 120 120" style={S} aria-hidden="true">
      <circle className="ma-burst" cx="60" cy="60" r="36" />
      <circle className="ma-disc" cx="60" cy="60" r="36" />
      <path className="ma-tick" d="M43 61 55 73 79 47" />
    </svg>
  );
}

function Search() {
  return (
    <svg className="ma ma-search" viewBox="0 0 96 96" style={S} aria-hidden="true">
      <g className="ma-glass">
        <circle cx="43" cy="43" r="20" />
        <line x1="58" y1="58" x2="72" y2="72" />
      </g>
    </svg>
  );
}

function Download() {
  return (
    <svg className="ma ma-download" viewBox="0 0 96 96" style={S} aria-hidden="true">
      <g className="ma-dl-arrow">
        <line x1="48" y1="14" x2="48" y2="54" />
        <path d="M32 40 48 58 64 40" />
      </g>
      <rect className="ma-dl-tray" x="18" y="68" width="60" height="14" rx="7" />
    </svg>
  );
}

const KINDS = { cooking: Cooking, floor: Floor, orders: Orders, done: Done, success: Success, search: Search, download: Download };

export default function MotionArt({ kind = 'cooking', size = 92 }) {
  const Art = KINDS[kind] || Cooking;
  return (
    <span className="ma-wrap" style={{ width: size, height: size }}>
      <Art />
    </span>
  );
}
