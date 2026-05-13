---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**Phase A of the library-ization plan — transport decoupling.** Pure
internal refactor; no public API breakage. Sets up future library
consumers (subpath exports `./deploy`, `./serialization`, `./recipe`,
`./errors`) to be drop-in callable without inheriting scai's env-var
namespace or TTY side effects.

- **`deployRequest`**: new optional `init.silent` (suppresses the TTY
  spinner) and `init.transport` (`timeoutMs` / `maxRetries` /
  `retryBaseMs` / `traceHttp`). When unset, behavior is identical to
  before — env-var fallbacks (`SITECOREAI_REQUEST_TIMEOUT_MS`,
  `SITECOREAI_HTTP_RETRIES`, `SITECOREAI_HTTP_RETRY_BASE_MS`,
  `SITECOREAI_TRACE_HTTP`) still apply. Library callers pass these
  explicitly so they don't depend on scai's env namespace.
- **`startDeploySpinner`**: new optional `{ silent: true }` arg for the
  same reason.
- **`acquireAccessToken`** (new export from
  `serialization/sitecore-api/auth`): pure OAuth acquisition — refresh
  on env, then client credentials — with no keychain reads or writes.
  Library callers that bring their own token cache can call this
  directly. `getAccessToken` keeps its keychain-backed semantics and
  now composes `acquireAccessToken` internally.
- `src/shared/graphql.ts` was already library-ready (no spinner; env-var
  fallback already caller-overridable via `options.timeoutMs`) and
  required no changes — the Phase 1 design proposal over-scoped it.
