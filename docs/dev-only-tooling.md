# Keeping dev-only DDEV add-ons off production

Some add-ons belong on a developer's copy and must never reach a server that runs the same repo:
ddev-playwright adds a large image build, a VNC daemon, extra router ports and a tmpfs volume.

**The technique** ([`templates/dev-tools.example`](../templates/dev-tools.example)):

1. Gitignore the add-on's files (the add-on's `addon-metadata/<name>/manifest.yaml` lists them).
2. Commit a small host command, `.ddev/commands/host/dev-tools`, and a pre-start hook that runs it.
3. The command does nothing unless `$DDEV_PRIMARY_URL` is `*.ddev.site`. Anything else, including
   an unknown value, is treated as production and exits silently. (`ddev describe -j | jq -r
   .raw.primary_url` works when the project is stopped.)
4. On a dev copy it runs `ddev add-on get <addon> --version <pin>` once.

**Gotcha: it takes two starts.** DDEV reads `config.*.yaml` before pre-start hooks run, so the
add-on's config (daemons, ports, hooks, environment) is not active on the start that installs it.
The first start installs and says so; the second activates it. Anything that would build on the
first start with unfilled placeholders (Playwright's browser image build) must be deferred to the
second, which the template does.

**Why the primary URL:** it is the one signal that differs reliably between a developer copy and a
production host without adding configuration to either. Check yours before relying on it.
