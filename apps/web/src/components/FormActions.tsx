import { useState, type ReactNode } from 'react';
import { api } from '../api';
import { useSave } from '../hooks';
import { t } from '../i18n';
import { ErrorNote, Field, Modal } from './ui';

/**
 * The same buttons on every data entry page (customer request):
 * Delete / Deactivate on one side, Cancel and Save on the other.
 */
export function FormActions({ formId, saving, onCancel, remove, saveLabel }: {
  formId: string; saving?: boolean; onCancel: () => void; remove?: ReactNode; saveLabel?: string;
}) {
  return (
    <div className="form-actions">
      <div className="form-actions-start">{remove}</div>
      <button type="button" onClick={onCancel}>{t('Cancel')}</button>
      <button className="primary" form={formId} disabled={saving}>{saving ? t('Saving…') : saveLabel ?? t('Save')}</button>
    </div>
  );
}

export type DeactivateKind = 'bookings' | 'contacts' | 'accounts' | 'activities';

/**
 * "Delete" for everyday users: the record is deactivated with a reason and disappears
 * from every screen. Managers can restore it; admins can delete it for good
 * (Admin → Deactivated records).
 */
export function DeactivateButton({ kind, id, name, invalidate, onDone, label }: {
  kind: DeactivateKind; id: string; name: string; invalidate: unknown[][]; onDone: () => void; label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="danger" onClick={() => setOpen(true)}>{label ?? t('Delete')}</button>
      {open && <DeactivateDialog kind={kind} id={id} name={name} invalidate={invalidate} onClose={() => setOpen(false)} onDone={onDone} />}
    </>
  );
}

function DeactivateDialog({ kind, id, name, invalidate, onClose, onDone }: {
  kind: DeactivateKind; id: string; name: string; invalidate: unknown[][]; onClose: () => void; onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const save = useSave(() => api(`/${kind}/${id}/deactivate`, { body: { reason } }),
    [...invalidate, ['deactivated'], ['dashboard'], ['diary'], ['activities']]);
  return (
    <Modal title={t('Delete {name}', { name })} onClose={onClose} footer={<>
      <button onClick={onClose}>{t('Cancel')}</button>
      <button className="danger" form="deactivate-form" disabled={save.isPending || reason.trim().length < 3}>{t('Delete')}</button>
    </>}>
      <form id="deactivate-form" className="stack" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined, { onSuccess: () => { onClose(); onDone(); } }); }}>
        <ErrorNote error={save.error} />
        <p className="secondary" style={{ margin: 0 }}>
          {t('It will be deactivated: hidden from every screen, list and report, but kept with its history. A manager can restore it under Admin → Deactivated records.')}
        </p>
        <Field label={t('Why? (required)')}>
          <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('e.g. Entered twice, wrong client')} />
        </Field>
      </form>
    </Modal>
  );
}
