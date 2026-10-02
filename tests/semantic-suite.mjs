// The semantic tier: one test per baseline page, checking that nothing the original site
// showed is missing from the target. Platform-independent; see docs/semantic-tier.md.
//
// A site's spec file is a thin wrapper:
//
//   import { test, expect } from '@playwright/test';
//   import config from '../migration.config.mjs';
//   import { registerSemanticSuite } from '../kit/tests/semantic-suite.mjs';
//   registerSemanticSuite({ test, expect, config, root: new URL('..', import.meta.url).pathname });
//
// Run all:      TEST_BASE_URL=<target> ddev playwright test tests/semantic.spec.ts
// A subset:     ... --grep @smoke        (or @<type>, or a path fragment)

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { extractTarget } from '../lib/extract.mjs';
import { compareSemantic, applyExpectedDifferences } from '../lib/compare.mjs';

export function registerSemanticSuite({ test, expect, config, root }) {
  const dir = path.join(root, 'baseline', 'semantic');
  const index = JSON.parse(readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const knownPaths = new Set(index.knownPaths);

  const allowFile = path.join(root, config.expectedDifferences ?? 'expected-differences.json');
  const allow = existsSync(allowFile) ? JSON.parse(readFileSync(allowFile, 'utf8')).entries ?? [] : [];

  // The baseline must cover every published path the site's own content listing reports. This
  // guards the baseline itself (a stale or partial export), independent of any target.
  test('semantic: baseline covers every published path @baseline-complete', async () => {
    const items = await config.listContent({ root });
    const have = new Set(index.pages.map((p) => p.path));
    const missing = [];
    for (const it of items) {
      if (!it.published) continue;
      for (const p of it.paths) if (!have.has(p)) missing.push(p);
    }
    expect(missing, 'published paths missing from the baseline').toEqual([]);
  });

  // Every file the baseline knows about must still resolve on the target. This is what catches
  // a linked file (a PDF, a download) that vanished even though the page still links to it:
  // the per-page checks verify that a link is present, not that its target exists.
  test('semantic: every baseline asset resolves @assets', async ({ request, baseURL }) => {
    const missing = [];
    for (const url of index.assets ?? []) {
      const r = await request.get(new URL(url.replace(/^\/+/, ''), baseURL.replace(/\/?$/, '/')).href);
      if (r.status() !== 200) missing.push(`${url} (${r.status()})`);
    }
    const entries = allow.filter((e) => e.kind === 'assets');
    const unexpected = missing.filter((m) => !entries.some((e) => !e.match || m.includes(e.match)));
    expect(unexpected, 'baseline assets that do not resolve on the target').toEqual([]);
  });

  for (const page of index.pages) {
    const tags = [...new Set([`@${page.type}`, ...page.tags.map((t) => `@${t}`)])];
    test(`semantic: ${page.path} (${page.id}) ${tags.join(' ')}`, async ({ request, baseURL }) => {
      const pageUrl = new URL(page.path.replace(/^\/+/, ''), baseURL.replace(/\/?$/, '/')).href;
      const res = await request.get(pageUrl);
      const baseRec = JSON.parse(readFileSync(path.join(dir, page.file), 'utf8'));

      const diffs = [];
      if (res.status() !== 200) {
        diffs.push({ kind: 'status', item: `expected 200, got ${res.status()}` });
      } else {
        const target = extractTarget(await res.text(), { pageUrl, baseUrl: baseURL });
        diffs.push(...compareSemantic(baseRec, target, { knownPaths }));

        // Baseline images must exist AND load on the target (internal ones; images hosted
        // elsewhere are only checked for presence, since the network is not part of the test).
        const origin = new URL(baseURL).origin;
        const checked = new Set();
        for (const img of baseRec.images) {
          if (checked.has(img.name)) continue;
          checked.add(img.name);
          const hit = target.images.find((t) => t.name === img.name);
          if (!hit) continue; // already reported by compareSemantic
          const abs = new URL(hit.src, pageUrl);
          if (abs.origin !== origin) continue;
          const r = await request.get(abs.href);
          if (r.status() !== 200) diffs.push({ kind: 'images', item: `${img.name} (does not load: ${r.status()})` });
        }
      }

      const { unexpected, allowed } = applyExpectedDifferences(page.path, diffs, allow);
      for (const a of allowed) {
        test.info().annotations.push({ type: 'expected-difference', description: `${a.kind}: ${a.item} (${a.reason})` });
      }
      const report = unexpected.map((d) => `  [${d.kind}] ${String(d.item).slice(0, 200)}`).join('\n');
      expect(unexpected, `differences from baseline on ${page.path}:\n${report}`).toEqual([]);
    });
  }
}
