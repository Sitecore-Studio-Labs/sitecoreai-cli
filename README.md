# scai — SitecoreAI Deploy & Sync CLI

A native TypeScript CLI for working with SitecoreAI:

- **Serialization** — pull / push / diff / validate / watch Sitecore
  Content Serialization (SCS) YAML against the Authoring + Management
  GraphQL APIs.
- **Deploy** — first-class client for the SitecoreAI Deploy API
  (organizations, projects, environments, deployments, source control,
  editing hosts, logs).

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

## Going deeper

- [Command reference](./docs/commands.md) — every command and flag,
  generated from the source.
- [Configuration](./docs/configuration.md) — config file, env vars,
  profiles, auth.
- [Serialization](./docs/serialization.md) — SCS push/pull/diff
  semantics and module configs.
- [Deploy](./docs/deploy.md) — Deploy API surface, selection rules,
  editing hosts.
- [Telemetry and privacy](./docs/telemetry-and-privacy.md) — what gets
  sent, how to opt out.
- [Release process](./docs/release.md) — versioning and publishing.
- [Quality gates](./docs/quality-gates.md) — where each gate is enforced.
- [Roadmap](./docs/roadmap.md) — what's coming next.

For agent / CI usage, see [AGENTS.md](./AGENTS.md).

## Troubleshooting

| Symptom              | Try                                                                       |
| -------------------- | ------------------------------------------------------------------------- |
| Config not found     | `scai init` or pass `--config <path>`                                     |
| Auth required        | `scai login` or `scai init` to refresh tokens                             |
| Network / timeouts   | Verify the CM host/authority; raise `settings.apiClientTimeoutInMinutes`  |
| Deploy token missing | Pass `--deploy-token` or set `SITECOREAI_DEPLOY_TOKEN`                    |

For more, see the [configuration docs](./docs/configuration.md) or run
`scai <command> --help`.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Working on the repo itself uses
`pnpm`; end users can install via any package manager.

## License

[MIT](./LICENSE).
