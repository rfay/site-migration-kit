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

### Settled

- **One project's container can reach another's** at `https://<name>.ddev.site` (and by container name,
  `http://ddev-<name>-web`). Both resolve to the router, so the suite can run from the original
  project's container against the static site, with no extra setup. (A request made while the router was
  being rebuilt hung; once it was healthy it answered normally.)
- **The static site is reachable from a browser** through its Coder URL once its project name is in the
  workspace's registered list.

### Things to verify when we build it (not yet tried)

- **Serving extensionless URLs.** A crawler may save `/blogs/foo` as `blogs/foo.html`. The stock DDEV
  nginx config will not find that for a request to `/blogs/foo`. Either export in the
  `/blogs/foo/index.html` form (the series' HTTrack `-N` setting does this for GitHub Pages), or add a
  `.ddev/nginx/` snippet with a regular-expression location for dotless paths that tries `$uri.html` and
  `$uri/index.html`.
- **Setting the static project's docroot to `public/`.** Today its docroot is the project root, which
  also exposes `.ddev/`. `mirror-static.mjs` now refuses to empty a directory that looks like a project
  root, for exactly this reason.
- **Naming the prep project.** It is a copy of the original's code, so its DDEV project name has to be
  different (`randyfay-prep`), and registered in the workspace's list of project names before Coder will
  route a browser to it.
- **Production safety.** All three are throwaway: no deploy, no push, no credentials.
