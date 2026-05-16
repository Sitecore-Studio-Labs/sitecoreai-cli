---
name: local-dev
description: Reference card for working on the scai CLI locally — boot sequence, common commands, env setup, sandbox tenant, and gotchas. Read this at the start of a session that involves running, building, or testing scai.
---

# Local Development — scai

Orientation card for working on the scai CLI locally.

**Package manager: pnpm** for all agent work. Never `npm`, `yarn`, `bun`,
or `npx`. (End users install via any of those — agent workflow uses pnpm.)
For one-off binaries, use `pnpm exec <bin>`.

## Boot sequence

```bash
pnpm install              # install deps
pnpm dev -- --help        # run the CLI from source
```

`pnpm dev` is `tsx -r tsconfig-paths/register src/cli.ts`. Anything you'd
pass to the published `scai` binary, you pass after `--`:

```bash
pnpm dev -- status
pnpm dev -- serialization push --what-if --environment-name sandbox
pnpm dev -- deploy environments list --project "My Project"
```

## Building and running the built CLI

```bash
pnpm build                # tsc + tsc-alias → dist/
pnpm start -- --help      # node dist/cli.js
pnpm smoke                # build + smoke spawn checks
```

## Configuration

Config lives at `sitecoreai.cli.json` in the project root (it's
gitignored — every operator generates their own).

Bootstrap:

```bash
pnpm dev -- init --wizard                                # interactive
pnpm dev -- init --environment-name sandbox --cm <host>  # flag-driven
```

`sitecoreai.cli.example.json` shows the schema — `envProfiles` keyed by
name, each with auth + tenant config.

**Validate config:**

```bash
pnpm dev -- config validate
pnpm dev -- status         # which environments + which has tokens
```

## Environment variables

Loaded from `.env.local` (override) then `.env` (fallback). See
`.env.example` for the full list.

**Auth (per-environment overrides preferred for CI):**

| Var                                                 | Purpose                                                        |
| --------------------------------------------------- | -------------------------------------------------------------- |
| `SITECOREAI_DEPLOY_TOKEN`                           | SitecoreAI access token (Deploy + CM/admin scopes); active env |
| `SITECOREAI_CLIENT_ID` / `SITECOREAI_CLIENT_SECRET` | OAuth client credentials; active env                           |
| `SITECOREAI_ENV_<NAME>_DEPLOY_TOKEN`                | Per-environment override (always applies)                      |
| `SITECOREAI_ENV_<NAME>_CLIENT_SECRET`               | Per-environment client secret                                  |
| `SITECOREAI_AUTHORITY`                              | OAuth authority (default: `https://auth.sitecorecloud.io`)     |
| `SITECOREAI_AUDIENCE`                               | OAuth audience (default: `https://api.sitecorecloud.io`)       |

**Behaviour flags:**

| Var                                             | Purpose                                         |
| ----------------------------------------------- | ----------------------------------------------- |
| `SITECOREAI_AUTO_WIZARD=0`                      | Disable auto-init/login on startup (CI default) |
| `SITECOREAI_USE_CLIENT_CREDENTIALS=true`        | Force client-credentials grant                  |
| `SITECOREAI_ALLOW_WRITE=true`                   | Override `allowWrite` for the active env        |
| `SITECOREAI_TELEMETRY=false` / `DO_NOT_TRACK=1` | Disable telemetry                               |
| `SITECOREAI_HISTORY_PATH`                       | Override CLI history log path                   |

## Sandbox tenant for current work

For Phase 1 of the recipes initiative, target this tenant:

- `tenantName=lizsitecore088b-starterkitsa33f-contentatte7784`
- `organization=org_Sqg9NOB4DhDdpb1x`

(See [orchestrator memory](../../../../showcase-orchestrater/) for the
full recipes plan: `plans/registry-sitecore-recipes.md` and
`plans/sitecore-relationships.md`.)

## Common command shapes

```bash
# Inspect a config
pnpm dev -- serialization info --environment-name sandbox

# Pull current state to YAML for diffing
pnpm dev -- serialization pull --environment-name sandbox

# Preview a push (dry-run)
pnpm dev -- serialization push --what-if --environment-name sandbox --json

# Apply a push
pnpm dev -- serialization push --environment-name sandbox --allow-write

# Diff filesystem vs remote
pnpm dev -- serialization diff --environment-name sandbox

# Watch remote for changes
pnpm dev -- serialization watch --environment-name sandbox

# Deploy API
pnpm dev -- deploy environments list --project "<name>"
pnpm dev -- deploy deployments source --id <deploymentId> --directory ./my-app
```

## Token caching

Tokens are stored in OS keychain via `keytar` (service: `sitecoreai-cli`).
Useful one-liners:

```bash
# Force a fresh login for an environment (interactive)
pnpm dev -- login --environment-name sandbox

# Logout (clears keychain entries for that env)
pnpm dev -- logout --environment-name sandbox

# Disable caching (every command re-authenticates)
# In sitecoreai.cli.json:
#   settings.cacheAuthenticationToken = false
```

## Quality gates before finishing a session

```bash
pnpm check                  # format:check + lint + typecheck + test
pnpm test:integration       # only when SITECOREAI_RUN_INTEGRATION=1 + creds set
```

If `pnpm check` fails, the auto-save commit will be tagged
`[auto-save-dirty]` so the operator knows on review.

## Branch workflow

- `dev` is the integration branch. Agent work lands on `agent/*`
  (created automatically by the SessionStart hook).
- Review an `agent/*` branch, then `git merge --squash` into `dev`.
- `dev` → `main` is the publish path; merging to `main` triggers the
  Changesets release workflow.
- Never push from an agent session. The `guard-destructive` hook blocks it.

## Common gotchas

- **`pnpm dev` reads from source, `pnpm start` reads from `dist/`.**
  After `pnpm build`, `pnpm start` runs the built version. Don't conflate.
- **`sitecoreai.cli.json` is gitignored.** Don't try to commit your local
  config.
- **`pnpm-lock.yaml` is gitignored too** (per the project's `.gitignore`).
  scai uses `package-lock.json` as the canonical lockfile for
  multi-PM compatibility — agent runs use `pnpm install` but don't
  commit a pnpm lock.
- **Spinner + `--json` don't mix.** Always check `logger.isJson()` before
  starting `ora`.
- **`SITECOREAI_RUN_INTEGRATION=1` is required** for integration tests;
  without it they're skipped. Don't be surprised by green output that
  ran zero tests.
- **Telemetry can fire during tests.** Set `SITECOREAI_TELEMETRY=false`
  in test setup if a test runs the CLI under spawn.
