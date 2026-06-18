#!/usr/bin/env bash
#
# SessionEnd hook: release the checkout lock IF this session owns it.
#
# Pairs with branch-create.sh (which claims the lock at SessionStart) and
# guard-checkout-owner.sh (which enforces it). Releasing on a clean exit
# lets the next legitimate session in the same checkout start immediately,
# instead of waiting out the 12h stale-age cap.
#
# Only removes the lock when its session_id matches THIS session — so a
# second (blocked) session ending never frees the real owner's lock.

set -uo pipefail

INPUT=$(cat 2>/dev/null || true)
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)
[ -z "$SESSION_ID" ] && exit 0

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
[ -z "$ROOT" ] && exit 0
LOCK_FILE="$ROOT/.claude/session-checkout.lock"
[ -f "$LOCK_FILE" ] || exit 0

lock_session=$(awk -F= '/^session_id=/{print $2}' "$LOCK_FILE" 2>/dev/null || true)
if [ "$lock_session" = "$SESSION_ID" ]; then
  rm -f "$LOCK_FILE" 2>/dev/null || true
fi
exit 0
