---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`recipe list --json` now emits `dependsOn` as a true **apply-order** dependency graph and flags it with a new top-level `dependencyModel: "apply-order"` field.

Previously `dependsOn` carried raw `recipeReferences()` edges, which include **forward** references (a `site-template` at rank 4 naming its `dictionaries` at rank 6) that are not "apply-after" dependencies, and omitted the implicit `dictionary → site` ordering (a dictionary's items nest under `<site>/Dictionary`, but the `site` field is usually omitted so no handle edge exists). A driver scheduling directly on those edges across ranks could invert the apply order.

The emitted graph now keeps only backward/same-rank edges and injects the `dictionary → site` edge to every in-set site, making it a complete, apply-order-correct DAG a batch driver can schedule on across ranks without re-deriving the coarse rank order. `dictionary → site` is the only implicit cross-rank dependency in the model; pages, content-items, and enumerations target the pre-existing deploy-target site rather than an in-set `SiteRecipe`. Backward-compatible: consumers reading `dependsOn` within a rank see no change, and the new `dependencyModel` field lets a driver detect the apply-order form.
