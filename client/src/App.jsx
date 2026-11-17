import { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { getTheme } from './utils/themeConfig';

// ── Admin CMS — lazy chunks so POS terminals never download them upfront ──
const AdminLayout        = lazy(() => import('./layouts/AdminLayout'));
const Dashboard          = lazy(() => import('./pages/Dashboard/Dashboard'));
const SalesReport        = lazy(() => import('./pages/SalesReport/SalesReport'));
const DayEnd             = lazy(() => import('./pages/DayEnd/DayEnd'));
const Reports            = lazy(() => import('./pages/Reports/Reports'));
const FoodMenu           = lazy(() => import('./pages/FoodMenu/FoodMenu'));
const Media              = lazy(() => import('./pages/Media/Media'));
const Blogs              = lazy(() => import('./pages/Blogs/Blogs'));
const BlogNew            = lazy(() => import('./pages/Blogs/BlogNew'));
const BlogEdit           = lazy(() => import('./pages/Blogs/BlogEdit'));
const CakeCatalogue      = lazy(() => import('./pages/CakeCatalogue/CakeCatalogue'));
const FileMaintenance    = lazy(() => import('./pages/FileMaintenance/FileMaintenance'));
const ModifierAssignment = lazy(() => import('./pages/ModifierAssignment/ModifierAssignment'));
const CRM                = lazy(() => import('./pages/CRM/CRM'));
const Automation         = lazy(() => import('./pages/Automation/Automation'));
const Campaigns          = lazy(() => import('./pages/Campaigns/Campaigns'));
const HR                 = lazy(() => import('./pages/HR/HR'));

// ── POS / KDS / Auth ─────────────────────────────────────────
import { AuthProvider, useAuth } from './context/AuthContext';
import { POSProvider, prefetchPOSData } from './context/POSContext';
import { initMenuStore } from './stores/menuStore';
import { KDSProvider }          from './context/KDSContext';
import AuthGate                 from './components/AuthGate';
import KDSAuthGate              from './components/KDSAuthGate';
import posApi                   from './services/posApi';
import POSDashboard  from './pages/POS/POSDashboard';
import WebOrderDock  from './pages/POS/components/WebOrderDock';
import IncomingCallDock from './pages/POS/components/IncomingCallDock';
import FonepayDrawer from './components/FonepayDrawer';
import POS           from './pages/POS/POS';

// Secondary POS-adjacent screens — lazy, idle-prefetched from the dashboard
const KDSDisplay    = lazy(() => import('./pages/KDS/KDSDisplay'));
const CakeOrders    = lazy(() => import('./pages/CakeOrders/CakeOrders'));
const CakeOrderForm = lazy(() => import('./pages/CakeOrders/CakeOrderForm'));
const WaiterApp     = lazy(() => import('./pages/Waiter/WaiterApp'));
const CashClosing   = lazy(() => import('./pages/POS/CashClosing'));
const CustomerMenu  = lazy(() => import('./pages/CustomerMenu'));


// Inner wrapper reads auth AFTER AuthProvider is mounted
function POSKDSRoot({ children }) {
  const { user } = useAuth();
  return (
    <POSProvider apiService={posApi} activeUser={user}>
      {children}
    </POSProvider>
  );
}

function POSRoot({ children }) {
  useEffect(() => {
    document.documentElement.dataset.uiTheme = getTheme();
    return () => { delete document.documentElement.dataset.uiTheme; };
  }, []);
  // Warm master data + active orders while the boot splash / PIN screen shows
  useEffect(() => { prefetchPOSData(posApi); initMenuStore(); }, []);
  return (
    <AuthProvider apiService={posApi}>
      <AuthGate>
        <POSKDSRoot>
          {children}
          <WebOrderDock />
          <IncomingCallDock />
        </POSKDSRoot>
      </AuthGate>
    </AuthProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div style={{ height: '100vh', background: 'var(--desktop-bg, #ddd5c4)' }} />}>
      <Routes>
        {/* ── Customer QR ordering (no auth, public) ── */}
        <Route path="/menu/:tableId" element={<CustomerMenu />} />
        <Route path="/menu"          element={<CustomerMenu />} />

        {/* ── Waiter PWA (standalone, own auth) ── */}
        <Route path="/waiter/*" element={<WaiterApp />} />

        {/* ── POS & KDS (full-screen, no admin chrome) ── */}
        <Route
          path="/pos/*"
          element={
            <POSRoot>
              <Routes>
                <Route index element={<POSDashboard />} />
                <Route path="entry" element={<POS />} />
                <Route path="cash-closing" element={<CashClosing />} />
                <Route path="cake" element={<CakeOrders />} />
                <Route path="cake/new" element={<CakeOrderForm />} />
                <Route path="cake/:id" element={<CakeOrderForm />} />
              </Routes>
            </POSRoot>
          }
        />
        <Route
          path="/kds"
          element={
            <KDSAuthGate>
              <KDSProvider apiService={posApi}>
                <KDSDisplay />
              </KDSProvider>
            </KDSAuthGate>
          }
        />
        <Route path="/pos2" element={<POS />} />

        {/* ── Admin CMS ── */}
        <Route path="/" element={<AdminLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="sales-report" element={<SalesReport />} />
          <Route path="day-end" element={<DayEnd />} />
          <Route path="reports" element={<Reports />} />
          <Route path="categories" element={<Navigate to="/food-menu" replace />} />
          <Route path="food-menu"    element={<FoodMenu />} />
          <Route path="products" element={<Navigate to="/food-menu" replace />} />
          <Route path="products/*" element={<Navigate to="/food-menu" replace />} />
          <Route path="media" element={<Media />} />
          <Route path="blogs" element={<Blogs />} />
          <Route path="blogs/new" element={<BlogNew />} />
          <Route path="blogs/edit/:id" element={<BlogEdit />} />
          <Route path="liveshelf" element={<Navigate to="/food-menu" replace />} />
          <Route path="cake-catalogue" element={<CakeCatalogue />} />
          <Route path="file-maintenance"      element={<FileMaintenance />} />
          <Route path="modifier-assignment"   element={<ModifierAssignment />} />
          <Route path="crm"                   element={<CRM />} />
          <Route path="automation"            element={<Automation />} />
          <Route path="campaigns"             element={<Campaigns />} />
          <Route path="hr"                    element={<HR />} />
          <Route path="payroll"               element={<Navigate to="/hr" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      </Suspense>
      <FonepayDrawer />
    </BrowserRouter>
  );
}
