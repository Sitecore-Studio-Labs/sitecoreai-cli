# Configuration

Configuration is read from `sitecoreai.cli.json` at your project root. Pass
`--config <path>` to point at a different directory. `scai setup init` creates or
updates an environment in the `envProfiles` section, creates the config if
it does not exist, and can set the default environment with `--set-default`.

## Anatomy

`settings`, `defaultEnvProfile`, `recipes`, `brand`, and `orgClients` are
**root-level** keys; per-environment keys live inside each `envProfiles`
entry. (A common mistake is to nest `settings` inside an env profile — it
belongs at the root.)

```jsonc
{
  "$schema": "https://schemas.sitecoreai.dev/v1/sitecoreai.cli.json",
  "defaultEnvProfile": "demo",
  // Root-level CLI settings (NOT per-environment).
  "settings": {
    "cacheAuthenticationToken": true,
    "apiClientTimeoutInMinutes": 10,
    "telemetryEnabled": true,
  },
  // Globs locating .recipe.ts / .recipe.json files. Defaults to
  // ["recipes/**/*.recipe.ts"] when omitted.
  "recipes": ["recipes/**/*.recipe.ts"],
  "envProfiles": {
    "demo": {
      "host": "https://cm.example.com",
      "authority": "https://auth.example.com",
      "audience": "https://api.sitecorecloud.io",
      "clientId": "...",
      "useClientCredentials": true,
      "allowWrite": false,
      "production": false, // marks a production-tier env for publish gating
      "denyMcpElevation": false, // when true, MCP write tools refuse this env
      "recipeRoots": {
        "templates": "/sitecore/templates/Project/MySite",
        "renderings": "/sitecore/layout/Renderings/Project/MySite",
      },
    },
  },
}
```

A starter file lives at [`../sitecoreai.cli.example.json`](../sitecoreai.cli.example.json).
The runtime config file the CLI resolves is always named `sitecoreai.cli.json`.

## Config keys reference

### Root-level keys

| Key                 | Type                                      | What                                                                                                                                                                                                                               |
| ------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defaultEnvProfile` | string                                    | Environment used when no `--environment-name` is passed.                                                                                                                                                                           |
| `envProfiles`       | map of name → env profile                 | Named Sitecore environments (see per-env keys below).                                                                                                                                                                              |
| `settings`          | object                                    | CLI settings: `telemetryEnabled`, `cacheAuthenticationToken`, `versionComparisonEnabled`, `apiClientTimeoutInMinutes`.                                                                                                             |
| `recipes`           | string[] (globs)                          | Where `scai provision recipe` finds `.recipe.ts` / `.recipe.json`. Defaults to `recipes/**/*.recipe.ts`.                                                                                                                           |
| `modules`           | string[] (globs)                          | Serialization `*.module.json` file resolution globs. Optional; only serialization/recipe workflows use it.                                                                                                                         |
| `serialization`     | object                                    | Global serialization defaults (path length, orphan handling, excluded fields).                                                                                                                                                     |
| `brand`             | map of `organizationId` → credential      | Brand Management / Review / Documents / Pipeline credentials, keyed by Sitecore org ID. The AI APIs key is org-scoped, so env profiles in the same org share one. The secret lives in the OS keychain. (Legacy alias: `aiSkills`.) |
| `orgClients`        | map of `organizationId` → client metadata | Non-secret metadata of the scai-minted **org-scoped** automation clients (one per org). Secret lives in the keychain, never on disk.                                                                                               |

### Per-environment keys (inside `envProfiles.<name>`)

| Key                                                           | Type             | What                                                                                                                                                                                                                                |
| ------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `host` / `authority`                                          | string           | CM base URL and identity authority.                                                                                                                                                                                                 |
| `audience`                                                    | string           | OAuth audience for issued tokens (e.g. `https://api.sitecorecloud.io`).                                                                                                                                                             |
| `organizationId` / `tenantId` / `projectId` / `environmentId` | string           | Sitecore identifiers for the env.                                                                                                                                                                                                   |
| `allowWrite`                                                  | boolean          | Gate that must be `true` (alongside `--allow-write`) before any write reaches this endpoint.                                                                                                                                        |
| `production`                                                  | boolean          | Production-tier marker read by `scai content publish` to decide human-only vs. automation-allowed publishing.                                                                                                                       |
| `denyMcpElevation`                                            | boolean          | When `true`, MCP write tools refuse this env regardless of host UX — destructive ops must originate from a human CLI `--allow-write` call. Defaults to `false`.                                                                     |
| `useClientCredentials` / `clientId`                           | boolean / string | Bring-your-own automation-client escape hatch. Pair with `SITECOREAI_ENV_<NAME>_CLIENT_SECRET`.                                                                                                                                     |
| `automationClient`                                            | object           | Non-secret metadata of the env-scoped automation client minted by `scai setup client create <env>`. Secret lives in the keychain. Distinct from the BYO `clientId` hatch.                                                           |
| `recipeRoots`                                                 | object           | Preferred nested form of the `*Root` recipe-target paths (`templates`, `renderings`, `components`, `contentModels`, `pageDesigns`, …). Flattened at load time; wins over the flat `*Root` fields (a warning fires if both are set). |
| `site` / `siteCollection`                                     | string           | SXA Headless site + collection; set together to have scai derive `recipeRoots` from the standard SXA tree.                                                                                                                          |

