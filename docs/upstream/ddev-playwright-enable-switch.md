# Draft issue for Lullabot/ddev-playwright (not yet filed)

**Title:** Only the browser build is opt-in: the rest of the add-on (including PHP-FPM tuning) applies to every project that installs it

**Body:**

I run DDEV on the same repository in development and in production, and I check the add-on's
configuration into that repository, as the README suggests. I want ddev-playwright active on
developer copies only. The README says the add-on "only installs the heavy Playwright dependencies
if a given local opts in to them", and that is true for the browser build, but most of the rest of
the add-on applies to everyone who has its files, whether or not they opted in.

Tested on v0.5.8. I compared `config.playwright.yml` with `main` (v0.5.9) and it is identical;
v0.5.9 only adds a libsoup pin inside the already-gated Dockerfile.

**What is gated:** the heavy browser build runs only when `.ddev/web-build/Dockerfile.playwright`
exists. `ddev install-playwright` creates it, and the error text in `config.playwright.yml` says to
delete it to start without Playwright.

**What is not gated, so it applies on every start whether or not Playwright is wanted:**

- **`web-entrypoint.d/php-fpm-capacity.sh` (added in v0.5.7).** It rewrites the PHP-FPM pool in
  `/etc/php/<version>/fpm/pool.d/www.conf` on every web container start: `pm.max_children` becomes
  twice the CPU count (clamped to 8..96), with matching start and spare server counts. On a 12-core
  host I see `pm.max_children = 24`, where DDEV's default is 8. Nothing in the script depends on
  Playwright being enabled. This is the one that matters most for me: it silently changes the
  runtime sizing of a production web container.
- `web-build/Dockerfile.10-go-task` and `Dockerfile.20-astral-uv` (added to the web image)
- the `kasmvnc` entry in `web_extra_daemons`. When Playwright is off, the install step is not in the
  image, so the entry just falls through to `sleep infinity`, but it is still there.
- `web_extra_exposed_ports` for 9323 and 8444, which become router entries (and show up in
  `ddev describe`)
- the tmpfs `sqlite_database` volume in `docker-compose.sqlite.yaml`
- the `web_environment` entries and the post-start hook

So a project that has "disabled" Playwright still carries extra image layers, router ports, a daemon
entry, a volume and changed PHP-FPM sizing, and there is no single documented way to turn all of it
off short of `ddev add-on remove`. I searched the issues and pull requests (open and closed) for
disabling, opting out and gating and found nothing; the closest is #32 (closed, "Provide clear
uninstall/remove instructions for the add-on"), which is about removing the add-on rather than
leaving it installed but off.

One smaller thing: when Playwright is enabled, every start prints a warning that
`Dockerfile.playwright` has an "unexpected #ddev-generated" marker (the pre-start hook rewrites the
file each time).

I thought about a Docker Compose profile for this, as used for services like xhgui, but it does not
fit: Playwright is built into the `web` image rather than being its own service, so a profile cannot
gate it.

**Proposal:** consider extending the pattern the add-on already uses for `Dockerfile.playwright`.
Ship every piece as a `disabled.*` file, have `ddev install-playwright` copy them all into place
(including the PHP-FPM script), and add a matching `ddev uninstall-playwright` (or
`install-playwright --off`) that removes the copies and leaves the add-on's own files. One command on,
one command off, and nothing active when off, so the configuration can be committed to a repository
that production also runs.

I am happy to send a PR if the maintainers like that direction.
