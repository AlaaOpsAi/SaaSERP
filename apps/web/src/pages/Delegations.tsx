import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { ErrorNote, Field, Modal, Tabs } from '../components/ui';
import { date, today } from '../format';
import { useSave, useUsers } from '../hooks';
import { t } from '../i18n';

interface Delegation {
  id: string; delegator_id: string; delegate_id: string; delegator_name: string; delegate_name: string;
  starts_on: string; ends_on: string | null; access: 'view' | 'act'; include_team: boolean; handover_activities: boolean;
  note: string | null; created_by_name: string | null; state: 'upcoming' | 'active' | 'ended' | 'revoked';
}

const STATE: Record<Delegation['state'], string> = { active: 'Active', upcoming: 'Upcoming', ended: 'Ended', revoked: 'Ended early' };

export function Delegations() {
  const { me } = useAuth();
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<'current' | 'past'>('current');
  const { data } = useQuery({ queryKey: ['delegations'], queryFn: () => api<Delegation[]>('/delegations') });
  const all = data ?? [];
  const shown = all.filter((d) => (tab === 'current' ? d.state === 'active' || d.state === 'upcoming' : d.state === 'ended' || d.state === 'revoked'));
  const mine = shown.filter((d) => d.delegate_id === me?.id);
  const forMe = shown.filter((d) => d.delegator_id === me?.id);
  const team = shown.filter((d) => d.delegate_id !== me?.id && d.delegator_id !== me?.id);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("Cover & delegation")}</h1>
          <p>{t("Going on leave? Let a colleague see and work your bookings for a set period. Access starts and stops on its own.")}</p>
        </div>
        <button className="primary" onClick={() => setCreating(true)}>{t("Set up cover")}</button>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[['current', 'Active & upcoming'], ['past', 'Past']]} />
      <div className="stack">
        <Section title={t("I am covering for")} rows={mine} empty={t("You are not covering for anyone.")} />
        <Section title={t("Covering for me")} rows={forMe} empty={t("Nobody is covering for you.")} />
        {team.length > 0 && <Section title={t("My team")} rows={team} empty="" />}
      </div>
      {creating && <NewCover onClose={() => setCreating(false)} />}
    </>
  );
}

