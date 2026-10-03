#!/usr/bin/env node
// Freeze the ORIGINAL site's page layout measurements into <site>/baseline/layout/layout.json.
// Run after export-semantic-baseline.mjs (it needs that baseline's lines and regions), from the site's
// test directory, with Playwright available (inside the DDEV web container):
//
//   node kit/scripts/export-layout-baseline.mjs [--root <dir>]
//
// Each page is loaded once in Chromium at 1280 x 900 and measured by lib/layout.mjs.

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { measurePage, VIEWPORT } from '../lib/layout.mjs';

const argv = process.argv.slice(2);
const rootArg = argv.indexOf('--root');
const root = path.resolve(rootArg >= 0 ? argv[rootArg + 1] : process.cwd());
const config = (await import(pathToFileURL(path.join(root, 'migration.config.mjs')).href)).default;
const baseUrl = config.source.baseUrl.replace(/\/$/, '') + '/';
const dir = path.join(root, 'baseline', 'semantic');
const index = JSON.parse(readFileSync(path.join(dir, 'index.json'), 'utf8'));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: true });
const page = await context.newPage();
const pages = {};
let missing = 0;
for (const p of index.pages) {
  const base = JSON.parse(readFileSync(path.join(dir, p.file), 'utf8'));
  const res = await page.goto(new URL(p.path.replace(/^\/+/, ''), baseUrl).href, { waitUntil: 'load' });
  if (!res || res.status() !== 200) {
    missing++;
    continue;
  }
  pages[p.path] = await measurePage(page, base);
}
await browser.close();

const out = path.join(root, 'baseline', 'layout');
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'layout.json'), JSON.stringify({ generatedAt: new Date().toISOString(), viewport: VIEWPORT, pages }, null, 2) + '\n');
const withSidebar = Object.values(pages).filter((m) => m.sidebar).length;
console.log(`Layout baseline: ${Object.keys(pages).length} page(s), ${withSidebar} with a sidebar, ${missing} not served (skipped).`);
