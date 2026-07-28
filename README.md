# scai — SitecoreAI Developer Toolkit

A native TypeScript CLI **and** typed SDK for SitecoreAI — no .NET
dependency, built for humans and agents alike (`--non-interactive`,
`--json`, stable exit codes, OS-keychain credential storage).

scai is organized into product-area command groups. The eleven
top-level groups:

- **`setup`** — configure environments and authenticate (`init`,
  `login`, `client`, `logout`, `status`).
- **`policy`** — workspace guardrails: the deny-by-default env
  allowlist and write-elevation policy.
- **`provision`** — provision environments and content-as-code. Nests
  the **Deploy API** (organizations, projects, environments,
  deployments, source control, editing hosts, logs), Content
  **Serialization** (pull / push / diff / validate / watch SCS YAML
  against the Authoring + Management GraphQL APIs), and **Recipes** —
  declarative template + rendering definitions authored as TypeScript
  and pushed via the Authoring GraphQL API, with deterministic GUIDs,
  idempotent re-push, and LIFO rollback.
- **`content`** — Experience Edge **publishing** behind a tiered
  consent model, content-version state, and item workflow.
- **`hygiene`** — read-only content **audits** and gated **cleanup**.
- **`ops`** — Sitecore Content Operations. Nests **briefs** and
  **campaigns**.
- **`brand`** — Sitecore **Brand Management** and **Brand Review**.
- **`agents`** — SitecoreAI agent authoring and runs.
- **`sync`** — composed recipe + serialization sync workflows.
- **`mcp`** — a built-in **Model Context Protocol** server exposing all
  of the above to agents as workflow-shaped tools.
- **`cli`** — CLI tooling: config, diagnostics, history, REPL,
  telemetry.

**Taxonomy.** Some surfaces are nested under a parent group
(`provision` holds deploy / serialization / recipe; `ops` holds brief /
campaign) while others — `brand`, `agents`, `sync` — sit at the top
level. This is intentional and stable: the
command paths are part of the agent contract documented in
[AGENTS.md](./AGENTS.md), and external MCP-client configs depend on
`scai mcp serve`, so the paths are stable.

Conceptually modeled after the dotnet `Sitecore.DevEx` CLI but runs
natively. CLI command: `scai` (alias: `sitecoreai-cli`).

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
- **Local activity log** — `scai cli history` records redacted command
  history at `~/.sitecoreai/cli-history.log`.
- **Interactive REPL** — `scai cli shell` for chained commands in one session.
- **Anonymous telemetry, on by default (opt-out)** — disable with
  `scai cli telemetry disable`, `SITECOREAI_TELEMETRY=false`, or the
  standard `DO_NOT_TRACK` env var. See
  [docs/telemetry-and-privacy.md](./docs/telemetry-and-privacy.md).

See [docs/parity-with-devex.md](./docs/parity-with-devex.md) for the
full mapping against `Sitecore.DevEx` and a record of what was
deliberately not ported.

## Install

```sh
npm  install -g @sitecoreai-labs/sitecoreai-cli
pnpm add    -g @sitecoreai-labs/sitecoreai-cli
yarn global add @sitecoreai-labs/sitecoreai-cli
```

Requires Node.js >= 22.12.0.

## Quick start

> Authoring recipes for your own Sitecore AI website? See
> **[QUICKSTART.md](./QUICKSTART.md)** — zero to a pushed component template in
> five minutes, CLI-only.

Get from zero to a working environment in three commands:

```sh
# 1. Configure an environment (writes sitecoreai.cli.json + caches a Deploy token)
scai setup init --wizard

# 2. Confirm what got written
scai setup status

# 3. Pull serialized content from the configured CM
scai provision serialization pull --environment-name local
```

Running `scai setup init` with no flags defaults to the interactive wizard. To
configure a specific environment non-interactively:

```sh
scai setup init \
  --environment-name local \
  --project "My Project" \
  --environment "Dev" \
  --deploy-token "$SITECOREAI_DEPLOY_TOKEN"
```

`--skip-deploy-lookup` skips the Deploy API lookup and just prompts for
the CM host.

## MCP — first-class agent integration

scai is built to be driven by agents, not just people. `scai mcp serve`
launches a Model Context Protocol server bound to one Sitecore
environment:

```bash
scai mcp serve --environment-name dev
```

It exposes scai's developer surfaces as **50+ workflow-shaped tools** —
deploy, serialization, recipes, hygiene, publishing, brand, brief,
campaign, workflow, webhook, agent automation, and inspection —
designed around real tasks rather than 1:1 wrappers of library calls.
The tool set is a live inventory; run `scai mcp tools list` for the
authoritative list on your installed version.
Every write tool requires an explicit per-call `allowWrite: true`;
there is no session-wide override. Compatible with Claude Code, Claude
Desktop, Cursor, Cline, and any other MCP-speaking client.

