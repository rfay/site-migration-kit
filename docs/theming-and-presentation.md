# Theming: the part that does not migrate

Content moves with a script. The theme does not: it is templates, CSS and settings written for the old platform.
The shared tests compare words, images and links, so they say nothing about looks. Decide the budget on purpose.

## Measure first

Remove every theme-related entry from `expected-differences.json` for a target, run the semantic tier, and count the
failures by category. That list is exactly what the theme causes. On randyfay.com the same categories appear for
Drupal's Olivero and for a Bartik port: dates, labels such as "Topics:", comment links, breadcrumbs, headings and pager
text. A different theme moved structure and one label ("Permalink"), nothing else. **A theme is not parity; templates
and settings are.**

## The ladder

1. **A stock theme and a documented allowlist.** Cheapest and honest. Each entry is exact (`equals` or an anchored
   `regex`), scoped to the target, and gives a reason.
2. **The old theme's closest stock relative** (here Drupal's Bartik, installable with Composer). Closer structure, same wording gap.
3. **A subtheme with the old CSS and a few template overrides.** Reproduces colors, fonts and the labels, and
   removes most allowlist entries. Best value when looks matter.
4. **A full port of the old templates.** Pixel match; rarely worth it for a rebuild.

## Settings that reproduce wording without templates

Date formats, the permission that makes Drupal print "Log in to post comments", pager labels in Views, a breadcrumb
builder, text-format settings (for example how long URLs are shortened).

## In a live session

"Derive a subtheme from this CSS and make the visual tier match" is a good prompt: the screenshot is the
success criterion, and the allowlist shrinks as it works. See randyfay's `D11_THEMING.md` for a worked measurement.
