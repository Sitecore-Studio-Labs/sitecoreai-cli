# Security Policy

## Supported versions

`scai` is published to npm as `@sitecoreai-labs/sitecoreai-cli`.
Security fixes are released for the current `0.1.x` line only.

| Version | Supported          |
| ------- | ------------------ |
| `0.1.x` | :white_check_mark: |
| `< 0.1` | :x:                |

Always run the latest `0.1.x` release. Pre-`0.1` builds were unstable
pre-release snapshots and receive no security backports.

## Reporting a vulnerability

**Do not open a public GitHub issue for a security vulnerability.**

Report privately through GitHub Security Advisories:

1. Go to the repository's **Security** tab:
   <https://github.com/Sitecore-Studio-Labs/sitecoreai-cli/security/advisories>
2. Click **Report a vulnerability** to open a private advisory.

Please include the scai version, your OS and Node.js version, a
reproduction or proof of concept, and the impact you observed.

We aim to acknowledge a report within three business days and to keep
you informed as we investigate. Please give us a reasonable window to
ship a fix before any public disclosure.

## Credential handling

scai is a developer CLI that holds Sitecore Cloud credentials. The
security model is documented in full in
[docs/credentials.md](./docs/credentials.md); the essentials:

- **Secrets live in the OS keychain, never on disk in plaintext.**
  `clientSecret` values and cached tokens are stored via the system
  keychain (macOS Keychain, Windows Credential Manager, libsecret on
  Linux) under the `sitecoreai-cli` service. The config file
  (`sitecoreai.cli.json`) holds only non-secret metadata —
  `clientId`, display names, and timestamps.
- **Environment-variable overrides are in-memory only.**
  `SITECOREAI_DEPLOY_TOKEN`, `SITECOREAI_ENV_<NAME>_CLIENT_SECRET`,
  and similar overrides are read at startup and never persisted.
- **Command history and telemetry are redacted.** CLI arguments are
  redacted before being written to `~/.sitecoreai/cli-history.log`,
  and the telemetry schema forbids token-shaped payloads.

### Rotating or revoking credentials

- **Clear local credentials:** `scai setup logout` removes scai's
  cached tokens and client secrets from the OS keychain. Run it on a
  shared or compromised machine, or before handing the machine off.
- **Revoke at the source:** clearing the keychain does not invalidate
  the credential on Sitecore's side. To fully revoke an automation
  client, delete or rotate it in the Sitecore Cloud Portal
  (Environments / Organization → Automation Clients), then re-mint
  with `scai setup client create` and re-authenticate.
- **If a secret may have leaked,** revoke the automation client in the
  Cloud Portal immediately, then run `scai setup logout` and
  re-provision.
