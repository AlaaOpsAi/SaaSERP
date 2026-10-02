import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Status } from '../api';
import { useAuth } from '../auth';
import { ErrorNote, Field, LookupSelect, Modal, StatusBadge, Tabs, useForm } from '../components/ui';
import { date, money } from '../format';
import { useLookups, useSave } from '../hooks';
import { t } from '../i18n';

interface Contact { id: string; name: string; phone: string | null; email: string | null; nationality: string | null; address: string | null;
  social_handle: string | null; notes: string | null; account_id: string | null; account_name: string | null; booking_count: number }
interface Account { id: string; name: string; kind: string; business_type: string | null; phone: string | null; email: string | null;
  address: string | null; country: string | null; notes: string | null; booking_count: number }
interface Linked { bookings: { id: string; booking_no: string; name: string; status: Status; event_date: string | null; revenue: number }[] }

export function Clients() {
  const [tab, setTab] = useState<'contacts' | 'accounts'>('contacts');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<{ kind: 'contacts' | 'accounts'; id?: string } | null>(null);
  const { can } = useAuth();
  const { data } = useQuery({
    queryKey: [tab, q],
    queryFn: () => api<(Contact | Account)[]>(`/${tab}?q=${encodeURIComponent(q)}`),
  });

  return (
    <>
      <div className="page-head">
        <div><h1>{t("Clients")}</h1><p>{t("Individuals and companies you sell to, with their booking history.")}</p></div>
        {can('sell') && <button className="primary" onClick={() => setOpen({ kind: tab })}>{t("New")}{' '}{tab === 'contacts' ? t("contact") : t("company")}</button>}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[['contacts', 'Contacts'], ['accounts', 'Companies']]} />
      <div className="filters"><input type="search" placeholder={t("Search name, phone, email…")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="card flush">
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t("Name")}</th><th>{t("Phone")}</th><th>{t("Email")}</th><th>{tab === 'contacts' ? t("Company") : t("Type")}</th><th className="num">{t("Bookings")}</th></tr></thead>
            <tbody>
              {data?.length === 0 && <tr><td colSpan={5} className="empty">{t("No")}{' '}{tab}{' '}{t("found.")}</td></tr>}
              {data?.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => setOpen({ kind: tab, id: r.id })}>
                  <td><strong>{r.name}</strong>{'social_handle' in r && r.social_handle && <div className="small secondary">{r.social_handle}</div>}</td>
                  <td>{r.phone ?? '—'}</td>
                  <td>{r.email ?? '—'}</td>
                  <td>{'account_name' in r ? r.account_name ?? '—' : (r as Account).kind}</td>
                  <td className="num">{r.booking_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {open && <ClientModal kind={open.kind} id={open.id} onClose={() => setOpen(null)} />}
    </>
  );
}

function ClientModal({ kind, id, onClose }: { kind: 'contacts' | 'accounts'; id?: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: [kind, 'one', id],
    queryFn: () => api<(Contact & Linked) | (Account & Linked)>(`/${kind}/${id}`),
    enabled: Boolean(id),
  });
  if (id && (isLoading || !data)) return null;
  return <ClientForm kind={kind} initial={data} onClose={onClose} />;
}

function ClientForm({ kind, initial, onClose }: { kind: 'contacts' | 'accounts'; initial?: Partial<Contact & Account & Linked>; onClose: () => void }) {
  const { can } = useAuth();
  const { data: lookups } = useLookups();
  const { data: accounts } = useQuery({ queryKey: ['accounts', ''], queryFn: () => api<Account[]>('/accounts'), enabled: kind === 'contacts' });
  const { form, set, bind } = useForm<Record<string, string | null>>(
    kind === 'contacts'
      ? { name: initial?.name ?? '', phone: initial?.phone ?? null, email: initial?.email ?? null, nationality: initial?.nationality ?? null,
          address: initial?.address ?? null, social_handle: initial?.social_handle ?? null, notes: initial?.notes ?? null, account_id: initial?.account_id ?? null }
      : { name: initial?.name ?? '', kind: initial?.kind ?? 'company', business_type: initial?.business_type ?? null, phone: initial?.phone ?? null,
          email: initial?.email ?? null, address: initial?.address ?? null, country: initial?.country ?? null, notes: initial?.notes ?? null },
  );
  const save = useSave(
    () => (initial?.id ? api(`/${kind}/${initial.id}`, { method: 'PATCH', body: form }) : api(`/${kind}`, { body: form })),
    [[kind]],
  );
  const editable = can('sell');

  return (
    <Modal title={initial?.id ? String(initial.name) : kind === 'contacts' ? t("New contact") : t("New company")} onClose={onClose}
      footer={editable ? <><button onClick={onClose}>{t("Cancel")}</button><button className="primary" form="client-form" disabled={save.isPending}>{t("Save")}</button></> : undefined}>
      <form id="client-form" className="stack" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }}>
        <ErrorNote error={save.error} />
        <fieldset disabled={!editable} className="form-grid" style={{ border: 'none', padding: 0, margin: 0 }}>
          <Field label={t("Name")} className="span-2"><input required {...bind('name')} /></Field>
          <Field label={t("Phone")}><input {...bind('phone')} /></Field>
          <Field label={t("Email")}><input type="email" {...bind('email')} /></Field>
          {kind === 'contacts' ? <>
            <Field label={t("Company")}>
              <select {...bind('account_id')}><option value="">—</option>{accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            </Field>
            <Field label={t("Nationality / country")}><input {...bind('nationality')} /></Field>
            <Field label={t("Instagram / social")}><input {...bind('social_handle')} /></Field>
            <Field label={t("Address / area")}><input {...bind('address')} /></Field>
          </> : <>
            <Field label={t("Type")}>
              <select {...bind('kind')}><option value="company">{t("Company")}</option><option value="agency">{t("Agency")}</option><option value="government">{t("Government")}</option><option value="individual">{t("Individual")}</option></select>
            </Field>
            <Field label={t("Business type")}><LookupSelect options={lookups?.business_type} value={form.business_type} onChange={set('business_type')} /></Field>
            <Field label={t("Country")}><input {...bind('country')} /></Field>
            <Field label={t("Address")}><input {...bind('address')} /></Field>
          </>}
          <Field label={t("Notes")} className="span-all"><textarea {...bind('notes')} /></Field>
        </fieldset>
        {initial?.bookings && (
          <div>
            <h3 style={{ marginBottom: 8 }}>{t("Bookings")}</h3>
            {initial.bookings.length === 0 ? <p className="muted">{t("None yet.")}</p> : (
              <table>
                <tbody>
                  {initial.bookings.map((b) => (
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
          </div>
        )}
      </form>
    </Modal>
  );
}
