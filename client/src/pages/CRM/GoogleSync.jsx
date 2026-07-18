import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, CheckCircle2 } from 'lucide-react';
import './GoogleSync.css';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

function SyncRing() {
  return (
    <svg width="86" height="86" viewBox="0 0 86 86" className="gsync-ring">
      <circle cx="43" cy="43" r="36" fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="6" />
      <motion.circle
        cx="43" cy="43" r="36" fill="none" stroke="#22c55e" strokeWidth="6" strokeLinecap="round"
        strokeDasharray="70 400"
        style={{ transformOrigin: '43px 43px' }}
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
      />
    </svg>
  );
}

export default function GoogleSync({ onSynced }) {
  const [modal, setModal] = useState(null); // null | syncing | done
  const [stage, setStage] = useState('');   // 'import' | 'writeback'
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  const [summary, setSummary] = useState(null);
  const esRef = useRef(null);

  useEffect(() => () => esRef.current?.close(), []);

  function openAuthPopup() {
    const popup = window.open('/auth/google', 'googleAuth', 'width=520,height=650');
    function handler(ev) {
      if (ev.origin !== window.location.origin) return;
      if (ev.data?.type !== 'google-auth') return;
      window.removeEventListener('message', handler);
      if (ev.data.ok) runSync();
    }
    window.addEventListener('message', handler);
  }

  function runSync() {
    setModal('syncing');
    setStage('import');
    setProgress({ processed: 0, total: 0 });
    setSummary(null);

    const es = new EventSource(`${API_BASE}/sync-contacts`);
    esRef.current = es;

    es.addEventListener('start', e => setProgress({ processed: 0, total: JSON.parse(e.data).total }));
    es.addEventListener('progress', e => {
      const d = JSON.parse(e.data);
      setProgress({ processed: d.processed, total: d.total });
    });
    es.addEventListener('writeback-start', e => {
      setStage('writeback');
      setProgress({ processed: 0, total: JSON.parse(e.data).total });
    });
    es.addEventListener('writeback-progress', e => {
      const d = JSON.parse(e.data);
      setProgress({ processed: d.processed, total: d.total });
    });
    es.addEventListener('done', e => {
      setSummary(JSON.parse(e.data));
      es.close();
      setModal('done');
      onSynced?.();
      setTimeout(() => setModal(null), 2800);
    });
    es.addEventListener('error', () => {
      es.close();
      setModal(null);
    });
  }

  return (
    <>
      <button className="gsync-btn" onClick={openAuthPopup}>
        <RefreshCw size={16} /> Sync Google Contacts
      </button>

      <AnimatePresence>
        {modal && (
          <motion.div className="gsync-modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div
              className="gsync-modal-card"
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.85, opacity: 0 }}
            >
              {modal === 'syncing' && (
                <>
                  <SyncRing />
                  <div className="gsync-counter">
                    {stage === 'writeback'
                      ? <>Exporting to Google: {progress.processed} / {progress.total}</>
                      : <>Importing contacts: {progress.processed} / {progress.total}</>}
                  </div>
                </>
              )}
              {modal === 'done' && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                  className="gsync-done"
                >
                  <CheckCircle2 size={54} color="#16a34a" />
                  <div className="gsync-banner">Sync Complete</div>
                  {summary && (
                    <div className="gsync-summary">
                      {summary.imported} new · {summary.updated} updated · {summary.exported} exported to Google
                    </div>
                  )}
                </motion.div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
