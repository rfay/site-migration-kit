# System prep: set up every project before the presentation

Do this **before** the session, not during it. Setting up a project live costs minutes and shows nothing useful.
The hobobiker series needs four sibling DDEV projects, side by side in the same workspace:

| Project | Role | Used in |
|---|---|---|
| `hobobiker` | the original (Drupal 6) and the reference for every test | all three parts |
| `hobobiker-prep` | a copy rebuilt from a pristine database dump, then changed by scripts. The only project where destructive changes are allowed. | Part 2 |
| `hobobiker-static` | the crawled HTML served as a static site | Part 2 |
| `hobobiker-d11` | the Drupal 11 rebuild | Part 3 |

(The randyfay.com rehearsal uses the same shape: `randyfay`, `randyfay-prep`, `randyfay-static`, `randyfay-d11`.)

## On coder.ddev.com (the likely case)

For each of the four projects:

1. **Create the project directory** next to the others (`~/workspace/<name>`) and configure it
   (`ddev config`, with `--docroot=public` for the static project).
2. **List the project name** in the workspace's *DDEV project names* setting. Coder only routes a browser to
   projects named there, so an unlisted project works inside the workspace but has no outside URL.
3. **Run `ddev coder setup`** for the project, so it gets its external URL.
4. **Start it** (`ddev start`) and open its URL once, from outside and from inside the workspace.

A workspace restart stops every DDEV project. Start all four again afterwards (`ddev start` in each directory).

## Check list (all true before going live)

- [ ] All four projects appear in `ddev list` as running.
- [ ] Each one answers at its outside (Coder) URL and its inside `*.ddev.site` URL.
- [ ] `hobobiker-prep` and `hobobiker-d11` can be rebuilt from the pristine dump and the import script, and you
      have timed it.
- [ ] The pristine dump exists, and is kept outside every repository.
- [ ] No production credentials or SSH route in any of the four; `push` removed from DDEV providers
      (see [safe-demo-environment.md](safe-demo-environment.md)).
- [ ] The kit is vendored into `hobobiker` and the test run passes against the original (self-check).
- [ ] The pipeline's preflight, which names any stopped project, passes.
