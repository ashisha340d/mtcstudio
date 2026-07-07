import { useChecklistTemplate } from '../hooks';
import { mutations } from '../sync/syncEngine';

export default function ChecklistPanel({ orderId, checklist, locked }) {
  const template = useChecklistTemplate();
  const doneMap = new Map((checklist || []).map(c => [c.item_key, c.done]));

  function toggle(item_key) {
    if (locked) return;
    const next = template.map(t => ({ item_key: t.item_key, done: t.item_key === item_key ? !doneMap.get(t.item_key) : !!doneMap.get(t.item_key) }));
    mutations.checklist(orderId, next);
  }

  if (!template.length) return <div className="cp-empty">No checklist items configured yet.</div>;

  return (
    <div>
      {template.map(t => {
        const done = !!doneMap.get(t.item_key);
        return (
          <label key={t.item_key} className={`cp-checklist-item ${done ? 'done' : ''} ${locked ? 'locked' : ''}`}>
            <input type="checkbox" checked={done} disabled={locked} onChange={() => toggle(t.item_key)} />
            <span>{t.label}</span>
          </label>
        );
      })}
    </div>
  );
}
