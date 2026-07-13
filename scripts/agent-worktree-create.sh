#!/usr/bin/env bash
#
# Create a sibling git worktree for parallel agent work.
#
# Usage: scripts/agent-worktree-create.sh <slug> [base-branch]
#
#   <slug>        — short identifier appended to the directory name
#                   (e.g. "envelope-fix" → ../sitecoreai-cli-envelope-fix)
#   [base-branch] — branch to base the worktree on (default: dev)
#
# After this runs, open the new worktree path in a separate editor window
# or agent session. The SessionStart hook there will create its own
# agent/* branch off the base. Each worktree has its own
# .claude/session-checkout.lock so the per-checkout rule is satisfied.

set -euo pipefail

SLUG=${1:?"Usage: $0 <slug> [base-branch=dev]"}
BASE=${2:-dev}

REPO_ROOT=$(git rev-parse --show-toplevel)
REPO_NAME=$(basename "$REPO_ROOT")
WORKTREE_DIR="${REPO_ROOT}/../${REPO_NAME}-${SLUG}"

if [ -d "$WORKTREE_DIR" ]; then
  echo "[agent-worktree] $WORKTREE_DIR already exists" >&2
  exit 1
fi

# Make sure base branch exists locally.
if ! git show-ref --verify --quiet "refs/heads/${BASE}"; then
  echo "[agent-worktree] base branch '${BASE}' not found locally" >&2
  echo "[agent-worktree] try: git fetch origin ${BASE}:${BASE}" >&2
  exit 1
fi

# Create the worktree on its own fresh agent/* branch. Checking out
# $BASE directly would fail whenever another worktree (often the main
# checkout) already has it checked out.
BRANCH="agent/$(date -u +%Y-%m-%dT%H-%M-%SZ)-${SLUG}"
git worktree add "$WORKTREE_DIR" -b "$BRANCH" "$BASE"

# Copy .env.local so the new worktree has the same dev-time secrets
# (sandbox tenant config etc.). Deliberately not a symlink: each
# worktree should be free to point at a different tenant.
if [ -f "$REPO_ROOT/.env.local" ]; then
  cp "$REPO_ROOT/.env.local" "$WORKTREE_DIR/.env.local"
  echo "[agent-worktree] copied .env.local"
fi

echo "[agent-worktree] running pnpm install in $WORKTREE_DIR..."
# pnpm may exit non-zero over ignored build scripts (esbuild) even
# though node_modules is usable — warn instead of aborting.
if ! (cd "$WORKTREE_DIR" && pnpm install --silent); then
  echo "[agent-worktree] pnpm install reported errors — check the output; node_modules is usually still usable" >&2
fi

cat <<EOF

[agent-worktree] ready: $WORKTREE_DIR

Next steps:
  1. Open $WORKTREE_DIR in a new editor window / agent session.
  2. Start an agent there. It is already on branch ${BRANCH}.
  3. When done: scripts/agent-worktree-remove.sh ${SLUG}

Reminders for parallel agents:
  - Releases go through changesets + the GitHub release train; never
    'pnpm publish' from a worktree.
  - Memory: ~/.claude/projects/.../memory/ is shared across worktrees.
    Avoid concurrent writes (memory updates are usually sparse, so OK).
EOF
