# SitecoreAI Deploy & Sync CLI

TypeScript CLI modeled after the Sitecore DotNet SDK and aligned with the serialization commands in `Sitecore.DevEx`.
This implementation runs natively (no dependency on the official `sitecore` CLI).
It also includes a first-class SitecoreAI Deploy API client.

CLI command: `scai` (alias: `sitecoreai-deploy-sync`)

Examples below use the installed CLI command `scai` (alias: `sitecoreai-deploy-sync`).
For local development without installation, replace `scai` with `npm run dev --`.

## Recipes

Declarative Sitecore template + rendering definitions, authored as TypeScript
files alongside React components and pushed to the CMS via the Authoring
GraphQL API. Two recipe kinds:

- **`ComponentTemplateRecipe`** — placeable component (datasource template +
  rendering item + optional Variants/params).
- **`ContentTemplateRecipe`** — content shape only (template + fields), used
  as a Treelist source or `insertOptions` child of another recipe.

Authors use `shape` (text / richText / image / link / enum / reference / …)
on each field; the compiler maps to the canonical Sitecore field-type strings.
Cross-recipe references use `sitecore.source: "template:<handle>"` (resolved
to deterministic GUIDs at compile time).

Locate recipes via the `recipes` glob in `sitecoreai.cli.json` (defaults to
`recipes/**/*.recipe.ts`). `scai recipe push -n <env>` discovers, compiles,
plans, and applies every match — second push is idempotent (zero mutations).

## Quick start

Install dependencies (npm/pnpm/yarn/bun are all supported):

```
npm install
pnpm install
yarn install
bun install
```

Configure an environment (writes to `sitecoreai.cli.json` and creates it if missing):

```
scai init
scai init --environment-name local --project "My Project" --environment "Dev"
```

Interactive wizard setup:

```
scai init --wizard
```

Running `init` without flags defaults to the wizard. Provide flags to skip prompts.
Use `--skip-deploy-lookup` to avoid Deploy API lookups and just enter the CM host.

Auto-setup on startup:

- When you run a command and no config or auth token is found, the CLI launches the init/login wizard.
- In non-interactive/CI mode, it skips auto-setup and prints a hint instead.
- Disable auto-setup with `SITECOREAI_AUTO_WIZARD=0`.

Check configured environments:

```
scai status
```

Validate configuration:

```
scai config validate
```

Run a serialization command:

```
scai serialization pull --environment-name local
```

Push declarative recipes (templates + renderings) to the CMS:

```
# 1. Add a recipe to the project. Default location: ./recipes/<name>.recipe.ts
mkdir -p recipes
cat > recipes/cta-button.recipe.ts <<'EOF'
import type { ComponentTemplateRecipe } from "@sitecoreai-demo/sitecoreai-deploy-and-sync/recipe";

export default {
  kind: "component-template",
  schemaVersion: "1",
  handle: "cta-button@1",
  name: "CtaButton",
  displayName: "CTA Button",
  fields: [
    { name: "Link", shape: "link", sitecore: { type: "general-link", required: true } },
  ],
  variants: [{ name: "default" }, { name: "outline" }, { name: "ghost" }, { name: "link" }],
  params: [
    { name: "Size", shape: "enum", values: ["sm", "md", "lg"], default: "md" },
  ],
  rendering: { datasourceLocation: "current-item", openPropertiesAfterAdd: false },
} satisfies ComponentTemplateRecipe;
EOF

# 2. Dry-run against your tenant to preview the plan.
scai recipe push --environment-name local --what-if

# 3. Apply for real.
scai recipe push --environment-name local --allow-write
```

A second push is idempotent (zero mutations); a partial failure rolls back
the ops it already applied (LIFO, best-effort).

List environments from the Deploy API:

```
scai deploy environments list --project "My Project" --type cm
```

Upload deployment source from a directory:

```
scai deploy deployments source --id <deploymentId> --directory ./my-app
```

## Agent/CI usage

For non-interactive usage, authentication flows, and CM vs Editing Host guidance, see
[`AGENT_CI.md`](./AGENT_CI.md).

Future enhancements: see [`ROADMAP.md`](./ROADMAP.md).

Agent metadata and skills:

- Machine-readable config: [`agent.json`](./agent.json)
- Skills index: [`skills/README.md`](./skills/README.md)

## Configuration

Configuration is read from `sitecoreai.cli.json` at your project root (use `--config` to
point at a different directory). `init` creates or updates an environment in the
`envProfiles` section, creates the config if it does not exist, and can set the default
environment with `--set-default`.

Key behaviors:

- `--environment-name` selects the environment key inside `envProfiles`.
- Global output flags: `--json`, `--quiet`, and `--log-file <path>`.
- `--ref` lets an environment inherit auth/settings from another environment.
- Deploy API access uses a SitecoreAI access token cached in the OS keychain (`deployToken`).
  This token includes SitecoreAI CM/admin scopes in addition to Deploy scopes.
