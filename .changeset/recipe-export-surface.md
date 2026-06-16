---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Export the `ComponentSectionRecipe`, `EnumerationRecipe`, `EnumerationValue`, `VariantRecipe`, `SitecoreFieldSource`, `RecipeMetaTax`, and `ContentTranslation` schemas (and their types) from the public `./recipe` entry. These stable recipe kinds and shared building blocks were defined in the recipe schema and already handled by the compiler, but were never re-exported, so downstream consumers couldn't import them. Export-only change — no schema or compiler behavior changes.
