import { useState } from 'react';
import { api, type Activity } from '../api';
import { useSave } from '../hooks';
import { t } from '../i18n';
import { ErrorNote, Field, Modal } from './ui';

/** Meetings and site visits need their outcome: it feeds the daily activity report. */
export const NEEDS_OUTCOME = ['meeting', 'site_visit'];

export const ACTIVITY_TYPES: [string, string][] = [
  ['followup', 'Follow-up'], ['call', 'Call'], ['meeting', 'Meeting'], ['site_visit', 'Site visit'], ['email', 'Email'], ['task', 'Task'],
];
export const activityType = (type: string) => t(ACTIVITY_TYPES.find(([k]) => k === type)?.[1] ?? type);

/** "Mark done" button with a dialog for the outcome (required for meetings). */
export function CompleteButton({ activity, invalidate }: { activity: Activity; invalidate: unknown[][] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="sm" onClick={() => setOpen(true)}>{t('Complete')}</button>
      {open && <CompleteDialog activity={activity} invalidate={invalidate} onClose={() => setOpen(false)} />}
    </>
  );
}

function CompleteDialog({ activity, invalidate, onClose }: { activity: Activity; invalidate: unknown[][]; onClose: () => void }) {
  const required = NEEDS_OUTCOME.includes(activity.type);
  const [outcome, setOutcome] = useState('');
  const save = useSave(() => api(`/activities/${activity.id}/complete`, { body: { outcome: outcome.trim() || null } }),
    [...invalidate, ['activities'], ['daily-activity'], ['meetings'], ['dashboard']]);
  return (
    <Modal title={t('Complete: {subject}', { subject: activity.subject })} onClose={onClose} footer={<>
      <button onClick={onClose}>{t('Cancel')}</button>
      <button className="primary" form="complete-activity" disabled={save.isPending || (required && !outcome.trim())}>{t('Mark done')}</button>
    </>}>
      <form id="complete-activity" className="stack" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }}>
        <ErrorNote error={save.error} />
        <Field label={required ? t('Meeting outcome (required)') : t('Outcome / client feedback (optional)')}>
          <textarea autoFocus required={required} rows={4} value={outcome} onChange={(e) => setOutcome(e.target.value)}
            placeholder={required ? t('e.g. Liked the ballroom, sending a quote on Sunday') : ''} />
        </Field>
        {required && <p className="small muted" style={{ margin: 0 }}>{t('The outcome appears on the daily activity report for your manager.')}</p>}
      </form>
    </Modal>
  );
}
