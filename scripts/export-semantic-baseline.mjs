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

import { mkdirSync, writeFileSync, rmSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractSource, linkKey, ownHostSet, hostKey } from '../lib/extract.mjs';
import { extractReferences, externalKey, internalKey } from '../lib/references.mjs';

const argv = process.argv.slice(2);
const rootArg = argv.indexOf('--root');
const root = path.resolve(rootArg >= 0 ? argv[rootArg + 1] : process.cwd());
const config = (await import(pathToFileURL(path.join(root, 'migration.config.mjs')).href)).default;

const baseUrl = config.source.baseUrl.replace(/\/$/, '');
const baseOrigin = new URL(baseUrl).origin;
// config.ownDomains are hosts that ARE this site (its production domain, hardcoded into old content).
// Links to them are internal links, so they are recorded as such and the pages they point at are
// discovered like any other.
const ownHosts = ownHostSet(config.ownDomains ?? []);
// Write into a temporary directory and swap it in only when the whole export succeeded, so a
// failed run can never destroy the committed baseline.
const finalDir = path.join(root, 'baseline', 'semantic');
const outDir = `${finalDir}.new`;
const pagesDir = path.join(outDir, 'pages');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(pagesDir, { recursive: true });

const items = await config.listContent({ root });
const listedAssets = (await config.listAssets?.({ root })) ?? [];
// Only assets that actually resolve on the source count as "known". A file the database lists
// but the server 404s is already broken on the source site; fidelity means it stays that way,
// so links to it are recorded as broken rather than asserted.
const assetUrls = [];
const missingAssets = [];
for (const u of listedAssets) {
  let status = null;
  try {
    status = (await fetch(`${baseOrigin}${u}`, { redirect: 'manual' })).status;
  } catch {
    status = 'error';
  }
  (status === 200 ? assetUrls : missingAssets).push(status === 200 ? u : { url: u, status });
}

