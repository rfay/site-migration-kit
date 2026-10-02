#!/usr/bin/env node
// Freeze what the ORIGINAL site shows into <site>/baseline/semantic/. Run once, before any
// migration, from the site's test directory:
//
//   node kit/scripts/export-semantic-baseline.mjs [--root <dir>]
//
// <root> (default: current directory) must contain migration.config.mjs. Output:
//
//   baseline/semantic/pages/*.json   one record per page: title, content lines, images,
//                                    links, menus (see lib/extract.mjs)
//   baseline/semantic/index.json     page list, tags, counts, the set of paths the baseline
//                                    knows about, and internal links that point elsewhere
//
// Treat the committed, git-tagged output as read-only once a migration starts. Pipelines must
// never regenerate it, or they quietly redefine "correct".

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractSource, linkKey } from '../lib/extract.mjs';

const argv = process.argv.slice(2);
const rootArg = argv.indexOf('--root');
const root = path.resolve(rootArg >= 0 ? argv[rootArg + 1] : process.cwd());
const config = (await import(pathToFileURL(path.join(root, 'migration.config.mjs')).href)).default;

const baseUrl = config.source.baseUrl.replace(/\/$/, '');
const baseOrigin = new URL(baseUrl).origin;
const outDir = path.join(root, 'baseline', 'semantic');
const pagesDir = path.join(outDir, 'pages');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(pagesDir, { recursive: true });

const items = await config.listContent({ root });
const assetUrls = (await config.listAssets?.({ root })) ?? [];

const safeName = (p) => (p || 'home').replace(/\//g, '__').replace(/[^a-zA-Z0-9_.-]/g, '_') + '.json';
const keyOf = (p) => p.replace(/^\/+/, '').replace(/\/+$/, '');

const knownPaths = new Set();
for (const it of items) for (const p of it.paths) knownPaths.add(keyOf(p));
for (const u of assetUrls) knownPaths.add(keyOf(decodeURIComponent(u)));

const pages = [];
const internalLinkUses = new Map();
const menuKeys = new Set();
const totals = { lines: 0, images: 0, links: 0, menuItems: 0 };
const byType = {};
let skipped = 0;

for (const it of items) {
  if (!it.published) continue;
  for (const p of it.paths) {
    const pageUrl = `${baseUrl}/${keyOf(p)}`;
    const res = await fetch(pageUrl, { redirect: 'follow' });
    if (res.status !== 200) {
      console.warn(`  WARNING: ${p} (${it.id}) returned ${res.status}, expected 200; not in baseline.`);
      skipped++;
      continue;
    }
    const rec = extractSource(await res.text(), { pageUrl, baseUrl, extract: config.extract });
    if (!rec.contentFound) {
      console.warn(`  WARNING: ${p} (${it.id}): content selector matched nothing; recorded empty.`);
    }
    const file = `pages/${safeName(p)}`;
    writeFileSync(path.join(outDir, file), JSON.stringify(rec, null, 2) + '\n');
    pages.push({ path: p, id: it.id, type: it.type, title: it.title, tags: it.tags ?? [], file });

    totals.lines += rec.lines.length;
    totals.images += rec.images.length;
    totals.links += rec.links.length;
    totals.menuItems += Object.values(rec.menus).reduce((n, m) => n + m.length, 0);
    for (const m of Object.values(rec.menus)) for (const item of m) menuKeys.add(item.key);
    byType[it.type] = (byType[it.type] ?? 0) + 1;
    for (const l of rec.links) {
      if (!l.internal || knownPaths.has(l.key)) continue;
      const u = internalLinkUses.get(l.key) ?? { count: 0, from: [] };
      u.count++;
      if (u.from.length < 3) u.from.push(p);
      internalLinkUses.set(l.key, u);
    }
  }
}

// Routes that are not content nodes but are part of what a visitor navigates: listing pages,
// taxonomy pages, the home page, menu targets. They are discovered from the links and menus
// of the pages above (the content listing alone cannot know about them), fetched, and
// captured as baseline pages of type "route". Per-site config can exclude patterns such as
// comment permalinks. Everything else that does not return 200 is recorded, not tested.
const excludeRoutes = (config.discover?.exclude ?? []).map((r) => new RegExp(r));
const candidates = new Set([...internalLinkUses.keys(), ...[...menuKeys].filter((k) => !knownPaths.has(k))]);
const unmappedLinks = [];
const routes = [];
for (const key of [...candidates].sort()) {
  const uses = internalLinkUses.get(key) ?? { count: 0, from: [] };
  let status = null;
  try {
    status = (await fetch(`${baseOrigin}/${key}`, { redirect: 'manual' })).status;
  } catch {
    status = 'error';
  }
  const skip = key.includes('?') || excludeRoutes.some((r) => r.test(key));
  if (status === 200 && !skip) {
    const pageUrl = `${baseUrl}/${key}`;
    const res = await fetch(pageUrl, { redirect: 'follow' });
    const rec = extractSource(await res.text(), {
      pageUrl, baseUrl, extract: { ...config.extract, content: config.extract.routeContent ?? ['main'] },
    });
    const file = `pages/route__${safeName(key)}`;
    writeFileSync(path.join(outDir, file), JSON.stringify(rec, null, 2) + '\n');
    pages.push({ path: key, id: `route:${key}`, type: 'route', title: rec.primaryHeading, tags: ['route'], file });
    routes.push(key);
    knownPaths.add(key);
    byType.route = (byType.route ?? 0) + 1;
    totals.lines += rec.lines.length;
    totals.images += rec.images.length;
    totals.links += rec.links.length;
  } else if (status !== 200) {
    unmappedLinks.push({ key, status, uses: uses.count, from: uses.from });
  }
}
unmappedLinks.sort((a, b) => b.uses - a.uses);

const index = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  counts: { pages: pages.length, skipped, byType, ...totals, discoveredRoutes: routes.length, brokenOrRestrictedLinks: unmappedLinks.length },
  pages,
  assets: assetUrls,
  knownPaths: [...knownPaths].sort(),
  brokenOrRestrictedLinks: unmappedLinks,
};
writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');

console.log(`Semantic baseline: ${pages.length} page(s), ${totals.lines} lines, ${totals.images} images, ${totals.links} links, ${totals.menuItems} menu items.`);
console.log(`By type: ${JSON.stringify(byType)}`);
console.log(`Discovered ${routes.length} listing/menu route(s) beyond the content list.`);
console.log(`Internal links that are broken or restricted on the source: ${unmappedLinks.length} (index.json "brokenOrRestrictedLinks").`);
if (skipped) console.log(`Skipped ${skipped} path(s) that did not return 200.`);
console.log(`Wrote ${outDir}`);
