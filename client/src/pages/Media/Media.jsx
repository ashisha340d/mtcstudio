import { useState, useEffect, useRef } from 'react';
import { mediaApi } from '../../services/api';
import { useMsg } from '../../hooks/useApi';

const SECTIONS = [['', 'All Sections'], ['menu', 'Menu'], ['cake', 'Cake Catalogue'], ['blog', 'Blogs']];
const PER_PAGE_OPTIONS = [12, 24, 48, 96];
const STATE_KEY = 'mediaLibraryState';

function loadSavedState() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STATE_KEY));
    if (saved) return { search: saved.search || '', section: saved.section ?? 'menu', perPage: PER_PAGE_OPTIONS.includes(saved.perPage) ? saved.perPage : 24 };
  } catch (e) {}
  return { search: '', section: 'menu', perPage: 24 }; // default to Menu — cheapest section to query at scale
}

// ── Shared inline style tokens — this page is deliberately all-inline so no
// external stylesheet can ever bleed onto it (see FoodMenu.css .btn.btn-delete
// leaking a dark-red-on-red delete button here when both pages' CSS were loaded).
// Palette maps to theme.css vars so light/dark themes both work.
const C = {
  bg: 'var(--t-surface-2)', surface: 'var(--t-surface)', surface2: 'var(--t-surface-2)', border: 'var(--t-border)',
  text: 'var(--t-text)', textMuted: 'var(--t-text-muted)', accent: 'var(--t-accent)', accentSoft: 'var(--t-accent-soft)',
  accentGrad: 'linear-gradient(135deg, var(--t-accent), #a5380c)',
  danger: '#dc2626', dangerHover: '#b91c1c', success: '#16a34a', warn: '#d97706',
};

function Btn({ children, onClick, disabled, variant = 'ghost', small, title }) {
  const [hover, setHover] = useState(false);
  const solid = variant !== 'ghost';
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 6, cursor: disabled ? 'not-allowed' : 'pointer',
    border: '1px solid transparent', borderRadius: solid ? 999 : 10, fontWeight: 700, whiteSpace: 'nowrap',
    padding: small ? '6px 12px' : '9px 16px', fontSize: small ? 12 : 12.5,
    opacity: disabled ? 0.45 : 1, transition: 'filter .12s, transform .15s ease, box-shadow .15s ease, background .15s ease',
    transform: hover && !disabled ? 'translateY(-1px)' : 'none',
    boxShadow: hover && !disabled ? '0 3px 10px rgba(0,0,0,0.12)' : 'none',
  };
  const variants = {
    primary: { background: C.accentGrad, color: '#fff', filter: hover ? 'brightness(1.06)' : 'none' },
    danger: { background: C.danger, color: '#fff', filter: hover ? 'brightness(1.15)' : 'none' },
    success: { background: C.success, color: '#fff', filter: hover ? 'brightness(1.1)' : 'none' },
    ghost: { background: hover ? C.surface2 : 'transparent', color: C.text, borderColor: C.border },
  };
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...base, ...variants[variant] }}
    >
      {children}
    </button>
  );
}

