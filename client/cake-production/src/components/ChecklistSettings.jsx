import { useEffect, useState } from 'react';
import { apiJson } from '../api/client';
import { setMeta } from '../db/dexie';

export default function ChecklistSettings({ onBack }) {
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiJson('/api/pos/cake-production/checklist-template').then(setItems).catch(() => {});
  }, []);

  function addItem(e) {
    e.preventDefault();
    const label = draft.trim();
    if (!label) return;
    const item_key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `item_${Date.now()}`;
    setItems(prev => [...prev, { item_key, label, sort_order: prev.length }]);
    setDraft('');
  }

  function removeItem(item_key) {
    setItems(prev => prev.filter(i => i.item_key !== item_key));
  }

  async function save() {
    setSaving(true);
    try {
      const saved = await apiJson('/api/pos/cake-production/checklist-template', {
        method: 'PUT',
        body: JSON.stringify(items.map((it, i) => ({ ...it, sort_order: i }))),
      });
      await setMeta('checklistTemplate', saved);
      onBack();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2>Checklist Settings</h2>
      <div className="cp-section">
        {items.map(it => (
          <div key={it.item_key} className="cp-settings-row">
            <input value={it.label} readOnly />
            <button className="cp-btn cp-btn--ghost" onClick={() => removeItem(it.item_key)}>Remove</button>
          </div>
        ))}
        <form onSubmit={addItem} className="cp-settings-row">
          <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="New checklist step…" />
          <button className="cp-btn cp-btn--ghost" type="submit">Add</button>
        </form>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="cp-btn" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button className="cp-btn cp-btn--ghost" onClick={onBack}>Cancel</button>
      </div>
    </div>
  );
}
