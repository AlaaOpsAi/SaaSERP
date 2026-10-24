import { useEffect, useMemo } from 'react';
import type { Booking } from '../api';
import { useHidden } from '../auth';
import { useBusinessUnits, useLookups, useUsers, useVenues } from '../hooks';
import { today } from '../format';
import { Field, LookupSelect, useDirty, useForm } from './ui';
import { t } from '../i18n';

/** Client details of the contract (CLIENT FIRST NAME, FAMILY NAME, PHONE …). */
export interface ClientValues {
  first_name?: string | null; family_name?: string | null; phone?: string | null; email?: string | null;
  social_handle?: string | null; nationality?: string | null; address?: string | null;
}

export type BookingFormValues = Partial<Booking> & { contact?: ClientValues };

/** The client fields of a booking, ready to edit. Older clients have one name only: it goes in "first name". */
export function clientOf(b: Partial<Booking>): ClientValues {
  return {
    first_name: b.contact_first_name ?? (b.contact_family_name ? null : b.contact_name) ?? null,
    family_name: b.contact_family_name ?? null,
    phone: b.contact_phone ?? null, email: b.contact_email ?? null, social_handle: b.contact_social_handle ?? null,
    nationality: b.contact_nationality ?? null, address: b.contact_address ?? null,
  };
}

/**
 * Create / edit form for a contract, in the three groups of the daily report:
 * contract & payment details, follow-up details and client details.
 * Fields hidden from the user's role (Admin → Contract fields) are left out.
 */
