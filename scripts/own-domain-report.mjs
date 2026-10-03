#!/usr/bin/env node
// Print the baseline's record of hardcoded references to the site's OWN public domain as a
// markdown section, for pasting into DISCOVERIES.md.
//
//   node kit/scripts/own-domain-report.mjs [--root <dir>]
//
// These are links and images in the original's content that point at the production domain by
// absolute URL (typically from an old editor). They are preserved as written, never rewritten. They
// matter for a retirement: left alone, each one makes the archive depend on the original domain still
// being served. config.ownDomains says they ARE this site, so the baseline treats them as internal links
// and rewrite-static.mjs makes them relative. Needs config.ownDomains at export time.

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
console.log('These are the site\'s own links: the production domain IS this site. The baseline records them as');
console.log('internal links, the crawl fetches what they point at, and the rewrite step makes them relative, so');
console.log('the archive no longer depends on that domain. Listed here because old content hardcoding a domain');
console.log('is worth knowing about, and because each target is checked to exist in the archive.');
console.log('');
console.log(`**Images (${own.images.length}): made relative; the images are fetched into the archive.**`);
console.log('');
own.images.forEach((r) => console.log(line(r)));
console.log('');
console.log(`**Links (${own.links.length}):**`);
console.log('');
own.links.forEach((r) => console.log(line(r)));
