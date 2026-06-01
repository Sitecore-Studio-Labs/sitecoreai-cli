---
"@sitecoreai-labs/sitecoreai-cli": patch
---

`recipe`: drop the section-grouping folder under the Headless Variants tree so SXA Pages chrome can find variant items

Before: a `ComponentTemplateRecipe` with `section.handle` set emitted its per-rendering variants folder under an intermediate `HEADLESS_VARIANTS_GROUPING` section folder:

```
<site>/Presentation/Headless Variants/
└── ui/                                ← HEADLESS_VARIANTS_GROUPING (extra layer)
    └── promo-block/                   ← HEADLESS_VARIANTS
        └── Default                    ← VARIANT_DEFINITION
        └── Centered
```

SXA Headless Pages chrome enumerates variants by walking exactly two levels under the Headless Variants root: `<Rendering>/<Variant>`. Verified against a working tenant 2026-05-31 — the chrome finds `HEADLESS_VARIANTS` items as DIRECT children of the headless-variants root, then enumerates each one's `VARIANT_DEFINITION` children. The section-grouping wrapper pushed scai's variants to depth 3 where the chrome couldn't see them; authors saw an empty variant dropdown in Pages for every rendering scai pushed.

The fix drops the section-grouping folder for the Headless Variants tree only. The templates tree + renderings tree still use section grouping (Sitecore organises by section there). After the fix:

```
<site>/Presentation/Headless Variants/
└── promo-block/                       ← HEADLESS_VARIANTS (direct under root)
    └── Default                        ← VARIANT_DEFINITION
    └── Centered
```

Existing tenants that pushed with the old layout will have stale `HEADLESS_VARIANTS_GROUPING` folders under the Headless Variants root. They're inert (the chrome ignored them anyway) but should be deleted manually in Content Editor — `re-push` with the new version doesn't remove them.

Three regression tests added in `tests/unit/recipe/compile.test.ts` cover: no grouping folder emitted, per-rendering folder parented at the root, variants at depth 2.
