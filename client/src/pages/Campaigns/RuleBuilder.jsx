import { useMemo } from 'react';

/**
 * Nested AND/OR rule builder — edits a rule tree of the shape the backend
 * rule engine / audience builder consume:
 *   { and: [ node… ] } | { or: [ node… ] } | { field, op, value }
 * Unlimited nesting depth; groups can hold leaves and sub-groups.
 */

const OPERATORS = [
  ['eq', '='], ['neq', '≠'], ['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤'],
  ['between', 'between'], ['in', 'in'], ['not_in', 'not in'],
  ['contains', 'contains'], ['not_contains', 'not contains'],
  ['starts_with', 'starts with'], ['ends_with', 'ends with'],
  ['exists', 'exists'], ['not_exists', 'is empty'],
  ['is_true', 'is true'], ['is_false', 'is false'],
];

const NO_VALUE = new Set(['exists', 'not_exists', 'is_true', 'is_false']);

function normalizeGroup(node) {
  if (node && Array.isArray(node.or)) return { op: 'or', items: node.or };
  if (node && Array.isArray(node.and)) return { op: 'and', items: node.and };
  if (node && Array.isArray(node)) return { op: 'and', items: node };
  return { op: 'and', items: node && typeof node === 'object' && 'field' in node ? [node] : [] };
}

function buildGroup(op, items) { return { [op]: items }; }

export default function RuleBuilder({ value, onChange, fields = [] }) {
  const group = useMemo(() => normalizeGroup(value), [value]);

  const setGroup = (op, items) => onChange(buildGroup(op, items));
  const setItem = (idx, next) => setGroup(group.op, group.items.map((it, i) => (i === idx ? next : it)));
  const removeItem = (idx) => setGroup(group.op, group.items.filter((_, i) => i !== idx));
  const addLeaf = () => setGroup(group.op, [...group.items, { field: fields[0] || 'visit_count', op: 'gte', value: '' }]);
  const addGroup = () => setGroup(group.op, [...group.items, { and: [] }]);

  return (
    <div className="cmp-rule-group">
      <div className="cmp-rule-grouphead">
        <div className="cmp-seg">
          <button className={group.op === 'and' ? 'on' : ''} onClick={() => setGroup('and', group.items)} type="button">ALL (AND)</button>
          <button className={group.op === 'or' ? 'on' : ''} onClick={() => setGroup('or', group.items)} type="button">ANY (OR)</button>
        </div>
        <div className="cmp-rule-actions">
          <button className="cmp-btn-mini" onClick={addLeaf} type="button">+ Condition</button>
          <button className="cmp-btn-mini" onClick={addGroup} type="button">+ Group</button>
        </div>
      </div>

      {group.items.length === 0 && <div className="cmp-rule-empty">Matches everyone — add a condition to narrow.</div>}

      <div className="cmp-rule-items">
        {group.items.map((item, i) => {
          const isGroup = item && (Array.isArray(item.and) || Array.isArray(item.or));
          return (
            <div key={i} className="cmp-rule-row">
              {isGroup ? (
                <div className="cmp-rule-nested">
                  <RuleBuilder value={item} onChange={(n) => setItem(i, n)} fields={fields} />
                </div>
              ) : (
                <LeafEditor leaf={item} fields={fields} onChange={(n) => setItem(i, n)} />
              )}
              <button className="cmp-btn-x" onClick={() => removeItem(i)} type="button" title="Remove">✕</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LeafEditor({ leaf, fields, onChange }) {
  const set = (patch) => onChange({ ...leaf, ...patch });
  const showValue = !NO_VALUE.has(leaf.op);
  return (
    <div className="cmp-leaf">
      <select value={leaf.field} onChange={(e) => set({ field: e.target.value })}>
        {fields.map((f) => <option key={f} value={f}>{f}</option>)}
        {!fields.includes(leaf.field) && <option value={leaf.field}>{leaf.field}</option>}
      </select>
      <select value={leaf.op} onChange={(e) => set({ op: e.target.value })}>
        {OPERATORS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {showValue && (
        leaf.op === 'in' || leaf.op === 'not_in' || leaf.op === 'between' ? (
          <input
            placeholder={leaf.op === 'between' ? 'min, max' : 'comma,separated'}
            value={Array.isArray(leaf.value) ? leaf.value.join(', ') : (leaf.value ?? '')}
            onChange={(e) => set({ value: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
          />
        ) : (
          <input value={leaf.value ?? ''} onChange={(e) => set({ value: e.target.value })} placeholder="value" />
        )
      )}
    </div>
  );
}
