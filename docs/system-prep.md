# System prep: set up every project before the presentation

Do this **before** the session, not during it. Setting up a project live costs minutes and shows nothing useful.
The hobobiker series needs four sibling DDEV projects, side by side in the same workspace:

| Project | Role | Used in |
|---|---|---|
| `hobobiker-copy` | the original (Drupal 6) and the reference for every test | all three parts |
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

## Browser tiers on a larger site: shared memory

Docker gives a container 64 MB of `/dev/shm`. With that, Chromium crashes its tab ("Page crashed")
after about 2,000 page loads; hobobiker.com's 2,345-page layout baseline hit it, randyfay.com's 267
pages never did. The layout exporter now launches Chromium with `--disable-dev-shm-usage`. For the
test runs as well, give the web container more shared memory with `.ddev/docker-compose.shm.yaml`:

```yaml
#ddev-silent-no-warn
services:
  web:
    shm_size: 1gb
```

## DDEV problems met while setting up (October 2026)

- **`ddev utility rebuild` fails with `"/playwright": not found`** on a project with the ddev-playwright add-on
  enabled. The add-on stages `.ddev/web-build/playwright/` in a pre-start hook and deletes it after start, and
  `utility rebuild` builds without running pre-start hooks. Use `ddev restart`; for a no-cache rebuild, first
  `mkdir -p .ddev/web-build/playwright` and copy `package.json` and `package-lock.json` from the test directory
  into it. ([Lullabot/ddev-playwright#189](https://github.com/Lullabot/ddev-playwright/issues/189))
- **A project can vanish from `ddev list`** if it was registered (`ddev config`) while another DDEV command was
  running for minutes, such as a rebuild: that command saves the project list it read at startup. Its files
  and config are intact; `ddev start` in its directory registers it again.
  ([ddev/ddev#9004](https://github.com/ddev/ddev/issues/9004))
- **Public projects need patched PHP.** These projects have public Coder URLs, so PHP2Shell (October 2026)
  applies. Check `ddev php -v`: PHP 7.3 and other old versions show "built: Oct 21 2026" or later; 8.2+ show
  the fixed version. A static project still runs php-fpm, and `/phpstatus` reaches it from outside until
  [ddev/ddev#9006](https://github.com/ddev/ddev/pull/9006) ships. See
  [DDEV's notes](https://ddev.com/blog/php2shell-what-ddev-users-need-to-know/).

## Check list (all true before going live)

- [ ] All four projects appear in `ddev list` as running.
- [ ] Each one answers at its outside (Coder) URL and its inside `*.ddev.site` URL.
- [ ] `hobobiker-prep` and `hobobiker-d11` can be rebuilt from the pristine dump and the import script, and you
      have timed it.
- [ ] The pristine dump exists, and is kept outside every repository.
- [ ] No production credentials or SSH route in any of the four; `push` removed from DDEV providers
      (see [safe-demo-environment.md](safe-demo-environment.md)).
- [ ] The kit is vendored into `hobobiker-copy` and the test run passes against the original (self-check).
- [ ] The pipeline's preflight, which names any stopped project, passes.
- [ ] `ddev php -v` shows the PHP2Shell-fixed build in every project (see above).
- [ ] The static project has [`templates/static-urls.nginx.conf`](../templates/static-urls.nginx.conf) in `.ddev/nginx/`.
