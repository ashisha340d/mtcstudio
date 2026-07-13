import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'X-Session-ID': sessionStorage.getItem('mtc_session') || 'dev-session' },
});

const BUCKET_META = {
  sunny:  { icon: '☀️', label: 'Sunny' },
  cloudy: { icon: '☁️', label: 'Cloudy' },
  rain:   { icon: '🌧️', label: 'Rain' },
  storm:  { icon: '⛈️', label: 'Storm' },
  snow:   { icon: '❄️', label: 'Snow' },
  fog:    { icon: '🌫️', label: 'Fog' },
  windy:  { icon: '🌬️', label: 'Windy' },
};

export default function WeatherRecommendsTab() {
  const [buckets,  setBuckets]  = useState([]);
  const [items,    setItems]    = useState({});   // bucket -> [{ id, product_id, product_name, price }]
  const [products, setProducts] = useState([]);
  const [settings, setSettings] = useState({ enabled: 1, modal_seconds: 8, max_per_session: 1 });
  const [pick,     setPick]     = useState({});   // bucket -> product_id being added
  const [busy,     setBusy]     = useState(false);
  const [toast,    setToast]    = useState('');

  const load = useCallback(async () => {
    try {
      const [rec, prods] = await Promise.all([
        API.get('/weather-reco'),
        API.get('/weather-reco/products'),
      ]);
      setBuckets(rec.data.buckets || []);
      setItems(rec.data.items || {});
      setSettings(rec.data.settings || { enabled: 1, modal_seconds: 8, max_per_session: 1 });
      setProducts(prods.data || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  function flash(msg, err = false) {
    setToast(err ? `❌ ${msg}` : `✓ ${msg}`);
    setTimeout(() => setToast(''), 2500);
  }

  async function addItem(bucket) {
    const pid = pick[bucket];
    if (!pid) return;
    setBusy(true);
    try {
      await API.post('/weather-reco', { bucket, product_id: Number(pid) });
      setPick(p => ({ ...p, [bucket]: '' }));
      await load();
      flash('Added');
    } catch (e) { flash(e.response?.data?.error || 'Add failed', true); }
    finally { setBusy(false); }
  }

  async function removeItem(id) {
    setBusy(true);
    try { await API.delete(`/weather-reco/${id}`); await load(); flash('Removed'); }
    catch (e) { flash(e.response?.data?.error || 'Remove failed', true); }
    finally { setBusy(false); }
  }

  async function saveSettings() {
    setBusy(true);
    try {
      await API.put('/weather-reco/settings', {
        enabled:       !!settings.enabled,
        modalSeconds:  Number(settings.modal_seconds) || 8,
        maxPerSession: Number(settings.max_per_session) || 1,
      });
      flash('Settings saved');
    } catch (e) { flash(e.response?.data?.error || 'Save failed', true); }
    finally { setBusy(false); }
  }

  async function syncNow() {
    setBusy(true);
    try {
      const r = await API.post('/weather-reco/sync');
      flash(`Synced ${r.data.synced ?? 0} item(s) to website`);
    } catch (e) { flash(e.response?.data?.error || 'Sync failed', true); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20, gap:12, flexWrap:'wrap' }}>
        <div>
          <div style={{ fontSize:16, fontWeight:800, color:'#2a1f12' }}>🌤️ Weather Recommends</div>
          <div style={{ fontSize:12, color:'#9c8870', marginTop:4 }}>
            Pick the products shown in the website's weather recommendation popup for each condition.
            Buckets with fewer than 6 items are topped up with featured products on the site.
            Click <strong>Sync to Website</strong> to push everything live.
          </div>
        </div>
        <button onClick={syncNow} disabled={busy}
          style={{ background:'#c1440e', color:'#fff', border:0, borderRadius:8, padding:'10px 16px', fontWeight:700, cursor:'pointer' }}>
          🔄 Sync to Website
        </button>
      </div>

      {/* Settings */}
      <div style={{ display:'flex', gap:18, alignItems:'center', flexWrap:'wrap', background:'#fff7ef', border:'1px solid #ece1cf', borderRadius:10, padding:'12px 16px', marginBottom:20 }}>
        <label style={{ display:'flex', gap:8, alignItems:'center', fontWeight:700, color:'#2a1f12', fontSize:13 }}>
          <input type="checkbox" checked={!!settings.enabled}
            onChange={e => setSettings(s => ({ ...s, enabled: e.target.checked ? 1 : 0 }))} />
          Popup enabled
        </label>
        <label style={{ display:'flex', gap:6, alignItems:'center', fontSize:13, color:'#5a4a37' }}>
          Modal seconds
          <input type="number" min={2} max={60} value={settings.modal_seconds}
            onChange={e => setSettings(s => ({ ...s, modal_seconds: e.target.value }))}
            style={{ width:60, padding:'5px 7px', border:'1px solid #d9cbb6', borderRadius:6 }} />
        </label>
        <label style={{ display:'flex', gap:6, alignItems:'center', fontSize:13, color:'#5a4a37' }}>
          Max shows / session
          <input type="number" min={1} max={10} value={settings.max_per_session}
            onChange={e => setSettings(s => ({ ...s, max_per_session: e.target.value }))}
            style={{ width:60, padding:'5px 7px', border:'1px solid #d9cbb6', borderRadius:6 }} />
        </label>
        <button onClick={saveSettings} disabled={busy}
          style={{ background:'#2a1f12', color:'#fff', border:0, borderRadius:6, padding:'7px 14px', fontWeight:700, cursor:'pointer' }}>
          Save
        </button>
      </div>

      {/* Buckets */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(300px, 1fr))', gap:16 }}>
        {buckets.map(b => {
          const meta = BUCKET_META[b] || { icon: '🌡️', label: b };
          const list = items[b] || [];
          return (
            <div key={b} style={{ background:'#fff', border:'1px solid #ece1cf', borderRadius:10, padding:14 }}>
              <div style={{ fontWeight:800, color:'#2a1f12', marginBottom:10 }}>
                {meta.icon} {meta.label}
                <span style={{ fontSize:12, color:'#9c8870', fontWeight:600, marginLeft:8 }}>{list.length} picks</span>
              </div>

              {list.length === 0 && (
                <div style={{ fontSize:12, color:'#b5a692', marginBottom:8 }}>No picks yet — website falls back to featured.</div>
              )}
              {list.map(it => (
                <div key={it.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 0', borderBottom:'1px solid #f3ece0' }}>
                  <span style={{ fontSize:13, color:'#3a2c1c' }}>
                    {it.product_name} {it.price != null && <em style={{ color:'#9c8870', fontStyle:'normal' }}>· Rs.{it.price}</em>}
                  </span>
                  <button onClick={() => removeItem(it.id)} disabled={busy}
                    style={{ border:0, background:'none', color:'#c1440e', cursor:'pointer', fontSize:15 }} aria-label="Remove">✕</button>
                </div>
              ))}

              <div style={{ display:'flex', gap:6, marginTop:10 }}>
                <select value={pick[b] || ''} onChange={e => setPick(p => ({ ...p, [b]: e.target.value }))}
                  style={{ flex:1, padding:'6px 8px', border:'1px solid #d9cbb6', borderRadius:6, fontSize:13 }}>
                  <option value="">+ Add product…</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.category ? `${p.category} · ` : ''}{p.name}</option>
                  ))}
                </select>
                <button onClick={() => addItem(b)} disabled={busy || !pick[b]}
                  style={{ background:'#c1440e', color:'#fff', border:0, borderRadius:6, padding:'6px 12px', fontWeight:700, cursor:'pointer' }}>Add</button>
              </div>
            </div>
          );
        })}
      </div>

      {toast && (
        <div style={{ position:'fixed', bottom:24, right:24, background:'#2a1f12', color:'#fff', padding:'10px 16px', borderRadius:8, fontSize:13, zIndex:1000 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
