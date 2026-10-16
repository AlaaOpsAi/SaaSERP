import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, download, openSigned, type DocKind, type DocTemplate } from '../api';
import { useAuth } from '../auth';
import { dateTime } from '../format';
import { useBusinessUnits, useSave } from '../hooks';
import { t } from '../i18n';
import { DOC_KINDS, languageLabel } from './ContractDocuments';
import { ErrorNote, Field, FieldGroup } from './ui';

interface TemplatesData { templates: (DocTemplate & { file_name: string; size_bytes: number; is_active: boolean; updated_at: string })[]; placeholders: [string, string][] }

/**
 * Admin → Templates: the company's Word templates for contracts, proposals and annexes,
 * per business type and language, and the standard annex list per business type.
 */
export function TemplatesAdmin() {
  const { can } = useAuth();
  const { data } = useQuery({ queryKey: ['templates'], queryFn: () => api<TemplatesData>('/templates') });
  const { data: units } = useBusinessUnits();
  const [error, setError] = useState<unknown>(null);
  const inv = [['templates'], ['booking-templates']];
  const patch = useSave((v: { id: string; body: object }) => api(`/templates/${v.id}`, { method: 'PATCH', body: v.body }), inv);
  const remove = useSave((id: string) => api(`/templates/${id}`, { method: 'DELETE' }), inv);
  const replace = useSave((v: { id: string; file: File }) => {
    const form = new FormData();
    form.append('file', v.file);
    return api(`/templates/${v.id}/file`, { form });
  }, inv);
  const unitNames = (ids: string[]) => (ids.length ? ids.map((id) => units?.find((u) => u.id === id)?.name ?? '?').join(', ') : t('All business types'));
  const admin = can('admin');

  return (
    <div className="stack" style={{ maxWidth: 1000 }}>
      <p className="secondary" style={{ margin: 0 }}>
        {t('Contracts, proposals and annexes are issued from Word templates. Write {placeholders} where the contract data goes; the letterhead, wording and layout stay yours. Each business type can have its own templates, in Arabic, English or both.')}
      </p>
      <ErrorNote error={error ?? patch.error ?? remove.error ?? replace.error} />

      <div className="card flush">
        <div className="card-head"><h2>{t('Templates')}</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t('Name')}</th><th>{t('Used for')}</th><th>{t('Business types')}</th><th>{t('Language')}</th><th>{t('Active')}</th><th /></tr></thead>
            <tbody>
              {!data?.templates.length && <tr><td colSpan={6} className="empty">{t('No templates yet: the standard English & Arabic templates are used.')}</td></tr>}
              {data?.templates.map((tp) => (
                <tr key={tp.id}>
                  <td><strong>{tp.name}</strong><div className="small muted">{tp.file_name} · {dateTime(tp.updated_at)}</div></td>
                  <td>{tp.kinds.map((k) => <span key={k} className="tag" style={{ marginInlineEnd: 4 }}>{t(DOC_KINDS.find(([x]) => x === k)![1])}</span>)}</td>
                  <td className="small">{unitNames(tp.business_unit_ids)}</td>
                  <td>{languageLabel(tp.language)}</td>
                  <td><input type="checkbox" checked={tp.is_active} disabled={!admin} aria-label={t('Active')}
                    onChange={(e) => patch.mutate({ id: tp.id, body: { is_active: e.target.checked } })} /></td>
                  <td className="num">
                    {admin && (
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button className="sm" onClick={() => { setError(null); openSigned(`/templates/${tp.id}/link`).catch(setError); }}>{t('Download')}</button>
                        <label className="btn sm">{t('Replace file')}
                          <input type="file" accept=".docx" hidden onChange={(e) => e.target.files?.[0] && replace.mutate({ id: tp.id, file: e.target.files[0] })} />
                        </label>
                        <button className="sm danger" onClick={() => confirm(t('Delete the template {name}? Documents already issued keep their copy.', { name: tp.name })) && remove.mutate(tp.id)}>{t('Delete')}</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {admin && <UploadTemplate />}

      <div className="card stack">
        <h2 style={{ margin: 0 }}>{t('Start from the standard templates')}</h2>
        <p className="small secondary" style={{ margin: 0 }}>{t('Download one, put your letterhead and wording around the {placeholders} in Word, and upload it above.')}</p>
        <div className="row">
          <button className="sm" onClick={() => download('/templates/standard/contract', 'standard-contract.docx').catch(setError)}>{t('Standard contract / proposal (.docx)')}</button>
          <button className="sm" onClick={() => download('/templates/standard/annex', 'standard-annex.docx').catch(setError)}>{t('Standard annex (.docx)')}</button>
        </div>
        <details>
          <summary>{t('Placeholders you can use')}</summary>
          <table style={{ marginTop: 8 }}>
            <tbody>
              {data?.placeholders.map(([key, what]) => (
                <tr key={key}><td><code>{`{${key}}`}</code></td><td className="secondary">{t(what)}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>

      <Checklists />
    </div>
  );
}

function UploadTemplate() {
  const { data: units } = useBusinessUnits();
  const [name, setName] = useState('');
  const [kinds, setKinds] = useState<DocKind[]>(['contract', 'proposal']);
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [language, setLanguage] = useState('ar');
  const [file, setFile] = useState<File | null>(null);
  const [formKey, setFormKey] = useState(0);
  const save = useSave(() => {
    const form = new FormData();
    form.append('file', file!);
    const qs = new URLSearchParams({ name, kinds: kinds.join(','), language, business_unit_ids: unitIds.join(',') });
    return api(`/templates?${qs}`, { form });
  }, [['templates'], ['booking-templates']]);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <form key={formKey} className="card stack" onSubmit={(e) => {
      e.preventDefault();
      save.mutate(undefined, { onSuccess: () => { setName(''); setFile(null); setFormKey((k) => k + 1); } });
    }}>
      <h2 style={{ margin: 0 }}>{t('Upload a template')}</h2>
      <ErrorNote error={save.error} />
      <div className="form-grid">
        <Field label={t('Name')} className="span-2"><input required value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Wedding contract (Arabic)')} /></Field>
        <Field label={t('Language')}>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="ar">{t('Arabic')}</option><option value="en">{t('English')}</option><option value="bilingual">{t('English & Arabic')}</option>
          </select>
        </Field>
        <FieldGroup label={t('Used for')} className="span-all">
          <div className="row">
            {DOC_KINDS.map(([k, l]) => (
              <label key={k} className="check"><input type="checkbox" checked={kinds.includes(k)} onChange={() => setKinds((x) => toggle(x, k))} />{t(l)}</label>
            ))}
          </div>
        </FieldGroup>
        <FieldGroup label={t('Business types (none ticked = all)')} className="span-all">
          <div className="row">
            {units?.map((u) => (
              <label key={u.id} className="check"><input type="checkbox" checked={unitIds.includes(u.id)} onChange={() => setUnitIds((x) => toggle(x, u.id))} />{u.code} · {u.name}</label>
            ))}
          </div>
        </FieldGroup>
        <Field label={t('Word file (.docx)')} className="span-2"><input type="file" accept=".docx" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
      </div>
      <div><button className="primary" disabled={!file || !kinds.length || save.isPending}>{save.isPending ? t('Checking the template…') : t('Upload')}</button></div>
    </form>
  );
}

/** The standard annex services per business type, loaded into a contract with one click. */
function Checklists() {
  const { can } = useAuth();
  const { data: units } = useBusinessUnits();
  const { data } = useQuery({
    queryKey: ['annex-checklists'], queryFn: () => api<{ business_unit_id: string | null; items: { service: string; service_alt: string | null }[] }[]>('/annex-checklists'),
  });
  const [unit, setUnit] = useState('');
  const [text, setText] = useState('');
  useEffect(() => {
    const items = data?.find((c) => (c.business_unit_id ?? '') === unit)?.items ?? [];
    setText(items.map((i) => (i.service_alt ? `${i.service} | ${i.service_alt}` : i.service)).join('\n'));
  }, [data, unit]);
  const save = useSave(() => api('/annex-checklists', {
    method: 'PUT',
    body: {
      business_unit_id: unit || null,
      items: text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
        const [service, alt] = l.split('|').map((x) => x.trim());
        return { service, service_alt: alt || null };
      }),
    },
  }), [['annex-checklists']]);
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>{t('Annex checklist per business type')}</h2>
      <p className="small secondary" style={{ margin: 0 }}>
        {t('The services listed in the annex (e.g. Wedding Specifications). One per line, the second language after a | sign. Sales add the list to a contract with one click and fill quantity and notes.')}
      </p>
      <ErrorNote error={save.error} />
      <Field label={t('Business type')}>
        <select value={unit} onChange={(e) => setUnit(e.target.value)}>
          <option value="">{t('All business types')}</option>
          {units?.map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}
        </select>
      </Field>
      <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} disabled={!can('manage')} dir="auto"
        placeholder={'كوشة ورد طبيعي أوصناعي | KOSHA + chosen flower type\nمدخل العروس | Bride Entrance Decoration'} />
      {can('manage') && <div><button className="primary" disabled={save.isPending} onClick={() => save.mutate(undefined)}>{t('Save list')}</button>
        {save.isSuccess && <span className="small muted" style={{ marginInlineStart: 8 }}>{t('Saved.')}</span>}</div>}
    </div>
  );
}
