import { useEffect, useState } from 'react';

export default function SocketStatus({ socket, style = {} }) {
  const [status, setStatus] = useState('connecting');

  useEffect(() => {
    if (!socket) return;
    const onConnect = () => setStatus('connected');
    const onDisconnect = () => setStatus('disconnected');
    const onError = () => setStatus('error');

    if (socket.connected) setStatus('connected');

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onError);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onError);
    };
  }, [socket]);

  const colors = {
    connected: '#22c55e',
    disconnected: '#ef4444',
    connecting: '#f59e0b',
    error: '#ef4444',
  };

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#94a3b8', ...style }}>
      <span style={{ width: 15, height: 15, borderRadius: '50%', background: colors[status], display: 'inline-block', flexShrink: 0 }} />
      {status === 'connected' ? 'LIVE' : status === 'connecting' ? 'CTING…' : 'OFFLINE'}
    </div>
  );
}
