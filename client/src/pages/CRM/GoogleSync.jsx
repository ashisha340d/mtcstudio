import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Download, Upload } from 'lucide-react';
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

export default function GoogleSync({ onSynced, onConnected, connected = false, variant = 'import', phones = [], exportLabel = 'Export to Google' }) {
  const [modal, setModal] = useState(null); // null | syncing | done
  const [stage, setStage] = useState('');   // 'import' | 'export'
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  const [summary, setSummary] = useState(null);
  const esRef = useRef(null);

  useEffect(() => () => esRef.current?.close(), []);

  const run = () => (variant === 'export' ? runExport() : runImport());

  // Already connected? Run straight away — the server refreshes the token on its
  // own. Only pop the Google login when there's no stored authorization.
  function start() {
    if (variant === 'export' && !phones.length) return;
    if (connected) run();
    else openAuthPopup();
  }

  function openAuthPopup() {
    if (variant === 'export' && !phones.length) return;
    window.open('/auth/google', 'googleAuth', 'width=520,height=650');
    function handler(ev) {
      if (ev.origin !== window.location.origin) return;
      if (ev.data?.type !== 'google-auth') return;
      window.removeEventListener('message', handler);
      if (ev.data.ok) { onConnected?.(); run(); }
    }
    window.addEventListener('message', handler);
  }

  function runImport() {
    setModal('syncing');
    setStage('import');
    setProgress({ processed: 0, total: 0 });
    setSummary(null);

    const es = new EventSource(`${API_BASE}/import-contacts`);
    esRef.current = es;

    es.addEventListener('start', e => setProgress({ processed: 0, total: JSON.parse(e.data).total }));
    es.addEventListener('progress', e => {
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

  // Export uses POST (selected phones in the body), so read the SSE stream off fetch.
  async function runExport() {
    if (!phones.length) return;
    setModal('syncing');
    setStage('export');
    setProgress({ processed: 0, total: phones.length });
    setSummary(null);
    try {
      const res = await fetch(`${API_BASE}/export-contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phones })
      });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const ev = /event: (.*)/.exec(chunk)?.[1];
          const dl = /data: (.*)/.exec(chunk)?.[1];
          const d = dl ? JSON.parse(dl) : {};
          if (ev === 'progress') setProgress({ processed: d.processed, total: d.total });
          else if (ev === 'done') {
            setSummary(d);
            setModal('done');
            onSynced?.();
            setTimeout(() => setModal(null), 2800);
          } else if (ev === 'error') setModal(null);
        }
      }
    } catch {
      setModal(null);
    }
  }

  return (
    <>
      {variant === 'export' ? (
        <button className="gsync-btn" onClick={start} title="Push the SELECTED contacts UP to Google Contacts">
          <Upload size={16} /> {exportLabel} ({phones.length})
        </button>
      ) : (
        <button className="gsync-btn gsync-btn--ghost" onClick={start} title="Pull contacts and labels FROM Google into the CRM (one-way)">
          <Download size={16} /> Import from Google
        </button>
      )}

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
                    {stage === 'export'
                      ? <>Exporting to Google contacts: {progress.processed} / {progress.total}</>
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
                  <div className="gsync-banner">{stage === 'export' ? 'Export Complete' : 'Import Complete'}</div>
                  {summary && (
                    <div className="gsync-summary">
                      {stage === 'export'
                        ? <>{summary.created} created · {summary.updated} updated{summary.deleted ? <> · {summary.deleted} binned</> : null}</>
                        : <>{summary.imported} new · {summary.updated} updated</>}
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
