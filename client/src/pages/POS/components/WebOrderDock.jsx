import { useNavigate, useLocation } from 'react-router';
import { usePOS } from '../../../context/POSContext';
import '../pos.css';

// Docked to the right on every /pos/* screen (dashboard, order entry, cake…) so
// an arrived web/QR order stays visible no matter what the cashier is looking
// at. Cards are NOT dismissible — they only clear once approved or rejected.
export default function WebOrderDock() {
  const { webOrderQueue, requestShowWebOrders } = usePOS();
  const navigate = useNavigate();
  const location = useLocation();

  if (webOrderQueue.length === 0) return null;

  function review() {
    requestShowWebOrders();
    if (location.pathname !== '/pos') navigate('/pos');
  }

  return (
    <div className="wo-dock">
      {[...webOrderQueue].reverse().map(o => (
        <div key={o._dockId} className="wo-dock__card">
          <span className="wo-dock__title">{o.tableName ? '📱 Customer QR Order Arrived' : '🌐 Web Order Arrived'}</span>
          <p className="wo-dock__line">
            <strong>{o.orderNumber}</strong> · {o.orderType}
          </p>
          <p className="wo-dock__line">
            {o.tableName ? `Table ${o.tableName}` : (o.customerName || 'Customer')}
            {(!o.tableName || o.customerPhone) && <> · 📞 {o.customerPhone || '—'}</>}
          </p>
          <p className="wo-dock__line">
            {o.itemCount} item(s) · <strong>Rs {Number(o.grandTotal || 0).toLocaleString('en-IN')}</strong>
          </p>
          <button className="wo-dock__review" onClick={review}>Review Now</button>
        </div>
      ))}
    </div>
  );
}
