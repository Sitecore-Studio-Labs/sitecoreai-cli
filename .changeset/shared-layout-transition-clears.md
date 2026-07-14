---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Support flipping an already-pushed page from versioned to shared layout. A `layoutScope: "shared"` page now also emits guarded per-language clears of `__Final Renderings`: an earlier versioned push wrote the layout into every declared language's Final Layout, and those finals override the shared `__Renderings` at render time — so without the clears the flip was invisible. A language's final is cleared only while it is still layout-equivalent to the recipe's own versioned emission; author-edited finals are preserved and reported as plan skips. The planner reads each op's exact (language, version) cell for the ownership check, and rollback of an applied clear restores the exact cell (the inverse `updateItem` now carries the forward input's language/version — previously a rolled-back localized write could land in the default language).
