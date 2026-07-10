import { useState, useEffect, useCallback } from 'react';
import { automationApi, productsApi, categoriesApi } from '../../services/api';
import './Automation.css';

const SCOPES = ['website', 'pos', 'kiosk'];
const TRIGGERS = ['add_product', 'cart_open', 'checkout', 'payment', 'kitchen', 'delivery', 'scheduled', 'manual'];
const STEPS = ['General', 'Trigger', 'Conditions', 'Actions', 'Schedule & Limits', 'Review', 'Publish'];

const BLANK_RULE = {
  name: '', description: '', priority: 50, scope: 'website', trigger_type: 'cart_open',
  conditions: null, actions: [], schedule: {}, frequency_cap: { max_shows_per_session: 1, max_shows_per_customer_per_day: 1 },
  stop_processing: false,
};

export default function Automation() {
  const [rows, setRows] = useState([]);
  const [scopeFilter, setScopeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [toast, setToast] = useState(null);
  const [wizardRule, setWizardRule] = useState(null); // null = list view
  const [conditionTypes, setConditionTypes] = useState([]);
  const [actionTypes, setActionTypes] = useState([]);
  const [categoryActions, setCategoryActions] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [syncing, setSyncing] = useState(false);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);

  const [confetti, setConfetti] = useState(false);

  const flash = (msg, err = false) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 2800);
    if (!err && /publish/i.test(msg)) {
      setConfetti(true);
      setTimeout(() => setConfetti(false), 1400);
    }
  };

  const loadRules = useCallback(() => {
    automationApi.list({ scope: scopeFilter || undefined, status: statusFilter || undefined })
      .then(r => setRows(r.data)).catch(() => flash('Failed to load rules', true));
  }, [scopeFilter, statusFilter]);

  useEffect(() => { loadRules(); }, [loadRules]);
  useEffect(() => {
    automationApi.conditionTypes().then(r => setConditionTypes(r.data)).catch(() => {});
    automationApi.actionTypes().then(r => setActionTypes(r.data)).catch(() => {});
    automationApi.categoryActions().then(r => setCategoryActions(r.data)).catch(() => {});
    productsApi.list().then(r => setProducts(r.data.products || [])).catch(() => {});
    categoriesApi.list().then(r => setCategories(r.data.categories || r.data || [])).catch(() => {});
  }, []);

  async function publish(id) {
    try { await automationApi.publish(id); flash('Rule published'); loadRules(); }
    catch { flash('Publish failed', true); }
  }
  async function disable(id) {
    if (!confirm('Disable this rule? It will drop out of the next website sync.')) return;
    try { await automationApi.remove(id); flash('Rule disabled'); loadRules(); }
    catch { flash('Failed', true); }
  }
  async function purge(id) {
    if (!confirm('Permanently delete this rule and its version history? This cannot be undone.')) return;
    try {
      await automationApi.purge(id);
      setSelected(s => { const n = new Set(s); n.delete(id); return n; });
      flash('Rule deleted');
      loadRules();
    } catch { flash('Delete failed', true); }
  }

  function toggleSelect(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleSelectAll() {
    setSelected(s => s.size === rows.length ? new Set() : new Set(rows.map(r => r.id)));
  }

  async function syncToWebsite(onlySelected) {
    if (!scopeFilter) return flash('Pick a single scope filter before syncing', true);
    const ruleIds = onlySelected ? [...selected] : undefined;
    if (onlySelected && ruleIds.length === 0) return flash('No rules selected', true);
    const msg = onlySelected
      ? `Sync ${ruleIds.length} checked rule(s) to website? This overwrites the ${scopeFilter} scope — any published rule not checked will be removed from the website cache.`
      : `Sync ALL published ${scopeFilter} rules to website? This overwrites the whole ${scopeFilter} scope on the website.`;
    if (!confirm(msg)) return;
    setSyncing(true);
    try {
      const r = await automationApi.syncNow(scopeFilter, ruleIds);
      flash(`Synced to website (${r.data.result?.synced ?? 0} rule(s), overwrote ${scopeFilter} scope)`);
    } catch (e) {
      flash(e.response?.data?.error || 'Sync failed', true);
    } finally { setSyncing(false); }
  }

  return (
    <>
      {confetti && <ConfettiBurst />}

      {wizardRule ? (
        <RuleWizard
          rule={wizardRule}
          conditionTypes={conditionTypes}
          actionTypes={actionTypes}
          categoryActions={categoryActions}
          products={products}
          categories={categories}
          onClose={() => setWizardRule(null)}
          onSaved={() => { setWizardRule(null); loadRules(); }}
          flash={flash}
        />
      ) : (
        <div className="auto-page">
          <div className="auto-header">
            <h1>Automation Rules</h1>
            <button className="auto-btn auto-btn--primary" onClick={() => setWizardRule({ ...BLANK_RULE })}>+ New Rule</button>
          </div>

          <div className="auto-filters">
            <select value={scopeFilter} onChange={e => setScopeFilter(e.target.value)} title="Filter rules by channel">
              <option value="">All scopes</option>
              {SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} title="Filter rules by status">
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="disabled">Disabled</option>
            </select>
            <button className="auto-btn" disabled={syncing || !scopeFilter} onClick={() => syncToWebsite(true)}
              title="Push only the checked rules — full overwrite of this scope on the website">
              Sync Checked to Website
            </button>
            <button className="auto-btn" disabled={syncing || !scopeFilter} onClick={() => syncToWebsite(false)}
              title="Push every published rule in this scope — full overwrite of this scope on the website">
              Sync All ({scopeFilter || 'pick a scope'}) to Website
            </button>
          </div>
          <p className="auto-hint">Sync overwrites everything published under that scope on the website — rules left unchecked (or unpublished) are removed from the website's cache. Double-click a row to edit.</p>

          <table className="auto-table">
            <thead>
              <tr>
                <th><input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleSelectAll} title="Select all" /></th>
                <th>Name</th><th>Scope</th><th>Trigger</th><th>Priority</th><th>Status</th><th>Stop</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} onDoubleClick={() => setWizardRule(r)} className="auto-row-clickable" title="Double-click to edit">
                  <td><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} onClick={e => e.stopPropagation()} /></td>
                  <td>{r.name}</td>
                  <td>{r.scope}</td>
                  <td>{r.trigger_type}</td>
                  <td>{r.priority}</td>
                  <td><span className={`auto-badge auto-badge--${r.status}`}>{r.status}</span></td>
                  <td>{r.stop_processing ? '⛔' : ''}</td>
                  <td className="auto-row-actions">
                    <button onClick={() => setWizardRule(r)} title="Open the wizard to edit this rule">Edit</button>
                    {r.status !== 'published' && <button onClick={() => publish(r.id)} title="Snapshot + publish, syncs to website">Publish</button>}
                    {r.status !== 'disabled' && <button onClick={() => disable(r.id)} title="Soft-disable, drops out of next website sync">Disable</button>}
                    <button className="auto-btn--danger" onClick={() => purge(r.id)} title="Permanently delete rule + version history">Delete</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="auto-empty">No rules yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {toast && <div className={`auto-toast ${toast.err ? 'auto-toast--err' : ''}`}>{toast.msg}</div>}
    </>
  );
}

