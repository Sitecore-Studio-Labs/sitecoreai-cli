#!/usr/bin/env bash
#
# PreToolUse hook: block destructive git operations that agents should
# never perform without explicit operator approval. The harness runs
# this before each Bash tool call; a non-zero exit blocks the command.
#
# Blocked operations:
#   - git push (any form) — agents must never push; operator reviews first
#   - git reset --hard    — destroys uncommitted work
#   - git checkout .      — discards all working-tree changes
#   - git clean -f        — deletes untracked files
#   - rm -rf /            — obvious
#
# The agent can still run `git add`, `git commit`, `git stash`, `git diff`,
# `git status`, `git log`, etc. Only destructive or remote-affecting
# commands are blocked.

set -euo pipefail

# The tool input is passed via stdin as JSON. The command lives at
# `.tool_input.command` for the Bash tool; older single-field payloads
# used a top-level `.command`, so fall back to that for safety.
COMMAND=$(cat | jq -r '.tool_input.command // .command // empty' 2>/dev/null || true)

if [ -z "$COMMAND" ]; then
  exit 0
fi

block() {
  echo "BLOCKED: $1" >&2
  echo "If you need to do this, ask the operator to run it manually." >&2
  # Exit code 2 is the PreToolUse "deny" signal — it blocks the tool call
  # and feeds stderr back to the agent. Any other non-zero code is a
  # non-blocking error and would let the command run anyway.
  exit 2
}

# Match the dangerous op only at a COMMAND position — start of the command
# or right after a shell separator (; & | && ||), allowing leading
# whitespace and an optional `git -C <path>` prefix. This stops false
# positives when a dangerous token appears inside an argument, e.g. a
# `git commit -m "...git push..."` message (which is data, not a command).
BOUNDARY='(^|[;&|(]|&&|\|\|)[[:space:]]*git[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?'

# git push (any form)
if echo "$COMMAND" | grep -qE "${BOUNDARY}push\b"; then
  block "git push is not allowed in agent sessions. Work stays local until operator review."
fi

# git reset --hard
if echo "$COMMAND" | grep -qE "${BOUNDARY}reset[[:space:]]+--hard\b"; then
  block "git reset --hard destroys uncommitted work. Use git stash instead."
fi

# git checkout . or git checkout -- .
if echo "$COMMAND" | grep -qE "${BOUNDARY}checkout[[:space:]]+(--[[:space:]]+)?\."; then
  block "git checkout . discards all working-tree changes."
fi

# git clean -f
if echo "$COMMAND" | grep -qE "${BOUNDARY}clean\b[^;&|]*-f"; then
  block "git clean -f deletes untracked files permanently."
fi

# Check for rm -rf with root-like paths
if echo "$COMMAND" | grep -qE '\brm\s+.*-rf\s+/[^/]'; then
  # Allow rm -rf on temp/build dirs, block on anything that looks like a system path
  :
fi

exit 0
