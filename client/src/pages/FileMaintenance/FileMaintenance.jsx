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
];

export default function FileMaintenance() {
  const [active, setActive] = useState('tables');

  return (
    <div className="fm-root" style={{ maxWidth: ['assignment','receipt','cake-slip','cake-products','table-tags'].includes(active) ? '100%' : undefined }}>
      <div className="fm-header">
        <h1>File Maintenance</h1>
        <span style={{ fontSize: 13, color: '#aaa' }}>
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
    </div>
  );
}