- `init` can accept `--deploy-token` directly or obtain a token via interactive login or client credentials.
- `login` only refreshes the SitecoreAI access token for an existing environment.
- CM access/refresh tokens are cached in the OS keychain when
  `settings.cacheAuthenticationToken` is `true` (default: `true`).
- For client credentials, provide secrets via environment variables
  (`SITECOREAI_CLIENT_SECRET` or `SITECOREAI_ENV_<NAME>_CLIENT_SECRET`).
- Environment settings can be overridden with environment variables for CI or secrets.
  Global overrides (`SITECOREAI_CLIENT_SECRET`, etc.) apply only to the active environment,
  while per-environment overrides (`SITECOREAI_ENV_DEMO_DEPLOY_TOKEN`) always apply.
- CLI history is written to `~/.sitecoreai/cli-history.log` (override with `SITECOREAI_HISTORY_PATH`).
- Use `history` to view recent CLI activity from that log.
- Use `history --show-path` to print the log file path.
- Module files (`*.module.json`) are validated against the serialization module schema.

Telemetry:

- Modeled after the Vercel Skills CLI: anonymous usage events and opt-out via env vars. [github.com/vercel-labs/skills](https://github.com/vercel-labs/skills/)
- On first use, the CLI prompts for consent and stores it in `settings.telemetryEnabled` in `sitecoreai.cli.json`.
- If `settings.telemetryEnabled` is unset, telemetry is disabled until consent is recorded.
- Override with env vars: `SITECOREAI_TELEMETRY=false`, `DISABLE_TELEMETRY=1`, or `DO_NOT_TRACK=1`.
- Uses a `ci=1` flag when running in CI.
- Sends command names, durations, and a random nonce (no full args); sensitive flags are redacted.
- The telemetry service derives an approximate region from CDN headers (e.g., `US-CA`) and does not store raw IPs.
- The CLI uses a built-in production telemetry endpoint. For development, override with
  `SITECOREAI_TELEMETRY_URL`.
- Telemetry schema: `https://schemas.sitecoreai.dev/v1/telemetry.schema.json`.
- Telemetry payloads are validated against the telemetry schema before sending.

Telemetry status:

```
scai telemetry status
```

## Privacy

Telemetry is strictly anonymous and minimal. We do not send file contents, full arguments,
tokens, or user identifiers. The payload includes only the command name, duration, CLI
version, schema version, a CI flag when applicable, and an approximate region derived
from CDN headers (client-supplied region values are ignored). The telemetry service uses
client IPs only for rate limiting and does not store raw IPs (logs keep only anonymized IP
prefixes). You can opt out at any time via `settings.telemetryEnabled` or the environment
variables above.

## Data handling and retention

- Local history is stored in `~/.sitecoreai/cli-history.log` (override with `SITECOREAI_HISTORY_PATH`)
  and grows until you delete or rotate it.
- Telemetry payloads are minimal and do not include full arguments or credentials. Retention
  and aggregation are determined by the telemetry service.

## Troubleshooting

- **Config not found:** run `scai init` or pass `--config <path>`.
- **Auth required:** run `scai login` or `scai init` to refresh tokens.
- **Network/timeouts:** verify the CM host/authority, and increase
  `settings.apiClientTimeoutInMinutes` if needed.
- **Deploy token missing:** provide `--deploy-token` or configure
  `SITECOREAI_DEPLOY_TOKEN`.

## Release management

This repo uses Changesets for versioning and release automation.

Local workflow:

```
npm run changeset
```

- Select the version bump type (patch/minor/major).
- Commit the generated `.changeset/*.md` file.

CI workflow:

- Push to `main` and the Changesets GitHub Action will open a release PR.
- Merge the release PR to publish to npm (requires `NPM_TOKEN` secret).

Manual release:

```
npm run version
npm run release
```

## Serialization API usage

Serialization commands use the Sitecore Management API (GraphQL) at
`/sitecore/api/management` on the configured CM host.

- **Authentication:** OAuth2 via the configured `authority`. The CLI supports client credentials
  and interactive browser login, and caches access tokens in `sitecoreai.cli.json`.
- **Items:** GraphQL queries to read items, metadata, and history for pull/push/diff workflows.
- **Roles/Users:** GraphQL queries for role/user sync (pull/push).
- **Watch:** GraphQL history polling to detect remote changes and pull deltas.
- **Filesystem:** YAML files in the module serialization paths using deterministic YAML output.

## Commands

Serialization commands (alias: `ser`):

- `serialization info`
- `serialization explain`
- `serialization pull`
- `serialization push`
- `serialization diff`
- `serialization validate`
- `serialization watch`
- `serialization package create` (alias: `pkg`)
- `serialization package install` (alias: `pkg`)

Recipe commands — declarative templates + renderings via the Authoring GraphQL API:

- `recipe compile` — compile a `.recipe.ts` / `.recipe.json` to an Operation IR
- `recipe plan` — read-then-diff a compiled IR against a tenant (`--what-if` analog)
- `recipe push` — apply recipes to a tenant; idempotent across re-pushes; best-effort
  rollback on partial failure. Reads recipes from `--input <file>` or the
  `recipes` glob in `sitecoreai.cli.json` (default `recipes/**/*.recipe.ts`).

Environment commands:

- `init`
- `login`
- `logout`
- `status`
- `history`

Deploy API commands:

- `deploy organizations get`
- `deploy organizations health`
- `deploy organizations license`
- `deploy organizations launch-demo`
- `deploy projects list`
- `deploy projects limitation`
- `deploy projects validate-name`
- `deploy projects get`
- `deploy projects create`
- `deploy projects update`
- `deploy projects link-repository`
- `deploy projects unlink-repository`
- `deploy projects delete`
- `deploy environments list`
- `deploy environments limitation`
- `deploy environments get`
- `deploy environments create`
- `deploy environments variables list`
- `deploy environments variables create`
- `deploy environments variables delete`
- `deploy environments deployments list`
- `deploy environments deployments create`
- `deploy environments get-edge-token`
- `deploy environments get-editing-secret`
- `deploy environments regenerate-context`
- `deploy environments promote`
- `deploy environments restart`
- `deploy environments link-repository`
- `deploy environments unlink-repository`
- `deploy environments delete`
- `deploy logs list`
- `deploy logs view`
- `deploy logs data`
- `deploy editing-host list`
- `deploy editing-host create`
- `deploy editing-host update`
- `deploy editing-host delete`
- `deploy editing-host deploy`
- `deploy source-control list`
- `deploy source-control state`
- `deploy source-control access-token`
- `deploy source-control validate`
- `deploy source-control repository get`
- `deploy source-control repository branches`
- `deploy source-control repository validate`
- `deploy source-control repository create-from-template`
- `deploy source-control providers`
- `deploy source-control templates`
- `deploy source-control get`
- `deploy source-control delete`
- `deploy deployments list`
- `deploy deployments get`
- `deploy deployments status`
- `deploy deployments deploy`
- `deploy deployments cancel`
- `deploy deployments source`
- `deploy deployments watch`
- `deploy deployments logs`

Aliases:

- `deploy org` → `deploy organizations`
- `deploy proj` → `deploy projects`
- `deploy env` → `deploy environments`
- `deploy sc` → `deploy source-control`
- `deploy dep` → `deploy deployments`
- `deploy log` → `deploy logs`
- `deploy eh` → `deploy editing-host`

Deploy selection rules:

- Projects: use `--id` or `--name`. Project link/unlink requires `--id`.
- Environments: use `--id` or `--name`, optionally scoped with `--project`.
- Environment create requires `--project`.
- Environment create supports `--cm-only` to create a CM-only environment.
- Project create requires `--name`.
- Tenant types: `0` = nonprod, `1` = prod.
- Project source control ID mapping: create uses `integrationId`, update uses `sourceControlIntegrationId`.
- Source control integrations and deployments: use `--id`.
- Project link-repository requires `repositoryId` and `integrationId` (others optional).
- Environment link-repository requires `repositoryName`, `repositoryId`, `integrationId`,
  `repositoryRelativePath`, and `repositoryBranch`.
- Source control repository create-from-template requires `--provider` (`ado` or `github`)
  and template fields (`templateRepository`, `templateOwner`, `repositoryName`, `owner`,
  `integrationId`).
- Deploy deployments source accepts `--file` (archive) or `--directory` (auto-zip).

Aliases:

- `serialization` -> `ser`
- `serialization package` -> `pkg`

## Development

Run in dev mode:

```
npm run dev -- serialization info --help
```

Lint and format:

```
npm run lint
npm run format
```

Build:

```
npm run build
```

Run tests:

```
npm run test
```

Integration tests (requires env vars):

```
npm run test:integration
```

The recipe sandbox integration test (`tests/integration/recipe/cta-button.integration.test.ts`)
additionally requires:

```
RECIPE_TEST_CM_HOST=https://<sandbox-tenant>.sitecorecloud.io
RECIPE_TEST_TEMPLATES_ROOT=/sitecore/templates/Project/<site>/Components
RECIPE_TEST_RENDERINGS_ROOT=/sitecore/layout/Renderings/Project/<site>
```

It exercises a fresh push, verifies idempotency on a second push, and
runs `--what-if` against the populated tenant. Cleanup is best-effort
on `deleteItem` for the run-scoped handle (`recipe-test-cta-<runId>@1`).

Watch tests:

```
npm run test:watch
```

Run built CLI:

```
node dist/cli.js serialization info --help
```
