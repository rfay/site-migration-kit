#!/usr/bin/env node
// Build a throwaway static mirror of the original site with wget, from the paths in the
// semantic baseline. It is the second "rendering" used to prove the suite is
// platform-independent, and a stand-in for the static-HTML migration in rehearsals.
//
//   node kit/scripts/mirror-static.mjs --out /tmp/site-static [--from <url>] [--root <dir>] [--ca <rootCA.pem>] [--one-hop]
//
// Needs wget and network access to the source site (run it where the source resolves, e.g.
// inside the DDEV web container). Links between mirrored pages are rewritten to relative
// .html files by wget; everything else keeps pointing at the original site.

import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const argv = process.argv.slice(2);
const get = (flag, dflt) => (argv.indexOf(flag) >= 0 ? argv[argv.indexOf(flag) + 1] : dflt);
const root = path.resolve(get('--root', process.cwd()));
const out = path.resolve(get('--out', '/tmp/site-static'));
const ca = get('--ca', null); // a CA certificate for wget to trust, e.g. mkcert's rootCA.pem on the host

const index = JSON.parse(readFileSync(path.join(root, 'baseline/semantic/index.json'), 'utf8'));
// Crawl the site named by --from (for example the prepared copy), not necessarily the original the
// baseline was captured from. The page paths come from the baseline either way.
const base = (get('--from', null) ?? index.baseUrl).replace(/\/$/, '');
// Images and files that old content hardcodes at the site's own public domain (config.ownDomains,
// recorded in the baseline). A crawler will not follow another host, but these ARE this site, so they
// are fetched from the copy being crawled and saved at the same path, ready to be linked relatively.
const own = index.ownDomainReferences ?? { links: [], images: [] };
const ownFiles = [];
for (const r of [...own.images, ...own.links]) {
  let u;
  try { u = new URL(r.url); } catch { continue; }
  // Images always; links only when they point at a file (a PDF, a patch), not at a page.
  if (own.images.includes(r) || /\.[A-Za-z0-9]{2,5}$/.test(u.pathname)) ownFiles.push(`${base}${u.pathname}${u.search}`);
}
const urls = [...new Set([
  ...index.pages.map((p) => `${base}/${p.path.replace(/^\/+/, '')}`),
  // Linked files (PDFs and the like) are not "page requisites", so wget would skip them.
  ...(index.assets ?? []).map((a) => `${base}${a}`),
  ...ownFiles,
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

// --one-hop: also fetch the pages that captured pages link to but the baseline did not capture, because
// discovery was bounded (config.discover.noFollow) or skipped them. Without them the rewrite unwraps
// links that work on the original, and the semantic tier cannot see it: it asserts only links to pages
// the baseline knows. Candidates come from the baseline's page records: internal links, not captured,
// not recorded dead or restricted on the original, and with no file extension (a page, not a file;
// links to files are covered by the assets). wget saves only what answers 200. The hop pages are not
// in the baseline, so they are not tested; their own links to uncaptured pages are unwrapped. Links
// between the two passes stay absolute on the crawled site; rewrite-static.mjs makes them relative.
if (argv.includes('--one-hop')) {
  const captured = new Set(index.pages.map((p) => p.path));
  const records = index.pages.map((p) => JSON.parse(readFileSync(path.join(root, 'baseline/semantic', p.file), 'utf8')));
  const dead = new Set(records.flatMap((rec) => (rec.references?.internalNonOk ?? []).map((x) => x.key)));
  const hop = new Set();
  for (const rec of records) {
    for (const l of [...(rec.links ?? []), ...Object.values(rec.regions ?? {}).flatMap((g) => g.links ?? [])]) {
      if (!l.internal || captured.has(l.key) || dead.has(l.key)) continue;
      if (/\.[^/]*$/.test(l.key.split('?')[0])) continue;
      hop.add(l.key);
    }
  }
  if (hop.size) {
    const hopList = path.join(out, '.hop-urls.txt');
    writeFileSync(hopList, [...hop].map((k) => new URL(k, `${base}/`).href).join('\n') + '\n');
    const r1 = spawnSync(
      'wget',
      ['--input-file', hopList, '--directory-prefix', out, '--no-host-directories', '--force-directories',
       '--page-requisites', '--convert-links', '--adjust-extension', '--restrict-file-names=unix',
       '-e', 'robots=off', '--no-verbose', '--tries=2', '--timeout=20', ...(ca ? ['--ca-certificate', ca] : [])],
      { stdio: 'inherit' }
    );
    if (r1.status !== 0 && r1.status !== 8) process.exit(r1.status ?? 1);
    rmSync(hopList, { force: true });
    // A page is saved as k.html or k/index.html; a feed keeps its bare name (blog/feed).
    const isFile = (p) => existsSync(p) && statSync(p).isFile();
    const saved = [...hop].filter((k) => [`${k}.html`, path.join(k, 'index.html'), k].some((f) => isFile(path.join(out, f))));
    console.log(`One hop: ${saved.length} of ${hop.size} uncaptured page(s) linked from captured pages fetched (the rest did not answer 200)`);
  }
}

// --convert-links also rewrites uploaded HTML and CSS files (legacy pages under files/, a gallery's
// stylesheet): it mangles CSS url()s and makes links to files it did not fetch absolute URLs on the
// crawled site. An upload must be served byte for byte, so fetch those again, unconverted, into a
// scratch directory with the same file naming, and copy them over the converted ones.
const rawAssets = (index.assets ?? []).filter((a) => /\.(s?html?|xhtml|css)$/i.test(a.split('?')[0]));
if (rawAssets.length) {
  const scratch = path.join(out, '.raw-assets');
  mkdirSync(scratch, { recursive: true });
  const rawList = path.join(out, '.raw-assets.txt');
  writeFileSync(rawList, rawAssets.map((a) => `${base}${a}`).join('\n') + '\n');
  const r2 = spawnSync(
    'wget',
    ['--input-file', rawList, '--directory-prefix', scratch, '--no-host-directories', '--force-directories',
     '--restrict-file-names=unix', '-e', 'robots=off', '--no-verbose', '--tries=2', '--timeout=20',
     ...(ca ? ['--ca-certificate', ca] : [])],
    { stdio: 'inherit' }
  );
  if (r2.status !== 0 && r2.status !== 8) process.exit(r2.status ?? 1);
  let restored = 0;
  (function copy(d) {
    for (const name of readdirSync(d)) {
      const full = path.join(d, name);
      if (statSync(full).isDirectory()) { copy(full); continue; }
      const dest = path.join(out, path.relative(scratch, full));
      mkdirSync(path.dirname(dest), { recursive: true });
      copyFileSync(full, dest);
      restored++;
    }
  })(scratch);
  rmSync(scratch, { recursive: true, force: true });
  rmSync(rawList, { force: true });
  console.log(`Restored ${restored} of ${rawAssets.length} uploaded HTML/CSS file(s) unconverted (wget --convert-links had rewritten them)`);
}
