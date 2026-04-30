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

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo '.')"

LOCK_FILE=".claude/session-checkout.lock"
STALE_LOCK_MAX_AGE_SECONDS=$((12 * 60 * 60)) # 12h
LOCK_CREATED=0

mkdir -p ".claude"

if [ -f "$LOCK_FILE" ]; then
  now_epoch=$(date +%s)
  lock_epoch=$(awk -F= '/^created_epoch=/{print $2}' "$LOCK_FILE" 2>/dev/null || true)
  if [[ "$lock_epoch" =~ ^[0-9]+$ ]]; then
    age=$((now_epoch - lock_epoch))
    if [ "$age" -gt "$STALE_LOCK_MAX_AGE_SECONDS" ]; then
      mv "$LOCK_FILE" "${LOCK_FILE}.stale-${now_epoch}" 2>/dev/null || true
    else
      cat >&2 <<'EOF'
[branch-create] RULE #1 violation: this checkout already has an active agent session.
[branch-create] Start this agent in a separate git worktree/clone (one checkout per agent).
[branch-create] If this lock is wrong, end the other session cleanly or remove .claude/session-checkout.lock.
EOF
      exit 42
    fi
  else
    mv "$LOCK_FILE" "${LOCK_FILE}.stale-${now_epoch}" 2>/dev/null || true
  fi
fi

cat >"$LOCK_FILE" <<EOF
created_epoch=$(date +%s)
created_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
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
