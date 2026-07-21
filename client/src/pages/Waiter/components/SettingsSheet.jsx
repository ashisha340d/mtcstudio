import { memo, useCallback } from 'react';
import Icon from './Icon';
import { tapLight, tapMedium } from '../lib/haptics';
import { THEMES, RANGES, DEFAULTS } from '../lib/waiterSettings';

/**
 * Settings bottom sheet.
 *
 * Every control is live: `onChange` writes straight through to the parent,
 * which persists to localStorage and re-applies the CSS variables on the
 * same frame. There is no Save button on purpose — a waiter dragging the
 * table-size slider watches the floor grid reflow underneath the sheet,
 * which is the whole point of tuning it here.
 */

/* An M3 slider that reports its live value. The track fill is a gradient
   driven by the value so no extra element has to be positioned. */
function Slider({ label, hint, value, range: [min, max, step], format, onChange }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="w-set-row">
      <span className="w-set-label">
        {label}
        <b className="w-set-val">{format ? format(value) : value}</b>
      </span>
      {hint && <span className="w-set-hint">{hint}</span>}
      <input
        type="range"
        className="w-set-slider"
        min={min} max={max} step={step} value={value}
        style={{ '--pct': `${pct}%` }}
        onChange={e => onChange(Number(e.target.value))}
        /* Fires once per settle, not per frame — keeps haptics off the drag */
        onPointerUp={tapLight}
      />
    </label>
  );
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="w-set-row w-set-row--toggle">
      <span className="w-set-text">
        <span className="w-set-label">{label}</span>
        {hint && <span className="w-set-hint">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`w-switch${checked ? ' is-on' : ''}`}
        onClick={() => { tapLight(); onChange(!checked); }}
      >
        <span className="w-switch-thumb">
          {checked && <Icon name="check" size={16} />}
        </span>
      </button>
    </label>
  );
}

function SettingsSheet({ settings, onChange, onReset, onClose }) {
  const set = useCallback((patch) => onChange(patch), [onChange]);

  return (
    <div className="w-sheet-wrap" onClick={onClose}>
      <div className="w-sheet w-set-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label="Settings">
        <div className="w-sheet-grab" />

        <div className="w-set-head">
          <span className="w-sheet-title">Settings</span>
          <button className="w-icon-btn" onClick={onClose} aria-label="Close settings">
            <Icon name="close" />
          </button>
        </div>

        {/* ── Appearance ─────────────────────────────────────────── */}
        <div className="w-set-group">
          <div className="w-set-group-title"><Icon name="palette" size={18} /> Appearance</div>

          <div className="w-theme-row" role="radiogroup" aria-label="Theme">
            {THEMES.map(t => (
              <button
                key={t.id}
                role="radio"
                aria-checked={settings.theme === t.id}
                className={`w-theme-card${settings.theme === t.id ? ' is-active' : ''}`}
                onClick={() => { tapMedium(); set({ theme: t.id }); }}
              >
                {/* Live swatch — themed by the same attribute the app uses,
                    so a new palette needs no extra preview code here. */}
                <span className={`w-theme-swatch w-theme-swatch--${t.id}`} aria-hidden="true">
                  <i /><i /><i />
                </span>
                <span className="w-theme-name">{t.label}</span>
                <span className="w-theme-hint">{t.hint}</span>
              </button>
            ))}
          </div>

          <Slider
            label="Text size"
            hint="Scales every label in the app"
            value={settings.textScale}
            range={RANGES.textScale}
            format={v => `${Math.round(v * 100)}%`}
            onChange={v => set({ textScale: v })}
          />
        </div>

        {/* ── Layout ─────────────────────────────────────────────── */}
        <div className="w-set-group">
          <div className="w-set-group-title"><Icon name="grid" size={18} /> Layout</div>

          <Slider
            label="Table size"
            hint="Bigger tiles, fewer per row on the Floor"
            value={settings.tableSize}
            range={RANGES.tableSize}
            format={v => `${v}px`}
            onChange={v => set({ tableSize: v })}
          />
          <Slider
            label="Category size"
            hint="Tile size on the category grid"
            value={settings.catSize}
            range={RANGES.catSize}
            format={v => `${v}px`}
            onChange={v => set({ catSize: v })}
          />
          <Slider
            label="Menu density"
            hint="Row height and thumbnail size in the item list"
            value={settings.menuScale}
            range={RANGES.menuScale}
            format={v => `${Math.round(v * 100)}%`}
            onChange={v => set({ menuScale: v })}
          />
        </div>

        {/* ── Device ─────────────────────────────────────────────── */}
        <div className="w-set-group">
          <div className="w-set-group-title"><Icon name="settings" size={18} /> Device</div>

          <Toggle
            label="Vibration"
            hint="Haptic feedback on taps and sends"
            checked={settings.haptics}
            onChange={v => set({ haptics: v })}
          />
          <Toggle
            label="Keep screen on"
            hint="Stops the handset sleeping mid-service"
            checked={settings.keepAwake}
            onChange={v => set({ keepAwake: v })}
          />
          <Toggle
            label="Large tap targets"
            hint="Grows buttons to 56dp — easier with wet hands"
            checked={settings.bigTouch}
            onChange={v => set({ bigTouch: v })}
          />
        </div>

        <button
          className="w-set-reset w-ripple"
          onClick={() => { tapMedium(); onReset(); }}
        >
          <Icon name="replay" size={20} /> Reset to defaults
        </button>
      </div>
    </div>
  );
}

export default memo(SettingsSheet);
export { DEFAULTS };
