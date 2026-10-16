import { Check, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type BookingDetail, type BookingEvent, type Conflict, type Item, type Status } from '../api';
import { useAuth, useHidden } from '../auth';
import { BookingForm, bookingPayload, clientOf, clientPayload, hasClient } from '../components/BookingForm';
import { ActivityDialog } from '../components/ActivityForm';
import { ContractDocuments, UploadDialog } from '../components/ContractDocuments';
import { activityType, CompleteButton } from '../components/CompleteActivity';
import { DeactivateButton, FormActions } from '../components/FormActions';
import { confirmDiscard, Empty, ErrorNote, Field, LookupSelect, Modal, SkeletonPage, StatusBadge, Tabs, useForm } from '../components/ui';
import { date, dateTime, fromLocalInput, money, num, pct, statusLabel, time, today, toLocalInput, TRANSITIONS } from '../format';
import { useLabel, useLookups, useSave, useUsers, useVenues } from '../hooks';
import { t } from '../i18n';

type Tab = 'overview' | 'documents' | 'events' | 'lines' | 'money' | 'history';

export function BookingDetailPage() {
  const { id = '' } = useParams();
  const key = ['booking', id];
  const { data: b, isLoading, error } = useQuery({ queryKey: key, queryFn: () => api<BookingDetail>(`/bookings/${id}`) });
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const hidden = useHidden();

  if (isLoading) return <SkeletonPage />;
  if (error || !b) return <ErrorNote error={error ?? new Error(t('Booking not found'))} />;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="small muted"><Link to="/bookings">{t("Contracts")}</Link> / {b.booking_no}</div>
          <h1 className="row" style={{ marginTop: 4 }}>{b.name} <StatusBadge status={b.status} /></h1>
          <p>
            {b.booking_no} · {b.contact_name ?? t("No client")}{b.contact_phone ? ` · ${b.contact_phone}` : ''} · {date(b.event_date)}
            {b.venue_name ? ` · ${b.venue_name}` : ''}{b.space_name ? ` / ${b.space_name}` : ''}
          </p>
        </div>
        <StatusActions booking={b} />
      </div>

      {b.conflicts.length > 0 && (
        <div className="alert" style={{ marginBottom: 16 }}>{t("Space clash with")}{' '}{b.conflicts.map((c) => !c.booking_id ? (
            <span key={c.event_id} style={{ marginInlineEnd: 8 }}>{c.booking_name} ({statusLabel(c.status)}, {c.space_name} {time(c.start_at)}–{time(c.end_at)})</span>
          ) : (
            <Link key={c.event_id} to={`/bookings/${c.booking_id}`} style={{ marginInlineEnd: 8 }}>
              {c.booking_no} ({statusLabel(c.status)}, {c.space_name} {time(c.start_at)}–{time(c.end_at)})
            </Link>
          ))}
        </div>
      )}

      <CoverNote b={b} />
      {b.signed_missing && tab !== 'documents' && (
        <div className="alert warn spread" style={{ marginBottom: 12 }}>
          <span>{t('Signed contract missing: upload the copy the client signed (photo or PDF).')}</span>
          <button className="sm" onClick={() => setTab('documents')}>{t('Open documents')}</button>
        </div>
      )}
      <Pipeline status={b.status} />

      <div style={{ display: 'grid', gridTemplateColumns: hidden('finance') ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 300px', gap: 16, alignItems: 'start' }} className="detail-grid">
        <div className="card">
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              ['overview', 'Contract'],
              ['documents', `${t('Documents')} (${b.documents.length + b.files.length})${b.signed_missing ? ' ⚠' : ''}`],
              ['events', `${t('Events')} (${b.events.length})`],
              ...(hidden('finance') ? [] : [['lines', `${t('Revenue & cost')} (${b.items.length})`] as [Tab, string]]),
              ...(hidden('finance') && hidden('money_received') ? [] : [['money', 'Payments & payouts'] as [Tab, string]]),
              ['history', 'History'],
            ]}
          />
          {tab === 'overview' && <ContractGroups b={b} onEdit={() => setEditing(true)} />}
          {tab === 'documents' && <DocumentsTab b={b} />}
          {tab === 'events' && <Events b={b} />}
          {tab === 'lines' && <Lines b={b} />}
          {tab === 'money' && <Money b={b} />}
          {tab === 'history' && <History b={b} />}
        </div>
        {!hidden('finance') && <ProfitCard b={b} />}
      </div>

      {editing && <EditBooking b={b} onClose={() => setEditing(false)} />}
      <style>{`@media (max-width: 1100px) { .detail-grid { grid-template-columns: 1fr !important; } }`}</style>
    </>
  );
}

/**
 * What the signed-in user may do on this booking. While covering for a colleague
 * ("view & act") you can work the booking but never record money; "view only" is read-only.
 */
function useAccess(b: BookingDetail) {
  const { can, me } = useAuth();
  const covering = Boolean(me && !me.sees_all && b.owner_id && !me.team_ids.includes(b.owner_id) && b.created_by !== me.id);
  const allowed = {
    sell: can('sell') && b.can_edit,
    finance: can('finance') && b.can_edit && !covering,
    manage: can('manage') && b.can_edit,
    admin: can('admin') && b.can_edit,
  };
  return { can: (k: keyof typeof allowed) => allowed[k], covering };
}

