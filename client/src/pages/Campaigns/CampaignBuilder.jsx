import { useState, useEffect, useCallback } from 'react';
import { campaignsApi } from '../../services/api';
import RuleBuilder from './RuleBuilder';

const STEPS = ['General', 'Audience', 'Trigger', 'Conditions', 'Channels', 'Rewards', 'Schedule', 'Approval', 'Review'];
const TRIGGER_TYPES = ['scheduled', 'recurring', 'event', 'webhook', 'api', 'manual', 'system'];
const RECURRENCE = ['once', 'daily', 'weekly', 'monthly', 'yearly'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const BLANK = {
  name: '', description: '', type_key: '', priority: 50,
  audience: { and: [] }, conditions: { and: [] },
  trigger_config: { type: 'scheduled', event: '' },
  channels: [], rewards: [], actions: [],
  schedule: { recurrence: 'daily', time: '09:00' },
  config: { message: '' }, approval_required: false,
};

export default function CampaignBuilder({ id, types, channels, coupons, fields, onClose, onSaved, flash }) {
  const [step, setStep] = useState(0);
  const [c, setC] = useState(BLANK);
  const [audCount, setAudCount] = useState(null);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState([]);

  const set = (patch) => setC((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    campaignsApi.templates().then((r) => setTemplates(r.data)).catch(() => {});
    if (id) {
      campaignsApi.get(id).then((r) => {
        const d = r.data;
        // Coerce every JSON field to the shape the builder expects — stored
        // values may be null or a different shape (e.g. rewards saved as an
        // object), which would otherwise crash the rewards/audience steps.
        const asTree = (v) => (v && typeof v === 'object' && !Array.isArray(v) && (v.and || v.or) ? v : { and: [] });
        const asArr = (v) => (Array.isArray(v) ? v : []);
        setC({
          ...BLANK, ...d,
          audience: asTree(d.audience),
          conditions: asTree(d.conditions),
          trigger_config: (d.trigger_config && typeof d.trigger_config === 'object') ? d.trigger_config : { type: 'scheduled', event: '' },
          channels: asArr(d.channels), rewards: asArr(d.rewards), actions: asArr(d.actions),
          schedule: (d.schedule && typeof d.schedule === 'object') ? d.schedule : { recurrence: 'daily', time: '09:00' },
          config: (d.config && typeof d.config === 'object') ? d.config : { message: '' },
          approval_required: !!d.approval_required,
        });
      }).catch(() => flash('Failed to load campaign', true));
    }
  }, [id]);

  // Apply type defaults when a type is picked on a fresh campaign.
  const applyType = (key) => {
    const t = types.find((x) => x.key === key);
    if (!t) return set({ type_key: key });
    set({
      type_key: key,
      trigger_config: id ? c.trigger_config : { type: 'scheduled', event: '', ...(t.default_trigger || {}) },
      channels: id || c.channels.length ? c.channels : (t.default_channels || []).map((ch) => ({ channel: ch, template_id: null })),
      audience: id || (c.audience?.and?.length) ? c.audience : (t.default_audience && Object.keys(t.default_audience).length ? t.default_audience : { and: [] }),
    });
  };

  const refreshCount = useCallback(() => {
    campaignsApi.audienceCount({ rules: c.audience }).then((r) => setAudCount(r.data.total)).catch(() => setAudCount(null));
  }, [c.audience]);
  useEffect(() => { const t = setTimeout(refreshCount, 400); return () => clearTimeout(t); }, [refreshCount]);

  const enabledChannels = channels.filter((ch) => ch.is_enabled);
  const hasChannel = (key) => c.channels.some((x) => (typeof x === 'string' ? x : x.channel) === key);
  const toggleChannel = (key) => {
    set({ channels: hasChannel(key)
      ? c.channels.filter((x) => (typeof x === 'string' ? x : x.channel) !== key)
      : [...c.channels, { channel: key, template_id: null }] });
  };
  const setChannelTemplate = (key, tid) => set({
    channels: c.channels.map((x) => {
      const ck = typeof x === 'string' ? x : x.channel;
      return ck === key ? { channel: key, template_id: tid ? Number(tid) : null } : x;
    }),
  });

  // Rewards helpers — coupon + loyalty points compose the rewards array.
  const couponReward = c.rewards.find((r) => r.type === 'issue_coupon');
  const pointsReward = c.rewards.find((r) => r.type === 'add_loyalty_points');
  const setCoupon = (couponId) => {
    const rest = c.rewards.filter((r) => r.type !== 'issue_coupon');
    set({ rewards: couponId ? [...rest, { type: 'issue_coupon', coupon_id: Number(couponId) }] : rest });
  };
  const setPoints = (points) => {
    const rest = c.rewards.filter((r) => r.type !== 'add_loyalty_points');
    set({ rewards: Number(points) ? [...rest, { type: 'add_loyalty_points', points: Number(points) }] : rest });
  };

  async function save(activate) {
    if (!c.name || !c.type_key) { flash('Name and type are required', true); setStep(0); return; }
    setSaving(true);
    try {
      const payload = {
        name: c.name, description: c.description, type_key: c.type_key, priority: Number(c.priority) || 50,
        audience: c.audience, conditions: c.conditions, trigger_config: c.trigger_config,
        channels: c.channels, rewards: c.rewards, actions: c.actions, schedule: c.schedule,
        config: c.config, approval_required: c.approval_required,
      };
      let campaignId = id;
      if (id) await campaignsApi.update(id, payload);
      else { const r = await campaignsApi.create(payload); campaignId = r.data.id; }
      if (activate) {
        const status = c.trigger_config.type === 'manual' ? 'active'
          : ['scheduled', 'recurring'].includes(c.trigger_config.type) ? 'scheduled' : 'active';
        await campaignsApi.setStatus(campaignId, status);
      }
      flash(activate ? 'Campaign saved & activated' : 'Campaign saved');
      onSaved();
    } catch (e) {
      flash(e?.response?.data?.error || 'Save failed', true);
    } finally { setSaving(false); }
  }

  const tt = c.trigger_config.type;

  return (
    <div className="cmp-modal-overlay" onClick={onClose}>
      <div className="cmp-modal cmp-builder" onClick={(e) => e.stopPropagation()}>
        <div className="cmp-modal-head">
          <h3>{id ? 'Edit Campaign' : 'New Campaign'}</h3>
          <button className="cmp-btn-x" onClick={onClose}>✕</button>
        </div>

        <div className="cmp-steps">
          {STEPS.map((s, i) => (
            <button key={s} className={`cmp-step ${i === step ? 'on' : ''} ${i < step ? 'done' : ''}`} onClick={() => setStep(i)}>
              <span>{i + 1}</span>{s}
            </button>
          ))}
        </div>

        <div className="cmp-modal-body">
          {step === 0 && (
            <div className="cmp-form">
              <label>Name<input value={c.name} onChange={(e) => set({ name: e.target.value })} placeholder="Dashain Special 2026" /></label>
              <label>Type
                <div className="cmp-typegrid">
                  {types.map((t) => (
                    <button key={t.key} type="button"
                      className={`cmp-typebtn ${c.type_key === t.key ? 'on' : ''}`}
                      onClick={() => applyType(t.key)}>
                      <span className="ic">{t.icon}</span>{t.label}
                    </button>
                  ))}
                </div>
              </label>
              <label>Description<textarea value={c.description || ''} onChange={(e) => set({ description: e.target.value })} rows={2} /></label>
              <label>Priority<input type="number" value={c.priority} onChange={(e) => set({ priority: e.target.value })} /></label>
            </div>
          )}

          {step === 1 && (
            <div>
              <div className="cmp-count-badge">Audience size: <b>{audCount ?? '…'}</b> customers</div>
              <RuleBuilder value={c.audience} onChange={(v) => set({ audience: v })} fields={[...(fields.scalar || []), ...(fields.existence || [])]} />
            </div>
          )}

          {step === 2 && (
            <div className="cmp-form">
              <label>Trigger type
                <select value={tt} onChange={(e) => set({ trigger_config: { ...c.trigger_config, type: e.target.value } })}>
                  {TRIGGER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              {['event', 'webhook', 'api', 'system'].includes(tt) && (
                <label>Event name
                  <input value={c.trigger_config.event || ''} onChange={(e) => set({ trigger_config: { ...c.trigger_config, event: e.target.value } })}
                    placeholder="e.g. order.completed, customer.birthday" />
                </label>
              )}
              <p className="cmp-hint">
                {tt === 'scheduled' && 'Fires at the scheduled time (see Schedule step).'}
                {tt === 'recurring' && 'Fires repeatedly on the recurrence in the Schedule step.'}
                {['event', 'system'].includes(tt) && 'Fires when the named event is emitted by POS / system.'}
                {tt === 'webhook' && 'Fires from POST /api/campaigns/webhook/<event>.'}
                {tt === 'api' && 'Fires from POST /api/campaigns/events.'}
                {tt === 'manual' && 'Runs only when executed manually from the list.'}
              </p>
            </div>
          )}

          {step === 3 && (
            <div>
              <p className="cmp-hint">Per-recipient conditions evaluated at send time (on top of the audience filter).</p>
              <RuleBuilder value={c.conditions} onChange={(v) => set({ conditions: v })} fields={[...(fields.scalar || []), ...(fields.existence || [])]} />
            </div>
          )}

          {step === 4 && (
            <div className="cmp-form">
              {enabledChannels.length === 0 && <p className="cmp-hint">No channels enabled. Enable one in Settings.</p>}
              {enabledChannels.map((ch) => (
                <div key={ch.key} className="cmp-channel-row">
                  <label className="cmp-check">
                    <input type="checkbox" checked={hasChannel(ch.key)} onChange={() => toggleChannel(ch.key)} /> {ch.label}
                  </label>
                  {hasChannel(ch.key) && (
                    <select value={c.channels.find((x) => (x.channel || x) === ch.key)?.template_id || ''}
                      onChange={(e) => setChannelTemplate(ch.key, e.target.value)}>
                      <option value="">default template</option>
                      {templates.filter((t) => t.channel === ch.key).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  )}
                </div>
              ))}
              <label>Fallback message (used if no template)
                <textarea value={c.config.message || ''} onChange={(e) => set({ config: { ...c.config, message: e.target.value } })}
                  rows={3} placeholder="Hi {{name}}, enjoy {{reward}}! Code {{coupon}}" />
              </label>
            </div>
          )}

          {step === 5 && (
            <div className="cmp-form">
              <label>Coupon reward
                <select value={couponReward?.coupon_id || ''} onChange={(e) => setCoupon(e.target.value)}>
                  <option value="">— none —</option>
                  {coupons.map((cp) => <option key={cp.id} value={cp.id}>{cp.name} ({cp.discount_type} {cp.value})</option>)}
                </select>
              </label>
              <label>Loyalty points to grant
                <input type="number" value={pointsReward?.points || ''} onChange={(e) => setPoints(e.target.value)} placeholder="0" />
              </label>
            </div>
          )}

          {step === 6 && (
            <div className="cmp-form">
              <label>Recurrence
                <select value={c.schedule.recurrence || 'daily'} onChange={(e) => set({ schedule: { ...c.schedule, recurrence: e.target.value } })}>
                  {RECURRENCE.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label>Time<input type="time" value={c.schedule.time || '09:00'} onChange={(e) => set({ schedule: { ...c.schedule, time: e.target.value } })} /></label>
              <label>Start date/time<input type="datetime-local" value={c.schedule.start_at || ''} onChange={(e) => set({ schedule: { ...c.schedule, start_at: e.target.value } })} /></label>
              {c.schedule.recurrence === 'weekly' && (
                <div className="cmp-days">
                  {DAYS.map((d, i) => (
                    <button key={d} type="button" className={(c.schedule.days || []).includes(i) ? 'on' : ''}
                      onClick={() => set({ schedule: { ...c.schedule, days: (c.schedule.days || []).includes(i)
                        ? c.schedule.days.filter((x) => x !== i) : [...(c.schedule.days || []), i] } })}>{d}</button>
                  ))}
                </div>
              )}
              {c.schedule.recurrence === 'monthly' && (
                <label>Day of month<input type="number" min="1" max="31" value={c.schedule.day_of_month || ''} onChange={(e) => set({ schedule: { ...c.schedule, day_of_month: Number(e.target.value) } })} /></label>
              )}
              {c.schedule.recurrence === 'yearly' && (
                <label>Date (MM-DD)<input value={c.schedule.date || ''} onChange={(e) => set({ schedule: { ...c.schedule, date: e.target.value } })} placeholder="10-15" /></label>
              )}
            </div>
          )}

          {step === 7 && (
            <div className="cmp-form">
              <label className="cmp-check">
                <input type="checkbox" checked={c.approval_required} onChange={(e) => set({ approval_required: e.target.checked })} />
                Require approval before messages are sent
              </label>
              <p className="cmp-hint">When enabled, each run is queued as <b>pending approval</b> and an approver must release it.</p>
            </div>
          )}

          {step === 8 && (
            <div className="cmp-review">
              <Row k="Name" v={c.name} />
              <Row k="Type" v={c.type_key} />
              <Row k="Trigger" v={`${tt}${c.trigger_config.event ? ' · ' + c.trigger_config.event : ''}`} />
              <Row k="Audience" v={`${audCount ?? '…'} customers`} />
              <Row k="Channels" v={c.channels.map((x) => x.channel || x).join(', ') || '—'} />
              <Row k="Reward" v={couponReward ? `coupon #${couponReward.coupon_id}` : pointsReward ? `${pointsReward.points} points` : '—'} />
              <Row k="Schedule" v={`${c.schedule.recurrence} @ ${c.schedule.time || '—'}`} />
              <Row k="Approval" v={c.approval_required ? 'required' : 'auto'} />
            </div>
          )}
        </div>

        <div className="cmp-modal-foot">
          <button className="cmp-btn" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>Back</button>
          {step < STEPS.length - 1
            ? <button className="cmp-btn primary" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>Next</button>
            : <>
                <button className="cmp-btn" disabled={saving} onClick={() => save(false)}>Save Draft</button>
                <button className="cmp-btn primary" disabled={saving} onClick={() => save(true)}>Save & Activate</button>
              </>}
        </div>
      </div>
    </div>
  );
}

const Row = ({ k, v }) => <div className="cmp-review-row"><span>{k}</span><b>{v}</b></div>;
