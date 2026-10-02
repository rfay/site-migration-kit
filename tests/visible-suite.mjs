// The visible-text tier: in a real browser, is every line of baseline content actually VISIBLE?
//
// The semantic tier reads the HTML, so text hidden by CSS, text only a script would add, and text
// a script removes all look the same to it. This tier loads each page in Chromium and reads
// `innerText`, which is what a visitor can read: hidden elements are excluded and scripts have run.
//
// It is slower than the semantic tier (a browser page per baseline page), so it is opt-in:
//
//   ddev playwright test --grep "visible:"
//   ddev playwright test --grep "visible:.*@smoke"       # a quick sample
//
// Comparison is case-insensitive because innerText applies CSS text-transform (an all-caps
// heading in the theme would otherwise look different from the stored text).
//
// Site wrapper (tests/visible.spec.ts):
//   import { test, expect } from '@playwright/test';
//   import config from '../migration.config.mjs';
//   import { registerVisibleSuite } from '../kit/tests/visible-suite.mjs';
//   registerVisibleSuite({ test, expect, config, root: new URL('..', import.meta.url).pathname });

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { normalizeText } from '../lib/extract.mjs';
import { applyExpectedDifferences } from '../lib/compare.mjs';

export function registerVisibleSuite({ test, expect, config, root }) {
  const dir = path.join(root, 'baseline', 'semantic');
  const index = JSON.parse(readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const allowFile = path.join(root, config.expectedDifferences ?? 'expected-differences.json');
  const allow = existsSync(allowFile) ? JSON.parse(readFileSync(allowFile, 'utf8')).entries ?? [] : [];

  for (const page of index.pages) {
    const tags = [...new Set([`@${page.type}`, ...page.tags.map((t) => `@${t}`)])];
    test(`visible: ${page.path} (${page.id}) ${tags.join(' ')}`, async ({ page: browserPage, baseURL }) => {
      const url = new URL(page.path.replace(/^\/+/, ''), baseURL.replace(/\/?$/, '/')).href;
      const response = await browserPage.goto(url, { waitUntil: 'load' });
      const diffs = [];
      if (!response || response.status() !== 200) {
        diffs.push({ kind: 'status', item: `expected 200, got ${response?.status()}` });
      } else {
        const visible = normalizeText(await browserPage.locator('body').innerText()).toLowerCase();
        const base = JSON.parse(readFileSync(path.join(dir, page.file), 'utf8'));
        const seen = new Set();
        for (const line of base.lines) {
          if (seen.has(line)) continue;
          seen.add(line);
          if (!visible.includes(line.toLowerCase())) diffs.push({ kind: 'visible', item: line });
        }
      }
      const { unexpected, allowed } = applyExpectedDifferences(page.path, diffs, allow);
      for (const a of allowed) {
        test.info().annotations.push({ type: 'expected-difference', description: `${a.kind}: ${a.item} (${a.reason})` });
      }
      const report = unexpected.map((d) => `  [${d.kind}] ${String(d.item).slice(0, 200)}`).join('\n');
      expect(unexpected, `baseline text not visible on ${page.path}:\n${report}`).toEqual([]);
    });
  }
}
