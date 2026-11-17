/* Weekly Sales Pattern — the typical hourly sales curve for each weekday,
   averaged over how many times that weekday occurred in the selected period.
   Multi-series line chart: identity (weekday) × trend (hour), so color is
   categorical, one fixed hue per weekday, per the dataviz skill's palette. */

import { useMemo, useRef, useState } from 'react';
import { fmtMoney, fmtQty } from './reportUtils';
import './weeklyPatternChart.css';

const HOUR_LABEL = (h) => `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`;

const compactMoney = (n) => {
  const abs = Math.abs(n);
  if (abs >= 100000) return `₹${(n / 100000).toFixed(n % 100000 === 0 ? 0 : 1)}L`;
  if (abs >= 1000) return `₹${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return `₹${Math.round(n)}`;
};

/** Round a max value up to a "clean" gridline step (…, 5K, 10K, 25K, 50K…). */
function niceMax(value) {
  if (value <= 0) return 100;
  const rough = value / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  return step * 4;
}

/** Smooth line through points via Catmull-Rom → cubic Bezier conversion. */
function smoothPath(points) {
  if (points.length < 2) return points.length === 1 ? `M ${points[0][0]} ${points[0][1]}` : '';
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

const W = 900, H = 320;
const PAD = { top: 16, right: 16, bottom: 30, left: 54 };

export default function WeeklyPatternChart({ data }) {
  const [hidden, setHidden] = useState(() => new Set());
  const [hoverHour, setHoverHour] = useState(null);
  const [tableView, setTableView] = useState(false);
  const svgRef = useRef(null);

  const weekdays = data?.weekdays || [];
  const withData = weekdays.filter(w => w.days > 0);

  const range = useMemo(() => {
    let lo = 23, hi = 0, any = false;
    for (const w of withData) {
      w.hours.forEach((v, h) => { if (v > 0) { any = true; if (h < lo) lo = h; if (h > hi) hi = h; } });
    }
    if (!any) return [8, 22];
    return [Math.max(0, lo - 1), Math.min(23, hi + 1)];
  }, [withData]);

  const hours = useMemo(
    () => Array.from({ length: range[1] - range[0] + 1 }, (_, i) => range[0] + i),
    [range]
  );

  const yMax = useMemo(() => {
    let m = 0;
    for (const w of withData) for (const h of hours) m = Math.max(m, w.hours[h] || 0);
    return niceMax(m);
  }, [withData, hours]);

  const x = (h) => PAD.left + ((h - range[0]) / (hours.length - 1 || 1)) * (W - PAD.left - PAD.right);
  const y = (v) => H - PAD.bottom - (v / yMax) * (H - PAD.top - PAD.bottom);

  const toggle = (dow) => setHidden(s => {
    const next = new Set(s);
    next.has(dow) ? next.delete(dow) : next.add(dow);
    return next;
  });

  const onMove = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const frac = (px - PAD.left) / (W - PAD.left - PAD.right) * (hours.length - 1);
    const idx = Math.round(Math.min(hours.length - 1, Math.max(0, frac)));
    setHoverHour(hours[idx]);
  };

  const visible = withData.filter(w => !hidden.has(w.dow));
  const hoverRows = hoverHour == null ? [] : visible
    .map(w => ({ w, v: w.hours[hoverHour] || 0 }))
    .sort((a, b) => b.v - a.v);

  const gridSteps = [0, 0.25, 0.5, 0.75, 1];
  const tickHours = hours.filter(h => h % (hours.length > 12 ? 2 : 1) === 0);

  if (!weekdays.length) {
    return <div className="rp-empty">No sales in this period yet.</div>;
  }

  return (
    <div className="wp-viz-root">
      <div className="wp-head">
        <div className="wp-head-note">
          Average hourly sales per weekday — {withData.length
            ? withData.map(w => `${w.days} ${w.label}`).join(', ')
            : 'no closed sales in range'}
        </div>
        <button className="wp-table-toggle" onClick={() => setTableView(v => !v)}>
          {tableView ? '📈 Chart' : '▤ Table'}
        </button>
      </div>

      {tableView ? (
        <WeeklyPatternTable weekdays={withData} hours={hours} />
      ) : (
        <>
          <div className="wp-chart-wrap">
            <svg
              ref={svgRef}
              className="wp-svg"
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              onMouseMove={onMove}
              onMouseLeave={() => setHoverHour(null)}
            >
              {/* Gridlines + Y labels */}
              {gridSteps.map(f => {
                const v = yMax * f;
                return (
                  <g key={f}>
                    <line className="wp-grid" x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
                    <text className="wp-axis-label" x={PAD.left - 8} y={y(v)} textAnchor="end" dominantBaseline="middle">
                      {compactMoney(v)}
                    </text>
                  </g>
                );
              })}

              {/* X labels */}
              {tickHours.map(h => (
                <text key={h} className="wp-axis-label" x={x(h)} y={H - PAD.bottom + 18} textAnchor="middle">
                  {String(h).padStart(2, '0')}:00
                </text>
              ))}

              {/* Crosshair */}
              {hoverHour != null && (
                <line className="wp-crosshair" x1={x(hoverHour)} x2={x(hoverHour)} y1={PAD.top} y2={H - PAD.bottom} />
              )}

              {/* Series lines */}
              {visible.map(w => {
                const pts = hours.map(h => [x(h), y(w.hours[h] || 0)]);
                return (
                  <g key={w.dow} data-dow={w.dow}>
                    <path className="wp-line" d={smoothPath(pts)} />
                    {hoverHour != null && (
                      <circle className="wp-dot" cx={x(hoverHour)} cy={y(w.hours[hoverHour] || 0)} r={4} />
                    )}
                  </g>
                );
              })}
            </svg>

            {hoverHour != null && !!hoverRows.length && (
              <div
                className="wp-tooltip"
                style={{
                  left: `${(x(hoverHour) / W) * 100}%`,
                  top: 8,
                }}
              >
                <div className="wp-tooltip-head">{HOUR_LABEL(hoverHour)} – {HOUR_LABEL((hoverHour + 1) % 24)}</div>
                {hoverRows.map(({ w, v }) => (
                  <div key={w.dow} className="wp-tooltip-row" data-dow={w.dow}>
                    <span className="wp-tooltip-key"><i />{w.label}</span>
                    <strong>{fmtMoney(v)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Legend — always present for ≥2 series; click to isolate/restore */}
          <div className="wp-legend">
            {weekdays.map(w => {
              const isHidden = hidden.has(w.dow);
              const noData = w.days === 0;
              const total = w.hours.reduce((s, v) => s + v, 0);
              return (
                <button
                  key={w.dow}
                  className={`wp-legend-item${isHidden ? ' is-hidden' : ''}${noData ? ' is-empty' : ''}`}
                  data-dow={w.dow}
                  onClick={() => !noData && toggle(w.dow)}
                  disabled={noData}
                  title={noData ? `No ${w.label} in this period` : `${w.label} avg ${fmtMoney(total)}/day over ${w.days} day${w.days === 1 ? '' : 's'}`}
                >
                  <i className="wp-legend-key" />
                  {w.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function WeeklyPatternTable({ weekdays, hours }) {
  return (
    <div className="wp-table-wrap">
      <table className="wp-table">
        <thead>
          <tr>
            <th>Hour</th>
            {weekdays.map(w => <th key={w.dow}>{w.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {hours.map(h => (
            <tr key={h}>
              <td>{String(h).padStart(2, '0')}:00</td>
              {weekdays.map(w => <td key={w.dow}>{fmtQty(Math.round(w.hours[h] || 0))}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
