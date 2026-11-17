import { useState, useEffect, useCallback } from 'react';
import { campaignsApi } from '../../services/api';
import RuleBuilder from './RuleBuilder';
import useResizableColumns from './useResizableColumns';

/* ════════════════ TEMPLATES ════════════════ */
export function TemplatesPanel({ channels, flash }) {
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState(null);
  const load = useCallback(() => campaignsApi.templates().then((r) => setRows(r.data)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const blank = { name: '', channel: channels[0]?.key || 'SMS', type_key: '', subject: '', body: '' };
  async function save() {
    try {
      if (edit.id) await campaignsApi.updateTemplate(edit.id, edit);
      else await campaignsApi.createTemplate(edit);
      flash('Template saved'); setEdit(null); load();
    } catch (e) { flash(e?.response?.data?.error || 'Save failed', true); }
  }
  async function remove(id) {
    if (!confirm('Delete template?')) return;
    try { await campaignsApi.removeTemplate(id); flash('Deleted'); load(); } catch { flash('Failed', true); }
  }

  return (
    <div className="cmp-panel">
      <div className="cmp-panel-head"><h3>Templates</h3><button className="cmp-btn primary" onClick={() => setEdit(blank)}>+ New Template</button></div>
      <table className="cmp-table">
        <thead><tr><th>Name</th><th>Channel</th><th>Type</th><th>Body</th><th></th></tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td><td><span className="cmp-chip">{t.channel}</span></td><td>{t.type_key || '—'}</td>
              <td className="cmp-muted cmp-clip">{t.body}</td>
              <td className="cmp-row-actions">
                <button onClick={() => setEdit(t)}>Edit</button>
                <button className="danger" onClick={() => remove(t.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={5} className="cmp-empty">No templates yet.</td></tr>}
        </tbody>
      </table>

      {edit && (
        <div className="cmp-modal-overlay" onClick={() => setEdit(null)}>
          <div className="cmp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cmp-modal-head"><h3>{edit.id ? 'Edit' : 'New'} Template</h3><button className="cmp-btn-x" onClick={() => setEdit(null)}>✕</button></div>
            <div className="cmp-modal-body cmp-form">
              <label>Name<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
              <label>Channel
                <select value={edit.channel} onChange={(e) => setEdit({ ...edit, channel: e.target.value })}>
                  {channels.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </label>
              <label>Type key (optional)<input value={edit.type_key || ''} onChange={(e) => setEdit({ ...edit, type_key: e.target.value })} placeholder="birthday" /></label>
              <label>Subject (email/push)<input value={edit.subject || ''} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} /></label>
              <label>Body<textarea rows={4} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })}
                placeholder="Hi {{name}}, enjoy {{reward}}! Code {{coupon}} valid till {{valid_until}}." /></label>
              <p className="cmp-hint">Tokens: {'{{name}} {{reward}} {{coupon}} {{valid_until}} {{tier}} {{loyalty_points}} {{message}}'}</p>
            </div>
            <div className="cmp-modal-foot"><button className="cmp-btn" onClick={() => setEdit(null)}>Cancel</button><button className="cmp-btn primary" onClick={save}>Save</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ AUDIENCES ════════════════ */
export function AudiencesPanel({ fields, flash }) {
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState(null);
  const [count, setCount] = useState(null);
  const load = useCallback(() => campaignsApi.audiences().then((r) => setRows(r.data)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!edit) return;
    const t = setTimeout(() => campaignsApi.audienceCount({ rules: edit.rules }).then((r) => setCount(r.data.total)).catch(() => setCount(null)), 400);
    return () => clearTimeout(t);
  }, [edit]);

  const allFields = [...(fields.scalar || []), ...(fields.existence || [])];
  async function save() {
    try {
      if (edit.id) await campaignsApi.updateAudience(edit.id, edit);
      else await campaignsApi.createAudience(edit);
      flash('Segment saved'); setEdit(null); load();
    } catch (e) { flash(e?.response?.data?.error || 'Save failed', true); }
  }
  async function remove(id) { if (!confirm('Delete segment?')) return; try { await campaignsApi.removeAudience(id); load(); } catch { flash('Failed', true); } }

  return (
    <div className="cmp-panel">
      <div className="cmp-panel-head"><h3>Audience Segments</h3><button className="cmp-btn primary" onClick={() => { setEdit({ name: '', description: '', rules: { and: [] } }); setCount(null); }}>+ New Segment</button></div>
      <div className="cmp-cards">
        {rows.map((a) => (
          <div key={a.id} className="cmp-card">
            <div className="cmp-card-title">{a.name}</div>
            <div className="cmp-muted">{a.description || 'No description'}</div>
            <div className="cmp-row-actions">
              <button onClick={() => setEdit({ ...a, rules: a.rules || { and: [] } })}>Edit</button>
              <button className="danger" onClick={() => remove(a.id)}>Delete</button>
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="cmp-empty">No saved segments.</div>}
      </div>

      {edit && (
        <div className="cmp-modal-overlay" onClick={() => setEdit(null)}>
          <div className="cmp-modal cmp-builder" onClick={(e) => e.stopPropagation()}>
            <div className="cmp-modal-head"><h3>{edit.id ? 'Edit' : 'New'} Segment</h3><button className="cmp-btn-x" onClick={() => setEdit(null)}>✕</button></div>
            <div className="cmp-modal-body">
              <div className="cmp-form">
                <label>Name<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
                <label>Description<input value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></label>
              </div>
              <div className="cmp-count-badge">Matches <b>{count ?? '…'}</b> customers</div>
              <RuleBuilder value={edit.rules} onChange={(v) => setEdit({ ...edit, rules: v })} fields={allFields} />
            </div>
            <div className="cmp-modal-foot"><button className="cmp-btn" onClick={() => setEdit(null)}>Cancel</button><button className="cmp-btn primary" onClick={save}>Save</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════ COUPONS ════════════════ */
const DISCOUNT_TYPES = ['percentage', 'flat', 'free_item', 'combo', 'bogo', 'delivery'];
export function CouponsPanel({ flash }) {
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState(null);
  const gridRef = useResizableColumns('coupons');
  const load = useCallback(() => campaignsApi.coupons().then((r) => setRows(r.data)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const blank = {
    name: '', discount_type: 'percentage', value: 10, code_prefix: 'MTC', min_order_amount: 0,
    max_discount: '', unique_per_customer: 1, usage_limit_per_customer: 1, usage_limit_total: '',
    valid_from: '', valid_until: '', status: 'active',
  };
  async function save() {
    try {
      const payload = { ...edit, max_discount: edit.max_discount === '' ? null : Number(edit.max_discount), usage_limit_total: edit.usage_limit_total === '' ? null : Number(edit.usage_limit_total) };
      if (edit.id) await campaignsApi.updateCoupon(edit.id, payload);
      else await campaignsApi.createCoupon(payload);
      flash('Coupon saved'); setEdit(null); load();
    } catch (e) { flash(e?.response?.data?.error || 'Save failed', true); }
  }
  async function remove(id) { if (!confirm('Disable coupon?')) return; try { await campaignsApi.removeCoupon(id); load(); } catch { flash('Failed', true); } }

  return (
    <div className="cmp-panel">
      <div className="cmp-panel-head"><h3>Coupons</h3><button className="cmp-btn primary" onClick={() => setEdit(blank)}>+ New Coupon</button></div>
      <table className="cmp-table" ref={gridRef}>
        <thead><tr><th>Name</th><th>Type</th><th>Value</th><th>Limits</th><th>Valid until</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {rows.map((cp) => (
            <tr key={cp.id}>
              <td>{cp.name}</td><td><span className="cmp-chip">{cp.discount_type}</span></td><td>{cp.value}</td>
              <td className="cmp-muted">{cp.usage_limit_per_customer}/cust{cp.usage_limit_total ? ` · ${cp.usage_limit_total} total` : ''}</td>
              <td className="cmp-muted">{cp.valid_until ? String(cp.valid_until).slice(0, 10) : '—'}</td>
              <td><span className={`cmp-status ${cp.status}`}>{cp.status}</span></td>
              <td className="cmp-row-actions"><button onClick={() => setEdit(cp)}>Edit</button><button className="danger" onClick={() => remove(cp.id)}>Disable</button></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="cmp-empty">No coupons yet.</td></tr>}
        </tbody>
      </table>

      {edit && (
        <div className="cmp-modal-overlay" onClick={() => setEdit(null)}>
          <div className="cmp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cmp-modal-head"><h3>{edit.id ? 'Edit' : 'New'} Coupon</h3><button className="cmp-btn-x" onClick={() => setEdit(null)}>✕</button></div>
            <div className="cmp-modal-body cmp-form cmp-grid2">
              <label>Name<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
              <label>Discount type
                <select value={edit.discount_type} onChange={(e) => setEdit({ ...edit, discount_type: e.target.value })}>
                  {DISCOUNT_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <label>Value<input type="number" value={edit.value} onChange={(e) => setEdit({ ...edit, value: Number(e.target.value) })} /></label>
              <label>Code prefix<input value={edit.code_prefix || ''} onChange={(e) => setEdit({ ...edit, code_prefix: e.target.value })} /></label>
              <label>Min order<input type="number" value={edit.min_order_amount} onChange={(e) => setEdit({ ...edit, min_order_amount: Number(e.target.value) })} /></label>
              <label>Max discount<input type="number" value={edit.max_discount ?? ''} onChange={(e) => setEdit({ ...edit, max_discount: e.target.value })} /></label>
              <label>Per-customer limit<input type="number" value={edit.usage_limit_per_customer} onChange={(e) => setEdit({ ...edit, usage_limit_per_customer: Number(e.target.value) })} /></label>
              <label>Total limit<input type="number" value={edit.usage_limit_total ?? ''} onChange={(e) => setEdit({ ...edit, usage_limit_total: e.target.value })} /></label>
              <label>Valid from<input type="datetime-local" value={edit.valid_from || ''} onChange={(e) => setEdit({ ...edit, valid_from: e.target.value })} /></label>
              <label>Valid until<input type="datetime-local" value={edit.valid_until || ''} onChange={(e) => setEdit({ ...edit, valid_until: e.target.value })} /></label>
              <label className="cmp-check"><input type="checkbox" checked={!!edit.unique_per_customer} onChange={(e) => setEdit({ ...edit, unique_per_customer: e.target.checked ? 1 : 0 })} /> Unique code per customer</label>
            </div>
            <div className="cmp-modal-foot"><button className="cmp-btn" onClick={() => setEdit(null)}>Cancel</button><button className="cmp-btn primary" onClick={save}>Save</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