> **Note:** `production` is honored by the config loader and env overrides
> (`SITECOREAI_ENV_<NAME>_PRODUCTION`) but is not yet listed in the
> published JSON schema (`dist/config/*.schema.json`); `scai cli config
validate` will not flag it.

## Key behaviors

- `--environment-name` selects the environment key inside `envProfiles`
  (aliases: `-n`, `--env`, `--env-name`).
- Global output flags: `--json`, `--quiet`, and `--log-file <path>`.
- `--ref` lets an environment inherit auth/settings from another environment.
- `defaultEnvProfile` is used when no `--environment-name` is passed.
- Module files (`*.module.json`) are validated against the serialization
  module schema.

## Authentication

There are two distinct tokens:

| Token        | Used by                                        | Stored where                                                             |
| ------------ | ---------------------------------------------- | ------------------------------------------------------------------------ |
| Deploy token | Deploy API commands                            | OS keychain as `deployToken`; includes SitecoreAI CM/admin scopes        |
| CM token     | Serialization (Authoring + Management GraphQL) | OS keychain when `settings.cacheAuthenticationToken` is `true` (default) |

- `scai setup init` can accept `--deploy-token` directly, or obtain a token via
  interactive login or client credentials.
- `scai setup login` refreshes the Deploy token for an existing environment.
- For client credentials, provide secrets via environment variables
  (`SITECOREAI_CLIENT_SECRET` or `SITECOREAI_ENV_<NAME>_CLIENT_SECRET`).

## Environment variable overrides

Environment settings can be overridden with environment variables for CI
or secrets handling.

- **Global** overrides apply only to the active environment:
  `SITECOREAI_CLIENT_SECRET`, `SITECOREAI_DEPLOY_TOKEN`, etc.
- **Per-environment** overrides always apply:
  `SITECOREAI_ENV_<NAME>_DEPLOY_TOKEN`, `SITECOREAI_ENV_<NAME>_CLIENT_SECRET`,
  `SITECOREAI_ENV_<NAME>_ALLOW_WRITE`.

## Validation

```sh
scai cli config validate
```

Surfaces missing fields, malformed JSON, and schema violations against the
published config schema (`dist/config/*.schema.json`).

## History log

CLI history is written to `~/.sitecoreai/cli-history.log` (override with
`SITECOREAI_HISTORY_PATH`). Sensitive flags are redacted before write.

```sh
scai cli history              # show recent activity
scai cli history --show-path  # print the log file path
```

See [`telemetry-and-privacy.md`](./telemetry-and-privacy.md) for what does
and doesn't get recorded.

## Auto-setup on startup

When you run a command and no config or auth token is found, the CLI
launches the init/login wizard. In non-interactive/CI mode it skips
auto-setup and prints a hint instead.

Disable auto-setup with `SITECOREAI_AUTO_WIZARD=0`.
