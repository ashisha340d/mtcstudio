import { useState } from 'react';
import { useKDS } from '../../../context/KDSContext';

export default function KDSSettings({ onClose }) {
  const { settings, stations, updateSettings } = useKDS();
  const set = (key, value) => updateSettings({ [key]: value });

  const [warnInput, setWarnInput] = useState(String(settings.delayWarningMins));
  const [critInput, setCritInput] = useState(String(settings.delayCriticalMins));
  const [repeatInput, setRepeatInput] = useState(String(settings.criticalRepeatSecs));

  const commitWarning = () => {
    const w = Math.max(1, Math.min(59, parseInt(warnInput) || settings.delayWarningMins));
    const c = Math.max(w, settings.delayCriticalMins);
    setWarnInput(String(w));
    setCritInput(String(c));
    updateSettings({ delayWarningMins: w, delayCriticalMins: c });
  };

  const commitCritical = () => {
    const c = Math.max(settings.delayWarningMins, Math.min(120, parseInt(critInput) || settings.delayCriticalMins));
    setCritInput(String(c));
    set('delayCriticalMins', c);
  };

  const commitRepeat = () => {
    const r = Math.max(5, Math.min(300, parseInt(repeatInput) || settings.criticalRepeatSecs));
    setRepeatInput(String(r));
    set('criticalRepeatSecs', r);
  };

  const critTooLow = parseInt(critInput) < parseInt(warnInput);

  return (
    <div className="kds-modal-overlay" onClick={onClose}>
      <div className="kds-settings-panel" onClick={e => e.stopPropagation()}>
        <div className="kds-settings-header">
          <span className="kds-settings-title">KDS Settings</span>
          <button className="kds-modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="kds-settings-body">

          {/* Station / Department filter */}
          <div className="kds-settings-group">
            <label className="kds-settings-label">Station Filter</label>
            <div className="kds-settings-row kds-settings-row--wrap">
              <button
                className={`kds-settings-option ${!settings.activeDepartment ? 'kds-settings-option--active' : ''}`}
                onClick={() => set('activeDepartment', null)}
              >All</button>
              {stations.map(s => (
                <button
                  key={s.id}
                  className={`kds-settings-option ${settings.activeDepartment === s.id ? 'kds-settings-option--active' : ''}`}
                  style={settings.activeDepartment === s.id ? { background: s.color_hex, borderColor: s.color_hex, color: '#fff' } : {}}
                  onClick={() => set('activeDepartment', settings.activeDepartment === s.id ? null : s.id)}
                >{s.name}</button>
              ))}
            </div>
          </div>

          {/* Theme */}
          <div className="kds-settings-group">
            <label className="kds-settings-label">Theme</label>
            <div className="kds-settings-row">
              {['dark', 'light', 'auto'].map(t => (
                <button
                  key={t}
                  className={`kds-settings-option ${settings.theme === t ? 'kds-settings-option--active' : ''}`}
                  onClick={() => set('theme', t)}
                >
                  {t === 'dark' ? '◐ Dark' : t === 'light' ? '○ Light' : '◑ Auto'}
                </button>
              ))}
            </div>
          </div>

          {/* Card Density */}
          <div className="kds-settings-group">
            <label className="kds-settings-label">Card Density</label>
            <div className="kds-settings-row">
              {['compact', 'normal', 'large'].map(d => (
                <button
                  key={d}
                  className={`kds-settings-option ${settings.cardDensity === d ? 'kds-settings-option--active' : ''}`}
                  onClick={() => set('cardDensity', d)}
                >{d.charAt(0).toUpperCase() + d.slice(1)}</button>
              ))}
            </div>
          </div>

          {/* Warning Delay */}
          <div className="kds-settings-group">
            <label className="kds-settings-label">Warning Delay</label>
            <div className="kds-delay-row">
              <input
                type="number"
                className="kds-settings-number"
                min="1" max="59" step="1"
                value={warnInput}
                onChange={e => setWarnInput(e.target.value)}
                onBlur={commitWarning}
                onKeyDown={e => e.key === 'Enter' && commitWarning()}
              />
              <span className="kds-delay-unit kds-slider-warn">min</span>
            </div>
          </div>

          {/* Critical Delay */}
          <div className="kds-settings-group">
            <label className="kds-settings-label">Critical Delay</label>
            <div className="kds-delay-row">
              <input
                type="number"
                className={`kds-settings-number${critTooLow ? ' kds-settings-number--error' : ''}`}
                min={settings.delayWarningMins} max="120" step="1"
                value={critInput}
                onChange={e => setCritInput(e.target.value)}
                onBlur={commitCritical}
                onKeyDown={e => e.key === 'Enter' && commitCritical()}
              />
              <span className="kds-delay-unit kds-slider-crit">min</span>
            </div>
            {critTooLow && (
              <div className="kds-delay-error">Cannot be less than warning delay ({warnInput}m)</div>
            )}
          </div>

          {/* Critical Repeat Alarm */}
          <div className="kds-settings-group">
            <label className="kds-settings-label">Repeat Alarm (Critical)</label>
            <div className="kds-delay-row">
              <input
                type="number"
                className="kds-settings-number"
                min="5" max="300" step="1"
                value={repeatInput}
                onChange={e => setRepeatInput(e.target.value)}
                onBlur={commitRepeat}
                onKeyDown={e => e.key === 'Enter' && commitRepeat()}
                disabled={!settings.alarmEnabled}
              />
              <span className="kds-delay-unit kds-slider-crit">sec</span>
            </div>
          </div>

          {/* Alarm toggle */}
          <div className="kds-settings-group kds-settings-group--toggle">
            <label className="kds-settings-label" style={{ marginBottom: 0 }}>Alarm Sound</label>
            <button
              className={`kds-toggle ${settings.alarmEnabled ? 'kds-toggle--on' : ''}`}
              onClick={() => set('alarmEnabled', !settings.alarmEnabled)}
            ><span className="kds-toggle__knob" /></button>
          </div>

          {/* Order type colors */}
          <div className="kds-settings-group">
            <label className="kds-settings-label">Order Type Colors</label>
            <div className="kds-color-grid">
              {Object.entries(settings.orderTypeColors).map(([type, color]) => (
                <div key={type} className="kds-color-row">
                  <span className="kds-color-label">{type.replace('_', ' ')}</span>
                  <input
                    type="color" value={color}
                    onChange={e => updateSettings({ orderTypeColors: { ...settings.orderTypeColors, [type]: e.target.value } })}
                    className="kds-color-input"
                  />
                  <span className="kds-color-val">{color}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
