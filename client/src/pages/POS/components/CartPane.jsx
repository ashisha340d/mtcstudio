import { useState } from 'react';
import { usePOS } from '../../../context/POSContext';

function NotesModal({ item, onSave, onClose }) {
  const [text, setText] = useState(item.notes || '');
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__title">Notes — {item.name}</div>
        <textarea
          className="modal__input"
          rows={3}
          placeholder="e.g. No onion, extra spicy…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <div className="modal__actions">
          <button className="modal__btn modal__btn--cancel" onClick={onClose}>Cancel</button>
          <button className="modal__btn modal__btn--confirm" onClick={() => { onSave(text); onClose(); }}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CartPane() {
  const {
    cart, cartTotal, kotsByOrder,
    updateCartItem, removeFromCart,
  } = usePOS();

  const [notesFor, setNotesFor] = useState(null);

  const existingKots = (kotsByOrder[cart.orderId] || []);

  function typeBadgeColor(type) {
    const map = {
      DINE_IN: 'var(--green)', TAKEAWAY: 'var(--cyan)',
      DELIVERY: 'var(--blue)', CAKE_ORDER: 'var(--purple)', QUICK_SALE: 'var(--yellow)',
    };
    return map[type] || 'var(--text-2)';
  }

  return (
    <div className="cart-pane">
      <div className="cart-pane__header">
        <span className="cart-pane__title">Cart</span>
        {cart.orderType && (
          <span
            className="cart-pane__type-badge"
            style={{ color: typeBadgeColor(cart.orderType), borderColor: typeBadgeColor(cart.orderType), border: '1px solid' }}
          >
            {cart.orderType.replace('_', ' ')}
          </span>
        )}
      </div>

      <div className="cart-pane__items">
        {cart.items.length === 0 ? (
          <div className="cart-pane__empty">empty</div>
        ) : (
          cart.items.map((item) => (
            <div className="cart-item" key={item.tempId}>
              <span className="cart-item__name">
                {item.isHomePack && <span className="cart-item__hp">HP</span>}
                {item.name}
              </span>
              {item.notes && (
                <span className="cart-item__notes">"{item.notes}"</span>
              )}
              <div className="cart-item__controls">
                <button
                  className="qty-btn"
                  onClick={() =>
                    item.qty > 1
                      ? updateCartItem(item.tempId, { qty: item.qty - 1 })
                      : removeFromCart(item.tempId)
                  }
                >−</button>
                <span className="qty-display">{item.qty}</span>
                <button
                  className="qty-btn"
                  onClick={() => updateCartItem(item.tempId, { qty: item.qty + 1 })}
                >+</button>
              </div>

              <span className="cart-item__price">
                ₹{(item.price * item.qty).toFixed(0)}
              </span>

              <div className="cart-item__actions">
                <button
                  className={`cart-item__tag-btn ${item.isHomePack ? 'cart-item__tag-btn--active-hp' : ''}`}
                  onClick={() => updateCartItem(item.tempId, { isHomePack: !item.isHomePack })}
                >HP</button>
                <button
                  className={`cart-item__tag-btn ${item.notes ? 'cart-item__tag-btn--active-notes' : ''}`}
                  onClick={() => setNotesFor(item)}
                >✎</button>
                <button
                  className="cart-item__del-btn"
                  onClick={() => removeFromCart(item.tempId)}
                >×</button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* KOT history strip */}
      {existingKots.length > 0 && (
        <div className="kot-strip">
          <div className="kot-strip__label">Previous KOTs</div>
          {existingKots.map((k) => (
            <div className="kot-chip" key={k.id}>
              <span className="kot-chip__num">KOT #{k.kot_number}</span>
              <span className={`kot-chip__status--${k.status}`}>{k.status}</span>
            </div>
          ))}
        </div>
      )}

      <div className="cart-pane__footer">
        <div className="cart-total-row">
          <span className="cart-total-label">TOTAL</span>
          <span className="cart-total-value">₹{cartTotal.toFixed(0)}</span>
        </div>
      </div>

      {notesFor && (
        <NotesModal
          item={notesFor}
          onSave={(text) => updateCartItem(notesFor.tempId, { notes: text || null })}
          onClose={() => setNotesFor(null)}
        />
      )}
    </div>
  );
}
