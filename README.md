# site-migration-kit

A repeatable method for migrating an old, database-driven website with an AI coding agent
(Claude Code) — and for *knowing* whether the migration worked.

This repo is the method, not any one site. It holds the prompts, plan templates, test
scaffolding and checkpoints. Each site being migrated keeps its own small config, its own
frozen baseline and its own discoveries log, and points at a tagged version of this kit.

> **Status: early.** This README is the strategy. The pieces it links to under
> [Techniques](#techniques) are being built out of two real projects (below) and are marked
> *planned* until they exist.

## Why this exists

It is the working material for **Hobobiker Rides Again**, a three-part live series (Oct 16, 23
and 30, 2026) in which [hobobiker.com](https://hobobiker.com) — a Drupal 6 site — is migrated
two different ways, with Claude doing the work:

| Part | Date | What happens |
|---|---|---|
| 1. Road Test | Oct 16 | Build the tests, *before* any migration, that define success |
| 2. The Last Ride | Oct 23 | Convert the site to static HTML and check it against those tests |
| 3. The Long Haul | Oct 30 | Rebuild it as Drupal 11 and check it against the same tests |

Series announcement:
[DDEV September 2026 newsletter](https://ddev.com/blog/ddev-september-2026-newsletter/#hobobiker-rides-again-a-three-part-live-series-on-drupal-6--drupal-11-with-claude).

The two migrations are demos. **The point is the technique**: Claude does its best work
when it has a guided plan, a clear view of the source and the destination, and success
criteria it can check for itself. Getting those three things right is most of the job, and
they are the same for any site.

The method was developed on a smaller practice site, [randyfay.com](https://randyfay.com)
(Backdrop CMS), so that the series would not be the first time anyone tried it.

## Strategy

New to this? Start with [docs/how-it-works.md](docs/how-it-works.md), the whole strategy in plain
language, then come back here for the detail.

### 1. Define success before you touch anything

Write the tests first, against the site as it exists today, and freeze the result as a
**baseline**. Two very different migrations (static HTML, Drupal 11) must be judged by the
*same* suite, so the suite cannot depend on how either one is built.

- Compare **what a visitor sees**, not the markup that produces it: status, title, main
  content text, images, links, menus, paths. Raw-HTML diffs only work when the destination
  is the same platform.
- Keep the baseline **outside the migration pipeline** and tag it. Transforms must never be
  able to regenerate it, or they quietly redefine "correct."
- Every tier is data-driven from a manifest of what the site contains, and every tier can be
  run as a subset.

### 2. The baseline measures fidelity, not correctness

We are reproducing a site, not repairing it.

- **Expect many inconsistencies on an old site. Fixing them is out of scope.** A broken
  image must stay broken the same way; an unpublished page must still return 403.
- **Log every discovery anyway.** "Not worth fixing" is not "not worth knowing." Keep a
  `DISCOVERIES.md` from day one so a human can triage it afterwards: load-bearing quirk,
  fix later, or dead weight.
- **Deliberate changes are declared, not discovered.** Anything you *choose* to change
  (delete 85 empty pages, rewrite dead Flash embeds) goes in a reviewed
  expected-differences file, so it appears as a decision instead of a test failure.
- **Verify against the authoritative source before "fixing" a discrepancy.** A gap between
  your dev copy and what you expected is evidence you don't yet understand the system.

### 3. Migrate with scripts, not edits

The migration takes more passes than you expect, so the unit of work is a script.

```
restore pristine dump -> run transforms in order -> crawl -> verify
```

One command, runnable from scratch at any time. Never hand-edit content item by item; every
script reports a count, because a converter that changed 103 items yesterday and 0 today is
telling you something broke. Scripts are committed, so the migration is reproducible — and
at cutover you restore current production data and run the same pipeline unchanged.

### 4. Give the agent a disposable copy, and tell it so

Set up a copy whose state restores with one command, verify the restore works, *then* tell
the agent that is what it is working on so it can work at the right pace. Only say it when it
is true.

How to make that claim true, and make the agent and its permission classifier believe it
without switching every check off, is in
[docs/safe-demo-environment.md](docs/safe-demo-environment.md): an `AGENTS.md` in the site
repo, `autoMode` settings in the user's own config, optional deny rules and a hook, and a
rehearsal step that records every classifier block.

### 5. Plan and prompt quality is the subject

The runs are shown live; the durable artifacts are the plan, the prompts that worked, and
the record of what went wrong. Each stage is tagged in git so a live session can jump to a
known-good state.

## The kit and the site: who owns what

| Lives in this kit | Lives in each site's repo |
|---|---|
| Prompt sequence (one file per stage) | A single `migration.config.*` |
| Plan and discoveries templates | The frozen, tagged baseline |
| Extractor and test specs, all tiers | That site's `DISCOVERIES.md` |
| One-command `verify` entry point | The expected-differences file |
| Project skills for repeated procedures | A pointer to the kit version used |
| Webinar plans and timings | |

The config holds only what genuinely differs per site: base and production hostnames, how to
list content (DB query, crawl or sitemap), selectors for main content and menu, asset
directories, and expected-status overrides (403/404s that must persist). **If reusing the
kit on a new site requires editing anything other than that config, that is a gap in the
kit, and it gets recorded.**

## Techniques

| Technique | Where | Status |
|---|---|---|
| Safe disposable-copy setup: `AGENTS.md`, classifier settings, deny rules, tripwire hook | [`docs/`](docs/safe-demo-environment.md), [`templates/`](templates/) | drafted, untested end to end |
| Stage prompts | `prompts/` | planned |
| Plan and discoveries templates | `templates/` | planned |
| Manifest generation from the source (current-revision joins, unpublished handling) | `scripts/` | prototyped on randyfay.com |
| Semantic extraction baseline (platform-independent content, route, menu and asset check) | [`lib/`](lib/), [`tests/`](tests/), [docs](docs/semantic-tier.md) | working; verified on randyfay.com's development copy and a static mirror, with negative controls |
| Asset integrity tier (SHA-256 of every file) | randyfay.com `test/playwright/tests/` | prototyped; the semantic tier also asserts every asset resolves |
| Access tier (unpublished content must still return 403) | randyfay.com `test/playwright/tests/` | prototyped, not yet moved into the kit |
| Path tier (every alias, listing route and asset resolves) | covered by the semantic tier | working; redirects not yet modeled |
| Visual tier (curated screenshots, informational only) | `tests/` | prototyped on randyfay.com |
| In-browser visible-text check (hidden text, script-built content) | [`tests/visible-suite.mjs`](tests/visible-suite.mjs) | working; verified with a hidden-paragraph negative control |
| Additions report (what the target shows that the baseline never had) | [`scripts/additions-report.mjs`](scripts/additions-report.mjs) | working; subtracts the source's own chrome; verified with a leaked-macro control |
| Source-drift check (has the original changed since the freeze?) | [`scripts/check-source-drift.mjs`](scripts/check-source-drift.mjs) | working; verified on a tampered baseline copy |
| Strict options: line order and image alt text | `config.strict` in `migration.config.mjs` | working; off by default |
| Expected-differences allowlist | [`templates/`](templates/expected-differences.example.json), `lib/compare.mjs` | working |
| Subset runs by tag (`@smoke`, per content type, `@assets`) | Playwright `--grep` | prototyped on randyfay.com |
| Second target for rehearsals: wget mirror and static server | [`scripts/`](scripts/) | working |
| Vendor the kit into a site repo as plain files (no submodule) | [`scripts/vendor-into.sh`](scripts/vendor-into.sh) | working |
| Restore, transform, crawl, verify pipeline | `scripts/` | planned |

Tests run with Playwright under DDEV via
[Lullabot/ddev-playwright](https://github.com/Lullabot/ddev-playwright).

## The three sessions

Each session is 60 minutes, structured like a cooking show: the interesting work is done
live and the slow steps (full crawls, derivative generation, long test runs) are pre-baked
behind git tags.

- **Part 1 — Road Test.** Plan in plan mode; a read-only audit of the source; build the
  tiers; freeze the baseline; self-check passes; a deliberate negative control fails, which
  proves the suite can detect a problem.
- **Part 2 — The Last Ride.** Retire the site to static HTML, following Karen Stevenson's series ([details](docs/retirement-approach.md)), served from a sibling DDEV project. Show the pipeline shape; run it; iterate on failures, using the
  allowlist and discoveries log; review whatever was allowlisted.
- **Part 3 — The Long Haul.** Onboard Claude the way you would a new engineer — explore D6,
  learn D11, write the plan — then execute with audience input and run the same suite. The
  result is reported as it comes out.

Run sheets with per-stage timings, from the randyfay.com rehearsal, are in [webinar/PLAN.md](webinar/PLAN.md).

## Prior art

The static-HTML path builds on **Karen Stevenson**'s three-part Lullabot series on retiring a
Drupal site. See [docs/retirement-approach.md](docs/retirement-approach.md) for how we use it.

- [Sending a Drupal Site Into Retirement](https://www.lullabot.com/articles/sending-a-drupal-site-into-retirement)
- [Sending a Drupal Site Into Retirement Using HTTrack](https://www.lullabot.com/articles/sending-drupal-site-retirement-using-httrack)
- [Sending a Drupal Site into Retirement Using the Static Generation Module](https://www.lullabot.com/articles/sending-drupal-site-retirement-using-static-generation-module)

## Background reading

- [ddev.com newsletter announcing the series](https://ddev.com/blog/ddev-september-2026-newsletter/#hobobiker-rides-again-a-three-part-live-series-on-drupal-6--drupal-11-with-claude)
- [DDEV](https://ddev.com) — the local environment everything here runs in
- [Lullabot/ddev-playwright](https://github.com/Lullabot/ddev-playwright)
- Source projects the kit is being extracted from: randyfay.com (Backdrop; practice site,
  `PLAYWRIGHT_TESTING.md` and `HANDOFF.md`) and hobobiker.com (Drupal 6; the real target,
  `MIGRATION_PREP.md`)

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
