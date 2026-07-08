import { useRef, useState } from 'react';
import SalesReport from '../../SalesReport/SalesReport';

const SIZE_KEY = 'salesReportModal.size';
const MIN_SIZE = { width: 640, height: 400 };

function loadSize() {
  try {
    return JSON.parse(localStorage.getItem(SIZE_KEY)) || null;
  } catch {
    return null;
  }
}

export default function SalesReportModal({ onClose }) {
  const [size, setSize] = useState(loadSize);
  const modalRef = useRef(null);

  const startResize = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = modalRef.current.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = rect.width;
    const startHeight = rect.height;
    const onMove = (moveEvent) => {
      const newWidth = Math.min(window.innerWidth * 0.98, Math.max(MIN_SIZE.width, startWidth + (moveEvent.clientX - startX)));
      const newHeight = Math.min(window.innerHeight * 0.98, Math.max(MIN_SIZE.height, startHeight + (moveEvent.clientY - startY)));
      setSize({ width: newWidth, height: newHeight });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setSize(prev => {
        localStorage.setItem(SIZE_KEY, JSON.stringify(prev));
        return prev;
      });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal"
        style={size
          ? { position: 'relative', width: size.width, height: size.height, maxWidth: '98vw', maxHeight: '98vh', padding: 0 }
          : { position: 'relative', maxWidth: 1100, width: '95vw', maxHeight: '92vh', padding: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{ position: 'absolute', top: 8, right: 10, zIndex: 1, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#4a3828' }}
        >
          ✕
        </button>
        <div style={{ height: '100%' }}>
          <SalesReport gridLines={true} />
        </div>
        <div
          onMouseDown={startResize}
          aria-label="Resize modal"
          title="Drag to resize"
          style={{ position: 'absolute', right: 2, bottom: 2, width: 16, height: 16, cursor: 'nwse-resize', zIndex: 2 }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path d="M14 2 L2 14 M14 7 L7 14 M14 12 L12 14" stroke="#94a3b8" strokeWidth="1.5" fill="none" />
          </svg>
        </div>
      </div>
    </div>
  );
}
