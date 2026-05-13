---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**Recipes graduate.** Declarative Sitecore template + rendering definitions,
authored as TypeScript files alongside React components and pushed to the CMS
via the Authoring GraphQL API. The `scai recipe compile|plan|push|diff`
subcommand and the `@sitecoreai-labs/sitecoreai-cli/recipe` subpath export
are now public surface.

**Five recipe kinds are stable for 0.1.0:**

- `ComponentTemplateRecipe` — placeable component (datasource template +
  rendering item + Variants + DesignParameters)
- `ContentTemplateRecipe` — content shape only (template + fields),
  used as a Treelist source or `insertOptions` child
- `ComponentSectionRecipe` — reusable field section shared between components
- `DesignParametersTemplateRecipe` — reusable rendering-parameters template
- `EnumerationRecipe` — Droplink-backed reusable enum (e.g. ColorScheme)

Composition kinds (`PartialDesign`, `PageDesign`, `SiteTemplate`,
`SiteRecipe`, `ContentItem`) are present in the source but not part of the
0.1.0 stability promise — they'll graduate in a follow-up release.

**Read-before-write executor.** Idempotent across re-pushes (second push
is zero mutations). Best-effort LIFO rollback on partial failure,
snapshot-driven inverse mutations, full event audit trail.

**Deterministic GUIDs.** Every item GUID derived via `uuidv5` from the
recipe `handle@<version>`. Pinned forever once pushed.

**`.recipe.ts` files are executed code, not data.** Every `scai recipe`
command (including `recipe diff` and `recipe push --what-if`) imports
each matched `.recipe.ts` and runs its top-level code with full Node
privileges — same trust model as `webpack.config.js` or `vite.config.ts`.
Only run `scai recipe` against repos and recipe files you trust. See
README §Recipes and `docs/recipes.md` for the full discussion.

**Naming:** the rendering-parameter family uses `DesignParameter` /
`DesignParameters` throughout (types, schemas, GUID helpers, compiler
fn, kind discriminator `"design-parameters-template"`). The recipe
author surface (the `params:` and `parameters:` keys on recipe
definitions) is unchanged.

**Security hardening from the 2026-05-13 audit** (also in this release):

- Strict HTTPS-only authority/host URLs (`SITECOREAI_ALLOW_HTTP=1`
  escape hatch for dev)
- OAuth discovery `token_endpoint` host-pinned to the operator-supplied
  authority hostname
- 60s default request timeout on all transports (`SITECOREAI_REQUEST_TIMEOUT_MS`
  override)
- Recipe GraphQL writes hard-disable retries — no silent duplicate
  mutations (writes fail fast; rollback handles partial state)
- Recipe glob: symlinks not followed, paths must live under the
  config directory
- Config upward walk bounded at the nearest `.git` or `package.json`
  (no silent pickup from arbitrary parent directories)
- `scai logout` clears `clientSecret` from `sitecoreai.cli.json`
- Redaction regex widened to catch camelCase `accessToken`,
  `refreshToken`, `clientSecret`, `client_id`, `password`
- Telemetry endpoint moved off `*.vercel.app` to
  `cli-telemetry.sitecoreai.dev` (the project-owned DNS zone)
- `keytar` replaced by `@napi-rs/keyring` (atom/node-keytar was
  archived since Dec 2022)
- npm publish via OIDC Trusted Publishing (no long-lived `NPM_TOKEN`
  in CI)
- GitHub Actions pinned to commit SHA (Dependabot keeps them current
  via the new `.github/dependabot.yml`)
- All 24 prior Dependabot vulnerabilities cleared (ajv, yaml,
  picomatch, fast-uri, etc.)

**Config:** new `recipes: string[]` field in `sitecoreai.cli.json`
locates recipe files (default `recipes/**/*.recipe.ts`). `tsx`
runtime dep loads `.recipe.ts` directly with no build step.
