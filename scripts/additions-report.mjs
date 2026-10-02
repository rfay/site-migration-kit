#!/usr/bin/env node
// Informational report: what does the TARGET show that the baseline never recorded?
//
//   node kit/scripts/additions-report.mjs --target <url> [--root <dir>] [--chrome 0.3] [--out <file>]
//
// The semantic suite only asks what is MISSING, which is the right default for a migration:
// additions are usually harmless. But additions can also mean something went wrong (a macro that
// leaked as raw text, a stray debug line, content duplicated from another page), so this report
// lets a human look. It never fails a run and is not a test.
//
// Because the target is read without selectors (whole <body>), its text includes theme chrome:
// menus, footers, sidebars. A line that appears on at least --chrome (default 30%) of pages is
// treated as chrome and left out, as is each page's own title. What remains per page is
// "extra lines", reported with counts. Expect some noise; it is a prompt to look, not a verdict.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractTarget, normalizeText } from '../lib/extract.mjs';

const argv = process.argv.slice(2);
const get = (flag, dflt) => (argv.indexOf(flag) >= 0 ? argv[argv.indexOf(flag) + 1] : dflt);
const root = path.resolve(get('--root', process.cwd()));
const target = (get('--target', process.env.TEST_BASE_URL) ?? '').replace(/\/$/, '');
const chromeThreshold = Number(get('--chrome', '0.3'));
if (!target) {
  console.error('Give --target <url> (or set TEST_BASE_URL).');
  process.exit(2);
}
const out = path.resolve(get('--out', path.join(root, 'test-results', 'additions-report.md')));

const index = JSON.parse(readFileSync(path.join(root, 'baseline/semantic/index.json'), 'utf8'));

const pages = [];
for (const p of index.pages) {
  const url = `${target}/${p.path.replace(/^\/+/, '')}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (res.status !== 200) {
    pages.push({ page: p, status: res.status, lines: [] });
    continue;
  }
  const rec = extractTarget(await res.text(), { pageUrl: url, baseUrl: target });
  pages.push({ page: p, status: 200, lines: [...new Set(rec.lines)] });
}

// A line shown on many pages is theme chrome, not page content.
const seen = new Map();
const ok = pages.filter((p) => p.status === 200);
for (const p of ok) for (const l of p.lines) seen.set(l, (seen.get(l) ?? 0) + 1);
const isChrome = (l) => seen.get(l) / Math.max(ok.length, 1) >= chromeThreshold;

const results = [];
for (const p of ok) {
  const base = JSON.parse(readFileSync(path.join(root, 'baseline/semantic', p.page.file), 'utf8'));
  const known = new Set(base.lines);
  const own = new Set([normalizeText(base.primaryHeading), normalizeText(base.title)]);
  const extra = p.lines.filter((l) => l.length >= 3 && !known.has(l) && !isChrome(l) && !own.has(l));
  if (extra.length) results.push({ path: p.page.path, extra });
}

mkdirSync(path.dirname(out), { recursive: true });
const md = [
  `# Additions report`,
  ``,
  `Target: ${target}  |  baseline pages: ${index.pages.length}  |  pages with extra lines: ${results.length}`,
  `Lines on at least ${Math.round(chromeThreshold * 100)}% of pages were treated as theme chrome and omitted.`,
  `Informational only: extra content is normally harmless, but read it for leaked macros or stray text.`,
  ``,
  ...results.flatMap((r) => [`## ${r.path}  (${r.extra.length})`, ...r.extra.slice(0, 10).map((l) => `- ${l.slice(0, 200)}`), r.extra.length > 10 ? `- ... and ${r.extra.length - 10} more` : '', '']),
].join('\n');
writeFileSync(out, md);
writeFileSync(out.replace(/\.md$/, '.json'), JSON.stringify(results, null, 2) + '\n');

const nonOk = pages.filter((p) => p.status !== 200).length;
console.log(`${results.length} of ${ok.length} page(s) show lines the baseline did not record${nonOk ? `; ${nonOk} page(s) did not return 200` : ''}.`);
console.log(`Report: ${out}`);
