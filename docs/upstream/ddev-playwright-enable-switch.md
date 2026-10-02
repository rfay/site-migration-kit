# Draft issue for Lullabot/ddev-playwright (not yet filed)

**Title:** A way to disable the add-on cleanly: only the browser build is gated today

**Body:**

I run DDEV on the same repo in development and in production, and I want ddev-playwright on
developer copies only. Today the add-on has a partial off switch, and I could not find an issue
covering it (searched "disable", "profile", "rebuild", "opt-in").

**What is gated:** the heavy browser build only runs when `.ddev/web-build/Dockerfile.playwright`
exists. The `ddev install-playwright` command creates it, and the error text in
`config.playwright.yml` says to delete it to start without Playwright.

**What is not gated, so it applies on every start whether or not Playwright is wanted:**
- `web-build/Dockerfile.10-go-task` and `Dockerfile.20-astral-uv` (added to the web image)
- the `kasmvnc` daemon in `web_extra_daemons` (with the `|| sleep infinity` guard noted in the config)
- `web_extra_exposed_ports` for 9323 and 8444, which become router entries
- the tmpfs `sqlite_database` volume in `docker-compose.sqlite.yaml`
- the `web_environment` entries and the pre/post-start hooks

So "disabled" still leaves the add-on's image layers, ports, daemon and volume on the project, and
there is no single, documented way to turn everything off short of `ddev add-on remove`.

Two smaller things I hit:
- Every start prints a warning that `Dockerfile.playwright` has an "unexpected #ddev-generated"
  marker (the pre-start hook rewrites it each time).
- Docker Compose profiles, as used for services like xhgui, do not fit: Playwright is built into
  the `web` image rather than being its own service, so a profile cannot gate it.

**Proposal:** extend the pattern the add-on already uses for `Dockerfile.playwright`. Ship every
piece as a `disabled.*` file, have `ddev install-playwright` copy them all into place, and add a
matching `ddev uninstall-playwright` (or `install-playwright --off`) that removes the copies and
leaves the add-on's own files. One command on, one command off, and nothing active when off.

**Happy to send a PR** if the maintainers like that direction. A separate-container redesign (with a
compose profile) would be a bigger change; I'd want your view on whether it is worth discussing.

---
Notes for whoever files this: check the add-on's current version first (the findings above were
made on v0.5.6 and confirmed unchanged on v0.5.8), and test the proposal on a project with and
without Mutagen. Related workaround used in one project: gitignore the add-on's files and install it
on demand from a pre-start hook only when the primary URL is `*.ddev.site`.