export function BookingForm({ initial, isNew, onSubmit, id, onDirty }: {
  initial?: Partial<Booking>; isNew?: boolean; onSubmit: (v: BookingFormValues) => void; id: string;
  /** Told whether the form has unsaved changes (for "Discard your changes?"). */
  onDirty?: (dirty: boolean) => void;
}) {
  const { data: lookups } = useLookups();
  const { data: users } = useUsers();
  const { data: venues } = useVenues();
  const { data: units } = useBusinessUnits();
  const hidden = useHidden();
  const { form, set, bind, bindNum } = useForm<BookingFormValues>({
    inquiry_date: today(),
    credit_facility: false,
    ...initial,
    contact: initial ? clientOf(initial) : {},
  });
  const dirty = useDirty(form);
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);
  const client = form.contact ?? {};
  const bindClient = (k: keyof ClientValues) => ({
    value: client[k] ?? '',
    onChange: (e: { target: { value: string } }) => set('contact')({ ...client, [k]: e.target.value || null }),
  });
  const spaces = useMemo(() => venues?.find((v) => v.id === form.venue_id)?.spaces ?? [], [venues, form.venue_id]);

  return (
    <form id={id} className="stack" onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}>
      <section className="form-group">
        <h3>{t('Contract & payment details')}</h3>
        <div className="form-grid">
          <Field label={t('Contract name')} className="span-2"><input required {...bind('name')} placeholder={t('e.g. Latifa wedding')} /></Field>
          {isNew && !hidden('business_unit') && (units?.length ?? 0) > 1 && (
            <Field label={t('Company')}>
              <select {...bind('business_unit_id')}>
                <option value="">{t('Default')}</option>
                {units!.map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}
              </select>
            </Field>
          )}
          {!hidden('branch') && <Field label={t('Branch')}><LookupSelect options={lookups?.branch} value={form.branch} onChange={set('branch')} /></Field>}
          <Field label={t('Event date')}><input type="date" {...bind('event_date')} /></Field>
          <Field label={t('Hotel / location')}>
            <select value={form.venue_id ?? ''} onChange={(e) => { set('venue_id')(e.target.value || null); set('function_space_id')(null); }}>
              <option value="">—</option>
              {venues?.filter((v) => v.is_active || v.id === form.venue_id).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          {spaces.length > 0 ? (
            <Field label={t('Hall / area')}>
              <select {...bind('function_space_id')}>
                <option value="">—</option>
                {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}{s.capacity ? ` (${s.capacity})` : ''}</option>)}
              </select>
            </Field>
          ) : (
            <Field label={t('Hall / area')}><input {...bind('hall_text')} /></Field>
          )}
          {!hidden('pax') && <Field label={t('Pax / units')}><input {...bindNum('pax')} min={0} step={1} /></Field>}
          {!hidden('rate') && <Field label={t('Rate per pax / unit')}><input {...bindNum('rate')} /></Field>}
          {!hidden('rate') && <Field label={t('Term days / room nights')}><input {...bindNum('term_days')} min={0} step={1} /></Field>}
          {!hidden('event_type') && <Field label={t('Event type')}><LookupSelect options={lookups?.event_type} value={form.event_type} onChange={set('event_type')} /></Field>}
          {!hidden('design') && <Field label={t('Design')}><LookupSelect options={lookups?.design} value={form.design} onChange={set('design')} /></Field>}
          {!hidden('source') && <Field label={t('Source')}><LookupSelect options={lookups?.source} value={form.source} onChange={set('source')} /></Field>}
          {!hidden('owner') && (
            <Field label={t('Account manager')}>
              <select {...bind('owner_id')}>
                <option value="">{t('Me')}</option>
                {users?.filter((u) => u.in_my_team || u.id === form.owner_id).map((u) => <option key={u.id} value={u.id}>{u.name}{u.code ? ` (${u.code})` : ''}</option>)}
              </select>
            </Field>
          )}
          {!hidden('contract_value') && <Field label={t('Total contract value')}><input {...bindNum('contract_value')} /></Field>}
          {!hidden('credit_facility') && (
            <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}>
              <input type="checkbox" checked={Boolean(form.credit_facility)} onChange={(e) => set('credit_facility')(e.target.checked)} />
              {t('Credit facility (CF cost applies)')}
            </label>
          )}
          {!hidden('finance') && (
            <>
              <Field label={t('Manual revenue (if no lines)')}><input {...bindNum('manual_revenue')} /></Field>
              <Field label={t('Manual cost (if no lines)')}><input {...bindNum('manual_cost')} /></Field>
              {!isNew && (
                <Field label={t('PAYMENT status')}>
                  <select value={form.payment_status ?? ''} onChange={(e) => set('payment_status')((e.target.value || null) as Booking['payment_status'])}>
                    <option value="">{t('From the money received (DP / PAID)')}</option>
                    {['INVOICED', 'TO INVOICE', 'TO PAY', 'REJECTED', 'CANCELED'].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </Field>
              )}
            </>
          )}
        </div>
        {!isNew && !hidden('money_received') && (
          <p className="small muted" style={{ margin: 0 }}>{t('Record the money received (down payment) on the contract page.')}</p>
        )}
      </section>

      <section className="form-group">
        <h3>{t('Follow-up details')}</h3>
        <div className="form-grid">
          <Field label={t('Request description & notes')} className="span-all"><textarea {...bind('description')} /></Field>
          <Field label={t('Enquiry date')}><input type="date" required {...bind('inquiry_date')} /></Field>
          <Field label={t('Decision due')}><input type="date" {...bind('decision_due_date')} /></Field>
          {!isNew && <Field label={t('Client feedback')} className="span-all"><textarea {...bind('followup_notes')} /></Field>}
        </div>
      </section>

      <section className="form-group">
        <h3>{t('Client details')}</h3>
        <div className="form-grid">
          <Field label={t('First name / contact')}><input {...bindClient('first_name')} /></Field>
          <Field label={t('Family name')}><input {...bindClient('family_name')} /></Field>
          <Field label={t('Phone')}><input type="tel" {...bindClient('phone')} /></Field>
          <Field label={t('Email')}><input type="email" {...bindClient('email')} /></Field>
          <Field label={t('Country / nationality')}><input {...bindClient('nationality')} /></Field>
          <Field label={t('Instagram ID')}><input {...bindClient('social_handle')} placeholder="@" /></Field>
          <Field label={t('Address details')} className="span-all"><input {...bindClient('address')} /></Field>
        </div>
      </section>
    </form>
  );
}

/** Keep only fields the API accepts for a booking. */
export function bookingPayload(v: BookingFormValues) {
  const keys = ['name', 'business_unit_id', 'event_type', 'source', 'owner_id', 'account_id', 'contact_id', 'venue_id',
    'function_space_id', 'hall_text', 'event_date', 'end_date', 'pax', 'rate', 'term_days', 'inquiry_date',
    'decision_due_date', 'next_followup_date', 'followup_notes', 'description', 'manual_revenue', 'manual_cost',
    'contract_value', 'credit_facility', 'branch', 'design', 'payment_status'] as const;
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in v) out[k] = (v as Record<string, unknown>)[k];
  if (out.business_unit_id === null) delete out.business_unit_id;
  if (out.owner_id === null && !('id' in v)) delete out.owner_id;
  return out;
}

/** True when the client fields hold anything worth saving. */
export const hasClient = (c?: ClientValues) => Boolean(c && (c.first_name || c.family_name || c.phone || c.email));

/** Client fields for the API, or undefined when none were filled in. A client needs a name: the phone stands in. */
export function clientPayload(c?: ClientValues) {
  if (!c || !hasClient(c)) return undefined;
  const first = c.first_name || (c.family_name ? null : c.phone || c.email);
  return { ...c, first_name: first, name: [first, c.family_name].filter(Boolean).join(' ') };
}
