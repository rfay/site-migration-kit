# Running an agent safely (and quickly) on a disposable copy

**The problem.** An agent doing a migration needs to run bulk `UPDATE`s, delete content and
crawl a site. A permission classifier looking at `UPDATE node ...` against a site called
`hobobiker` has no way to know that it is a throwaway local copy rather than production, so a
cautious one keeps stopping to ask. In a live session that is fatal to the pace.

**The approach: make it true, then make it known, then make it checkable.** Skipping all
permission checks (`--dangerously-skip-permissions`) is the blunt tool. The layers below keep
the checks and teach them about your environment, which is also a transferable skill for the
audience.

## Layer 1: make it true

Nothing else matters if the claim is false. Before telling any agent "this is disposable":

- The copy restores from a pristine dump with one command, and you have tested it.
- The checkout and workspace hold **no production credentials** and have **no route to
  production**: no SSH keys to the production host, no production database credentials in
  config, no deploy tokens.
- Remove or neutralize anything that can write outward. On DDEV projects with a custom pull
  provider, check for `ddev push` support and stored hosts.
- Inventory what *is* reachable. Other keys in `~/.ssh` (for example to unrelated jump hosts)
  are outside this project but are not "no route to anything"; know what they are.
- Humans run anything interactive that needs a passphrase (`ddev auth ssh`, `ddev pull`).
  The agent never does.

## Layer 2: tell the agent, in the repo (`AGENTS.md`)

Copy [`templates/AGENTS.md.example`](../templates/AGENTS.md.example) into the site repo as
`AGENTS.md` and fill it in. It states, in plain prose:

- what the environment is and how to restore it,
- what destructive work is expected and fine,
- what is **not** disposable (production, the frozen baseline),
- the ground rules: reproduce, don't repair; log discoveries; scripts report counts.

Per-site facts live in the site repo, because they are facts about that checkout.

> **Verify for your Claude Code version:** this kit uses `AGENTS.md`. If your version does not
> load it, create a `CLAUDE.md` containing only `@AGENTS.md`. Whether the auto-mode
> classifier reads it the same way as `CLAUDE.md` is also worth confirming in rehearsal.
>
> Instruction files are context, not rules, and can be lost when a long conversation is
> compacted. That is why Layers 3 and 4 exist.

## Layer 3: tell the classifier, in user settings

Copy [`templates/claude-user-settings.example.json`](../templates/claude-user-settings.example.json)
into `~/.claude/settings.json` (merging with what is there) and run in auto mode:

- `autoMode.environment` describes trusted infrastructure and what the workspace is;
  `autoMode.allow` lists the operations that are fine. They are prose, not regexes, and
  `"$defaults"` keeps the built-in rules.
- **Scope matters.** The classifier reads `autoMode` only from user settings, managed
  settings or the `--settings` flag. It deliberately ignores project `.claude/settings.json`,
  so a repository cannot grant itself permission. The kit can ship a template but cannot
  enforce it; each person copies it into their own settings.
- `permissions.allow` rules skip the classifier for commands you repeat (`ddev mysql`,
  `ddev exec`). Bash patterns are a convenience, not a security control: `sh -c`, absolute
  paths and variables get around them.
- `permissions.deny` rules for `ddev pull`, `ddev push` and `ddev auth ssh` always win.

Inspect what the classifier actually sees with `claude auto-mode config`.

## Layer 4: a deterministic tripwire (optional)

[`templates/hooks/deny-production.sh`](../templates/hooks/deny-production.sh) is a
`PreToolUse` hook that blocks any shell command matching a regex in
`.agent-protected-patterns` at the project root (for example the production hostname, and
`ddev (pull|push)`). Register it in the project's `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/path/to/deny-production.sh" }
        ]
      }
    ]
  }
}
```

It is a tripwire, not a wall: text matching can be evaded. It earns its place because it fails
loudly and deterministically even after context compaction. Hooks can tighten decisions but
cannot loosen a deny rule.

## Fallback for a live demo

`claude --dangerously-skip-permissions` (equivalently `--permission-mode bypassPermissions`)
removes every prompt. It works on Coder because the workspace user is not root, but it also
disables protected-path checks for `.git/` and `.claude/`. Use it only when Layer 1 is true,
and treat it as the fallback, not the plan.

## Rehearse it

Run the session's real prompts in auto mode ahead of time and record every block. Each block
becomes a line in `autoMode.environment`/`allow` or `permissions.allow`; keep that list in the
run sheet. A classifier surprise during the recording is a rehearsal failure, not a demo.

## Where each piece lives

| Piece | Location | Why |
|---|---|---|
| Template `AGENTS.md`, settings, hook, this doc | kit | Generic and reusable |
| Filled-in `AGENTS.md` | each site repo | Facts about that checkout |
| `.agent-protected-patterns` | each site repo | That site's hostnames |
| `autoMode` and permission rules | each person's `~/.claude/settings.json` | Only honored there; cannot be shipped by a repo |