function Section({ title, rows, empty }: { title: string; rows: Delegation[]; empty: string }) {
  const [editing, setEditing] = useState<Delegation | null>(null);
  const revoke = useSave((id: string) => api(`/delegations/${id}/revoke`, { method: 'POST' }), [['delegations'], ['me'], ['bookings']]);
  return (
    <div className="card flush">
      <div className="card-head"><h2>{title}</h2></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>{t("Whose records")}</th><th>{t("Covered by")}</th><th>{t("When")}</th><th>{t("Access")}</th><th>{t("Status")}</th><th /></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="empty">{empty}</td></tr>}
            {rows.map((d) => (
              <tr key={d.id}>
                <td><strong>{d.delegator_name}</strong>{d.include_team && <div className="small muted">{t("+ everyone below them")}</div>}</td>
                <td>{d.delegate_name}</td>
                <td>{date(d.starts_on)} – {d.ends_on ? date(d.ends_on) : t("until ended")}{d.note && <div className="small muted">{d.note}</div>}</td>
                <td>
                  {d.access === 'act' ? t("View & act") : t("View only")}
                  {d.handover_activities && <div className="small muted">{t("follow-ups handed over")}</div>}
                </td>
                <td><span className={`badge dl-${d.state}`}><span className="dot" />{t(STATE[d.state])}</span></td>
                <td className="num">
                  {(d.state === 'active' || d.state === 'upcoming') && (
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <button className="sm ghost" onClick={() => setEditing(d)}>{t("Change end")}</button>
                      <button className="sm danger" onClick={() => confirm(t('End this cover now?')) && revoke.mutate(d.id)}>{t("End now")}</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorNote error={revoke.error} />
      {editing && <ChangeEnd d={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ChangeEnd({ d, onClose }: { d: Delegation; onClose: () => void }) {
  const [endsOn, setEndsOn] = useState(d.ends_on ?? '');
  const save = useSave(() => api(`/delegations/${d.id}`, { method: 'PATCH', body: { ends_on: endsOn || null } }), [['delegations'], ['me']]);
  return (
    <Modal title={t('Cover of {name}', { name: d.delegator_name })} onClose={onClose} footer={<>
      <button onClick={onClose}>{t("Cancel")}</button>
      <button className="primary" onClick={() => save.mutate(undefined, { onSuccess: onClose })}>{t("Save")}</button>
    </>}>
      <div className="stack">
        <ErrorNote error={save.error} />
        <Field label={t("Last day of cover (leave empty for until ended)")}><input type="date" min={d.starts_on} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function NewCover({ onClose }: { onClose: () => void }) {
  const { me, can } = useAuth();
  const { data: users } = useUsers();
  const [f, setF] = useState({
    delegator_id: me!.id, delegate_id: '', starts_on: today(), ends_on: '', access: 'act' as 'act' | 'view',
    include_team: false, handover_activities: true, note: '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  // You can arrange cover for yourself, or (as a manager or admin) for anyone in your team.
  const whose = (users ?? []).filter((u) => u.id === me!.id || ((can('manage')) && me!.team_ids.includes(u.id)) || can('admin'));
  const delegator = users?.find((u) => u.id === f.delegator_id);
  const hasReports = (users ?? []).some((u) => u.manager_id === f.delegator_id);
  const candidates = (users ?? []).filter((u) => u.id !== f.delegator_id && u.is_active && u.email);
  const save = useSave(() => api('/delegations', {
    body: { ...f, ends_on: f.ends_on || null, note: f.note || null, handover_activities: f.access === 'act' && f.handover_activities },
  }), [['delegations'], ['me'], ['notifications']]);

  return (
    <Modal title={t("Set up cover")} onClose={onClose} footer={<>
      <button onClick={onClose}>{t("Cancel")}</button>
      <button className="primary" form="cover-form" disabled={save.isPending}>{t("Start cover")}</button>
    </>}>
      <form id="cover-form" className="stack" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }}>
        <ErrorNote error={save.error} />
        <div className="form-grid">
          <Field label={t("Whose records")}>
            <select value={f.delegator_id} onChange={(e) => set('delegator_id', e.target.value)} disabled={whose.length <= 1}>
              {whose.map((u) => <option key={u.id} value={u.id}>{u.id === me!.id ? t("Mine ({name})", { name: u.name }) : u.name}</option>)}
            </select>
          </Field>
          <Field label={t("Covered by")}>
            <select required value={f.delegate_id} onChange={(e) => set('delegate_id', e.target.value)}>
              <option value="">{t("Choose a colleague…")}</option>
              {candidates.map((u) => <option key={u.id} value={u.id}>{u.name}{u.code ? ` (${u.code})` : ''}</option>)}
            </select>
          </Field>
          <Field label={t("From")}><input type="date" required value={f.starts_on} onChange={(e) => set('starts_on', e.target.value)} /></Field>
          <Field label={t("Until (last day)")}><input type="date" min={f.starts_on} value={f.ends_on} onChange={(e) => set('ends_on', e.target.value)} placeholder={t("until ended")} /></Field>
        </div>
        <fieldset className="choice">
          <legend>{t("What can they do?")}</legend>
          <label className="check"><input type="radio" checked={f.access === 'act'} onChange={() => set('access', 'act')} />
            <span><strong>{t("View & act")}</strong>{t(": follow up, update and confirm bookings. Recorded as on")}{' '}{delegator?.name ?? t("their")}{t("'s behalf.")}</span></label>
          <label className="check"><input type="radio" checked={f.access === 'view'} onChange={() => set('access', 'view')} />
            <span><strong>{t("View only")}</strong>{t(": see bookings and history, change nothing.")}</span></label>
        </fieldset>
        {hasReports && (
          <label className="check"><input type="checkbox" checked={f.include_team} onChange={(e) => set('include_team', e.target.checked)} />{t("Also cover everyone who reports to")}{' '}{delegator?.name}</label>
        )}
        {f.access === 'act' && (
          <label className="check"><input type="checkbox" checked={f.handover_activities} onChange={(e) => set('handover_activities', e.target.checked)} />{t("Show")}{' '}{delegator?.name}{t("'s open follow-ups in their activity list")}</label>
        )}
        <Field label={t("Note (optional)")}><input value={f.note} onChange={(e) => set('note', e.target.value)} placeholder={t("e.g. Annual leave, call me only for emergencies")} /></Field>
        <p className="small muted" style={{ margin: 0 }}>{t("Payments and commissions are never handled by the person covering.")}{' '}{delegator?.name}{t("'s manager is notified.")}</p>
      </form>
    </Modal>
  );
}
