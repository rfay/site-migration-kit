# The semantic tier

A platform-independent check that **nothing the original site showed is missing from a
migration target**. The same suite, unchanged, judges a static-HTML export and a Drupal 11
rebuild.

## Why not diff the HTML?

The first version of this suite compared normalized HTML byte for byte. That works only when
the target is the same platform: it passes a CMS against itself. A static export or a new theme
changes markup, class names, asset URLs and scripts on every page, so every test fails even when
the content is perfect. The question worth asking is not "is the markup the same" but "does a
visitor still see everything they used to".

## How it works

Two sides, deliberately asymmetric (see [`lib/extract.mjs`](../lib/extract.mjs)):

- **Freezing the baseline** runs once against the original site. Per-site selectors (in
  `migration.config.mjs`) find the main content and the menus, so the baseline records the
  page's *content*, not its theme chrome. For each page it records: document title, primary
  heading, content as **lines** (text split at block boundaries), images, links and menu items.
- **Checking a target** needs *no selectors*. It takes the whole `<body>` and asks whether
  everything in the baseline appears somewhere on the page. Extra chrome from a new theme is
  harmless; a different markup structure cannot cause a false failure.

[`lib/compare.mjs`](../lib/compare.mjs) reports only what the **baseline had and the target
lacks**. Per page:

| Check | Passes when |
|---|---|
| status | the page returns 200 |
| title | the primary heading appears in the document title or any heading |
| lines | every baseline line of content appears in the target's text |
| images | every baseline image file name is present, and internal ones actually load |
| links | every baseline link is present (internal ones compared as normalized paths, so `/a/b`, `/a/b/`, `/a/b.html` and `/a/b/index.html` are one page; external ones exactly) |
| menu | every baseline menu item is present, same path and text |

Plus two suite-level checks: the baseline covers every published path in the site's own content
listing, and **every baseline asset resolves** on the target.

### What counts as "the site"

The content listing (from the database, ideally) is not the whole site. A visitor also
navigates the home page, listing pages and taxonomy pages that the node table does not list.
The baseline exporter **discovers routes** by following the links and menus of the captured pages,
captures every one that returns 200 as a page of type `route`, and records the ones that are broken
or restricted on the source (`brokenOrRestrictedLinks`) instead of asserting them. Fidelity means a
link that is broken on the source is expected to stay broken, not to fail the target.

Only assets that actually return 200 on the source count as known; a file the database lists but
the server 404s is already broken there.

## cheerio

The extractor uses [cheerio](https://cheerio.js.org), a small Node.js library that parses an HTML
string into a document tree you can query with jQuery-style selectors (`$('main article')`,
`.find('a[href]')`, `.text()`). It runs in plain Node with no browser, so extracting text, images,
links and menus from a few hundred pages takes seconds. The tests fetch each page as text
(Playwright's `request` fixture) and hand it to cheerio; no page is rendered. Where a real
browser matters (screenshots, JavaScript-built content) the visual tier uses Playwright pages.

## Running it

From the site's test directory, with the original site running:

```bash
node kit/scripts/export-semantic-baseline.mjs          # freeze (once, then commit and tag)
ddev playwright test --grep "semantic:"                # check the original against itself
ddev playwright test --grep "semantic:.*@smoke"        # one page per content type
ddev playwright test --grep "semantic:.*@route"        # listing/taxonomy/home routes
```

Tests are registered from the kit, so Playwright attributes them to the kit file: select them by
title (`--grep`), not by spec-file path.

Point it at a migration target by setting the variable **inside the container**. A host-side
`TEST_BASE_URL=... ddev playwright ...` is not forwarded and silently tests the original site again:

```bash
ddev exec -d /var/www/html/test/playwright \
  'TEST_BASE_URL=http://localhost:4173 npx playwright test --grep "semantic:"'
```

A throwaway second target for rehearsals. `serve-static.mjs --run` starts the server, runs your
command with `TEST_BASE_URL` already pointing at it, stops the server, and exits with the command's
exit code, so nothing is left running:

```bash
ddev exec -d /var/www/html/test/playwright 'node kit/scripts/mirror-static.mjs --out /tmp/site-static'
ddev exec -d /var/www/html/test/playwright \
  'node kit/scripts/serve-static.mjs --dir /tmp/site-static --run "npx playwright test --grep semantic:"'
```

## Deliberate differences

Anything you *choose* to change goes in `expected-differences.json` (see
[`templates/expected-differences.example.json`](../templates/expected-differences.example.json)),
each entry with a reason. A listed difference is reported as an annotation instead of a failure;
anything unlisted fails. The file is a record of decisions, not a way to silence a test.

## Lessons from the rehearsal (randyfay.com's development copy)

Building the suite and pointing it at a second rendering found problems in the *suite*, which is
the point of rehearsing:

1. **The content list missed whole classes of pages** (home, listings, taxonomy). The first
   static mirror failed 243 menu checks because the breadcrumb targets were never captured.
   Fix: route discovery.
2. **Link presence is not link resolution.** Deleting a linked PDF from the mirror passed every
   page test. Fix: assert every baseline asset resolves.
3. **A link normalizer bug** (`index.html` at the site root) only showed up against a target that
   actually produced `index.html` links. A second target finds bugs a self-check cannot.
4. **A file the baseline cannot see is invisible to page tests.** A deleted image that is not
   embedded in any page's content was only caught by the asset check.
5. **`TEST_BASE_URL` on the host is not forwarded** into the container, so an early "pass against
   the mirror" was really the original site tested twice. Be suspicious of a result that is too fast
   or identical; give every target run a negative control (delete a paragraph, an image, a file and
   confirm the suite names it).
