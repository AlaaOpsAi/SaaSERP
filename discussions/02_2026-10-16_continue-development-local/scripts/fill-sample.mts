/**
 * Fills the prepared WEDX templates with made-up sample data, exactly as the app does when
 * a salesperson issues a contract. Two cases: everything known, and an empty booking (blanks
 * must print as lines to write on).
 *
 *   cd apps/api && npx tsx ../../discussions/02_2026-10-16_continue-development-local/scripts/fill-sample.mts ../../templates/prepared
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkTemplate, fillTemplate, templateData, type DocKind } from '../../../apps/api/src/lib/docgen.ts';

const dir = process.argv[2];
const booking = {
  booking_no: 'W2026999', name: 'Sample wedding', currency: 'KWD', contract_value: 2370, paid: 500,
  event_date: '2026-12-10', contact_name: 'Sample Client Name', contact_phone: '+965 5000 0000',
  contact_address: 'Block 1, Street 2, House 3, Sample Area', contact_civil_id: '000000000000',
  venue_name: 'Sample Hotel', space_name: 'Ballroom', pax: 350, event_type: 'Wedding', owner_name: 'Sample Salesperson',
};
const lines = [
  { work_type: 'كوشة', details: 'Fresh flowers, white & gold', quantity: 1, unit_price: 1500 },
  { work_type: 'DJ', details: 'Ladies party, 5 hours', quantity: 1, unit_price: 420 },
  { work_type: 'تصوير', details: 'Photo + video', quantity: 1, unit_price: 450 },
];
const annex = [
  { service: 'كوشة ورد طبيعي أوصناعي', service_alt: 'KOSHA + chosen flower type', quantity: 1, notes: 'White roses' },
  { service: 'مدخل العروس', service_alt: 'Bride Entrance Decoration', quantity: 1, notes: null },
  { service: 'دي جي', service_alt: 'DJ', quantity: 1, notes: '8 pm – 1 am' },
];

for (const [file, kind] of [['WEDX_Wedding_Contract_template.docx', 'contract'], ['WEDX_Wedding_Annex_template.docx', 'annex']] as [string, DocKind][]) {
  const template = await readFile(join(dir, file));
  checkTemplate(template); // the same test-fill an upload gets
  const arabic = { ...booking, contact_name: 'سارة محمد العلي', contact_address: 'السالمية، قطعة ١، شارع ٢، منزل ٣', venue_name: 'فندق تجريبي', space_name: 'القاعة الكبرى' };
  for (const [suffix, b, l, a] of [['filled', booking, lines, annex], ['arabic', arabic, lines, annex], ['empty', { booking_no: 'W2026998', currency: 'KWD' }, [], []]] as const) {
    const data = templateData({
      kind, docNo: `${b.booking_no}-${kind === 'annex' ? 'A' : 'C'}1`, company: { name: 'WEDX' }, issuedBy: 'Sample',
      hidePrices: false, booking: b, lines: [...l], annex: [...a], notes: suffix === 'empty' ? null : 'Setup from 2 pm',
    });
    const out = join(dir, `sample-${kind}-${suffix}.docx`);
    await writeFile(out, fillTemplate(template, data));
    console.log('wrote', out);
  }
}
