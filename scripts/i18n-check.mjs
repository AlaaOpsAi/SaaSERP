#!/usr/bin/env node
// Lists texts used in t('...') that a language file does not translate yet.
// Usage: node scripts/i18n-check.mjs [code]   (default: every language file found)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const APPS = [
  { name: 'web', src: 'apps/web/src', skip: /Platform\.tsx$/ },
  { name: 'mobile', src: 'apps/mobile/src', skip: null },
];
const only = process.argv[2];

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}
const unquote = (q, s) => s.replace(new RegExp(`\\\\${q}`, 'g'), q);

let missingTotal = 0;
for (const app of APPS) {
  const i18nDir = join(app.src, 'i18n');
  const keys = new Set();
  for (const f of files(app.src)) {
    if (f.startsWith(i18nDir) || app.skip?.test(f)) continue;
    for (const m of readFileSync(f, 'utf8').matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1).)*?)\1/g)) keys.add(unquote(m[1], m[2]));
  }
  const langs = readdirSync(i18nDir).filter((f) => f !== 'index.ts' && f.endsWith('.ts')).map((f) => f.replace('.ts', ''));
  for (const code of langs.filter((c) => !only || c === only)) {
    const dict = new Set();
    for (const m of readFileSync(join(i18nDir, `${code}.ts`), 'utf8').matchAll(/^\s*("(?:\\.|[^"])*")\s*:/gm)) dict.add(JSON.parse(m[1]));
    const missing = [...keys].filter((k) => !dict.has(k)).sort();
    missingTotal += missing.length;
    console.log(`${app.name}/${code}: ${keys.size - missing.length}/${keys.size} translated`);
    for (const k of missing) console.log(`  - ${JSON.stringify(k)}`);
  }
}
process.exitCode = missingTotal ? 1 : 0;
