/**
 * Checks Word templates the way the app does when an admin uploads one.
 *
 *   cd apps/api && npx tsx ../../discussions/02_2026-10-16_continue-development-local/scripts/check-templates.mts ../../templates/*.docx
 *
 * For each file: the {placeholders} it uses, which ones the app does not know, loops
 * ({#lines}…{/lines}), and whether the app's own engine can fill it (checkTemplate).
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import PizZip from 'pizzip';
import { checkTemplate, templateData } from '../../../apps/api/src/lib/docgen.ts';

const known = new Set(Object.keys(templateData({
  kind: 'contract', docNo: 'X', company: { name: 'X' }, issuedBy: 'X', hidePrices: false,
  booking: {}, lines: [], annex: [],
})));
const loopFields: Record<string, string[]> = {
  lines: ['no', 'work_type', 'details', 'qty', 'price', 'amount'],
  annex: ['no', 'service', 'service_alt', 'qty', 'notes'],
};

for (const file of process.argv.slice(2)) {
  const buf = await readFile(file);
  const zip = new PizZip(buf);
  const parts = Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n));
  // Word splits text into runs; join each paragraph's text before looking for {tags}.
  const text = parts.map((p) => zip.file(p)!.asText()
    .replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')).join('\n');
  const tags = [...text.matchAll(/\{([^{}]{1,60})\}/g)].map((m) => m[1].trim());
  const unique = [...new Set(tags)];
  let loop: string | null = null;
  const unknown: string[] = [];
  for (const tag of tags) {
    if (tag.startsWith('#')) { loop = tag.slice(1); if (!loopFields[loop]) unknown.push(tag); continue; }
    if (tag.startsWith('/')) { loop = null; continue; }
    const ok = loop ? loopFields[loop]?.includes(tag) : known.has(tag);
    if (!ok && !unknown.includes(tag)) unknown.push(tag);
  }
  let fills = 'yes';
  try { checkTemplate(buf); } catch (e) { fills = `NO — ${(e as Error).message}`; }
  console.log(`\n=== ${basename(file)}  (${Math.round(buf.length / 1024)} kB, parts: ${parts.map((p) => p.slice(5)).join(', ')})`);
  console.log(`placeholders (${unique.length}): ${unique.join(', ') || '— none —'}`);
  console.log(`unknown to the app: ${unknown.join(', ') || 'none'}`);
  console.log(`app can fill it: ${fills}`);
  console.log(`characters of text: ${text.replace(/\s+/g, ' ').trim().length}`);
}
