import { useState, useEffect } from 'react';
import { blogsApi, generateBlogApi } from '../../services/api';
import { useMsg } from '../../hooks/useApi';
import MediaPicker from '../../components/MediaPicker/MediaPicker';
import './Blogs.css';

const TOPICS = [
  'Food Recipe', 'Product Spotlight', 'Food Guide', 'Local Food Guide',
  'Festival & Seasonal', 'Birthday & Celebration', 'Behind The Kitchen',
  'Ingredient Story', 'Customer FAQ', 'Top Picks'
];
const PAGE_SIZE = 15;

export default function Blogs() {
  const [blogs, setBlogs] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [page, setPage] = useState(1);
  const [dragIdx, setDragIdx] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [genStats, setGenStats] = useState(null);
  const { msg, showMsg } = useMsg();

  // Edit modal state
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editFeatMedia, setEditFeatMedia] = useState(null);
  const [editAuthMedia, setEditAuthMedia] = useState(null);
  const [editFeatFile, setEditFeatFile] = useState(null);
  const [editAuthFile, setEditAuthFile] = useState(null);
  const [pickerTarget, setPickerTarget] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load(s = search) {
    setLoading(true);
    try {
      const res = await blogsApi.list({ search: s });
      setBlogs(res.data.blogs);
      setPage(1);
    } catch (e) {
      showMsg(e.response?.data?.error || e.message, false);
    } finally { setLoading(false); }
  }

  useEffect(() => {
    load();
    generateBlogApi.stats().then(r => setGenStats(r.data)).catch(() => {});
  }, []);

  // ── Selection ──────────────────────────────────────────────────────────────
  const allIds = blogs.map(b => b.id);
  const allChecked = allIds.length > 0 && allIds.every(id => selected.has(id));
  const someChecked = !allChecked && allIds.some(id => selected.has(id));

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(allIds));
  }

  function toggleOne(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ── Generate ───────────────────────────────────────────────────────────────
  async function runGenerate(silent = false) {
    if (!silent && !window.confirm('Regenerate all blog pages?')) return;
    setGenerating(true);
    try {
      await generateBlogApi.generate();
      const s = await generateBlogApi.stats();
      setGenStats(s.data);
      if (!silent) showMsg('Blog pages generated!');
    } catch (e) {
      if (!silent) showMsg(e.response?.data?.error || e.message, false);
    } finally { setGenerating(false); }
  }

  // ── Bulk actions ───────────────────────────────────────────────────────────
  async function bulkAction(action) {
    if (!selected.size) return;
    if (action === 'delete' && !window.confirm(`Delete ${selected.size} post(s)?`)) return;
    try {
      await blogsApi.bulkAction({ action, ids: [...selected] });
      setSelected(new Set());
      const label = action === 'delete' ? 'Deleted' : action === 'publish' ? 'Published' : 'Unpublished';
      showMsg(label);
      load();
      if (action === 'publish' || action === 'unpublish') await runGenerate(true);
    } catch (e) {
      showMsg(e.response?.data?.error || e.message, false);
    }
  }

  async function deleteOne(id) {
    if (!window.confirm('Delete this post?')) return;
    try {
      await blogsApi.remove(id);
      setBlogs(prev => prev.filter(b => b.id !== id));
      showMsg('Deleted');
    } catch (e) {
      showMsg(e.response?.data?.error || e.message, false);
    }
  }

  // ── Drag & Drop sort ───────────────────────────────────────────────────────
  function onDragStart(e, idx) {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e, idx) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const next = [...blogs];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(idx, 0, moved);
    setBlogs(next);
    setDragIdx(idx);
  }

  async function onDrop(e) {
    e.preventDefault();
    setDragIdx(null);
    try {
      await blogsApi.reorder(blogs.map(b => b.id));
    } catch (e) {
      showMsg(e.response?.data?.error || e.message, false);
    }
  }

  // ── Edit modal ─────────────────────────────────────────────────────────────
  function openEdit(blog) {
    setEditing(blog);
    setEditForm({
      topic: blog.topic || '',
      title: blog.title,
      slug: blog.slug,
      youtube_url: blog.youtube_url || '',
      author_name: blog.author_name || '',
      comment_text: blog.comment_text || '',
      content_html: blog.content_html || '',
      status: blog.status,
      featured_image_id: blog.featured_image || '',
      author_image_id: blog.author_image || '',
    });
    setEditFeatMedia(blog.featured_image_data || null);
    setEditAuthMedia(blog.author_image_data || null);
    setEditFeatFile(null);
    setEditAuthFile(null);
  }

  function setEF(key, val) { setEditForm(f => ({ ...f, [key]: val })); }

  async function saveEdit(e) {
    e.preventDefault();
    if (!editForm.title) return;
    setSaving(true);
    try {
      const fd = new FormData();
      Object.entries(editForm).forEach(([k, v]) => fd.append(k, v ?? ''));
      if (editFeatFile) fd.append('featured_image_file', editFeatFile);
      if (editAuthFile) fd.append('author_image_file', editAuthFile);
      const prevStatus = editing.status;
      await blogsApi.update(editing.id, fd);
      showMsg('Saved!');
      setEditing(null);
      load();
      if (editForm.status !== prevStatus || editForm.status === 'published') {
        await runGenerate(true);
      }
    } catch (e) {
      showMsg(e.response?.data?.error || e.message, false);
    } finally { setSaving(false); }
  }

  function handleMediaSelect(media) {
    if (pickerTarget === 'featured') {
      setEditFeatMedia(media);
      setEditFeatFile(null);
      setEF('featured_image_id', media.id);
    } else {
      setEditAuthMedia(media);
      setEditAuthFile(null);
      setEF('author_image_id', media.id);
    }
    setPickerTarget(null);
  }

  // ── Pagination ─────────────────────────────────────────────────────────────
  const totalPages = Math.ceil(blogs.length / PAGE_SIZE);
  const paginated = blogs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function formatDate(dt) {
    if (!dt) return '—';
    return new Date(dt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  return (
    <div>
      {/* ── Toolbar ── */}
      <div className="toolbar">
        <form onSubmit={e => { e.preventDefault(); load(search); }} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search blogs…" />
          <button type="submit" className="btn btn-primary btn-sm">Search</button>
          {search && <button type="button" className="btn btn-clear btn-sm" onClick={() => { setSearch(''); load(''); }}>Clear</button>}
        </form>

        {selected.size > 0 && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#555', fontWeight: 600 }}>{selected.size} selected</span>
            <button className="btn btn-sm btn-save" onClick={() => bulkAction('publish')}>✓ Publish</button>
            <button className="btn btn-sm btn-clear" onClick={() => bulkAction('unpublish')}>○ Unpublish</button>
            <button className="btn btn-sm btn-delete" onClick={() => bulkAction('delete')}>Delete</button>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          {genStats && (
            <span style={{ fontSize: 11, color: '#888' }}>
              {genStats.publishedBlogs || 0} published
              {genStats.lastGenerated && ` · last generated ${new Date(genStats.lastGenerated).toLocaleTimeString()}`}
            </span>
          )}
          <button
            className="btn btn-sm"
            onClick={() => runGenerate(false)}
            disabled={generating}
            style={{
              background: generating ? '#9ca3af' : '#0f766e',
              color: '#fff', border: 'none', fontWeight: 700,
              cursor: generating ? 'not-allowed' : 'pointer',
            }}
          >
            {generating ? 'Generating…' : '⚡ Generate Blog'}
          </button>
        </div>

        {msg && <span className={`msg msg-${msg.ok ? 'ok' : 'err'}`}>{msg.text}</span>}
      </div>

      {/* ── Table ── */}
      <div className="table-wrap">
        {loading ? <p style={{ padding: 16 }}>Loading…</p> : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={el => el && (el.indeterminate = someChecked)}
                    onChange={toggleAll}
                    title="Select all"
                  />
                </th>
                <th style={{ width: 28, color: '#bbb', fontWeight: 400, fontSize: 14 }}>⠿</th>
                <th style={{ width: 56 }}>Image</th>
                <th>Title</th>
                <th>Topic</th>
                <th>Status</th>
                <th>Published</th>
                <th className="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((b, i) => {
                const absIdx = (page - 1) * PAGE_SIZE + i;
                const isSelected = selected.has(b.id);
                const isDragging = dragIdx === absIdx;
                return (
                  <tr
                    key={b.id}
                    draggable
                    onDragStart={e => onDragStart(e, absIdx)}
                    onDragOver={e => onDragOver(e, absIdx)}
                    onDrop={onDrop}
                    onDoubleClick={() => openEdit(b)}
                    style={{
                      background: isDragging ? '#fffbe6' : isSelected ? '#f0f7ff' : undefined,
                      opacity: isDragging ? 0.7 : 1,
                      cursor: 'default',
                    }}
                    title="Double-click to edit"
                  >
                    <td onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleOne(b.id)} />
                    </td>
                    <td style={{ color: '#ccc', cursor: 'grab', userSelect: 'none', textAlign: 'center', fontSize: 16 }}>⠿</td>
                    <td style={{ width: 56 }}>
                      {b.featured_image_data && (
                        <img
                          src={`/uploads/${b.featured_image_data.filename}`}
                          alt={b.title}
                          style={{ width: 46, height: 34, objectFit: 'cover', borderRadius: 4 }}
                        />
                      )}
                    </td>
                    <td>
                      <div style={{ fontWeight: 'bold' }}>{b.title}</div>
                      <div style={{ fontSize: 11, color: '#888' }}>{b.slug}</div>
                    </td>
                    <td>{b.topic || '—'}</td>
                    <td><span className={`badge badge-${b.status}`}>{b.status}</span></td>
                    <td style={{ fontSize: 11 }}>{formatDate(b.published_at)}</td>
                    <td className="col-actions" onClick={e => e.stopPropagation()}>
                      <button className="btn btn-sm btn-save" onClick={() => openEdit(b)}>Edit</button>{' '}
                      <a
                        href={`/api/blogs/${b.id}/preview`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-sm btn-clear"
                        style={{ background: '#555', color: '#fff' }}
                      >Preview</a>{' '}
                      <button className="btn btn-sm btn-delete" onClick={() => deleteOne(b.id)}>Del</button>
                    </td>
                  </tr>
                );
              })}
              {blogs.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 20, color: '#aaa' }}>No blog posts found</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', flexWrap: 'wrap' }}>
        {totalPages > 1 && (
          <>
            <button className="btn btn-sm btn-clear" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
            {Array.from({ length: totalPages }, (_, i) => (
              <button
                key={i + 1}
                className={`btn btn-sm ${page === i + 1 ? 'btn-primary' : 'btn-clear'}`}
                onClick={() => setPage(i + 1)}
              >{i + 1}</button>
            ))}
            <button className="btn btn-sm btn-clear" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
            <span style={{ fontSize: 11, color: '#888', marginLeft: 8 }}>
              Page {page} of {totalPages}
            </span>
          </>
        )}
        <span style={{ fontSize: 11, color: '#aaa', marginLeft: 'auto' }}>{blogs.length} post(s)</span>
      </div>

      {/* ── Edit Modal ── */}
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
              width: '100%', maxWidth: 740,
              background: '#fff', borderRadius: 14,
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
              display: 'flex', flexDirection: 'column',
              maxHeight: '92vh', overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #f0f0f0', gap: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Edit — {editing.title}
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <a href={`/api/blogs/${editing.id}/preview`} target="_blank" rel="noreferrer" className="btn btn-sm btn-clear" style={{ background: '#555', color: '#fff' }}>Preview</a>
                <button onClick={() => setEditing(null)} style={{ background: 'none', border: 'none', fontSize: 20, color: '#999', cursor: 'pointer', lineHeight: 1, padding: 4 }}>✕</button>
              </div>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>
              <form id="blog-edit-form" onSubmit={saveEdit}>
                <div className="form-row">
                  <div className="form-group">
                    <label>Title *</label>
                    <input type="text" value={editForm.title} onChange={e => setEF('title', e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label>Slug</label>
                    <input type="text" value={editForm.slug} onChange={e => setEF('slug', e.target.value)} />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Topic</label>
                    <select value={editForm.topic} onChange={e => setEF('topic', e.target.value)}>
                      <option value="">— None —</option>
                      {TOPICS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Status</label>
                    <select value={editForm.status} onChange={e => setEF('status', e.target.value)}>
                      <option value="draft">Draft</option>
                      <option value="published">Published</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label>Content HTML</label>
                  <textarea
                    style={{ minHeight: 180, fontFamily: 'monospace', fontSize: 12 }}
                    value={editForm.content_html}
                    onChange={e => setEF('content_html', e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>YouTube URL</label>
                  <input type="url" value={editForm.youtube_url} onChange={e => setEF('youtube_url', e.target.value)} />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Featured Image</label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      {(editFeatMedia || editFeatFile) && (
                        <img
                          src={editFeatMedia ? `/uploads/${editFeatMedia.filename}` : URL.createObjectURL(editFeatFile)}
                          alt="featured"
                          style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 4 }}
                        />
                      )}
                      <button type="button" className="btn btn-sm btn-add" onClick={() => setPickerTarget('featured')}>Pick from Media</button>
                      <span style={{ fontSize: 11, color: '#888' }}>or</span>
                      <input type="file" accept="image/*" onChange={e => { setEditFeatFile(e.target.files[0]); setEditFeatMedia(null); setEF('featured_image_id', ''); }} />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Author Image</label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      {(editAuthMedia || editAuthFile) && (
                        <img
                          src={editAuthMedia ? `/uploads/${editAuthMedia.filename}` : URL.createObjectURL(editAuthFile)}
                          alt="author"
                          style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: '50%' }}
                        />
                      )}
                      <button type="button" className="btn btn-sm btn-add" onClick={() => setPickerTarget('author')}>Pick from Media</button>
                      <span style={{ fontSize: 11, color: '#888' }}>or</span>
                      <input type="file" accept="image/*" onChange={e => { setEditAuthFile(e.target.files[0]); setEditAuthMedia(null); setEF('author_image_id', ''); }} />
                    </div>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Author Name</label>
                    <input type="text" value={editForm.author_name} onChange={e => setEF('author_name', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Kitchen Note</label>
                    <input type="text" value={editForm.comment_text} onChange={e => setEF('comment_text', e.target.value)} />
                  </div>
                </div>
              </form>
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
                form="blog-edit-form"
                type="submit"
                disabled={saving}
                style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: '#2e7d32', color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}
              >
                {saving ? 'Saving…' : 'Save Post'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pickerTarget && (
        <MediaPicker onSelect={handleMediaSelect} onClose={() => setPickerTarget(null)} section="blog" />
      )}
    </div>
  );
}
