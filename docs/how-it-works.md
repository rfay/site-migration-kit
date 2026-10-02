# How the strategy works, in plain language

## The short version

1. **Capture** what the old site shows today and save it as small files.
2. **Commit** those files to git and tag the commit. From now on they are the reference.
3. **Check** any later version of the site (a static copy, a Drupal 11 rebuild, anything) against the
   reference, and report what is missing.

That is the whole idea. The rest of this page is detail about each step, what the check can and
cannot notice, and the tools that cover the gaps.

## What gets captured

Not a copy of the pages. For each page we save a short record of what a visitor sees on it:

- the title,
- the text of the main content, one line per paragraph or list item,
- the images,
- the links,
- the menu items.

We also save every downloadable file (with its size and fingerprint), the list of pages that are
private (and must stay private), and a few screenshots for a human to look at.

Why records and not saved pages? Two different new sites will have different HTML, different
styling, different web addresses for the same content. A saved copy of the old HTML would never match
either one. A record of *what the page says* can be checked against anything.

**Where the list of pages comes from.** The old site's database knows every article. It does not know
about the home page, listing pages or tag pages, so the capture also follows the links and menus
of the pages it found, and records those too.

## How a later version is checked

For every page in the reference, the check opens the same page on the new site and asks one question:
**is everything from the reference still there?** It looks for each line of text, each image (and
that it loads), each link and each menu item. Anything missing is reported by name.

Extra content on the new site is fine, because a new theme will bring its own menus and footer. So the
check is deliberately one-directional.

Anything you chose to change on purpose (drop the comments, delete empty pages) goes in a short list
with a reason. A listed change shows as a note instead of a failure. Anything not listed fails.

## We are reproducing the site, not repairing it

If a link is broken on the old site, the reference records that it was broken, and the new site is not
expected to fix it. If a page is private, it must stay private. We write down what we find, but fixing
it comes after the migration, not during. A test suite that quietly repairs things stops measuring
whether the move was faithful.

## What the check notices, and what it doesn't

| A change on the new site | Noticed? | By what |
|---|---|---|
| Text removed or edited | Yes, the original line is named | semantic tests |
| Link, menu item or image removed | Yes | semantic tests |
| A linked file or an image no longer loads | Yes | semantic tests, asset check |
| Page missing, private page now public | Yes | semantic tests, access check |
| Text moved to a different place on the page | Only in strict mode | the order option |
| Image description (alt text) changed | Only in strict mode | the alt option |
| Text is in the HTML but hidden from visitors | Yes | the visible-text tests (real browser) |
| New text added (including leaked template codes) | Not a failure; shown in a report | additions report |
| The original site itself changed since the capture | Yes | source-drift check |
| Content outside the main content area (sidebars, footers) | No: not captured | by design |

## The tools

| Tool | What it does | When to use it |
|---|---|---|
| `export-semantic-baseline.mjs` | Captures the reference from the old site | Once, before any migration |
| `check-source-drift.mjs` | Re-reads the old site and says whether it still matches the reference. Exit code 1 if not | Before a migration starts, and any time the old site might have been edited |
| Semantic tests (`semantic:`) | The main check: nothing is missing | Every run against a new site |
| Visible-text tests (`visible:`) | Opens each page in a real browser and checks the text is actually visible. Slower, about 11 seconds for 244 pages | When pages use scripts or hiding, and before sign-off |
| `additions-report.mjs` | Lists what the new site shows that the reference never had | After a run passes, to read for leftovers |
| `mirror-static.mjs`, `serve-static.mjs --run` | Makes a throwaway static copy and runs tests against it, then shuts down | Rehearsing, or checking a static export |
| `vendor-into.sh` | Copies a version of this kit into a site's repository as plain files | Setting up a site |

The access and file-fingerprint checks currently live in each site's repository and are planned to move
here.

## Words that come up

- **Baseline / reference:** the committed files that describe the old site today. They never change
  once a migration starts.
- **Static copy:** a version of the site made of plain HTML files. It is one possible *target* of a
  migration. It is not the same thing as the baseline, though both are "static files". The baseline is
  what we compare *to*; the static copy is what we might compare.
- **cheerio:** a small library that reads an HTML page and lets a script ask questions about it ("give
  me every link in the main content"). It does not draw the page, so it is fast.
- **Playwright:** the tool that runs the checks. It fetches pages, runs them in a real browser when
  that matters (screenshots, hidden text, scripts), tags tests so you can run a subset, and produces
  a report.
- **Negative control:** breaking a copy of the new site on purpose and confirming the check catches it.
  A check that has never been seen to fail is not trustworthy. Do this for every target.

## Three habits that matter

1. **Test the test.** Every run against a new site gets a negative control. If a result is suspiciously
   fast or identical to the last one, suspect the test before celebrating.
2. **Check against a second target early.** Testing the old site against itself proves almost nothing.
   Our own rehearsal found five bugs in the suite only by pointing it at a static copy.
3. **Keep a log of what you find.** Broken links, missing files and odd content are real information for
   the people who decide what to fix later.

More detail on the main check is in [semantic-tier.md](semantic-tier.md).
