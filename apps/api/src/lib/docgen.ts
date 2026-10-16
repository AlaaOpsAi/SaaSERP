/**
 * Contracts, proposals and annexes from Word templates. A template is an ordinary
 * .docx with {placeholders} (and {#lines}…{/lines} rows for tables); the company's
 * letterhead, wording and layout stay exactly as they designed them. LibreOffice
 * turns the filled document into a PDF.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { config } from '../config.js';
import { badRequest } from './errors.js';
import { amountInWords } from './words.js';

export type DocKind = 'contract' | 'proposal' | 'annex';
export type DocLanguage = 'ar' | 'en' | 'bilingual';

/** The templates shipped with the app, used until a company uploads its own. */
export const BUILTIN: Record<DocKind, { file: string; name: string; language: DocLanguage }> = {
  contract: { file: 'standard-contract.docx', name: 'Standard contract / proposal (English & Arabic)', language: 'bilingual' },
  proposal: { file: 'standard-contract.docx', name: 'Standard contract / proposal (English & Arabic)', language: 'bilingual' },
  annex: { file: 'standard-annex.docx', name: 'Standard annex (English & Arabic)', language: 'bilingual' },
};
const here = fileURLToPath(new URL('.', import.meta.url));
// apps/api/templates: two levels up from src/lib, three from the compiled dist/src/lib.
export const readBuiltin = async (kind: DocKind) => {
  for (const dir of [resolve(here, '../../templates'), resolve(here, '../../../templates')]) {
    try { return await readFile(join(dir, BUILTIN[kind].file)); } catch { /* try the next */ }
  }
  throw new Error(`Built-in template missing: ${BUILTIN[kind].file}`);
};

const TITLES: Record<DocKind, { en: string; ar: string }> = {
  contract: { en: 'Contract', ar: 'عقد الاتفاق' },
  proposal: { en: 'Proposal', ar: 'عرض سعر' },
  annex: { en: 'Contract details (annex)', ar: 'تفاصيل الاتفاق' },
};
const KIND_LETTER: Record<DocKind, string> = { contract: 'C', proposal: 'P', annex: 'A' };
export const docNoFor = (bookingNo: string, kind: DocKind, n: number) => `${bookingNo}-${KIND_LETTER[kind]}${n}`;

const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const ymd = (d: unknown): string | null => {
  if (!d) return null;
  if (d instanceof Date) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return String(d).slice(0, 10);
};
const dmy = (d: unknown) => { const s = ymd(d); return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : ''; };
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
/** 2370 → "2,370", 12.5 → "12.500" for 3-decimal currencies. */
function amount(v: number | null, currency: string) {
  if (v === null) return '';
  const decimals = ['KWD', 'BHD', 'OMR'].includes(currency) ? 3 : 2;
  const whole = Number.isInteger(v);
  return v.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : decimals, maximumFractionDigits: decimals });
}
const qty = (v: number | null) => (v === null ? '' : String(Number(v.toFixed(3))));

export interface DocInput {
  kind: DocKind;
  docNo: string;
  company: { name: string };
  booking: Record<string, unknown>;
  lines: { work_type: string; details: string | null; quantity: unknown; unit_price: unknown }[];
  annex: { service: string; service_alt: string | null; quantity: unknown; notes: string | null }[];
  notes?: string | null;
  issuedBy: string;
  hidePrices: boolean;
}

/** Every value a template can use; listed for admins under Admin → Templates. */
export function templateData(i: DocInput) {
  const b = i.booking;
  const currency = String(b.currency ?? 'KWD');
  const lines = i.lines.map((l, n) => {
    const q = num(l.quantity);
    const p = i.hidePrices ? null : num(l.unit_price);
    const total = p === null ? null : p * (q ?? 1);
    return { no: n + 1, work_type: l.work_type, details: l.details ?? '', qty: qty(q), price: amount(p, currency), amount: amount(total, currency), _total: total };
  });
  const linesTotal = lines.some((l) => l._total !== null) ? lines.reduce((s, l) => s + (l._total ?? 0), 0) : null;
  const total = i.hidePrices ? null : (num(b.contract_value) ?? linesTotal);
  const paid = num(b.paid);
  const remaining = total === null ? null : total - (paid ?? 0);
  const words = amountInWords(total, currency);
  const event = ymd(b.event_date);
  const day = event ? new Date(`${event}T12:00:00Z`).getUTCDay() : null;
  const today = new Date();
  return {
    doc_no: i.docNo,
    doc_title: TITLES[i.kind].ar,
    doc_title_en: TITLES[i.kind].en,
    issue_date: dmy(today),
    company_name: i.company.name,
    contract_no: b.booking_no ?? '',
    contract_name: b.name ?? '',
    business_type: b.business_unit_name ?? '',
    event_type: b.event_type ?? '',
    branch: b.branch ?? '',
    design: b.design ?? '',
    client_name: b.contact_name ?? b.account_name ?? '',
    client_first_name: b.contact_first_name ?? '',
    client_family_name: b.contact_family_name ?? '',
    client_phone: b.contact_phone ?? '',
    client_email: b.contact_email ?? '',
    client_address: b.contact_address ?? '',
    client_nationality: b.contact_nationality ?? '',
    client_instagram: b.contact_social_handle ?? '',
    client_civil_id: b.contact_civil_id ?? '',
    customer_no: b.customer_no ?? '',
    client_company: b.account_name ?? '',
    event_date: dmy(b.event_date),
    event_day: day === null ? '' : AR_DAYS[day],
    event_day_en: day === null ? '' : EN_DAYS[day],
    venue: [b.venue_name, b.space_name ?? b.hall_text].filter(Boolean).join(' – '),
    hotel: b.venue_name ?? '',
    hall: b.space_name ?? b.hall_text ?? '',
    pax: b.pax ?? '',
    currency,
    lines: lines.map(({ _total, ...l }) => l),
    total: amount(total, currency),
    down_payment: amount(paid, currency),
    remaining: amount(remaining, currency),
    total_words: words.en,
    total_words_ar: words.ar,
    annex: i.annex.map((a, n) => ({ no: n + 1, service: a.service, service_alt: a.service_alt ?? '', qty: qty(num(a.quantity)), notes: a.notes ?? '' })),
    notes: i.notes ?? '',
    salesperson: b.owner_name ?? '',
    issued_by: i.issuedBy,
  };
}

