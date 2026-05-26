---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Three related changes that let the showcase orchestrator drive
`scai brand sync push` from a serverless context end-to-end and
let recipe authors hand-write either array or slash-string folder
paths:

- **Brand credential env-var fallback.** `acquireBrandToken` (and the
  campaign auth seam that mints from the same AI APIs key) now resolve
  the client id, client secret, authority, and audience via a two-tier
  chain: `SITECOREAI_BRAND_CLIENT_ID` / `SITECOREAI_BRAND_CLIENT_SECRET`
  / `SITECOREAI_BRAND_AUTHORITY` / `SITECOREAI_BRAND_AUDIENCE`
  environment variables first, then the existing
  `brand[orgId]` config + OS keychain pair. Env-tier wins when both the
  id and secret are present so a Vercel function or CI runner can
  override per invocation without a keychain; a partial pair throws
  `AUTH_BRAND_REQUIRED` naming the missing var, never silently falling
  through. The new `resolveBrandSecrets` helper lives in
  `src/brand/credential.ts`.

- **Brand-kit recipe schema superset.** `BrandKitRecipeSchema` now
  parses the richer recipe shape the registry's `sitecore-recipes.ts`
  exports: optional top-level `kind: "brandkit"`, `schemaVersion: "1"`,
  `handle` (regex `^[a-z][a-z0-9-]*@\d+$`), and `displayName`, plus a
  discriminated `documents[]` union (`url` | `registry-file`) with
  optional `tags` and `sections` ingestion hints. Back-compat is
  preserved via a preprocess step that defaults a missing `kind` to
  `"url"` whenever `url` is present, so existing scai-native YAML/JSON
  recipes keep parsing without a migration. `registry-file` documents
  carry a path relative to the recipe; the seed runner rejects them
  with `INPUT_INVALID` and a pointer at the orchestrator-side
  translation step (the Sitecore Documents API has no working
  bytes-upload path, so URL conversion has to happen upstream of
  scai). Also exports `BRAND_KIT_CANONICAL_SECTIONS` for the seven
  canonical section names that the EnrichSections pipeline produces.

- **Recipe `FolderPath` normalization.** `location.folder` and
  `placeholder.folder` now accept either the canonical array form
  (`["Theme", "Color"]`) or the legacy slash-string form
  (`"Theme/Color"`). Both normalize to `string[]` during Zod parse,
  filtering empty segments after split + trim. The registry already
  moved to array form (slash-strings are fragile to author through
  Agent Studio with no IDE help inside the string); scai now accepts
  both so existing recipes keep working and new ones use the explicit
  shape. Downstream consumers (`compile/enumeration`, `compile/shared`,
  `items/read-current`) see `string[]` uniformly.
