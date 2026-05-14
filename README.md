# scai — SitecoreAI Deploy & Sync CLI

A native TypeScript CLI for working with SitecoreAI:

- **Serialization** — pull / push / diff / validate / watch Sitecore
  Content Serialization (SCS) YAML against the Authoring + Management
  GraphQL APIs.
- **Deploy** — first-class client for the SitecoreAI Deploy API
  (organizations, projects, environments, deployments, source control,
  editing hosts, logs).
- **Recipes** — declarative Sitecore template + rendering definitions,
  authored as TypeScript alongside React components and pushed to the
  CMS via the Authoring GraphQL API. Idempotent re-push, best-effort
  rollback, deterministic GUIDs.

Conceptually modeled after the dotnet `Sitecore.DevEx` CLI but runs
natively — **no .NET dependency**. Built with first-class agent
integration (`--non-interactive`, `--json`, stable exit codes,
keychain-only credential storage).

CLI command: `scai` (alias: `sitecoreai-cli`).

## What `scai` adds beyond `Sitecore.DevEx`

`scai` covers the dotnet CLI's Serialization and XM Cloud surfaces, and
adds capabilities that have no dotnet counterpart:

- **Recipes** — declarative TypeScript template + rendering definitions
  pushed via the Authoring GraphQL API, with deterministic GUIDs,
  idempotent re-push, and LIFO rollback. See
  [docs/recipes.md](./docs/recipes.md).
- **Deploy API extras** — `deploy env get-edge-token`,
  `get-editing-secret`, `regenerate-context`, `link-repository` /
  `unlink-repository` (on projects and environments), project
  `limitation` and `validate-name`, and the `deploy site` and
  `deploy source-control` command groups.
- **Agent / CI ergonomics** — `--json`, `--non-interactive`, stable exit
  codes, OS keychain credential storage (no plaintext on disk),
  per-environment env-var overrides
  (`SITECOREAI_ENV_<NAME>_*`), and `SITECOREAI_AUTO_WIZARD=0` to suppress
  interactive prompts.
- **Local activity log** — `scai history` records redacted command
  history at `~/.sitecoreai/cli-history.log`.
- **Interactive REPL** — `scai shell` for chained commands in one session.
- **Telemetry honoring `DO_NOT_TRACK`** — opt-out via the standard env
  var, plus `DISABLE_TELEMETRY` and `SITECOREAI_TELEMETRY=false`.

See [docs/parity-with-devex.md](./docs/parity-with-devex.md) for the
full mapping against `Sitecore.DevEx` and a record of what was
deliberately not ported.

## Install

```sh
npm  install -g @sitecoreai-labs/sitecoreai-cli
pnpm add    -g @sitecoreai-labs/sitecoreai-cli
yarn global add @sitecoreai-labs/sitecoreai-cli
```

Requires Node.js >= 20.

## Quick start

Get from zero to a working environment in three commands:

```sh
# 1. Configure an environment (writes sitecoreai.cli.json + caches a Deploy token)
scai init --wizard

# 2. Confirm what got written
scai status

# 3. Pull serialized content from the configured CM
scai serialization pull --environment-name local
```

Running `scai init` with no flags defaults to the interactive wizard. To
configure a specific environment non-interactively:

```sh
scai init \
  --environment-name local \
  --project "My Project" \
  --environment "Dev" \
  --deploy-token "$SITECOREAI_DEPLOY_TOKEN"
```

`--skip-deploy-lookup` skips the Deploy API lookup and just prompts for
the CM host.

## Recipes

Declarative Sitecore template + rendering definitions, authored as
TypeScript files alongside React components and pushed to the CMS via the
Authoring GraphQL API. Five recipe kinds are stable in 0.1.0:
`ComponentTemplate`, `ContentTemplate`, `ComponentSection`,
`DesignParametersTemplate`, `Enumeration`.

> **`.recipe.ts` files are executed code, not data.** When you run any
> `scai recipe` command (including `recipe diff` and
> `recipe push --what-if`), every matched `.recipe.ts` file is imported
> and its top-level code runs with the full privileges of your shell —
> filesystem access, network, environment variables. Treat recipe files
> like any other build script (`webpack.config.js`, `vite.config.ts`):
> only run `scai recipe` against repos and recipe files you trust. To
> inspect an untrusted recipe set, compile it to `.recipe.json` in a
> sandboxed environment first and operate on the JSON form.

Locate recipes via the `recipes` glob in `sitecoreai.cli.json` (default
`recipes/**/*.recipe.ts`). The lifecycle:

```sh
scai recipe compile --input recipes/cta-button.recipe.ts --output cta-button.ir.json \
  --templates-root /sitecore/templates/Project/<site>/Components \
  --renderings-root /sitecore/layout/Renderings/Project/<site>

scai recipe plan -n sandbox                       # read-then-diff (read-only)
scai recipe push -n sandbox --what-if             # dry-run, no writes
scai recipe push -n sandbox --allow-write         # apply for real
```

A second push is idempotent (zero mutations). Partial failure rolls back
via LIFO unwind of snapshot-driven inverse mutations. Cross-recipe
references (`template:<handle>`, `enumHandle: "<handle>"`) resolve to
deterministic GUIDs at compile time.

See [docs/recipes.md](./docs/recipes.md) for the full surface, including
the trust-model defenses, authoring examples, and graduation roadmap for
composition kinds (PartialDesign, PageDesign, SiteTemplate, SiteRecipe,
ContentItem — present in source, not in the 0.1.0 stability promise).