Need a URL instead of a spawned process — e.g. to point a browser-hosted
client at it? Run the Streamable HTTP transport:

```bash
scai mcp serve --transport http --port 3399   # → http://127.0.0.1:3399/mcp
```

See [docs/mcp.md](./docs/mcp.md) for client config snippets, the full
tool inventory, write-gate semantics, and v1 limitations.

## Recipes

Declarative Sitecore template + rendering definitions, authored as
TypeScript files alongside React components and pushed to the CMS via the
Authoring GraphQL API. Five recipe kinds are stable:
`ComponentTemplate`, `ContentTemplate`, `ComponentSection`,
`DesignParametersTemplate`, `Enumeration`.

> **`.recipe.ts` files are executed code, not data — run them in a
> sandbox.** A `.recipe.ts` is TypeScript that, when loaded, runs its
> top-level code. Only `recipe compile`, `recipe push`, and `recipe diff`
> load `.recipe.ts` source; `recipe plan` operates strictly on a
> pre-compiled `.ir.json` and never executes recipe code.
>
> By default scai loads every `.recipe.ts` in a **forked child-process
> sandbox**: the child runs the recipe with a clean, deny-by-default
> environment — none of scai's `SITECOREAI_*` secrets, deploy tokens, or
> OAuth credentials reach recipe code — and a kill-timeout that fires if a
> recipe hangs. Only validated, JSON-serialisable `Recipe` data crosses
> back over the IPC channel. Set `SITECOREAI_RECIPE_SANDBOX=0` to fall
> back to the legacy in-process load (for debugging, or a runtime where
> forking fails); doing so logs a warning.
>
> What the sandbox does **not** do: the child still runs as the same OS
> user as scai, so it can read and write the filesystem and make network
> requests. The sandbox stops a hostile recipe from stealing scai's
> secrets or crashing scai — it is not a general filesystem/network jail.
> Treat recipe files like any other build script (`webpack.config.js`,
> `vite.config.ts`): only run `scai provision recipe` against repos and
> recipe files you trust. See [docs/recipe-sandbox.md](./docs/recipe-sandbox.md).

Locate recipes via the `recipes` glob in `sitecoreai.cli.json` (default
`recipes/**/*.recipe.ts`). The lifecycle:

```sh
# compile — loads .recipe.ts (in the sandbox) → emits compiled .ir.json
scai provision recipe compile --input recipes/cta-button.recipe.ts --output cta-button.ir.json \
  --templates-root /sitecore/templates/Project/<site>/Components \
  --renderings-root /sitecore/layout/Renderings/Project/<site>

# plan — read-only diff against a tenant; operates on a compiled .ir.json,
# never executes recipe code
scai provision recipe plan -n sandbox --input cta-button.ir.json

# push --what-if — dry-run; loads .recipe.ts (sandbox) or an .ir.json, no writes
scai provision recipe push -n sandbox --what-if

# push --allow-write — apply for real
scai provision recipe push -n sandbox --allow-write
```

A second push is idempotent (zero mutations). Partial failure rolls back
via LIFO unwind of snapshot-driven inverse mutations. Cross-recipe
references (`template:<handle>`, `enumHandle: "<handle>"`) resolve to
deterministic GUIDs at compile time.

See [docs/recipes.md](./docs/recipes.md) for the full surface, including
the trust-model defenses, authoring examples, and graduation roadmap for
composition kinds (PartialDesign, PageDesign, SiteTemplate, SiteRecipe,
ContentItem — present in source, not part of the stability promise).

## Publishing

`scai content publish` wraps the SAI Publishing REST API
(`edge-platform.sitecorecloud.io/authoring/publishing/v1`) and adds a
two-step safety flow on top:

```sh
# 1. Dry-run — prints scope + a 5-minute scope token (no API write)
scai content publish item --site marketing --include-subitems -n sandbox

# 2. Real call — pass the token back to authorize the publish
scai content publish item --site marketing --include-subitems -n sandbox \
  --allow-write --confirm-token <token-from-step-1>

# 3. Watch until terminal (or rely on the auto-watch in --non-interactive)
scai content publish status <jobId> -n sandbox --watch
```

Verbs:

| Verb                       | What                                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `publish item`             | Item / subtree publish. Address by `--items <guid>`, `--paths <path>`, or `--site <name>`. Composable.                            |
| `publish all`              | Whole-environment republish to Edge. Max gating: always requires `--confirm-token` + typed env-name confirmation.                 |
| `publish unpublish`        | `never-publish` (reversible, default), `expire-now` (reversible), or `delete` (NOT reversible, typed-item-path confirm per item). |
| `publish status [<jobId>]` | Inspect one job or list queued/running. Add `--watch` to follow until terminal.                                                   |
| `publish cancel <jobId>`   | Cancel a single job, or `--all-queued` to sweep the env.                                                                          |
| `publish history`          | Read the local audit log (`~/.sitecoreai/audit.log`) with env/since/command/outcome filters.                                      |

