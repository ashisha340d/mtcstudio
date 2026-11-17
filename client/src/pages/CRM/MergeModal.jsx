import { useState } from 'react';
import './AddressCardsModal.css';

// Merge the given `source` contact INTO a target the user searches for. Target
// keeps its own filled fields; source fills the gaps, then source is removed.
export default function MergeModal({ source, api, flash, onClose, onMerged }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  async function search(v) {
    setQ(v);
    if (v.trim().length < 2) { setResults([]); return; }
    try {
      const r = await api.get('/crm/customers/search', { params: { q: v, limit: 8 } });
      setResults((r.data.rows || []).filter(x => x.phone !== source.phone));
    } catch { setResults([]); }
  }

  async function doMerge() {
    if (!target) return;
    if (!confirm(`Merge ${source.name} (${source.phone}) INTO ${target.name} (${target.phone})?\n${source.phone} will be removed.`)) return;
    setBusy(true);
    try {
      await api.post('/crm/customers/merge', { source_phone: source.phone, target_phone: target.phone });
      flash('Contacts merged');
      onMerged();
    } catch (e) { flash(e.response?.data?.error ?? 'Merge failed', true); }
    finally { setBusy(false); }
  }

  return (
    <div className="craddr-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="craddr-modal" style={{ width: 460 }}>
        <div className="craddr-head">
          <h3>Merge contact</h3>
          <button className="craddr-x" onClick={onClose}>✕</button>
        </div>
        <div className="craddr-body">
          <div className="crm-merge-src">
            Keeping the target · folding in <b>{source.name}</b> ({source.phone})
          </div>
          <input className="crm-search" style={{ width: '100%', maxWidth: 'none', marginBottom: 8 }}
            placeholder="Search the contact to merge INTO…" value={q} onChange={e => search(e.target.value)} />
          <div className="crm-merge-results">
            {results.map(r => (
              <button key={r.phone} className={`crm-merge-opt ${target?.phone === r.phone ? 'sel' : ''}`} onClick={() => setTarget(r)}>
                <b>{r.name}</b> <span>{r.phone}</span>
              </button>
            ))}
            {q.trim().length >= 2 && !results.length && <div className="crm-tag-empty">No matches</div>}
          </div>
          <div className="craddr-form-actions" style={{ marginTop: 12 }}>
            <button className="craddr-mini primary" disabled={!target || busy} onClick={doMerge}>
              {busy ? 'Merging…' : 'Merge'}
            </button>
            <button className="craddr-mini" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
