# Deploy

`scai deploy` is a first-class client for the SitecoreAI Deploy API. It
covers organizations, projects, environments, deployments, source control
integrations, editing hosts, and logs.

## Authentication

Deploy uses a single SitecoreAI access token cached in the OS keychain as
`deployToken`. This token carries SitecoreAI CM/admin scopes in addition
to Deploy scopes.

Get a token by running `scai init` (it can lookup a project/environment
during setup and store the token) or `scai login` (refreshes an existing
environment's token). In CI, pass `--deploy-token` or set
`SITECOREAI_DEPLOY_TOKEN`.

See [`configuration.md`](./configuration.md#authentication) for the full
auth surface.

## Aliases

| Alias                  | Resolves to             |
| ---------------------- | ----------------------- |
| `deploy org`           | `deploy organizations`  |
| `deploy proj`          | `deploy projects`       |
| `deploy env`           | `deploy environments`   |
| `deploy sc`            | `deploy source-control` |
| `deploy dep`           | `deploy deployments`    |
| `deploy log`           | `deploy logs`           |
| `deploy eh`            | `deploy editing-host`   |

## Selection rules

These are the things that trip people up most:

- **Projects** — use `--id` or `--name`. Project `link-repository` /
  `unlink-repository` requires `--id`.
- **Environments** — use `--id` or `--name`, optionally scoped with
  `--project`. `deploy env create` requires `--project`.
- **Environment create supports `--cm-only`** to create a CM-only
  environment (no editing host).
- **Project create** requires `--name`.
- **Tenant types**: `0` = nonprod, `1` = prod.
- **Project source control ID mapping** — `create` uses `integrationId`;
  `update` uses `sourceControlIntegrationId`. (Yes, this asymmetry is
  the Deploy API's design.)
- **Source control integrations and deployments** use `--id`.
- **Project link-repository** requires `repositoryId` and `integrationId`
  (others optional).
- **Environment link-repository** requires `repositoryName`,
  `repositoryId`, `integrationId`, `repositoryRelativePath`, and
  `repositoryBranch`.
- **Source control repository create-from-template** requires
  `--provider` (`ado` or `github`) and the template fields
  (`templateRepository`, `templateOwner`, `repositoryName`, `owner`,
  `integrationId`).
- **Deploy deployments source** accepts `--file <archive>` or
  `--directory <path>` (auto-zips the directory).

## CM-only environments and editing hosts

```sh
# CM-only environment
scai deploy environments create --project <id> --name <name> --cm-only

# Add an editing host to a CM-only environment
scai deploy editing-host create --cm-environment-id <id> --name <name>
```

CM-only deployments expect build configuration in `xmcloud.build.json`,
including:

- `buildTargets` (e.g., the authoring build target)
- `authoring` settings (authoring path and related values)

## Common flows

```sh
# Discover what you have
scai deploy organizations get
scai deploy projects list
scai deploy environments list --project "My Project"

# Probe a CM's readiness endpoint (resolves the host from the env metadata,
# then GETs /healthz/ready). Useful for post-deploy smoke checks.
scai deploy environments health --name <env>

# Upload a deployment from a directory (zips on the fly)
scai deploy deployments source --id <deploymentId> --directory ./my-app

# Watch a deployment to completion (bound in CI)
scai deploy deployments watch --id <deploymentId> --timeout 3600

# Dry-run any deploy command
scai deploy environments create --project "X" --name "Y" --cm-only --what-if
```

`--what-if` on any deploy command prints the resolved API call and payload
without executing it.

For the full command surface, see [`commands.md`](./commands.md).
