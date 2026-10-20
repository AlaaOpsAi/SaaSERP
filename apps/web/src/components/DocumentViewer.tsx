import { Download, Printer, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, openSigned } from '../api';
import { t } from '../i18n';
import { ErrorNote } from './ui';

export type ViewTarget = { kind: 'document' | 'file'; id: string; download?: string };

interface Opened { title: string; pages: number; token: string; rights: { download: boolean; print: boolean } }

/**
 * Shows an issued document or an uploaded file as pages drawn on the server with the viewer's
 * name, employee ID and the time across them (customer comment 7). There is no file to save;
 * people without the print right can't print it (the browser prints a notice instead).
 */
export function DocumentViewer({ target, onClose }: { target: ViewTarget; onClose: () => void }) {
  const [doc, setDoc] = useState<Opened | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<Opened>(`/viewer/${target.kind}/${target.id}`).then(setDoc, setError);
  }, [target.kind, target.id]);

  useEffect(() => {
    // Save and print shortcuts: blocked unless the person has that right.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') e.preventDefault();
      if (mod && e.key.toLowerCase() === 'p' && !doc?.rights.print) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    document.body.classList.add('viewing-document');
    document.body.classList.toggle('no-print', !doc?.rights.print);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('viewing-document', 'no-print');
    };
  }, [doc, onClose]);

  return (
    <div className="viewer-layer" role="dialog" aria-modal="true" aria-label={doc?.title ?? t('Document')}
      onContextMenu={(e) => e.preventDefault()}>
      <header className="viewer-bar">
        <strong className="grow">{doc?.title ?? t('Loading…')}</strong>
        {doc && <span className="small muted">{t('{n} pages', { n: doc.pages })}</span>}
        {doc?.rights.print && <button className="sm" onClick={() => window.print()}><Printer className="ico" aria-hidden /> {t('Print')}</button>}
        {doc?.rights.download && target.download && (
          <button className="sm" onClick={() => openSigned(target.download!).catch(setError)}><Download className="ico" aria-hidden /> {t('Download')}</button>
        )}
        <button className="sm ghost" onClick={onClose} aria-label={t('Close')}><X className="ico" aria-hidden /></button>
      </header>
      <ErrorNote error={error} />
      {doc && !doc.rights.download && (
        <p className="viewer-note small">{t('View only: your name is shown on every page. Downloading is not allowed for your account.')}</p>
      )}
      <div className="viewer-pages">
        {doc && Array.from({ length: doc.pages }, (_, i) => (
          <img key={i} src={`/api/viewer/page?t=${encodeURIComponent(doc.token)}&n=${i + 1}`} alt={t('Page {n}', { n: i + 1 })}
            draggable={false} loading="lazy" />
        ))}
      </div>
      <div className="print-blocked">{t('Printing is not allowed for this document.')}</div>
    </div>
  );
}
