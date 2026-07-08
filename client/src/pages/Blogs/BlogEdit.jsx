import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { blogsApi } from '../../services/api';
import { useMsg } from '../../hooks/useApi';
import MediaPicker from '../../components/MediaPicker/MediaPicker';
import './Blogs.css';

const TOPICS = [
  'Food Recipe', 'Product Spotlight', 'Food Guide', 'Local Food Guide',
  'Festival & Seasonal', 'Birthday & Celebration', 'Behind The Kitchen',
  'Ingredient Story', 'Customer FAQ', 'Top Picks'
];

export default function BlogEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { msg, showMsg } = useMsg();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [pickerTarget, setPickerTarget] = useState(null);
  const [featMedia, setFeatMedia] = useState(null);
  const [authMedia, setAuthMedia] = useState(null);
  const [featFile, setFeatFile] = useState(null);
  const [authFile, setAuthFile] = useState(null);

  const [form, setForm] = useState({
    topic: '', title: '', slug: '', youtube_url: '', author_name: '',
    comment_text: '', content_html: '', status: 'draft',
    featured_image_id: '', author_image_id: ''
  });

  useEffect(() => {
    blogsApi.get(id).then(res => {
      const b = res.data.blog;
      setForm({
        topic: b.topic || '', title: b.title, slug: b.slug, youtube_url: b.youtube_url || '',
        author_name: b.author_name || '', comment_text: b.comment_text || '',
        content_html: b.content_html || '', status: b.status,
        featured_image_id: b.featured_image || '', author_image_id: b.author_image || ''
      });
      if (b.featured_image_data) setFeatMedia(b.featured_image_data);
      if (b.author_image_data) setAuthMedia(b.author_image_data);
    }).finally(() => setLoading(false));
  }, [id]);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  function handleMediaSelect(media) {
    if (pickerTarget === 'featured') {
      setFeatMedia(media);
      setFeatFile(null);
      set('featured_image_id', media.id);
    } else {
      setAuthMedia(media);
      setAuthFile(null);
      set('author_image_id', media.id);
    }
    setPickerTarget(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title) { setError('Title is required'); return; }
    setSaving(true);
    setError(null);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (featFile) fd.append('featured_image_file', featFile);
      if (authFile) fd.append('author_image_file', authFile);
      await blogsApi.update(id, fd);
      showMsg('Saved!');
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setSaving(false); }
  }

  if (loading) return <p style={{ padding: 20 }}>Loading…</p>;

  return (
    <div className="blog-form">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>Edit Blog Post #{id}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href={`/api/blogs/${id}/preview`} target="_blank" rel="noreferrer" className="btn btn-sm btn-clear" style={{ background: '#555', color: '#fff' }}>Preview</a>
          <button className="btn btn-clear btn-sm" onClick={() => navigate('/blogs')}>← Back</button>
        </div>
      </div>

      {msg && <div className={`alert alert-${msg.ok ? 'success' : 'error'}`}>{msg.text}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <div className="form-group">
            <label>Title *</label>
            <input type="text" value={form.title} onChange={e => set('title', e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Slug</label>
            <input type="text" value={form.slug} onChange={e => set('slug', e.target.value)} />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Topic</label>
            <select value={form.topic} onChange={e => set('topic', e.target.value)}>
              <option value="">— None —</option>
              {TOPICS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Status</label>
            <select value={form.status} onChange={e => set('status', e.target.value)}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label>Content HTML</label>
          <textarea
            style={{ minHeight: 300, fontFamily: 'monospace', fontSize: 12 }}
            value={form.content_html}
            onChange={e => set('content_html', e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>YouTube URL</label>
          <input type="url" value={form.youtube_url} onChange={e => set('youtube_url', e.target.value)} />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Featured Image</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {(featMedia || featFile) && (
                <img
                  src={featMedia ? `/uploads/${featMedia.filename}` : URL.createObjectURL(featFile)}
                  alt="featured"
                  style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 4 }}
                />
              )}
              <button type="button" className="btn btn-sm btn-add" onClick={() => setPickerTarget('featured')}>Pick from Media</button>
              <span style={{ fontSize: 11, color: '#888' }}>or</span>
              <input type="file" accept="image/*" onChange={e => { setFeatFile(e.target.files[0]); setFeatMedia(null); set('featured_image_id', ''); }} />
            </div>
          </div>
          <div className="form-group">
            <label>Author Image</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {(authMedia || authFile) && (
                <img
                  src={authMedia ? `/uploads/${authMedia.filename}` : URL.createObjectURL(authFile)}
                  alt="author"
                  style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: '50%' }}
                />
              )}
              <button type="button" className="btn btn-sm btn-add" onClick={() => setPickerTarget('author')}>Pick from Media</button>
              <span style={{ fontSize: 11, color: '#888' }}>or</span>
              <input type="file" accept="image/*" onChange={e => { setAuthFile(e.target.files[0]); setAuthMedia(null); set('author_image_id', ''); }} />
            </div>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Author Name</label>
            <input type="text" value={form.author_name} onChange={e => set('author_name', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Kitchen Note</label>
            <input type="text" value={form.comment_text} onChange={e => set('comment_text', e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button type="submit" className="btn btn-save" disabled={saving}>{saving ? 'Saving…' : 'Save Post'}</button>
          <button type="button" className="btn btn-clear" onClick={() => navigate('/blogs')}>Cancel</button>
        </div>
      </form>

      {pickerTarget && (
        <MediaPicker onSelect={handleMediaSelect} onClose={() => setPickerTarget(null)} section="blog" />
      )}
    </div>
  );
}
