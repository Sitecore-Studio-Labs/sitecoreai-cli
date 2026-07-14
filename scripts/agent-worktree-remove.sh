#!/usr/bin/env bash
#
# Remove a sibling agent worktree after work is merged or abandoned.
#
# Usage: scripts/agent-worktree-remove.sh <slug> [--force]
#
# Refuses to remove if there are uncommitted changes in the worktree.
# Re-run with --force to override (only after confirming nothing is lost).

set -euo pipefail

SLUG=${1:?"Usage: $0 <slug> [--force]"}
FORCE=${2:-}

REPO_ROOT=$(git rev-parse --show-toplevel)
REPO_NAME=$(basename "$REPO_ROOT")
WORKTREE_DIR="${REPO_ROOT}/../${REPO_NAME}-${SLUG}"

if [ ! -d "$WORKTREE_DIR" ]; then
  echo "[agent-worktree] no worktree at $WORKTREE_DIR" >&2
  exit 1
fi

# Capture the branch this worktree was on before removal so we can
# offer to delete it. Auto-save commits in branch-create cycles
# accumulate; the operator usually wants to reap the agent/* branch
# after merging its work.
WORKTREE_BRANCH=$(git -C "$WORKTREE_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

if [ "$FORCE" = "--force" ]; then
  git worktree remove "$WORKTREE_DIR" --force
else
  if ! git worktree remove "$WORKTREE_DIR" 2>&1; then
    cat >&2 <<EOF

[agent-worktree] removal refused — the worktree is not clean:

$(git -C "$WORKTREE_DIR" status --short | head -20)

[agent-worktree] Note: pnpm 11 may leave an untracked pnpm-workspace.yaml
[agent-worktree] (its allowBuilds scaffold) — that one is safe to lose.
[agent-worktree] If you're sure nothing is lost, re-run with --force:
[agent-worktree]   $0 ${SLUG} --force
EOF
    exit 1
  fi
fi

echo "[agent-worktree] removed $WORKTREE_DIR"

if [[ "$WORKTREE_BRANCH" == agent/* ]]; then
  cat <<EOF

[agent-worktree] worktree was on branch: $WORKTREE_BRANCH
[agent-worktree] if its work has been merged, delete it with:
  git branch -D $WORKTREE_BRANCH
EOF
fi