function CoverNote({ b }: { b: BookingDetail }) {
  const { covering } = useAccess(b);
  if (!covering) return null;
  return (
    <div className="alert info" style={{ marginBottom: 12 }}>
      {b.can_edit
        ? <>{t("You are covering for")}{' '}<strong>{b.owner_name}</strong>{t(". Changes you make are recorded as made on their behalf.")}</>
        : <>{t("You can view")}{' '}<strong>{b.owner_name}</strong>{t("'s booking while covering, but not change it.")}</>}
    </div>
  );
}

function Pipeline({ status }: { status: Status }) {
  const steps: Status[] = ['INQ', 'TEN', 'DEF', 'ACT'];
  const idx = steps.indexOf(status);
  return (
    <div className="pipeline" style={{ marginBottom: 16 }}>
      {steps.map((s, i) => (
        <span key={s} className={`pill-step ${s === status ? 'current' : idx > i ? 'done' : ''}`}>
          {idx > i && <Check className="ico" aria-hidden />}{statusLabel(s)}
        </span>
      ))}
      {(status === 'LOS' || status === 'CXL') && <span className="pill-step current" style={{ background: 'var(--status-critical)', borderColor: 'var(--status-critical)' }}>{statusLabel(status)}</span>}
    </div>
  );
}

function StatusActions({ booking }: { booking: BookingDetail }) {
  const { can } = useAccess(booking);
  const { data: lookups } = useLookups();
  const [target, setTarget] = useState<Status | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [askSigned, setAskSigned] = useState(false);
  const change = useSave(
    (v: { status: Status; reason?: string | null; force?: boolean }) =>
      api(`/bookings/${booking.id}/status`, { body: { status: v.status, reason: v.reason || undefined, force: v.force } }),
    [['booking', booking.id], ['bookings'], ['dashboard'], ['diary']],
  );
  const conflicts: Conflict[] | undefined = (change.error as { details?: { conflicts?: Conflict[] } } | null)?.details?.conflicts;
  if (!can('sell')) return null;

  const needsReason = (s: Status) => s === 'LOS' || s === 'CXL';
  const go = (s: Status, force = false) => {
    if (needsReason(s) && !reason) {
      setTarget(s);
      return;
    }
    change.mutate({ status: s, reason, force }, { onSuccess: (updated: BookingDetail) => {
      setTarget(null); setReason(null);
      // Confirmed: ask for the client's signed copy straight away (it can wait; the contract stays flagged).
      if (s === 'DEF' && updated?.signed_missing) setAskSigned(true);
    } });
  };
  const labels: Partial<Record<Status, string>> = {
    TEN: 'Mark tentative', DEF: 'Confirm (definite)', ACT: 'Actualise', LOS: 'Mark lost', CXL: 'Cancel', INQ: 'Back to inquiry',
  };

  return (
    <div className="stack" style={{ alignItems: 'flex-end', gap: 8 }}>
      <div className="row">
        {TRANSITIONS[booking.status].map((s) => (
          <button key={s} className={s === 'DEF' ? 'primary' : needsReason(s) ? 'danger' : ''} disabled={change.isPending}
            onClick={() => go(s)}>
            {t(labels[s] ?? s)}
          </button>
        ))}
      </div>
      {change.error && !target && (
        <div className="stack" style={{ gap: 6, alignItems: 'flex-end' }}>
          <ErrorNote error={change.error} />
          {conflicts && can('manage') && <button className="sm danger" onClick={() => go('DEF', true)}>{t("Override clash & confirm")}</button>}
        </div>
      )}
      {askSigned && <UploadDialog b={booking} kind="signed_contract" prompt onClose={() => setAskSigned(false)} />}
      {target && (
        <Modal
          title={target === 'LOS' ? t("Why was this booking lost?") : t("Why is this booking cancelled?")}
          onClose={() => setTarget(null)}
          footer={<>
            <button onClick={() => setTarget(null)}>{t("Back")}</button>
            <button className="primary" disabled={!reason || change.isPending} onClick={() => go(target)}>{t("Save")}</button>
          </>}
        >
          <div className="stack">
            <ErrorNote error={change.error} />
            {target === 'LOS' ? (
              <Field label={t("Lost reason")}><LookupSelect options={lookups?.lost_reason} value={reason} onChange={setReason} placeholder={t("Choose a reason…")} /></Field>
            ) : (
              <Field label={t("Cancellation reason")}><textarea value={reason ?? ''} onChange={(e) => setReason(e.target.value || null)} /></Field>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function ProfitCard({ b }: { b: BookingDetail }) {
  const { me } = useAuth();
  const rows: [string, number | null, string?][] = [
    ['Revenue', b.revenue], ['Cost', b.cost], ['Gross margin', b.gross_margin, pct(b.margin_pct)],
    [`${t('Fixed cost')} (${pct(me?.tenant.fixed_cost_pct, 0)})`, b.fixed_cost],
    [`${t('Credit facility')} (${b.credit_facility ? pct(me?.tenant.credit_facility_pct, 0) : t('none')})`, b.cf_cost],
    ['Net profit', b.net_profit], ['Commission', b.commission], ['Partner shares', b.shares],
  ];
  return (
    <div className="stack">
      <div className="card">
        <div className="card-head"><h2>{t("Profitability")}</h2><span className="tag">{b.currency}</span></div>
        <table>
          <tbody>
            {rows.map(([label, v, extra]) => (
              <tr key={label}>
                <td className={label === 'Net profit' || label === 'Gross margin' ? '' : 'secondary'} style={{ padding: '6px 0' }}>
                  {label === 'Net profit' || label === 'Gross margin' ? <strong>{t(label)}</strong> : t(label)}
                  {extra && <span className="muted small"> · {extra}</span>}
                </td>
                <td className="num" style={{ padding: '6px 0' }}>{money(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <div className="card-head"><h2>{t("Client account")}</h2></div>
        <dl className="kv" style={{ gridTemplateColumns: '1fr auto' }}>
          <dt>{t("Contract value")}</dt><dd className="num">{money(b.contract_value ?? b.revenue)}</dd>
          {b.diff !== null && <><dt>{t("Diff (revenue − contract)")}</dt><dd className="num">{money(b.diff)}</dd></>}
          <dt>{t("Paid")}</dt><dd className="num">{money(b.paid)}</dd>
          <dt><strong>{t("Outstanding")}</strong></dt><dd className="num"><strong>{money(b.outstanding)}</strong></dd>
          <dt>{t("Aging")}</dt><dd className="num">{b.aging_days ? `${b.aging_days} days` : '—'}</dd>
          <dt>{t("Fully paid")}</dt><dd className="num">{date(b.fully_paid_date)}</dd>
        </dl>
      </div>
    </div>
  );
}

/**
 * The contract on one page, in the three groups of the daily report:
 * contract & payment details, follow-up details, client details.
 */
function ContractGroups({ b, onEdit }: { b: BookingDetail; onEdit: () => void }) {
  const { can } = useAccess(b);
  const hidden = useHidden();
  const label = { event: useLabel('event_type'), source: useLabel('source'), lost: useLabel('lost_reason'), branch: useLabel('branch'), design: useLabel('design') };
  const client = clientOf(b);
  const show = (f: Parameters<typeof hidden>[0], node: React.ReactNode) => (hidden(f) ? null : node);
  return (
    <div className="stack contract-groups">
      <div className="spread">
        <nav className="group-jump" aria-label={t('Sections')}>
          <a href="#group-contract">{t('Contract & payment')}</a>
          <a href="#group-followup">{t('Follow-up')}</a>
          <a href="#group-client">{t('Client')}</a>
        </nav>
        {can('sell') && <button className="sm" onClick={onEdit}>{t('Edit')}</button>}
      </div>

      <section id="group-contract" className="detail-group">
        <h3><span className="group-no">1</span>{t('Contract & payment details')}</h3>
        <dl className="kv">
          <dt>{t('Contract ID')}</dt><dd><strong>{b.booking_no}</strong> <StatusBadge status={b.status} /></dd>
          {show('business_unit', <><dt>{t('Company')}</dt><dd>{b.business_unit_code}</dd></>)}
          {show('branch', <><dt>{t('Branch')}</dt><dd>{label.branch(b.branch)}</dd></>)}
          <dt>{t('Event date')}</dt><dd>{date(b.event_date)}</dd>
          <dt>{t('Hotel / location')}</dt><dd>{b.venue_name ?? '—'}</dd>
          <dt>{t('Hall / area')}</dt><dd>{b.space_name ?? b.hall_text ?? '—'}</dd>
          {show('pax', <><dt>{t('Pax / units')}</dt><dd>{num(b.pax)}</dd></>)}
          {show('rate', <><dt>{t('Rate / term')}</dt><dd>{money(b.rate)}{b.term_days ? ` · ${t('{n} days', { n: b.term_days })}` : ''}</dd></>)}
          {show('event_type', <><dt>{t('Event type')}</dt><dd>{label.event(b.event_type)}</dd></>)}
          {show('design', <><dt>{t('Design')}</dt><dd>{label.design(b.design)}</dd></>)}
          {show('source', <><dt>{t('Source')}</dt><dd>{label.source(b.source)}</dd></>)}
          {show('owner', <><dt>{t('Account manager')}</dt><dd>{b.owner_name ?? '—'} {b.owner_code && <span className="tag">{b.owner_code}</span>}</dd></>)}
          {show('credit_facility', <><dt>{t('Credit facility')}</dt><dd>{b.credit_facility ? t('Yes') : t('No')}</dd></>)}
        </dl>
        {!(hidden('contract_value') && hidden('money_received')) && (
          <div className="money-strip">
            {show('contract_value', <div><span>{t('Total contract value')}</span><strong>{money(b.contract_value)}</strong></div>)}
            {show('money_received', <div><span>{t('Money received (DP)')}</span><strong>{money(b.paid)}</strong></div>)}
            {!hidden('contract_value') && !hidden('money_received') && (
              <div className={b.diff_ctrl !== null && b.diff_ctrl < 0 ? 'neg' : ''}><span>{t('Difference')}</span><strong>{money(b.diff_ctrl)}</strong></div>
            )}
          </div>
        )}
        {!hidden('money_received') && <DownPayment b={b} />}
      </section>

      <section id="group-followup" className="detail-group">
        <h3><span className="group-no">2</span>{t('Follow-up details')}</h3>
        <dl className="kv">
          <dt>{t('Enquiry date')}</dt><dd>{date(b.inquiry_date)}</dd>
          <dt>{t('Decision due')}</dt><dd>{date(b.decision_due_date)}</dd>
          <dt>{t('Last follow-up')}</dt><dd>{date(b.last_followup_date)}</dd>
          <dt>{t('Next follow-up')}</dt><dd>{date(b.next_followup_date)}</dd>
          {b.lost_reason && <><dt>{t('Lost reason')}</dt><dd>{label.lost(b.lost_reason)}</dd></>}
          {b.cancel_reason && <><dt>{t('Cancel reason')}</dt><dd>{b.cancel_reason}</dd></>}
        </dl>
        {b.description && <div><h4>{t('Request & notes')}</h4><p className="secondary pre">{b.description}</p></div>}
        {b.followup_notes && <div><h4>{t('Client feedback')}</h4><p className="secondary pre">{b.followup_notes}</p></div>}
        <h4>{t('Meetings & follow-ups')}</h4>
        <BookingActivities b={b} />
      </section>

      <section id="group-client" className="detail-group">
        <h3><span className="group-no">3</span>{t('Client details')}</h3>
        {!b.contact_id ? <Empty>{t('No client yet. Add one with Edit.')}</Empty> : (
          <dl className="kv">
            <dt>{t('First name / contact')}</dt><dd>{client.first_name ?? '—'}</dd>
            <dt>{t('Family name')}</dt><dd>{client.family_name ?? '—'}</dd>
            <dt>{t('Phone')}</dt><dd>{client.phone ? <a href={`tel:${client.phone}`}>{client.phone}</a> : '—'}</dd>
            <dt>{t('Email')}</dt><dd>{client.email ? <a href={`mailto:${client.email}`}>{client.email}</a> : '—'}</dd>
            <dt>{t('Country / nationality')}</dt><dd>{client.nationality ?? '—'}</dd>
            <dt>{t('Instagram ID')}</dt><dd>{client.social_handle ?? '—'}</dd>
            <dt>{t('Address details')}</dt><dd>{client.address ?? '—'}</dd>
            {b.account_name && <><dt>{t('Company')}</dt><dd>{b.account_name}</dd></>}
          </dl>
        )}
      </section>
    </div>
  );
}

/** MONEY RECEIVED (DP): the salesperson records the client's down payment on the contract. */
function DownPayment({ b }: { b: BookingDetail }) {
  const { can, covering } = useAccess(b);
  const [open, setOpen] = useState(false);
  const { form, setForm, bind, bindNum } = useForm({ paid_on: today(), amount: null as number | null, reference: null as string | null });
  const save = useSave(() => api(`/bookings/${b.id}/down-payment`, { body: { ...form, method: 'BANK' } }), [['booking', b.id], ['bookings'], ['receivables']]);
  const deposits = b.payments.filter((p) => p.kind === 'deposit');
  if (!can('sell') || covering) {
    return deposits.length ? <p className="small muted" style={{ margin: 0 }}>{t('{n} down payments recorded.', { n: deposits.length })}</p> : null;
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      {deposits.length > 0 && (
        <ul className="plain-list small">
          {deposits.map((p) => <li key={p.id}>{date(p.paid_on)} · <strong>{money(p.amount)}</strong>{p.reference ? ` · ${p.reference}` : ''}</li>)}
        </ul>
      )}
      {open ? (
        <form className="form-grid" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined, { onSuccess: () => { setOpen(false); setForm((f) => ({ ...f, amount: null, reference: null })); } }); }}>
          <Field label={t('Date received')}><input type="date" required {...bind('paid_on')} /></Field>
          <Field label={t('Amount')}><input required min={0.001} {...bindNum('amount')} /></Field>
          <Field label={t('Reference')}><input {...bind('reference')} placeholder={t('e.g. KNET receipt no.')} /></Field>
          <div className="row" style={{ alignSelf: 'end' }}>
            <button type="button" onClick={() => setOpen(false)}>{t('Cancel')}</button>
            <button className="primary" disabled={save.isPending}>{t('Save')}</button>
          </div>
          <div className="span-all"><ErrorNote error={save.error} /></div>
        </form>
      ) : (
        <div><button className="sm" onClick={() => setOpen(true)}>{t('Record down payment')}</button></div>
      )}
    </div>
  );
}

function EditBooking({ b, onClose }: { b: BookingDetail; onClose: () => void }) {
  const save = useSave(async (v: { booking: object; client?: ReturnType<typeof clientPayload> }) => {
    // The client is its own record (CRM): update it, or create it when the contract has none yet.
    let contactId = b.contact_id;
    if (v.client && contactId) await api(`/contacts/${contactId}`, { method: 'PATCH', body: v.client });
    else if (v.client) contactId = (await api<{ id: string }>('/contacts', { body: v.client })).id;
    return api(`/bookings/${b.id}`, { method: 'PATCH', body: { ...v.booking, ...(contactId !== b.contact_id ? { contact_id: contactId } : {}) } });
  }, [['booking', b.id], ['bookings'], ['contacts']]);
  const navigate = useNavigate();
  const { can } = useAccess(b);
  const [dirty, setDirty] = useState(false);
  return (
    <Modal
      title={t('Edit {no}', { no: b.booking_no })}
      onClose={onClose}
      dirty={dirty}
      footer={<FormActions formId="edit-booking" saving={save.isPending} onCancel={confirmDiscard(dirty, onClose)}
        remove={can('sell') && <DeactivateButton kind="bookings" id={b.id} name={b.booking_no} invalidate={[['bookings'], ['booking', b.id]]}
          onDone={() => navigate('/bookings')} />} />}
    >
      <ErrorNote error={save.error} />
      <BookingForm id="edit-booking" initial={b} onDirty={setDirty} onSubmit={(v) => {
        const { status: _s, business_unit_id: _bu, ...rest } = bookingPayload(v);
        const changed = JSON.stringify(v.contact) !== JSON.stringify(clientOf(b));
        save.mutate({ booking: { ...rest, followup_notes: v.followup_notes }, client: changed && hasClient(v.contact) ? clientPayload(v.contact) : undefined },
          { onSuccess: onClose });
      }} />
    </Modal>
  );
}

// ---- events ----------------------------------------------------------------

function Events({ b }: { b: BookingDetail }) {
  const { can } = useAccess(b);
  const [editing, setEditing] = useState<Partial<BookingEvent> | null>(null);
  const del = useSave((id: string) => api(`/booking-events/${id}`, { method: 'DELETE' }), [['booking', b.id], ['diary']]);
  return (
    <div className="stack">
      <div className="spread">
        <p className="secondary" style={{ margin: 0 }}>{t("Functions placed on the diary. Definite bookings cannot overlap another definite booking in the same room.")}</p>
        {can('sell') && <button className="sm primary" onClick={() => setEditing({})}>{t("Add event")}</button>}
      </div>
      {b.events.length === 0 ? <Empty>{t("No events yet.")}</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t("Event")}</th><th>{t("When")}</th><th>{t("Space")}</th><th>{t("Setup")}</th><th className="num">{t("Pax")}</th><th /></tr></thead>
            <tbody>
              {b.events.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}{e.notes && <div className="small secondary">{e.notes}</div>}</td>
                  <td>{dateTime(e.start_at)} – {time(e.end_at)}</td>
                  <td>{e.venue_name ? `${e.venue_name} / ` : ''}{e.space_name ?? '—'}</td>
                  <td>{e.setup_style ?? '—'}</td>
                  <td className="num">{num(e.guaranteed_pax ?? e.expected_pax)}</td>
                  <td className="num">
                    {can('sell') && <>
                      <button className="sm ghost" onClick={() => setEditing(e)}>{t("Edit")}</button>
                      <button className="sm ghost danger" onClick={() => confirm(t('Remove this event?')) && del.mutate(e.id)}>{t("Remove")}</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <EventModal b={b} event={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EventModal({ b, event, onClose }: { b: BookingDetail; event: Partial<BookingEvent>; onClose: () => void }) {
  const { can } = useAccess(b);
  const { data: venues } = useVenues();
  const { data: lookups } = useLookups();
  const base = b.event_date ?? today();
  const { form, set, bind, bindNum } = useForm({
    name: event.name ?? 'Dinner',
    function_space_id: event.function_space_id ?? b.function_space_id ?? null,
    setup_style: event.setup_style ?? null,
    start: event.start_at ? toLocalInput(event.start_at) : `${base}T18:00`,
    end: event.end_at ? toLocalInput(event.end_at) : `${base}T23:00`,
    expected_pax: event.expected_pax ?? b.pax ?? null,
    guaranteed_pax: event.guaranteed_pax ?? null,
    notes: event.notes ?? null,
  });
  const save = useSave((force: boolean) => {
    const body = {
      name: form.name, function_space_id: form.function_space_id, setup_style: form.setup_style,
      start_at: fromLocalInput(form.start), end_at: fromLocalInput(form.end),
      expected_pax: form.expected_pax, guaranteed_pax: form.guaranteed_pax, notes: form.notes, force,
    };
    return event.id
      ? api(`/booking-events/${event.id}`, { method: 'PATCH', body })
      : api(`/bookings/${b.id}/events`, { body });
  }, [['booking', b.id], ['diary']]);
  const clash = (save.error as { details?: { conflicts?: Conflict[] } } | null)?.details?.conflicts;

  return (
    <Modal title={event.id ? t("Edit event") : t("Add event")} onClose={onClose} footer={<>
      <button onClick={onClose}>{t("Cancel")}</button>
      {clash && can('manage') && <button className="danger" onClick={() => save.mutate(true, { onSuccess: onClose })}>{t("Override clash")}</button>}
      <button className="primary" form="event-form">{t("Save")}</button>
    </>}>
      <form id="event-form" className="stack" onSubmit={(e) => { e.preventDefault(); save.mutate(false, { onSuccess: onClose }); }}>
        <ErrorNote error={save.error} />
        {clash && <div className="small secondary">{t("Clashes with")}{' '}{clash.map((c) => `${c.booking_id ? c.booking_no : c.booking_name} ${time(c.start_at)}–${time(c.end_at)}`).join(', ')}</div>}
        <div className="form-grid">
          <Field label={t("Name")}><input required {...bind('name')} /></Field>
          <Field label={t("Function space")}>
            <select {...bind('function_space_id')}>
              <option value="">—</option>
              {venues?.map((v) => (
                <optgroup key={v.id} label={v.name}>
                  {v.spaces.map((s) => <option key={s.id} value={s.id}>{s.name}{s.capacity ? ` (${s.capacity})` : ''}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label={t("Setup style")}><LookupSelect options={lookups?.setup_style} value={form.setup_style} onChange={set('setup_style')} /></Field>
          <Field label={t("Start")}><input type="datetime-local" required value={form.start} onChange={(e) => set('start')(e.target.value)} /></Field>
          <Field label={t("End")}><input type="datetime-local" required value={form.end} onChange={(e) => set('end')(e.target.value)} /></Field>
          <Field label={t("Expected pax")}><input {...bindNum('expected_pax')} /></Field>
          <Field label={t("Guaranteed pax")}><input {...bindNum('guaranteed_pax')} /></Field>
          <Field label={t("Notes")} className="span-all"><textarea {...bind('notes')} /></Field>
        </div>
      </form>
    </Modal>
  );
}

function DocumentsTab({ b }: { b: BookingDetail }) {
  const { can } = useAccess(b);
  return <ContractDocuments b={b} canSell={can('sell')} />;
}

// ---- lines -----------------------------------------------------------------

function Lines({ b }: { b: BookingDetail }) {
  const { can } = useAccess(b);
  const { data: lookups } = useLookups();
  const categoryLabel = useLabel('item_category');
  const blank = { category: 'F&B', description: '', quantity: 1 as number | null, unit_price: 0 as number | null, unit_cost: 0 as number | null };
  const { form, setForm, set, bind, bindNum } = useForm(blank);
  const inv = [['booking', b.id], ['bookings']];
  const add = useSave(() => api<Item>(`/bookings/${b.id}/items`, { body: form }), inv);
  const del = useSave((id: string) => api(`/booking-items/${id}`, { method: 'DELETE' }), inv);

  return (
    <div className="stack">
      <p className="secondary" style={{ margin: 0 }}>{t("Priced lines drive revenue and cost. With no lines, the manual revenue and cost on the booking are used.")}</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>{t("Category")}</th><th>{t("Description")}</th><th className="num">{t("Qty")}</th><th className="num">{t("Unit price")}</th><th className="num">{t("Unit cost")}</th><th className="num">{t("Revenue")}</th><th className="num">{t("Margin")}</th><th /></tr></thead>
          <tbody>
            {b.items.length === 0 && <tr><td colSpan={8} className="empty">{t("No lines yet")}{b.manual_revenue ? ` — using manual revenue ${money(b.manual_revenue)}` : ''}.</td></tr>}
            {b.items.map((i) => (
              <tr key={i.id}>
                <td><span className="tag">{categoryLabel(i.category)}</span></td>
                <td>{i.description}</td>
                <td className="num">{num(i.quantity)}</td>
                <td className="num">{money(i.unit_price)}</td>
                <td className="num">{money(i.unit_cost)}</td>
                <td className="num">{money(i.quantity * i.unit_price)}</td>
                <td className="num">{money(i.quantity * (i.unit_price - i.unit_cost))}</td>
                <td className="num">{can('sell') && <button className="sm ghost danger" onClick={() => del.mutate(i.id)} aria-label={t('Delete')}><X className="ico" aria-hidden /></button>}</td>
              </tr>
            ))}
          </tbody>
          {b.items.length > 0 && (
            <tfoot><tr><td colSpan={5}>{t("Total")}</td><td className="num">{money(b.revenue)}</td><td className="num">{money(b.gross_margin)}</td><td /></tr></tfoot>
          )}
        </table>
      </div>
      {can('sell') && (
        <form className="form-grid" onSubmit={(e) => { e.preventDefault(); add.mutate(undefined, { onSuccess: () => setForm(blank) }); }}>
          <Field label={t("Category")}><LookupSelect options={lookups?.item_category} value={form.category} onChange={(v) => set('category')(v ?? 'OTHER')} /></Field>
          <Field label={t("Description")} className="span-2"><input required {...bind('description')} placeholder={t("e.g. Buffet dinner")} /></Field>
          <Field label={t("Quantity")}><input required {...bindNum('quantity')} /></Field>
          <Field label={t("Unit price")}><input required {...bindNum('unit_price')} /></Field>
          <Field label={t("Unit cost")}><input required {...bindNum('unit_cost')} /></Field>
          <div style={{ alignSelf: 'end' }}><button className="primary" disabled={add.isPending}>{t("Add line")}</button></div>
          <div className="span-all"><ErrorNote error={add.error} /></div>
        </form>
      )}
    </div>
  );
}

// ---- activities ------------------------------------------------------------

function BookingActivities({ b }: { b: BookingDetail }) {
  const { can } = useAccess(b);
  const [dialog, setDialog] = useState<'plan' | 'log' | null>(null);
  return (
    <div className="stack">
      {b.activities.length === 0 ? <Empty>{t("No meetings or follow-ups yet.")}</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t("When")}</th><th>{t("Activity")}</th><th>{t("Owner")}</th><th>{t("Outcome")}</th><th /></tr></thead>
            <tbody>
              {b.activities.map((a) => (
                <tr key={a.id}>
                  <td>{dateTime(a.due_at)}</td>
                  <td><span className="tag">{activityType(a.type)}</span> {a.subject}
                    {(a.location || a.notes) && <div className="small secondary">{[a.location, a.notes].filter(Boolean).join(' · ')}</div>}</td>
                  <td>{a.owner_name ?? '—'}</td>
                  <td>{a.completed_at ? <><Check className="ico" aria-hidden /> {a.outcome ?? t("Done")}</> : <span className="muted">{t("Open")}</span>}</td>
                  <td className="num">{!a.completed_at && can('sell') && <CompleteButton activity={a} invalidate={[['booking', b.id]]} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {can('sell') && (
        <div className="row">
          <button className="sm" onClick={() => setDialog('plan')}>{t('Plan a meeting or follow-up')}</button>
          <button className="sm" onClick={() => setDialog('log')}>{t('Log activity')}</button>
        </div>
      )}
      {dialog && <ActivityDialog mode={dialog} bookingId={b.id} onClose={() => setDialog(null)} />}
    </div>
  );
}

// ---- money -----------------------------------------------------------------

function Money({ b }: { b: BookingDetail }) {
  const { can } = useAccess(b);
  const { data: lookups } = useLookups();
  const { data: users } = useUsers();
  const inv = [['booking', b.id], ['bookings'], ['receivables'], ['payouts']];
  const pay = useForm({ paid_on: today(), amount: null as number | null, method: 'BANK', bank_account: null as string | null, reference: null as string | null });
  const addPayment = useSave(() => api(`/bookings/${b.id}/payments`, { body: pay.form }), inv);
  const delPayment = useSave((id: string) => api(`/payments/${id}`, { method: 'DELETE' }), inv);
  const po = useForm({ kind: 'commission', payee_name: '', user_id: null as string | null, pct: 10 as number | null });
  const addPayout = useSave(() => api(`/bookings/${b.id}/payouts`, {
    body: { ...po.form, pct: (po.form.pct ?? 0) / 100, payee_name: po.form.payee_name || users?.find((u) => u.id === po.form.user_id)?.name },
  }), inv);
  const markPaid = useSave((id: string) => api(`/booking-payouts/${id}`, { method: 'PATCH', body: { status: 'paid' } }), inv);
  const delPayout = useSave((id: string) => api(`/booking-payouts/${id}`, { method: 'DELETE' }), inv);

  const { covering } = useAccess(b);
  const hidden = useHidden();
  return (
    <div className="stack">
      {covering && <div className="alert info">{t("You are covering for this booking's owner: payments and commissions stay with finance and their managers.")}</div>}
      <h3>{t("Client payments")}</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>{t("Date")}</th><th>{t("Method")}</th><th>{t("Reference")}</th><th className="num">{t("Amount")}</th><th /></tr></thead>
          <tbody>
            {b.payments.length === 0 && <tr><td colSpan={5} className="empty">{t("No payments received.")}</td></tr>}
            {b.payments.map((p) => (
              <tr key={p.id}>
                <td>{date(p.paid_on)}</td><td>{p.method}{p.bank_account ? ` · ${p.bank_account}` : ''}{p.kind === 'deposit' && <> <span className="tag">{t('Down payment')}</span></>}</td><td>{p.reference ?? '—'}</td>
                <td className="num">{money(p.amount)}</td>
                <td className="num">{can('finance') && <button className="sm ghost danger" onClick={() => confirm(t('Delete payment?')) && delPayment.mutate(p.id)} aria-label={t('Delete')}><X className="ico" aria-hidden /></button>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={3}>{hidden('finance') ? t('Received') : <>{t("Paid · outstanding")}{' '}{money(b.outstanding)}</>}</td><td className="num">{money(b.paid)}</td><td /></tr></tfoot>
        </table>
      </div>
      {can('finance') && (
        <form className="form-grid" onSubmit={(e) => { e.preventDefault(); addPayment.mutate(undefined, { onSuccess: () => pay.setForm((f) => ({ ...f, amount: null, reference: null })) }); }}>
          <Field label={t("Date")}><input type="date" required {...pay.bind('paid_on')} /></Field>
          <Field label={t("Amount")}><input required {...pay.bindNum('amount')} /></Field>
          <Field label={t("Method")}><LookupSelect options={lookups?.payment_method} value={pay.form.method} onChange={(v) => pay.set('method')(v ?? 'BANK')} /></Field>
          <Field label={t("Bank account")}><LookupSelect options={lookups?.bank_account} value={pay.form.bank_account} onChange={pay.set('bank_account')} /></Field>
          <Field label={t("Reference")}><input {...pay.bind('reference')} /></Field>
          <div style={{ alignSelf: 'end' }}><button className="primary" disabled={addPayment.isPending}>{t("Record payment")}</button></div>
          <div className="span-all"><ErrorNote error={addPayment.error} /></div>
        </form>
      )}

      {!hidden('finance') && <>
      <h3 style={{ marginTop: 8 }}>{t("Commission & partner shares")}</h3>
      <p className="secondary small" style={{ margin: 0 }}>{t("Commission is a % of net profit; shares are a % of what remains after commission.")}</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>{t("Type")}</th><th>{t("Payee")}</th><th className="num">%</th><th className="num">{t("Amount")}</th><th>{t("Status")}</th><th /></tr></thead>
          <tbody>
            {b.payouts.length === 0 && <tr><td colSpan={6} className="empty">{t("No commission or shares set.")}</td></tr>}
            {b.payouts.map((p) => (
              <tr key={p.id}>
                <td>{p.kind === 'commission' ? t("Commission") : t("Share")}</td><td>{p.payee_name}</td>
                <td className="num">{pct(p.pct, 0)}</td><td className="num">{money(p.amount)}</td>
                <td>{p.status === 'paid' ? <><Check className="ico" aria-hidden /> {t('Paid')} {date(p.paid_on)}</> : t("To pay")}</td>
                <td className="num">{can('finance') && <>
                  {p.status === 'pending' && <button className="sm" onClick={() => markPaid.mutate(p.id)}>{t("Mark paid")}</button>}
                  <button className="sm ghost danger" onClick={() => delPayout.mutate(p.id)} aria-label={t('Delete')}><X className="ico" aria-hidden /></button>
                </>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {can('finance') && (
        <form className="form-grid" onSubmit={(e) => { e.preventDefault(); addPayout.mutate(undefined, { onSuccess: () => po.setForm((f) => ({ ...f, payee_name: '' })) }); }}>
          <Field label={t("Type")}>
            <select {...po.bind('kind')}><option value="commission">{t("Commission")}</option><option value="share">{t("Partner share")}</option></select>
          </Field>
          <Field label={t("Team member")}>
            <select {...po.bind('user_id')}>
              <option value="">{t("— external —")}</option>
              {users?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label={t("Payee name")}><input {...po.bind('payee_name')} placeholder={t("If external")} /></Field>
          <Field label={t("% of base")}><input required min={0} max={100} {...po.bindNum('pct')} /></Field>
          <div style={{ alignSelf: 'end' }}><button className="primary" disabled={addPayout.isPending || (!po.form.payee_name && !po.form.user_id)}>{t("Add")}</button></div>
          <div className="span-all"><ErrorNote error={addPayout.error} /></div>
        </form>
      )}
      </>}
    </div>
  );
}

function History({ b }: { b: BookingDetail }) {
  const lostLabel = useLabel('lost_reason');
  type Entry = { at: string; who: string | null; behalf: string | null; what: React.ReactNode };
  const entries: Entry[] = [
    ...b.history.map((h) => ({
      at: h.changed_at, who: h.changed_by_name, behalf: h.on_behalf_of_name,
      what: <>{h.from_status ? <><StatusBadge status={h.from_status} /> → </> : t("Created as ")}<StatusBadge status={h.to_status} />
        {h.reason && <span className="secondary"> · {h.to_status === 'LOS' ? lostLabel(h.reason) : h.reason}</span>}</>,
    })),
    ...b.log.map((l) => ({
      at: l.created_at, who: l.actor_name, behalf: l.on_behalf_of_name,
      what: <>{l.action[0].toUpperCase() + l.action.slice(1)}<span className="secondary">{describe(l.details)}</span></>,
    })),
  ].sort((x, y) => x.at.localeCompare(y.at));
  return (
    <table>
      <thead><tr><th>{t("When")}</th><th>{t("What")}</th><th>{t("By")}</th></tr></thead>
      <tbody>
        {entries.map((e, i) => (
          <tr key={i}>
            <td style={{ whiteSpace: 'nowrap' }}>{dateTime(e.at)}</td>
            <td>{e.what}</td>
            <td>{e.who ?? '—'}{e.behalf && <div className="small muted">{t("on behalf of")}{' '}{e.behalf}</div>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Short human summary of a log entry's details. */
function describe(d: Record<string, unknown>): string {
  const parts: string[] = [];
  if (Array.isArray(d.fields) && d.fields.length) parts.push(String(d.fields.map((f) => String(f).replace(/_/g, ' ')).join(', ')));
  for (const k of ['name', 'description', 'subject', 'payee', 'outcome'] as const) if (d[k]) parts.push(String(d[k]));
  if (typeof d.amount === 'number') parts.push(money(d.amount));
  if (d.from && d.to) parts.push(`${d.from} → ${d.to}`);
  return parts.length ? ` · ${parts.join(' · ')}` : '';
}
