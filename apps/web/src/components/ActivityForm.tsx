import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type Activity } from '../api';
import { useAuth } from '../auth';
import { fromLocalInput, toLocalInput, today } from '../format';
import { useSave, useUsers } from '../hooks';
import { t } from '../i18n';
import { NEEDS_OUTCOME } from './CompleteActivity';
import { DeactivateButton, FormActions } from './FormActions';
import { confirmDiscard, ErrorNote, Field, FieldGroup, Modal, useDirty } from './ui';

export const CLIENT_TYPES: [string, string][] = [
  ['call', 'Call'], ['meeting', 'Meeting'], ['site_visit', 'Site visit'], ['followup', 'Follow-up'], ['email', 'Email'], ['task', 'Task'],
];
export const MARKETING_TYPES: [string, string][] = [
  ['campaign', 'Campaign'], ['social_post', 'Social media post'], ['exhibition', 'Exhibition / event'], ['advertisement', 'Advertisement'], ['content', 'Content'],
];
const isMarketing = (type: string) => MARKETING_TYPES.some(([k]) => k === type);

/** What an activity is linked to: a contract (enquiry) or a customer. */
export interface Link { kind: 'booking' | 'contact' | 'account'; id: string; code: string; name: string }

interface LinkResults {
  contracts: { id: string; code: string; name: string; status: string; client: string | null; phone: string | null }[];
  customers: { id: string; kind: 'contact' | 'account'; code: string; name: string; phone: string | null }[];
}

