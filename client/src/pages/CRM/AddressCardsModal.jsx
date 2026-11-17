import { useState, useEffect } from 'react';
import './AddressCardsModal.css';

const BLANK = { label: 'Home', address_line: '', city: '', phone: '' };
const LABELS = ['Home', 'Work', 'Other'];
const MAX_ADDRESSES = 3;

// Accepts an optional leading "+<country code>" then digits.
function isValidPhone(v) { return !v || /^\+?\d{7,15}$/.test(String(v).trim()); }

export default function AddressCardsModal({ customer, api, flash, onClose }) {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);   // address id being edited, or 'new'
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  const load = () => api.get(`/crm/customers/${customer.phone}/addresses`).then(r => setRows(r.data)).catch(() => {});
  useEffect(() => { load(); }, [customer.phone]);

  function startNew() {
    setForm({ ...BLANK, is_default: rows.length === 0 });
    setEditing('new');
  }
  function startEdit(a) {
    setForm({ label: a.label, address_line: a.address_line, city: a.city || '', phone: a.phone || '' });
    setEditing(a.id);
  }

  async function save() {
    if (!form.address_line.trim()) return flash('Address line is required', true);
    if (!isValidPhone(form.phone)) return flash('Phone must be 7–15 digits, optional leading +country code', true);
    setSaving(true);
    try {
      if (editing === 'new') {
        await api.post(`/crm/customers/${customer.phone}/addresses`, form);
        flash('Address added');
      } else {
        await api.put(`/crm/addresses/${editing}`, form);
        flash('Address updated');
      }
      setEditing(null);
      load();
    } catch (e) {
      flash(e.response?.data?.error ?? 'Save failed', true);
    } finally { setSaving(false); }
  }

  async function makeDefault(id) {
    try { await api.post(`/crm/addresses/${id}/default`); load(); } catch { flash('Failed', true); }
  }
  async function remove(id) {
    if (!confirm('Delete this address?')) return;
    try { await api.delete(`/crm/addresses/${id}`); load(); flash('Address deleted'); } catch { flash('Failed', true); }
  }

  return (
    <div className="craddr-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="craddr-modal">
        <div className="craddr-head">
          <h3>Addresses — {customer.name}</h3>
          <button className="craddr-x" onClick={onClose}>✕</button>
        </div>

        <div className="craddr-body">
          <div className="craddr-cards">
            {rows.map(a => (
              <div key={a.id} className={`craddr-card ${a.is_default ? 'default' : ''}`}>
                {editing === a.id ? (
                  <AddressForm form={form} setForm={setForm} onSave={save} onCancel={() => setEditing(null)} saving={saving} />
                ) : (
                  <>
                    <div className="craddr-card-head">
                      <span className="craddr-label">{a.label}</span>
                      {a.is_default
                        ? <span className="craddr-default-chip">Default</span>
                        : <button className="craddr-mini" onClick={() => makeDefault(a.id)}>Set default</button>}
                    </div>
                    <div className="craddr-line">{a.address_line}</div>
                    {a.city && <div className="craddr-sub">{a.city}</div>}
                    {a.phone && <div className="craddr-sub">☎ {a.phone}</div>}
                    <div className="craddr-actions">
                      <button className="craddr-mini" onClick={() => startEdit(a)}>Edit</button>
                      <button className="craddr-mini danger" onClick={() => remove(a.id)}>Delete</button>
                    </div>
                  </>
                )}
              </div>
            ))}

            {editing === 'new' && (
              <div className="craddr-card">
                <AddressForm form={form} setForm={setForm} onSave={save} onCancel={() => setEditing(null)} saving={saving} isNew />
              </div>
            )}
          </div>

          {rows.length === 0 && editing !== 'new' && (
            <div className="craddr-empty">No addresses yet.</div>
          )}

          {editing === null && rows.length < MAX_ADDRESSES && (
            <button className="craddr-add" onClick={startNew}>+ Add Address ({rows.length}/{MAX_ADDRESSES})</button>
          )}
          {rows.length >= MAX_ADDRESSES && editing === null && (
            <div className="craddr-limit">Maximum of {MAX_ADDRESSES} addresses reached.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function AddressForm({ form, setForm, onSave, onCancel, saving, isNew }) {
  return (
    <div className="craddr-form">
      <label>Label
        <select value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}>
          {LABELS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </label>
      <label>Address
        <textarea rows={2} value={form.address_line} onChange={e => setForm(f => ({ ...f, address_line: e.target.value }))} autoFocus={isNew} />
      </label>
      <label>City
        <input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
      </label>
      <label>Phone (optional, international code allowed)
        <input placeholder="+977 98…" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
      </label>
      <div className="craddr-form-actions">
        <button className="craddr-mini primary" disabled={saving} onClick={onSave}>Save</button>
        <button className="craddr-mini" disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
