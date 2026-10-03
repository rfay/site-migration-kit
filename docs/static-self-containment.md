# A retired site must not link to anything that is not static

The point of retiring a site to static HTML is that it stands on its own. A crawl does not give you
that by itself, and nothing in a content check notices when it fails.

## What goes wrong

A crawler rewrites links only to the pages it downloaded. Every other link stays an absolute URL on the
site that was crawled: comment permalinks, login and profile links, feeds, search, admin links. On the
randyfay.com rehearsal, 4,084 references on 242 of 244 pages still pointed at the site the crawl came from,
and every content check still passed, because those paths were never in the baseline. If that site goes
away, the archive is full of dead links; until then, a visitor who clicks one leaves the archive.

## The rule the tests enforce (`static:` tier)

For every page, every URL it refers to (links, images, scripts, stylesheets, frames, forms; head and
body) is checked. A page fails if it refers to:

1. **The source site**, or any host listed in `config.static.forbiddenHosts` (for example the prepared
   copy that was crawled). No exceptions: the archive must not depend on a site that is going away.
2. **A dead internal URL**: one on the archive's own host that does not resolve. The exception is a
   reference the original already had dead or restricted (a link to a page that 404s or answers 403 on the
   original): that must stay that way, because we reproduce the site rather than repair it.
3. **An external URL the original page did not itself refer to.** A link out of the site is fine when the
   original made it explicitly, such as a link to drupal.org. A new one, say a script from a CDN, means
   something non-static crept in.
4. **The site's own public domain** (`config.ownDomains`). Old content often hardcodes
   `http://example.com/node/58` into links and images. That domain IS this site, so those are internal
   links and an archive must reach them by relative URL: `/node/58`. Any absolute reference to an own
   domain left in an archive fails. (A self-check against the original itself is exempt, because the
   original legitimately contains them.)

What "the original did explicitly" means is recorded, per page, when the baseline is frozen: every
external URL the original page referred to anywhere (not just in its content region, since sidebar and
footer blocks make links too), and every internal reference that was already dead or restricted. The
test compares the archive to that record, so it needs no live original at test time.

A reviewed difference can be listed in `expected-differences.json` with `"kind": "static"`.

## The site's own domain is this site

`config.ownDomains` lists hosts that ARE the site (its production domain). Everything follows from
treating them as internal:

- **The baseline** records a link to `http://example.com/node/58` as the internal link `node/58`, so the
  archive's relative `/node/58` satisfies it with no expected-differences entry, and discovery follows the
  link (it found `taxonomy/term/26` and `taxonomy/term/27` this way).
- **The crawl** fetches own-domain images and files from the copy being crawled, because a crawler will
  not follow another host.
- **The rewrite** treats the own domains like the crawled site: `http://example.com/node/58` becomes
  `/node/58`, and a reference the original had dead stays dead (as a relative URL).
- **A response that is not HTML is a file, not a page.** Discovery once captured a public-key file as a
  "page" and the visible-text tier rightly found nothing to read. Files join the assets every target must
  serve.
- **The suite never requests the own domain.** It resolves own-domain references against the target's own
  origin. A test run must not make requests to a production site.

`scripts/own-domain-report.mjs` prints the list for a discoveries log.

## Making a crawl self-contained: `rewrite-static.mjs`

[`scripts/rewrite-static.mjs`](../scripts/rewrite-static.mjs) rewrites every reference to the crawled site,
deterministically, and prints a count per decision, so a change in the numbers shows up. Per reference:

1. The original already had it dead or restricted: kept as it was, but as a root-relative URL.
2. A rule from the site's rules file, first match wins: `anchor` (a comment permalink becomes `#comment-714`
   on the page that has that comment), `unwrap` (the link goes, its text stays), `relative`, or `remove`
   (delete the element, for example a feed-discovery tag).
3. The target exists in the copy: make the URL root-relative.
4. Otherwise a link is unwrapped, and any other kind of reference is reported as unresolved (`--strict`
   makes that a failure).

The rules are decisions, and each is worth a sentence in the site's notes. randyfay.com's:

| Rule | Count | Why |
|---|---|---|
| comment permalinks become same-page anchors | 2,446 | the comment is on that page, so the link still lands on it |
| login, profile, logout, search links: link removed, text kept | 1,838 | dynamic features a static site cannot have |
| kept as the original had it (dead or restricted) | 79 | the original linked to `contact` (403), the missing files, and similar |
| feed-discovery `<link>` tags removed | 47 | a feed is dynamic; mirroring a snapshot feed is the alternative |

## Related things the same rehearsal turned up

- **Paginated pages are content.** `blog?page=1`, `topics/planet-drupal?page=1…6`, and the second page of a
  50-comments-per-page thread were absent from the first baseline (it skipped every link with a query
  string), so they were absent from the archive and no test could see it. The exporter now follows
  parameters named in `config.discover.queryParams` (here `['page']`) transitively, and a static server can
  serve them at the original URLs: see `templates/static-urls.nginx.conf`, which tries
  `$uri$is_args$args.html` first.
- **Hardcoded references to the site's own domain** are recorded at export time (`config.ownDomains`) and can
  be printed with `scripts/own-domain-report.mjs`. They are preserved, allowed by the tier above, and listed
  for a human, because each one makes the archive depend on that domain being served.
- **The baseline exporter now writes to a temporary directory and swaps it in only on success.** A failed
  export can no longer destroy the reference. (Found the hard way.)

## What it does not check

- URLs inside CSS (`url(...)`) and inline scripts, and anything built by JavaScript at run time.
- Whether an external URL the original linked to still works. The original made that choice; it is
  reproduced, not tested.
