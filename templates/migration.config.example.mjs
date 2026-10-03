// Per-site configuration for site-migration-kit. This is the ONLY file that should differ
// between sites. Copy to <site>/test/playwright/migration.config.mjs and edit.
//
// If reusing the kit on a new site requires changing anything else, that is a gap in the
// kit: record it.

import { readFileSync } from 'node:fs';
import path from 'node:path';

export default {
  siteName: 'example.com',

  source: {
    // The original, pre-migration site as served locally. Used ONLY to freeze the baseline.
    baseUrl: process.env.BASELINE_BASE_URL ?? 'https://example.ddev.site',
  },

  // How to find the page's content on the ORIGINAL site. Target sites need no selectors.
  extract: {
    // Element holding the page's primary heading.
    title: 'h1',
    // First matching selector wins. Should be the main content, not the theme chrome.
    content: ['main article', 'main', '#content'],
    // Removed from the content before recording (scripts, styles, forms are always removed).
    ignore: [],
    // Named navigation blocks; every link in them is recorded and later required on the target.
    menus: { breadcrumb: 'nav.breadcrumb' },
  },

  // How to list the site's content. Return one item per node/page:
  //   { id, type, title, published, paths: ['blog/foo', 'node/12'], tags: ['smoke'] }
  // Source it from the database where you can (it is the truth about what exists), or from a
  // sitemap or crawl when you cannot.
  async listContent({ root }) {
    const manifest = JSON.parse(readFileSync(path.join(root, 'data', 'manifest.json'), 'utf8'));
    return manifest.nodes.map((n) => ({
      id: n.nid,
      type: n.type,
      title: n.title,
      published: n.published,
      paths: n.aliases,
      tags: [],
    }));
  },

  // Pagination and other query strings worth following during route discovery (anything else with a
  // query string is treated as dynamic), and paths to leave out entirely (comment permalinks).
  discover: { exclude: [], queryParams: ['page'] },

  // Hosts that ARE this site (its production domain, hardcoded into old content). Links to them are
  // internal links: recorded as such in the baseline and made relative in an archive.
  ownDomains: [],

  // For a static copy: hosts it must never refer to, besides the source (e.g. the prepared copy that was crawled).
  static: { forbiddenHosts: [] },

  // Optional: asset URLs (site-relative) so links to them count as "known" paths.
  async listAssets() {
    return [];
  },

  // Reviewed, deliberate differences. See expected-differences.example.json.
  expectedDifferences: 'expected-differences.json',
};
