import { X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, openSigned, type AnnexLine, type BookingDetail, type BookingFile, type ContractLine, type DocKind, type DocTemplate, type FileKind } from '../api';
import { useAuth, useHidden } from '../auth';
import { date, dateTime, money } from '../format';
import { useSave } from '../hooks';
import { t } from '../i18n';
import { DocumentViewer, type ViewTarget } from './DocumentViewer';
import { DeactivateButton } from './FormActions';
import { confirmDiscard, Empty, ErrorNote, Field, Modal, useDirty } from './ui';

export const DOC_KINDS: [DocKind, string][] = [['contract', 'Contract'], ['proposal', 'Proposal'], ['annex', 'Annex']];
export const FILE_KINDS: [FileKind, string][] = [
  ['offer', 'Offer sent to the client'], ['signed_contract', 'Signed contract'], ['signed_proposal', 'Signed offer / proposal'], ['annex', 'Annex'], ['other', 'Other'],
];
const docKindLabel = (k: DocKind) => t(DOC_KINDS.find(([x]) => x === k)?.[1] ?? k);
const fileKindLabel = (k: FileKind) => t(FILE_KINDS.find(([x]) => x === k)?.[1] ?? k);
const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const ACCEPT = 'image/jpeg,image/png,application/pdf';

/**
 * Contract documents: the services and annex details printed in the contract, the
 * contracts / proposals / annexes issued from the company's templates, and the files
 * uploaded to the contract (the client's signed copy above all).
 */
