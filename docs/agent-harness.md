# The agent harness

This repo is built to be worked on by AI coding agents (Claude Code) as well as
humans. The harness is the machinery that makes that safe and repeatable:
skills, hooks, a checkout lock, and branch automation.

If you inherit this repo, read this page before your first agent session — most
of the harness is invisible until it fires, and two of the hooks will actively
block you if you don't know they exist.

> **Don't confuse the two "skills" directories.**
> - `.claude/skills/` — this harness. Guidance for agents **working on** scai.
> - `skills/` (repo root, shipped in the npm package) — consumer-facing SKILL
>   files for agents **using** scai. Same for `AGENTS.md` vs this page.
>
> Editing one when you meant the other is the most common mistake here.

The same harness runs in `demo-orchestrator` and `sitecoreai-showcase`. The hook
scripts are identical; the skill sets differ.

---

## The model: CLAUDE.md is the map, skills are the territory

[CLAUDE.md](../CLAUDE.md) loads into **every** agent session, so it stays short —
an orientation page and a routing table. Detail lives in `.claude/skills/`, which
load **on demand** when a task matches a skill's `description`.

The split is a context-budget decision: CLAUDE.md costs tokens every session
whether relevant or not; a skill costs nothing until it triggers.

> Put project knowledge in a skill. Add a line to CLAUDE.md's table only if an
> agent would not otherwise know the skill exists.

### Skills in this repo

| Skill | Triggers on |
|---|---|
| `design-principles` | Any non-trivial implementation — research-first, prefer libraries, credentials are keychain-only |
| `codebase-conventions` | Writing or modifying code — module structure, error contract, agent contract, quality gates |
| `local-dev` | Running or testing scai locally (`pnpm dev -- <command>`, env vars, sandbox tenant) |
| `testing-conventions` | Writing tests — unit/integration tiers, keychain mocking, integration gating |
| `friction` | Capturing a friction moment (`/friction`) |
| `review-harness` | Auditing the harness itself for staleness |

Six skills — the smallest set of the three repos, because scai's structure is
regular. Every product area ships the same four surfaces (SDK subpath → CLI
command group → MCP tool → recipe kind where it fits), so one
`codebase-conventions` skill covers what needs a dedicated scaffolding skill in
the showcase.

**If you add an area-specific skill, the four-surface checklist is the thing
worth encoding** — it is the pattern set by deploy, serialization, recipes,
publishing, brand, brief, and campaign, and it is currently documented only in
prose in `docs/roadmap.md`.

A skill is a directory with a `SKILL.md` carrying YAML frontmatter. The
`description` is the **only** thing an agent sees before deciding to load it —
write it as a trigger list, not a summary.

### Keeping skills honest

```
/review-harness
```

**A stale skill is worse than no skill**, because agents trust it.

---

## Hooks

Four hook events are wired in [.claude/settings.json](../.claude/settings.json),
running five scripts in `.claude/hooks/`. The harness — not the agent — runs
them; agents cannot skip or disable them.

| Event | Script | What it does |
|---|---|---|
| `SessionStart` | `branch-create.sh` | Sweeps a dirty tree, creates a fresh `agent/*` branch, claims the checkout lock |
| `PreToolUse` (Edit/Write/Bash) | `guard-checkout-owner.sh` | **Blocks** mutations when another live session owns this checkout |
| `PreToolUse` (Bash) | `guard-destructive.sh` | **Blocks** `git push`, `git reset --hard`, `git checkout .`, `git clean -f` |
| `Stop` | `auto-save.sh` | Commits session changes; releases the lock |
| `SessionEnd` | `release-lock.sh` | Releases the lock if this session owns it |

> CLAUDE.md long described three hooks. There are five scripts across four
> events. Where the two disagree, `.claude/settings.json` is the truth.

**`branch-create.sh`** names branches `agent/YYYY-MM-DDTHH-MM-SSZ-<short-sha>`
and skips creation when already on `agent/*`. Only `agent/*` counts as a session
branch — starting on `fix/*`, `feature/*`, `harness/*`, `dev`, or `main`
triggers a sweep and a new `agent/*` checkout.

**`guard-checkout-owner.sh`** is the enforcement half of rule #1 (one checkout
per session). `branch-create.sh` can detect a second session but cannot stop one
— a non-zero `SessionStart` exit doesn't abort a session. This hook blocks
mutating calls when the lock belongs to a different live session. It **fails
open** on every uncertain path; it blocks only when it positively knows another
live session owns the checkout. Read-only tools are never matched.

**`guard-destructive.sh`** matters more here than in the other two repos:
`main` is the **publish** branch. A merge to `main` triggers the Changesets
release workflow, which publishes to npm. An agent that could `git push` could
ship a release. It cannot.

**`auto-save.sh`** commits whatever changed, tagged by gate result:
`[auto-save]` when `pnpm check` passed (`format:check` + `lint` + `typecheck` +
`test`), `[auto-save-dirty]` when it didn't. Never pushes, never amends.

---

## The checkout lock

`.claude/session-checkout.lock` holds the owning session id, a pid, and a
timestamp. Claimed at SessionStart, enforced on every mutation, released at Stop
and SessionEnd. A 12-hour age cap frees abandoned locks.

Manual recovery, only after confirming nothing is running:

```bash
cat .claude/session-checkout.lock
rm -f .claude/session-checkout.lock
```

Parallel sessions need separate worktrees:

```bash
git worktree add ../scai-<slug> -b agent/<slug> dev
```

---

## Branch and merge workflow

```
agent/*  ──squash──▶  dev  ──merge──▶  main  ──▶  Changesets release ──▶ npm
```

- `dev` is the integration branch; agent work lands on `agent/*` and is
  `git merge --squash`ed in with a meaningful message.
- `dev` → `main` is the **publish path**. Merging to `main` triggers the release
  workflow.
- Delete `agent/*` branches after merge.
- `[auto-save]` commits are noisy on purpose — squash so `dev` reads cleanly.

### Changesets

Every user-visible change needs a changeset (`pnpm changeset`). The roadmap calls
this out explicitly as a recurring gap: **keep every new verb and the publishing
auth model named in a changeset** so the CHANGELOG stays complete. Agents forget
this constantly — it is worth adding to your review checklist rather than
trusting the harness to catch it.

---

## Related enforcement (not hooks, but the same intent)

| Gate | Enforces |
|---|---|
| `pnpm check` | `format:check` + `lint` + `typecheck` + `test` — what auto-save runs |
| `pnpm depcruise:check` | Module boundaries, including the `auth-authoring-seam` rule |
| `tests/unit/architecture/module-boundaries.test.ts` | `shared/` stays a leaf; `content/` never imports `publishing/` |
| `pnpm docs:commands:check` | `docs/commands.md` matches the actual Commander tree |
| `pnpm smoke` | Build + spawn-based smoke checks, including MCP and SDK exports |
| `coverage:ratchet` | Coverage can go up, never down |

The boundary test is **not** a full cycle detector — peer domain areas may still
cross-import (e.g. `sync` aggregates `brand`/`brief`). The hard, enforced
invariant is that `shared/` stays a leaf.

`docs:commands:check` is the one agents trip most: command definitions and the
generated doc must stay in sync, and the fix is `pnpm docs:commands`, not editing
`docs/commands.md` by hand.
