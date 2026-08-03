---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Four recipe kinds graduate to the stable `./recipe` entry: `ContentItemRecipe`, `PartialDesignRecipe`, `PageDesignRecipe`, and `DictionaryRecipe` (schemas, types, and their `compile*` functions). They are still re-exported from `./recipe/unstable` through a deprecation window, so existing imports keep working and can migrate lazily; the re-exports drop in the next major. New code should import from `./recipe`.

The graduation was gated on an audit, not on usage counts. Every item id these kinds produce is a `uuidv5` derivation over stable inputs — no `randomUUID` on any compile path — so re-pushing a recipe converges on the same items. Rollback is driven by the operation IR rather than by kind, so parity reduces to which ops a kind emits: these four emit only `CreateItem`, `SetField`, and `AddItemVersion`, and the first two have the same inverses the original stable kinds rely on. One narrow gap remains: `AddItemVersion` rollback is warn-only, so a half-failed push against a _pre-existing_ item can leave an empty extra version behind. The planner closes it rather than the rollback path — `planAddItemVersion` reads the current max version and skips when it already exists, adding only the shortfall, so a re-push repairs the leftover instead of stacking another version on top of it. Only an abandoned (never-retried) push leaves residue.

`SiteRecipe` and `SiteTemplateRecipe` stay unstable, held back by that same test rather than by how much they're used: they emit `CreateSiteFromTemplate` and `MediaUpload`, both deliberately warn-only on rollback (site deletion cascades destructively; media upload can't yet distinguish an item it created from one it re-used).

`DictionaryRecipe` also moves out of `src/recipe/schema/kinds/site.ts` into its own `kinds/dictionary.ts`, so one file no longer holds schemas on both sides of the stability boundary. This is an internal file move — the exported surface is unchanged.