export function ContractDocuments({ b, canSell }: { b: BookingDetail; canSell: boolean }) {
  const [issuing, setIssuing] = useState(false);
  const [uploading, setUploading] = useState<FileKind | null>(null);
  const [error, setError] = useState<unknown>(null);
  const canIssue = canSell && b.status !== 'LOS' && b.status !== 'CXL';
  const open = (path: string) => { setError(null); openSigned(path).catch(setError); };
  // Everyone can view on screen (watermarked); only people with the download right get the file.
  const { me } = useAuth();
  const canDownload = me?.rights.download ?? false;
  const [viewing, setViewing] = useState<ViewTarget | null>(null);
  const inv = [['booking', b.id], ['bookings'], ['dashboard']];

  return (
    <div className="stack">
      {b.signed_missing && (
        <div className="alert warn spread">
          <span>{t('Signed contract missing: upload the copy the client signed (photo or PDF).')}</span>
          {canSell && <button className="sm primary" onClick={() => setUploading('signed_contract')}>{t('Upload signed contract')}</button>}
        </div>
      )}
      <ErrorNote error={error} />

      <section className="detail-group">
        <div className="spread">
          <h3>{t('Issued documents')}</h3>
          {canSell && (canIssue
            ? <button className="sm primary" onClick={() => setIssuing(true)}>{t('Issue contract / proposal')}</button>
            : <span className="small muted">{t('Documents are not issued for lost or cancelled contracts.')}</span>)}
        </div>
        {b.documents.length === 0 ? <Empty>{t('Nothing issued yet.')}</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('Number')}</th><th>{t('Document')}</th><th>{t('Issued')}</th><th>{t('Client signature')}</th><th /></tr></thead>
              <tbody>
                {b.documents.map((d) => (
                  <tr key={d.id}>
                    <td><strong>{d.doc_no}</strong></td>
                    <td><span className="tag">{docKindLabel(d.kind)}</span> {d.template_name ?? t('Standard template')}</td>
                    <td>{dateTime(d.issued_at)}<div className="small muted">{d.issued_by_name}</div></td>
                    <td>{d.kind === 'annex' ? <span className="muted">—</span>
                      : d.signed_at ? <span className="badge DEF"><span className="dot" />{t('Signed')} {date(d.signed_at)}</span>
                      : <span className="muted">{t('Waiting for signature')}</span>}</td>
                    <td className="num">
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button className="sm" onClick={() => setViewing({ kind: 'document', id: d.id, download: `/documents/${d.id}/link?format=pdf` })}>{t('View')}</button>
                        {canDownload && d.has_pdf && <button className="sm" onClick={() => open(`/documents/${d.id}/link?format=pdf`)}>PDF</button>}
                        {canDownload && <button className="sm" onClick={() => open(`/documents/${d.id}/link?format=docx`)}>Word</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="detail-group">
        <div className="spread">
          <h3>{t('Uploaded files')}</h3>
          {canSell && <button className="sm" onClick={() => setUploading('signed_contract')}>{t('Upload file')}</button>}
        </div>
        <p className="small muted" style={{ margin: 0 }}>{t('Pictures (JPEG, PNG) or PDF, up to 15 MB. Allowed at every status.')}</p>
        {b.files.length === 0 ? <Empty>{t('No files yet.')}</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('File')}</th><th>{t('Kind')}</th><th>{t('Uploaded')}</th><th /></tr></thead>
              <tbody>
                {b.files.map((f) => (
                  <tr key={f.id}>
                    <td><button className="link" onClick={() => setViewing({ kind: 'file', id: f.id, download: `/booking-files/${f.id}/link` })}>{f.file_name}</button>
                      <div className="small muted">{size(f.size_bytes)}{f.doc_no ? ` · ${t('for')} ${f.doc_no}` : ''}</div></td>
                    <td><span className="tag">{fileKindLabel(f.kind)}</span></td>
                    <td>{dateTime(f.uploaded_at)}<div className="small muted">{f.uploaded_by_name}</div></td>
                    <td className="num">
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button className="sm" onClick={() => setViewing({ kind: 'file', id: f.id, download: `/booking-files/${f.id}/link` })}>{t('View')}</button>
                        {canDownload && <button className="sm" onClick={() => open(`/booking-files/${f.id}/link`)}>{t('Download')}</button>}
                        {canSell && <DeactivateButton kind="booking-files" id={f.id} name={f.file_name} invalidate={inv} onDone={() => undefined} label={t('Remove')} small />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ServicesEditor b={b} canSell={canSell} />
      <AnnexEditor b={b} canSell={canSell} />

      {issuing && <IssueDialog b={b} onClose={() => setIssuing(false)}
        onIssued={(id, pdf) => (canDownload ? open(`/documents/${id}/link?format=${pdf ? 'pdf' : 'docx'}`) : setViewing({ kind: 'document', id }))} />}
      {viewing && <DocumentViewer target={viewing} onClose={() => setViewing(null)} />}
      {uploading && <UploadDialog b={b} kind={uploading} onClose={() => setUploading(null)} />}
    </div>
  );
}

/** Upload a file to a contract; also asked right after a contract is confirmed (DEF). */
export function UploadDialog({ b, kind: initialKind, onClose, prompt }: {
  b: Pick<BookingDetail, 'id' | 'booking_no' | 'documents'>; kind: FileKind; onClose: () => void; prompt?: string;
}) {
  const [kind, setKind] = useState<FileKind>(initialKind);
  const [file, setFile] = useState<File | null>(null);
  const signs = kind === 'signed_contract' ? 'contract' : kind === 'signed_proposal' ? 'proposal' : null;
  const options = signs ? b.documents.filter((d) => d.kind === signs) : [];
  const [documentId, setDocumentId] = useState('');
  useEffect(() => setDocumentId(options[0]?.id ?? ''), [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useSave(() => {
    const form = new FormData();
    form.append('file', file!);
    const qs = new URLSearchParams({ kind, ...(documentId ? { document_id: documentId } : {}) });
    return api<BookingFile>(`/bookings/${b.id}/files?${qs}`, { form });
  }, [['booking', b.id], ['bookings'], ['dashboard']]);
  const tooBig = file && file.size > 15 * 1024 * 1024;
  return (
    <Modal title={t('Upload file')} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose}>{t('Cancel')}</button>
        <button className="primary" form="upload-form" disabled={!file || Boolean(tooBig) || save.isPending}>{save.isPending ? t('Uploading…') : t('Upload')}</button>
      </>}>
      <form id="upload-form" className="stack" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }}>
        <ErrorNote error={save.error} />
        {prompt && <p className="secondary" style={{ margin: 0 }}>{prompt}</p>}
        <Field label={t('Kind')}>
          <select value={kind} onChange={(e) => setKind(e.target.value as FileKind)}>
            {FILE_KINDS.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
          </select>
        </Field>
        {options.length > 0 && (
          <Field label={t('Signed copy of')}>
            <select value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
              {options.map((d) => <option key={d.id} value={d.id}>{d.doc_no}</option>)}
              <option value="">{t('Not issued from the system')}</option>
            </select>
          </Field>
        )}
        <Field label={t('File (JPEG, PNG or PDF)')}>
          <input type="file" accept={ACCEPT} required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        {tooBig && <div className="alert">{t('The file is larger than 15 MB')}</div>}
      </form>
    </Modal>
  );
}

function IssueDialog({ b, onClose, onIssued }: { b: BookingDetail; onClose: () => void; onIssued: (id: string, pdf: boolean) => void }) {
  const [kind, setKind] = useState<DocKind>(b.status === 'DEF' ? 'contract' : 'proposal');
  const { data } = useQuery({ queryKey: ['booking-templates', b.id], queryFn: () => api<Record<DocKind, DocTemplate[]>>(`/bookings/${b.id}/templates`) });
  const options = data?.[kind] ?? [];
  const [templateId, setTemplateId] = useState('');
  useEffect(() => setTemplateId(options[0]?.id ?? ''), [kind, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [notes, setNotes] = useState('');
  const save = useSave(() => api<{ id: string; has_pdf: boolean }>(`/bookings/${b.id}/documents`, { body: { kind, template_id: templateId, notes: notes || null } }),
    [['booking', b.id]]);
  const missing = kind === 'annex' ? b.annex_lines.length === 0 : b.contract_lines.length === 0;
  return (
    <Modal title={t('Issue contract / proposal')} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose}>{t('Cancel')}</button>
        <button className="primary" form="issue-form" disabled={!templateId || save.isPending}>{save.isPending ? t('Preparing the document…') : t('Issue')}</button>
      </>}>
      <form id="issue-form" className="stack" onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined, { onSuccess: (d) => { onClose(); onIssued(d.id, d.has_pdf); } });
      }}>
        <ErrorNote error={save.error} />
        <div className="segmented" role="radiogroup" aria-label={t('Document')}>
          {DOC_KINDS.map(([k, l]) => (
            <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{t(l)}</button>
          ))}
        </div>
        <Field label={t('Template')}>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {options.map((o) => <option key={o.id} value={o.id}>{o.id === 'builtin' ? t('Standard template (English & Arabic)') : o.name} · {languageLabel(o.language)}</option>)}
          </select>
        </Field>
        <Field label={t('Notes printed on the document (optional)')}><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <p className="small secondary" style={{ margin: 0 }}>
          {t('The template is filled with this contract: client, event date, venue, guests, services and prices, total, down payment and remaining. It gets the next number and is kept as issued.')}
        </p>
        {missing && <div className="alert info">{kind === 'annex' ? t('No annex details yet: the annex table will be empty.') : t('No services yet: the services table will be empty.')}</div>}
      </form>
    </Modal>
  );
}

export const languageLabel = (l: string) => (l === 'ar' ? t('Arabic') : l === 'en' ? t('English') : t('English & Arabic'));

// ---- services & prices ------------------------------------------------------

function ServicesEditor({ b, canSell }: { b: BookingDetail; canSell: boolean }) {
  const hidden = useHidden();
  const pricesHidden = hidden('contract_value');
  const [editing, setEditing] = useState(false);
  const total = b.contract_lines.reduce((s, l) => s + (l.unit_price ?? 0) * (l.quantity ?? 1), 0);
  return (
    <section className="detail-group">
      <div className="spread">
        <h3>{t('Services & prices (printed in the contract)')}</h3>
        {canSell && !pricesHidden && <button className="sm" onClick={() => setEditing(true)}>{t('Edit')}</button>}
      </div>
      {b.contract_lines.length === 0 ? <Empty>{t('No services yet.')}</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t('Type of work')}</th><th>{t('Details')}</th><th className="num">{t('Qty')}</th>
              {!pricesHidden && <><th className="num">{t('Price')}</th><th className="num">{t('Amount')}</th></>}</tr></thead>
            <tbody>
              {b.contract_lines.map((l, i) => (
                <tr key={l.id ?? i}>
                  <td>{l.work_type}</td><td className="secondary">{l.details}</td><td className="num">{l.quantity ?? ''}</td>
                  {!pricesHidden && <><td className="num">{money(l.unit_price)}</td><td className="num">{l.unit_price === null ? '' : money(l.unit_price * (l.quantity ?? 1))}</td></>}
                </tr>
              ))}
            </tbody>
            {!pricesHidden && (
              <tfoot><tr><td colSpan={4}>{t('Total')}{b.contract_value !== null && Math.abs(b.contract_value - total) > 0.001
                ? <span className="small muted"> · {t('contract value {v} is printed as the total', { v: money(b.contract_value) })}</span> : null}</td>
                <td className="num">{money(total)}</td></tr></tfoot>
            )}
          </table>
        </div>
      )}
      {editing && (
        <LinesDialog<ContractLine>
          title={t('Services & prices')} url={`/bookings/${b.id}/contract-lines`} bookingId={b.id} initial={b.contract_lines}
          blank={{ work_type: '', details: null, quantity: 1, unit_price: null }}
          columns={[
            { key: 'work_type', label: t('Type of work'), required: true, width: '28%' },
            { key: 'details', label: t('Details'), width: '40%' },
            { key: 'quantity', label: t('Qty'), number: true, width: '10%' },
            { key: 'unit_price', label: t('Price'), number: true, width: '16%' },
          ]}
          onClose={() => setEditing(false)}
        />
      )}
    </section>
  );
}

// ---- annex details ----------------------------------------------------------

function AnnexEditor({ b, canSell }: { b: BookingDetail; canSell: boolean }) {
  const [editing, setEditing] = useState(false);
  const { data: checklists } = useQuery({
    queryKey: ['annex-checklists'], queryFn: () => api<{ business_unit_id: string | null; items: { service: string; service_alt: string | null }[] }[]>('/annex-checklists'),
  });
  const checklist = checklists?.find((c) => c.business_unit_id === b.business_unit_id)?.items ?? checklists?.find((c) => c.business_unit_id === null)?.items ?? [];
  const filled = b.annex_lines.filter((l) => l.quantity !== null || l.notes);
  return (
    <section className="detail-group">
      <div className="spread">
        <h3>{t('Annex details (e.g. Wedding Specifications)')}</h3>
        {canSell && <button className="sm" onClick={() => setEditing(true)}>{t('Edit')}</button>}
      </div>
      <p className="small muted" style={{ margin: 0 }}>{t('Full details for the operations team. The client signs the annex, approving all details.')}</p>
      {b.annex_lines.length === 0 ? <Empty>{t('No annex details yet.')}</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t('Service')}</th><th className="num">{t('Qty')}</th><th>{t('Notes')}</th></tr></thead>
            <tbody>
              {(filled.length ? filled : b.annex_lines).map((l, i) => (
                <tr key={l.id ?? i}><td>{l.service}{l.service_alt && <span className="small muted"> · {l.service_alt}</span>}</td>
                  <td className="num">{l.quantity ?? ''}</td><td className="secondary">{l.notes}</td></tr>
              ))}
            </tbody>
          </table>
          {filled.length > 0 && filled.length < b.annex_lines.length && (
            <p className="small muted" style={{ margin: '6px 0 0' }}>{t('{n} more services in the list without quantity or notes.', { n: b.annex_lines.length - filled.length })}</p>
          )}
        </div>
      )}
      {editing && (
        <LinesDialog<AnnexLine>
          title={t('Annex details')} url={`/bookings/${b.id}/annex-lines`} bookingId={b.id}
          initial={b.annex_lines}
          blank={{ service: '', service_alt: null, quantity: null, notes: null }}
          loadable={checklist.length ? checklist.map((c) => ({ service: c.service, service_alt: c.service_alt ?? null, quantity: null, notes: null })) : undefined}
          columns={[
            { key: 'service', label: t('Service'), required: true, width: '28%' },
            { key: 'service_alt', label: t('Second language'), width: '22%' },
            { key: 'quantity', label: t('Qty'), number: true, width: '10%' },
            { key: 'notes', label: t('Notes'), width: '34%' },
          ]}
          onClose={() => setEditing(false)}
        />
      )}
    </section>
  );
}

