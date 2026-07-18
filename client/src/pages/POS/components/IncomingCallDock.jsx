import { useNavigate, useLocation } from 'react-router';
import { usePOS, ORDER_TYPE } from '../../../context/POSContext';
import '../pos.css';

// Docked to the right on every /pos/* screen — caller-ID card the moment MTC
// Companion reports a ringing phone. Three states mirror the CRM record:
//   • has open order today  → green  "Order Exists"
//   • known / past customer → blue   "Returning Customer"
//   • no record             → orange "New Customer"
export default function IncomingCallDock() {
  const { incomingCallQueue, dismissIncomingCall } = usePOS();
  const navigate = useNavigate();
  const location = useLocation();

  if (incomingCallQueue.length === 0) return null;

  return (
    <div className="wo-dock">
      {[...incomingCallQueue].reverse().map(c => (
        <CallCard key={c._dockId} c={c}
          navigate={navigate} location={location}
          onDismiss={() => dismissIncomingCall(c._dockId)} />
      ))}
    </div>
  );
}

function CallCard({ c, navigate, location, onDismiss }) {
  const name  = c.customer?.name || null;
  const phone = c.phone;
  const pending = c.pendingOrders?.length > 0 ? c.pendingOrders[0] : null;
  const known   = !!(c.customer || (c.orderCount ?? 0) > 0);
  const state   = pending ? 'exists' : known ? 'returning' : 'new';

  function startOrder(orderType) {
    onDismiss();
    navigate('/pos/entry', {
      // New customer → phone only, no saved name (record isn't kept).
      state: { orderType, customerName: state === 'new' ? null : name, customerPhone: phone },
    });
  }
  function viewInPos() {
    onDismiss();
    if (location.pathname !== '/pos') navigate('/pos');
  }

  const head = {
    exists:    { cls: 'icd--green',  label: '☎️ Customer Calling…' },
    returning: { cls: 'icd--blue',   label: '☎️ Customer Calling…' },
    new:       { cls: 'icd--orange', label: '☎️ New Customer Calling…' },
  }[state];

  return (
    <div className={`wo-dock__card icd ${head.cls}`}>
      <button className="icd__x" onClick={onDismiss} aria-label="Dismiss">✕</button>
      <span className="wo-dock__title">
        {c._answered ? '📞 On Call' : head.label}
      </span>

      <p className="icd__name">
        <strong>{name || 'Unknown Caller'}</strong>
        {c.loyalty?.vip && <span className="icd__vip">VIP</span>}
      </p>
      <p className="wo-dock__line">📞 {phone}</p>

      {state === 'exists' && (
        <>
          {c.lastOrder && (
            <p className="wo-dock__line">
              Last Order: Rs {Number(c.lastOrder.total_amount || 0).toLocaleString('en-IN')} · {new Date(c.lastOrder.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
          <div className="icd__open">
            <span>OPEN ORDER · <strong>Rs {Number(pending.total_amount || 0).toLocaleString('en-IN')}</strong></span>
            <button className="icd__link" onClick={viewInPos}>View in POS</button>
          </div>
        </>
      )}

      {state === 'returning' && (
        <>
          <p className="wo-dock__line">Looks like a returning customer!</p>
          {c.loyalty && (
            <p className="wo-dock__line">
              🎁 {c.loyalty.loyalty_points} pts · {c.loyalty.rewards_tier}
            </p>
          )}
          {c.cakeBalance > 0 && (
            <p className="wo-dock__line">⚠️ Cake balance due: Rs {Number(c.cakeBalance).toLocaleString('en-IN')}</p>
          )}
          {(c.orderCount ?? 0) > 0 && (
            <p className="wo-dock__line">{c.orderCount} past order(s)</p>
          )}
        </>
      )}

      {state === 'new' && (
        <>
          <p className="wo-dock__line">Let's create a new order</p>
          <p className="wo-dock__line icd__muted">We won't save details. Only the phone number is used for this order.</p>
        </>
      )}

      {c.cakeOrdersToday?.length > 0 && (
        <p className="wo-dock__line">🎂 {c.cakeOrdersToday.length} cake order(s) today</p>
      )}

      <div className="icd__actions">
        <button className="icd__btn icd__btn--ghost" onClick={() => startOrder(ORDER_TYPE.TAKEAWAY)}>+ New Take Order</button>
        <button className="icd__btn icd__btn--solid" onClick={() => startOrder(ORDER_TYPE.DELIVERY)}>🛵 Make Delivery</button>
      </div>
    </div>
  );
}
