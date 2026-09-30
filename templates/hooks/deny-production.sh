#!/usr/bin/env bash
# PreToolUse hook: deterministically block shell commands that mention production.
#
# Reads one regex per line from $CLAUDE_PROJECT_DIR/.agent-protected-patterns (blank lines
# and lines starting with # are ignored). Exit 2 blocks the command and sends the reason
# back to the agent. Exit 0 means "no opinion": normal permission handling continues.
#
# This is a tripwire, not a security boundary: shell wrapping (sh -c), variables and path
# tricks can evade text matching. The real protection is that the environment cannot reach
# production at all (no keys, no route). See docs/safe-demo-environment.md.
#
# Requires: jq. Register under hooks.PreToolUse with matcher "Bash".

set -uo pipefail

patterns_file="${CLAUDE_PROJECT_DIR:-$PWD}/.agent-protected-patterns"
[ -f "$patterns_file" ] || exit 0

command=$(jq -r '.tool_input.command // empty')
[ -n "$command" ] || exit 0

while IFS= read -r pattern; do
  case "$pattern" in ''|'#'*) continue ;; esac
  if printf '%s' "$command" | grep -Eq -- "$pattern"; then
    echo "Blocked: command matches protected pattern '$pattern'. This environment is a disposable copy and must not touch production. Ask the human if this is really needed." >&2
    exit 2
  fi
done < "$patterns_file"

exit 0
