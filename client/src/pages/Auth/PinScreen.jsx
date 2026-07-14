import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import './pin.css';

const PAD = ['1','2','3','4','5','6','7','8','9','C','0','⌫'];
const PIN_LENGTH = 4;

export default function PinScreen() {
  const { login, error } = useAuth();
  const [pin,     setPin]     = useState('');
  const [shake,   setShake]   = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = useCallback(async (fullPin) => {
    setLoading(true);
    const ok = await login(fullPin);
    if (!ok) {
      setShake(true);
      setTimeout(() => { setShake(false); setPin(''); }, 600);
    }
    setLoading(false);
  }, [login]);

  function press(key) {
    if (loading) return;
    if (key === '⌫') { setPin((p) => p.slice(0, -1)); return; }
    if (key === 'C')  { setPin(''); return; }
    const next = pin + key;
    setPin(next);
    if (next.length === PIN_LENGTH) submit(next);
  }

  // Physical keyboard support
  useEffect(() => {
    const handler = (e) => {
      if (e.key >= '0' && e.key <= '9') press(e.key);
      if (e.key === 'Backspace')         press('⌫');
      if (e.key === 'Escape')            press('C');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pin, loading]); // eslint-disable-line

  const dots = Array.from({ length: PIN_LENGTH }, (_, i) => i < pin.length);

  return (
    <div className="pin-root">
      <div className="pin-card">
        <div className="pin-logo">🍴</div>
        <div className="pin-brand">MTC POS</div>
        <div className="pin-tagline">Quick Service Restaurant</div>

        {/* Dot indicators */}
        <div className={`pin-dots ${shake ? 'pin-dots--shake' : ''}`}>
          {dots.map((filled, i) => (
            <div key={i} className={`pin-dot ${filled ? 'pin-dot--filled' : ''}`} />
          ))}
        </div>

        {/* Error */}
        {error && <div className="pin-error">{error}</div>}

        {/* Numpad */}
        <div className="pin-pad">
          {PAD.map((key, i) => (
            <button
              key={i}
              className={`pin-key ${key === 'C' ? 'pin-key--clear' : ''} ${key === '⌫' ? 'pin-key--del' : ''}`}
              onClick={() => press(key)}
              disabled={loading}
            >{key}</button>
          ))}
        </div>

        {loading && <div className="pin-loading">…</div>}
      </div>
    </div>
  );
}
