import { useState, useEffect, useRef } from 'react';
import { mediaApi } from '../../services/api';
import './MediaPicker.css';

const SECTIONS = [['', 'All'], ['menu', 'Menu'], ['cake', 'Cake Catalogue'], ['blog', 'Blogs']];

export default function MediaPicker({ onSelect, onClose, multiple = false, section = '' }) {
  const [media, setMedia] = useState([]);
  const [search, setSearch] = useState('');
  const [sectionFilter, setSectionFilter] = useState(section);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState([]);
  const fileRef = useRef();

  async function load(s = '', sec = sectionFilter) {
    setLoading(true);
    try {
      const res = await mediaApi.pickerList({ search: s, section: sec });
      setMedia(res.data);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(search, sectionFilter); }, []); // eslint-disable-line

  function handleSectionChange(sec) {
    setSectionFilter(sec);
    load(search, sec);
  }

  async function handleUpload(e) {
    const files = e.target.files;
    if (!files || !files.length) return;
    setUploading(true);
    const fd = new FormData();
    Array.from(files).forEach(f => fd.append('images', f));
    try {
      await mediaApi.upload(fd);
      // A brand-new file has no real usage yet, so a section filter would hide
      // it — drop to "All" so the upload is guaranteed visible to select.
      setSectionFilter('');
      load(search, '');
    } finally { setUploading(false); e.target.value = ''; }
  }

  function toggleSelect(item) {
    if (multiple) {
      setSelected(prev => prev.find(s => s.id === item.id) ? prev.filter(s => s.id !== item.id) : [...prev, item]);
    } else {
      onSelect(item);
    }
  }

  function handleConfirm() {
    if (multiple && selected.length) onSelect(selected);
  }

  return (
    <>
      <div className="modal-overlay open" onClick={onClose} />
      <div className="media-picker-box">
        <div className="media-picker-header">
          <span className="modal-title" style={{ margin: 0 }}>Select Image</span>
          <button className="btn btn-clear btn-sm" onClick={onClose}>✕ Close</button>
        </div>

        <div className="media-picker-toolbar">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load(search)}
            placeholder="Search media…"
            style={{ flex: 1 }}
          />
          <button className="btn btn-primary btn-sm" onClick={() => load(search)}>Search</button>
          <select value={sectionFilter} onChange={e => handleSectionChange(e.target.value)}>
            {SECTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
          <button className="btn btn-add btn-sm" onClick={() => fileRef.current.click()} disabled={uploading}>
            {uploading ? '…' : '+ Upload'}
          </button>
          <input ref={fileRef} type="file" multiple accept="image/*" style={{ display: 'none' }} onChange={handleUpload} />
        </div>

        <div className="media-picker-grid">
          {loading ? <p style={{ gridColumn: '1/-1', textAlign: 'center', color: '#aaa' }}>Loading…</p> : (
            media.map(item => {
              const isSelected = multiple ? selected.find(s => s.id === item.id) : false;
              return (
                <div
                  key={item.id}
                  className={`picker-item${isSelected ? ' selected' : ''}`}
                  onClick={() => toggleSelect(item)}
                  title={item.title || item.filename}
                >
                  <img src={`/uploads/${item.filename}`} alt={item.alt_text || item.title} loading="lazy" />
                  {isSelected && <div className="picker-check">✓</div>}
                  <div className="picker-label">{item.title || item.filename}</div>
                  {!!(item.sections || []).length && (
                    <div className="picker-tags">{item.sections.map(s => <span key={s} className="picker-tag">{s}</span>)}</div>
                  )}
                </div>
              );
            })
          )}
          {!loading && media.length === 0 && (
            <p style={{ gridColumn: '1/-1', textAlign: 'center', color: '#aaa', padding: 20 }}>No media found</p>
          )}
        </div>

        {multiple && (
          <div className="media-picker-footer">
            <span style={{ fontSize: 12, color: '#666' }}>{selected.length} selected</span>
            <button className="btn btn-clear" onClick={onClose}>Cancel</button>
            <button className="btn btn-save" disabled={!selected.length} onClick={handleConfirm}>Select</button>
          </div>
        )}
      </div>
    </>
  );
}