/** Placeholders shown to admins, with what each one prints. */
export const PLACEHOLDERS: [string, string][] = [
  ['doc_no', 'Document number, e.g. W2026052-C1'], ['doc_title', 'عقد الاتفاق / عرض سعر / تفاصيل الاتفاق'], ['doc_title_en', 'Contract / Proposal / Contract details (annex)'],
  ['issue_date', 'Date issued (dd/mm/yyyy)'], ['company_name', 'Your company name'],
  ['contract_no', 'Contract ID'], ['contract_name', 'Contract name'], ['business_type', 'Business type'], ['event_type', 'Event type'],
  ['branch', 'Branch'], ['design', 'Design'],
  ['client_name', 'Client full name'], ['client_first_name', 'First name'], ['client_family_name', 'Family name'], ['client_phone', 'Phone'],
  ['client_email', 'Email'], ['client_address', 'Address'], ['client_nationality', 'Country / nationality'], ['client_instagram', 'Instagram ID'], ['client_civil_id', 'Civil ID'],
  ['customer_no', 'Customer ID'], ['client_company', 'Client company'],
  ['event_date', 'Event date (dd/mm/yyyy)'], ['event_day', 'Weekday in Arabic'], ['event_day_en', 'Weekday in English'],
  ['venue', 'Hotel / location and hall'], ['hotel', 'Hotel / location'], ['hall', 'Hall / area'], ['pax', 'Number of guests'],
  ['total', 'Total contract value'], ['down_payment', 'Money received (down payment)'], ['remaining', 'Remaining amount'], ['currency', 'Currency, e.g. KWD'],
  ['total_words', 'Total in words (English)'], ['total_words_ar', 'Total in words (Arabic)'],
  ['notes', 'Notes typed when issuing'], ['salesperson', 'Account manager'], ['issued_by', 'Who issued the document'],
  ['#lines … /lines', 'Repeat a table row per service: {no} {work_type} {details} {qty} {price} {amount}'],
  ['#annex … /annex', 'Repeat a table row per annex service: {no} {service} {service_alt} {qty} {notes}'],
];

/** Fill a template; a broken template gives a message the admin can act on. */
export function fillTemplate(template: Buffer, data: Record<string, unknown>): Buffer {
  let doc: Docxtemplater;
  try {
    doc = new Docxtemplater(new PizZip(template), { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
    doc.render(data);
  } catch (e) {
    const errors = (e as { properties?: { errors?: { properties?: { explanation?: string } }[] } }).properties?.errors;
    const why = errors?.map((x) => x.properties?.explanation).filter(Boolean).slice(0, 3).join('; ');
    throw badRequest(`The template could not be filled${why ? `: ${why}` : ''}. Check its {placeholders} in Word.`);
  }
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
}

/** Check an uploaded template opens and fills with sample data. */
export function checkTemplate(template: Buffer) {
  fillTemplate(template, templateData({
    kind: 'contract', docNo: 'W2026001-C1', company: { name: 'Sample' }, issuedBy: 'Sample', hidePrices: false,
    booking: { booking_no: 'W2026001', currency: 'KWD', contract_value: 1000, paid: 100, event_date: '2026-12-01' },
    lines: [{ work_type: 'Sample', details: null, quantity: 1, unit_price: 1000 }],
    annex: [{ service: 'Sample', service_alt: null, quantity: 1, notes: null }],
  }));
}

/** Word → PDF with LibreOffice; null when LibreOffice is not installed or fails. */
export async function toPdf(docx: Buffer): Promise<Buffer | null> {
  const dir = await mkdtemp(join(tmpdir(), 'saaserp-pdf-'));
  try {
    await writeFile(join(dir, 'doc.docx'), docx);
    // A profile per conversion, so two documents issued at once never clash.
    await new Promise<void>((ok, fail) =>
      execFile(config.soffice, [`-env:UserInstallation=file://${dir}/profile`, '--headless', '--convert-to', 'pdf', '--outdir', dir, join(dir, 'doc.docx')],
        { timeout: 90_000 }, (err) => (err ? fail(err) : ok())));
    return await readFile(join(dir, 'doc.pdf'));
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
