# scai (SitecoreAI Deploy & Sync CLI) — agent workflow

## #1 rule (non-negotiable)

**One checkout/worktree per active agent session.** Never run two agents in
the same checkout at the same time. Parallel work must use separate git
worktrees (or separate clones), each with its own branch.

## What scai is

A native TypeScript CLI for working with SitecoreAI: serialization
(Sitecore Content Serialization YAML pull/push/diff/validate/watch via the
Authoring + Management GraphQL APIs) and the Deploy API (organizations,
projects, environments, deployments, source control, editing hosts, logs).

Models the dotnet `Sitecore.DevEx` CLI conceptually but runs natively
(no .NET dependency). Built with first-class agent integration —
`--non-interactive`, `--json`, `--quiet`, `SITECOREAI_AUTO_WIZARD=0`.

CLI command: `scai` (alias: `sitecoreai-cli`).

## Layers

```
src/cli.ts                       ← entrypoint
src/commands/                    ← commander definitions, thin parsers
src/config/                      ← sitecoreai.cli.json + module schemas
src/serialization/
  ├── tasks/                     ← runners for push/pull/diff/validate/watch
  ├── sitecore-api/              ← Authoring + Management GraphQL clients
  └── filesystem-store/          ← SCS YAML store (items/roles/users)
src/deploy/api/                  ← Deploy API HTTP client
src/shared/                      ← logger, errors, telemetry, spinner
```

Imports flow inward. `commands/` reaches anywhere; `serialization/`
internals don't reach back into `commands/`.

## Skills (system of record)

Project knowledge lives in `.claude/skills/`. Skills trigger automatically
when your task matches their description. CLAUDE.md is the map; skills are
the territory.

| Skill                  | When it triggers                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `design-principles`    | Any non-trivial implementation (research-first, prefer libraries, credentials are keychain-only) |
| `codebase-conventions` | Writing or modifying code (module structure, error contract, agent contract, quality gates)      |
| `local-dev`            | Running, building, or testing scai locally (`pnpm dev -- <command>`, env vars, sandbox tenant)   |
| `testing-conventions`  | Writing tests (unit/integration tiers, keychain mocking, integration gating)                     |
| `friction`             | Capturing a friction moment so it doesn't recur (`/friction`)                                    |
| `review-harness`       | Auditing memory/skill freshness                                                                  |

## Automated hooks

Three hooks in [.claude/settings.json](.claude/settings.json) run
automatically; the harness (not Claude) executes them.

- **SessionStart → `.claude/hooks/branch-create.sh`** — sweeps dirty tree,
  switches to a fresh `agent/*` branch, enforces checkout lock.
- **PreToolUse on Bash → `.claude/hooks/guard-destructive.sh`** — blocks
  `git push`, `git reset --hard`, `git checkout .`, `git clean -f`.
- **Stop → `.claude/hooks/auto-save.sh`** — commits session changes tagged
  `[auto-save]` (clean) or `[auto-save-dirty]` (failed `pnpm check`).
  Never pushes, never amends.

## Operator workflow

- `dev` is the integration branch. Agent work lands on `agent/*`.
- Review an `agent/*` branch, then `git merge --squash` into `dev` with a
  meaningful commit message.
- `dev` → `main` is the publish path; merging to `main` triggers the
  Changesets release workflow.
- `[auto-save]` commits are noisy on purpose — squash when merging so
  the `dev` history reads cleanly.
- Delete `agent/*` branches after merge.

## Quality gates

| Command                 | Purpose                                                              |
| ----------------------- | -------------------------------------------------------------------- |
| `pnpm check`            | `format:check` + `lint` + `typecheck` + `test` (auto-save uses this) |
| `pnpm test`             | Vitest unit tests                                                    |
| `pnpm test:integration` | Integration tests (gated by `SITECOREAI_RUN_INTEGRATION=1`)          |
| `pnpm smoke`            | Build + spawn-based smoke checks                                     |

## When things go wrong

- Hook failures never block the session.
- Crashed sessions: next SessionStart commits leftovers as
  `[auto-save] recovered dirty tree …` before branching.
- Hooks never push — nothing leaks to a remote automatically.

## Operator recovery: stale checkout lock

```bash
cat .claude/session-checkout.lock
rm -f .claude/session-checkout.lock   # only after confirming no active session
```

## Branch naming caveat

Hooks treat **only** `agent/*` as a session branch. Other branch prefixes
(`fix/*`, `feature/*`, `harness/*`) trigger a dirty-tree sweep and a new
`agent/*` checkout on next SessionStart.

## Where to find docs (not skills)

- [README.md](README.md) — landing page for the CLI (install + quick start)
- [AGENTS.md](AGENTS.md) — guidance for AI agents _using_ scai
  (consumer-facing); distinct from this harness which is for agents
  _working on_ scai. Includes the CI / non-interactive contract.
- [docs/](docs/) — reference docs (configuration, serialization, deploy,
  telemetry-and-privacy, release, quality-gates, roadmap)
- [docs/commands.md](docs/commands.md) — full command tree, auto-generated
  from `src/commands/` via `pnpm docs:commands`
- [skills/](skills/) — bundled SKILL files for AI agents _using_ scai
  (also consumer-facing); not the same as `.claude/skills/`
