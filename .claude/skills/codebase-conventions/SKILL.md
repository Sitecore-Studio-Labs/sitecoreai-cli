---
name: codebase-conventions
description: Non-negotiable codebase conventions for the scai CLI — module boundaries, error contract, credential handling, agent contract, quality gates. Trigger when writing or modifying code in scai.
---

# Codebase Conventions — scai

These rules apply to every change. The CLI is published to npm and used by
end users (humans and agents) — the bar is high.

## Package manager: pnpm for agent work

Agents working in scai use `pnpm` for everything: install, dev, test,
build. Never `npm`, `yarn`, `bun`, or `npx` in an agent session.

End users install scai via any of npm/pnpm/yarn/bun (per the README and
because scai is a public CLI). That's a documentation concern, not an
agent-workflow concern.

For one-off binaries, use `pnpm exec <bin>`.

## Module structure

`src/` is 20 **domain areas** plus three cross-cutting layers. A domain
area owns one product surface — its API client, task runners, and (where
it has one) an `index.ts` SDK barrel.

```
src/
├── cli.ts             ← entrypoint; src/program.ts builds the Commander tree
├── commands/          ← Commander command definitions; thin parsers
│   ├── deploy/, serialization/, recipe/, brand/, ...  ← per-area subcommands
│   └── shared.ts      ← shared option helpers
├── config/            ← sitecoreai.cli.json + module schemas, config resolution
├── shared/            ← cross-cutting: errors, logger, spinner, HTTP/GraphQL
│                        transport, telemetry, redaction
└── <domain areas>/    ← deploy, serialization, recipe, brand, brief,
                          campaigns, sites, publishing, content, hygiene,
                          webhooks, workflow, agents, policy, mcp,
                          scripting, sync, auth, authoring, doctor
```

A typical domain area (e.g. `serialization/`) holds `tasks/` (task
runners), an API-client subdir, and an `index.ts` barrel exporting the
SDK surface for that subpath.

**Direction of imports:**

- `commands/` may import any domain area, `config/`, and `shared/`.
- A domain area may import **peer domain areas**, `config/`, and
  `shared/` — never `commands/`.
- `config/` may import `shared/` only.
- **`src/shared/` is a leaf** — it imports no domain area and no
  `commands/` (type-only `@/config` imports are allowed). `allow-write`
  and `env` were moved into `policy/`; `content/` must not import
  `publishing/`. Those two boundaries killed the former `shared↔policy`
  and `content↔publishing` cycles.
- `tests/unit/architecture/module-boundaries.test.ts` enforces those
  two invariants. It is not a full cycle detector — peer domain areas
  may still cross-import; the hard rule is that `shared/` stays a leaf.

When adding a new command group (like `recipe`), follow the existing
pattern: a parser dir under `commands/<group>/`, and a peer domain area
`src/<group>/` if it owns runtime logic.

## Error handling: createCliError

Throw structured CLI errors so the top-level handler can render them with
hints and exit codes. Pattern (from `src/shared/errors.ts`):

```typescript
import { createCliError } from "@/shared/errors";

throw createCliError("Invalid module configuration at ${moduleFile}.", "CONFIG_INVALID", {
  hint: "Fix the module JSON to match the serialization module schema.",
  details,
});
```

- First arg: human-readable message
- Second arg: stable `CODE` for telemetry/log filtering
- Options: `hint` (always include — tells the user the next step), `details` (structured)

Don't `throw new Error("...")` from command paths. Reserve raw `Error` for
truly internal/programmer errors.

## Logging: consola via toLogger(options)

Commands receive `options` from commander; convert to a logger via
`toLogger(options)` in `serialization/tasks/shared.ts`. The logger honors
`--json`, `--quiet`, `--log-file`.

- `--json` → emit JSON lines, no decoration. **No banners, no colors, no
  spinner.** Spinner code paths must check `logger.isJson()` before
  starting an `ora` instance.
- `--quiet` → suppress info; warnings + errors still emit.
- `--log-file` → also write to file at the given path.

Don't `console.log`. Don't write color codes outside consola/ora.

## Credentials: keychain-only

- Tokens are stored via `keytar` in `src/serialization/tasks/env/deploy-token.ts`
  (and similar for OAuth tokens) under the `sitecoreai-cli` service.
- Never write a token to `sitecoreai.cli.json` directly. The `accessToken`
  / `deployToken` fields in the example config are placeholders showing
  where keychain values are loaded into.
- Env-var overrides (`SITECOREAI_DEPLOY_TOKEN`, `SITECOREAI_ENV_<NAME>_DEPLOY_TOKEN`)
  are read at startup and held in memory only — never persisted.
- Telemetry: the schema explicitly forbids token-shaped payloads; don't
  add fields that could leak.

## Agent / CI contract

Every command must work non-interactively:

