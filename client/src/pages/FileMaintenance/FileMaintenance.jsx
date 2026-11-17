import { useState } from 'react';
import TablesTab           from './tabs/TablesTab';
import StationsTab         from './tabs/StationsTab';
import UsersTab            from './tabs/UsersTab';
import SharedModifiersTab  from './tabs/SharedModifiersTab';
import ModifierAssignment  from '../ModifierAssignment/ModifierAssignment';
import ReceiptSettingsTab  from './tabs/ReceiptSettingsTab';
import CakeSlipTab         from './tabs/CakeSlipTab';
import CakeProductsTab     from './tabs/CakeProductsTab';
import TableTagsTab        from './tabs/TableTagsTab';
import KDSSoundSettingsTab from './tabs/KDSSoundSettingsTab';
import WeatherRecommendsTab from './tabs/WeatherRecommendsTab';
import MeroKinmelTab       from './tabs/MeroKinmelTab';
const AUTO_LOCK_KEY = 'mtc_auto_lock_seconds';
const HOVER_BILL_KEY = 'mtc_show_hover_bill';
import './fm.css';

const TABS = [
  { key: 'tables',        label: '🪑 Tables'            },
  { key: 'stations',      label: '🍳 Stations'          },
  { key: 'modifiers',     label: '🧩 Modifier Setup'    },
  { key: 'assignment',    label: '🔗 Assign Modifiers'  },
  { key: 'users',         label: '👤 Users'             },
  { key: 'receipt',       label: '🧾 Receipt & Printer'  },
  { key: 'cake-slip',     label: '🎂 Cake Order Slip'   },
  { key: 'cake-products', label: '🎂 Cake Products'     },
  { key: 'table-tags',   label: '🏷 Table Tags'         },
  { key: 'kds-sound',    label: '🔔 Alert Sounds'       },
  { key: 'weather',      label: '🌤️ Weather Recommends' },
  { key: 'mero-kinmel',  label: '🛵 Mero Kinmel'        },
  { key: 'settings',     label: '⚙️ Settings'           },
];

export default function FileMaintenance() {
  const [active, setActive] = useState('tables');
  const [autoLockSeconds, setAutoLockSeconds] = useState(() => localStorage.getItem(AUTO_LOCK_KEY) ?? 120);
  const setAutoLock = (s) => { localStorage.setItem(AUTO_LOCK_KEY, String(s)); setAutoLockSeconds(s); };
  const [hoverBill, setHoverBillState] = useState(() => localStorage.getItem(HOVER_BILL_KEY) !== '0');
  const setHoverBill = (v) => { localStorage.setItem(HOVER_BILL_KEY, v ? '1' : '0'); setHoverBillState(v); };

  return (
    <div className="fm-root">
      <div className="fm-header">
        <h1>File Maintenance</h1>
        <span style={{ fontSize: 13, color: 'var(--t-text-soft)' }}>
          Manage tables, stations, modifiers &amp; users
        </span>
      </div>

      <div className="fm-tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`fm-tab ${active === t.key ? 'fm-tab--active' : ''}`}
            onClick={() => setActive(t.key)}
          >{t.label}</button>
        ))}
      </div>

      {active === 'tables'     && <TablesTab />}
      {active === 'stations'   && <StationsTab />}
      {active === 'modifiers'  && <SharedModifiersTab />}
      {active === 'assignment' && (
        <div style={{ margin: '-24px -28px' }}>
          <ModifierAssignment embedded />
        </div>
      )}
      {active === 'users'      && <UsersTab />}
      {active === 'receipt'       && <ReceiptSettingsTab />}
      {active === 'cake-slip'     && <CakeSlipTab />}
      {active === 'table-tags'    && <TableTagsTab />}
      {active === 'cake-products' && <CakeProductsTab />}
      {active === 'kds-sound'     && <KDSSoundSettingsTab />}
      {active === 'weather'       && <WeatherRecommendsTab />}
      {active === 'mero-kinmel'   && <MeroKinmelTab />}
      {active === 'settings'      && (
        <div className="fm-card" style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div className="fm-card__title">Auto Lock</div>
          <div style={{ fontSize: 12, color: 'var(--t-text-soft)', marginTop: 4 }}>
            Lock after inactivity. Set to 0 to disable.
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--t-text-muted)' }}>
          Seconds
          <input
            type="number"
            min="0"
            step="1"
            value={autoLockSeconds}
            onChange={e => setAutoLock(Math.max(0, Number(e.target.value)))}
            style={{ width: 90, padding: '8px 10px', border: '1px solid var(--t-border)', borderRadius: 6, boxSizing: 'border-box' }}
          />
        </label>
        </div>
      )}
      {active === 'settings'      && (
        <div className="fm-card" style={{ marginTop: 16, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div className="fm-card__title">Show Hover Bill</div>
            <div style={{ fontSize: 12, color: 'var(--t-text-soft)', marginTop: 4 }}>
              Show bill preview when hovering a table on the POS Dashboard.
            </div>
          </div>
          <input type="checkbox" checked={hoverBill} onChange={e => setHoverBill(e.target.checked)} style={{ width: 18, height: 18 }} />
        </div>
      )}
    </div>
  );
}
