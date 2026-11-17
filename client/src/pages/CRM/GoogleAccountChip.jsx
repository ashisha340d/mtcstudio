import { LogIn, RefreshCw, LogOut } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

// Small "Login to Google Account" panel for the CRM header. Reflects the stored
// connection so import/export/update/delete reuse it without re-authorizing.
export default function GoogleAccountChip({ status, onChange }) {
  const { connected, account } = status || {};

  function login() {
    window.open('/auth/google', 'googleAuth', 'width=520,height=650');
    function handler(ev) {
      if (ev.origin !== window.location.origin) return;
      if (ev.data?.type !== 'google-auth') return;
      window.removeEventListener('message', handler);
      if (ev.data.ok) onChange?.();
    }
    window.addEventListener('message', handler);
  }

  async function disconnect() {
    if (!confirm('Disconnect this Google account from MTC Studio?')) return;
    try { await fetch(`${API_BASE}/google-disconnect`, { method: 'POST' }); } catch {}
    onChange?.();
  }

  if (!connected) {
    return (
      <button className="gacct-login" onClick={login} title="Authorize MTC Studio to read and write your Google Contacts">
        <LogIn size={15} /> Login to Google Account
      </button>
    );
  }

  return (
    <div className="gacct">
      <span className="gacct-dot" />
      <span className="gacct-info">
        <span className="gacct-label">Google connected</span>
        {(account?.email || account?.name) && <span className="gacct-email">{account.email || account.name}</span>}
      </span>
      <button className="gacct-ic" onClick={login} title="Switch / reconnect a different Google account"><RefreshCw size={14} /></button>
      <button className="gacct-ic gacct-ic--danger" onClick={disconnect} title="Disconnect Google account"><LogOut size={14} /></button>
    </div>
  );
}
