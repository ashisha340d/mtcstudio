import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { getTheme } from './utils/themeConfig';
import AdminLayout from './layouts/AdminLayout';
import Dashboard from './pages/Dashboard/Dashboard';
import SalesReport from './pages/SalesReport/SalesReport';
import DayEnd from './pages/DayEnd/DayEnd';
import Categories from './pages/Categories/Categories';
import FoodMenu   from './pages/FoodMenu/FoodMenu';
import Media from './pages/Media/Media';
import Blogs from './pages/Blogs/Blogs';
import BlogNew from './pages/Blogs/BlogNew';
import BlogEdit from './pages/Blogs/BlogEdit';
import LiveShelf        from './pages/LiveShelf/LiveShelf';
import CakeCatalogue    from './pages/CakeCatalogue/CakeCatalogue';
import FileMaintenance       from './pages/FileMaintenance/FileMaintenance';
import ModifierAssignment   from './pages/ModifierAssignment/ModifierAssignment';
import CRM                  from './pages/CRM/CRM';
import Automation            from './pages/Automation/Automation';

// ── POS / KDS / Auth ─────────────────────────────────────────
import { AuthProvider, useAuth } from './context/AuthContext';
import { POSProvider }          from './context/POSContext';
import { KDSProvider }          from './context/KDSContext';
import AuthGate                 from './components/AuthGate';
import KDSAuthGate              from './components/KDSAuthGate';
import posApi                   from './services/posApi';
import POSDashboard  from './pages/POS/POSDashboard';
import POS           from './pages/POS/POS';
import KDSDisplay    from './pages/KDS/KDSDisplay';
import CakeOrders    from './pages/CakeOrders/CakeOrders';
import CakeOrderForm from './pages/CakeOrders/CakeOrderForm';
import WaiterApp     from './pages/Waiter/WaiterApp';
import CustomerMenu  from './pages/CustomerMenu';


// Inner wrapper reads auth AFTER AuthProvider is mounted
function POSKDSRoot({ children }) {
  const { user } = useAuth();
  return (
    <POSProvider apiService={posApi} activeUser={user}>
      <KDSProvider apiService={posApi}>
        {children}
      </KDSProvider>
    </POSProvider>
  );
}

function POSRoot({ children }) {
  useEffect(() => {
    document.documentElement.dataset.uiTheme = getTheme();
    return () => { delete document.documentElement.dataset.uiTheme; };
  }, []);
  return (
    <AuthProvider apiService={posApi}>
      <AuthGate>
        <POSKDSRoot>{children}</POSKDSRoot>
      </AuthGate>
    </AuthProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
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
          <Route path="categories" element={<Categories />} />
          <Route path="food-menu"    element={<FoodMenu />} />          
          <Route path="products" element={<Navigate to="/food-menu" replace />} />
          <Route path="products/*" element={<Navigate to="/food-menu" replace />} />
          <Route path="media" element={<Media />} />
          <Route path="blogs" element={<Blogs />} />
          <Route path="blogs/new" element={<BlogNew />} />
          <Route path="blogs/edit/:id" element={<BlogEdit />} />
          <Route path="liveshelf" element={<LiveShelf />} />
          <Route path="cake-catalogue" element={<CakeCatalogue />} />
          <Route path="file-maintenance"      element={<FileMaintenance />} />
          <Route path="modifier-assignment"   element={<ModifierAssignment />} />
          <Route path="crm"                   element={<CRM />} />
          <Route path="automation"            element={<Automation />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
