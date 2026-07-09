import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

const SOUND_TYPES = [
    { key: 'new_order',    label: 'KDS — New Order Arrival' },
    { key: 'warning',      label: 'KDS — Warning Alert' },
    { key: 'critical',     label: 'KDS — Critical Alert' },
    { key: 'waiter_ready', label: 'Waiter App — Order Ready' },
    { key: 'pos_ready',    label: 'POS — Order Ready' },
    { key: 'waiter_new_order', label: 'Waiter App — New Order Notification' },
    { key: 'web_order',    label: 'POS — New Web Order' },
];

export default function KDSSoundSettingsTab() {
    const [cfg, setCfg] = useState({ new_order: null, warning: null, critical: null, waiter_ready: null, pos_ready: null, waiter_new_order: null, web_order: null });
    const [uploading, setUploading] = useState(null);
    const [toast, setToast] = useState(null);

    const load = useCallback(async () => {
        try {
            const res = await API.get('/settings/kds-sound');
            setCfg(res.data);
        } catch { flash('Failed to load KDS sound settings', true); }
    }, []);

    useEffect(() => { load(); }, [load]);

    function flash(msg, err = false) {
        setToast({ msg, err });
        setTimeout(() => setToast(null), 3000);
    }

    async function upload(type, file) {
        setUploading(type);
        try {
            const form = new FormData();
            form.append('sound', file);
            const res = await API.post(`/settings/kds-sound/upload/${type}`, form);
            setCfg(c => ({ ...c, [type]: res.data.url }));
            flash('Sound updated — applies to all KDS stations');
        } catch (e) {
            flash(e.response?.data?.error || 'Upload failed', true);
        } finally { setUploading(null); }
    }

    async function clear(type) {
        try {
            await API.post(`/settings/kds-sound/clear/${type}`);
            setCfg(c => ({ ...c, [type]: null }));
            flash('Reverted to default beep');
        } catch { flash('Failed to clear sound', true); }
    }

    return (
        <div style={{ maxWidth: 640 }}>
            <div className="fm-card">
                <div className="fm-card__head"><span className="fm-card__title">🔔 Alert Sounds</span></div>
                <div style={{ padding: '16px 20px' }}>
                    <div style={{ fontSize: 12, color: '#999', marginBottom: 16 }}>
                        Configured once here — applies to every KDS station, the Waiter App and POS. No per-device upload.
                    </div>
                    {SOUND_TYPES.map(({ key, label }) => {
                        const inputId = `kds-snd-${key}`;
                        const src = cfg[key];
                        return (
                            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #f0f0f0' }}>
                                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#222' }}>{label}</span>
                                <label htmlFor={inputId} className="btn-secondary" style={{ cursor: 'pointer' }}>
                                    {uploading === key ? 'Uploading…' : src ? '⬆ Change' : '⬆ Upload'}
                                </label>
                                <input
                                    id={inputId} type="file" accept=".mp3,.wav,.ogg,.m4a,audio/*"
                                    style={{ display: 'none' }}
                                    onChange={e => e.target.files[0] && upload(key, e.target.files[0])}
                                />
                                {src && (
                                    <>
                                        <button className="btn-secondary" onClick={() => new Audio(src).play()}>▶</button>
                                        <button className="btn-secondary" onClick={() => clear(key)}>✕</button>
                                    </>
                                )}
                                {!src && <span style={{ fontSize: 11, color: '#aaa' }}>Default beep</span>}
                            </div>
                        );
                    })}
                    {toast && (
                        <div style={{ marginTop: 12, fontSize: 12, fontWeight: 600, color: toast.err ? '#dc2626' : '#16a34a' }}>
                            {toast.err ? '✗' : '✓'} {toast.msg}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
