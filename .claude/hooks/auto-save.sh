#!/usr/bin/env bash
#
# Stop hook: commit whatever the session changed so parallel agent sessions
# can't clobber work via `git stash`. Commits land on the current branch
# (typically the per-session branch created by branch-create.sh). Never
# pushes, never amends — pure local safety net.
#
# Also releases the checkout lock created by SessionStart so the next session
# can start in this checkout.
#
# Tags the commit based on whether `pnpm run check` passes:
#   [auto-save]       — typecheck + lint + unit tests all green
#   [auto-save-dirty] — one or more checks failed (work still preserved)
#
# Appends a session summary to the commit message body:
#   - files changed count
#   - insertions/deletions
#   - check status
#
# Preservation > gating: we always commit, even on failure. CI is the gate
# at merge time; this hook surfaces broken session commits on review
# without destroying work.

set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo '.')"
LOCK_FILE=".claude/session-checkout.lock"

# Only release the lock if THIS process owns it. The Stop hook fires at
# the end of every user-message turn, not on agent-process exit — without
# the pid scope, the lock was being wiped between turns and concurrent
# sessions in the same checkout were able to coexist (defeats RULE #1).
# Cleanup of the lock for a crashed session is handled in branch-create.sh
# via the pid-liveness check on next SessionStart.
release_lock() {
  [ -f "$LOCK_FILE" ] || return 0
  lock_pid=$(awk -F= '/^pid=/{print $2}' "$LOCK_FILE" 2>/dev/null || true)
  our_pid="${CLAUDE_AGENT_PID:-$PPID}"
  if [ "$lock_pid" = "$our_pid" ]; then
    rm -f "$LOCK_FILE" 2>/dev/null || true
  fi
}
trap release_lock EXIT

if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  exit 0
fi

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
TAG="[auto-save]"
CHECK_STATUS="skipped"

# Never auto-commit on a protected/shared branch. Auto-saving to dev/main
# pollutes shared history with `[auto-save]` commits, can capture a parallel
# session's WIP or node_modules churn (`git add -A`), and has caused real
# cross-session tangles. The per-session `agent/*` branch (from
# branch-create.sh) is the only safe target — if a session is sitting on a
# protected branch, leave the work dirty for the operator to place deliberately.
case "$BRANCH" in
  dev | main | master | release | changeset-release/*)
    echo "auto-save: on protected branch '${BRANCH}' — skipping auto-commit; work left dirty for deliberate placement." >&2
    exit 0
    ;;
esac

# Run checks only when the project is installed and has a `check` script.
# Hook must never block the session, so failures here just mark the commit.
if [ -d node_modules ] && [ -f package.json ] && grep -q '"check"' package.json; then
  if pnpm run --silent check >/dev/null 2>&1; then
    CHECK_STATUS="passed"
  else
    TAG="[auto-save-dirty]"
    CHECK_STATUS="failed"
  fi
fi

# Build session summary for the commit body.
DIFF_STAT=$(git diff --cached --stat --stat-width=60 2>/dev/null || git diff --stat --stat-width=60 2>/dev/null || echo "  (stat unavailable)")
SHORTSTAT=$(git diff --shortstat 2>/dev/null || echo "")
FILES_CHANGED=$(git diff --name-only 2>/dev/null | wc -l | tr -d ' ')
UNTRACKED=$(git ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')

git add -A

COMMIT_MSG=$(cat <<EOF
${TAG} session end on ${BRANCH} at ${TIMESTAMP}

Session summary:
  check: ${CHECK_STATUS}
  files changed: ${FILES_CHANGED} modified, ${UNTRACKED} new
  ${SHORTSTAT}
EOF
)

git commit -m "$COMMIT_MSG" \
  --no-verify --no-gpg-sign >/dev/null 2>&1 || true
