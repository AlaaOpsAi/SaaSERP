#!/usr/bin/env node
/**
 * Builds discussions/ALL_DISCUSSIONS.md: the whole discussion history in one file.
 *
 *   npm run discussions
 *
 * Each numbered folder keeps its own record (discussion.md: what that discussion added).
 * This file joins them all, in the order of the index in discussions/README.md, and pulls in
 * any "Full record" a folder links to (e.g. docs/session-transcript.md for discussion 01).
 * Headings are nested one level down and links are rewritten so they work from discussions/.
 * Run it after every change to a discussion; never edit ALL_DISCUSSIONS.md by hand.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'discussions');
const out = join(dir, 'ALL_DISCUSSIONS.md');

/** Rows of the index table: | # | Date | Topic | [folder](folder/discussion.md) | Status | */
function indexRows() {
  const readme = readFileSync(join(dir, 'README.md'), 'utf8');
  return readme.split('\n')
    .map((l) => /^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*([^|]+?)\s*\|/.exec(l))
    .filter(Boolean)
    .map(([, no, date, topic, folder, , status]) => ({ no, date, topic, folder, status }));
}

/** Nest headings `by` levels and make relative links work from discussions/ (code blocks untouched). */
function adapt(text, sourceFile, by) {
  let fence = false;
  return text.split('\n').map((line) => {
    if (/^\s*```/.test(line)) { fence = !fence; return line; }
    if (fence) return line;
    if (/^#{1,6} /.test(line)) line = '#'.repeat(by) + line;
    return line.replace(/\]\(([^)\s]+)\)/g, (m, href) => {
      if (/^([a-z]+:|#|\/)/i.test(href)) return m;
      const [path, hash] = href.split('#');
      const target = resolve(dirname(sourceFile), path);
      return `](${relative(dir, target)}${hash ? `#${hash}` : ''})`;
    });
  }).join('\n');
}

/** Files a discussion names as its full record: "- **Full record:** [name](path)". */
function fullRecords(text, sourceFile) {
  return [...text.matchAll(/^- \*\*Full record:\*\*.*?\]\(([^)\s#]+)\)/gm)]
    .map((m) => resolve(dirname(sourceFile), m[1]))
    .filter((f) => existsSync(f));
}

const rows = indexRows();
const parts = [
  '# SaaSERP — all discussions',
  '',
  `_Built ${new Date().toISOString().slice(0, 10)} by \`npm run discussions\` from the discussion folders. Don't edit this file by hand: edit the folder's \`discussion.md\` and run the script again._`,
  '',
  '## Index',
  '',
  '| # | Date | Topic | Status |',
  '|---|---|---|---|',
  ...rows.map((r) => `| [${r.no}](#discussion-${r.no}) | ${r.date} | ${r.topic} | ${r.status} |`),
];

for (const r of rows) {
  const file = join(dir, r.folder, 'discussion.md');
  if (!existsSync(file)) throw new Error(`Missing ${relative(root, file)}`);
  const text = readFileSync(file, 'utf8').replace(/^# .*\n+/, '');
  parts.push('', '---', '', `<a id="discussion-${r.no}"></a>`, '', `## Discussion ${r.no} — ${r.topic}`, '',
    `${r.date} · ${r.status} · folder [${r.folder}](${r.folder}/)`, '', adapt(text, file, 1).trim());
  for (const record of fullRecords(text, file)) {
    const body = readFileSync(record, 'utf8').replace(/^# .*\n+/, '');
    parts.push('', `### Full record: ${relative(root, record)}`, '', adapt(body, record, 2).trim());
  }
}

writeFileSync(out, `${parts.join('\n')}\n`);
console.log(`Wrote ${relative(root, out)}: ${rows.length} discussions`);
