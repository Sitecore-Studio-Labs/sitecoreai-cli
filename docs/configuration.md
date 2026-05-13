# Configuration

Configuration is read from `sitecoreai.cli.json` at your project root. Pass
`--config <path>` to point at a different directory. `scai init` creates or
updates an environment in the `envProfiles` section, creates the config if
it does not exist, and can set the default environment with `--set-default`.

## Anatomy

```jsonc
{
  "defaultEnvProfile": "demo",
  "envProfiles": {
    "demo": {
      "host": "https://cm.example.com",
      "authority": "https://auth.example.com",
      "clientId": "...",
      "useClientCredentials": true,
      "allowWrite": false,
      "settings": {
        "cacheAuthenticationToken": true,
        "apiClientTimeoutInMinutes": 10,
        "telemetryEnabled": true
      }
    }
  }
}
```

A starter file lives at [`../sitecore.cli.example.json`](../sitecore.cli.example.json).

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

| Token        | Used by             | Stored where                                                  |
| ------------ | ------------------- | ------------------------------------------------------------- |
| Deploy token | Deploy API commands | OS keychain as `deployToken`; includes SitecoreAI CM/admin scopes |
| CM token     | Serialization (Authoring + Management GraphQL) | OS keychain when `settings.cacheAuthenticationToken` is `true` (default) |

- `scai init` can accept `--deploy-token` directly, or obtain a token via
  interactive login or client credentials.
- `scai login` refreshes the Deploy token for an existing environment.
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
scai config validate
```

Surfaces missing fields, malformed JSON, and schema violations against the
published config schema (`dist/config/*.schema.json`).

## History log

CLI history is written to `~/.sitecoreai/cli-history.log` (override with
`SITECOREAI_HISTORY_PATH`). Sensitive flags are redacted before write.

```sh
scai history              # show recent activity
scai history --show-path  # print the log file path
```

See [`telemetry-and-privacy.md`](./telemetry-and-privacy.md) for what does
and doesn't get recorded.

## Auto-setup on startup

When you run a command and no config or auth token is found, the CLI
launches the init/login wizard. In non-interactive/CI mode it skips
auto-setup and prints a hint instead.

Disable auto-setup with `SITECOREAI_AUTO_WIZARD=0`.
