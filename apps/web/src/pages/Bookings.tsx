import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, download, type Booking, type Conflict } from '../api';
import { useAuth } from '../auth';
import { BookingForm, bookingPayload, type BookingFormValues } from '../components/BookingForm';
import { ErrorNote, Modal, StatusBadge } from '../components/ui';
import { date, money, monthNames, num, STATUS_LABEL, statusLabel } from '../format';
import { useLabel, useLookups, useSave, useUsers } from '../hooks';
import { lookupLabel, t } from '../i18n';

export function Bookings() {
  const { can, me } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const { data: lookups } = useLookups();
  const { data: users } = useUsers();
  const eventLabel = useLabel('event_type');

  const filter = (k: string) => params.get(k) ?? '';
  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const query = params.toString();
  const { data, isLoading } = useQuery({
    queryKey: ['bookings', query],
    queryFn: () => api<{ rows: Booking[]; totals: Record<string, number> }>(`/bookings?${query}`),
  });
  const year = new Date().getFullYear();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("Bookings")}</h1>
          <p>{t("Every enquiry, from first contact to a paid event.")}</p>
        </div>
        <div className="row">
          <button onClick={() => download(`/reports/contracts.xlsx?year=${filter('year') || year}`, `contracts-${filter('year') || year}.xlsx`)}>{t("Export Excel")}</button>
          {can('sell') && <button className="primary" onClick={() => setCreating(true)}>{t("New booking")}</button>}
        </div>
      </div>

      <div className="filters">
        <input type="search" placeholder={t("Search no., name, client, phone…")} value={filter('q')} onChange={(e) => setFilter('q', e.target.value)} />
        <select value={filter('status')} onChange={(e) => setFilter('status', e.target.value)} aria-label={t("Status")}>
          <option value="">{t("All statuses")}</option>
          <option value="INQ,TEN">{t("Open (INQ + TEN)")}</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
        </select>
        <select value={filter('year')} onChange={(e) => setFilter('year', e.target.value)} aria-label={t("Year")}>
          <option value="">{t("All years")}</option>
          {Array.from({ length: 6 }, (_, i) => year + 1 - i).map((y) => <option key={y}>{y}</option>)}
        </select>
        <select value={filter('owner_id')} onChange={(e) => setFilter('owner_id', e.target.value)} aria-label={t("Account manager")}>
          <option value="">{me?.sees_all ? t("All AMs") : t("My whole team")}</option>
          {users?.filter((u) => u.in_my_team).map((u) => <option key={u.id} value={u.id}>{u.code ?? u.name}</option>)}
        </select>
        <select value={filter('source')} onChange={(e) => setFilter('source', e.target.value)} aria-label={t("Source")}>
          <option value="">{t("All sources")}</option>
          {lookups?.source?.map((l) => <option key={l.id} value={l.code}>{lookupLabel(l)}</option>)}
        </select>
        <select value={filter('sort') || '-inquiry_date'} onChange={(e) => setFilter('sort', e.target.value)} aria-label={t("Sort")}>
          <option value="-inquiry_date">{t("Newest enquiries")}</option>
          <option value="event_date">{t("Event date ↑")}</option>
          <option value="-event_date">{t("Event date ↓")}</option>
          <option value="-booking_no">{t("Booking no. ↓")}</option>
          <option value="-revenue">{t("Revenue ↓")}</option>
        </select>
        <label className="check"><input type="checkbox" checked={filter('followup_due') === 'true'} onChange={(e) => setFilter('followup_due', e.target.checked ? 'true' : '')} />{t("Follow-up due")}</label>
      </div>

      {(() => {
        const lostLabel = lookupLabel(lookups?.lost_reason?.find((l) => l.code === filter('lost_reason')), filter('lost_reason'));
        const chips = [
          filter('month') && ['month', `${t('Month')}: ${monthNames()[Number(filter('month')) - 1]}`],
          filter('lost_reason') && ['lost_reason', `${t('Lost reason')}: ${lostLabel}`],
          filter('event_type') && ['event_type', `${t('Event type')}: ${eventLabel(filter('event_type'))}`],
          filter('business_unit_id') && ['business_unit_id', t('One business unit')],
        ].filter(Boolean) as [string, string][];
        return chips.length > 0 && (
          <div className="row" style={{ marginBottom: 12 }}>
            {chips.map(([key, label]) => (
              <button key={key} className="sm chip" onClick={() => setFilter(key, '')} aria-label={`Remove filter ${label}`}>{label} ✕</button>
            ))}
          </div>
        );
      })()}

      <div className="card flush">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("No.")}</th><th>{t("Booking / client")}</th><th>{t("Status")}</th><th>{t("Event")}</th><th>{t("Venue")}</th><th className="num">{t("Pax")}</th>
                <th>{t("AM")}</th><th className="num">{t("Revenue")}</th><th className="num">{t("Margin")}</th><th className="num">{t("Outstanding")}</th><th>{t("Next follow-up")}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={11} className="empty">{t("Loading…")}</td></tr>}
              {data?.rows.length === 0 && <tr><td colSpan={11} className="empty">{t("No bookings match these filters.")}</td></tr>}
              {data?.rows.map((b) => (
                <tr key={b.id} className="clickable" onClick={() => navigate(`/bookings/${b.id}`)}>
                  <td><strong>{b.booking_no}</strong></td>
                  <td>
                    {b.name}
                    <div className="small secondary">{[b.contact_name, b.contact_phone].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td><StatusBadge status={b.status} /></td>
                  <td>{date(b.event_date)}<div className="small secondary">{eventLabel(b.event_type)}</div></td>
                  <td>{b.venue_name ?? '—'}<div className="small secondary">{b.space_name ?? b.hall_text ?? ''}</div></td>
                  <td className="num">{num(b.pax)}</td>
                  <td>{b.owner_code ?? '—'}</td>
                  <td className="num">{b.revenue ? money(b.revenue) : '—'}</td>
                  <td className="num">{b.revenue ? money(b.gross_margin) : '—'}</td>
                  <td className="num">{b.outstanding ? money(b.outstanding) : '—'}</td>
                  <td>{b.status === 'INQ' || b.status === 'TEN' ? date(b.next_followup_date) : ''}</td>
                </tr>
              ))}
            </tbody>
            {data && data.rows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={7}>{data.totals.count}{' '}{t("bookings ·")}{' '}{data.totals.definite}{' '}{t("definite")}</td>
                  <td className="num">{money(data.totals.revenue)}</td>
                  <td className="num">{money(data.totals.gross_margin)}</td>
                  <td className="num">{money(data.totals.outstanding)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {creating && <NewBooking onClose={() => setCreating(false)} onCreated={(id) => navigate(`/bookings/${id}`)} />}
    </>
  );
}

function NewBooking({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { can } = useAuth();
  const [pending, setPending] = useState<BookingFormValues | null>(null);
  const save = useSave((v: { values: BookingFormValues; force?: boolean }) =>
    api<Booking>('/bookings', { body: { ...bookingPayload(v.values), force: v.force } }), [['bookings'], ['dashboard']]);
  const conflicts: Conflict[] | undefined = (save.error as { details?: { conflicts?: Conflict[] } } | null)?.details?.conflicts;

  const submit = (values: BookingFormValues, force = false) => {
    setPending(values);
    save.mutate({ values, force }, { onSuccess: (b) => onCreated(b.id) });
  };

  return (
    <Modal
      title={t("New booking")}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>{t("Cancel")}</button>
          {conflicts && can('manage') && pending && (
            <button type="button" className="danger" onClick={() => submit(pending, true)}>{t("Override & book")}</button>
          )}
          <button className="primary" form="new-booking" disabled={save.isPending}>{t("Create booking")}</button>
        </>
      }
    >
      <div className="stack">
        <ErrorNote error={save.error} />
        {conflicts && (
          <div className="small secondary">{t("Clashes with")}{' '}{conflicts.map((c) => c.booking_id ? `${c.booking_no} (${c.booking_name}, ${statusLabel(c.status)})` : `${c.booking_name} (${statusLabel(c.status)})`).join(', ')}.
          </div>
        )}
        <BookingForm id="new-booking" isNew onSubmit={(v) => submit(v)} />
      </div>
    </Modal>
  );
}
