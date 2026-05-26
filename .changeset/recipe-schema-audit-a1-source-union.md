---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Recipe schema audit Tier A1: replace the four-peer `sourceTypes` /
`sourceQuery` / `sourceScope` / `sourceRaw` fields on
`SitecoreFieldAugment` with a single discriminated union `source: {
kind: "filter" | "raw", ... }`.

- `kind: "filter"` carries the composable `types` / `query` /
  `scope` trio — same combination semantics as before (e.g. `types +
scope` → `DataSource=<path>&IncludeTemplatesForSelection=...`).
- `kind: "raw"` carries the verbatim Source escape hatch.
- The mutex between `raw` and the structured trio is now
  structural, not an `.refine()`; JSON Schema's `oneOf` expresses it
  natively so Agent Studio can't emit an invalid combination.
- Pre-A1 recipes that still carry `sourceTypes` / `sourceRaw` etc.
  are rejected at parse time with a migration pointer (the augment
  schema uses `.passthrough()` + a `.superRefine` so the legacy
  keys can't slip through Zod's default `.strip()` silently).
- Internal compiler unchanged: a new `augmentSourceToFields()`
  adapter in `src/recipe/schema/source-fields.ts` flattens the
  union to the existing `SourceFields` shape that
  `renderSourceFields()` and the `ref-source-fields` IR op
  already consume. `compile/shared.ts` and `validate.ts` updated
  to use the adapter / new walk shape; `items/read-current.ts`
  emits the new union shape on `recipe pull` capture.

**Breaking change for recipe authors**: migrate any
`sitecore: { sourceTypes: [...] }` to `sitecore: { source: { kind:
"filter", types: [...] } }`, and any
`sitecore: { sourceRaw: "..." }` to `sitecore: { source: { kind:
"raw", value: "..." } }`.
