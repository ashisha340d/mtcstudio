import { useState } from 'react';
import { mutations } from '../sync/syncEngine';

export default function TagEditor({ orderId, tags, locked }) {
  const [draft, setDraft] = useState('');
  const list = tags || [];

  function addTag(e) {
    e.preventDefault();
    const val = draft.trim();
    if (!val || list.includes(val)) { setDraft(''); return; }
    mutations.tags(orderId, [...list, val]);
    setDraft('');
  }

  function removeTag(tag) {
    mutations.tags(orderId, list.filter(t => t !== tag));
  }

  return (
    <div>
      <div className="cp-tags">
        {list.map(t => (
          <span key={t} className="cp-tag">
            {t}
            {!locked && <button onClick={() => removeTag(t)} aria-label={`Remove ${t}`}>×</button>}
          </span>
        ))}
      </div>
      {!locked && (
        <form onSubmit={addTag}>
          <input className="cp-tag-input" value={draft} onChange={e => setDraft(e.target.value)} placeholder="+ Add tag" />
        </form>
      )}
    </div>
  );
}
