import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { dashboardApi } from '../../services/api';
import './Dashboard.css';

const POS_MODULES = [
  { label: 'POS',              desc: 'Order Management System',                           to: '/pos',              accent: '#879b8e' },
  { label: 'KDS Display',       desc: 'Kitchen order tickets — mount on kitchen screen',  to: '/kds',              accent: '#f97316' },
  { label: 'File Maintenance',  desc: 'Tables · Stations · POS Products · Users',         to: '/file-maintenance', accent: '#6366f1' },
  { label: 'CRM',               desc: 'Customers · Loyalty · Birthday Club',               to: '/crm',              accent: '#0891b2' },
  { label: 'Sales Report',      desc: 'Daily sales & order analytics',                    to: '/sales-report',     accent: '#10b981' },
  { label: 'Day End',           desc: 'Daily closing / Z report',                         to: '/day-end',          accent: '#b45309' },
];

const MODULES = [
  { key: 'products',     label: 'ASDASDASDASDASDASD',        desc: 'Manage menu items',                to: '/products'        },
  { key: 'categories',   label: 'Categories',       desc: 'Manage product categories',        to: '/categories'      },
  { key: 'media',        label: 'Media Library',    desc: 'Manage images & assets',           to: '/media'           },
  { key: 'blogs',        label: 'Blogs',            desc: 'Create blog articles',             to: '/blogs'           },
  { key: 'liveshelf',    label: 'Live Shelf',       desc: "Today's available items",          to: '/liveshelf'       },
  { key: 'menuGenerator',label: 'Menu Generator',   desc: 'Build & publish menu.html',        to: '/menu-generator'  },
];

export default function Dashboard() {
  const [stats, setStats] = useState({});
  const navigate = useNavigate();

  useEffect(() => {
    dashboardApi.stats().then(r => setStats(r.data)).catch(() => {});
  }, []);

  const openShortcutsManager = () => {
    window.dispatchEvent(new CustomEvent('openShortcutsPanel'));
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header"></div>

      {/* ── Desktop Shortcuts Manager ── */}
      <div className="dashboard-shortcuts-banner">
        <div className="shortcuts-banner-content">
          <div className="shortcuts-banner-text">
            <h3>⊞ Desktop Shortcuts</h3>
            <p>Customize which apps appear on your desktop. Drag icons to rearrange them.</p>
          </div>
          <button className="btn btn-shortcuts" onClick={openShortcutsManager}>
            Manage Shortcuts
          </button>
        </div>
      </div>

      {/* ── POS & KDS ── */}
      <div className="dashboard-section-label">Restaurant Operations</div>
      <div className="dashboard-grid dashboard-grid--pos">
        {POS_MODULES.map(m => (
          <div className="dash-card dash-card--pos" key={m.label} style={{ borderColor: m.accent }}>
            <div className="dash-card-pos-dot" style={{ background: m.accent }} />
            <h3>{m.label}</h3>
            <p>{m.desc}</p>
            <Link className="btn btn-primary" to={m.to} style={{ background: m.accent, borderColor: m.accent, color: '#000' }}>
              Launch
            </Link>
          </div>
        ))}
      </div>

      {/* ── CMS ── */}
      <div className="dashboard-section-label">Content Management</div>
      <div className="dashboard-grid">
        {MODULES.map(m => (
          <div className="dash-card" key={m.label}>
            <h3>{m.label}</h3>
            <p>{m.desc}</p>
            {m.key && stats[m.key] !== undefined && (
              <div className="dash-count">{stats[m.key]} records</div>
            )}
            <Link className="btn btn-primary" to={m.to}>Open</Link>
          </div>
        ))}
      </div>
    </div>
  );
}
