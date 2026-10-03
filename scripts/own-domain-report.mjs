#!/usr/bin/env node
// Print the baseline's record of hardcoded references to the site's OWN public domain as a
// markdown section, for pasting into DISCOVERIES.md.
//
//   node kit/scripts/own-domain-report.mjs [--root <dir>]
//
// These are links and images in the original's content that point at the production domain by
// absolute URL (typically from an old editor). They are preserved as written, never rewritten. They
// matter for a retirement: each one makes the archive depend on the original domain still being
// served (an <img> from it means a broken picture the day that domain goes away), which is a
// decision for a human, not a bug to fix mid-migration. Needs config.ownDomains at export time.

import { readFileSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const rootArg = argv.indexOf('--root');
const root = path.resolve(rootArg >= 0 ? argv[rootArg + 1] : process.cwd());
const idx = JSON.parse(readFileSync(path.join(root, 'baseline/semantic/index.json'), 'utf8'));
const own = idx.ownDomainReferences;
if (!own || !own.domains?.length) {
  console.error('No ownDomainReferences in the baseline. Set config.ownDomains and re-run the export.');
  process.exit(1);
}
const pages = new Set([...own.links, ...own.images].flatMap((r) => r.pages));
const name = (p) => (p === '' ? '(home)' : p);
const line = (r) => `- \`${r.url}\` (${r.pages.length} page${r.pages.length === 1 ? '' : 's'}: ${r.pages.slice(0, 3).map(name).join(', ')}${r.pages.length > 3 ? ', ...' : ''})`;

console.log(`### Hardcoded references to the site's own domain (${own.domains.join(', ')})`);
console.log('');
console.log(`Generated from \`baseline/semantic/index.json\` (frozen ${idx.generatedAt}) by \`kit/scripts/own-domain-report.mjs\`.`);
console.log(`${own.links.length} distinct link target(s) and ${own.images.length} distinct image source(s), on ${pages.size} page(s).`);
console.log('Preserved exactly as written: they are explicit choices of the original, so the static self-containment');
console.log('tier allows them. After a retirement each one depends on that domain still being served.');
console.log('');
console.log(`**Images (${own.images.length}): the archive shows a broken picture here if the domain goes away.**`);
console.log('');
own.images.forEach((r) => console.log(line(r)));
console.log('');
console.log(`**Links (${own.links.length}):**`);
console.log('');
own.links.forEach((r) => console.log(line(r)));
