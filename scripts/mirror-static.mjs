#!/usr/bin/env node
// Build a throwaway static mirror of the original site with wget, from the paths in the
// semantic baseline. It is the second "rendering" used to prove the suite is
// platform-independent, and a stand-in for the static-HTML migration in rehearsals.
//
//   node kit/scripts/mirror-static.mjs --out /tmp/site-static [--root <dir>] [--ca <rootCA.pem>]
//
// Needs wget and network access to the source site (run it where the source resolves, e.g.
// inside the DDEV web container). Links between mirrored pages are rewritten to relative
// .html files by wget; everything else keeps pointing at the original site.

import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const argv = process.argv.slice(2);
const get = (flag, dflt) => (argv.indexOf(flag) >= 0 ? argv[argv.indexOf(flag) + 1] : dflt);
const root = path.resolve(get('--root', process.cwd()));
const out = path.resolve(get('--out', '/tmp/site-static'));
const ca = get('--ca', null); // a CA certificate for wget to trust, e.g. mkcert's rootCA.pem on the host

const index = JSON.parse(readFileSync(path.join(root, 'baseline/semantic/index.json'), 'utf8'));
const base = index.baseUrl.replace(/\/$/, '');
const urls = [...new Set([
  ...index.pages.map((p) => `${base}/${p.path.replace(/^\/+/, '')}`),
  // Linked files (PDFs and the like) are not "page requisites", so wget would skip them.
  ...(index.assets ?? []).map((a) => `${base}${a}`),
])];

// This script empties <out> before mirroring. Refuse anything that looks like a project root or
// the home directory, so pointing it at a DDEV project whose docroot is its root (and so would
// delete .ddev/) fails loudly instead. Mirror into a subdirectory such as public/.
const PROJECT_MARKERS = ['.ddev', '.git', 'package.json', 'composer.json', 'docroot', 'node_modules'];
const marker = PROJECT_MARKERS.find((m) => existsSync(path.join(out, m)));
if (marker || out === path.resolve(process.env.HOME ?? '/') || out === path.parse(out).root) {
  console.error(`Refusing to empty ${out}: ${marker ? `it contains ${marker}, so it looks like a project root` : 'that is too broad'}.`);
  console.error('Set the project\'s docroot to a subdirectory (for example public/) and mirror into that.');
  process.exit(2);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const list = path.join(out, '.urls.txt');
writeFileSync(list, urls.join('\n') + '\n');

const r = spawnSync(
  'wget',
  ['--input-file', list, '--directory-prefix', out, '--no-host-directories', '--force-directories',
   '--page-requisites', '--convert-links', '--adjust-extension', '--restrict-file-names=unix',
   '-e', 'robots=off', '--no-verbose', '--tries=2', '--timeout=20', ...(ca ? ['--ca-certificate', ca] : [])],
  { stdio: 'inherit' }
);
// wget exits 8 when any single URL (e.g. a missing asset) errors; the mirror is still usable.
if (r.status !== 0 && r.status !== 8) process.exit(r.status ?? 1);
console.log(`Mirrored ${urls.length} page URL(s) from ${base} into ${out}`);
