# Hobobiker Rides Again: run sheets

Three 60-minute live sessions. The runs are demos; the durable artifacts are the plan, the prompts
that worked and the record of what went wrong. Every session ends with a commit, and every stage
boundary is a git tag so a session that goes sideways can jump to a known-good state.

Cooking-show rule: do the interesting work live, and pre-bake anything slow behind a tag.

Timings below come from the randyfay.com rehearsal (a 126-node Backdrop site) unless marked
*unmeasured*. hobobiker.com is about ten times larger (1,296 nodes, 1,657 aliases), so scale the
crawl-bound steps accordingly and pre-bake them.

## Before any session

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
| 40-48 | Freeze the baseline, run the self-check | Export ~25 s for 244 pages here; self-check ~3 s. Tag the commit. |
| 48-56 | Negative controls | Break a copy on purpose (delete a paragraph, an image, a file); the suite must name each one. A run that passes against a second target on the first try is suspect. |
| 56-60 | Show the kit layout and `DISCOVERIES.md`; questions | |

Tag: `s1-baseline-frozen`.

## Part 2: The Last Ride (Oct 23): static HTML

Goal: convert the site to static HTML and prove it with the Part 1 suite.

| Min | What | Notes |
|---|---|---|
| 0-10 | Pipeline shape and plan | restore pristine dump -> transform -> crawl/export -> verify, one command. |
| 10-35 | Run it; iterate on failures | The first failures are usually gaps in the baseline or the export, not in the content (rehearsal: 243 menu failures were breadcrumb routes nobody had captured). Fix the right thing and say which it was. |
| 35-50 | Deliberate changes | Anything chosen (drop comments, delete empty nodes, rewrite dead embeds) goes in `expected-differences.json` with a reason. |
| 50-60 | Green run and review | Review every allowlisted difference. Re-run from a clean restore to show repeatability. |

Pre-bake: the full crawl and any derivative/thumbnail generation. Tag: `s2-static-green`.

## Part 3: The Long Haul (Oct 30): Drupal 11

Goal: the same suite, now against a working Drupal 11 site.

| Min | What | Notes |
|---|---|---|
| 0-15 | Onboard Claude like a new engineer | Explore the D6 source, learn D11, write the migration plan. The plan quality is the demo. |
| 15-45 | Execute with audience input | Migrations as committed, count-reporting scripts, always from a pristine restore. Pre-baked checkpoints for long steps. *Unmeasured.* |
| 45-60 | Run the suite; report honestly | Whatever passes or fails is the result. Decide live which failures are baseline gaps, real losses, or deliberate. |

Tag: `s3-d11-run`.

## Things to rehearse that have not been

- The whole of Part 1 with a stopwatch on a clean checkout (the two-start dev-tools install
  included).
- Auto mode with the settings template, recording blocks.
- The D6 specifics: PHP-evaluated nodes, macros expanded at render time, comments invisible to
  anonymous users, 85 nodes that render empty. The extractor must be taught to see them; whether
  the semantic tier catches each is untested on the real site.
