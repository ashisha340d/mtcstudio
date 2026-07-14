import { createPortal } from 'react-dom';
import CustomerPicker from './CustomerPicker';

/** CustomerPicker wrapped in a modal — pick/quick-add, then onSelect fires and closes. */
export default function CustomerPickerModal({ title = '👤 Customer', onSelect, onClose }) {
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
        <div className="modal__title">{title}</div>
        <CustomerPicker onSelect={(c) => { onSelect(c); onClose(); }} />
        <div className="modal__actions" style={{ marginTop: 4 }}>
          <button className="modal__btn modal__btn--cancel" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