const safeName = (p) => (p || 'home').replace(/\//g, '__').replace(/[^a-zA-Z0-9_.-]/g, '_') + '.json';
const keyOf = (p) => p.replace(/^\/+/, '').replace(/\/+$/, '');

const knownPaths = new Set();
for (const it of items) for (const p of it.paths) knownPaths.add(keyOf(p));
for (const u of assetUrls) knownPaths.add(keyOf(decodeURIComponent(u)));


// What did the ORIGINAL explicitly refer to, anywhere on the page (not just the content region)?
// Recorded per page so a static target can be held to it: it may link outside the site only where
// the original did, and an internal reference may be dead only where it was already dead or
// restricted on the original. Statuses are looked up once per distinct reference.
const statusMemo = new Map();
async function statusOf(key) {
  if (!statusMemo.has(key)) {
    let st;
    try {
      st = (await fetch(`${baseOrigin}/${key}`, { redirect: 'manual' })).status;
    } catch {
      st = 'error';
    }
    statusMemo.set(key, st);
  }
  return statusMemo.get(key);
}
async function referencesOf(html, pageUrl) {
  const external = new Set();
  const internal = new Set();
  for (const r of extractReferences(html, pageUrl, baseOrigin, ownHosts)) {
    if (r.internal) internal.add(internalKey(r.url));
    else external.add(externalKey(r.url));
  }
  const internalNonOk = [];
  for (const key of internal) {
    const st = await statusOf(key);
    if (!(st >= 200 && st < 400)) internalNonOk.push({ key, status: st });
  }
  internalNonOk.sort((a, b) => a.key.localeCompare(b.key));
  return { external: [...external].sort(), internalNonOk };
}

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
    const html = await res.text();
    const rec = extractSource(html, { pageUrl, baseUrl, extract: config.extract, ownDomains: config.ownDomains });
    rec.references = await referencesOf(html, pageUrl);
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
// taxonomy pages, the home page, menu targets, and the pages of a paginated listing or comment
// thread. They are discovered from the links and menus of the pages above (the content listing
// alone cannot know about them), fetched, and captured as baseline pages of type "route".
//
// Discovery is transitive: a captured route's own links are followed too, which is how "page 2"
// of a listing is found from "page 1". A link with a query string is followed only when every
// parameter is named in config.discover.queryParams (for example ['page']); anything else with a
// query, such as a login redirect, is dynamic and skipped. config.discover.exclude holds patterns
// to skip entirely (comment permalinks). Whatever does not return 200 is recorded, not tested.
const excludeRoutes = (config.discover?.exclude ?? []).map((r) => new RegExp(r));
const allowedQuery = new Set(config.discover?.queryParams ?? []);
const eligibleQuery = (key) => {
  if (!key.includes('?')) return true;
  const params = [...new URLSearchParams(key.split('?')[1]).keys()];
  return params.length > 0 && params.every((k) => allowedQuery.has(k));
};
const queue = [...new Set([...internalLinkUses.keys(), ...[...menuKeys].filter((k) => !knownPaths.has(k))])].sort();
const queued = new Set(queue);
const unmappedLinks = [];
const routes = [];
const discoveredFiles = [];
while (queue.length) {
  const key = queue.shift();
  const uses = internalLinkUses.get(key) ?? { count: 0, from: [] };
  let status = null;
  try {
    status = (await fetch(`${baseOrigin}/${key}`, { redirect: 'manual' })).status;
  } catch {
    status = 'error';
  }
  const skip = !eligibleQuery(key) || excludeRoutes.some((r) => r.test(key));
  if (status === 200 && !skip) {
    const pageUrl = `${baseUrl}/${key}`;
    const res = await fetch(pageUrl, { redirect: 'follow' });
    // Only HTML is a page. Anything else that answers 200 (a PDF, a patch, a key file) is a file: it
    // joins the assets every target must be able to serve, and is never read as page content.
    if (!/html/i.test(res.headers.get('content-type') ?? '')) {
      assetUrls.push(`/${key}`);
      knownPaths.add(key);
      discoveredFiles.push(`/${key}`);
      continue;
    }
    const html = await res.text();
    const rec = extractSource(html, {
      pageUrl, baseUrl, extract: { ...config.extract, content: config.extract.routeContent ?? ['main'] }, ownDomains: config.ownDomains,
    });
    rec.references = await referencesOf(html, pageUrl);
    const file = `pages/route__${safeName(key)}`;
    writeFileSync(path.join(outDir, file), JSON.stringify(rec, null, 2) + '\n');
    pages.push({ path: key, id: `route:${key}`, type: 'route', title: rec.primaryHeading, tags: ['route'], file });
    routes.push(key);
    knownPaths.add(key);
    byType.route = (byType.route ?? 0) + 1;
    totals.lines += rec.lines.length;
    totals.images += rec.images.length;
    totals.links += rec.links.length;
    for (const l of rec.links) {
      if (!l.internal || knownPaths.has(l.key) || queued.has(l.key)) continue;
      queued.add(l.key);
      queue.push(l.key);
      internalLinkUses.set(l.key, { count: 1, from: [key] });
    }
  } else if (status !== 200) {
    unmappedLinks.push({ key, status, uses: uses.count, from: uses.from });
  }
}
unmappedLinks.sort((a, b) => b.uses - a.uses);

// Links and images that the original content deliberately points at its OWN public domain (for
// example hardcoded http://example.com/... URLs from an old editor). They are preserved exactly,
// and recorded here so a human can triage them: after a retirement they depend on the original
// domain still being served, which is a decision, not an accident. Set config.ownDomains.
const ownDomains = new Set((config.ownDomains ?? []).map((d) => d.toLowerCase().replace(/^www\./, '')));
const hostOf = (u) => {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
};
const ownLinks = new Map();
const ownImages = new Map();
if (ownDomains.size) {
  for (const p of pages) {
    const rec = JSON.parse(readFileSync(path.join(outDir, p.file), 'utf8'));
    for (const l of rec.links) if (l.own) (ownLinks.get(l.url) ?? ownLinks.set(l.url, new Set()).get(l.url)).add(p.path);
    for (const i of rec.images) if (i.src && ownDomains.has(hostOf(i.src))) (ownImages.get(i.src) ?? ownImages.set(i.src, new Set()).get(i.src)).add(p.path);
  }
}
const listOf = (m) => [...m.entries()].map(([url, ps]) => ({ url, pages: [...ps].sort() })).sort((a, b) => a.url.localeCompare(b.url));
const ownDomainReferences = { domains: [...ownDomains], links: listOf(ownLinks), images: listOf(ownImages) };

const index = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  counts: { pages: pages.length, skipped, assets: assetUrls.length, missingAssets: missingAssets.length, byType, ...totals, discoveredRoutes: routes.length, discoveredFiles: discoveredFiles.length, ownDomainLinks: ownDomainReferences.links.length, ownDomainImages: ownDomainReferences.images.length, brokenOrRestrictedLinks: unmappedLinks.length },
  pages,
  assets: assetUrls,
  missingAssets,
  knownPaths: [...knownPaths].sort(),
  brokenOrRestrictedLinks: unmappedLinks,
  ownDomainReferences,
};
writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');

console.log(`Semantic baseline: ${pages.length} page(s), ${totals.lines} lines, ${totals.images} images, ${totals.links} links, ${totals.menuItems} menu items.`);
console.log(`By type: ${JSON.stringify(byType)}`);
console.log(`Discovered ${routes.length} listing/menu route(s) beyond the content list.`);
if (ownDomains.size) console.log(`Hardcoded references to the site's own domain: ${ownDomainReferences.links.length} link target(s), ${ownDomainReferences.images.length} image source(s) (index.json \"ownDomainReferences\").`);
console.log(`Internal links that are broken or restricted on the source: ${unmappedLinks.length} (index.json "brokenOrRestrictedLinks").`);
if (skipped) console.log(`Skipped ${skipped} path(s) that did not return 200.`);
rmSync(finalDir, { recursive: true, force: true });
renameSync(outDir, finalDir);
console.log(`Wrote ${finalDir}`);