interface Column<T> { key: keyof T & string; label: string; number?: boolean; required?: boolean; width: string }

/** A small grid editor: add, change, reorder and remove rows, then save them all. */
function LinesDialog<T extends object>({ title, url, bookingId, initial, blank, columns, loadable, onClose }: {
  title: string; url: string; bookingId: string; initial: T[]; blank: T; columns: Column<T>[]; loadable?: T[]; onClose: () => void;
}) {
  const strip = (r: T) => Object.fromEntries(columns.map((c) => [c.key, (r as Record<string, unknown>)[c.key] ?? null])) as T;
  const [rows, setRows] = useState<T[]>(() => (initial.length ? initial.map(strip) : [{ ...blank }]));
  const dirty = useDirty(rows);
  const set = (i: number, key: string, v: unknown) => setRows((rs) => rs.map((r, n) => (n === i ? { ...r, [key]: v } : r)));
  const move = (i: number, d: number) => setRows((rs) => { const c = [...rs]; const [x] = c.splice(i, 1); c.splice(i + d, 0, x); return c; });
  const required = columns.find((c) => c.required)!.key;
  const save = useSave(() => {
    const lines = rows.filter((r) => String((r as Record<string, unknown>)[required] ?? '').trim());
    return api(url, { method: 'PUT', body: { lines } });
  }, [['booking', bookingId]]);
  const addChecklist = () => setRows((rs) => {
    const have = new Set(rs.map((r) => String((r as Record<string, unknown>)[required] ?? '')));
    return [...rs.filter((r) => String((r as Record<string, unknown>)[required] ?? '').trim()), ...loadable!.filter((x) => !have.has(String((x as Record<string, unknown>)[required])))];
  });
  return (
    <Modal title={title} onClose={onClose} dirty={dirty} wide
      footer={<>
        <button type="button" onClick={confirmDiscard(dirty, onClose)}>{t('Cancel')}</button>
        <button className="primary" form="lines-form" disabled={save.isPending}>{save.isPending ? t('Saving…') : t('Save')}</button>
      </>}>
      <form id="lines-form" className="stack" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }}>
        <ErrorNote error={save.error} />
        <div className="table-wrap">
          <table className="grid-edit">
            <thead><tr>{columns.map((c) => <th key={c.key} style={{ width: c.width }} className={c.number ? 'num' : ''}>{c.label}</th>)}<th /></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {columns.map((c) => {
                    const v = (r as Record<string, unknown>)[c.key];
                    return (
                      <td key={c.key}>
                        <input aria-label={c.label} type={c.number ? 'number' : 'text'} step="any" className={c.number ? 'num' : ''}
                          value={v === null || v === undefined ? '' : String(v)}
                          onChange={(e) => set(i, c.key, c.number ? (e.target.value === '' ? null : Number(e.target.value)) : (e.target.value || null))} />
                      </td>
                    );
                  })}
                  <td className="num nowrap">
                    <button type="button" className="sm ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('Move up')}>↑</button>
                    <button type="button" className="sm ghost" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label={t('Move down')}>↓</button>
                    <button type="button" className="sm ghost danger" onClick={() => setRows((rs) => rs.filter((_, n) => n !== i))} aria-label={t('Remove')}><X className="ico" aria-hidden /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row">
          <button type="button" className="sm" onClick={() => setRows((rs) => [...rs, { ...blank }])}>{t('+ Add row')}</button>
          {loadable && <button type="button" className="sm" onClick={addChecklist}>{t('Add the standard list for this business type')}</button>}
        </div>
      </form>
    </Modal>
  );
}
