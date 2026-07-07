import { useEffect, useState } from 'react';
import { getSession, logout } from './api/auth';
import { startSyncEngine, stopSyncEngine } from './sync/syncEngine';
import { startPhotoQueue, stopPhotoQueue } from './photos/photoQueue';
import ConnectionBadge from './components/ConnectionBadge';
import PinLogin from './components/PinLogin';
import ProductionBoard from './components/ProductionBoard';
import OrderDetail from './components/OrderDetail';
import ChecklistSettings from './components/ChecklistSettings';

export default function App() {
  const [loggedIn, setLoggedIn] = useState(!!getSession());
  const [view, setView] = useState({ name: 'board' }); // board | detail | settings

  useEffect(() => {
    if (!loggedIn) return;
    startSyncEngine();
    startPhotoQueue();
    return () => { stopSyncEngine(); stopPhotoQueue(); };
  }, [loggedIn]);

  if (!loggedIn) return <PinLogin onLoggedIn={() => setLoggedIn(true)} />;

  async function doLogout() {
    stopSyncEngine();
    stopPhotoQueue();
    await logout();
    setLoggedIn(false);
  }

  return (
    <div className="cp-root">
      <header className="cp-header">
        {view.name === 'board' ? (
          <h1>🎂 Cake Production</h1>
        ) : (
          <button className="cp-detail-back" onClick={() => setView({ name: 'board' })}>← Board</button>
        )}
        <div className="cp-header-actions">
          <ConnectionBadge />
          {view.name === 'board' && (
            <button className="cp-icon-btn" title="Checklist settings" onClick={() => setView({ name: 'settings' })}>⚙</button>
          )}
          <button className="cp-icon-btn" title="Log out" onClick={doLogout}>⎋</button>
        </div>
      </header>

      <main className="cp-body">
        {view.name === 'board' && <ProductionBoard onOpenOrder={(id, list) => setView({ name: 'detail', id, list })} />}
        {view.name === 'detail' && (
          <OrderDetail
            key={view.id}
            orderId={view.id}
            list={view.list}
            enterDir={view.enterDir}
            onNavigate={(id, dir) => setView(v => ({ ...v, id, enterDir: dir === 'next' ? 'right' : dir === 'prev' ? 'left' : null }))}
            onBack={() => setView({ name: 'board' })}
          />
        )}
        {view.name === 'settings' && <ChecklistSettings onBack={() => setView({ name: 'board' })} />}
      </main>
    </div>
  );
}
