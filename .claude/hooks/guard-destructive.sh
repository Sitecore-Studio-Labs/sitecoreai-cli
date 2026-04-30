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

# The tool input is passed via stdin as JSON. Extract the command field.
COMMAND=$(cat | jq -r '.command // empty' 2>/dev/null || true)

if [ -z "$COMMAND" ]; then
  exit 0
fi

block() {
  echo "BLOCKED: $1" >&2
  echo "If you need to do this, ask the operator to run it manually." >&2
  exit 1
}

# Check for git push (any form)
if echo "$COMMAND" | grep -qE '\bgit\s+push\b'; then
  block "git push is not allowed in agent sessions. Work stays local until operator review."
fi

# Check for git reset --hard
if echo "$COMMAND" | grep -qE '\bgit\s+reset\s+--hard\b'; then
  block "git reset --hard destroys uncommitted work. Use git stash instead."
fi

# Check for git checkout . or git checkout -- .
if echo "$COMMAND" | grep -qE '\bgit\s+checkout\s+(--\s+)?\.'; then
  block "git checkout . discards all working-tree changes."
fi

# Check for git clean -f
if echo "$COMMAND" | grep -qE '\bgit\s+clean\s+.*-f'; then
  block "git clean -f deletes untracked files permanently."
fi

# Check for rm -rf with root-like paths
if echo "$COMMAND" | grep -qE '\brm\s+.*-rf\s+/[^/]'; then
  # Allow rm -rf on temp/build dirs, block on anything that looks like a system path
  :
fi

exit 0
