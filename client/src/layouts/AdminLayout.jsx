import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate, Routes, Route } from 'react-router';

// ── Page components ────────────────────────────────────────────
import Dashboard from '../pages/Dashboard/Dashboard';
import Categories from '../pages/Categories/Categories';
import FoodMenu from '../pages/FoodMenu/FoodMenu';
import Media from '../pages/Media/Media';
import Blogs from '../pages/Blogs/Blogs';
import BlogNew from '../pages/Blogs/BlogNew';
import BlogEdit from '../pages/Blogs/BlogEdit';
import LiveShelf from '../pages/LiveShelf/LiveShelf';
import CakeCatalogue from '../pages/CakeCatalogue/CakeCatalogue';
import FileMaintenance from '../pages/FileMaintenance/FileMaintenance';
import CRM from '../pages/CRM/CRM';
import SystemMonitor from '../pages/SystemMonitor/SystemMonitor';
import SalesReport from '../pages/SalesReport/SalesReport';
import DayEnd from '../pages/DayEnd/DayEnd';

import DesktopWindow from './DesktopWindow';
import SettingsPanel from './SettingsPanel';
import { getTheme, saveTheme } from '../utils/themeConfig';

import './AdminLayout.css';

/* Blogs subroute wrapper — nested Routes for useParams() in BlogEdit */
function BlogsApp() {
  return (
    <Routes>
      <Route path="blogs" element={<Blogs />} />
      <Route path="blogs/new" element={<BlogNew />} />
      <Route path="blogs/edit/:id" element={<BlogEdit />} />
      <Route path="*" element={<Blogs />} />
    </Routes>
  );
}

/* ── App registry ─────────────────────────────────────────────── */
const ALL_APPS = [
  // Dashboard is NOT in this list — it lives at '/' but the desktop OS never
  // opens it as a window. It remains accessible via App.jsx routing.
  { key: 'categories', label: 'Categories', icon: '📂', path: '/categories', accent: '#2563eb', desc: 'Product categories', component: Categories },
  { key: 'food-menu', label: 'Food Menu', icon: '🍽', path: '/food-menu', accent: '#c1440e', desc: 'Products & variants', component: FoodMenu },
  { key: 'file-maintenance', label: 'File Maintenance', icon: '🔧', path: '/file-maintenance', accent: '#6366f1', desc: 'Tables · Users · Stations', component: FileMaintenance },
  { key: 'media', label: 'Media', icon: '🖼', path: '/media', accent: '#7c3aed', desc: 'Images & assets', component: Media },
  { key: 'liveshelf', label: 'Live Shelf', icon: '📡', path: '/liveshelf', accent: '#16a34a', desc: "Today's available items", component: LiveShelf },
  { key: 'cake-catalogue', label: 'Cake Catalogue', icon: '🍰', path: '/cake-catalogue', accent: '#e91e8c', desc: 'Website cake catalogue', component: CakeCatalogue },
  { key: 'blogs', label: 'Blogs', icon: '✍', path: '/blogs', accent: '#d97706', desc: 'Articles & content', component: BlogsApp },
  { key: 'crm', label: 'CRM', icon: '👥', path: '/crm', accent: '#0891b2', desc: 'Customers & loyalty', component: CRM },
  { key: 'sales-report', label: 'Sales Report', icon: '📊', path: '/sales-report', accent: '#10b981', desc: 'Daily sales & order analytics', component: SalesReport },
  { key: 'day-end', label: 'Day End', icon: '🔒', path: '/day-end', accent: '#b45309', desc: 'Daily closing / Z report', component: DayEnd },
  { key: 'system-monitor', label: 'System Monitor', icon: '⚡', path: '/system-monitor', accent: '#0f766e', desc: 'Status · Devices · Logs', component: SystemMonitor },
  // External launchers — navigate full-screen, no window
  { key: 'pos', label: 'POS', icon: '🖥', path: '/pos', accent: '#879b8e', desc: 'Order Management System', external: true },
  { key: 'kds', label: 'KDS Display', icon: '📺', path: '/kds', accent: '#f97316', desc: 'Kitchen Display System', external: true },
  { key: 'cake-orders', label: 'Cake Orders', icon: '🎂', path: '/pos/cake', accent: '#e91e8c', desc: 'Custom cake order management', external: true },
];

/* Menu bar dropdown children */
const FILES_CHILDREN = [
  { key: 'categories', label: 'Categories', icon: '📂' },
  { key: 'food-menu', label: 'Food Menu', icon: '🍽' },
  { key: 'file-maintenance', label: 'File Maintenance', icon: '🔧' },
];

const CMS_CHILDREN = [
  { key: 'media', label: 'Media', icon: '🖼' },
  { key: 'liveshelf', label: 'Live Shelf', icon: '📡' },
  { key: 'cake-catalogue', label: 'Cake Catalogue', icon: '🍰' },
  { key: 'blogs', label: 'Blog', icon: '✍' },
];

