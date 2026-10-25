// The layout tier: is the page laid out in the same ballpark as the original?
//
// Words are checked by the semantic and visible tiers. This tier checks where things are and what they look
// like, with numbers measured from the original (see lib/layout.mjs): the content column's position, whether a
// sidebar exists and on which side, the header band's colour, text and link colours, fonts. Tolerances are wide:
// it is meant to catch significant differences, not pixels. Differences a human accepted go in
// expected-differences.json with kind "layout" (and a target, so static and Drupal 11 can differ).
//
//   ddev exec -d /var/www/html/test/playwright 'npx playwright test --grep "layout:"'
//
// Site wrapper (tests/layout.spec.ts):
//   import { test, expect } from '@playwright/test';
//   import config from '../migration.config.mjs';
//   import { registerLayoutSuite } from '../kit/tests/layout-suite.mjs';
//   registerLayoutSuite({ test, expect, config, root: new URL('..', import.meta.url).pathname });

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { applyExpectedDifferences } from '../lib/compare.mjs';
import { compareLayout, measurePage, VIEWPORT } from '../lib/layout.mjs';
import { blockHosts } from '../lib/browser.mjs';

export function registerLayoutSuite({ test, expect, config, root }) {
  const sem = path.join(root, 'baseline', 'semantic');
  const file = path.join(root, 'baseline', 'layout', 'layout.json');
  const index = JSON.parse(readFileSync(path.join(sem, 'index.json'), 'utf8'));
  const layout = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { pages: {} };
  const allowFile = path.join(root, config.expectedDifferences ?? 'expected-differences.json');
  const allow = existsSync(allowFile) ? JSON.parse(readFileSync(allowFile, 'utf8')).entries ?? [] : [];

  test.use({ viewport: VIEWPORT });
  for (const page of index.pages) {
    if (!layout.pages[page.path]) continue; // not measurable on the original (not served): nothing to compare
    const tags = [...new Set([`@${page.type}`, ...page.tags.map((t) => `@${t}`)])];
    test(`layout: ${page.path} (${page.id}) ${tags.join(' ')}`, async ({ page: browserPage, baseURL }) => {
      const url = new URL(page.path.replace(/^\/+/, ''), baseURL.replace(/\/?$/, '/')).href;
      await blockHosts(browserPage, config.browser?.blockHosts);
      const response = await browserPage.goto(url, { waitUntil: 'load' });
      const diffs = [];
      if (!response || response.status() !== 200) {
        diffs.push({ kind: 'status', item: `expected 200, got ${response?.status()}` });
      } else {
        const base = JSON.parse(readFileSync(path.join(sem, page.file), 'utf8'));
        diffs.push(...compareLayout(layout.pages[page.path], await measurePage(browserPage, base), config.layout?.tolerances));
      }
      const { unexpected, allowed } = applyExpectedDifferences(page.path, diffs, allow);
      for (const a of allowed) {
        test.info().annotations.push({ type: 'expected-difference', description: `${a.kind}: ${a.item} (${a.reason})` });
      }
      const report = unexpected.map((d) => `  [${d.kind}] ${String(d.item).slice(0, 200)}`).join('\n');
      expect(unexpected, `layout differs from the original on ${page.path}:\n${report}`).toEqual([]);
    });
  }
}
