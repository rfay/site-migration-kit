#!/usr/bin/env node
// Has the ORIGINAL site changed since the baseline was frozen?
//
//   node kit/scripts/check-source-drift.mjs [--root <dir>]
//
// Re-reads every baseline page from the source site with the same selectors used at freeze time
// and compares the full record, including things the migration suite deliberately ignores:
// added lines, reordered lines, new images, new links, changed menus. Exit code 1 if anything
// differs. Use it before a migration starts (is the baseline still true?) and whenever the source
// might have been edited, so you can tell "the target is wrong" from "the source moved".

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractSource } from '../lib/extract.mjs';

const argv = process.argv.slice(2);
const rootArg = argv.indexOf('--root');
const root = path.resolve(rootArg >= 0 ? argv[rootArg + 1] : process.cwd());
const config = (await import(pathToFileURL(path.join(root, 'migration.config.mjs')).href)).default;
const baseUrl = config.source.baseUrl.replace(/\/$/, '');
const index = JSON.parse(readFileSync(path.join(root, 'baseline/semantic/index.json'), 'utf8'));

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const drifted = [];

for (const p of index.pages) {
  const pageUrl = `${baseUrl}/${p.path.replace(/^\/+/, '')}`;
  const res = await fetch(pageUrl, { redirect: 'follow' });
  if (res.status !== 200) {
    drifted.push({ path: p.path, notes: [`status ${res.status}, baseline had 200`] });
    continue;
  }
  const extract = p.type === 'route' ? { ...config.extract, content: config.extract.routeContent ?? ['main'] } : config.extract;
  const now = extractSource(await res.text(), { pageUrl, baseUrl, extract });
  const was = JSON.parse(readFileSync(path.join(root, 'baseline/semantic', p.file), 'utf8'));

  const notes = [];
  const wasSet = new Set(was.lines);
  const nowSet = new Set(now.lines);
  const added = now.lines.filter((l) => !wasSet.has(l));
  const removed = was.lines.filter((l) => !nowSet.has(l));
  if (added.length) notes.push(`${added.length} line(s) added, e.g. "${added[0].slice(0, 80)}"`);
  if (removed.length) notes.push(`${removed.length} line(s) removed, e.g. "${removed[0].slice(0, 80)}"`);
  if (!added.length && !removed.length && !same(now.lines, was.lines)) notes.push('same lines, different order');
  if (now.primaryHeading !== was.primaryHeading) notes.push('heading changed');
  if (!same(now.images, was.images)) notes.push('images changed');
  if (!same(now.links, was.links)) notes.push('links changed');
  if (!same(now.menus, was.menus)) notes.push('menus changed');
  if (notes.length) drifted.push({ path: p.path, notes });
}

if (!drifted.length) {
  console.log(`No drift: all ${index.pages.length} baseline page(s) still read exactly as frozen (${index.generatedAt}).`);
  process.exit(0);
}
console.log(`DRIFT: ${drifted.length} of ${index.pages.length} page(s) differ from the baseline frozen ${index.generatedAt}:`);
for (const d of drifted.slice(0, 50)) console.log(`  ${d.path}: ${d.notes.join('; ')}`);
if (drifted.length > 50) console.log(`  ... and ${drifted.length - 50} more`);
process.exit(1);
