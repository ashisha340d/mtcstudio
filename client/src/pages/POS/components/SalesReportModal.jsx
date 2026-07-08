import SalesReport from '../../SalesReport/SalesReport';

export default function SalesReportModal({ onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ position: 'relative', maxWidth: 1100, width: '95vw', maxHeight: '92vh', padding: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{ position: 'absolute', top: 8, right: 10, zIndex: 1, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#4a3828' }}
        >
          ✕
        </button>
        <div style={{ height: '92vh', maxHeight: '92vh' }}>
          <SalesReport />
        </div>
      </div>
    </div>
  );
}
