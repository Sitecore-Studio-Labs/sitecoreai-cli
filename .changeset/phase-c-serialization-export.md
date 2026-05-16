---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**Phase C — library entry points refactored; new `./serialization` subpath.**

Drops the `lib.ts` wrapper pattern introduced in Phase B in favor of
real, intentional public files. Each subpath in `package.json#exports`
now points directly at a source-tree module whose explicit named
exports ARE the contract — no `export *` cascades, no wrapper barrels
whose only purpose is to re-export from another file.

**New subpath: `@sitecoreai-labs/sitecoreai-cli/serialization`** —
points at `dist/serialization/sitecore-api/index.js`. Re-exports the
Sitecore Management + Authoring GraphQL clients (`fetchItemMetadata`,
`fetchItemData`, `executeSerializationCommands`, history, roles, users,
publishing), the auth primitives (`acquireAccessToken`,
`getAccessToken`, `requestClientCredentialsToken`,
`requestDeviceAuthorization`, `pollDeviceToken`,
`DEFAULT_SITECORE_API_AUDIENCE`), the transport seam (`runGraphQL`,
`GraphQLRequestOptions`), data types (`ItemData`, `ItemMetadata`,
`ItemLanguage`, `ItemVersion`, `ItemFieldValue`, `FieldFilter`,
`RoleData`, `UserData`, `HistoryEntry`, `RolePredicateItem`,
`UserPredicateItem`), the domain object `ItemPath`, and the new
`SitecoreApiClientOptions` structural type.

**Existing `./deploy` and `./errors` subpaths moved to real files**
(non-breaking — the API surface is unchanged):

- `./deploy` was `dist/deploy/lib.js` (wrapper); now
  `dist/deploy/api/index.js` directly. Source-of-truth file is
  `src/deploy/api/index.ts` with explicit named exports.
- `./errors` was `dist/shared/lib-errors.js` (wrapper); now
  `dist/shared/errors.js` directly. The `lib-errors.ts` file is
  removed.

**Internal-helper leakage closed.** Phase B's `./deploy` accidentally
exposed `startDeploySpinner`, `parseJsonIfPossible`, and
`extractErrorMessage` via cascading `export *`. The new explicit
public entry omits all three; internal scai callers still reach them
via `@/deploy/api/common/request` as before.

**`SitecoreApiClientOptions`** — a structural type covering the 11
fields the GraphQL transport + OAuth flow actually use (`host`,
`authority`, `clientId`, `clientSecret`, `audience`, `accessToken`,
`refreshToken`, `refreshTokenParameters`, `useClientCredentials`,
`cacheAuthenticationToken`, `name`). Library callers construct one
of these directly. The CLI's full `EnvironmentConfiguration` (30+
fields covering deploy tokens, recipe roots, allow-write gates, etc.)
structurally satisfies the interface, so internal callers continue
to pass it without change.

**What's intentionally NOT exposed**:

- `src/serialization/tasks/**` — task runners that mix in commander
  options, prompts, logger output, filesystem-store reads.
- `src/serialization/filesystem-store/**` — YAML-on-disk is a CLI
  implementation detail; library callers operate on `ItemData` /
  `ItemMetadata` directly.
- `compare.ts`, `field-filter.ts`, `signature.ts`, `commands.ts`,
  `wildcard.ts`, `yaml.ts`, `path-provider.ts`, `tree-spec.ts` —
  utility seams for the CLI tasks.
- Deploy: `startDeploySpinner`, `parseJsonIfPossible`,
  `extractErrorMessage` (CLI / internal helpers).
