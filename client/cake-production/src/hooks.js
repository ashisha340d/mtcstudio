import { useEffect, useState, useCallback } from 'react';
import { db, getMeta } from './db/dexie';
import { onSyncChange, getConnectionState } from './sync/syncEngine';
import { onPhotoQueueChange } from './photos/photoQueue';

export function useOrders() {
  const [orders, setOrders] = useState([]);

  const reload = useCallback(() => {
    db.orders.toArray().then(rows => {
      rows.sort((a, b) => (a.delivery_date || '').localeCompare(b.delivery_date || ''));
      setOrders(rows);
    });
  }, []);

  useEffect(() => {
    reload();
    return onSyncChange(reload);
  }, [reload]);

  return orders;
}

export function useOrder(id) {
  const [order, setOrder] = useState(null);

  const reload = useCallback(() => {
    if (!id) return;
    db.orders.get(id).then(setOrder);
  }, [id]);

  useEffect(() => {
    reload();
    return onSyncChange(reload);
  }, [reload]);

  return order;
}

export function useConnection() {
  const [state, setState] = useState(getConnectionState());
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const unsub = onSyncChange(() => setState(getConnectionState()));
    const timer = setInterval(() => setState(getConnectionState()), 3000);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      unsub();
      clearInterval(timer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return { lan: state.lanConnected, internet: online };
}

export function usePendingCounts(orderId) {
  const [counts, setCounts] = useState({ sync: 0, photos: 0 });

  const reload = useCallback(() => {
    Promise.all([
      db.syncQueue.where('cake_order_id').equals(orderId).count(),
      db.photoQueue.where('cake_order_id').equals(orderId).count(),
    ]).then(([sync, photos]) => setCounts({ sync, photos }));
  }, [orderId]);

  useEffect(() => {
    if (!orderId) return;
    reload();
    const unsub1 = onSyncChange(reload);
    const unsub2 = onPhotoQueueChange(reload);
    return () => { unsub1(); unsub2(); };
  }, [orderId, reload]);

  return counts;
}

export function useChecklistTemplate() {
  const [template, setTemplate] = useState([]);
  useEffect(() => { getMeta('checklistTemplate', []).then(setTemplate); }, []);
  return template;
}