- Honor `--non-interactive` (don't prompt; fail fast on missing required input)
- Honor `SITECOREAI_AUTO_WIZARD=0` (skip auto-init/auto-login wizards)
- Default `allowWrite: false` on environments — destructive operations
  require explicit `--allow-write` or `allowWrite: true` in config
- Honor `--what-if` on push-style operations (preview without applying)
- `--json` output is structured + machine-parseable; never include
  decorative text in JSON-mode output. **Wrap your output in
  `buildScaiEnvelope()` from `@/shared/envelope`** so consumers can
  branch on `data` regardless of which task produced the output.
  The canonical shape is `{ command, environment, data, count?,
whatIf?, summary?, meta? }` — see `src/shared/envelope.ts`. Direct
  `process.stdout.write(JSON.stringify(...))` of raw payloads is a
  bug; agents and downstream automation depend on the envelope shape.

## Destructive-ops contract (two-layer gate)

Tenant writes (cleanup, workflow mutations, webhook create/delete, etc.)
pass through **two** layers in series:

1. **Library gate** — `ensureAllowWrite(root, envName, override?)` in
   `src/shared/allow-write.ts`. Called from every destructive runner.
   Throws `INPUT_INVALID` unless `env.allowWrite` or the per-call
   `override` (typically `--allow-write`) is set.

2. **MCP boundary gate** — `ensureMcpElevationAllowed(root, envName)`,
   same module. Called from every MCP write tool's handler _before_ the
   library runner. Throws `AUTH_DENIED` if the env has
   `denyMcpElevation: true`.

Why the second gate exists: when an MCP write tool is invoked, the
registry dispatch has already cleared the host's confirmation UX, so
the MCP layer auto-elevates `allowWrite: true` before calling runners.
That makes the library gate effectively a no-op for MCP callers. The
boundary gate is what lets an environment opt out of MCP-driven writes
without changing CLI behaviour.

**Adding a new destructive runner:**

- Call `ensureAllowWrite(root, envName, options.allowWrite)`
  (or `ensureAllowWrite` directly) at the start, after `whatIf`
  is checked.
- Default `whatIf: true` on the CLI command (preview-first).
- If you also expose the runner via MCP, the **MCP handler** must call
  `ensureMcpElevationAllowed(context.resolved.root, context.envName)`
  before delegating. The `tests/unit/architecture/` directory has a
  parity test; consider adding a similar test if you're adding a new
  MCP write tool.

The runner's library gate stays in place for direct CLI use — don't
remove it just because the MCP layer auto-elevates.

## Quality gates

| Command                 | What it runs                                                | When to use                                 |
| ----------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| `pnpm check`            | format:check + lint + typecheck + test                      | Before finishing a session                  |
| `pnpm test`             | Vitest unit tests                                           | While coding                                |
| `pnpm test:integration` | Integration tests (gated by `SITECOREAI_RUN_INTEGRATION=1`) | After touching API/auth/config              |
| `pnpm smoke`            | build + spawn CLI smoke checks                              | Sanity check before publish                 |
| `pnpm lint:fix`         | ESLint with --fix                                           | After bigger refactors                      |
| `pnpm format`           | Prettier write                                              | Before commit if not relying on lint-staged |

Husky + lint-staged run prettier and eslint --fix on staged files at commit
time. Pre-commit failures block the commit; fix and re-stage.

## Telemetry

Anonymous, opt-in. The CLI prompts for consent on first use.

- Schema: `telemetry.schema.json`
- Implementation: validates payloads against the schema before sending
- Fields: command name, duration, version, ci flag, region (CDN-derived)
- **Never** add user-identifiable fields, full args, or token-shaped values
- Disable via `SITECOREAI_TELEMETRY=false` or `DO_NOT_TRACK=1`

## When adding a command

1. Define the parser in `src/commands/<group>/<name>.ts`
2. Implement the task runner in `src/<group>/tasks/<name>.ts` (or
   `serialization/tasks/...`)
3. Use `toLogger(options)` for all output; honor `--json`
4. Throw via `createCliError` with a `hint`
5. Add a unit test in `tests/unit/...` mirroring the source path
6. If the command hits a real Sitecore API, add an integration test in
   `tests/integration/`
7. If the command writes tokens or sensitive data, double-check no log
   path leaks them
8. Regenerate the command reference: `pnpm docs:commands` (writes
   `docs/commands.md`)
9. Run a changeset: `pnpm changeset`

## Common pitfalls

- **Don't bypass `allowWrite: false`.** It's the safety net that prevents
  accidents in misconfigured environments.
- **Spinner must respect `--json`.** Starting `ora` while JSON output is
  on corrupts the stream.
- **Module schema vs root config schema.** Two separate JSON Schema
  documents in `src/config/`. Don't confuse them.
- **Error codes are stable contracts.** Don't rename a `CODE` once it's
  shipped — telemetry and tooling depend on it.
- **The `__Standard values` chicken-and-egg** (when implementing recipes).
  Template references SV, SV's parent is template, SV's template is the
  template's own ID. Three operations, ordered. See
  [plans/sitecore-relationships.md](../../../plans/sitecore-relationships.md)
  in the orchestrator repo.
