---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**0.1.0 release hardening — SDK surface, module boundaries, and security.**

**SDK subpath exports restructured.** The published `exports` map now
separates a stable core from an explicitly unstable namespace:

- Unstable areas moved behind `./unstable/*` (no SemVer stability
  promise): `./agents` → `./unstable/agents`, `./campaigns` →
  `./unstable/campaigns`, `./scripting` → `./unstable/scripting`. These
  are reverse-engineered or not-yet-settled surfaces; they graduate to
  stable entries in a later release.
- Recipe **composition kinds** (`ContentItem`, `PageDesign`,
  `PartialDesign`, `SiteRecipe`, `SiteTemplate` — schemas, types, and
  compilers) moved off `./recipe` to a new `./recipe/unstable` entry,
  matching the recipes-graduation promise that they are not part of the
  0.1.0 stability contract. The five stable recipe kinds and all shared
  recipe infrastructure stay on `./recipe`.
- New `./envelope` entry exports the canonical `ScaiEnvelope` type so
  SDK consumers can type `--json` output.
- `deploy` and `serialization` index files now enumerate their
  `./context` exports explicitly instead of `export *`.

**Migration:** `import … from "@sitecoreai-labs/sitecoreai-cli/agents"` →
`/unstable/agents` (likewise `campaigns`, `scripting`); recipe
composition-kind imports move from `/recipe` to `/recipe/unstable`.

**Module boundaries.** Two circular dependencies were removed so
`src/shared/` is a true leaf again: `allow-write` and `env` moved out of
`shared/` into `policy/` (`policy/allow-write.ts`,
`policy/environment.ts`), and the shared `audit` / `consent` /
`env-tier` modules moved from `publishing/` into `shared/`. A new
`tests/unit/architecture/module-boundaries.test.ts` enforces that
`shared/` imports no domain area and that `content/` never imports
`publishing/`.

**Security.** `normalizeHostUrl` (the Sitecore GraphQL transport) now
rejects non-`https://` hosts — closing a gap where an explicitly
configured `http://` host could send Bearer tokens in cleartext
(`SITECOREAI_ALLOW_HTTP=1` remains the documented dev escape hatch). A
`fast-uri` override (`>=3.1.2`) clears the last runtime `audit`
advisories (host confusion via percent-encoded authority delimiters).

**Packaging.** `declarationMap` is off for the publish build — the
`.d.ts.map` files pointed at unpublished `src/` and only bloated the
tarball.
