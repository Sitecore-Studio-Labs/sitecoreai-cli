# scai (SitecoreAI Deploy & Sync CLI) — agent workflow

## #1 rule (non-negotiable)

**One checkout/worktree per active agent session.** Never run two agents in
the same checkout at the same time. Parallel work must use separate git
worktrees (or separate clones), each with its own branch.

## What scai is

A native TypeScript CLI **and** typed SDK for working with SitecoreAI —
the developer's toolkit across the SitecoreAI product surface: Deploy API,
Content Serialization, Recipes, publishing, content hygiene, brand,
briefs, campaigns, sites, workflow, webhooks, and agent automation.

Models the dotnet `Sitecore.DevEx` CLI conceptually but runs natively
(no .NET dependency). Built with first-class agent integration —
`--non-interactive`, `--json`, `--quiet`, `SITECOREAI_AUTO_WIZARD=0`, a
built-in MCP server.

CLI command: `scai` (alias: `sitecoreai-cli`).

## Layers and module boundaries

`src/` is organized into 22 **domain areas** plus three cross-cutting
layers. The domain areas:

```
deploy   serialization  setup    recipe   brand    brief    campaigns
sites    publishing     content  hygiene  webhooks workflow
agents   policy         mcp      scripting sync     auth      authoring
doctor   telemetry
```

`setup/` is the environment-setup orchestration area: it owns the env
lifecycle (init/onboard, credential minting, org/CM client provisioning,
tenant bootstrap) and is the one area that _composes_ `deploy`, `recipe`,
and `brand` for that flow. It was extracted from `serialization/tasks/env/`
so that `serialization/` no longer imports `@/deploy`, `@/recipe`, or
`@/brand` — those downward-odd edges now live in `setup/` as ordinary
peer-area imports (`setup → deploy/recipe/brand` is allowed).

Each domain area is a directory under `src/` that owns one product
surface (its API client, task runners, and — where it has one — an
`index.ts` SDK barrel). `auth/` and `authoring/` are the cross-domain
seams — `auth/` re-exports OAuth client-credentials primitives that
were de facto shared across publishing/brand/brief/etc., and
`authoring/` re-exports the Sitecore Authoring GraphQL transport +
site discovery used cross-domain. The `auth/` implementation now lives
in `auth/` itself (`client-credentials`/`factory`/`types`), with
`serialization/api/auth.ts` a thin forwarder; the `authoring/`
implementation lives in `serialization/api/` (GraphQL transport) and
`recipe/api/` (authoring-client, site-discovery), re-exported here.
New cross-area callers import via `@/auth` and `@/authoring`, and a
dependency-cruiser rule (`auth-authoring-seam`) enforces that no other
area reaches those implementations directly. The cross-cutting layers:

```
src/cli.ts        ← entrypoint; src/program.ts builds the Commander tree
src/commands/     ← Commander command definitions, thin parsers
src/config/       ← sitecoreai.cli.json + module schemas, config resolution
src/shared/       ← logger, errors, spinner, HTTP/GraphQL transport
```

(`telemetry/` is a domain area, listed above — it reads `config/` and
sends events like any other area, so it is not a cross-cutting layer.)

**Import rules:**

- `commands/` may import any domain area, `config/`, and `shared/`.
- A domain area may import **peer domain areas**, `config/`, and
  `shared/` — but never `commands/`.
- `config/` may import `shared/` (and the `serialization/` schema types it
  validates against — the one sanctioned `config → serialization` edge, in
  `config/modules.ts`).
- **`src/shared/` is a leaf.** It must not import any domain area or
  `commands/`. Type-only imports of `@/config` declarations are
  allowed (`config/types` is itself a leaf). The former `shared↔policy`
  cycle was removed by moving `allow-write` and `env` out of `shared/`
  into `policy/` (now `policy/allow-write.ts` and `policy/environment.ts`).
- **`content/` must not import `publishing/`.** `publishing` is the
  higher layer and may depend on `content`; the reverse edge — the old
  `content↔publishing` cycle — was removed by relocating the shared
  `audit` / `consent` / `env-tier` modules into `shared/`.
- A targeted import-graph test
  (`tests/unit/architecture/module-boundaries.test.ts`) enforces the
  two invariants above. It is **not** a full cycle detector — peer
  domain areas may still cross-import (e.g. `sync` aggregates
  `brand`/`brief`); the hard, enforced invariant is that `shared/`
  stays a leaf.

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

Five hook scripts across four events in
[.claude/settings.json](.claude/settings.json) run automatically; the
harness (not Claude) executes them.

- **SessionStart → `branch-create.sh`** — sweeps dirty tree, switches to a
  fresh `agent/*` branch, claims the checkout lock.
- **PreToolUse (Edit/Write/Bash) → `guard-checkout-owner.sh`** — blocks
  mutations when another live session owns this checkout. Fails open.
- **PreToolUse (Bash) → `guard-destructive.sh`** — blocks `git push`,
  `git reset --hard`, `git checkout .`, `git clean -f`. Matters most here:
  `main` is the publish branch, so a push could ship an npm release.
- **Stop → `auto-save.sh`** — commits session changes tagged `[auto-save]`
  (clean) or `[auto-save-dirty]` (failed `pnpm check`). Never pushes,
  never amends.
- **SessionEnd → `release-lock.sh`** — releases the checkout lock.

Full reference: [docs/agent-harness.md](docs/agent-harness.md).

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
