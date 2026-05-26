---
"@sitecoreai-labs/sitecoreai-cli": minor
---

First pass of the recipe-schema audit (see
`docs/recipe-schema-audit.md`). Tightens recipe-side validation
without changing compiler output:

- **ISO-8601 dates** on `CampaignRecipe`, `CampaignDeliverable`, and
  `CampaignTask` (`startDate` / `dueDate`) are now validated via a
  shared `Iso8601` regex schema. Accepts both date-only
  (`2026-05-26`) and full datetime (`2026-05-26T15:00:00Z` /
  `2026-05-26T15:00:00.500+02:00`); rejects free-form strings like
  `"April 1"` or `"2026/06/30"`.
- **ISO-4217 currencies** on `BudgetFieldSchema` items now require
  a 3-letter uppercase pattern (`USD`, `EUR`, `GBP`). Lowercase
  and non-letter values are rejected at parse time.
- **`ComponentTemplateRecipe.parameters` ↔ `params` conflict**: a
  recipe that sets both `parameters: { handle }` (external template
  ref) AND a non-empty inline `params: [...]` is now rejected at
  parse time. Previously the compiler silently dropped `params`
  when `parameters` was set; the new check surfaces the ambiguity
  to the author.
- **`DesignParametersTemplateRecipe.section` is now `{ handle }`,
  not a bare string**: aligns with `ComponentTemplateRecipe.section`'s
  shape. The compiler resolves the section handle via the same
  cross-recipe `resolveSectionRecipe` lookup component-template
  already uses, so dangling section refs fail with `INPUT_INVALID`
  at compile time. **Breaking change** for any in-tree recipe that
  was authoring `section: "ui"` (now `section: { handle:
"ui-section@1" }`).
- **`ComponentTemplateRecipe.otherProperties` description** now
  explicitly calls out which keys are reserved for the typed
  `datasource.autoCreate` and `dynamicPlaceholders` shortcuts. No
  behavior change; helps AI-driven authoring avoid silently
  overriding the typed values.

Tier-A1 (`SitecoreFieldAugment.source*` discriminated union) and
Tier-A3 (campaign server enums as `z.enum`) stayed deferred — see
the audit doc for the reasoning and the planned follow-up scope.
