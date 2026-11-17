import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import axios from 'axios';
import { createSocket } from '../socket';
import { createAlertPlayer } from '../utils/alertSound';
import './FonepayDrawer.css';

const http = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

// Pull-out tab on the right edge of every Studio screen. Lists today's Fonepay
// payments captured by MTC Companion from FoneBiz notifications. Read-only —
// entries can't be removed; the list resets with the Nepal business day.
export default function FonepayDrawer() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unseen, setUnseen] = useState(0);
  const [toasts, setToasts] = useState([]);
  const playerRef = useRef(null);
  if (!playerRef.current) playerRef.current = createAlertPlayer(1046);
  const openRef = useRef(open);
  openRef.current = open;

  const hidden = location.pathname.startsWith('/menu');

  useEffect(() => {
    if (hidden) return;
    const load = () => http.get('/dashboard/fonepay-today').then(r => setItems(r.data)).catch(() => {});
    load();
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    const unlock = () => playerRef.current.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });

    const token = sessionStorage.getItem('mtc_session') ?? localStorage.getItem('kds_session') ?? undefined;
    const socket = createSocket({ role: 'pos', token });
    socket.on('reconnect', load);
    socket.on('payment-received', (p) => {
      setItems(list => list.some(i => i.paymentId === p.paymentId) ? list : [p, ...list]);
      if (!openRef.current) setUnseen(n => n + 1);
      setToasts(t => t.some(x => x.paymentId === p.paymentId) ? t : [...t, p]);
      playerRef.current.play();
      notifyWindows(p);
    });
    // Day rollover — reload so yesterday's list clears.
    const t = setInterval(load, 10 * 60 * 1000);
    return () => { socket.disconnect(); clearInterval(t); window.removeEventListener('pointerdown', unlock); };
  }, [hidden]);

  if (hidden) return null;

  const total = items.reduce((s, i) => s + (i.amount ?? 0), 0);

  return (
    <>
      {/* Bottom-left QR payment cards — stay until closed manually */}
      {toasts.length > 0 && (
        <div className="fpd-toasts">
          {toasts.map(t => (
            <div key={t.paymentId} className="fpd-toast">
              <button className="fpd-toast__x" aria-label="Close"
                onClick={() => setToasts(list => list.filter(x => x.paymentId !== t.paymentId))}>✕</button>
              <div className="fpd-toast__head">
                <span className="fpd-toast__brand">fonepay</span>
                <span className="fpd-toast__tag">QR</span>
              </div>
              <div className="fpd-toast__body">
                <span className="fpd-toast__title"><span className="fpd-toast__check">✓</span> Payment Received</span>
                <span className="fpd-toast__amt">{fmtAmt(t.amount)}</span>
                {t.payer && <span className="fpd-toast__sub">from {t.payer}</span>}
                <span className="fpd-toast__meta">
                  {t.txnId ? `RRN ${t.txnId} · ` : ''}{fmtTime(t.timestamp)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <button className={`fpd-tab ${open ? 'fpd-tab--open' : ''}`}
        onClick={() => { setOpen(o => !o); setUnseen(0); }} aria-label="Fonepay payments">
        <span className="fpd-tab__label">Fonepay</span>
        {unseen > 0 && <span className="fpd-tab__badge">{unseen}</span>}
      </button>

      <aside className={`fpd-panel ${open ? 'fpd-panel--open' : ''}`}>
        <header className="fpd-panel__head">
          <div>
            <h3>Fonepay — Today</h3>
            <small>{items.length} payment{items.length === 1 ? '' : 's'} · {fmtAmt(total)}</small>
          </div>
          <button className="fpd-panel__x" onClick={() => setOpen(false)} aria-label="Close">✕</button>
        </header>
        <ul className="fpd-list">
          {items.length === 0 && <li className="fpd-empty">No payments yet today</li>}
          {items.map(i => (
            <li key={i.paymentId} className="fpd-item">
              <div className="fpd-item__row">
                <strong>{fmtAmt(i.amount)}</strong>
                <span>{fmtTime(i.timestamp)}</span>
              </div>
              {i.payer && <div className="fpd-item__payer">{i.payer}</div>}
              {i.txnId && <div className="fpd-item__meta">Txn {i.txnId}</div>}
              <div className="fpd-item__raw">{[i.title, i.text].filter(Boolean).join(' — ')}</div>
            </li>
          ))}
        </ul>
      </aside>
    </>
  );
}

// Native Windows toast via the browser Notification API.
function notifyWindows(p) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(`Fonepay: ${fmtAmt(p.amount)} received`, {
      body: [p.payer, p.text].filter(Boolean).join('\n'),
      tag: `fonepay-${p.paymentId}`,
      requireInteraction: true,
    });
    n.onclick = () => { window.focus(); n.close(); };
  } catch {}
}

function fmtAmt(a) {
  return a == null ? 'Rs —' : `Rs ${Number(a).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function fmtTime(ts) {
  const d = new Date(String(ts).replace(' ', 'T'));
  return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
