import { useState, useEffect, useRef } from 'react';
import { mediaApi } from '../../services/api';
import { useMsg } from '../../hooks/useApi';
import './Media.css';

export default function Media() {
  const [media, setMedia] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [editing, setEditing] = useState(null);
  const { msg, showMsg } = useMsg();
  const fileRef = useRef();

  async function load(s = search) {
    setLoading(true);
    try {
      const res = await mediaApi.list({ search: s });
      setMedia(res.data);
    } catch (e) {
      showMsg(e.response?.data?.error || e.message, false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleUpload(e) {
    const files = e.target.files;
    if (!files || !files.length) return;
    setUploading(true);
    const fd = new FormData();
    Array.from(files).forEach(f => fd.append('images', f));
    try {
      await mediaApi.upload(fd);
      showMsg(`Uploaded ${files.length} file(s)`);
      load();
    } catch (err) {
      showMsg(err.response?.data?.error || err.message, false);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function deleteItem(id) {
    if (!window.confirm('Delete this image?')) return;
    try {
      await mediaApi.remove(id);
      setMedia(prev => prev.filter(m => m.id !== id));
      showMsg('Deleted');
    } catch (e) {
      showMsg(e.response?.data?.error || e.message, false);
    }
  }

  async function bulkDelete() {
    if (!selected.size) return;
    if (!window.confirm(`Delete ${selected.size} items?`)) return;
    try {
      await mediaApi.bulkDelete([...selected]);
      setMedia(prev => prev.filter(m => !selected.has(m.id)));
      setSelected(new Set());
      showMsg('Deleted');
    } catch (e) {
      showMsg(e.response?.data?.error || e.message, false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    try {
      await mediaApi.update(editing.id, { title: editing.title, alt_text: editing.alt_text, caption: editing.caption });
      setMedia(prev => prev.map(m => m.id === editing.id ? { ...m, ...editing } : m));
      setEditing(null);
      showMsg('Saved!');
    } catch (e) {
      showMsg(e.response?.data?.error || e.message, false);
    }
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await mediaApi.sync();
      const { synced, skipped, failed, total } = res.data;
      setSyncResult({ synced, skipped, failed, total });
      if (synced > 0 || skipped > 0) showMsg(`Synced ${synced} new, ${skipped} already existed`);
      else if (failed > 0) showMsg(`${failed} file(s) failed to upload`, false);
      else showMsg('Nothing to sync — all files up to date');
    } catch (e) {
      showMsg(e.response?.data?.error || e.message, false);
    } finally {
      setSyncing(false);
    }
  }

  function handleSearch(e) {
    e.preventDefault();
    load(search);
  }

  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return Math.round(bytes / 1024) + ' KB';
  }

  return (
    <div>
      <div className="toolbar">
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search media…" />
          <button type="submit" className="btn btn-primary btn-sm">Search</button>
          {search && <button type="button" className="btn btn-clear btn-sm" onClick={() => { setSearch(''); load(''); }}>Clear</button>}
        </form>
        <button className="btn btn-add btn-sm" onClick={() => fileRef.current.click()} disabled={uploading}>
          {uploading ? 'Uploading…' : '+ Upload'}
        </button>

        <button
          onClick={handleSync}
          disabled={syncing}
          style={{
            padding: '4px 12px', borderRadius: 4, border: 'none',
            background: syncing ? '#9ca3af' : '#0f766e',
            color: '#fff', fontSize: 12, fontWeight: 700,
            cursor: syncing ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
          }}
        >
          {syncing ? 'Syncing…' : '⬆ Sync to Website'}
        </button>
        {syncResult && !syncing && (
          <span style={{ fontSize: 11, color: '#555' }}>
            ✓ {syncResult.synced} uploaded · {syncResult.skipped} existed · {syncResult.failed} failed
          </span>
        )}
        <input ref={fileRef} type="file" multiple accept="image/*" style={{ display: 'none' }} onChange={handleUpload} />
        {selected.size > 0 && (
          <>
            <span style={{ fontSize: 12, color: '#555' }}>{selected.size} selected</span>
            <button className="btn btn-delete btn-sm" onClick={bulkDelete}>Delete Selected</button>
          </>
        )}
        {msg && <span className={`msg msg-${msg.ok ? 'ok' : 'err'}`}>{msg.text}</span>}
      </div>

      {loading ? <p style={{ padding: 16 }}>Loading…</p> : (
        <div className="media-grid">
          {media.map(m => (
            <div key={m.id} className={`media-card${selected.has(m.id) ? ' selected' : ''}`}>
              <div className="media-img-wrap" onClick={() => toggleSelect(m.id)}>
                <img src={`/uploads/${m.filename}`} alt={m.alt_text || m.title} loading="lazy" />
                {selected.has(m.id) && <div className="media-check">✓</div>}
              </div>
              <div className="media-info">
                <div className="media-title">{m.title || m.filename}</div>
                <div className="media-meta">{m.width && m.height ? `${m.width}×${m.height}` : ''} {formatSize(m.file_size)}</div>
                <div className="media-actions">
                  <button className="btn btn-sm btn-save" onClick={() => setEditing({ ...m })}>Edit</button>
                  <button className="btn btn-sm btn-delete" onClick={() => deleteItem(m.id)}>Del</button>
                </div>
              </div>
            </div>
          ))}
          {media.length === 0 && <p style={{ gridColumn: '1/-1', color: '#aaa', textAlign: 'center', padding: 40 }}>No media found</p>}
        </div>
      )}

      <div className="pager">Showing {media.length} files</div>

      {editing && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
          onClick={() => setEditing(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 460,
              background: '#fff', borderRadius: 14,
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
              display: 'flex', flexDirection: 'column',
              maxHeight: '90vh', overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 20px', borderBottom: '1px solid #f0f0f0',
            }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#111' }}>Edit Media</div>
              <button onClick={() => setEditing(null)} style={{ background: 'none', border: 'none', fontSize: 20, color: '#999', cursor: 'pointer', lineHeight: 1, padding: 4 }}>✕</button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>
              <img
                src={`/uploads/${editing.filename}`}
                alt={editing.alt_text}
                style={{ width: '100%', maxHeight: 180, objectFit: 'contain', background: '#f5f5f5', marginBottom: 16, borderRadius: 6, display: 'block' }}
              />

              {[
                { label: 'Title', field: 'title' },
                { label: 'Alt Text', field: 'alt_text' },
                { label: 'Caption', field: 'caption' },
              ].map(({ label, field }) => (
                <div key={field} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b7280', marginBottom: 5 }}>
                    {label}
                  </div>
                  <input
                    type="text"
                    value={editing[field] || ''}
                    onChange={e => setEditing(ed => ({ ...ed, [field]: e.target.value }))}
                    style={{
                      width: '100%', padding: '9px 12px', borderRadius: 8,
                      border: '1.5px solid #e5e7eb', background: '#f9fafb',
                      fontSize: 13, color: '#111', outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>
              ))}
            </div>

            {/* Footer */}
            <div style={{ borderTop: '1px solid #f0f0f0', padding: '12px 20px', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setEditing(null)}
                style={{ padding: '9px 18px', borderRadius: 8, border: '1.5px solid #e5e7eb', background: 'transparent', color: '#555', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: '#2e7d32', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
