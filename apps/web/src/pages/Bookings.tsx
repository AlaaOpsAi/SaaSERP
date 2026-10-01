import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, download, type Booking, type Conflict } from '../api';
import { useAuth } from '../auth';
import { BookingForm, bookingPayload, type BookingFormValues } from '../components/BookingForm';
import { ErrorNote, Modal, StatusBadge } from '../components/ui';
import { date, money, MONTHS, num, STATUS_LABEL } from '../format';
import { useLabel, useLookups, useSave, useUsers } from '../hooks';

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
          <h1>Bookings</h1>
          <p>Every enquiry, from first contact to a paid event.</p>
        </div>
        <div className="row">
          <button onClick={() => download(`/reports/contracts.xlsx?year=${filter('year') || year}`, `contracts-${filter('year') || year}.xlsx`)}>
            Export Excel
          </button>
          {can('sell') && <button className="primary" onClick={() => setCreating(true)}>New booking</button>}
        </div>
      </div>

      <div className="filters">
        <input type="search" placeholder="Search no., name, client, phone…" value={filter('q')} onChange={(e) => setFilter('q', e.target.value)} />
        <select value={filter('status')} onChange={(e) => setFilter('status', e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          <option value="INQ,TEN">Open (INQ + TEN)</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filter('year')} onChange={(e) => setFilter('year', e.target.value)} aria-label="Year">
          <option value="">All years</option>
          {Array.from({ length: 6 }, (_, i) => year + 1 - i).map((y) => <option key={y}>{y}</option>)}
        </select>
        <select value={filter('owner_id')} onChange={(e) => setFilter('owner_id', e.target.value)} aria-label="Account manager">
          <option value="">{me?.sees_all ? 'All AMs' : 'My whole team'}</option>
          {users?.filter((u) => u.in_my_team).map((u) => <option key={u.id} value={u.id}>{u.code ?? u.name}</option>)}
        </select>
        <select value={filter('source')} onChange={(e) => setFilter('source', e.target.value)} aria-label="Source">
          <option value="">All sources</option>
          {lookups?.source?.map((l) => <option key={l.id} value={l.code}>{l.label}</option>)}
        </select>
        <select value={filter('sort') || '-inquiry_date'} onChange={(e) => setFilter('sort', e.target.value)} aria-label="Sort">
          <option value="-inquiry_date">Newest enquiries</option>
          <option value="event_date">Event date ↑</option>
          <option value="-event_date">Event date ↓</option>
          <option value="-booking_no">Booking no. ↓</option>
          <option value="-revenue">Revenue ↓</option>
        </select>
        <label className="check"><input type="checkbox" checked={filter('followup_due') === 'true'} onChange={(e) => setFilter('followup_due', e.target.checked ? 'true' : '')} />Follow-up due</label>
      </div>

      {(() => {
        const lostLabel = lookups?.lost_reason?.find((l) => l.code === filter('lost_reason'))?.label ?? filter('lost_reason');
        const chips = [
          filter('month') && ['month', `Month: ${MONTHS[Number(filter('month')) - 1]}`],
          filter('lost_reason') && ['lost_reason', `Lost reason: ${lostLabel}`],
          filter('event_type') && ['event_type', `Event type: ${eventLabel(filter('event_type'))}`],
          filter('business_unit_id') && ['business_unit_id', 'One business unit'],
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
                <th>No.</th><th>Booking / client</th><th>Status</th><th>Event</th><th>Venue</th><th className="num">Pax</th>
                <th>AM</th><th className="num">Revenue</th><th className="num">Margin</th><th className="num">Outstanding</th><th>Next follow-up</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={11} className="empty">Loading…</td></tr>}
              {data?.rows.length === 0 && <tr><td colSpan={11} className="empty">No bookings match these filters.</td></tr>}
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
                  <td colSpan={7}>{data.totals.count} bookings · {data.totals.definite} definite</td>
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
      title="New booking"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>Cancel</button>
          {conflicts && can('manage') && pending && (
            <button type="button" className="danger" onClick={() => submit(pending, true)}>Override & book</button>
          )}
          <button className="primary" form="new-booking" disabled={save.isPending}>Create booking</button>
        </>
      }
    >
      <div className="stack">
        <ErrorNote error={save.error} />
        {conflicts && (
          <div className="small secondary">
            Clashes with {conflicts.map((c) => c.booking_id ? `${c.booking_no} (${c.booking_name}, ${STATUS_LABEL[c.status]})` : `${c.booking_name} (${STATUS_LABEL[c.status]})`).join(', ')}.
          </div>
        )}
        <BookingForm id="new-booking" isNew onSubmit={(v) => submit(v)} />
      </div>
    </Modal>
  );
}
