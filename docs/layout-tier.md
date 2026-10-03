# The layout tier

*Plain language first, then detail. Part of [how-it-works.md](how-it-works.md).*

## The problem it solves

The other tiers compare **words, images and links**. A rebuild can lose the whole sidebar, push its content into a wide
empty gutter, or turn every page a different color, and still pass every one of them. On randyfay.com that happened:
the Drupal 11 site passed all 602 checks while missing the sidebar, and the only thing that noticed was a person
looking at a screenshot. This tier is there to notice such things during testing.

## How it works

It is **not a pixel comparison**. A pixel diff of two different themes is always red and tells you nothing.
Instead it measures a handful of numbers in a real browser and asks whether the target is "in the same ballpark".

- **Frozen once, from the original:** `scripts/export-layout-baseline.mjs` loads every baseline page (1280 px wide) and
  writes `baseline/layout/layout.json`.
- **Per page it records:**
  - the content column's left edge and width, as fractions of the screen width;
  - whether there is a sidebar, which side it is on, how wide;
  - the header band's color and height (a gradient counts);
  - the body text color, size and font family class (serif, sans, mono), and the title's;
  - the color of a link in the text;
  - whether the page scrolls sideways.
- **Nothing is found by selector on the target.** Elements are located *by their text*: the baseline already knows each
  page's content lines, sidebar lines and header lines (`extract.regions`), so the same lines find the same things on any
  theme. A sidebar is a group of those sidebar lines that sits beside the content column rather than in it.
- **Tolerances are wide on purpose** (`lib/layout.mjs`, overridable with `config.layout.tolerances`): content left edge
  within 8 percent of the screen width, widths within half, colors within a distance of 60 to 90 out of 441, font
  size within a quarter. It is meant to catch **significant** differences, not to chase pixels.

## What it caught on randyfay.com

| Case | Result |
|---|---|
| Drupal 11 site with its Bartik subtheme | 267 of 267 pass (after one real fix: deep comment threads made the page scroll sideways) |
| Same site with Olivero instead | 266 of 267 fail: header color on all, fonts, content column position, link color, missing sidebar |
| Sidebar blocks switched off | 97 fail: "sidebar is missing" on exactly the 97 pages that have one |
| Static archive | 267 of 267 pass |

## Running it

    ddev exec -d /var/www/html/test/playwright 'npx playwright test --grep "layout:"'
    node kit/scripts/export-layout-baseline.mjs      # after export-semantic-baseline.mjs

Accepted differences go in `expected-differences.json` with `"kind": "layout"` and a `target`, like any other tier.

## What it does not do

It does not judge beauty, spacing or exact sizes, and it measures one viewport width. A page type with no long prose
lines gives little to measure. If you need more, add a measurement to `lib/layout.mjs`: it is one function.
