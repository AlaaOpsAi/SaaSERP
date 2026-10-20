import { X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, download, type Status } from '../api';
import { useAuth } from '../auth';
import { LinkPicker, type Link as ContractLink } from '../components/ActivityForm';
import { DeactivateButton, FormActions } from '../components/FormActions';
import { confirmDiscard, Empty, ErrorNote, Field, FieldGroup, LookupSelect, Modal, StatusBadge, Tabs, useDirty, useForm } from '../components/ui';
import { date, money, today } from '../format';
import { useLabel, useLookups, useSave } from '../hooks';
import { lookupLabel, t } from '../i18n';

type Kind = 'contacts' | 'accounts';
type Value = string | number | boolean | null | undefined;
type Row = { id: string; customer_no: string; name: string; [field: string]: unknown };
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
interface Relationship {
  id: string; relation: string; relation_old: string | null; segment: string | null; booking_id: string | null; booking_no: string | null;
  booking_name: string | null; registered_on: string; registered_by_name: string | null; comments: string | null;
}
type Applicant = Record<string, Value>;
interface Detail {
  id: string; customer_no: string; name: string; [field: string]: unknown;
  bookings: { id: string; booking_no: string; name: string; status: Status; event_date: string | null; revenue: number }[];
  relationships: Relationship[]; applicant?: Applicant | null; created_by_name?: string | null; created_at?: string;
}
interface Duplicate { kind: Kind; id: string; customer_no: string; name: string; field: 'email' | 'phone' }

/**
 * CRM: people and companies (one customer ID series, C + 10 digits), their business
 * relationships (Client, Applicant, Supplier, …) and, for applicants, their profile.
 */
