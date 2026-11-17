import { useState, useEffect, useCallback } from 'react';
import { campaignsApi } from '../../services/api';
import CampaignBuilder from './CampaignBuilder';
import { TemplatesPanel, AudiencesPanel, CouponsPanel } from './panels';
import useResizableColumns from './useResizableColumns';
import './Campaigns.css';

const TABS = ['Dashboard', 'Campaigns', 'Templates', 'Audiences', 'Coupons', 'Queue', 'Settings'];
const STATUS_COLORS = {
  draft: '#9c8870', pending_approval: '#d97706', approved: '#0891b2', scheduled: '#7c3aed',
  active: '#10b981', paused: '#b45309', completed: '#2563eb', archived: '#9ca3af', rejected: '#c0392b',
};
const STATUS_LABELS = {
  '': 'All', draft: 'Drafts', pending_approval: 'Awaiting Approval', approved: 'Approved',
  scheduled: 'Scheduled', active: 'Live', paused: 'Paused', completed: 'Completed',
  archived: 'Archived', rejected: 'Rejected',
};

export default function Campaigns() {
  const [tab, setTab] = useState('Dashboard');
  const [toast, setToast] = useState(null);
  const [types, setTypes] = useState([]);
  const [channels, setChannels] = useState([]);
  const [coupons, setCoupons] = useState([]);
  const [fields, setFields] = useState({ scalar: [], existence: [] });
  const [perms, setPerms] = useState([]);
  const [builder, setBuilder] = useState(null); // { id } | { id: null }

  const flash = (msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 2800); };

  useEffect(() => {
    campaignsApi.types().then((r) => setTypes(r.data)).catch(() => {});
    campaignsApi.channels().then((r) => setChannels(r.data)).catch(() => {});
    campaignsApi.coupons().then((r) => setCoupons(r.data)).catch(() => {});
    campaignsApi.audienceFields().then((r) => setFields(r.data)).catch(() => {});
    campaignsApi.permissions().then((r) => setPerms(r.data.me?.permissions || [])).catch(() => {});
  }, []);

  const reloadChannels = () => campaignsApi.channels().then((r) => setChannels(r.data)).catch(() => {});

  return (
    <div className="cmp-root">
      <div className="cmp-tabs">
        {TABS.map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}
      </div>

      <div className="cmp-content">
        {tab === 'Dashboard' && <Dashboard flash={flash} />}
        {tab === 'Campaigns' && <CampaignList types={types} onEdit={(id) => setBuilder({ id })} onNew={() => setBuilder({ id: null })} flash={flash} statusColors={STATUS_COLORS} />}
        {tab === 'Templates' && <TemplatesPanel channels={channels} flash={flash} />}
        {tab === 'Audiences' && <AudiencesPanel fields={fields} flash={flash} />}
        {tab === 'Coupons' && <CouponsPanel flash={flash} />}
        {tab === 'Queue' && <QueuePanel flash={flash} perms={perms} />}
        {tab === 'Settings' && <SettingsPanel channels={channels} perms={perms} onChange={reloadChannels} flash={flash} />}
      </div>

      {builder && (
        <CampaignBuilder id={builder.id} types={types} channels={channels} coupons={coupons} fields={fields}
          onClose={() => setBuilder(null)} onSaved={() => { setBuilder(null); }} flash={flash} />
      )}

      {toast && <div className={`cmp-toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}

/* ════════════════ DASHBOARD ════════════════ */
function Dashboard({ flash }) {
  const [data, setData] = useState(null);
  useEffect(() => { campaignsApi.dashboard().then((r) => setData(r.data)).catch(() => flash('Failed to load dashboard', true)); }, []);
  if (!data) return <div className="cmp-empty">Loading…</div>;
  const o = data.overview;
  const money = (n) => 'Rs ' + Math.round(Number(n) || 0).toLocaleString();
  const pct = (n) => (n == null ? '—' : (Number(n) * 100).toFixed(1) + '%');

  return (
    <div className="cmp-dash">
      <div className="cmp-stats">
        <Stat label="Active Campaigns" value={o.campaigns.active} sub={`${o.campaigns.total} total`} />
        <Stat label="Revenue Attributed" value={money(o.revenue)} sub={`${o.orders} orders`} />
        <Stat label="ROI" value={o.roi == null ? '—' : o.roi.toFixed(0) + '%'} sub={`cost ${money(o.cost)}`} />
        <Stat label="Messages Sent" value={o.messages_sent} sub={`${o.customers} customers`} />
        <Stat label="Coupons Redeemed" value={o.coupons.redeemed} sub={`${pct(o.coupons.redemption_rate)} of ${o.coupons.issued}`} />
        <Stat label="Avg Ticket" value={money(o.avg_ticket)} sub="per attributed order" />
        <Stat label="Pending Approval" value={o.campaigns.pending} sub="awaiting release" />
        <Stat label="Discount Given" value={money(o.coupons.discount_given)} sub="all campaigns" />
      </div>

      <div className="cmp-dash-cols">
        <div className="cmp-panel">
          <h3>Top Campaigns by Revenue</h3>
          <table className="cmp-table">
            <thead><tr><th>Campaign</th><th>Type</th><th>Revenue</th><th>Orders</th></tr></thead>
            <tbody>
              {data.leaderboard.map((c) => (
                <tr key={c.id}><td>{c.name}</td><td className="cmp-muted">{c.type_key}</td><td>{money(c.revenue)}</td><td>{c.orders}</td></tr>
              ))}
              {data.leaderboard.length === 0 && <tr><td colSpan={4} className="cmp-empty">No conversions yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="cmp-panel">
          <h3>Customer Growth</h3>
          <MiniBars data={data.growth} xKey="month" yKey="new_customers" />
        </div>
      </div>
    </div>
  );
}

const Stat = ({ label, value, sub }) => (
  <div className="cmp-stat"><div className="cmp-stat-v">{value}</div><div className="cmp-stat-l">{label}</div><div className="cmp-stat-s">{sub}</div></div>
);

function MiniBars({ data, xKey, yKey }) {
  const max = Math.max(1, ...data.map((d) => Number(d[yKey]) || 0));
  if (!data.length) return <div className="cmp-empty">No data.</div>;
  return (
    <div className="cmp-bars">
      {data.map((d, i) => (
        <div key={i} className="cmp-bar-col" title={`${d[xKey]}: ${d[yKey]}`}>
          <div className="cmp-bar" style={{ height: `${(Number(d[yKey]) / max) * 100}%` }} />
          <span>{String(d[xKey]).slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

/* ════════════════ CAMPAIGN LIST ════════════════ */
function CampaignList({ onEdit, onNew, flash, statusColors }) {
  const [rows, setRows] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [analytics, setAnalytics] = useState(null);
  const gridRef = useResizableColumns('campaigns');

  const load = useCallback(() => {
    campaignsApi.list({ status: statusFilter || undefined }).then((r) => setRows(r.data)).catch(() => flash('Load failed', true));
  }, [statusFilter]);
  useEffect(() => { load(); }, [load]);

  async function act(fn, okMsg) { try { await fn(); flash(okMsg); load(); } catch (e) { flash(e?.response?.data?.error || 'Failed', true); } }

  return (
    <div className="cmp-panel">
      <div className="cmp-panel-head">
        <h3>Campaigns</h3>
        <button className="cmp-btn primary" onClick={onNew}>+ New Campaign</button>
      </div>
      <div className="cmp-statustabs">
        {['', ...Object.keys(statusColors)].map((s) => (
          <button key={s} type="button"
            className={`cmp-statustab ${statusFilter === s ? 'on' : ''}`}
            onClick={() => setStatusFilter(s)}>
            {STATUS_LABELS[s] || s}
          </button>
        ))}
      </div>

      <table className="cmp-table" ref={gridRef}>
        <thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Trigger</th><th>Priority</th><th>Actions</th></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td><b>{c.type_icon} {c.name}</b><div className="cmp-muted cmp-clip">{c.description}</div></td>
              <td className="cmp-muted">{c.type_label || c.type_key}</td>
              <td><span className="cmp-status" style={{ background: (statusColors[c.status] || '#999') + '22', color: statusColors[c.status] }}>{c.status}</span></td>
              <td className="cmp-muted">{c.trigger_config?.type}{c.trigger_config?.event ? ` · ${c.trigger_config.event}` : ''}</td>
              <td>{c.priority}</td>
              <td className="cmp-row-actions">
                <button onClick={() => onEdit(c.id)}>Edit</button>
                <button onClick={() => act(() => campaignsApi.run(c.id), 'Run queued')}>Run</button>
                {c.status === 'active' || c.status === 'scheduled'
                  ? <button onClick={() => act(() => campaignsApi.setStatus(c.id, 'paused'), 'Paused')}>Pause</button>
                  : <button onClick={() => act(() => campaignsApi.setStatus(c.id, 'active'), 'Activated')}>Activate</button>}
                {c.status === 'pending_approval' && <>
                  <button className="ok" onClick={() => act(() => campaignsApi.approve(c.id), 'Approved')}>Approve</button>
                  <button className="danger" onClick={() => act(() => campaignsApi.reject(c.id), 'Rejected')}>Reject</button>
                </>}
                <button onClick={() => campaignsApi.campaignAnalytics(c.id).then((r) => setAnalytics({ name: c.name, ...r.data })).catch(() => flash('No analytics', true))}>Stats</button>
                <button onClick={() => act(() => campaignsApi.duplicate(c.id), 'Duplicated')}>Copy</button>
                <button className="danger" onClick={() => confirm('Archive campaign?') && act(() => campaignsApi.remove(c.id), 'Archived')}>Archive</button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="cmp-empty">No campaigns. Create one to get started.</td></tr>}
        </tbody>
      </table>

      {analytics && <AnalyticsModal a={analytics} onClose={() => setAnalytics(null)} />}
    </div>
  );
}

function AnalyticsModal({ a, onClose }) {
  const money = (n) => 'Rs ' + Math.round(Number(n) || 0).toLocaleString();
  const p = a.performance;
  return (
    <div className="cmp-modal-overlay" onClick={onClose}>
      <div className="cmp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cmp-modal-head"><h3>{a.name} — Performance</h3><button className="cmp-btn-x" onClick={onClose}>✕</button></div>
        <div className="cmp-modal-body">
          <div className="cmp-stats">
            <Stat label="Revenue" value={money(p.revenue)} sub={`${p.conversion.orders} orders`} />
            <Stat label="ROI" value={p.roi == null ? '—' : p.roi.toFixed(0) + '%'} sub={`cost ${money(p.cost)}`} />
            <Stat label="Sent" value={p.messages.sent} sub={`${p.messages.reached} reached`} />
            <Stat label="Conversion" value={(p.conversion.conversion_rate * 100).toFixed(1) + '%'} sub={`${p.conversion.customers} customers`} />
            <Stat label="Redeemed" value={p.coupons.redeemed} sub={`${(p.coupons.redemption_rate * 100).toFixed(0)}% of ${p.coupons.issued}`} />
            <Stat label="Retention" value={(a.retention.retention_rate * 100).toFixed(0) + '%'} sub={`${a.retention.returned}/${a.retention.reached}`} />
          </div>
          {a.branches?.length > 0 && (
            <><h4 className="cmp-subhead">Branch Comparison</h4>
            <table className="cmp-table"><thead><tr><th>Branch</th><th>Redemptions</th><th>Revenue</th></tr></thead>
              <tbody>{a.branches.map((b, i) => <tr key={i}><td>{b.branch}</td><td>{b.redemptions}</td><td>{money(b.revenue)}</td></tr>)}</tbody>
            </table></>
          )}
        </div>
      </div>
    </div>
  );
}

/* ════════════════ QUEUE ════════════════ */
const QUEUE_STATUS_LABELS = {
  '': 'All', preview: 'Preview', pending_approval: 'Pending Approval', approved: 'Approved',
  scheduled: 'Scheduled', queued: 'Queued', sending: 'Sending', sent: 'Sent',
  delivered: 'Delivered', failed: 'Failed', cancelled: 'Cancelled', paused: 'Paused', rejected: 'Rejected',
};
const QUEUE_STATUS_ORDER = ['', 'preview', 'pending_approval', 'approved', 'scheduled', 'queued',
  'sending', 'sent', 'delivered', 'failed', 'cancelled', 'paused', 'rejected'];

// Message cell — shows the full body (no truncation), click to edit inline.
// Editing is blocked server-side only while a row is mid-send ('sending').
function QueueMessageCell({ row, onSave }) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(row.subject || '');
  const [body, setBody] = useState(row.message || '');
  const [saving, setSaving] = useState(false);

  if (!editing) {
    return (
      <td className="cmp-msg-cell" onClick={() => { setSubject(row.subject || ''); setBody(row.message || ''); setEditing(true); }} title="Click to edit">
        {row.subject && <div className="cmp-msg-subject">{row.subject}</div>}
        <div className="cmp-msg-body">{row.message}</div>
      </td>
    );
  }
  async function save() {
    setSaving(true);
    try { await onSave(row.id, { subject: subject || null, message: body }); setEditing(false); }
    catch { /* flash already shown by caller */ }
    finally { setSaving(false); }
  }
  return (
    <td className="cmp-msg-cell cmp-msg-editing" onClick={(e) => e.stopPropagation()}>
      {row.channel === 'EMAIL' && (
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="cmp-msg-subject-input" />
      )}
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} autoFocus />
      <div className="cmp-msg-editactions">
        <button className="cmp-btn-mini" disabled={saving} onClick={save}>Save</button>
        <button className="cmp-btn-mini" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </td>
  );
}

function QueuePanel({ flash }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({});
  const [statusFilter, setStatusFilter] = useState('');
  const [sel, setSel] = useState(() => new Set());
  const [allMatching, setAllMatching] = useState(false);
  const gridRef = useResizableColumns('queue');

  const load = useCallback(() => {
    campaignsApi.queue({ status: statusFilter || undefined, limit: 200 })
      .then((r) => { setRows(r.data.rows); setTotal(r.data.total || 0); if (r.data.counts) setCounts(r.data.counts); }).catch(() => {});
  }, [statusFilter]);
  useEffect(() => { setSel(new Set()); setAllMatching(false); }, [statusFilter]);
  useEffect(() => { load(); const t = setInterval(load, 6000); return () => clearInterval(t); }, [load]);

  const toggle = (id) => { setAllMatching(false); setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); };
  const allVisibleChecked = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const toggleAll = () => {
    setAllMatching(false);
    setSel(allVisibleChecked ? new Set() : new Set(rows.map((r) => r.id)));
  };
  async function bulk(action) {
    try {
      if (allMatching) {
        const r = await campaignsApi.queueBulkAll(action, { status: statusFilter || undefined });
        flash(`${action}: ${r.data.affected ?? 'ok'}`);
      } else {
        const ids = [...sel];
        if (!ids.length) return flash('Select rows first', true);
        await campaignsApi.queueBulk(action, ids);
        flash(`${action} done`);
      }
      setSel(new Set()); setAllMatching(false); load();
    } catch (e) { flash(e?.response?.data?.error || 'Failed', true); }
  }
  async function bulkDelete() {
    const count = allMatching ? (statusFilter ? (counts[statusFilter] || total) : total) : sel.size;
    if (!count) return flash('Select rows first', true);
    if (!confirm(`Permanently delete ${count} queue message(s)? This cannot be undone.`)) return;
    try {
      const r = allMatching
        ? await campaignsApi.queueDeleteAll({ status: statusFilter || undefined })
        : await campaignsApi.queueDelete([...sel]);
      flash(`Deleted ${r.data.affected ?? 0} message(s)`);
      setSel(new Set()); setAllMatching(false); load();
    } catch (e) { flash(e?.response?.data?.error || 'Delete failed', true); }
  }
  async function saveMessage(id, patch) {
    try { await campaignsApi.queueUpdate(id, patch); flash('Message updated'); load(); }
    catch (e) { flash(e?.response?.data?.error || 'Update failed', true); throw e; }
  }

  return (
    <div className="cmp-panel">
      <div className="cmp-panel-head">
        <h3>Campaign Queue</h3>
        <div className="cmp-row-actions">
          <button className="ok" onClick={() => bulk('approve')}>Approve</button>
          <button onClick={() => bulk('reject')}>Reject</button>
          <button onClick={() => bulk('pause')}>Pause</button>
          <button onClick={() => bulk('resume')}>Resume</button>
          <button onClick={() => bulk('retry')}>Retry</button>
          <button className="danger" onClick={() => bulk('cancel')}>Cancel</button>
          <button className="danger" onClick={bulkDelete}>Delete</button>
        </div>
      </div>
      <div className="cmp-statustabs">
        {QUEUE_STATUS_ORDER.map((s) => {
          const n = s === '' ? Object.values(counts).reduce((a, b) => a + b, 0) : (counts[s] || 0);
          return (
            <button key={s || 'all'} type="button"
              className={`cmp-statustab ${statusFilter === s ? 'on' : ''}`}
              onClick={() => setStatusFilter(s)}>
              {QUEUE_STATUS_LABELS[s]} ({n})
            </button>
          );
        })}
      </div>

      {(allMatching || (allVisibleChecked && total > rows.length)) && (
        <div className="cmp-bulk-banner">
          {allMatching
            ? <>All <b>{statusFilter ? (counts[statusFilter] || total) : total}</b> {QUEUE_STATUS_LABELS[statusFilter]} rows selected. <button onClick={() => { setAllMatching(false); setSel(new Set()); }}>Clear</button></>
            : <>All <b>{rows.length}</b> on this page selected. <button onClick={() => setAllMatching(true)}>Select all {statusFilter ? (counts[statusFilter] || total) : total} in this tab</button></>}
        </div>
      )}

      <table className="cmp-table" ref={gridRef}>
        <thead><tr>
          <th><input type="checkbox" checked={allVisibleChecked} onChange={toggleAll} title="Select all on page" /></th>
          <th>ID</th><th>Channel</th><th>Recipient</th><th>Message</th><th>Status</th><th>Retry</th>
        </tr></thead>
        <tbody>
          {rows.map((q) => (
            <tr key={q.id}>
              <td><input type="checkbox" checked={allMatching || sel.has(q.id)} onChange={() => toggle(q.id)} /></td>
              <td>{q.id}</td><td><span className="cmp-chip">{q.channel}</span></td>
              <td>{q.customer_name || q.recipient}</td>
              <QueueMessageCell row={q} onSave={saveMessage} />
              <td><span className={`cmp-status ${q.status}`}>{q.status}</span></td>
              <td>{q.retry_count}/{q.max_retries}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="cmp-empty">Queue is empty.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* ════════════════ SETTINGS (channels / providers) ════════════════ */
function SettingsPanel({ channels, onChange, flash }) {
  async function toggle(ch) {
    try { await campaignsApi.updateChannel(ch.key, { is_enabled: !ch.is_enabled }); flash(`${ch.label} ${ch.is_enabled ? 'disabled' : 'enabled'}`); onChange(); }
    catch { flash('Failed', true); }
  }
  async function saveConfig(ch, cfgText) {
    let config; try { config = cfgText ? JSON.parse(cfgText) : {}; } catch { return flash('Invalid JSON', true); }
    try { await campaignsApi.updateChannel(ch.key, { config }); flash('Provider config saved'); onChange(); } catch { flash('Failed', true); }
  }
  return (
    <div className="cmp-panel">
      <div className="cmp-panel-head"><h3>Channels & Providers</h3></div>
      <p className="cmp-hint">SMS delivers through the built-in SMS engine. Other providers post to the endpoint in their JSON config (e.g. {'{ "endpoint": "https://…", "headers": {…} }'}).</p>
      <div className="cmp-cards">
        {channels.map((ch) => (
          <div key={ch.key} className="cmp-card">
            <div className="cmp-card-title">
              {ch.label} <span className="cmp-muted">({ch.provider})</span>
              <label className="cmp-switch">
                <input type="checkbox" checked={!!ch.is_enabled} onChange={() => toggle(ch)} /><span />
              </label>
            </div>
            <ProviderConfig ch={ch} onSave={saveConfig} />
          </div>
        ))}
      </div>
    </div>
  );
}

const PROVIDER_SAMPLES = {
  sms: { note: 'Delivered via the built-in SMS engine (Android gateway). No config needed.' },
  whatsapp: { endpoint: 'https://graph.facebook.com/v20.0/<PHONE_ID>/messages', from: '<PHONE_ID>', headers: { Authorization: 'Bearer <TOKEN>' } },
  email: { endpoint: 'https://api.mailgun.net/v3/<DOMAIN>/messages', from: 'MTC <noreply@mtc.com>', default_subject: 'MTC', headers: { Authorization: 'Basic <BASE64>' } },
  push: { endpoint: 'https://fcm.googleapis.com/fcm/send', default_title: 'MTC', headers: { Authorization: 'key=<SERVER_KEY>' } },
  telegram: { endpoint: 'https://api.telegram.org/bot<TOKEN>/sendMessage', parse_mode: 'HTML' },
  viber: { endpoint: 'https://chatapi.viber.com/pa/send_message', sender: 'MTC', headers: { 'X-Viber-Auth-Token': '<TOKEN>' } },
  aicall: { endpoint: 'https://<VOICE_PROVIDER>/calls', voice: 'default', language: 'en', headers: { Authorization: 'Bearer <TOKEN>' } },
};

function ProviderConfig({ ch, onSave }) {
  const [txt, setTxt] = useState(JSON.stringify(ch.config || {}, null, 2));
  const sample = PROVIDER_SAMPLES[ch.provider];
  const sampleText = ch.provider === 'sms' ? null : JSON.stringify(sample, null, 2);
  return (
    <div>
      <textarea className="cmp-code" rows={4} value={txt}
        onChange={(e) => setTxt(e.target.value)} disabled={ch.provider === 'sms'}
        placeholder={sampleText || ''} />
      {ch.provider === 'sms'
        ? <p className="cmp-hint">{sample.note}</p>
        : <>
            <button className="cmp-btn-mini" onClick={() => onSave(ch, txt)}>Save Config</button>
            <button className="cmp-btn-mini" style={{ marginLeft: 6 }} onClick={() => setTxt(sampleText)}>Use Sample</button>
            <details className="cmp-sample"><summary>Show sample config</summary><pre>{sampleText}</pre></details>
          </>}
    </div>
  );
}
