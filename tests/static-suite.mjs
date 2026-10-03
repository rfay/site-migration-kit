// The static self-containment tier: a retired site must not link to anything that is not static.
//
// For every baseline page, every URL the page refers to (links, images, scripts, stylesheets,
// frames, forms; head and body) is classified, and a page fails if it refers to:
//
//   1. the SOURCE site (or any host in config.static.forbiddenHosts, such as the prepared copy the
//      crawl was taken from), or the site's own public domain (config.ownDomains), which an archive
//      must reach by a relative URL. The archive would depend on a site that is about to disappear.
//   2. a dead internal URL: one on the target's own origin that does not resolve. Unless the
//      original already had that reference dead or restricted (recorded in the baseline), in which
//      case it must stay that way, because we reproduce the site rather than repair it.
//   3. an external URL that the original page did not itself refer to. A link out of the site is
//      fine when the original made it explicitly (drupal.org, a hardcoded production domain...).
//      A new one means something non-static crept in.
//
// A reviewed difference can be listed in expected-differences.json with kind "static".
//
// Site wrapper (tests/static.spec.ts):
//   import { test, expect } from '@playwright/test';
//   import config from '../migration.config.mjs';
//   import { registerStaticSuite } from '../kit/tests/static-suite.mjs';
//   registerStaticSuite({ test, expect, config, root: new URL('..', import.meta.url).pathname });
//
//   ddev playwright test --grep "static:"
//
// Config: static: { forbiddenHosts: ['randyfay-prep.ddev.site'] }

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { extractReferences, externalKey, internalKey } from '../lib/references.mjs';
import { hostKey, ownHostSet } from '../lib/extract.mjs';
import { applyExpectedDifferences } from '../lib/compare.mjs';

export function registerStaticSuite({ test, expect, config, root }) {
  const dir = path.join(root, 'baseline', 'semantic');
  const index = JSON.parse(readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const allowFile = path.join(root, config.expectedDifferences ?? 'expected-differences.json');
  const allow = existsSync(allowFile) ? JSON.parse(readFileSync(allowFile, 'utf8')).entries ?? [] : [];

  const sourceHost = new URL(config.source.baseUrl).host;
  const forbidden = new Set([sourceHost, ...(config.static?.forbiddenHosts ?? [])]);
  // Hosts that ARE this site (config.ownDomains). A link to one should be relative in an archive.
  const ownHosts = ownHostSet(config.ownDomains ?? []);

  // Resolution results are shared by every test in a worker: stylesheets and scripts repeat on
  // every page, and each should be fetched once.
  const resolved = new Map();

  for (const page of index.pages) {
    const tags = [...new Set([`@${page.type}`, ...page.tags.map((t) => `@${t}`)])];
    test(`static: ${page.path} (${page.id}) ${tags.join(' ')}`, async ({ request, baseURL }) => {
      const target = new URL(baseURL);
      const pageUrl = new URL(page.path.replace(/^\/+/, ''), baseURL.replace(/\/?$/, '/')).href;
      const res = await request.get(pageUrl);
      const diffs = [];
      if (res.status() !== 200) {
        diffs.push({ kind: 'status', item: `expected 200, got ${res.status()}` });
      } else {
        const base = JSON.parse(readFileSync(path.join(dir, page.file), 'utf8'));
        const originalExternal = new Set(base.references?.external ?? []);
        const originalDead = new Set((base.references?.internalNonOk ?? []).map((x) => x.key));
        // When the target IS the source (a self-check), its own host is not a leak.
        const leakHosts = new Set([...forbidden].filter((h) => h !== target.host));

        const seen = new Set();
        for (const r of extractReferences(await res.text(), pageUrl, target.origin)) {
          const id = `${r.url.href}`;
          if (seen.has(id)) continue;
          seen.add(id);

          const ownLeak = ownHosts.has(hostKey(r.url.hostname)) && hostKey(r.url.hostname) !== hostKey(target.hostname);
          if (ownLeak) {
            diffs.push({ kind: 'static', item: `refers to the site's own public domain (should be relative), <${r.tag} ${r.attr}>: ${r.url.href}` });
            continue;
          }
          if (leakHosts.has(r.url.host)) {
            diffs.push({ kind: 'static', item: `refers to the source site, <${r.tag} ${r.attr}>: ${r.url.href}` });
            continue;
          }
          if (!r.internal) {
            if (!originalExternal.has(externalKey(r.url))) {
              diffs.push({ kind: 'static', item: `links outside the site where the original did not, <${r.tag} ${r.attr}>: ${r.url.href}` });
            }
            continue;
          }
          let status = resolved.get(r.url.href);
          if (status === undefined) {
            status = (await request.get(r.url.href)).status();
            resolved.set(r.url.href, status);
          }
          if (status < 200 || status >= 400) {
            if (originalDead.has(internalKey(r.url))) continue; // dead on the original too: kept as it was
            diffs.push({ kind: 'static', item: `dead internal reference (${status}), <${r.tag} ${r.attr}>: ${internalKey(r.url)}` });
          }
        }
      }

      const { unexpected, allowed } = applyExpectedDifferences(page.path, diffs, allow);
      for (const a of allowed) {
        test.info().annotations.push({ type: 'expected-difference', description: `${a.kind}: ${a.item} (${a.reason})` });
      }
      const shown = unexpected.slice(0, 12).map((d) => `  [${d.kind}] ${String(d.item).slice(0, 220)}`).join('\n');
      const more = unexpected.length > 12 ? `\n  ... and ${unexpected.length - 12} more` : '';
      expect(unexpected, `${unexpected.length} non-static reference(s) on ${page.path}:\n${shown}${more}`).toEqual([]);
    });
  }
}
