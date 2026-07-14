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

# Owner is alive and is a DIFFERENT session. The rule is hard-block
# *mutations*, not read-only visibility — so a blocked session can still look
# around and, crucially, can still clear a stale lock to recover (the lock
# can only be removed via Bash, which this hook also gates).
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // "this tool"' 2>/dev/null || echo "this tool")
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)

# Mutating shell commands (non-git), checked at a command position.
MUTATING_CMDS='rm rmdir mv cp mkdir touch tee truncate ln chmod chown dd install npm pnpm yarn npx bun vim vi nano emacs code patch tsc next biome vitest playwright python3 python node'
# git subcommands that change state (read-only ones like status/log/diff/show
# fall through and are allowed). Surrounded by spaces for whole-word matching.
GIT_WRITE_SUBS=' commit add push pull fetch merge rebase reset checkout switch clean stash tag branch rm mv restore apply cherry-pick revert am gc prune worktree init clone remote config update-ref update-index notes filter-branch '
# git global options that consume the FOLLOWING token as their value, so the
# token-walk skips past them to find the real subcommand.
GIT_OPTS_WITH_VALUE=' -c -C --git-dir --work-tree --namespace '

# Returns 0 (true) if the Bash command would change state. Read-only commands
# (git status/log/diff, gh, ls, cat, grep, …) return 1 so a non-owner can look.
is_mutating() {
  local c="$1" s

  # 1. File-writing redirects. Strip the safe stderr/null forms first
  #    (2>&1, >&2, >/dev/null, 2>/dev/null, &>/dev/null) — matched as whole
  #    sequences — then any redirect left over targets a file.
  s=$(printf '%s' "$c" | sed -E 's/[0-9]?>&[0-9]//g; s/(&>|[0-9]?>)[[:space:]]*\/dev\/null//g')
  printf '%s' "$s" | grep -qE '>>?' && return 0

  # 2. In-place stream editors (sed -i / perl -i), checked per shell segment
  #    so a later `…; sed -i …` isn't hidden behind an earlier pipe.
  printf '%s' "$c" | tr '|;&' '\n' \
    | grep -qE '^[[:space:]]*(sudo[[:space:]]+)?(sed|perl)\b.*[[:space:]]-i' && return 0

  # 3. A mutating command at a command position (start, or after ; & | && ||).
  local mut_alt
  mut_alt=$(printf '%s' "$MUTATING_CMDS" | tr ' ' '|')
  printf '%s' "$c" \
    | grep -qE "(^|[;&|(]|&&|\|\|)[[:space:]]*(sudo[[:space:]]+)?(${mut_alt})\b" && return 0

  # 4. A git write subcommand. Token-walk past any global options so
  #    `git -c x=y commit` / `git --git-dir=… push` aren't hidden, and
  #    read-only subcommands pass through.
  local -a parts=()
  read -r -a parts <<<"$c"
  local n=${#parts[@]} i=0 j tok sub
  while [ "$i" -lt "$n" ]; do
    if [ "${parts[i]:-}" = "git" ]; then
      j=$((i + 1)); sub=""
      while [ "$j" -lt "$n" ]; do
        tok="${parts[j]:-}"
        case "$tok" in
          --) j=$((j + 1)); sub="${parts[j]:-}"; break ;;
          --git-dir=*|--work-tree=*|--namespace=*) j=$((j + 1)); continue ;;
          -*)
            case "$GIT_OPTS_WITH_VALUE" in
              *" $tok "*) j=$((j + 2)) ;;  # option takes the next token as value
              *) j=$((j + 1)) ;;
            esac
            continue
            ;;
          *) sub="$tok"; break ;;
        esac
      done
      case "$GIT_WRITE_SUBS" in *" $sub "*) return 0 ;; esac
    fi
    i=$((i + 1))
  done

  return 1
}

# Returns 0 (true) if the command is a pure lock-clear: `rm [flags] <path…>`
# where every non-flag arg is a `.claude/session-checkout.lock` path (relative
# OR absolute, one or many) and there is no chaining / redirect / command
# substitution / newline that could smuggle a second command past the guard.
# This is the in-band recovery from a stale or foreign lock — a blocked session
# (or the operator) MUST be able to clear it. Broader than the old
# relative-single-file-only form, which rejected the natural `rm -f <abs path>`
# and dual-repo clears and left sessions stuck.
is_lock_clear() {
  local c="$1"
  case "$c" in
    *';'* | *'&'* | *'|'* | *'>'* | *'<'* | *'`'* | *'$('* | *$'\n'*) return 1 ;;
  esac
  local -a parts=()
  read -r -a parts <<<"$c"
  { [ "${#parts[@]}" -ge 2 ] && [ "${parts[0]}" = "rm" ]; } || return 1
  local i tok saw=0
  for ((i = 1; i < ${#parts[@]}; i++)); do
    tok="${parts[i]}"
    case "$tok" in
      -*) continue ;;
      *.claude/session-checkout.lock) saw=1 ;;
      *) return 1 ;;
    esac
  done
  [ "$saw" -eq 1 ]
}

if [ "$TOOL" = "Bash" ]; then
  # Always allow clearing the checkout lock(s) — the in-band recovery from a
  # stale/foreign lock. Accepts `rm -f`, absolute paths, and multiple lock
  # files; rejects any chaining/redirect that could smuggle a mutation.
  if is_lock_clear "$CMD"; then
    exit 0
  fi
  # Read-only command from a non-owner: allow (look, don't touch).
  if ! is_mutating "$CMD"; then
    exit 0
  fi
fi

# Mutating tool / mutating Bash from a foreign session → BLOCK.
cat >&2 <<EOF
BLOCKED (#1 rule): another agent session already owns this checkout.
  owner session_id=${lock_session} pid=${lock_pid}
  this session=${SESSION_ID}
${TOOL} was blocked to prevent two agents corrupting one working tree.

Run this agent in its own git worktree instead:
  scripts/agent-worktree-create.sh <slug>     # creates ../<repo>-<slug>; open a new session there

If that other session is actually dead and this lock is stale, clear it with a
standalone rm (no chained commands; -f and absolute paths are fine):
  rm -f .claude/session-checkout.lock
EOF
# Exit 2 is the PreToolUse "deny" signal: it blocks the tool and feeds the
# message above back to the agent. Any other non-zero code would NOT block.
exit 2
