# @sitecoreai-labs/sitecoreai-cli

## 0.0.4

### Patch Changes

- 92cd29a: **Package renamed**: `@sitecoreai-demo/sitecoreai-deploy-and-sync` → `@sitecoreai-labs/sitecoreai-cli`. Repo now lives at `github.com/Sitecore-Studio-Labs/sitecoreai-cli`. The long-form CLI alias `sitecoreai-deploy-sync` is replaced by `sitecoreai-cli`; the primary `scai` command is unchanged.
  - `scai deploy site list` — list SXA sites in a CM environment via the Authoring API.
  - Discovery now recognizes XM Cloud Headless Tenant and Headless Site templates.
  - Default OAuth audience for client credentials is now `api.sitecorecloud.io`.
  - `scai deploy site bind` no longer polls the rendering host — faster, fewer retries (no behavior change for users).
  - Internal: audit-driven cleanup of structure and error contract.
  - Internal: `pnpm test` is now gated on `pnpm typecheck` via a pretest hook.

## 0.0.3

### Patch Changes

- Adjusting start up process to more cleaning login and manage environments. Some small logical errors with client credential configuration

## 0.0.2

### Patch Changes

- Improve CLI onboarding, deploy error reporting, and auth handling.

## 0.0.1

### Patch Changes

- Fix cross-platform smoke test execution, update deploy logs to use the monitoring API base, and improve CI/release workflow defaults.
- Improve test coverage for deploy and serialization flows.