/*
  Desktop icon layout (grouped by section):

  Column 0 — FILES (x=16)          Column 1 — CMS (x=120)        Column 2 — Apps (x=224)
  ─────────────────────────         ──────────────────────         ─────────────────────────
  Categories                        Media                          CRM
  Food Menu                         Menu Sections                  POS
  File Maintenance                  Menu Generator                 KDS Display
                                    Live Shelf                     Cake Orders
                                    Blog                           Sales Report
                                                                   System Monitor
*/
const GROUP_DEFS = {
  // FILES group — col 0
  'categories': { col: 0, row: 0 },
  'food-menu': { col: 0, row: 1 },
  'file-maintenance': { col: 0, row: 2 },
  // CMS group — col 1
  'media': { col: 1, row: 0 },
  'liveshelf': { col: 1, row: 2 },
  'cake-catalogue': { col: 1, row: 3 },
  'blogs': { col: 1, row: 4 },
  // Apps — col 2 (no Dashboard)
  'crm': { col: 2, row: 0 },
  'pos': { col: 2, row: 1 },
  'kds': { col: 2, row: 2 },
  'cake-orders': { col: 2, row: 3 },
  'sales-report': { col: 2, row: 4 },
  'day-end': { col: 2, row: 5 },
  'system-monitor': { col: 2, row: 6 },
};
const COL_X = [16, 120, 224];
const ROW_Y0 = 40;   // y of first icon row (below group label)
const ROW_H = 94;   // height per icon row

/* ── localStorage persistence ─────────────────────────────────── */
const LS_POS = 'mtc_icon_positions_v4';
const LS_SHORTCUTS = 'mtc_shortcuts_v4';
const LS_WIN_STATE = 'mtc_win_state_v1';
const DRAG_THRESHOLD = 5;

function loadPositions() {
  try { return JSON.parse(localStorage.getItem(LS_POS)) ?? {}; } catch { return {}; }
}
function savePositions(p) { localStorage.setItem(LS_POS, JSON.stringify(p)); }

function loadWinStates() {
  try { return JSON.parse(localStorage.getItem(LS_WIN_STATE)) ?? {}; } catch { return {}; }
}
function saveWinStates(s) { localStorage.setItem(LS_WIN_STATE, JSON.stringify(s)); }

function loadShortcuts() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_SHORTCUTS));
    if (Array.isArray(s) && s.length) return s;
  } catch { }
  // Default: all apps visible, in logical order
  return [
    'categories', 'food-menu', 'file-maintenance',
    'media', 'liveshelf', 'cake-catalogue', 'blogs',
    'crm', 'pos', 'kds', 'cake-orders', 'sales-report', 'day-end', 'system-monitor',
  ];
}
function saveShortcuts(s) { localStorage.setItem(LS_SHORTCUTS, JSON.stringify(s)); }

function defaultPos(key) {
  const g = GROUP_DEFS[key];
  if (g) return { x: COL_X[g.col], y: ROW_Y0 + g.row * ROW_H };
  return { x: 16, y: 16 };
}

/* ── URL → app resolution ─────────────────────────────────────── */
const SUB_ROUTES = [
  { test: p => p === '/blogs/new', key: 'blogs', title: 'Blogs — New Post' },
  { test: p => p.startsWith('/blogs/edit/'), key: 'blogs', title: 'Blogs — Edit Post' },
];
function findApp(pathname) {
  const sub = SUB_ROUTES.find(r => r.test(pathname));
  if (sub) return { ...ALL_APPS.find(a => a.key === sub.key), title: sub.title };
  const exact = ALL_APPS.find(a => a.exact && pathname === a.path);
  if (exact) return exact;
  return ALL_APPS.filter(a => !a.exact && pathname.startsWith(a.path))
    .sort((a, b) => b.path.length - a.path.length)[0] ?? null;
}

let _zBase = 200;
const nextZ = () => ++_zBase;

function makeWindow(app, openCount, saved = null) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = saved?.w ?? Math.min(1120, vw - 60);
  const h = saved?.h ?? Math.min(710, vh - 80);
  const off = (openCount % 7) * 28;
  return {
    id: `${app.key}_${Date.now()}`,
    key: app.key,
    title: app.title ?? app.label,
    icon: app.icon,
    component: app.component,
    x: saved?.x ?? Math.max(20, Math.round((vw - w) / 2 + off - 60)),
    y: saved?.y ?? Math.max(48, Math.round((vh - h) / 2 + off - 30)),
    w, h,
    minimized: false,                       // never restore minimized
    maximized: saved?.maximized ?? false,
    zIndex: nextZ(),
  };
}

/* ═══════════════════════════════════════════════════════════════
   Sub-components
═══════════════════════════════════════════════════════════════ */

