import { useState, useMemo } from 'react';
import './AddressCardsModal.css';
import './MergeManyModal.css';

const FIELDS = [
  { key: 'name',          label: 'Name',      required: true },
  { key: 'phone2',        label: 'Phone 2' },
  { key: 'country_code',  label: 'Country' },
  { key: 'company_name',  label: 'Company' },
  { key: 'job_title',     label: 'Job Title' },
  { key: 'email',         label: 'Email' },
  { key: 'email2',        label: 'Email 2' },
  { key: 'birthday',      label: 'Birthday' },
  { key: 'anniversary',   label: 'Anniversary' },
  { key: 'address',       label: 'Address' },
  { key: 'notes',         label: 'Notes' },
  { key: 'rewards_tier',  label: 'Tier' },
  { key: 'loyalty_points', label: 'Points' },
];

const initials = name => (name || '?').trim().split(/\s+/).slice(0,2).map(w => w[0]?.toUpperCase()).join('');

// Merge N selected contacts into one. Pick a primary (survivor phone stays),
// then per field pick which contact's value wins, and which labels carry over.
export default function MergeManyModal({ contacts, api, flash, onClose, onMerged }) {
  const [primary, setPrimary] = useState(contacts[0].phone);
  const [busy, setBusy] = useState(false);

  // field -> phone of the contact whose value wins
  const [choice, setChoice] = useState(() => defaultChoices(contacts, contacts[0].phone));

  function defaultChoices(list, primaryPhone) {
    const out = {};
    for (const f of FIELDS) {
      const withVal = list.find(c => c.phone === primaryPhone && String(c[f.key] ?? '').trim())
        || list.find(c => String(c[f.key] ?? '').trim());
      out[f.key] = withVal ? withVal.phone : primaryPhone;
    }
    return out;
  }

  function pickPrimary(phone) {
    setPrimary(phone);
    setChoice(defaultChoices(contacts, phone));
  }

  const allTagsUnion = useMemo(() => {
    const map = new Map();
    for (const c of contacts) for (const t of c.tags || []) if (t.source !== 'system') map.set(t.id, t);
    return [...map.values()];
  }, [contacts]);
  const [tagSel, setTagSel] = useState(() => new Set(allTagsUnion.map(t => t.id)));

  function fieldOptions(key) {
    const seen = new Map(); // value -> phone (first owner)
    for (const c of contacts) {
      const v = String(c[key] ?? '').trim();
      if (v && !seen.has(v)) seen.set(v, c.phone);
    }
    return [...seen.entries()]; // [[value, phone], ...]
  }

  async function doMerge() {
    const resolved = {};
    for (const f of FIELDS) {
      const owner = contacts.find(c => c.phone === choice[f.key]);
      resolved[f.key] = owner ? (owner[f.key] ?? '') : '';
    }
    if (!String(resolved.name || '').trim()) return flash('Name cannot be blank', true);

    setBusy(true);
    try {
      await api.post('/crm/customers/merge-many', {
        phones: contacts.map(c => c.phone),
        survivor_phone: primary,
        resolved,
        tag_ids: [...tagSel],
      });
      flash(`${contacts.length} contacts merged into ${resolved.name}`);
      onMerged();
    } catch (e) { flash(e.response?.data?.error ?? 'Merge failed', true); }
    finally { setBusy(false); }
  }

  return (
    <div className="craddr-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="craddr-modal mrg-modal">
        <div className="craddr-head">
          <h3>Merge {contacts.length} Contacts → 1</h3>
          <button className="craddr-x" onClick={onClose}>✕</button>
        </div>

        <div className="craddr-body mrg-body">
          {/* Contact cards — pick primary (its phone number is kept) */}
          <div className="mrg-cards">
            {contacts.map(c => (
              <button key={c.phone} className={`mrg-card ${primary === c.phone ? 'sel' : ''}`} onClick={() => pickPrimary(c.phone)}>
                <span className="mrg-avatar">{initials(c.name)}</span>
                <span className="mrg-card-name">{c.name}</span>
                <span className="mrg-card-phone">{c.phone}</span>
                {primary === c.phone && <span className="mrg-card-tag">Primary · phone kept</span>}
              </button>
            ))}
          </div>
          <div className="mrg-hint">Primary contact's phone number survives. Pick which value wins for every other field below.</div>

          {/* Field-by-field winner picker */}
          <div className="mrg-fields">
            {FIELDS.map(f => {
              const opts = fieldOptions(f.key);
              if (!opts.length) return null;
              return (
                <div className="mrg-field-row" key={f.key}>
                  <div className="mrg-field-label">{f.label}</div>
                  <div className="mrg-field-opts">
                    {opts.map(([value, phone]) => (
                      <label key={phone} className={`mrg-opt ${choice[f.key] === phone ? 'on' : ''}`}>
                        <input type="radio" name={`mrg-${f.key}`} checked={choice[f.key] === phone}
                          onChange={() => setChoice(ch => ({ ...ch, [f.key]: phone }))} />
                        <span className="mrg-opt-val">{value}</span>
                        {phone === primary && <span className="mrg-opt-badge">primary</span>}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Labels — union, deselect any that shouldn't carry over */}
          {allTagsUnion.length > 0 && (
            <div className="mrg-tags">
              <div className="mrg-field-label">Labels to keep</div>
              <div className="mrg-tag-chips">
                {allTagsUnion.map(t => (
                  <label key={t.id} className={`mrg-tagchip ${tagSel.has(t.id) ? 'on' : ''}`} style={{ '--chip': t.color }}>
                    <input type="checkbox" checked={tagSel.has(t.id)}
                      onChange={() => setTagSel(s => { const n = new Set(s); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })} />
                    {t.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="craddr-form-actions" style={{ marginTop: 14 }}>
            <button className="craddr-mini primary" disabled={busy} onClick={doMerge}>
              {busy ? 'Merging…' : `Merge into ${contacts.find(c=>c.phone===primary)?.name || 'primary'}`}
            </button>
            <button className="craddr-mini" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