function ConfettiBurst() {
  const pieces = Array.from({ length: 24 });
  return (
    <div className="auto-confetti">
      {pieces.map((_, i) => <span key={i} className="auto-confetti-piece" style={{ '--i': i }} />)}
    </div>
  );
}

function RuleWizard({ rule, conditionTypes, actionTypes, categoryActions, products, categories, onClose, onSaved, flash }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(rule);
  const [testPayload, setTestPayload] = useState('{}');
  const [testResult, setTestResult] = useState(null);
  const isNew = !form.id;

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

  const actionCategories = [...new Set(categoryActions.map(c => c.category))];

  function toggleAction(actionKey) {
    const exists = form.actions.some(a => a.type === actionKey);
    set('actions', exists ? form.actions.filter(a => a.type !== actionKey) : [...form.actions, { type: actionKey, params: {} }]);
  }

  function updateActionParam(actionKey, param, value) {
    set('actions', form.actions.map(a => a.type === actionKey ? { ...a, params: { ...a.params, [param]: value } } : a));
  }

  async function save() {
    try {
      if (!form.name || !form.scope || !form.trigger_type) return flash('Name, scope and trigger required', true);
      if (isNew) {
        const r = await automationApi.create(form);
        setForm(f => ({ ...f, id: r.data.id }));
        flash('Rule created (draft)');
      } else {
        await automationApi.update(form.id, form);
        flash('Rule saved');
      }
    } catch { flash('Save failed', true); }
  }

  async function runTest() {
    try {
      if (!form.id) return flash('Save the rule first', true);
      let payload;
      try { payload = JSON.parse(testPayload); } catch { return flash('Invalid JSON', true); }
      const r = await automationApi.test(form.id, payload);
      setTestResult(r.data);
    } catch { flash('Test failed', true); }
  }

  async function publishNow() {
    try {
      if (!form.id) await save();
      await automationApi.publish(form.id);
      flash('Published');
      onSaved();
    } catch { flash('Publish failed', true); }
  }

  return (
    <div className="auto-page">
      <div className="auto-header">
        <h1>{isNew ? 'New Rule' : `Edit: ${form.name}`}</h1>
        <div className="auto-wizard-nav auto-wizard-nav--top">
          <button className="auto-btn" onClick={onClose}>← Back to list</button>
          <button disabled={step === 0} onClick={() => setStep(s => s - 1)}>← Prev</button>
          <button className="auto-btn" onClick={save}>Save</button>
          <button disabled={step === STEPS.length - 1} onClick={() => setStep(s => s + 1)}>Next →</button>
        </div>
      </div>

      <div className="auto-steps">
        {STEPS.map((s, i) => (
          <div key={s} className={`auto-step ${i === step ? 'auto-step--active' : ''}`} onClick={() => setStep(i)}>
            {i + 1}. {s}
          </div>
        ))}
      </div>

      <div className="auto-step-body">
        {step === 0 && (
          <div className="auto-form">
            <label>Name<input value={form.name} onChange={e => set('name', e.target.value)} /></label>
            <label>Description<textarea value={form.description || ''} onChange={e => set('description', e.target.value)} /></label>
            <label>Priority (1-100)<input type="number" min={1} max={100} value={form.priority} onChange={e => set('priority', Number(e.target.value))} /></label>
            <label>Scope
              <select value={form.scope} onChange={e => set('scope', e.target.value)}>
                {SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="auto-checkbox">
              <input type="checkbox" checked={!!form.stop_processing} onChange={e => set('stop_processing', e.target.checked)} />
              Stop Processing (halt lower-priority rules when this fires)
            </label>
          </div>
        )}

        {step === 1 && (
          <div className="auto-form">
            <label>Trigger event
              <select value={form.trigger_type} onChange={e => set('trigger_type', e.target.value)}>
                {TRIGGERS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          </div>
        )}

        {step === 2 && (
          <div className="auto-form">
            <ConditionGroup
              node={form.conditions || { and: [] }}
              onChange={node => set('conditions', node)}
              conditionTypes={conditionTypes}
              categories={categories}
              products={products}
            />
          </div>
        )}

        {step === 3 && (
          <div className="auto-form">
            {actionCategories.map(cat => (
              <div key={cat} className="auto-action-group">
                <div className="auto-action-group-title">{cat}</div>
                {categoryActions.filter(c => c.category === cat).map(c => {
                  const at = actionTypes.find(a => a.key === c.action_key);
                  if (!at) return null;
                  const chosen = form.actions.find(a => a.type === c.action_key);
                  const params = at.value_schema?.params || [];
                  return (
                    <div key={c.action_key} className="auto-action-item">
                      <label className="auto-checkbox">
                        <input type="checkbox" checked={!!chosen} onChange={() => toggleAction(c.action_key)} />
                        {at.label}
                      </label>
                      {chosen && params.length > 0 && (
                        <div className="auto-action-params">
                          {params.map(p => p.includes('product_id') ? (
                            <label key={p}>{p}
                              <select value={chosen.params?.[p] ?? ''} onChange={e => updateActionParam(c.action_key, p, e.target.value ? Number(e.target.value) : '')}>
                                <option value="">— select product —</option>
                                {products.map(prod => <option key={prod.id} value={prod.id}>{prod.name}</option>)}
                              </select>
                            </label>
                          ) : (
                            <label key={p}>{p}
                              <input value={chosen.params?.[p] ?? ''} onChange={e => updateActionParam(c.action_key, p, e.target.value)} />
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {step === 4 && (
          <div className="auto-form">
            <label>Max shows per session
              <input type="number" min={0} value={form.frequency_cap.max_shows_per_session ?? 1}
                onChange={e => set('frequency_cap', { ...form.frequency_cap, max_shows_per_session: Number(e.target.value) })} />
            </label>
            <label>Max shows per customer per day
              <input type="number" min={0} value={form.frequency_cap.max_shows_per_customer_per_day ?? 1}
                onChange={e => set('frequency_cap', { ...form.frequency_cap, max_shows_per_customer_per_day: Number(e.target.value) })} />
            </label>
            <label>Max shows per customer lifetime (optional)
              <input type="number" min={0} value={form.frequency_cap.max_shows_per_customer_lifetime ?? ''}
                onChange={e => set('frequency_cap', { ...form.frequency_cap, max_shows_per_customer_lifetime: e.target.value ? Number(e.target.value) : undefined })} />
            </label>
            <label>Cooldown between repeats (hours)
              <input type="number" min={0} value={form.frequency_cap.cooldown_hours ?? ''}
                onChange={e => set('frequency_cap', { ...form.frequency_cap, cooldown_hours: e.target.value ? Number(e.target.value) : undefined })} />
            </label>
          </div>
        )}

        {step === 5 && (
          <div className="auto-form">
            <pre className="auto-review">{JSON.stringify(form, null, 2)}</pre>
            <div className="auto-test-box">
              <label>Sample payload (JSON, sandbox only)
                <textarea value={testPayload} onChange={e => setTestPayload(e.target.value)} rows={4} />
              </label>
              <button className="auto-btn" onClick={runTest}>Save & Test (dry run)</button>
              {testResult && (
                <div className="auto-test-result">
                  Matched: <b>{String(testResult.matched)}</b> — actions: {testResult.actions.map(a => a.type).join(', ') || 'none'}
                </div>
              )}
            </div>
          </div>
        )}

        {step === 6 && (
          <div className="auto-form">
            <p>Status: <b>{form.status || 'draft'}</b></p>
            <div className="auto-publish-actions">
              <button className="auto-btn" onClick={save}>Save as Draft</button>
              <button className="auto-btn auto-btn--primary" onClick={publishNow}>Publish Now</button>
            </div>
          </div>
        )}
      </div>

      <div className="auto-wizard-nav">
        <button disabled={step === 0} onClick={() => setStep(s => s - 1)}>← Prev</button>
        <button onClick={save}>Save</button>
        <button disabled={step === STEPS.length - 1} onClick={() => setStep(s => s + 1)}>Next →</button>
      </div>
    </div>
  );
}

// Recursive AND/OR condition group. Node shape: { and: [...] } | { or: [...] }, children are
// either leaf conditions ({ type, value }) or nested groups.
function ConditionGroup({ node, onChange, conditionTypes, categories, products, depth = 0 }) {
  const op = node.or ? 'or' : 'and';
  const children = node[op] || [];

  const updateChild = (i, child) => onChange({ [op]: children.map((c, idx) => idx === i ? child : c) });
  const removeChild = (i) => {
    const next = children.filter((_, idx) => idx !== i);
    onChange(next.length ? { [op]: next } : { [op]: [] });
  };
  const addLeaf = () => {
    const first = conditionTypes[0];
    if (!first) return;
    onChange({ [op]: [...children, { type: first.key, value: '' }] });
  };
  const addGroup = () => onChange({ [op]: [...children, { and: [] }] });
  const toggleOp = () => onChange({ [op === 'and' ? 'or' : 'and']: children });

  return (
    <div className="auto-cond-group" style={depth ? { marginLeft: 20 } : undefined}>
      <div className="auto-cond-group-header">
        <button type="button" className="auto-btn auto-op-toggle" onClick={toggleOp}>{op.toUpperCase()}</button>
        <span className="auto-hint">match {op === 'and' ? 'ALL' : 'ANY'} of:</span>
      </div>
      {children.map((child, i) => (
        (child.and || child.or) ? (
          <div key={i} className="auto-cond-nested">
            <ConditionGroup
              node={child}
              onChange={c => updateChild(i, c)}
              conditionTypes={conditionTypes}
              categories={categories}
              products={products}
              depth={depth + 1}
            />
            <button type="button" className="auto-btn" onClick={() => removeChild(i)}>✕ remove group</button>
          </div>
        ) : (
          <div key={i} className="auto-condition-row">
            <select value={child.type} onChange={e => updateChild(i, { type: e.target.value, value: '' })}>
              {conditionTypes.map(ct => <option key={ct.key} value={ct.key}>{ct.label}</option>)}
            </select>
            <ValueInput
              ct={conditionTypes.find(ct => ct.key === child.type)}
              value={child.value}
              onChange={v => updateChild(i, { ...child, value: v })}
              categories={categories}
              products={products}
            />
            <button type="button" onClick={() => removeChild(i)}>✕</button>
          </div>
        )
      ))}
      <div className="auto-cond-add-row">
        <button type="button" className="auto-btn" onClick={addLeaf}>+ condition</button>
        <button type="button" className="auto-btn" onClick={addGroup}>+ group ({op === 'and' ? 'OR' : 'AND'} block)</button>
      </div>
    </div>
  );
}

// Typed value input picked by the condition type's value_schema (field/op/valueType) —
// dropdowns for category/product IDs instead of raw numeric entry, matching what the
// engine (server/services/automationEngine.js evalLeaf) actually compares against.
function ValueInput({ ct, value, onChange, categories, products }) {
  if (!ct) return <input placeholder="value" value={value ?? ''} onChange={e => onChange(e.target.value)} />;
  const { field, op, valueType } = ct.value_schema || {};

  if (field === 'category_id' && op === 'in') {
    const arr = Array.isArray(value) ? value.map(String) : [];
    return (
      <select multiple className="auto-multiselect" value={arr}
        onChange={e => onChange([...e.target.selectedOptions].map(o => Number(o.value)))}>
        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    );
  }
  if (field === 'product_id' && op === 'in') {
    const arr = Array.isArray(value) ? value.map(String) : [];
    return (
      <select multiple className="auto-multiselect" value={arr}
        onChange={e => onChange([...e.target.selectedOptions].map(o => Number(o.value)))}>
        {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    );
  }
  if (field === 'cart_categories') {
    return (
      <select value={value ?? ''} onChange={e => onChange(e.target.value ? Number(e.target.value) : '')}>
        <option value="">— pick category —</option>
        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    );
  }
  if (op === 'between') {
    const [lo, hi] = Array.isArray(value) ? value : ['', ''];
    return (
      <span className="auto-range">
        <input type="number" placeholder="min" value={lo} onChange={e => onChange([e.target.value === '' ? '' : Number(e.target.value), hi])} />
        <input type="number" placeholder="max" value={hi} onChange={e => onChange([lo, e.target.value === '' ? '' : Number(e.target.value)])} />
      </span>
    );
  }
  if (field === 'day_of_week') {
    const arr = Array.isArray(value) ? value : [];
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return (
      <span className="auto-dow">
        {DAYS.map((d, i) => (
          <label key={i} className="auto-dow-chip">
            <input type="checkbox" checked={arr.includes(i)} onChange={() => onChange(arr.includes(i) ? arr.filter(x => x !== i) : [...arr, i].sort())} />
            {d}
          </label>
        ))}
      </span>
    );
  }
  if (valueType === 'boolean') {
    return (
      <select value={value === true ? 'true' : value === false ? 'false' : ''}
        onChange={e => onChange(e.target.value === '' ? '' : e.target.value === 'true')}>
        <option value="">—</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (valueType === 'number') {
    return <input type="number" value={value ?? ''} onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
  }
  return <input placeholder="value" value={value ?? ''} onChange={e => onChange(e.target.value)} />;
}
