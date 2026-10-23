# AGENTS.md

site-migration-kit is the **method** for testing a website migration, not any one site: the extractor
and test suites, export and crawl scripts, templates, and the docs that record what each technique
does and what it found. Site repos vendor it. (`templates/AGENTS.md.example` is the template for a
*site's* agent instructions; this file is for working on the kit itself.)

## Layout

| Path | What |
|---|---|
| `lib/` | extraction and comparison: `extract.mjs`, `compare.mjs`, `layout.mjs`, `references.mjs`, `stored.mjs` |
| `tests/` | the tier suites a site's spec files hand off to (`semantic`, `visible`, `layout`, `static`, `stored`) |
| `scripts/` | baseline exporters, `mirror-static.mjs`, `rewrite-static.mjs`, `serve-static.mjs`, `vendor-into.sh`, and more |
| `templates/` | files a site copies: `migration.config.example.mjs`, `static-urls.nginx.conf`, agent and hook templates |
| `docs/` | one page per technique or tier, with the measured results and dated lessons from real sites |
| `webinar/PLAN.md` | run sheets and timings for the Hobobiker Rides Again series |

## How a change reaches a site

1. Change the kit here. **If a site needed anything beyond its `migration.config.*`, that is a kit
   gap:** fix it here rather than in the site.
2. Commit (only when asked). The maintainer pushes.
3. Vendor it: `scripts/vendor-into.sh <site>/test/playwright <ref>`. It replaces the site's `kit/`
   wholesale and writes `kit/KIT_VERSION`. Vendor a pushed commit, so `KIT_VERSION` names one that
   exists on GitHub.
4. Never edit `kit/` inside a site repo.

There is no test runner in this repo. Verify a change by vendoring it into a site and running that
site's suite against the original (self-check) and against a target, including a negative control:
break a copy on purpose and confirm the right tier names it. Site checkouts on this workspace:
`~/workspace/randyfay` (Backdrop) and `~/workspace/hobo/hobobiker-copy` (Drupal 6). Their
`DISCOVERIES.md` files hold the site-specific findings.

## Writing docs

- Record what was measured, on which site, and when: counts, timings, and the date. Update a
  number when it is re-measured; don't leave two versions standing.
- Say what is unverified. A claim tested on one site says so.
- Credit outside sources by name with links (for example Karen Stevenson's retirement series in
  `docs/retirement-approach.md`).
- Plain, direct language: no marketing words, no praise, no filler.

## Safety

The sites this kit runs against are disposable copies. It must never request a production domain:
the suite resolves a site's own domains (`config.ownDomains`) against the target under test. See
`docs/safe-demo-environment.md` before working on a new site.

## Git

`origin` is github.com/rfay/site-migration-kit. Commit only when asked, never push.
