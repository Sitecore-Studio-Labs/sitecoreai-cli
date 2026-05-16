---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**`scai audit` + `scai cleanup` — expanded to 16 verbs.** Builds on the
content-hygiene groups shipped in the previous release; adds six new
read-only audits and four new mutating cleanup operations.

**New `scai audit` verbs (read-only):**

- `audit dead-templates list` — templates with zero items derived
  from them. Uses the search index's `_template` field on the
  well-known "Template" template id to enumerate; skips
  `/sitecore/templates/System` by default.
- `audit datasource-missing list` — page items whose `__Renderings`
  / `__Final Renderings` reference datasources (path or itemId)
  that don't resolve. Distinct from `broken-links` because the
  field shape is XML; failure mode (broken page render) is
  higher-impact.
- `audit duplicates list` — items with byte-identical authored
  content, grouped by SHA-256 content hash. Excludes `__`-prefixed
  system fields by default; surfaces groups with ≥ 2 members
  (configurable via `--min-group-size`).
- `audit empty-items list` — items where every author-facing field
  is empty or whitespace.
- `audit page-design-orphans list` — XM Cloud SXA pages whose
  `__Final Page Design` / `__Page Design` field references a
  missing item.
- `audit personalization-broken list` — pages with personalization
  rules (`<rules>` blocks in rendering XML) referencing missing
  variant items or rule sets.

**New `scai cleanup` verbs (mutating, with `--what-if` / `--allow-write`):**

- `cleanup archive purge --older-than-days N` — purge items from
  the Sitecore archive older than N days. Honors `--archive-name`.
- `cleanup dead-templates purge --root <path>` — delete templates
  with zero items, then recursively clean up empty template folders
  (toggle via `--no-cleanup-empty-folders`).
- `cleanup duplicates purge --keep-rule <oldest|newest|shortest-path|interactive>`
  — delete duplicate items, keeping one per group per the chosen
  rule. Default `oldest` (created-date). Interactive mode prompts
  per group; rejects under `--non-interactive`.
- `cleanup versions archive --root <path> --keep N` — soft alternative
  to `cleanup versions prune`. Moves older versions to the Sitecore
  archive via `archiveVersion` (reversible via `restoreArchivedVersion`
  in the admin UI) instead of deleting them.

**Hygiene client extensions:** `deleteItem`, `deleteItemTemplate`,
`deleteArchivedItem`, `archiveVersion`, `listItemTemplates`,
`getChildren`. The templates enumeration is implemented over the
search index (`_template: <Template template id>`) since the
`itemTemplates(where: {path})` connection matches a single template
by path, not a subtree, and `standardValuesItem` requires a
`language` argument that's awkward to thread through here.

**Shared parsers:** new helpers `extractRenderingDatasources`,
`extractPersonalizationRefs`, `computeContentHash`, plus
`isRenderingField` / `isPageDesignField` constants.

42 new unit tests; 89 total in the hygiene module. Live-validated
all 10 new verbs against the sandbox tenant.
