import { useMemo } from 'react';
import type { Booking } from '../api';
import { useBusinessUnits, useLookups, useUsers, useVenues } from '../hooks';
import { today } from '../format';
import { Field, LookupSelect, useForm } from './ui';

export type BookingFormValues = Partial<Booking> & {
  contact?: { name: string; phone?: string | null; email?: string | null; social_handle?: string | null };
};

/** Create / edit form for a booking header. `isNew` shows the inline client and status fields. */
export function BookingForm({ initial, isNew, onSubmit, id }: {
  initial?: Partial<Booking>; isNew?: boolean; onSubmit: (v: BookingFormValues) => void; id: string;
}) {
  const { data: lookups } = useLookups();
  const { data: users } = useUsers();
  const { data: venues } = useVenues();
  const { data: units } = useBusinessUnits();
  const { form, set, bind, bindNum } = useForm<BookingFormValues>({
    inquiry_date: today(),
    credit_facility: false,
    ...initial,
  });
  const contact = form.contact ?? { name: '' };
  const setContact = (k: string, v: string) => set('contact')({ ...contact, [k]: v });
  const spaces = useMemo(() => venues?.find((v) => v.id === form.venue_id)?.spaces ?? [], [venues, form.venue_id]);

  return (
    <form
      id={id}
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        const { contact: c, ...rest } = form;
        onSubmit(isNew && c?.name && !rest.contact_id ? { ...rest, contact: c } : rest);
      }}
    >
      <div className="form-grid">
        <Field label="Booking name" className="span-2"><input required {...bind('name')} placeholder="e.g. Latifa wedding" /></Field>
        {isNew && (units?.length ?? 0) > 1 && (
          <Field label="Business unit">
            <select {...bind('business_unit_id')}>
              <option value="">Default</option>
              {units!.map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Event type"><LookupSelect options={lookups?.event_type} value={form.event_type} onChange={set('event_type')} /></Field>
        <Field label="Source"><LookupSelect options={lookups?.source} value={form.source} onChange={set('source')} /></Field>
        <Field label="Account manager">
          <select {...bind('owner_id')}>
            <option value="">Me</option>
            {users?.map((u) => <option key={u.id} value={u.id}>{u.name}{u.code ? ` (${u.code})` : ''}</option>)}
          </select>
        </Field>
        {isNew && (
          <Field label="Status">
            <select value={form.status ?? 'INQ'} onChange={(e) => set('status')(e.target.value as Booking['status'])}>
              <option value="INQ">Inquiry</option>
              <option value="TEN">Tentative</option>
              <option value="DEF">Definite</option>
            </select>
          </Field>
        )}
      </div>

      {isNew && (
        <fieldset className="form-grid" style={{ border: 'none', padding: 0, margin: 0 }}>
          <Field label="Client name"><input value={contact.name} onChange={(e) => setContact('name', e.target.value)} /></Field>
          <Field label="Client phone"><input value={contact.phone ?? ''} onChange={(e) => setContact('phone', e.target.value)} /></Field>
          <Field label="Client email"><input type="email" value={contact.email ?? ''} onChange={(e) => setContact('email', e.target.value)} /></Field>
          <Field label="Instagram / social"><input value={contact.social_handle ?? ''} onChange={(e) => setContact('social_handle', e.target.value)} /></Field>
        </fieldset>
      )}

      <div className="form-grid">
        <Field label="Event date"><input type="date" {...bind('event_date')} /></Field>
        <Field label="Venue / location">
          <select value={form.venue_id ?? ''} onChange={(e) => { set('venue_id')(e.target.value || null); set('function_space_id')(null); }}>
            <option value="">—</option>
            {venues?.filter((v) => v.is_active || v.id === form.venue_id).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </Field>
        <Field label="Function space">
          <select {...bind('function_space_id')} disabled={!spaces.length}>
            <option value="">—</option>
            {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}{s.capacity ? ` (${s.capacity})` : ''}</option>)}
          </select>
        </Field>
        <Field label="Pax / units"><input {...bindNum('pax')} min={0} step={1} /></Field>
        <Field label="Rate per pax / unit"><input {...bindNum('rate')} /></Field>
        <Field label="Term days / room nights"><input {...bindNum('term_days')} min={0} step={1} /></Field>
        <Field label="Enquiry date"><input type="date" required {...bind('inquiry_date')} /></Field>
        <Field label="Decision due"><input type="date" {...bind('decision_due_date')} /></Field>
        <Field label="Request description & notes" className="span-all"><textarea {...bind('description')} /></Field>
      </div>

      <div className="form-grid">
        <Field label="Manual revenue (if no lines)"><input {...bindNum('manual_revenue')} /></Field>
        <Field label="Manual cost (if no lines)"><input {...bindNum('manual_cost')} /></Field>
        <Field label="Total contract value"><input {...bindNum('contract_value')} /></Field>
        <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}>
          <input type="checkbox" checked={Boolean(form.credit_facility)} onChange={(e) => set('credit_facility')(e.target.checked)} />
          Credit facility (CF cost applies)
        </label>
      </div>
    </form>
  );
}

/** Keep only fields the API accepts for a booking. */
export function bookingPayload(v: BookingFormValues) {
  const keys = ['name', 'business_unit_id', 'event_type', 'source', 'owner_id', 'account_id', 'contact_id', 'venue_id',
    'function_space_id', 'hall_text', 'event_date', 'end_date', 'pax', 'rate', 'term_days', 'inquiry_date',
    'decision_due_date', 'next_followup_date', 'followup_notes', 'description', 'manual_revenue', 'manual_cost',
    'contract_value', 'credit_facility', 'status', 'contact'] as const;
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in v) out[k] = (v as Record<string, unknown>)[k];
  if (out.business_unit_id === null) delete out.business_unit_id;
  if (out.owner_id === null && !('id' in v)) delete out.owner_id;
  return out;
}
