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
- [Telemetry and privacy](./docs/telemetry-and-privacy.md) — what gets
  sent, how to opt out.
- [Release process](./docs/release.md) — versioning and publishing.
- [Quality gates](./docs/quality-gates.md) — where each gate is enforced.
- [Roadmap](./docs/roadmap.md) — what's coming next.

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
