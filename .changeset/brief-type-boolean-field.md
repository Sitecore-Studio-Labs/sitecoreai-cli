---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Brief-type schema: accept `type: "Boolean"` field definitions.

Adds `BooleanFieldSchema` to `BriefFieldSchema`'s discriminated union and the corresponding `BooleanField` type to the API schema. Required to round-trip Sitecore's built-in `SitecoreAIEvaluation` brief type — its `QualifiedBANT` field is `type: "Boolean"`, the only Boolean field observed across the tenant's 11 brief types (verified 2026-06-04). Without this, `BriefTypeRecipeSchema.parse()` rejected the recipe at push time with "failed schema validation".

The Brief API server-side has always accepted Boolean (proven by `SitecoreAIEvaluation` existing on every tenant); this change unblocks scai's local validation gate.

Note: Boolean is treated as a Sitecore-internal field type — the SitecoreAI brief-type authoring UI does not currently expose it as a creatable field-type option. Use only when round-tripping types Sitecore owns; don't author new Boolean fields in user-created types unless the UI gains support.
