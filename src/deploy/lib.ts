/**
 * Public barrel for `@sitecoreai-labs/sitecoreai-cli/deploy`.
 *
 * Library consumers (orchestrators, MCP servers, other tools) import
 * Deploy API clients from here. The barrel re-exports every fetch /
 * create / update / delete / mutate function and every public type
 * from the internal `./api/*` modules, plus the
 * `DEFAULT_DEPLOY_API_BASE` constant.
 *
 * What's intentionally NOT a public surface but is reachable through
 * `./api`'s barrel today:
 *
 *   - `startDeploySpinner` — TTY-spinner helper. Library callers
 *     should NOT call this. If a request to `deployRequest` needs to
 *     suppress the spinner, pass `{ silent: true }` in the init arg
 *     (added in Phase A).
 *   - `parseJsonIfPossible`, `extractErrorMessage` — request-handling
 *     helpers used internally by `deployRequest`. Stable shape isn't
 *     promised.
 *
 * These leak through the `export *` for now because moving them
 * behind a private subpath would require a larger reorganization
 * (`./api/internal/`). Treat them as private until Phase C tightens
 * the surface.
 */
export * from "./api/index";
