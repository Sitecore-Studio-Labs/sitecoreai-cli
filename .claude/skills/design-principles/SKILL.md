---
name: design-principles
description: Golden principles for code design — research-first culture, prefer libraries, validate at boundaries, right abstraction level. Trigger on any non-trivial implementation task.
---

# Design Principles

These principles apply to every implementation decision. The most important
one is first.

## 1. Research before building

**This is the most important principle.** Agents default to solving problems
with local files when a few web searches would find better, battle-tested
solutions.

Before implementing any non-trivial feature:

- **Search the web** for existing libraries, patterns, and documentation.
  `WebSearch` and `WebFetch` are available tools — use them proactively.
- **Read official docs** when touching unfamiliar technology (Sitecore
  Authoring GraphQL, Sitecore Management API, OAuth2 device flow, keytar).
  Don't guess from local code.
- **Study how similar systems solve the problem** before designing an API,
  data model, or workflow. The dotnet `Sitecore.DevEx` CLI is a useful
  reference for serialization semantics.

**Good:** "I checked Sitecore's Authoring GraphQL docs and found
`createItem` accepts a deterministic `itemId` parameter, so we get
upsert semantics for free."

**Bad:** "I implemented a custom 'check then create' wrapper because I
assumed createItem would conflict on duplicate IDs."

## 2. Prefer established libraries over custom code

If a well-maintained library exists for the task, use it.

Check existing dependencies first — something may already be installed:

- **CLI parsing:** `commander` (already in use)
- **Logging:** `consola` (already in use)
- **OS keychain:** `keytar` (already in use)
- **JSON Schema validation:** `ajv` + `ajv-draft-04` + `ajv-formats` (already in use)
- **YAML:** `yaml` (already in use)
- **Globbing:** `fast-glob` (already in use)
- **Spinners:** `ora` (already in use)
- **Zip packaging:** `adm-zip` (already in use)
- **Env loading:** `dotenv` (already in use)

**Don't hand-roll** what a library does better. The exception: when the
library adds more complexity than the custom code (pulling in 500KB for a
10-line function).

**Anti-pattern:** Writing a custom GraphQL client when scai already has one
in `src/serialization/api/` (re-exported for cross-area use via
`@/authoring`).

## 3. Validate at boundaries, trust internally

- **Config files** (`sitecoreai.cli.json`, `*.module.json`): validated via
  AJV against committed JSON schemas in `src/config/`.
- **External API responses** (Authoring GraphQL, Deploy API): validate or at
  minimum type-narrow.
- **CLI input:** commander handles option parsing; validate semantics
  (required combinations, value ranges) in the command body.
- **Internal code:** trust TypeScript types. Don't defensively check for
  `null` on values that the type system guarantees are defined.
- **Don't YOLO-probe data.** If you don't know the shape, add a schema.

## 4. Right level of abstraction

- **Rule of Three:** don't abstract until there are 3+ concrete uses.
- **No premature configuration.** If a value is currently constant, keep it
  constant. Don't add a config option "in case someone needs to change it."
- **No hypothetical future requirements.** Build what the task asks for.
- **Three similar lines > one premature abstraction.** Duplication is cheaper
  than the wrong abstraction.

## 5. Explicit over implicit

- **Named constants** over magic strings and numbers.
- **Function parameters** over ambient state (globals, singletons, closures
  over module-level variables).
- **Explicit error types** via `createCliError(message, code, { hint, details })`
  over generic throws.
- **Types and schemas** over runtime checks for things the type system can
  enforce.

## 6. Honor agent/CI contracts

scai is built for non-interactive use. Every command must:

- Honor `--non-interactive` and `--json` flags
- Not prompt when `SITECOREAI_AUTO_WIZARD=0` is set
- Default `allowWrite: false` — destructive operations require explicit opt-in
- Emit structured events to stdout when `--json` is on, not human-readable text
- Never write tokens or secrets to stdout/stderr/logs (telemetry redacts;
  command output should too)

If you add a new command that prompts the user, also add the non-interactive
path. Otherwise CI breaks silently.

## 7. Credentials are keychain-only

Tokens live in OS keychain via keytar. Never:

- Write tokens to disk outside keychain (config files, log files, history)
- Print tokens in stdout/stderr (CLI history captures stdout)
- Pass tokens via process arguments (visible in `ps`)
- Send tokens to telemetry (telemetry payloads are validated against schema
  to prevent this)

The single exception: env vars (`SITECOREAI_*_DEPLOY_TOKEN`) are how CI
injects credentials at the process boundary. Read them at startup, then
treat in-memory only.

## Anti-patterns

- **Skipping research.** Jumping straight to implementation without checking
  if a library, pattern, or official doc covers the use case.
- **Reinventing the wheel.** Writing a custom implementation when a
  dependency already installed does the same thing.
- **Bypassing the safety gates.** Don't write code that defaults to
  `allowWrite: true` or that ignores the `allowedPushOperations` field.
- **Defensive programming against the type system.** Adding null checks for
  values TypeScript guarantees are non-null.
- **Premature abstraction.** Creating a generic framework for a one-time
  operation.
- **Token leaks.** Anything that reads a token must be scrutinized for
  output channels.
