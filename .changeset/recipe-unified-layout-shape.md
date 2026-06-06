---
"@sitecoreai-labs/sitecoreai-cli": minor
---

`recipe`: unify `Layout` shape across Partial / Page / PageDesign and inline scoped datasource fields.

Symmetric with the registry's 2026-06-06 reconciliation: scai now models the same `Layout` shape regardless of carrier recipe kind, and a scoped placement carries its materialised `<page>/Data/<slot>` field values inline.

**`ComponentPlacement.datasourceRef.scoped.fields: Record<string, unknown>`** (new, defaults to `{}`).

The slot item the compiler materialises under `<page>/Data/<slot>` now gets its field values from the same placement that names the slot, rather than from a sibling content-item recipe. `compilePageRecipe` reads the placement's `fields` and emits one `SetField` per key against the slot item's refKey, scoped to the resolved datasource template for fieldId derivation. Pull-side `placementFromParsed` carries `fields: {}` on scoped placements (round-trip of the materialised slot-item field values is not modelled here — `readCurrent` doesn't reconstruct them).

**`PageRecipeSchema.itemPath?: string`** (new optional).

Explicit content-tree path override that must match `/^\/sitecore\/content\/\{site\}\/.+/`. `{site}` is the only supported placeholder and is replaced with the active site name at compile time so the same recipe installs cleanly across sites. The path's parent directory becomes the page's parent ref; the leaf segment supersedes `name` for path emission. `compilePageRecipe` falls back to `joinPath(context.pagesRoot, name)` when `itemPath` is omitted, so the legacy behavior is preserved — `context.pagesRoot` is now required only on the fallback path.

**`PageRecipeSchema.fields: Record<string, unknown>`** (loosened from `Record<string, ContentFieldValueSchema>`).

Page-level fields now accept both the scai-native discriminated `ContentFieldValue` shape and the registry's flat shape — plain strings (text), booleans, numbers, `{src, alt, width?, height?}` for images, `{href, text?, target?, title?}` for external links. A new `normalizeFieldValue` helper in `compile/page.ts` maps the flat shape into `ContentFieldValue` and then delegates to the shared `encodeContentFieldValue` for the Sitecore wire form. `extractRecipeDependencies` and `validateRecipeSet` defensively sniff `shape` on the unknown-typed values so only scai-native shapes participate in cross-recipe handle ref checks.

The registry's `page.recipe.ts` / `homepage-demo.recipe.ts` round-trip end-to-end against this shape without needing a translation layer on the orchestrator's side.
