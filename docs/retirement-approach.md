# Retiring a site to static HTML

One of the two migration paths in the series turns an old database-driven site into a folder of plain
HTML files: a retired, archived copy. This page records the approach, how the test suite applies to
it, and where the ideas come from.

## Credit and prior art

The idea of sending a Drupal site into retirement as static HTML, and most of the practical lessons
about doing it, come from a three-part series by **Karen Stevenson** at Lullabot. Please read the
originals; this page only summarizes the parts we lean on, and any mistakes in how we apply them are
ours.

1. [Sending a Drupal Site Into Retirement](https://www.lullabot.com/articles/sending-a-drupal-site-into-retirement):
   when retiring a site makes sense (expired event sites, rarely updated properties, old versions,
   outdated subsections), what to remove first, and the central problem: **URLs must change**.
2. [Sending a Drupal Site Into Retirement Using HTTrack](https://www.lullabot.com/articles/sending-drupal-site-retirement-using-httrack):
   spidering the site into static files, the settings that matter, and what to clean up. Best for a
   one-time export.
3. [Sending a Drupal Site into Retirement Using the Static Generation Module](https://www.lullabot.com/articles/sending-drupal-site-retirement-using-static-generation-module):
   generating the files from inside Drupal. Better for a site that will keep being maintained; the
   article notes its URL format does not suit GitHub Pages.

The articles are about Drupal 7 and hosting on GitHub Pages. We use the same thinking on other
platforms (Backdrop, Drupal 6) and serve the result differently (below), so check the details against
the originals before copying a command.

## What we take from them

| Lesson (from the series) | How it shows up here |
|---|---|
| Decide first whether the original site stays around or is fully decommissioned | The baseline is captured while the original still runs, and the drift check tells you if it moved |
| Remove what cannot work statically: forms, search, comments, AJAX, login blocks | These become reviewed entries in `expected-differences.json`, so each removal is a recorded decision, not a failed test |
| URLs must change (`/news` becomes `/news.html` or `/news/index.html`) | The checks treat `/a/b`, `/a/b/`, `/a/b.html` and `/a/b/index.html` as the same page, so a legitimate change of URL form does not fail anything |
| Broken internal links and missing images produce junk 404 pages | The baseline records links and files that are already broken on the original and expects them to stay as they were; links to files that exist must still resolve |
| Short links create duplicate `/node/N` pages | This site has both `node/N` and an alias for the same page. The baseline captures both paths, and the plan must decide whether the archive keeps the duplicates or redirects them |
| Old URLs should still work (redirects) | Not modeled yet. The semantic tier checks that every captured path resolves, so a missing redirect shows up as a missing page |
| HTTrack for a one-time export, the Static Generator module for ongoing maintenance | A retired site is the one-time case; for that, a crawl-based export is the natural fit |

## The plan for this series: three sites

The series recommends changing the site before it is turned into HTML: removing forms, search,
comments, AJAX and login blocks, and stripping shortlinks. That means the crawl must read a working
dynamic site that has been *prepared*, and the original must stay untouched, because it is the source
of truth for the baseline and for the drift check. So there are three DDEV projects, side by side on
the same Coder workspace:

| Site | Role | Rule |
|---|---|---|
| `randyfay` (the original) | Where the baseline is captured. The reference. | Never modified by the retirement work |
| `randyfay-prep` | A throwaway copy where the series' preparation changes are applied | Always rebuilt from a pristine restore, so the prep is a script that can be re-run |
| `randyfay-static` | The exported HTML, served as a static site | Its docroot is a subdirectory (`public/`), filled by the crawl |

The pipeline, in one direction:

1. **Restore** `randyfay-prep` from a pristine dump of the original (database and files).
2. **Prepare** it with committed scripts, one per change from the series (disable comments, remove
   forms and search blocks, strip shortlinks, and so on). Each script reports a count, so a script that
   changed 40 things yesterday and 0 today says something broke.
3. **Crawl** `randyfay-prep` into `randyfay-static/public/` with HTTrack or `wget`.
4. **Check** `randyfay-static` against the baseline captured from the original, with the semantic,
   visible-text, access and asset checks, and a negative control.
5. **Review** every failure. Early ones are usually gaps in the baseline or the crawl, not content loss.
   A removal that came from a prep script is declared in `expected-differences.json` with the reason, so
   the preparation decisions and the allowed differences stay in step.

Why a third site rather than editing the original: the prep changes are deliberate losses (comments,
forms, search) that would otherwise contaminate the reference, and a prep site that is rebuilt from a
restore every time cannot drift into an unreproducible state.

### Built and run on randyfay.com's development copy (2026-10-02)

The pipeline exists as committed scripts in that site's repository (`retire/`): snapshot the pristine
database from the original once, then `run.sh` restores the prep copy, prepares it, crawls it into the
static project, rewrites it, and verifies. The whole run takes about 55 seconds and ends with **860 passing checks**
(266 semantic, 264 visible-text, 40 access, 26 asset, 264 static self-containment).

What we learned, in the order it happened:

1. **A no-preparation control run first.** Crawling the prep copy with no changes passed 490 of 490
   semantic and visible checks. A faithful crawl loses nothing, so any later failure is caused by a
   deliberate prep change. This is worth doing before writing a single prep script.
2. **Survey the site's own data before choosing prep steps; don't apply the generic list.** On this
   site the series' checklist reduced to two steps. There was no shortlink tag to strip. The only form
   was the search block. And 114 of 126 nodes already had comments closed: 670 comments (real content,
   up to 55 on one page) were being shown read-only, so "disable comments" would have deleted content.
   The prep step *closes* the 12 still-open threads instead, which keeps every comment's text.
3. **The checks caught a prep side effect we had not thought of.** Removing the search block removed its
   heading, "Search", from 28 listing pages (the baseline captures a listing page's whole main region).
   It is the only difference the preparation causes, and it is recorded as one reviewed entry.
4. **The access tier needed a per-target decision.** A static archive has no unpublished pages, so they
   answer 404 where the original answered 403. A missing page is as private as a 403, but accepting 404
   everywhere would weaken the check on a Drupal 11 target. Expected-differences entries can now be
   scoped with `"target": "static"`, applied only when the run sets `MIGRATION_TARGET=static`. A private
   page that *leaks* into the archive still fails ("expected 403, got 200").
5. **Entries should be as narrow as their reason.** `equals` matches a whole line and `kind` can be a
   list, so the "Search" decision cannot quietly hide a different line or a different kind of difference.

6. **The crawl was not self-contained, and the content checks could not see it.** 4,084 references on 242 of
   244 pages still pointed at the crawled site (comment permalinks, login links, feeds). A new tier now fails
   any page that refers to the source site, a dead internal URL, or an external URL the original did not
   itself have, and a rewrite step makes the crawl self-contained. See
   [static-self-containment.md](static-self-containment.md).
7. **Paginated pages were missing from both the archive and the baseline.** The first baseline skipped every
   link with a query string, so `blog?page=1` and the second page of long comment threads were never
   captured. They are now discovered transitively and served at their original URLs.
8. **"Unless the original did explicitly" needs the original's whole page, not just its content.** The
   external links that matter (drupal.org, hobobiker.com, the site's own production domain) mostly come from
   sidebar blocks, so the baseline now records every reference on each page.

Verified through the static project's own URL (not a stand-in server): 556 of 556, and the whole pipeline
from a pristine restore in about 43 seconds. Four deliberate breaks made directly in the served files were
each caught by the right tier: removed text (semantic and visible-text, line named), a deleted file (asset
tier and the "every asset resolves" test), a private page leaked into the archive (access: "expected 403,
got 200"), and a CSS-hidden paragraph (visible-text only). A fresh crawl then restored a clean copy.

### Settled

- **One project's container can reach another's** at `https://<name>.ddev.site` (and by container name,
  `http://ddev-<name>-web`). Both resolve to the router, so the suite can run from the original
  project's container against the static site, with no extra setup. (A request made while the router was
  being rebuilt hung; once it was healthy it answered normally.)
- **The static site is reachable from a browser** through its Coder URL once its project name is in the
  workspace's registered list.
- **The static project setup that works:** `ddev config --docroot=public` (so `.ddev/` is not served), the
  crawl written into `public/`, and [`templates/static-urls.nginx.conf`](../templates/static-urls.nginx.conf)
  copied to the project's `.ddev/nginx/`. Stock nginx answers `/blog.html` but 404s `/blog`; the snippet is a
  regular-expression location for dotless paths that tries `$uri.html`, then `$uri/index.html`, then a
  directory index, and it leaves real files (PDFs, images, CSS) alone. After `ddev restart`, extensionless
  URLs answer 200 and a missing page still answers 404.
- **Preparation can be done with `bee` (or `drush`) and `jq`**, as scripts that print a count. `ddev bee
  eval` passes its arguments to the shell unquoted and mangles PHP; write the PHP to a file in the project
  and use `bee php-script` instead.

### Still to verify

- **Naming the prep project.** It is a copy of the original's code, so its DDEV project name has to be
  different (`randyfay-prep`), and registered in the workspace's list of project names before Coder will
  route a browser to it. (Done for this rehearsal.)
- **Production safety.** All three are throwaway: no deploy, no push, no credentials. A copy made with
  `cp -r` carries the original's committed DDEV hooks with it; check that none of them reinstall tooling
  you removed from the copy.
- **A site with real script-built content.** randyfay.com has almost none, so the visible-text tier has
  not been tried against content a crawler captures only partly.