/* ── Draggable Desktop Icon ───────────────────────────────────── */
function DraggableIcon({ app, pos, isOpen, onOpen, onMove, onContextMenu }) {
  const startRef = useRef(null);
  const movedRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  function onMouseDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    movedRef.current = false;
    startRef.current = { mx: e.clientX, my: e.clientY, ix: pos.x, iy: pos.y };

    function onMouseMove(ev) {
      const dx = ev.clientX - startRef.current.mx;
      const dy = ev.clientY - startRef.current.my;
      if (!movedRef.current && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        movedRef.current = true;
        setDragging(true);
      }
      if (movedRef.current) {
        onMove(app.key,
          Math.max(0, startRef.current.ix + dx),
          Math.max(0, startRef.current.iy + dy),
        );
      }
    }

    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      setDragging(false);
      if (!movedRef.current) onOpen(app.key);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        zIndex: dragging ? 9000 : 20,
        cursor: dragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        opacity: dragging ? 0.7 : 1,
        transition: dragging ? 'none' : 'opacity 0.12s',
      }}
      onMouseDown={onMouseDown}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, app); }}
    >
      <IconTile app={app} isOpen={isOpen} />
    </div>
  );
}

/* ── Shared icon tile visual ─────────────────────────────────── */
function IconTile({ app, isOpen, size = 72 }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
        padding: '8px 10px', borderRadius: 10, width: 90,
        background: isOpen
          ? 'rgba(193,68,14,0.15)'
          : hover ? 'rgba(255,255,255,0.42)' : 'transparent',
        transition: 'background 0.12s, transform 0.1s',
        transform: hover ? 'translateY(-2px)' : 'none',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={{
        width: size, height: size, borderRadius: Math.round(size * 0.27),
        background: `linear-gradient(135deg, ${app.accent}1a 0%, ${app.accent}44 100%)`,
        border: `1.5px solid ${app.accent}55`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: Math.round(size * 0.5),
        boxShadow: hover
          ? `0 6px 18px ${app.accent}30`
          : `0 3px 9px ${app.accent}1a`,
        transition: 'box-shadow 0.15s',
      }}>
        {app.icon}
      </div>
      <span style={{
        fontSize: 10, fontWeight: 700, color: '#2a1f12',
        textShadow: '0 1px 4px rgba(255,255,255,0.9)',
        textAlign: 'center', lineHeight: 1.2,
        maxWidth: 82, wordBreak: 'break-word',
        letterSpacing: '0.02em',
      }}>{app.label}</span>
      {isOpen && (
        <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#c1440e', marginTop: -2 }} />
      )}
    </div>
  );
}

