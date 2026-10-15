// The stored-content tier: the target's DATABASE must not lose what the original's held, including
// content that never rendered (comments behind a disabled module, nodes whose module is gone,
// unpublished pages). See docs/stored-tier.md and lib/stored.mjs.
//
// Compares baseline/stored.json with an export of the TARGET's database in the same form, named by
// STORED_TARGET_EXPORT (a path as the test process sees it). Fails only when MIGRATION_TARGET is one
// of config.stored.enforceFor (default ['drupal11']). For any other target, differences are reported
// as annotations: a static archive may legitimately leave stored-only content behind.
//
// Site wrapper (tests/stored.spec.ts):
//   import { test, expect } from '@playwright/test';
//   import config from '../migration.config.mjs';
//   import { registerStoredSuite } from '../kit/tests/stored-suite.mjs';
//   registerStoredSuite({ test, expect, config, root: new URL('..', import.meta.url).pathname });
//
//   ddev exec -d /var/www/html/test/playwright \
//     'STORED_TARGET_EXPORT=tmp/stored-target.json MIGRATION_TARGET=drupal11 npx playwright test --grep "stored:"'

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { applyExpectedDifferences } from '../lib/compare.mjs';
import { compareNode, compareComment } from '../lib/stored.mjs';

export function registerStoredSuite({ test, expect, config, root }) {
  const baselineFile = path.join(root, 'baseline', 'stored.json');
  if (!existsSync(baselineFile)) return;
  const base = JSON.parse(readFileSync(baselineFile, 'utf8'));
  const targetFile = process.env.STORED_TARGET_EXPORT;
  const target = targetFile && existsSync(targetFile) ? JSON.parse(readFileSync(targetFile, 'utf8')) : null;
  const enforce = (config.stored?.enforceFor ?? ['drupal11']).includes(process.env.MIGRATION_TARGET);
  const allowFile = path.join(root, config.expectedDifferences ?? 'expected-differences.json');
  const allow = existsSync(allowFile) ? JSON.parse(readFileSync(allowFile, 'utf8')).entries ?? [] : [];

  // Report or fail: unexpected differences fail only for an enforced target.
  const judge = (where, diffs) => {
    const { unexpected, allowed } = applyExpectedDifferences(where, diffs, allow);
    for (const a of allowed) test.info().annotations.push({ type: 'expected-difference', description: `${a.kind}: ${a.item} (${a.reason})` });
    if (!enforce) {
      for (const u of unexpected) test.info().annotations.push({ type: 'stored-difference (not enforced)', description: `${u.kind}: ${u.item}` });
      return;
    }
    const report = unexpected.map((d) => `  [${d.kind}] ${String(d.item).slice(0, 200)}`).join('\n');
    expect(unexpected, `stored content differs on ${where}:\n${report}`).toEqual([]);
  };

  if (!target) {
    // For an enforced target a missing export must fail, not read as a pass. Otherwise the tier did not run.
    test('stored: target export is present @stored', () => {
      test.skip(!enforce, 'No STORED_TARGET_EXPORT given; stored-content tier not run.');
      expect(targetFile ? `${targetFile} does not exist` : 'STORED_TARGET_EXPORT is not set').toBe('a target export');
    });
    return;
  }

  const nodesBySource = new Map(target.nodes.map((n) => [String(n.sourceNid), n]));
  const commentsBySource = new Map(target.comments.map((c) => [String(c.sourceCid), c]));

  for (const n of base.nodes) {
    const tags = ['@stored', `@stored-${n.type || 'none'}`, n.published ? '' : '@draft'].filter(Boolean).join(' ');
    test(`stored: node ${n.sourceNid} (${n.type || 'no type'}) ${tags}`, () => {
      judge(`node/${n.sourceNid}`, compareNode(n, nodesBySource.get(n.sourceNid)));
    });
  }

  // One test per thread, so a lost thread is named once and a reviewer sees its size.
  const threads = new Map();
  for (const c of base.comments) (threads.get(c.sourceNid) ?? threads.set(c.sourceNid, []).get(c.sourceNid)).push(c);
  for (const [nid, cs] of threads) {
    test(`stored: comments on node ${nid} (${cs.length}) @stored @comments`, () => {
      judge(`node/${nid}`, cs.flatMap((c) => compareComment(c, commentsBySource.get(c.sourceCid))));
    });
  }

  test('stored: taxonomy terms @stored', () => {
    const have = new Set(target.terms.map((t) => `${t.vocabulary} / ${t.name}`));
    judge('taxonomy', base.terms.filter((t) => !have.has(`${t.vocabulary} / ${t.name}`)).map((t) => ({ kind: 'stored-term', item: `${t.vocabulary} / ${t.name}` })));
  });
}