> **Planned, not yet available:** a companion `scai content version`
> command group (`inspect`, `set-validity`, `set-never-publish`) for the
> CM-side per-version publish-state fields (`__Never publish`,
> `__Valid from` / `__Valid to`) is written but intentionally not
> registered — the version-state verbs only make sense once content
> items can be authored through the CLI, so they stay hidden until item
> primitives land. The SDK (`src/content/api/version-fields.ts`) and
> `scai hygiene cleanup versions` already operate on these fields today.

**Auth:** publishing needs an **environment-level** automation client
(carries `xmcpub.jobs.t:*` scopes), not the org-level client most other
scai commands use. Cloud Portal → Environments → [env] → Automation
Clients → Create. scai will mint and cache the publishing-scoped JWT
transparently when env-level `clientId`/`clientSecret` are present in
config or via `SITECOREAI_ENV_<NAME>_CLIENT_ID` / `_CLIENT_SECRET`.

**Naming gotcha:** the API field `xmc.site.mode` is whole-_environment_,
not whole-_site_ — legacy XM terminology from when one Sitecore instance
== one site. Empirically verified against the SAI Publishing API. To
publish a single Sitecore site, use
`scai content publish item --site <name> --include-subitems`.

See [docs/publish-walkthrough.md](./docs/publish-walkthrough.md) for
copy-pasteable runbooks (single page, whole site, whole env,
unpublish, queue cleanup, CI flow, common errors);
[docs/parity-with-devex.md](./docs/parity-with-devex.md) for safety
model details and the consent record shape; and
[docs/roadmap.md](./docs/roadmap.md) for what's still on the roadmap.

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

// Hygiene — audits + cleanups, output adapters, baselines, history
import { runAuditOrphans, createHygieneApiClient } from "@sitecoreai-labs/sitecoreai-cli/hygiene";

// Unstable surfaces — sites, brand, brief, campaigns, agents, scripting —
// are namespaces of the single `./unstable` barrel (no stability promise)
import { sites, brand } from "@sitecoreai-labs/sitecoreai-cli/unstable";
const allSites = await sites.listSites(env);
const review = await brand.runBrandReview(opts);

// Publishing, webhooks, and workflow are available through the `scai` CLI
// (e.g. `scai content publish`, `scai content workflow`); they are not
// standalone SDK subpaths.

// Errors — every subpath throws `ScaiError`; import the type from `/errors`
import { ScaiError, type ScaiErrorCode } from "@sitecoreai-labs/sitecoreai-cli/errors";
```

### Subpath exports

The SDK is split into a **stable core** and an **`unstable/` namespace**.

**Stable core** — these subpaths carry the SemVer stability contract
below:

```
./recipe   ./deploy   ./serialization   ./sync
./hygiene  ./errors   ./envelope
```

The stable core is intentionally narrow: `./config`, `./content`,
`./publishing`, `./webhooks`, and `./workflow` are **not** published
subpaths (those operations remain available through the `scai` CLI).

**Unstable** — carries **no stability promise**. The shape may change in
any release without a major bump or a changeset. The `brand`, `brief`,
`sites`, `campaigns`, and `agents` APIs target product surfaces that are
not yet part of the public, versioned SitecoreAI API. Pin an exact scai
version if you depend on them:

```
./unstable          — one barrel, namespaced: `agents`, `brand`, `brandSchema`,
                      `brief`, `briefSchema`, `campaigns`, `campaignsSchema`,
                      `scripting`, `sites` (one consolidated barrel, not
                      per-surface ./unstable/* subpaths)
./recipe/unstable   — recipe composition kinds (PageDesignRecipeSchema,
                      SiteRecipeSchema, PartialDesign, …)
```

### Stability contract

The symbols re-exported from a **stable-core** subpath's `index.ts` are
the public SDK contract. Anything reachable only via the `@/...` path
alias (reaching into `src/` internals), or via any `unstable/` subpath
(including `./recipe/unstable`), is **not** part of the contract and may
change between scai versions without notice.

Breaking changes to a stable-core exported symbol require a major
version bump (per Changesets). New symbols are additive and ship in
minor versions. `unstable/*` subpaths are exempt from all of this — by
design, so in-progress surfaces can ship and iterate without churning
the major version.

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
| Config not found     | `scai setup init` or pass `--config <path>`                              |
| Auth required        | `scai setup login` or `scai setup init` to refresh tokens                |
| Network / timeouts   | Verify the CM host/authority; raise `settings.apiClientTimeoutInMinutes` |
| Deploy token missing | Pass `--deploy-token` or set `SITECOREAI_DEPLOY_TOKEN`                   |

For more, see the [configuration docs](./docs/configuration.md) or run
`scai <command> --help`.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Working on the repo itself uses
`pnpm`; end users can install via any package manager.

## License

[MIT](./LICENSE).