/* ── Right-click context menu ─────────────────────────────────── */
function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    function handle(e) { if (!ref.current?.contains(e.target)) onClose(); }
    const t = setTimeout(() => window.addEventListener('mousedown', handle), 30);
    return () => { clearTimeout(t); window.removeEventListener('mousedown', handle); };
  }, [onClose]);

  const clampX = Math.min(x, window.innerWidth - 190);
  const clampY = Math.min(y, window.innerHeight - items.length * 38 - 16);

  return (
    <div ref={ref} style={{
      position: 'fixed', left: clampX, top: clampY, zIndex: 99999,
      background: '#fdf9f4',
      border: '1px solid #a89880',
      borderRadius: 11,
      boxShadow: '0 10px 36px rgba(42,31,18,0.3), 0 1px 0 rgba(255,255,255,0.7) inset',
      padding: 5, minWidth: 176, overflow: 'hidden',
    }} onMouseDown={e => e.stopPropagation()}>
      {items.map((item, i) =>
        item.divider
          ? <div key={i} style={{ height: 1, background: '#c4b49c', margin: '4px 8px' }} />
          : (
            <button key={i} onClick={() => { item.action(); onClose(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: '100%', padding: '7px 11px',
                border: 'none', background: 'transparent', borderRadius: 7,
                cursor: 'pointer', fontSize: 12, fontWeight: 600,
                color: item.danger ? '#c0392b' : '#2a1f12',
                textAlign: 'left', transition: 'background 0.1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = item.danger ? 'rgba(192,57,43,0.08)' : 'rgba(193,68,14,0.08)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {item.icon && <span style={{ fontSize: 14, lineHeight: 1 }}>{item.icon}</span>}
              {item.label}
            </button>
          )
      )}
    </div>
  );
}

/* ── Shortcuts / Settings panel ──────────────────────────────── */
function ShortcutsPanel({ shortcuts, onToggle, onArrange, onClose }) {
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9990 }} onClick={onClose} />
      <div style={{
        position: 'fixed', right: 16, top: 46,
        width: 292, zIndex: 9991,
        background: '#fdf9f4',
        border: '1px solid #a89880', borderRadius: 14,
        boxShadow: '0 20px 60px rgba(42,31,18,0.38), 0 1px 0 rgba(255,255,255,0.7) inset',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        maxHeight: 'calc(100vh - 60px)',
      }} onClick={e => e.stopPropagation()}>

        {/* Chrome title bar */}
        <div style={{
          padding: '9px 14px',
          background: 'linear-gradient(180deg, #d2c6b2 0%, #b8a890 100%)',
          borderBottom: '1px solid #a89880',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', gap: 5 }}>
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57', border: '1px solid rgba(0,0,0,0.18)' }} />
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e', border: '1px solid rgba(0,0,0,0.18)' }} />
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840', border: '1px solid rgba(0,0,0,0.18)' }} />
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#4a3828', letterSpacing: '0.06em', textTransform: 'uppercase', textShadow: '0 1px 0 rgba(255,255,255,0.45)' }}>
            Desktop Shortcuts
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b5640', fontSize: 15, lineHeight: 1, fontWeight: 700, padding: 2 }}>✕</button>
        </div>

        {/* Hint */}
        <p style={{ fontSize: 10, color: '#9c8870', padding: '8px 14px 4px', margin: 0, lineHeight: 1.4 }}>
          Toggle which apps appear on the desktop. Positions are saved automatically.
        </p>

        {/* App list — grouped */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
          {[
            { header: '📂  Files', keys: ['categories', 'food-menu', 'file-maintenance'] },
            { header: '🌐  CMS', keys: ['media', 'liveshelf', 'cake-catalogue', 'blogs'] },
            { header: '⚡  Apps', keys: ['crm', 'pos', 'kds', 'cake-orders', 'system-monitor'] },
          ].map(group => (
            <div key={group.header}>
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.13em', textTransform: 'uppercase', color: '#9c8870', padding: '8px 8px 3px' }}>{group.header}</div>
              {group.keys.map(k => ALL_APPS.find(a => a.key === k)).filter(Boolean).map(app => {
                const active = shortcuts.includes(app.key);
                return (
                  <button key={app.key} onClick={() => onToggle(app.key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      width: '100%', padding: '8px 8px',
                      border: 'none', background: 'transparent', borderRadius: 9,
                      cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(193,68,14,0.07)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    {/* Icon tile */}
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: `linear-gradient(135deg, ${app.accent}1a, ${app.accent}44)`,
                      border: `1.5px solid ${app.accent}55`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 19,
                    }}>{app.icon}</div>

                    {/* Labels */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#2a1f12', lineHeight: 1 }}>{app.label}</div>
                      <div style={{ fontSize: 10, color: '#9c8870', marginTop: 2, lineHeight: 1.2 }}>{app.desc}</div>
                    </div>

                    {/* Toggle switch */}
                    <div style={{
                      width: 34, height: 19, borderRadius: 10, flexShrink: 0,
                      background: active ? '#c1440e' : 'rgba(160,144,128,0.3)',
                      position: 'relative', transition: 'background 0.22s',
                      boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.12)',
                    }}>
                      <div style={{
                        position: 'absolute', top: 2.5,
                        left: active ? 17 : 3,
                        width: 14, height: 14, borderRadius: '50%',
                        background: '#fff',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.22)',
                        transition: 'left 0.22s',
                      }} />
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer actions */}
        <div style={{ padding: '10px 12px', borderTop: '1px solid #c4b49c', display: 'flex', gap: 8, flexShrink: 0, background: 'rgba(255,255,255,0.4)' }}>
          <button onClick={onArrange} style={{
            flex: 1, padding: '8px', borderRadius: 8,
            border: '1px solid #c4b49c', background: 'rgba(255,255,255,0.7)',
            color: '#6b5640', fontSize: 11, fontWeight: 700, cursor: 'pointer',
            transition: 'background 0.1s',
          }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.95)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.7)'}
          >⊞ Auto-Arrange</button>
          <button onClick={onClose} style={{
            flex: 1, padding: '8px', borderRadius: 8,
            border: 'none', background: '#c1440e',
            color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer',
          }}>Done</button>
        </div>
      </div>
    </>
  );
}

/* ── Generic dark dropdown menu (Files ▾ and CMS ▾) ─────────── */
function MenuDropdown({ items, header, onOpen, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    function h(e) { if (!ref.current?.contains(e.target)) onClose(); }
    const t = setTimeout(() => window.addEventListener('mousedown', h), 30);
    return () => { clearTimeout(t); window.removeEventListener('mousedown', h); };
  }, [onClose]);

  return (
    <div ref={ref} style={{
      position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 9998,
      background: '#1c1208',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 10,
      boxShadow: '0 14px 44px rgba(0,0,0,0.55)',
      padding: 5, minWidth: 200,
    }} onMouseDown={e => e.stopPropagation()}>
      {header && (
        <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', padding: '5px 10px 3px' }}>
          {header}
        </div>
      )}
      {items.map(item => (
        <button key={item.key}
          onClick={() => { onOpen(item.key); onClose(); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 9,
            width: '100%', padding: '8px 10px',
            border: 'none', background: 'transparent', borderRadius: 7,
            cursor: 'pointer', fontSize: 12, fontWeight: 600,
            color: 'rgba(255,255,255,0.72)', textAlign: 'left',
            transition: 'background 0.1s, color 0.1s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.72)'; }}
        >
          <span style={{ fontSize: 15 }}>{item.icon}</span>
          {item.label}
        </button>
      ))}
    </div>
  );
}

/* ── Desktop group label (non-interactive) ───────────────────── */
function DesktopGroupLabel({ label, x, y }) {
  return (
    <div style={{
      position: 'absolute', left: x, top: y, zIndex: 15,
      pointerEvents: 'none', userSelect: 'none',
      fontSize: 9, fontWeight: 800, letterSpacing: '0.14em',
      textTransform: 'uppercase',
      color: 'rgba(42,31,18,0.5)',
      textShadow: '0 1px 4px rgba(255,255,255,0.95)',
      background: 'rgba(255,255,255,0.22)',
      padding: '2px 9px', borderRadius: 5,
      backdropFilter: 'blur(2px)',
    }}>
      {label}
    </div>
  );
}

/* ── App launcher dropdown ────────────────────────────────────── */
function AppLauncher({ onOpen, onManageShortcuts, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    function h(e) { if (!ref.current?.contains(e.target)) onClose(); }
    const t = setTimeout(() => window.addEventListener('mousedown', h), 30);
    return () => { clearTimeout(t); window.removeEventListener('mousedown', h); };
  }, [onClose]);

  return (
    <div ref={ref} style={{
      position: 'absolute', top: 'calc(100% + 5px)', left: 0, zIndex: 9997,
      width: 268,
      background: '#fdf9f4',
      border: '1px solid #a89880', borderRadius: 13,
      boxShadow: '0 16px 50px rgba(42,31,18,0.36)',
      padding: 6, overflow: 'hidden',
    }} onMouseDown={e => e.stopPropagation()}>
      <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#9c8870', padding: '5px 8px 3px', margin: 0 }}>
        All Applications
      </p>
      {ALL_APPS.map(app => (
        <button key={app.key} onClick={() => { onOpen(app.key); onClose(); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            width: '100%', padding: '8px 9px',
            border: 'none', background: 'transparent', borderRadius: 9,
            cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(193,68,14,0.07)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <div style={{
            width: 34, height: 34, borderRadius: 9, flexShrink: 0,
            background: `linear-gradient(135deg, ${app.accent}1a, ${app.accent}44)`,
            border: `1.5px solid ${app.accent}55`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19,
          }}>{app.icon}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#2a1f12' }}>{app.label}</div>
            <div style={{ fontSize: 10, color: '#9c8870' }}>{app.desc}</div>
          </div>
        </button>
      ))}
      <div style={{ height: 1, background: '#c4b49c', margin: '5px 8px' }} />
      <button onClick={() => { onManageShortcuts(); onClose(); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          width: '100%', padding: '8px 9px',
          border: 'none', background: 'transparent', borderRadius: 9,
          cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s',
          color: '#6b5640',
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(193,68,14,0.07)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <div style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(160,144,128,0.15)', border: '1.5px solid rgba(160,144,128,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19 }}>⊞</div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#2a1f12' }}>Manage Shortcuts</div>
          <div style={{ fontSize: 10, color: '#9c8870' }}>Customize desktop icons</div>
        </div>
      </button>
    </div>
  );
}

/* ── Taskbar chip ─────────────────────────────────────────────── */
function TaskbarChip({ win, onRestore }) {
  return (
    <button onClick={onRestore}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '3px 11px 3px 7px',
        borderRadius: 7,
        border: '1px solid rgba(160,144,128,0.3)',
        background: 'rgba(255,255,255,0.55)',
        cursor: 'pointer', fontSize: 11, fontWeight: 700,
        color: '#4a3828', transition: 'background 0.12s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.88)'}
      onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.55)'}
    >
      <span style={{ fontSize: 13 }}>{win.icon}</span>
      {win.title}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Main AdminLayout — Desktop OS
═══════════════════════════════════════════════════════════════ */
export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  /* ── Windows ──────────────────────────────────────────── */
  const [windows, setWindows] = useState([]);
  const openCountRef = useRef(0);
  const isFirstMount = useRef(true);   // skip auto-open on initial load
  const winStatesRef = useRef(loadWinStates());   // per-key saved geometry
  const saveTimerRef = useRef(null);

  /* ── Persisted desktop state ─────────────────────────── */
  const [iconPositions, setIconPositions] = useState(loadPositions);
  const [shortcuts, setShortcuts] = useState(loadShortcuts);

  /* ── UI state ─────────────────────────────────────────── */
  const [filesOpen, setFilesOpen] = useState(false);
  const [cmsOpen, setCmsOpen] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [shortcutsPanel, setShortcutsPanel] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [clock, setClock] = useState('');
  const [uiTheme, setUiTheme] = useState(getTheme);

  function handleThemeChange(theme) {
    setUiTheme(theme);
    saveTheme(theme);
  }

  /* Clock */
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClock(d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }));
    };
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  }, []);

  /* Listen for openShortcutsPanel event from Dashboard */
  useEffect(() => {
    function handleOpenShortcutsPanel() {
      setShortcutsPanel(true);
    }
    window.addEventListener('openShortcutsPanel', handleOpenShortcutsPanel);
    return () => window.removeEventListener('openShortcutsPanel', handleOpenShortcutsPanel);
  }, []);

  /* ── Persist window geometry (debounced 300 ms) ──────────── */
  useEffect(() => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      // Merge into accumulated state so closed windows aren't forgotten
      const states = { ...winStatesRef.current };
      windows.forEach(w => {
        if (w.key) states[w.key] = { x: w.x, y: w.y, w: w.w, h: w.h, maximized: w.maximized };
      });
      winStatesRef.current = states;
      saveWinStates(states);
    }, 300);
    return () => clearTimeout(saveTimerRef.current);
  }, [windows]);

  /* ── Global keyboard: double-ESC closes top window, F2 focuses search ──
     All mutable values are read through stateRef so the handler is registered
     exactly once ([] deps) — no TDZ risk from forward-declared useCallbacks.   */
  const lastEscRef = useRef(0);
  const stateRef = useRef({});

  /* URL → window sync  (skip on first mount — desktop starts empty) */
  useEffect(() => {
    if (isFirstMount.current) { isFirstMount.current = false; return; }
    const app = findApp(location.pathname);
    if (!app) return;
    setWindows(prev => {
      const existing = prev.find(w => w.key === app.key);
      if (existing) {
        return prev.map(w => w.key === app.key
          ? { ...w, minimized: false, zIndex: nextZ() }
          : w
        );
      }
      openCountRef.current += 1;
      return [...prev, makeWindow(app, openCountRef.current, winStatesRef.current[app.key] ?? null)];
    });
  }, [location.pathname]); // eslint-disable-line

  /* ── openApp ─────────────────────────────────────────── */
  const openApp = useCallback((key) => {
    const app = ALL_APPS.find(a => a.key === key);
    if (!app) return;
    // External launchers (POS, KDS) — navigate full-screen, no window
    if (app.external) { navigate(app.path); return; }
    setWindows(prev => {
      const existing = prev.find(w => w.key === key);
      if (existing) {
        return prev.map(w => w.key === key
          ? { ...w, minimized: false, zIndex: nextZ() }
          : w
        );
      }
      openCountRef.current += 1;
      return [...prev, makeWindow(app, openCountRef.current, winStatesRef.current[key] ?? null)];
    });
    navigate(app.path);
  }, [navigate]);

  /* ── Window actions ───────────────────────────────────── */
  const closeWindow = useCallback(id => setWindows(p => {
    const win = p.find(w => w.id === id);
    if (win?.key) {
      // Save geometry immediately so maximize state survives the close
      const updated = { ...winStatesRef.current, [win.key]: { x: win.x, y: win.y, w: win.w, h: win.h, maximized: win.maximized } };
      winStatesRef.current = updated;
      saveWinStates(updated);
    }
    return p.filter(w => w.id !== id);
  }), []);
  const minimizeWindow = useCallback(id => setWindows(p => p.map(w => w.id === id ? { ...w, minimized: true } : w)), []);
  const maximizeWindow = useCallback(id => setWindows(p => p.map(w => w.id === id ? { ...w, maximized: !w.maximized } : w)), []);
  const focusWindow = useCallback(id => {
    setWindows(p => {
      const w = p.find(x => x.id === id);
      if (!w) return p;
      const maxZv = Math.max(...p.map(x => x.zIndex));
      if (w.zIndex === maxZv) return p;
      return p.map(x => x.id === id ? { ...x, zIndex: nextZ() } : x);
    });
  }, []);
  const moveWindow = useCallback((id, x, y) => setWindows(p => p.map(w => w.id === id ? { ...w, x, y } : w)), []);
  const resizeWindow = useCallback((id, nw, nh) => setWindows(p => p.map(w => w.id === id ? { ...w, w: nw, h: nh } : w)), []);

  /* ── Icon operations ──────────────────────────────────── */
  const moveIcon = useCallback((key, x, y) => {
    setIconPositions(prev => {
      const next = { ...prev, [key]: { x, y } };
      savePositions(next);
      return next;
    });
  }, []);

  const toggleShortcut = useCallback((key) => {
    setShortcuts(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      saveShortcuts(next);
      return next;
    });
  }, []);

  const arrangeIcons = useCallback(() => {
    const arranged = shortcuts.reduce((acc, key) => { acc[key] = defaultPos(key); return acc; }, {});
    setIconPositions(arranged);
    savePositions(arranged);
  }, [shortcuts]);

  /* ── Live stateRef — updated every render AFTER all callbacks are defined ── */
  stateRef.current = {
    windows, filesOpen, cmsOpen, launcherOpen, shortcutsPanel, settingsOpen, contextMenu,
    closeWindow,          // stable useCallback — safe to store here
  };

  /* ── Global keyboard shortcuts (registered once on mount) ─────────────────
     Uses stateRef for live access; no deps needed — everything is stable/ref. */
  useEffect(() => {
    const ESC_DOUBLE_MS = 420;

    function onKey(e) {
      const s = stateRef.current;

      /* F2 — focus the search / filter input inside the focused window */
      if (e.key === 'F2') {
        e.preventDefault();
        const topWin = [...s.windows]
          .filter(w => !w.minimized)
          .sort((a, b) => b.zIndex - a.zIndex)[0];
        if (!topWin) return;
        const winEl = document.querySelector(`[data-win-id="${topWin.id}"]`);
        if (!winEl) return;
        const inp = winEl.querySelector(
          'input[type="search"], ' +
          'input[placeholder*="earch" i], ' +
          'input[placeholder*="ilter" i], ' +
          'input[placeholder*="ind" i]'
        );
        if (inp) { inp.focus(); inp.select(); }
        return;
      }

      /* ESC: first press closes any open overlay
              second press within 420 ms closes the top window */
      if (e.key === 'Escape') {
        const hasOverlay = s.filesOpen || s.cmsOpen || s.launcherOpen
          || s.shortcutsPanel || s.settingsOpen || s.contextMenu;
        if (hasOverlay) {
          setFilesOpen(false);
          setCmsOpen(false);
          setLauncherOpen(false);
          setShortcutsPanel(false);
          setSettingsOpen(false);
          setContextMenu(null);
          lastEscRef.current = 0;
          return;
        }

        const now = Date.now();
        if (now - lastEscRef.current < ESC_DOUBLE_MS) {
          const topWin = [...s.windows]
            .filter(w => !w.minimized)
            .sort((a, b) => b.zIndex - a.zIndex)[0];
          if (topWin) s.closeWindow(topWin.id);
          lastEscRef.current = 0;
        } else {
          lastEscRef.current = now;
        }
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // [] — all live values accessed via stateRef

  /* ── Context menus ────────────────────────────────────── */
  function handleDesktopContextMenu(e) {
    e.preventDefault();
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { icon: '⊞', label: 'Add / Remove Shortcuts', action: () => setShortcutsPanel(true) },
        { icon: '⊟', label: 'Auto-Arrange Icons', action: arrangeIcons },
      ],
    });
  }

  function handleIconContextMenu(e, app) {
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { icon: app.icon, label: `Open ${app.label}`, action: () => openApp(app.key) },
        { divider: true },
        { icon: '🗑', label: 'Remove Shortcut', danger: true, action: () => toggleShortcut(app.key) },
      ],
    });
  }

  function getIconPos(key) {
    return iconPositions[key] ?? defaultPos(key);
  }

  const maxZ = windows.length > 0 ? Math.max(...windows.map(w => w.zIndex)) : 0;
  const minimized = windows.filter(w => w.minimized);
  const visible = windows.filter(w => !w.minimized);
  const visibleKeys = shortcuts.filter(k => ALL_APPS.find(a => a.key === k));

  /* ────────────────── RENDER ─────────────────────────────── */
  return (
    <div
      className="desktop-root"
      data-theme={uiTheme}
      onContextMenu={handleDesktopContextMenu}
      onClick={() => { setFilesOpen(false); setCmsOpen(false); setLauncherOpen(false); setSettingsOpen(false); }}
    >
      {/* ╔═══════════════════════════════════════╗
          ║           OS MENU BAR                 ║
          ╚═══════════════════════════════════════╝ */}
      <div className="os-menubar" onClick={e => e.stopPropagation()}>

        {/* Brand / App Launcher */}
        <div style={{ position: 'relative', marginRight: 4 }}>
          <button
            className="os-menubar__brand"
            onClick={() => { setLauncherOpen(v => !v); setCmsOpen(false); }}
          >
            <span>🍴</span>
            <span>MTC Studio</span>
          </button>
          {launcherOpen && (
            <AppLauncher
              onOpen={openApp}
              onManageShortcuts={() => setShortcutsPanel(true)}
              onClose={() => setLauncherOpen(false)}
            />
          )}
        </div>

        {/* Separator */}
        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.12)', margin: '0 6px' }} />

        {/* Files ▾ dropdown — Categories, Food Menu, File Maintenance */}
        <div style={{ position: 'relative' }}>
          <button
            className="os-menubar__nav-item"
            style={filesOpen ? { color: '#f8d8a0', background: 'rgba(255,255,255,0.1)' }
              : FILES_CHILDREN.some(c => windows.some(w => w.key === c.key)) ? { color: '#f8d8a0' } : {}}
            onClick={() => { setFilesOpen(v => !v); setCmsOpen(false); setLauncherOpen(false); }}
          >
            Files <span style={{ fontSize: 8, marginLeft: 3, opacity: 0.65 }}>▾</span>
          </button>
          {filesOpen && (
            <MenuDropdown
              header="File Management"
              items={FILES_CHILDREN}
              onOpen={openApp}
              onClose={() => setFilesOpen(false)}
            />
          )}
        </div>

        {/* CMS ▾ dropdown — Media, Menu Sections, Menu Generator, Live Shelf, Blog */}
        <div style={{ position: 'relative' }}>
          <button
            className="os-menubar__nav-item"
            style={cmsOpen ? { color: '#f8d8a0', background: 'rgba(255,255,255,0.1)' }
              : CMS_CHILDREN.some(c => windows.some(w => w.key === c.key)) ? { color: '#f8d8a0' } : {}}
            onClick={() => { setCmsOpen(v => !v); setFilesOpen(false); setLauncherOpen(false); }}
          >
            CMS <span style={{ fontSize: 8, marginLeft: 3, opacity: 0.65 }}>▾</span>
          </button>
          {cmsOpen && (
            <MenuDropdown
              header="Content Management"
              items={CMS_CHILDREN}
              onOpen={openApp}
              onClose={() => setCmsOpen(false)}
            />
          )}
        </div>

        <div style={{ flex: 1 }} />

        {/* POS / KDS quick launchers */}
        <button className="os-menubar__shortcut" onClick={() => navigate('/pos')} title="Launch POS — Order Management">🖥 POS</button>
        <button className="os-menubar__shortcut" onClick={() => navigate('/kds')} title="Launch KDS — Kitchen Display">📺 KDS</button>

        {/* Shortcut manager button */}
        <button
          className="os-menubar__shortcut"
          style={{ marginLeft: 4 }}
          onClick={e => { e.stopPropagation(); setShortcutsPanel(v => !v); setSettingsOpen(false); }}
          title="Desktop Shortcuts"
        >⊞</button>

        {/* Server settings button */}
        <button
          className="os-menubar__shortcut"
          style={{ marginLeft: 2 }}
          onClick={e => { e.stopPropagation(); setSettingsOpen(v => !v); setShortcutsPanel(false); }}
          title="Server Settings"
        >⚙</button>

        {/* Clock */}
        <span className="os-menubar__clock">{clock}</span>
      </div>

      {/* ╔═══════════════════════════════════════╗
          ║           DESKTOP AREA                ║
          ╚═══════════════════════════════════════╝ */}
      <div className="desktop-area">

        {/* Desktop group labels */}
        {visibleKeys.some(k => ['categories', 'food-menu', 'file-maintenance'].includes(k)) && (
          <DesktopGroupLabel label="Files" x={COL_X[0] + 4} y={12} />
        )}
        {visibleKeys.some(k => ['media', 'liveshelf', 'cake-catalogue', 'blogs'].includes(k)) && (
          <DesktopGroupLabel label="CMS" x={COL_X[1] + 4} y={12} />
        )}
        {visibleKeys.some(k => ['crm', 'pos', 'kds', 'cake-orders'].includes(k)) && (
          <DesktopGroupLabel label="Apps" x={COL_X[2] + 4} y={12} />
        )}

        {/* Freely-draggable desktop icons */}
        {visibleKeys.map((key) => {
          const app = ALL_APPS.find(a => a.key === key);
          if (!app) return null;
          return (
            <DraggableIcon
              key={key}
              app={app}
              pos={getIconPos(key)}
              isOpen={!app.external && windows.some(w => w.key === key)}
              onOpen={openApp}
              onMove={moveIcon}
              onContextMenu={handleIconContextMenu}
            />
          );
        })}

        {/* Open windows */}
        {visible.map(win => (
          <DesktopWindow
            key={win.id}
            win={win}
            isFocused={win.zIndex === maxZ}
            onClose={closeWindow}
            onMinimize={minimizeWindow}
            onMaximize={maximizeWindow}
            onFocus={() => focusWindow(win.id)}
            onMove={moveWindow}
            onResize={resizeWindow}
          >
            <win.component />
          </DesktopWindow>
        ))}

        {/* Welcome hint — shown only when no windows are open */}
        {visible.length === 0 && (
          <div className="desktop-hint">
            <div style={{ fontSize: 52, marginBottom: 14 }}>🍴</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#6b5640', marginBottom: 6 }}>MTC Studio</div>
            {visibleKeys.length > 0
              ? <div style={{ fontSize: 12, color: '#9c8870' }}>Double-click a desktop icon to open a module</div>
              : <div style={{ fontSize: 12, color: '#9c8870' }}>Right-click the desktop → Add Shortcuts to get started</div>
            }
          </div>
        )}
      </div>

      {/* ╔═══════════════════════════════════════╗
          ║           TASKBAR (minimized)         ║
          ╚═══════════════════════════════════════╝ */}
      {minimized.length > 0 && (
        <div className="os-taskbar">
          <span className="os-taskbar__label">Minimized</span>
          {minimized.map(win => (
            <TaskbarChip key={win.id} win={win} onRestore={() => {
              setWindows(prev => prev.map(w =>
                w.id === win.id ? { ...w, minimized: false, zIndex: nextZ() } : w
              ));
            }} />
          ))}
        </div>
      )}

      {/* ── Context menu ─────────────────────────────────── */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* ── Shortcuts panel ──────────────────────────────── */}
      {shortcutsPanel && (
        <ShortcutsPanel
          shortcuts={shortcuts}
          onToggle={toggleShortcut}
          onArrange={arrangeIcons}
          onClose={() => setShortcutsPanel(false)}
        />
      )}

      {/* ── Server Settings panel ────────────────────────── */}
      {settingsOpen && (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          uiTheme={uiTheme}
          onThemeChange={handleThemeChange}
        />
      )}
    </div>
  );
}
