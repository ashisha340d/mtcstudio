import { createPortal } from 'react-dom';
import CustomerPicker from './CustomerPicker';

/** CustomerPicker wrapped in a modal — pick/quick-add, then onSelect fires and closes. */
export default function CustomerPickerModal({ title = '👤 Customer', showClear = false, onSelect, onClear, onClose }) {
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <div className="modal__title">{title}</div>
        <CustomerPicker onSelect={(c) => { onSelect(c); onClose(); }} />
        <div className="modal__actions" style={{ marginTop: 4 }}>
          <button className="modal__btn modal__btn--cancel" onClick={onClose}>Cancel</button>
          {showClear && (
            <button className="modal__btn modal__btn--cancel" onClick={() => { onClear(); onClose(); }}>
              ✕ No Customer
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