/** Search box for a Contract ID or Customer ID (also by name or phone). */
export function LinkPicker({ value, onChange, required }: { value: Link | null; onChange: (l: Link | null) => void; required?: boolean }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const h = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(h); }, [q]);
  const { data } = useQuery({ queryKey: ['links', debounced], queryFn: () => api<LinkResults>(`/links?q=${encodeURIComponent(debounced)}`), enabled: debounced.length > 0 });
  if (value) {
    return (
      <div className="link-chip">
        <span className="tag">{value.code}</span> <span className="grow">{value.name}</span>
        <button type="button" className="sm ghost" onClick={() => onChange(null)} aria-label={t('Change')}>✕</button>
      </div>
    );
  }
  return (
    <div className="link-picker">
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} required={required}
        placeholder={t('Contract ID, customer ID, name or phone')} aria-label={t('Contract or customer')} />
      {debounced && data && (
        <div className="link-results" role="listbox">
          {data.contracts.length + data.customers.length === 0 && <div className="small muted" style={{ padding: 8 }}>{t('Nothing found. Add the customer under CRM first.')}</div>}
          {data.contracts.map((c) => (
            <button type="button" key={c.id} role="option" onClick={() => onChange({ kind: 'booking', id: c.id, code: c.code, name: c.name })}>
              <span className="tag">{c.code}</span> {c.name}<span className="small muted"> · {[c.client, c.phone].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
          {data.customers.map((c) => (
            <button type="button" key={c.id} role="option" onClick={() => onChange({ kind: c.kind, id: c.id, code: c.code, name: c.name })}>
              <span className="tag">{c.code}</span> {c.name}{c.phone && <span className="small muted"> · {c.phone}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function linkOf(a?: Partial<Activity> & { customer_no?: string | null }): Link | null {
  if (!a) return null;
  if (a.booking_id) return { kind: 'booking', id: a.booking_id, code: a.booking_no ?? '', name: a.booking_name ?? '' };
  if (a.contact_id) return { kind: 'contact', id: a.contact_id, code: a.customer_no ?? '', name: a.contact_name ?? '' };
  if (a.account_id) return { kind: 'account', id: a.account_id, code: a.customer_no ?? '', name: a.account_name ?? '' };
  return null;
}

/**
 * Plan an activity (future), log one that was done (present), or edit one.
 * Every client activity is linked to a contract or a customer; marketing work may stand alone.
 */
export function ActivityDialog({ mode, activity, bookingId, day, onClose }: {
  mode: 'plan' | 'log' | 'edit'; activity?: Activity; bookingId?: string; day?: string; onClose: () => void;
}) {
  const { me, can } = useAuth();
  const { data: users } = useUsers();
  const marketer = me?.role === 'marketing';
  const [form, setForm] = useState({
    type: activity?.type ?? (marketer ? 'campaign' : mode === 'log' ? 'call' : 'followup'),
    subject: activity?.subject ?? '',
    when: activity ? toLocalInput(activity.due_at) : `${day ?? today()}T${mode === 'log' ? new Date().toTimeString().slice(0, 5) : '10:00'}`,
    location: activity?.location ?? '', notes: activity?.notes ?? '', outcome: '',
    owner_id: activity?.owner_id ?? me?.id ?? '',
    link: linkOf(activity),
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = useDirty(form);
  const needsLink = !bookingId && !isMarketing(form.type);
  const needsOutcome = mode === 'log' && NEEDS_OUTCOME.includes(form.type);
  const inv = [['activities'], ['booking'], ['daily-activity'], ['meetings'], ['dashboard']];
  const save = useSave(async () => {
    const link = bookingId ? { booking_id: bookingId } : {
      booking_id: form.link?.kind === 'booking' ? form.link.id : null,
      contact_id: form.link?.kind === 'contact' ? form.link.id : null,
      account_id: form.link?.kind === 'account' ? form.link.id : null,
    };
    const body = { type: form.type, subject: form.subject, due_at: fromLocalInput(form.when), location: form.location || null,
      notes: form.notes || null, owner_id: form.owner_id || null, ...link };
    if (mode === 'edit') return api(`/activities/${activity!.id}`, { method: 'PATCH', body });
    const created = await api<Activity>('/activities', { body });
    if (mode === 'log') await api(`/activities/${created.id}/complete`, { body: { outcome: form.outcome.trim() || null } });
    return created;
  }, inv);
  const title = mode === 'log' ? t('Log activity') : mode === 'plan' ? t('Plan activity') : t('Edit activity');
  return (
    <Modal title={title} onClose={onClose} dirty={dirty}
      footer={<FormActions formId="activity-form" saving={save.isPending} onCancel={confirmDiscard(dirty, onClose)}
        remove={mode === 'edit' && activity && <DeactivateButton kind="activities" id={activity.id} name={activity.subject} invalidate={inv} onDone={onClose} />} />}>
      <form id="activity-form" className="stack" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }}>
        <ErrorNote error={save.error} />
        <div className="form-grid">
          <Field label={t('Type')}>
            <select value={form.type} onChange={(e) => set('type', e.target.value)}>
              {(marketer ? [] : CLIENT_TYPES).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
              {(marketer || can('manage')) && <optgroup label={t('Marketing')}>{MARKETING_TYPES.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</optgroup>}
              {marketer && <optgroup label={t('With a client')}>{CLIENT_TYPES.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</optgroup>}
            </select>
          </Field>
          <Field label={t('Subject')} className="span-2"><input required value={form.subject} onChange={(e) => set('subject', e.target.value)} placeholder={t('e.g. Send revised quote')} /></Field>
          {!bookingId && (
            <FieldGroup label={needsLink ? t('Contract or customer (required)') : t('Contract or customer (optional)')} className="span-all">
              <LinkPicker value={form.link} onChange={(l) => set('link', l)} required={needsLink} />
            </FieldGroup>
          )}
          <Field label={mode === 'log' ? t('Done at') : t('Due')}>
            <input type="datetime-local" required value={form.when} onChange={(e) => set('when', e.target.value)} />
          </Field>
          <Field label={t('Owner')}>
            <select value={form.owner_id} onChange={(e) => set('owner_id', e.target.value)}>
              {users?.filter((u) => (u.is_active && u.in_my_team) || u.id === form.owner_id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label={t('Location')}><input value={form.location} onChange={(e) => set('location', e.target.value)} /></Field>
          <Field label={t('Notes')} className="span-all"><input value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
          {mode === 'log' && (
            <Field label={needsOutcome ? t('Meeting outcome (required)') : t('Outcome / client feedback (optional)')} className="span-all">
              <textarea rows={3} required={needsOutcome} value={form.outcome} onChange={(e) => set('outcome', e.target.value)} />
            </Field>
          )}
        </div>
        {needsLink && !form.link && <p className="small muted" style={{ margin: 0 }}>{t('Every client activity is linked to a contract ID or a customer ID.')}</p>}
      </form>
    </Modal>
  );
}
