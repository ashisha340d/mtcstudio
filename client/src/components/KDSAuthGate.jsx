import { useState, useEffect } from 'react';
import posApi from '../services/posApi';

// KDS-specific auth: persists in localStorage so KDS is always logged in.
// Shows a one-time PIN entry on first use or after session expires.
export default function KDSAuthGate({ children }) {
  const [state, setState] = useState('checking'); // 'checking' | 'ok' | 'pin'
  const [pin, setPin]     = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('kds_session');
    if (!saved) { setState('pin'); return; }
    sessionStorage.setItem('mtc_session', saved);
    posApi.getKDSMe().then(user => {
      localStorage.setItem('kds_user', JSON.stringify({ name: user.name ?? user.username ?? 'User', role: user.role ?? '' }));
      setState('ok');
    }).catch(err => {
      if (err.response?.status === 401) {
        // Session actually invalid/expired — force re-login.
        localStorage.removeItem('kds_session');
        localStorage.removeItem('kds_user');
        sessionStorage.removeItem('mtc_session');
        setState('pin');
      } else {
        // Network/server hiccup — keep the existing session, don't boot to PIN screen.
        setState('ok');
      }
    });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const data = await posApi.kdsSessionLogin(pin);
      if (data?.name || data?.username) {
        localStorage.setItem('kds_user', JSON.stringify({ name: data.name ?? data.username ?? 'User', role: data.role ?? '' }));
      }
      setState('ok');
    } catch {
      setError('Incorrect PIN. Try again.');
      setPin('');
    }
  };

  if (state === 'checking') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0a0a0a', color: '#fff', fontSize: 18 }}>
        Loading KDS…
      </div>
    );
  }

  if (state === 'pin') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0a0a0a', gap: 24 }}>
        <div style={{ fontSize: 32, fontWeight: 900, color: '#fff', letterSpacing: '0.1em' }}>KDS LOGIN</div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 280 }}>
          <input
            type="password"
            inputMode="numeric"
            placeholder="Enter PIN"
            value={pin}
            onChange={e => setPin(e.target.value)}
            autoFocus
            style={{ padding: '14px 18px', fontSize: 24, textAlign: 'center', borderRadius: 10, border: '2px solid #333', background: '#1a1a1a', color: '#fff', letterSpacing: '0.3em' }}
          />
          {error && <div style={{ color: '#ef4444', textAlign: 'center', fontSize: 14 }}>{error}</div>}
          <button
            type="submit"
            style={{ padding: '14px', fontSize: 16, fontWeight: 700, borderRadius: 10, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer' }}
          >UNLOCK KDS</button>
        </form>
      </div>
    );
  }

  return children;
}