export function Clients() {
  const [tab, setTab] = useState<Kind>('contacts');
  const [q, setQ] = useState('');
  const [relation, setRelation] = useState('');
  const [segment, setSegment] = useState('');
  const [open, setOpen] = useState<{ kind: Kind; id?: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const { can, me } = useAuth();
  const { data: lookups } = useLookups();
  const relationLabel = useLabel('relation');
  const qs = new URLSearchParams({ q, ...(relation ? { relation } : {}), ...(segment ? { segment } : {}) });
  const { data } = useQuery({ queryKey: [tab, qs.toString()], queryFn: () => api<Row[]>(`/${tab}?${qs}`) });

  return (
    <>
      <div className="page-head">
        <div><h1>{t("CRM")}</h1><p>{t("Individuals and companies you sell to, with their booking history.")}</p></div>
        <div className="row">
          {me?.rights.export && <button onClick={() => { setError(null); download('/reports/crm.xlsx', `crm-${today()}.xlsx`).catch(setError); }}>{t('Export Excel')}</button>}
          {can('sell') && <button className="primary" onClick={() => setOpen({ kind: tab })}>{t("New")}{' '}{tab === 'contacts' ? t("contact") : t("company")}</button>}
        </div>
      </div>
      <ErrorNote error={error} />
      <Tabs value={tab} onChange={setTab} tabs={[['contacts', 'Contacts'], ['accounts', 'Companies']]} />
      <div className="filters">
        <input type="search" placeholder={t("Search customer ID, name, phone, email…")} value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={relation} onChange={(e) => setRelation(e.target.value)} aria-label={t('Relationship')}>
          <option value="">{t('All relationships')}</option>
          {lookups?.relation?.filter((l) => l.is_active).map((l) => <option key={l.code} value={l.code}>{relationLabel(l.code)}</option>)}
        </select>
        <select value={segment} onChange={(e) => setSegment(e.target.value)} aria-label={t('Segment')}>
          <option value="">{t('All segments')}</option>
          {lookups?.segment?.filter((l) => l.is_active).map((l) => <option key={l.code} value={l.code}>{lookupLabel(l)}</option>)}
        </select>
      </div>
      <div className="card flush">
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t("Customer ID")}</th><th>{t("Name")}</th><th>{t("Mobile")}</th><th>{t("Email")}</th><th>{t('Relationships')}</th><th>{tab === 'contacts' ? t("Company") : t("Type")}</th><th className="num">{t("Bookings")}</th></tr></thead>
            <tbody>
              {data?.length === 0 && <tr><td colSpan={7} className="empty">{t("No")}{' '}{tab}{' '}{t("found.")}</td></tr>}
              {data?.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => setOpen({ kind: tab, id: r.id })}>
                  <td><span className="tag">{r.customer_no}</span>{str(r.legacy_no) && <div className="small muted">{str(r.legacy_no)}</div>}</td>
                  <td><strong>{r.name}</strong>{str(r.social_handle) && <div className="small secondary">{str(r.social_handle)}</div>}</td>
                  <td><bdi dir="ltr">{str(r.phone) ?? '—'}</bdi></td>
                  <td>{str(r.email) ?? '—'}</td>
                  <td>{(str(r.relations) ?? '').split(',').filter(Boolean).map((x) => <span key={x} className="tag" style={{ marginInlineEnd: 4 }}>{relationLabel(x)}</span>)}</td>
                  <td>{tab === 'contacts' ? str(r.account_name) ?? '—' : str(r.kind)}</td>
                  <td className="num">{str(r.booking_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {open && <ClientModal key={`${open.kind}-${open.id ?? 'new'}`} kind={open.kind} id={open.id} onClose={() => setOpen(null)} onOpen={(kind, id) => setOpen({ kind, id })} />}
    </>
  );
}

function ClientModal({ kind, id, onClose, onOpen }: { kind: Kind; id?: string; onClose: () => void; onOpen: (kind: Kind, id: string) => void }) {
  const { data, isLoading } = useQuery({ queryKey: [kind, 'one', id], queryFn: () => api<Detail>(`/${kind}/${id}`), enabled: Boolean(id) });
  if (id && (isLoading || !data)) return null;
  return <ClientForm kind={kind} initial={data} onClose={onClose} onOpen={onOpen} />;
}

const PERSON_FIELDS = ['title', 'first_name', 'family_name', 'gender', 'position', 'account_id', 'nationality', 'civil_id', 'birth_date', 'social_handle'] as const;
const COMPANY_FIELDS = ['name', 'kind', 'business_type', 'parent_account_id', 'registration_no', 'license_no', 'tax_id', 'legal_rep', 'established_on'] as const;
const SHARED_FIELDS = ['phone', 'mobile2', 'landline', 'email', 'contact_mode', 'web', 'country', 'city', 'zip', 'address', 'segment', 'industry', 'notes'] as const;

function ClientForm({ kind, initial, onClose, onOpen }: { kind: Kind; initial?: Detail; onClose: () => void; onOpen: (kind: Kind, id: string) => void }) {
  const { can } = useAuth();
  const { data: lookups } = useLookups();
  const { data: accounts } = useQuery({ queryKey: ['accounts', ''], queryFn: () => api<Row[]>('/accounts?limit=500') });
  const fields = [...(kind === 'contacts' ? PERSON_FIELDS : COMPANY_FIELDS), ...SHARED_FIELDS];
  const start: Record<string, string | null> = Object.fromEntries(fields.map((f) => {
    const v = initial?.[f];
    return [f, v === null || v === undefined ? (f === 'kind' ? 'company' : f === 'name' || f === 'first_name' ? '' : null) : String(v).slice(0, f.endsWith('_date') || f === 'established_on' ? 10 : undefined)];
  }));
  if (kind === 'contacts' && initial && !initial.first_name && !initial.family_name) start.first_name = initial.name;
  const { form, set, bind } = useForm<Record<string, string | null>>(start);
  const [newsletter, setNewsletter] = useState(Boolean(initial?.newsletter));
  const body = { ...form, newsletter };
  const save = useSave(() => (initial?.id ? api(`/${kind}/${initial.id}`, { method: 'PATCH', body }) : api<Row>(`/${kind}`, { body })), [[kind], ['contacts'], ['accounts']]);
  const editable = can('sell');
  const dirty = useDirty(body);
  const duplicate = useDuplicate(form.email, form.phone, initial?.id ? { kind, id: initial.id } : undefined);
  const saveDuplicate = (save.error as { details?: { duplicate?: Duplicate } } | null)?.details?.duplicate;
  const shown = duplicate ?? saveDuplicate ?? null;
  const reachable = Boolean(form.email?.trim() || form.phone?.trim());

  return (
    <Modal wide title={initial?.id ? `${initial.customer_no} · ${initial.name}` : kind === 'contacts' ? t("New contact") : t("New company")} onClose={onClose} dirty={dirty}
      footer={editable ? <FormActions formId="client-form" saving={save.isPending} onCancel={confirmDiscard(dirty, onClose)}
        remove={initial?.id && <DeactivateButton kind={kind} id={initial.id} name={String(initial.customer_no ?? initial.name)} invalidate={[[kind]]} onDone={onClose} />} /> : undefined}>
      <form id="client-form" className="stack" onSubmit={(e) => {
        e.preventDefault();
        if (!reachable) return;
        save.mutate(undefined, { onSuccess: (row) => (initial?.id || !row ? onClose() : onOpen(kind, (row as Row).id)) });
      }}>
        <ErrorNote error={saveDuplicate ? null : save.error} />
        {shown && (
          <div className="alert warn spread" role="alert">
            <span>{t('Already exists under customer: {no} {name}', { no: shown.customer_no, name: shown.name })} ({shown.field === 'email' ? t('same email') : t('same mobile')})</span>
            <button type="button" className="sm" onClick={() => onOpen(shown.kind, shown.id)}>{t('Open {no}', { no: shown.customer_no })}</button>
          </div>
        )}
        <fieldset disabled={!editable} className="stack" style={{ border: 'none', padding: 0, margin: 0 }}>
          <Section title={kind === 'contacts' ? t('Person') : t('Company')}>
            {kind === 'contacts' ? <>
              <Field label={t('Title')}><LookupSelect options={lookups?.title} value={form.title} onChange={set('title')} /></Field>
              <Field label={t("First & middle name")}><input required {...bind('first_name')} /></Field>
              <Field label={t("Family name")}><input {...bind('family_name')} /></Field>
              <Field label={t('Gender')}>
                <select value={form.gender ?? ''} onChange={(e) => set('gender')(e.target.value || null)}>
                  <option value="">—</option><option value="M">{t('Male')}</option><option value="F">{t('Female')}</option>
                </select>
              </Field>
              <Field label={t('Position / profession')}><input {...bind('position')} /></Field>
              <Field label={t("Company")}>
                <select {...bind('account_id')}><option value="">—</option>{accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              </Field>
              <Field label={t("Nationality / country")}><input {...bind('nationality')} /></Field>
              <Field label={t('Civil ID')}><input {...bind('civil_id')} inputMode="numeric" /></Field>
              <Field label={t('Date of birth')}><input type="date" {...bind('birth_date')} /></Field>
            </> : <>
              <Field label={t("Name")} className="span-2"><input required {...bind('name')} /></Field>
              <Field label={t("Type")}>
                <select {...bind('kind')}><option value="company">{t("Company")}</option><option value="agency">{t("Agency")}</option><option value="government">{t("Government")}</option><option value="individual">{t("Individual")}</option></select>
              </Field>
              <Field label={t("Business type")}><LookupSelect options={lookups?.business_type} value={form.business_type} onChange={set('business_type')} /></Field>
              <Field label={t('Parent company')}>
                <select {...bind('parent_account_id')}><option value="">—</option>{accounts?.filter((a) => a.id !== initial?.id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              </Field>
              <Field label={t('Company registration no.')}><input {...bind('registration_no')} /></Field>
              <Field label={t('License number')}><input {...bind('license_no')} /></Field>
              <Field label={t('Tax ID')}><input {...bind('tax_id')} /></Field>
              <Field label={t('Legal representative')}><input {...bind('legal_rep')} /></Field>
              <Field label={t('Established on')}><input type="date" {...bind('established_on')} /></Field>
            </>}
          </Section>
          <Section title={t('Contact')} note={reachable ? undefined : t('An email or a mobile number is required.')}>
            <Field label={t('Mobile')}><input type="tel" dir="ltr" {...bind('phone')} placeholder="+965 …" /></Field>
            <Field label={t('Second mobile')}><input type="tel" dir="ltr" {...bind('mobile2')} /></Field>
            <Field label={t('Landline')}><input type="tel" dir="ltr" {...bind('landline')} /></Field>
            <Field label={t("Email")}><input type="email" {...bind('email')} /></Field>
            <Field label={t('Preferred contact')}><LookupSelect options={lookups?.contact_mode} value={form.contact_mode} onChange={set('contact_mode')} /></Field>
            {kind === 'contacts' && <Field label={t("Instagram / social")}><input {...bind('social_handle')} /></Field>}
            <Field label={t('Web page')}><input {...bind('web')} /></Field>
          </Section>
          <Section title={t('Address')}>
            <Field label={t("Country")}><input {...bind('country')} /></Field>
            <Field label={t('City')}><input {...bind('city')} /></Field>
            <Field label={t('ZIP code')}><input {...bind('zip')} /></Field>
            <Field label={t('Address details')} className="span-all"><input {...bind('address')} /></Field>
          </Section>
          <Section title={t('Segment & marketing')}>
            <Field label={t('Segment')}><LookupSelect options={lookups?.segment} value={form.segment} onChange={set('segment')} /></Field>
            <Field label={t('Industry')}><LookupSelect options={lookups?.industry} value={form.industry} onChange={set('industry')} /></Field>
            <FieldGroup label={t('Newsletter')}>
              <label className="check"><input type="checkbox" checked={newsletter} onChange={(e) => setNewsletter(e.target.checked)} />
                {t('Agreed to receive newsletters and campaigns')}</label>
              {initial?.newsletter && initial.newsletter_at ? <span className="small muted">{t('since')} {date(String(initial.newsletter_at))}</span> : null}
            </FieldGroup>
            <Field label={t("Notes")} className="span-all"><textarea {...bind('notes')} /></Field>
          </Section>
        </fieldset>
        {initial?.id && (
          <p className="small muted" style={{ margin: 0 }}>
            {t('Registered {date} by {name}', { date: date(String(initial.created_at ?? '')), name: initial.created_by_name ?? '—' })}
            {initial.legacy_no ? ` · ${t('Earlier ID')}: ${initial.legacy_no}` : ''}
          </p>
        )}
      </form>
      {initial?.id && (
        <div className="stack" style={{ marginTop: 16 }}>
          <Relationships kind={kind} owner={initial} editable={editable} />
          {kind === 'contacts' && <ApplicantProfile owner={initial} editable={editable} />}
          <Bookings rows={initial.bookings} />
        </div>
      )}
    </Modal>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="detail-group">
      <h3>{title}{note && <span className="small" style={{ color: 'var(--danger)', fontWeight: 400, marginInlineStart: 8 }}>{note}</span>}</h3>
      <div className="form-grid">{children}</div>
    </section>
  );
}

/** Warn while typing when the email or mobile already belongs to a customer. */
function useDuplicate(email: string | null, phone: string | null, exclude?: { kind: Kind; id: string }) {
  const [args, setArgs] = useState('');
  useEffect(() => {
    const h = setTimeout(() => {
      const p = new URLSearchParams();
      if (email && /.+@.+\..+/.test(email)) p.set('email', email.trim());
      if (phone && phone.replace(/\D/g, '').length >= 8) p.set('phone', phone);
      if (exclude) { p.set('kind', exclude.kind); p.set('id', exclude.id); }
      setArgs(p.has('email') || p.has('phone') ? p.toString() : '');
    }, 400);
    return () => clearTimeout(h);
  }, [email, phone, exclude?.kind, exclude?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data } = useQuery({ queryKey: ['customer-check', args], queryFn: () => api<{ duplicate: Duplicate | null }>(`/customers/check?${args}`), enabled: Boolean(args) });
  return args ? data?.duplicate ?? null : null;
}

// ---- relationships -----------------------------------------------------------

function Relationships({ kind, owner, editable }: { kind: Kind; owner: Detail; editable: boolean }) {
  const { data: lookups } = useLookups();
  const label = { relation: useLabel('relation'), old: useLabel('relation_old'), segment: useLabel('segment') };
  const [adding, setAdding] = useState(false);
  const blank = { relation: '', relation_old: null as string | null, segment: (owner.segment as string | null) ?? null, registered_on: today(), comments: null as string | null };
  const { form, setForm, set, bind } = useForm(blank);
  const [contract, setContract] = useState<ContractLink | null>(null);
  const inv = [[kind, 'one', owner.id], [kind]];
  const add = useSave(() => api(`/${kind}/${owner.id}/relationships`, { body: { ...form, booking_id: contract?.id ?? null } }), inv);
  const remove = useSave((id: string) => api(`/customer-relationships/${id}`, { method: 'DELETE' }), inv);
  return (
    <section className="detail-group">
      <div className="spread">
        <h3>{t('Relationships')}</h3>
        {editable && !adding && <button type="button" className="sm" onClick={() => setAdding(true)}>{t('+ Add relationship')}</button>}
      </div>
      <p className="small muted" style={{ margin: 0 }}>{t('One customer can be a client, a supplier, an applicant… at the same time.')}</p>
      <ErrorNote error={add.error ?? remove.error} />
      {owner.relationships.length === 0 && !adding ? <Empty>{t('No relationships yet.')}</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t('Relationship')}</th><th>{t('Segment')}</th><th>{t('Contract')}</th><th>{t('Registered')}</th><th>{t('Comments')}</th><th /></tr></thead>
            <tbody>
              {owner.relationships.map((r) => (
                <tr key={r.id}>
                  <td><span className="tag">{label.relation(r.relation)}</span>{r.relation_old && <div className="small muted">{label.old(r.relation_old)}</div>}</td>
                  <td>{r.segment ? label.segment(r.segment) : '—'}</td>
                  <td>{r.booking_id ? <Link to={`/bookings/${r.booking_id}`}>{r.booking_no}</Link> : '—'}</td>
                  <td>{date(r.registered_on)}<div className="small muted">{r.registered_by_name}</div></td>
                  <td className="secondary">{r.comments}</td>
                  <td className="num">{editable && <button type="button" className="sm ghost danger" aria-label={t('Remove')}
                    onClick={() => confirm(t('Remove this relationship?')) && remove.mutate(r.id)}><X className="ico" aria-hidden /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && (
        <form className="form-grid" onSubmit={(e) => {
          e.preventDefault();
          add.mutate(undefined, { onSuccess: () => { setForm(blank); setContract(null); setAdding(false); } });
        }}>
          <Field label={t('Relationship')}>
            <select required value={form.relation} onChange={(e) => set('relation')(e.target.value)}>
              <option value="">{t('Choose…')}</option>
              {lookups?.relation?.filter((l) => l.is_active).map((l) => <option key={l.code} value={l.code}>{label.relation(l.code)}</option>)}
            </select>
          </Field>
          <Field label={t('Earlier relationship list (optional)')}><LookupSelect options={lookups?.relation_old} value={form.relation_old} onChange={set('relation_old')} /></Field>
          <Field label={t('Segment')}><LookupSelect options={lookups?.segment} value={form.segment} onChange={set('segment')} /></Field>
          <Field label={t('Registered on')}><input type="date" required {...bind('registered_on')} /></Field>
          <FieldGroup label={t('Contract (optional)')} className="span-2"><LinkPicker value={contract} onChange={setContract} contractsOnly /></FieldGroup>
          <Field label={t('Comments')} className="span-all"><input {...bind('comments')} /></Field>
          <div className="row span-all">
            <button type="button" onClick={() => { setAdding(false); setContract(null); }}>{t('Cancel')}</button>
            <button className="primary" disabled={add.isPending}>{t('Add relationship')}</button>
          </div>
        </form>
      )}
    </section>
  );
}

// ---- applicant profile -------------------------------------------------------------

const APPLICANT_BLANK: Applicant = {
  education: null, degree_industry: null, degree_industry2: null, degree_name: null, degree_year: null, degree_country: null,
  years_experience: null, manager_experience: null, companies: null, experience_fields: null, languages: null, driving_license: null,
};

function ApplicantProfile({ owner, editable }: { owner: Detail; editable: boolean }) {
  const { data: lookups } = useLookups();
  const isApplicant = owner.relationships.some((r) => r.relation === 'APPL');
  const [open, setOpen] = useState(Boolean(owner.applicant) || isApplicant);
  const [form, setForm] = useState<Applicant>({ ...APPLICANT_BLANK, ...(owner.applicant ?? {}) });
  const set = (k: string) => (v: string | number | boolean | null) => setForm((f) => ({ ...f, [k]: v }));
  const text = (k: string) => ({ value: form[k] === null || form[k] === undefined ? '' : String(form[k]), onChange: (e: { target: { value: string } }) => set(k)(e.target.value || null) });
  const num = (k: string) => ({ type: 'number', value: form[k] === null ? '' : String(form[k]), onChange: (e: { target: { value: string } }) => set(k)(e.target.value === '' ? null : Number(e.target.value)) });
  const save = useSave(() => {
    const body = Object.fromEntries(Object.keys(APPLICANT_BLANK).map((k) => [k, form[k] ?? null]));
    return api(`/contacts/${owner.id}/applicant`, { method: 'PUT', body });
  }, [['contacts', 'one', owner.id]]);
  if (!open) return editable ? <div><button type="button" className="sm" onClick={() => setOpen(true)}>{t('+ Applicant profile')}</button></div> : null;
  return (
    <section className="detail-group">
      <h3>{t('Applicant profile')}</h3>
      <ErrorNote error={save.error} />
      <fieldset disabled={!editable} className="form-grid" style={{ border: 'none', padding: 0, margin: 0 }}>
        <Field label={t('Highest education')}><LookupSelect options={lookups?.education} value={form.education as string | null} onChange={set('education')} /></Field>
        <Field label={t('Degree industry')}><LookupSelect options={lookups?.industry} value={form.degree_industry as string | null} onChange={set('degree_industry')} /></Field>
        <Field label={t('Second degree industry')}><LookupSelect options={lookups?.industry} value={form.degree_industry2 as string | null} onChange={set('degree_industry2')} /></Field>
        <Field label={t('Degree name')} className="span-2"><input {...text('degree_name')} /></Field>
        <Field label={t('Year obtained')}><input {...num('degree_year')} /></Field>
        <Field label={t('Degree country')}><input {...text('degree_country')} /></Field>
        <Field label={t('Years of experience')}><input step="0.5" {...num('years_experience')} /></Field>
        <Field label={t('Management experience')}>
          <select value={form.manager_experience === null ? '' : form.manager_experience ? 'yes' : 'no'} onChange={(e) => set('manager_experience')(e.target.value === '' ? null : e.target.value === 'yes')}>
            <option value="">—</option><option value="yes">{t('Yes')}</option><option value="no">{t('No')}</option>
          </select>
        </Field>
        <Field label={t('Companies worked for')} className="span-all"><input {...text('companies')} /></Field>
        <Field label={t('Fields of experience')} className="span-2"><input {...text('experience_fields')} /></Field>
        <Field label={t('Languages + level')}><input {...text('languages')} /></Field>
        <Field label={t('Driving license')}><input {...text('driving_license')} /></Field>
      </fieldset>
      {editable && <div><button type="button" className="primary sm" disabled={save.isPending} onClick={() => save.mutate(undefined)}>{t('Save profile')}</button>
        {save.isSuccess && <span className="small muted" style={{ marginInlineStart: 8 }}>{t('Saved.')}</span>}</div>}
    </section>
  );
}

function Bookings({ rows }: { rows: Detail['bookings'] }) {
  return (
    <section className="detail-group">
      <h3>{t("Bookings")}</h3>
      {rows.length === 0 ? <p className="muted" style={{ margin: 0 }}>{t("None yet.")}</p> : (
        <table>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td><Link to={`/bookings/${b.id}`}>{b.booking_no}</Link> {b.name}</td>
                <td><StatusBadge status={b.status} /></td>
                <td>{date(b.event_date)}</td>
                <td className="num">{money(b.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
