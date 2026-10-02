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

## The plan for this series: a sibling DDEV project

Instead of publishing to GitHub Pages, the static copy is served locally, next to the original, so the
same suite can be pointed at both.

1. **A sibling directory and DDEV project**, for example `randyfay-static` next to `randyfay`, whose
   docroot is the folder of exported HTML. It runs on the same Coder workspace as the original, so the
   original and the retired copy can be compared side by side in one browser.
2. **Export with a crawler** (HTTrack as in the series, or `wget`, which `kit/scripts/mirror-static.mjs`
   already wraps) from the original into the sibling project's docroot.
3. **Run the suite against the sibling's URL** (`TEST_BASE_URL=https://randyfay-static.ddev.site`) with
   the semantic, visible-text, access and asset checks, and give the run a negative control.
4. **Review what failed.** Early failures are usually gaps in the baseline or the export (pages the
   crawler never reached), not content loss. Anything that is a deliberate removal goes into
   `expected-differences.json` with a reason.

### Things to verify when we build it (not yet tried)

- **Serving extensionless URLs.** A crawler may save `/blogs/foo` as `blogs/foo.html`. The stock DDEV
  nginx config will not find that for a request to `/blogs/foo`. Either export in the
  `/blogs/foo/index.html` form (the series' HTTrack `-N` setting does this for GitHub Pages) or add a
  `try_files $uri $uri.html $uri/ =404;` rule to the sibling project's nginx config.
- **Reaching one DDEV project from another's container.** The suite runs inside the original project's
  web container. Whether `https://randyfay-static.ddev.site` resolves to the router from there needs
  testing. If it does not, run the suite from the static project's own container instead.
- **Browser access on Coder.** The sibling project's name has to be in the workspace's registered list
  of DDEV project names, or the Coder proxy URL will not route to it until the workspace is edited and
  restarted (`coder-setup` prints this warning).
- **Production safety.** The sibling directory is a throwaway export: no deploy, no push, no credentials.
