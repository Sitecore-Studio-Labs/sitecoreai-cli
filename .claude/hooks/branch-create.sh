#!/usr/bin/env bash
#
# SessionStart hook: ensure each agent session works on its own branch so
# concurrent sessions don't share a HEAD. Also sweeps up any dirty tree left
# behind by a previous session that crashed before its Stop hook ran.
#
# RULE #1: one checkout == one agent session. If a second session starts in
# this same checkout while another is active, we fail fast and tell the
# operator to use a separate git worktree.
#
# Branch naming: agent/YYYY-MM-DDTHH-MM-SSZ-<short-sha>
#
# Skips branch creation when:
#   - already on a branch matching agent/*  (resume an existing session)
#   - repo has no commits yet (nothing to branch from — leave on main)

set -euo pipefail

# Capture the hook payload (JSON on stdin) before anything else reads stdin.
# `.session_id` is the harness-stable identity for THIS agent session — far
# more reliable than a pid (which, via $PPID, points at a transient shell that
# dies right after the hook returns). The PreToolUse guard
# (guard-checkout-owner.sh) compares this id to enforce one-agent-per-checkout.
HOOK_STDIN=$(cat 2>/dev/null || true)
SESSION_ID=$(printf '%s' "$HOOK_STDIN" | jq -r '.session_id // empty' 2>/dev/null || true)

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo '.')"

LOCK_FILE=".claude/session-checkout.lock"
STALE_LOCK_MAX_AGE_SECONDS=$((12 * 60 * 60)) # 12h
LOCK_CREATED=0

mkdir -p ".claude"

if [ -f "$LOCK_FILE" ]; then
  now_epoch=$(date +%s)
  lock_epoch=$(awk -F= '/^created_epoch=/{print $2}' "$LOCK_FILE" 2>/dev/null || true)
  lock_pid=$(awk -F= '/^pid=/{print $2}' "$LOCK_FILE" 2>/dev/null || true)
  lock_session=$(awk -F= '/^session_id=/{print $2}' "$LOCK_FILE" 2>/dev/null || true)

  # Our own lock from a re-fired SessionStart (resume): just refresh it.
  if [ -n "$SESSION_ID" ] && [ "$lock_session" = "$SESSION_ID" ]; then
    mv "$LOCK_FILE" "${LOCK_FILE}.stale-${now_epoch}" 2>/dev/null || true
  else
    # A lock is "live" only when (a) its recorded pid is still running and
    # (b) it isn't past the stale-age cap. pid is a liveness hint; identity
    # is the session_id. If the holder crashed, its pid is gone → not live →
    # we reclaim. The age cap is a belt-and-suspenders backup.
    lock_live=0
    if [[ "$lock_pid" =~ ^[0-9]+$ ]] && kill -0 "$lock_pid" 2>/dev/null; then
      lock_live=1
    fi
    if [[ "$lock_epoch" =~ ^[0-9]+$ ]]; then
      age=$((now_epoch - lock_epoch))
      if [ "$age" -gt "$STALE_LOCK_MAX_AGE_SECONDS" ]; then
        lock_live=0
      fi
    fi
    if [ "$lock_live" -eq 1 ]; then
      # A DIFFERENT live session owns this checkout. We can't hard-stop from
      # SessionStart (a non-zero exit here doesn't abort the session), so we
      # warn loudly and leave their lock untouched — the PreToolUse guard
      # (guard-checkout-owner.sh) is what actually blocks this session's
      # mutating tools until it gets its own checkout/worktree.
      cat >&2 <<EOF
[branch-create] RULE #1 violation: this checkout is already owned by another active agent session.
[branch-create]   owner session_id=${lock_session:-unknown} pid=${lock_pid:-unknown}
[branch-create] This session's Edit/Write/Bash calls will be BLOCKED until it has its own checkout.
[branch-create] Spawn a worktree:  scripts/agent-worktree-create.sh <slug>
[branch-create] If the lock is stale, remove it: rm .claude/session-checkout.lock
EOF
      exit 0
    fi
    mv "$LOCK_FILE" "${LOCK_FILE}.stale-${now_epoch}" 2>/dev/null || true
  fi
fi

cat >"$LOCK_FILE" <<EOF
created_epoch=$(date +%s)
created_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
session_id=${SESSION_ID}
pid=${CLAUDE_AGENT_PID:-$PPID}
user=${USER:-unknown}
host=$(hostname 2>/dev/null || echo unknown)
cwd=$(pwd)
EOF
LOCK_CREATED=1

cleanup_on_error() {
  code=$?
  if [ "$code" -ne 0 ] && [ "$LOCK_CREATED" -eq 1 ]; then
    rm -f "$LOCK_FILE" 2>/dev/null || true
  fi
  exit "$code"
}
trap cleanup_on_error EXIT

# If no commits yet, nothing to branch from. Bail quietly.
if ! git rev-parse HEAD >/dev/null 2>&1; then
  exit 0
fi

# Sweep leftover dirty tree from a crashed prior session onto the CURRENT
# branch before we switch. Keeps that work recoverable.
if ! git diff --quiet || ! git diff --cached --quiet \
   || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  CURRENT=$(git rev-parse --abbrev-ref HEAD)
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  git add -A
  git commit -m "[auto-save] recovered dirty tree on ${CURRENT} at ${TIMESTAMP}" \
    --no-verify --no-gpg-sign >/dev/null 2>&1 || true
fi

# Wipe tsbuildinfo files. After resets, recoveries, or branch switches
# that change source files, tsc's incremental cache can claim "up to date"
# while .next/ or dist/ is empty — silently breaking imports of newly-added
# modules. Cheap to wipe; the next build regenerates them.
find . -path ./node_modules -prune -o \
       -name "tsconfig.tsbuildinfo" -type f -print 2>/dev/null \
  | xargs rm -f 2>/dev/null || true

CURRENT=$(git rev-parse --abbrev-ref HEAD)
case "$CURRENT" in
  agent/*) exit 0 ;;  # already on a session branch; reuse it
esac

TIMESTAMP=$(date -u +"%Y-%m-%dT%H-%M-%SZ")
SHORT_SHA=$(git rev-parse --short HEAD)
BRANCH="agent/${TIMESTAMP}-${SHORT_SHA}"

git checkout -b "$BRANCH" >/dev/null 2>&1
echo "[branch-create] switched to ${BRANCH}" >&2
trap - EXIT