export default function Media() {
  const initial = loadSavedState();
  const [media, setMedia] = useState([]);
  const [search, setSearch] = useState(initial.search);
  const [section, setSection] = useState(initial.section);
  const [perPage, setPerPage] = useState(initial.perPage);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [makingForApp, setMakingForApp] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [editing, setEditing] = useState(null);
  const [hoverId, setHoverId] = useState(null);
  const { msg, showMsg } = useMsg();
  const fileRef = useRef();

  async function load(s = search, sec = section, p = page, pp = perPage) {
    setLoading(true);
    try {
      const res = await mediaApi.pickerList({ search: s, section: sec, page: p, perPage: pp });
      setMedia(res.data.items || []);
      setTotal(res.data.total || 0);
      setTotalPages(res.data.totalPages || 1);
      setPage(res.data.page || 1);
    } catch (e) {
      showMsg(e.response?.data?.error || e.message, false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line
  useEffect(() => { sessionStorage.setItem(STATE_KEY, JSON.stringify({ search, section, perPage })); }, [search, section, perPage]);

  function goPage(p) {
    const next = Math.min(Math.max(1, p), totalPages);
    if (next === page || loading) return;
    load(search, section, next, perPage);
  }

  async function handleUpload(e) {
    const files = e.target.files;
    if (!files || !files.length) return;
    setUploading(true);
    const fd = new FormData();
    Array.from(files).forEach(f => fd.append('images', f));
    try {
      await mediaApi.upload(fd);
      showMsg(`Uploaded ${files.length} file(s)`);
      load(search, section, 1, perPage);
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
      showMsg('Deleted');
      load(search, section, page, perPage);
    } catch (e) {
      showMsg(e.response?.data?.error || e.message, false);
    }
  }

  async function bulkDelete() {
    if (!selected.size) return;
    if (!window.confirm(`Delete ${selected.size} items?`)) return;
    try {
      await mediaApi.bulkDelete([...selected]);
      setSelected(new Set());
      showMsg('Deleted');
      load(search, section, page, perPage);
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

  async function handleMakeForApp() {
    if (!window.confirm('Rebuild the app image cache? This wipes forapp and re-exports ONLY menu + category photos as compressed 512px webp.')) return;
    setMakingForApp(true);
    try {
      const res = await mediaApi.makeForApp();
      const { exported, missing, failed } = res.data;
      showMsg(`For App: ${exported} exported${missing ? `, ${missing} missing` : ''}${failed ? `, ${failed} failed` : ''}`);
    } catch (e) {
      showMsg(e.response?.data?.error || e.message, false);
    } finally {
      setMakingForApp(false);
    }
  }

  function handleSearch(e) {
    e.preventDefault();
    load(search, section, 1, perPage);
  }

  function handleSectionChange(sec) {
    setSection(sec);
    load(search, sec, 1, perPage);
  }

  function handlePerPageChange(pp) {
    setPerPage(pp);
    load(search, section, 1, pp);
  }

  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return Math.round(bytes / 1024) + ' KB';
  }

  const inputStyle = {
    background: C.surface2, border: `1.5px solid ${C.border}`, borderRadius: 10,
    color: C.text, padding: '8px 12px', fontSize: 13, outline: 'none',
    transition: 'border-color .15s ease, background .15s ease, box-shadow .15s ease',
  };
  const focusInput = e => { e.target.style.borderColor = 'var(--t-accent)'; e.target.style.background = 'var(--t-surface)'; e.target.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--t-accent) 16%, transparent)'; if (e.target.value) e.target.select(); };
  const blurInput = e => { e.target.style.borderColor = 'var(--t-border)'; e.target.style.background = 'var(--t-surface-2)'; e.target.style.boxShadow = 'none'; };

  return (
    <div style={{ minHeight: '100%', background: C.bg, color: C.text, padding: 20, boxSizing: 'border-box' }}>

      {/* ── Toolbar — single row, sticky on top while grid scrolls ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20,
        display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', alignItems: 'center', gap: 8,
        background: 'color-mix(in srgb, var(--t-surface) 88%, transparent)', backdropFilter: 'blur(8px)',
        border: `1px solid ${C.border}`, borderRadius: 14,
        padding: 10, marginBottom: 18, boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
      }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, alignItems: 'center', flex: '0 0 330px' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.textMuted, fontSize: 13 }}>🔍</span>
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search media…"
              onFocus={focusInput} onBlur={blurInput}
              style={{ ...inputStyle, width: '100%', paddingLeft: 30, boxSizing: 'border-box' }}
            />
          </div>
          <Btn variant="primary" small onClick={handleSearch}>Search</Btn>
          {search && <Btn small onClick={() => { setSearch(''); load('', section, 1, perPage); }}>✕</Btn>}
        </form>

        {/* ── Pagination — right after the search button ── */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: '0 0 auto' }}>
          <Btn small disabled={page <= 1 || loading} onClick={() => goPage(page - 1)}>‹ Prev</Btn>
          <span style={{ fontSize: 12, color: C.text, padding: '0 4px', fontWeight: 700, whiteSpace: 'nowrap' }}>
            {page} / {totalPages}
          </span>
          <Btn small disabled={page >= totalPages || loading} onClick={() => goPage(page + 1)}>Next ›</Btn>
          <select value={perPage} onChange={e => handlePerPageChange(Number(e.target.value))} title="Items per page" style={{ ...inputStyle, padding: '6px 8px' }}>
            {PER_PAGE_OPTIONS.map(n => <option key={n} value={n}>{n} / page</option>)}
          </select>
        </div>

        <select value={section} onChange={e => handleSectionChange(e.target.value)} style={{ ...inputStyle, flex: '0 0 auto' }}>
          {SECTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>

        <Btn variant="primary" onClick={() => fileRef.current.click()} disabled={uploading}>
          {uploading ? 'Uploading…' : '⬆ Upload'}
        </Btn>
        <input ref={fileRef} type="file" multiple accept="image/*" style={{ display: 'none' }} onChange={handleUpload} />

        <Btn variant="success" onClick={handleSync} disabled={syncing}>
          {syncing ? 'Syncing…' : '⇅ Sync to Website'}
        </Btn>

        <Btn variant="primary" onClick={handleMakeForApp} disabled={makingForApp} title="Wipe forapp and re-export menu + category photos as 512px compressed webp">
          {makingForApp ? 'Building…' : '📱 Make For App'}
        </Btn>
        {syncResult && !syncing && (
          <span style={{ fontSize: 11, color: C.textMuted, whiteSpace: 'nowrap' }}>
            ✓ {syncResult.synced} uploaded · {syncResult.skipped} existed · {syncResult.failed} failed
          </span>
        )}

        {selected.size > 0 && (
          <>
            <span style={{ fontSize: 12, color: C.textMuted, marginLeft: 'auto', whiteSpace: 'nowrap' }}>{selected.size} selected</span>
            <Btn variant="danger" onClick={bulkDelete}>🗑 Delete Selected</Btn>
          </>
        )}

        <span style={{ fontSize: 12, color: C.textMuted, marginLeft: selected.size > 0 ? 0 : 'auto', whiteSpace: 'nowrap' }}>
          {total} item{total === 1 ? '' : 's'}
        </span>

        {msg && (
          <span style={{
            fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 999, whiteSpace: 'nowrap',
            background: msg.ok ? 'var(--t-success-bg)' : 'var(--t-danger-bg)',
            color: msg.ok ? 'var(--t-success-text)' : 'var(--t-danger-text)',
            border: `1px solid ${msg.ok ? 'var(--t-success)' : 'var(--t-danger)'}`,
          }}>{msg.text}</span>
        )}
      </div>

      {/* ── Grid ── */}
      {loading ? (
        <p style={{ textAlign: 'center', color: C.textMuted, padding: 40 }}>Loading…</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }}>
          {media.map(m => {
            const isSel = selected.has(m.id);
            const isHover = hoverId === m.id;
            return (
              <div
                key={m.id}
                onMouseEnter={() => setHoverId(m.id)}
                onMouseLeave={() => setHoverId(null)}
                style={{
                  background: C.surface,
                  border: `1px solid ${isSel ? C.accent : (isHover ? 'color-mix(in srgb, var(--t-accent) 45%, var(--t-border))' : C.border)}`,
                  borderRadius: 14, overflow: 'hidden',
                  boxShadow: isHover ? '0 10px 24px rgba(0,0,0,0.10)' : '0 1px 3px rgba(0,0,0,0.05)',
                  transform: isHover ? 'translateY(-3px)' : 'none',
                  transition: 'transform .18s cubic-bezier(.34,1.4,.4,1), box-shadow .18s, border-color .15s',
                  display: 'flex', flexDirection: 'column', height: '100%',
                }}
              >
                <div
                  onClick={() => toggleSelect(m.id)}
                  style={{ position: 'relative', aspectRatio: '1 / 1', background: C.surface2, cursor: 'pointer' }}
                >
                  <img
                    src={`/uploads/${m.filename}`} alt={m.alt_text || m.title} loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                  {isSel && (
                    <div style={{
                      position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: '50%',
                      background: C.accentGrad, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 800, boxShadow: '0 2px 8px color-mix(in srgb, var(--t-accent) 45%, transparent)',
                    }}>✓</div>
                  )}
                </div>

                <div style={{ padding: 10, display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.title || m.filename}
                  </div>
                  <div style={{ fontSize: 10, color: C.textMuted, margin: '3px 0 6px' }}>
                    {m.width && m.height ? `${m.width}×${m.height}` : ''} {formatSize(m.file_size)}
                  </div>

                  {!!(m.sections || []).length && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                      {m.sections.map(s => (
                        <span key={s} style={{
                          fontSize: 9, textTransform: 'uppercase', letterSpacing: '.04em',
                          background: 'color-mix(in srgb, var(--t-accent) 7%, var(--t-surface))',
                          border: '1px solid color-mix(in srgb, var(--t-accent) 22%, var(--t-border))',
                          color: C.textMuted, borderRadius: 999, padding: '2px 8px', fontWeight: 700,
                        }}>{s}</span>
                      ))}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 6, marginTop: 'auto', paddingTop: 8 }}>
                    <Btn small onClick={() => setEditing({ ...m })} title="Edit metadata">✎ Edit</Btn>
                    <Btn small variant="danger" onClick={() => deleteItem(m.id)} title="Delete permanently">🗑 Delete</Btn>
                  </div>
                </div>
              </div>
            );
          })}
          {media.length === 0 && (
            <p style={{ gridColumn: '1/-1', color: C.textMuted, textAlign: 'center', padding: 40 }}>No media found</p>
          )}
        </div>
      )}

      {/* ── Edit modal ── */}
      {editing && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
          onClick={() => setEditing(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 460,
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16,
              boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
              display: 'flex', flexDirection: 'column',
              maxHeight: '90vh', overflow: 'hidden',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px', background: C.accentGrad,
            }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Edit Media</div>
              <button onClick={() => setEditing(null)} style={{ background: 'none', border: 'none', fontSize: 18, color: 'rgba(255,255,255,0.85)', cursor: 'pointer', lineHeight: 1, padding: 4 }}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>
              <img
                src={`/uploads/${editing.filename}`}
                alt={editing.alt_text}
                style={{ width: '100%', maxHeight: 180, objectFit: 'contain', background: C.surface2, marginBottom: 16, borderRadius: 8, display: 'block' }}
              />

              {[
                { label: 'Title', field: 'title' },
                { label: 'Alt Text', field: 'alt_text' },
                { label: 'Caption', field: 'caption' },
              ].map(({ label, field }) => (
                <div key={field} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.textMuted, marginBottom: 5 }}>
                    {label}
                  </div>
                  <input
                    type="text"
                    value={editing[field] || ''}
                    onChange={e => setEditing(ed => ({ ...ed, [field]: e.target.value }))}
                    onFocus={focusInput} onBlur={blurInput}
                    style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
              ))}
            </div>

            <div style={{ borderTop: `1px solid ${C.border}`, padding: '12px 20px', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Btn onClick={() => setEditing(null)}>Cancel</Btn>
              <Btn variant="success" onClick={saveEdit}>Save</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
