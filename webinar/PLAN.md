# Hobobiker Rides Again: run sheets

Three 60-minute live sessions. The runs are demos; the durable artifacts are the plan, the prompts
that worked and the record of what went wrong. Every session ends with a commit, and every stage
boundary is a git tag so a session that goes sideways can jump to a known-good state.

Cooking-show rule: do the interesting work live, and pre-bake anything slow behind a tag.

Timings below come from the randyfay.com rehearsal (a 126-node Backdrop site; 267 baseline pages) unless marked
*unmeasured*. hobobiker.com is about ten times larger (1,296 nodes, 1,657 aliases), so scale the
crawl-bound steps accordingly and pre-bake them.

## Before any session

- **System prep:** all four hobobiker projects (`hobobiker`, `-prep`, `-static`, `-d11`) set up, listed in the
  workspace's "DDEV project names", `ddev coder setup` done, and running:
  [docs/system-prep.md](../docs/system-prep.md).
- A disposable, restorable copy that works (restore tested, not assumed). Tell the agent so in
  `AGENTS.md`, and put the classifier settings in your user settings:
  [docs/safe-demo-environment.md](../docs/safe-demo-environment.md).
- No production credentials or route in the workspace; strip `push` from DDEV providers.
- Run the session's actual prompts in auto mode once and record every classifier block; add each
  to the allow list. *Unmeasured: not yet rehearsed in auto mode.*

## Part 1: Road Test (Oct 16): build the tests that define success

Goal: a frozen, platform-independent baseline of what the site shows, and a suite that can tell a
good migration from a bad one. No migration happens in this session.

| Min | What | Notes |
|---|---|---|
| 0-10 | Frame the goal; write the plan in plan mode | The prompt and plan are the demo. Show the improved review prompt from MIGRATION_PREP.md. |
| 10-20 | Read-only audit of the source | Inventory by type and status, render-time magic, hidden/invisible content, broken links. Log everything in `DISCOVERIES.md`; fix nothing. |
| 20-40 | Build the tiers with Claude | Content listing from the database (current-revision join, unpublished included); semantic extractor; asset and access checks; screenshots informational only. |
| 40-48 | Freeze the baseline, run the self-check | Export ~8 s for 267 pages here; the whole 1,142-test suite against the original ~17 s. Tag the commit. |
| 48-56 | Negative controls | Break a copy on purpose (delete a paragraph, an image, a file); the suite must name each one. A run that passes against a second target on the first try is suspect. |
| 56-60 | Show the kit layout and `DISCOVERIES.md`; questions | |

Tag: `s1-baseline-frozen`.

### Measured on hobobiker.com (rehearsal, 2026-10-15)

2,345 baseline pages (1,601 node paths, 469 per-day tripinfo pages, 275 discovered routes). The full
log is in the hobobiker repo, `migration/REHEARSAL.md`.

| Step | Time | Live or pre-bake |
|---|---|---|
| Pristine restore (database + 1.2 GB files + fingerprint check) | 19 s | live |
| Read-only audit script | 23 s | live |
| Playwright image build (second `ddev restart`) | 4 m 46 s | **pre-bake** |
| Manifest, stored-content export | 2 s each | live |
| Semantic baseline export | 44 s (11 min before bounding tripinfo discovery) | live |
| Layout baseline export | 2 m 14 s | **pre-bake** |
| HTTP tiers vs original (baseline, semantic, access, asset) | 26 s, 4,200 tests | live |
| Browser tiers vs original (visible, layout) | 5 m 19 s, 4,690 tests | **pre-bake** |
| Full self-check, stored tier enforced | 4 m 09 s, 10,335 tests | **pre-bake** |
| wget mirror + rewrite | 19 s + 5 s | live |
| Negative controls (7 breaks), targeted run | 2 s + 6 s | live |

Good live moments: the tripinfo link explosion (9,738 pages) and the decision to bound it; a CSS-hidden
paragraph that only the visible-text tier sees; the stored-content control naming the one missing comment.

## Part 2: The Last Ride (Oct 23): static HTML

Goal: convert the site to static HTML and prove it with the Part 1 suite. The approach follows Karen
Stevenson's Lullabot series on retiring Drupal sites (credit and links in
[docs/retirement-approach.md](../docs/retirement-approach.md)). The static copy runs as a sibling DDEV
project next to the original, on the same Coder workspace, so both can be compared side by side.

| Min | What | Notes |
|---|---|---|
| 0-10 | Pipeline shape and plan; the sibling project | restore pristine dump -> transform -> crawl/export -> verify, one command. Credit Karen Stevenson's series up front. Before the session, settle the open questions in `docs/retirement-approach.md` (extensionless URLs, reaching one DDEV project from another, the Coder project-name list). |
| 10-35 | Run it; iterate on failures | The first failures are usually gaps in the baseline or the export, not in the content (rehearsal: 243 menu failures were breadcrumb routes nobody had captured). Fix the right thing and say which it was. |
| 35-50 | Deliberate changes; the crawl is not self-contained until you make it so | Show the leak: thousands of references still point at the crawled site and every content check still passes. Then the `static:` tier, the rewrite step and its rules. |
| 35-50 | Deliberate changes | Anything chosen (drop comments, delete empty nodes, rewrite dead embeds) goes in `expected-differences.json` with a reason. |
| 50-60 | Green run and review | Review every allowlisted difference. Re-run from a clean restore to show repeatability. |

Pre-bake: the full crawl and any derivative/thumbnail generation. Tag: `s2-static-green`.

## Part 3: The Long Haul (Oct 30): Drupal 11

Goal: the same suite, now against a working Drupal 11 site.

The target is a sibling DDEV project on the same workspace (randyfay.com's rehearsal uses `randyfay-d11`; not built
yet). Run the suite with `MIGRATION_TARGET=drupal11`: the decisions recorded for the static target do not apply, so
private pages must still answer 403 and the semantic, visible-text, access and asset tiers judge the result. The
`static:` tier is for archives only. A workspace restart stops every DDEV project, so start each one first.

| Min | What | Notes |
|---|---|---|
| 0-15 | Onboard Claude like a new engineer | Explore the D6 source, learn D11, write the migration plan. The plan quality is the demo. |
| 15-45 | Execute with audience input | Migrations as committed, count-reporting scripts, always from a pristine restore. Pre-baked checkpoints for long steps. *Unmeasured.* |
| 45-60 | Run the suite; report honestly | Whatever passes or fails is the result. Decide live which failures are baseline gaps, real losses, or deliberate. |

Tag: `s3-d11-run`.

## Things to rehearse that have not been

- Auto mode with the settings template, recording blocks. (The hobobiker rehearsal ran without it.)
- Part 1 from a truly clean checkout, start to finish, with the kit changes from that rehearsal vendored in.
- Part 2's open hobobiker decisions: unpublished pages answering 404 in the archive, and whether
  to archive the tripinfo prev/next days beyond one hop.

Rehearsed on hobobiker.com (2026-10-15): the D6 specifics. Tripinfo tables (PHP at render), expanded
`[hobophoto:]` macros and the 85 empty-module nodes are all in the baseline, and
`tests/baseline-sanity.spec.ts` there asserts it. Comments never render (the module is disabled), so
they are held by the new stored-content tier instead.
