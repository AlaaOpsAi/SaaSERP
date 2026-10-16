#!/usr/bin/env node
/**
 * Adds shadcn / 21st.dev components:  npm run ui:add -w apps/web -- <name or registry URL> ...
 *
 * Runs `shadcn add`, then undoes a CLI quirk in this monorepo: it imports `cn` from an npm
 * package named "cn" instead of our helper in src/lib/utils.ts, and installs that package.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const web = new URL('..', import.meta.url).pathname;
const run = (cmd, args, cwd = web) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

run('npx', ['shadcn@latest', 'add', '--yes', ...process.argv.slice(2)]);

let fixed = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?)$/.test(name)) {
      const src = readFileSync(p, 'utf8');
      const out = src.replace(/from (["'])cn\1/g, 'from $1@/lib/utils$1');
      if (out !== src) { writeFileSync(p, out); fixed++; }
    }
  }
};
walk(join(web, 'src'));

const pkg = JSON.parse(readFileSync(join(web, 'package.json'), 'utf8'));
if (pkg.dependencies?.cn) run('npm', ['uninstall', '-w', 'apps/web', 'cn'], join(web, '../..'));
console.log(`ui:add: pointed ${fixed} file(s) at @/lib/utils`);
