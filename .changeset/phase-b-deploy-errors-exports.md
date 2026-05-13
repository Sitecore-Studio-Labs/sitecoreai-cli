---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**Phase B of the library-ization plan — first public library exports + `CliError` → `ScaiError` rename.**

`@sitecoreai-labs/sitecoreai-cli` now exposes two new subpath exports
alongside the existing `./recipe`:

- **`@sitecoreai-labs/sitecoreai-cli/deploy`** — Deploy API clients. Every
  `fetch*` / `create*` / `update*` / `delete*` / mutating helper from
  `src/deploy/api/*` (orgs, projects, environments, deployments, source
  control, editing host, logs, deployment logs) plus the request-layer
  primitives (`deployRequest`, `DEFAULT_DEPLOY_API_BASE`, the
  `DeployRequestTransport` config added in Phase A, and the type set).
- **`@sitecoreai-labs/sitecoreai-cli/errors`** — the typed error envelope.

**Class rename: `CliError` → `ScaiError`.** The error class, the
`*Code` union, the factory, and the converter all gained `Scai*`
names. The legacy `Cli*` names are re-exported as deprecated aliases
that point at the same symbols — `instanceof CliError` and
`instanceof ScaiError` both match any thrown error from scai. The
deprecated names will be removed in the next major version.

Backwards compatibility:

- Existing `./recipe` consumers: unchanged.
- New `./deploy` and `./errors` consumers: stable as of this release.
- Pre-rename `CliError`/`createCliError`/`toCliError`/`CliErrorCode`
  callers: continue to work via aliases; migrate at your convenience.

Internal:

- ~70 source files migrated to the new `Scai*` names via codemod;
  full test suite still passes.
- `src/deploy/lib.ts` and `src/shared/lib-errors.ts` are the new
  public barrel files. Internal helpers (`startDeploySpinner`,
  `parseJsonIfPossible`, `extractErrorMessage`) reach through
  `./deploy` for now — Phase C will tighten that surface.
- New `tests/unit/lib-surface.test.ts` smoke-checks both subpath
  exports plus the existing `./recipe`. New
  `tests/unit/shared/errors.test.ts` case verifies the deprecated
  `CliError` alias.
