import { useState } from 'react';
import { loginWithPin } from '../api/auth';
import { getServerUrl, setServerUrl } from '../config/serverConfig';

export default function PinLogin({ onLoggedIn }) {
  const [needsServer] = useState(!getServerUrl());
  const [serverInput, setServerInput] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function saveServer(e) {
    e.preventDefault();
    if (!serverInput.trim()) return;
    setServerUrl(serverInput);
    window.location.reload();
  }

  async function submitPin(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await loginWithPin(pin);
      onLoggedIn();
    } catch (err) {
      setError(err.message);
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  if (needsServer) {
    return (
      <div className="cp-login">
        <h1>🎂 Cake Production</h1>
        <p>Enter the POS server address for this device (e.g. http://192.168.1.5:3000)</p>
        <form onSubmit={saveServer} style={{ display: 'flex', gap: 8 }}>
          <input className="cp-server-input" value={serverInput} onChange={e => setServerInput(e.target.value)}
            placeholder="http://192.168.1.5:3000" autoFocus />
          <button className="cp-btn" type="submit">Save</button>
        </form>
      </div>
    );
  }

  return (
    <div className="cp-login">
      <h1>🎂 Cake Production</h1>
      <form onSubmit={submitPin} style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
        <input
          className="cp-pin-input"
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
          autoFocus
        />
        {error && <div className="cp-error">{error}</div>}
        <button className="cp-btn" type="submit" disabled={busy || !pin}>{busy ? 'Checking…' : 'Log In'}</button>
      </form>
    </div>
  );
}
