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
import { extractSource, linkKey, ownHostSet, hostKey, responseHtml } from '../lib/extract.mjs';
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
// A key is a normalized, comparable form (no .html, no index.html, no trailing slash, decoded), so it
// is not always a URL the site answers: /maps/a.htm becomes maps/a, which 404s. Every key is mapped to
// the site-relative URL it was first seen as, and that URL is what gets requested. Without this, working
// links to .htm/.html files were recorded as broken.
const hrefOf = new Map();
const urlPathOf = (key) => hrefOf.get(key) ?? `/${key}`;
async function statusOf(key) {
  if (!statusMemo.has(key)) {
    let st;
    try {
      st = (await fetch(`${baseOrigin}${urlPathOf(key)}`, { redirect: 'manual' })).status;
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
    if (r.internal) {
      const key = internalKey(r.url);
      if (!hrefOf.has(key)) hrefOf.set(key, r.url.pathname + r.url.search);
      internal.add(key);
    }
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

// Internal images that do not load on the SOURCE (a relative src that resolves under the page path, a
// missing derivative) are already broken there. Each gets `broken: <status>`, so the suite does not
// demand that a target load what the original never did. Fidelity: broken stays broken.
const imageMemo = new Map();
async function markBrokenImages(rec, pageUrl) {
  for (const img of rec.images) {
    let u;
    try { u = new URL(img.src, pageUrl); } catch { continue; }
    const own = u.origin !== baseOrigin && ownHosts.has(hostKey(u.hostname));
    if (u.origin !== baseOrigin && !own) continue;
    const href = `${baseOrigin}${u.pathname}${u.search}`;
    if (!imageMemo.has(href)) {
      let st;
      try { st = (await fetch(href, { redirect: 'follow' })).status; } catch { st = 'error'; }
      imageMemo.set(href, st);
    }
    if (imageMemo.get(href) !== 200) img.broken = imageMemo.get(href);
  }
}

// config.discover.noFollow: [{ from: '<regex>', links: '<regex>' }]. On a page whose path matches
// `from`, links matching `links` are not followed. That bounds discovery where a site generates an
// unbounded or combinatorial link space: pages linked from elsewhere are still captured, but the
// walk stops at them (one hop). Links that are not followed are still recorded on the page.
const noFollow = (config.discover?.noFollow ?? []).map((r) => ({ from: new RegExp(r.from), links: new RegExp(r.links) }));
const followable = (fromKey, linkKey) => !noFollow.some((r) => r.from.test(fromKey) && r.links.test(linkKey));

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
    const html = await responseHtml(res);
    const rec = extractSource(html, { pageUrl, baseUrl, extract: config.extract, ownDomains: config.ownDomains });
    rec.references = await referencesOf(html, pageUrl);
    await markBrokenImages(rec, pageUrl);
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
    for (const m of Object.values(rec.menus)) for (const item of m) if (followable(keyOf(p), item.key)) menuKeys.add(item.key);
    byType[it.type] = (byType[it.type] ?? 0) + 1;
    for (const l of rec.links) {
      if (!l.internal || knownPaths.has(l.key) || !followable(keyOf(p), l.key)) continue;
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
    status = (await fetch(`${baseOrigin}${urlPathOf(key)}`, { redirect: 'manual' })).status;
  } catch {
    status = 'error';
  }
  const skip = !eligibleQuery(key) || excludeRoutes.some((r) => r.test(key));
  if (status === 200 && !skip) {
    const pageUrl = `${baseUrl}${urlPathOf(key)}`;
    const res = await fetch(pageUrl, { redirect: 'follow' });
    // Only HTML is a page. Anything else that answers 200 (a PDF, a patch, a key file) is a file: it
    // joins the assets every target must be able to serve, and is never read as page content.
    if (!/html/i.test(res.headers.get('content-type') ?? '')) {
      assetUrls.push(urlPathOf(key));
      knownPaths.add(key);
      discoveredFiles.push(urlPathOf(key));
      continue;
    }
    const html = await responseHtml(res);
    const rec = extractSource(html, {
      pageUrl, baseUrl, extract: { ...config.extract, content: config.extract.routeContent ?? ['main'] }, ownDomains: config.ownDomains,
    });
    rec.references = await referencesOf(html, pageUrl);
    await markBrokenImages(rec, pageUrl);
    const file = `pages/route__${safeName(key)}`;
    writeFileSync(path.join(outDir, file), JSON.stringify(rec, null, 2) + '\n');
    // A page reached through a .htm/.html URL is tested at that URL: its key without the suffix is not
    // something the original serves.
    const hrefPath = urlPathOf(key).split('?')[0];
    const pagePath = /\.html?$/i.test(hrefPath) ? decodeURIComponent(urlPathOf(key)).replace(/^\/+/, '') : key;
    pages.push({ path: pagePath, id: `route:${key}`, type: 'route', title: rec.primaryHeading, tags: ['route'], file });
    routes.push(key);
    knownPaths.add(key);
    byType.route = (byType.route ?? 0) + 1;
    totals.lines += rec.lines.length;
    totals.images += rec.images.length;
    totals.links += rec.links.length;
    totals.menuItems += Object.values(rec.menus).reduce((n, m) => n + m.length, 0);
    // A route's menus are followed as well as its links: a breadcrumb on a listing page can be the
    // only way to reach its parent listing (hobobiker's /audio, /audio/by, /wp, /triplog).
    const next = [...rec.links.filter((l) => l.internal).map((l) => l.key), ...Object.values(rec.menus).flat().map((m) => m.key)];
    for (const k of next) {
      if (knownPaths.has(k) || queued.has(k) || !followable(key, k)) continue;
      queued.add(k);
      queue.push(k);
      internalLinkUses.set(k, { count: 1, from: [key] });
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