## MCP — agent integration

```bash
scai mcp serve --environment-name dev
```

Launches a Model Context Protocol server bound to one Sitecore
environment, exposing scai's deploy / serialization / recipe surfaces
as agent tools. Compatible with Claude Code, Claude Desktop, Cursor,
Cline, and any other MCP-speaking client. See
[docs/mcp.md](./docs/mcp.md) for client config snippets, the tool
inventory, write-gate semantics, and v1 limitations.

## Using as a library

`@sitecoreai-labs/sitecoreai-cli` is dual-purpose: a CLI **and** a typed
TypeScript SDK. The CLI binary is only on `bin`. The package root is
intentionally not importable — there is no `main` entry. SDK consumers
import from a subpath; the package root throws `ERR_PACKAGE_PATH_NOT_EXPORTED`
so a stray `require("@sitecoreai-labs/sitecoreai-cli")` can never
execute the CLI by accident.

Each surface ships from its own subpath with its own stability
contract. The most ergonomic seam is the `create*Client(options)`
factory; the underlying option-first functions are also exported for
callers that prefer the bag-of-functions style.

```ts
// Recipes — compile a declarative recipe and push it to the CMS
import {
  compileRecipe,
  buildPlan,
  executeIr,
  createAuthoringClient,
  createSitesApiClient,
} from "@sitecoreai-labs/sitecoreai-cli/recipe";

// Deploy API — environments, deployments, logs
import { createDeployApiClient } from "@sitecoreai-labs/sitecoreai-cli/deploy";
const deploy = createDeployApiClient({ accessToken: process.env.SITECOREAI_DEPLOY_TOKEN! });
const projects = await deploy.fetchAllProjects();

// Serialization (Authoring + Management GraphQL) — items, roles, users, publish
import { createSitecoreApiClient } from "@sitecoreai-labs/sitecoreai-cli/serialization";
const sc = createSitecoreApiClient({ host, accessToken });
const meta = await sc.fetchItemMetadata("master", "/sitecore/content/Home");

// Publishing API — XM Cloud publish jobs, with the structured consent
// argument required for any destructive call
import {
  submitPublishJob,
  mintScopeToken,
  type PublishConsent,
} from "@sitecoreai-labs/sitecoreai-cli/publishing";

// Sites API — CRUD over sites, collections, languages, jobs
import { listSites, addLanguage } from "@sitecoreai-labs/sitecoreai-cli/sites";

// Hygiene — audits + cleanups, output adapters, baselines, history
import { runAuditOrphans, createHygieneApiClient } from "@sitecoreai-labs/sitecoreai-cli/hygiene";

// Brand (AI Skills) — Brand Review SARIF + JSON pipelines
import { generateBrandReview, runBrandReview } from "@sitecoreai-labs/sitecoreai-cli/brand";

// Webhooks + Workflow — Sitecore event handlers and item workflow operations
import { createWebhookApiClient } from "@sitecoreai-labs/sitecoreai-cli/webhooks";
import { createWorkflowApiClient } from "@sitecoreai-labs/sitecoreai-cli/workflow";

// Errors — every subpath throws `ScaiError`; import the type from `/errors`
import { ScaiError, type ScaiErrorCode } from "@sitecoreai-labs/sitecoreai-cli/errors";
```

### Stability contract (0.1.0)

The symbols re-exported from each subpath's `index.ts` are the public
SDK contract. Anything reachable only via the `@/...` path alias
(reaching into `src/` internals) is not part of the contract and may
change between scai versions without notice.

Breaking changes to any exported symbol require a major version bump
(per Changesets). New symbols are additive and ship in minor versions.

## Going deeper

- [Command reference](./docs/commands.md) — every command and flag,
  generated from the source.
- [Configuration](./docs/configuration.md) — config file, env vars,
  profiles, auth.
- [Serialization](./docs/serialization.md) — SCS push/pull/diff
  semantics and module configs.
- [Deploy](./docs/deploy.md) — Deploy API surface, selection rules,
  editing hosts.
- [Recipes](./docs/recipes.md) — declarative recipe authoring, trust
  model, lifecycle commands, cross-recipe references.
- [MCP](./docs/mcp.md) — `scai mcp serve`, tool inventory, write gate,
  agent integration.
- [Telemetry and privacy](./docs/telemetry-and-privacy.md) — what gets
  sent, how to opt out.
- [Release process](./docs/release.md) — versioning and publishing.
- [Quality gates](./docs/quality-gates.md) — where each gate is enforced.
- [Roadmap](./docs/roadmap.md) — what's coming next.
- [Parity with `Sitecore.DevEx`](./docs/parity-with-devex.md) — full
  mapping against the dotnet CLI and a record of what was deliberately
  not ported.

For agent / CI usage, see [AGENTS.md](./AGENTS.md).

## Troubleshooting

| Symptom              | Try                                                                      |
| -------------------- | ------------------------------------------------------------------------ |
| Config not found     | `scai init` or pass `--config <path>`                                    |
| Auth required        | `scai login` or `scai init` to refresh tokens                            |
| Network / timeouts   | Verify the CM host/authority; raise `settings.apiClientTimeoutInMinutes` |
| Deploy token missing | Pass `--deploy-token` or set `SITECOREAI_DEPLOY_TOKEN`                   |

For more, see the [configuration docs](./docs/configuration.md) or run
`scai <command> --help`.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Working on the repo itself uses
`pnpm`; end users can install via any package manager.

## License

[MIT](./LICENSE).
