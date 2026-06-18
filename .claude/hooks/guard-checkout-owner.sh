#!/usr/bin/env bash
#
# PreToolUse hook: enforce the #1 rule — one checkout == one agent session.
#
# The SessionStart hook (branch-create.sh) can detect a second session but
# CANNOT stop it: a non-zero SessionStart exit doesn't abort the session.
# This hook is the enforcement: it runs before every mutating tool call
# (Edit/Write/MultiEdit/NotebookEdit/Bash) and BLOCKS (exit 2) when the
# checkout's lock is owned by a *different, still-live* agent session.
# Read-only tools are never matched, so a second session can still look
# around — it just can't change anything until it has its own worktree.
#
# Identity is the harness `session_id` (stable, on stdin). pid + a 12h age
# cap are liveness hints so a crashed owner's lock auto-frees.
#
# FAIL OPEN: every uncertain path (no lock, unparseable lock, missing
# session_id, not a git repo) ALLOWS the call. The hook only ever blocks
# when it positively knows another live session owns the checkout — so it
# can never brick a legitimate sole session.

set -uo pipefail

STALE_LOCK_MAX_AGE_SECONDS=$((12 * 60 * 60)) # 12h

INPUT=$(cat 2>/dev/null || true)
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)

# Can't identify this session → can't reason about ownership → allow.
[ -z "$SESSION_ID" ] && exit 0

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
[ -z "$ROOT" ] && exit 0
LOCK_FILE="$ROOT/.claude/session-checkout.lock"

now_epoch=$(date +%s 2>/dev/null || echo 0)

write_lock() {
  mkdir -p "$ROOT/.claude" 2>/dev/null || true
  cat >"$LOCK_FILE" <<EOF 2>/dev/null || true
created_epoch=${now_epoch}
created_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)
session_id=${SESSION_ID}
pid=${CLAUDE_AGENT_PID:-$PPID}
user=${USER:-unknown}
host=$(hostname 2>/dev/null || echo unknown)
cwd=${ROOT}
claimed_by=guard-checkout-owner
EOF
}

# No lock yet → claim ownership for this session (self-heal) and allow.
if [ ! -f "$LOCK_FILE" ]; then
  write_lock
  exit 0
fi

lock_session=$(awk -F= '/^session_id=/{print $2}' "$LOCK_FILE" 2>/dev/null || true)
lock_pid=$(awk -F= '/^pid=/{print $2}' "$LOCK_FILE" 2>/dev/null || true)
lock_epoch=$(awk -F= '/^created_epoch=/{print $2}' "$LOCK_FILE" 2>/dev/null || true)

# This session already owns the checkout → allow.
[ -n "$lock_session" ] && [ "$lock_session" = "$SESSION_ID" ] && exit 0

# Legacy / unowned lock (no session_id recorded) → adopt it and allow.
[ -z "$lock_session" ] && { write_lock; exit 0; }

# A different session owns it. Is that session still live?
lock_live=0
if [[ "$lock_pid" =~ ^[0-9]+$ ]] && kill -0 "$lock_pid" 2>/dev/null; then
  lock_live=1
fi
if [[ "$lock_epoch" =~ ^[0-9]+$ ]]; then
  age=$((now_epoch - lock_epoch))
  [ "$age" -gt "$STALE_LOCK_MAX_AGE_SECONDS" ] && lock_live=0
fi

# Owner is gone (crashed / ended without releasing) → reclaim and allow.
if [ "$lock_live" -ne 1 ]; then
  write_lock
  exit 0
fi

# Owner is alive → BLOCK this mutating tool call.
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // "this tool"' 2>/dev/null || echo "this tool")
cat >&2 <<EOF
BLOCKED (#1 rule): another agent session already owns this checkout.
  owner session_id=${lock_session} pid=${lock_pid}
  this session=${SESSION_ID}
${TOOL} was blocked to prevent two agents corrupting one working tree.

Run this agent in its own git worktree instead:
  scripts/agent-worktree-create.sh <slug>     # creates ../<repo>-<slug>, opens its own session

If that other session is actually dead and this lock is stale:
  rm .claude/session-checkout.lock
EOF
# Exit 2 is the PreToolUse "deny" signal: it blocks the tool and feeds the
# message above back to the agent. Any other non-zero code would NOT block.
exit 2
