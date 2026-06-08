# @sitecoreai-labs/sitecoreai-cli

## 0.3.0-canary.18

### Patch Changes

- Repair non-canonical `richArray` brand-kit fields on sync (Tone of Voice / Image Style).

  The earlier fix stopped scai from writing scenario entries without `tags`/`restrictions`, but only on an actual write — kits written by an older scai still hold the broken `[{name}]` shape, and since the recipe value equals the broken live value the field diffs as a no-op, so a normal re-sync never rewrites it and the Sitecore section render keeps crashing on `entry.tags.map(undefined)`. `plan` now detects any live `richArray` field whose entries lack `tags`/`restrictions` and force-emits an `update`, so the next sync rewrites the canonical shape (idempotent once repaired). Fixes broken Tone of Voice / Image Style pages on existing brands via a normal re-sync.

## 0.3.0-canary.17

### Patch Changes

- Suppress the `⚠ … unstable surface` banner for `--json` / `--format json` output.

  `markUnstable`'s preAction hook wrote the banner to stderr on every unstable-surface invocation (`scai ops brief`, `ops campaign`, `brand`, `agents`). stdout JSON was clean, but a consumer capturing the merged stdout+stderr stream — the orchestrator's spawn, or a `2>&1 | jq` pipe — got the banner prepended and couldn't parse the JSON. The banner is now suppressed for machine-readable output, exactly as it already honors `--quiet`; the human path is unchanged.

## 0.3.0-canary.16

### Patch Changes

- Resolve whole-entity deletion by conflict policy, consistently across all kinds.

  Every kind's `plan()` hardcoded `if (current === null) return diff(desired, null)` — an unconditional recreate when the entity is gone on the tenant, ignoring both the baseline and the push conflict policy. So a kit/brief/campaign deleted on Sitecore silently reappeared on the next background sync, and the behaviour diverged from how field-level cms-edits are handled (and between brand and stories).

  A missing entity with a stored baseline is the extreme case of a cms-edit (the tenant changed it from exists→gone), so it's now resolved by the same policy via one shared helper `resolveMissingCurrentPlan`: no baseline → first-push recreate; `recipe-wins` → recreate; `cms-wins` → honor the deletion (no-op, don't resurrect); `error` → `POLICY_DENIED` into the same resolve flow as a field conflict ("Use my changes" → recipe-wins recreate, "Use Sitecore's changes" → cms-wins accept). Wired into brand-kit, brief-type, brief, and campaign so all four behave identically. No UI changes needed.

## 0.3.0-canary.15

### Patch Changes

- Repair three brand-kit sections that were broken in the Sitecore AI app.

  **Tone of Voice / Image Style** (`richArray` scenarios): scai wrote scenario entries as bare `{name}`, dropping empty `tags`/`restrictions`. The Sitecore AI section page renders each entry with an unguarded `entry.tags.map(...)`, so a missing `tags` threw `Cannot read properties of undefined (reading 'map')` and the whole page failed to load. `toObjectArrayValue` now always emits `tags: []` and `restrictions: ""` for `richArray` entries.

  **Glossary terms**: each term is a _field_ the enrichment pipeline never creates, so the section stayed empty and term changes were skipped (no field id to PATCH). The Brand Management API exposes `POST .../sections/{id}/fields` (`create_brand_kit_section_field`) — it was just never wrapped. Adds `createBrandKitSectionField` and, in `apply`, creates the field for a glossary-shaped change (name = term, type = `array`, value = locale rows) instead of skipping. Also fixes the `array` coercion that flattened glossary rows `{term, locale, displayName}` to `{name}`, corrupting existing glossary fields.

## 0.3.0-canary.14

### Patch Changes

- Fix `brand sync push` still aborting on phantom conflicts against pre-existing baselines.

  The previous fix stopped emitting `kit.description`/`kit.industry` cells, but baselines already stored (e.g. in the orchestrator DB) were captured under the old hash and still carry them. `classifyCellHashMaps` unions in baseline keys, so against a stale baseline those retired cells classified as a `conflict` (desired absent, current absent, baseline value — both sides "moved off baseline") and `--conflict-policy error` refused the push. Existing brands therefore stayed broken until re-baselined.

  Strip the retired `kit.*` cells from a baseline before classification so a stale baseline behaves like a freshly-captured one — no re-baseline required. Scoped to the brand kind; the shared `classifyHashes` both-moved-is-conflict decision is left intact. Adds a regression test.

## 0.3.0-canary.13

### Patch Changes

- Fix `brand sync push` aborting on phantom three-way-merge conflicts.

  `hashBrandCells` emitted `kit.description` and `kit.industry` cells, but those are Sitecore-owned kit metadata — written once at `createBrandKit` time and never by the converge loop. `readCurrent` always populates them from the live kit, while a pushed recipe omits them (the registry renders them read-only). So `desired` (undefined) perpetually diverged from `current` (live value): the planner classified both as a `cms-edit` on every push, and under `--conflict-policy error` it refused before any writes — breaking push entirely for otherwise-unchanged content. `cms-wins`/`recipe-wins` masked it; `error` (the registry's manual "Sync to Sitecore AI" default) exposed it. Pull has no merge gate, so pull kept working while push failed.

  Omit `description`/`industry` from `hashBrandCells`, exactly as `documents` is omitted — they are not a write-back surface, so they have no place in the diff. Adds a regression test asserting an `error`-policy push is not blocked when only Sitecore-owned metadata differs.

## 0.3.0-canary.12

### Patch Changes

- Fix `brand sync push` corrupting brand-kit fields by writing the wrong value shape.

  Each recipe field value was written to Sitecore raw, ignoring the live field's `type`. The recipe value union is permissive (`string | object-array`), so an LLM-generated recipe can hand a plain string to a `richArray` field ("Tone scenarios", "Image style scenarios") or an object-array to a `text` field. Writing the mismatched shape corrupts the field — the Sitecore AI app then maps over a string (or renders an object as text) and the whole section page throws ("Tone of Voice / Image Style pages are broken").

  `indexFields` already reads each field's `type` from the v2 fields API but dropped it. Thread it into `FieldTarget` and coerce in `toApiValue`:
  - `text` → newline-joined string (flattens object-arrays)
  - `array` → `[{ name }]`
  - `richArray` → `[{ name, tags?, restrictions? }]`

  A stray string is wrapped as a single entry; off-schema entries normalise to at least carry `name`. Unknown type (older API response without the discriminator) falls back to the legacy passthrough. Adds coercion tests for string → richArray wrap and object-array → text flatten.

## 0.3.0-canary.11

### Patch Changes

- Fix recipe-push abort when ≥2 component recipes share a site-scoped datasource subfolder.

  The shared Data Folder coalescer (`buildSharedDataFoldersAggregate`) emitted the SHARED `<Subfolder> Data Folder` template AND its Insert Options `SetField` in a single synthetic IR placed AFTER the per-recipe IRs. But each recipe's `site-data-folder:<site>:<subfolder>` folder ITEM is created with `templateOf = sharedDataFolderTemplateId(...)`, so at apply time Authoring GraphQL aborted with "Cannot find a template with the `<id>` id" — the shared template hadn't been created yet. That rolled back the owning recipe (the alphabetically-first contributor), which also owns the section's Presentation Parameters bucket it created, cascading "item not found" into every sibling recipe sharing the section.

  Split the aggregate so its two halves sit on opposite sides of the per-recipe IRs:
  - Template creation (CreateItem template + SV + base-templates + SetStandardValues) is **prepended** to the IR list — `__shared-data-folders__` now runs before any folder ITEM that references the shared template via `templateOf`.
  - Insert Options `SetField` moves to a new `__shared-data-folder-insert-options__` IR **appended** after the per-recipe IRs, because its `ref-recipe-list` references each contributing recipe's datasource template (created by those recipes).

  Manifests as a real failure in the registry's cards-and-lists families (e.g. `Articles`, shared by `article-card` + `articles-list-grid` + `articles-carousel`). Adds a regression test asserting the shared-template IR precedes every `site-data-folder:` folder-item IR and the Insert Options IR follows them.

## 0.3.0-canary.10

### Minor Changes

- 3956779: Add `variant` recipe kind — brand-scoped sidecar variants for canonical renderings.

  Implements the scai side of the `VariantRecipe` contract the registry schema defined. A `VariantRecipe` is a standalone recipe that adds **one** new variant to an existing rendering without mutating the canonical — schema-level enforcement of "recipe is sacred." It carries the canonical's handle + a PascalCase variant name + the TSX source for the head-repo sidecar file.

  `compileVariantRecipe` emits exactly two Sitecore writes: the per-rendering `HEADLESS_VARIANTS` folder (idempotent — converges on the same folder the canonical's inline-variant emitter uses) and the `VARIANT_DEFINITION` item at `<headlessVariantsRoot>/<targetRendering.name>/<name>`. The tree is flat — section-grouping intermediaries break Pages chrome's two-level folder walk (verified live tenant 2026-05-31, see `emitVariants` in `component-template.ts`).

  The `content` field on the recipe is **not** consumed by scai. It carries the TSX source through to the install descriptor / head-repo file-drop pipeline that writes the sidecar at `<canonical-dir>/<canonical-prefix>.<kebab(name)>.tsx`, where the Sitecore Content SDK's component-map generator (`prepareComponentsForMap`) auto-groups it with the canonical under one map entry. Keeping `content` on the recipe means one shape covers the orchestrator DB row, the install descriptor, and this recipe.

  Wired into `compileRecipeSet` dispatch + the `compileRecipe` catch-all, with rank 1 (after rank-0 component templates so the topo sort runs the variant after its canonical when both happen to be in the same set) and `composition-structure` policy (`CreateAndUpdate` — re-pushes can update the variant's displayName; the canonical is untouched by the op set this kind emits).

  11 unit tests cover IR shape, the flat-tree invariant, deterministic ids across compiles, the content-not-emitted contract, the `headlessVariantsRoot`-required behavior, and dispatch through the public `compileRecipe` entry point.

## 0.3.0-canary.9

### Minor Changes

- 0370043: `recipe`: unify `Layout` shape across Partial / Page / PageDesign and inline scoped datasource fields.

  Symmetric with the registry's 2026-06-06 reconciliation: scai now models the same `Layout` shape regardless of carrier recipe kind, and a scoped placement carries its materialised `<page>/Data/<slot>` field values inline.

  **`ComponentPlacement.datasourceRef.scoped.fields: Record<string, unknown>`** (new, defaults to `{}`).

  The slot item the compiler materialises under `<page>/Data/<slot>` now gets its field values from the same placement that names the slot, rather than from a sibling content-item recipe. `compilePageRecipe` reads the placement's `fields` and emits one `SetField` per key against the slot item's refKey, scoped to the resolved datasource template for fieldId derivation. Pull-side `placementFromParsed` carries `fields: {}` on scoped placements (round-trip of the materialised slot-item field values is not modelled here — `readCurrent` doesn't reconstruct them).

  **`PageRecipeSchema.itemPath?: string`** (new optional).

  Explicit content-tree path override that must match `/^\/sitecore\/content\/\{site\}\/.+/`. `{site}` is the only supported placeholder and is replaced with the active site name at compile time so the same recipe installs cleanly across sites. The path's parent directory becomes the page's parent ref; the leaf segment supersedes `name` for path emission. `compilePageRecipe` falls back to `joinPath(context.pagesRoot, name)` when `itemPath` is omitted, so the legacy behavior is preserved — `context.pagesRoot` is now required only on the fallback path.

  **`PageRecipeSchema.fields: Record<string, unknown>`** (loosened from `Record<string, ContentFieldValueSchema>`).

  Page-level fields now accept both the scai-native discriminated `ContentFieldValue` shape and the registry's flat shape — plain strings (text), booleans, numbers, `{src, alt, width?, height?}` for images, `{href, text?, target?, title?}` for external links. A new `normalizeFieldValue` helper in `compile/page.ts` maps the flat shape into `ContentFieldValue` and then delegates to the shared `encodeContentFieldValue` for the Sitecore wire form. `extractRecipeDependencies` and `validateRecipeSet` defensively sniff `shape` on the unknown-typed values so only scai-native shapes participate in cross-recipe handle ref checks.

  The registry's `page.recipe.ts` / `homepage-demo.recipe.ts` round-trip end-to-end against this shape without needing a translation layer on the orchestrator's side.

- SiteTemplate compile is now lossless — `compileSiteTemplateRecipe` writes
  every field the schema accepts. Adds Module synthesis + picker SetField
  ops (project paths, action templates, setup actions, picker UX fields),
  a new MediaUpload IR op for thumbnails, and DictionaryRecipe with
  `siteRole: shared` + cross-recipe shared-site validation. Live-verified
  end-to-end against the sandbox tenant with integration coverage and
  cleanup sweeps.

## 0.3.0-canary.8

### Minor Changes

- Brief-type schema: accept `type: "Boolean"` field definitions.

  Adds `BooleanFieldSchema` to `BriefFieldSchema`'s discriminated union and the corresponding `BooleanField` type to the API schema. Required to round-trip Sitecore's built-in `SitecoreAIEvaluation` brief type — its `QualifiedBANT` field is `type: "Boolean"`, the only Boolean field observed across the tenant's 11 brief types (verified 2026-06-04). Without this, `BriefTypeRecipeSchema.parse()` rejected the recipe at push time with "failed schema validation".

  The Brief API server-side has always accepted Boolean (proven by `SitecoreAIEvaluation` existing on every tenant); this change unblocks scai's local validation gate.

  Note: Boolean is treated as a Sitecore-internal field type — the SitecoreAI brief-type authoring UI does not currently expose it as a creatable field-type option. Use only when round-tripping types Sitecore owns; don't author new Boolean fields in user-created types unless the UI gains support.

## 0.3.0-canary.7

### Minor Changes

- `brief delete`: clear `brief.references[]` before issuing the DELETE.

  `runBriefDelete` now PUTs `{references: []}` against the brief immediately before calling `deleteBrief`. The Orchestrate `deleteProject` reverse-view machinery tries to detach `project.briefs[]` entries before completing — and 403s when those briefs have already been deleted without first clearing their references. Doing the unlink at the source (brief side) gives Orchestrate's reverse view a chance to clean up while the brief is still alive, eliminating the dangling-reference state that the project-delete path can't recover from.

  Best-effort: a failure on the unlink step is logged but does not block the delete (the brief still ends up gone — that's the caller's goal; only the downstream project might carry a dangling ref, which is no worse than the prior behaviour). Verified empirically 2026-06-04 that PUT-ing an empty `references` array on a brief with no references is a clean no-op, so the unlink step is safe to apply unconditionally.

  Consumers: the showcase-orchestrater's `brand-delete-mode` (and `story-delete-mode`) cascade now drives this fix automatically — no orchestrator-side changes required to pick it up.

## 0.3.0-canary.6

### Minor Changes

- `campaign sync pull`: add `--sitecore-id` for id-first lookup, and reverse-map task `dependencies` back to handles.

  Two coordinated fixes so a campaign round-trip stays lossless when SAI-side edits land via the registry's auto-pull-on-load.
  1. **`--sitecore-id <uuid>` on `scai ops campaign sync pull`** — when present, `campaignKind.readCurrent` resolves the Orchestrate project by id via `getProject` directly and skips the paged display-name search. Falls back to the legacy name search if the id resolves to nothing (stale UUID survives without permanently blocking pull). Mirrors the push side, which already used `recipe.sitecoreId` as `KindRef.tenantId`. Without this, any rename on either the registry or SAI side surfaced as "Campaign 'X' not found" and the orchestrator's not-found heuristic silently treated the pull as "no-tenant-state" — appearing as if pull did nothing at all.
  2. **Reverse-map task `dependencies` UUID triples → handles on pull.** `toRecipeTask` previously hardcoded `dependencies: []` because the Orchestrate wire stores deps as `{project_id, project_deliverable_id, task_id}` triples and the recipe shape carries them as handle arrays. The orchestrator's auto-pull then wrote that empty list back to the registry's recipe, wiping every LLM-generated dependency on the first push-pull cycle; the next edit re-pushed empty deps and SAI lost them too. `readCurrent` now builds a `taskId → handle` index from `handle:<x>` labels and projects each dep entry through it; tasks without a handle label are silently dropped from the dep list (can't be addressed by handle on the recipe side).

  No `RecipeKind` interface change. New tests cover `ref.tenantId` direct-load, stale-id fallback to name search, and dep reverse-mapping including the legacy-task drop case.

## 0.3.0-canary.5

### Minor Changes

- `brand sync push`: surface the resolved Sitecore brand-kit UUID via `--identities-out` + a new `"brand-kit"` scope on `ResolvedIdentity`.

  Three coordinated changes so the orchestrator can stamp the real SAI-side brand-kit UUID onto its `brand_kits` row instead of carrying the recipe handle as a placeholder (and breaking downstream campaign pushes that need `brandkit_id`).
  1. **`ResolvedIdentity.scope`** gains a `"brand-kit"` member. Previously the type-doc said brand-kit applies had nothing to surface ("the kit is identified by the brand UUID the caller already supplied") — but the caller is the orchestrator, and it identifies the kit by its own brand handle, not by the SAI UUID. Without surfacing the UUID, the orchestrator can't link it back.
  2. **`brandKitKind.apply`** emits a single `"brand-kit"` identity in its `ApplyResult.identities` with the resolved kit UUID (and the kit's display name + the recipe handle, mirroring the campaign/brief identity shape).
  3. **`scai brand sync push --identities-out <path>`** flag writes the apply outcome's identities as JSON to `<path>`, matching the campaign / brief sync surface. Operators reading the file get `{ identities: [{scope: "brand-kit", id: "<uuid>", name: "<display>", handle: "<recipe>"}] }`.

  No behaviour change when the flag is omitted; brand-kit dry-runs continue to surface no identities. Mirrors the campaign-sync identity flow already wired through the orchestrator's brand-kit-deploy worker.

## 0.3.0-canary.4

### Minor Changes

- `campaign sync`: stamp `handle:<x>` identity labels on task updates, not just creates.

  Two related fixes so a task that gains identity in a re-push actually carries it to the tenant:
  1. **Diff (`tasksEqual`)**: treats a desired task as "different from current" when the recipe carries a `handle` AND the current task's labels lack `handle:<handle>`. Without this, a recipe that added identity via the orchestrator's lazy backfill (or a hand-edit) would diff as noop and stop short of writing — the tenant would stay unidentified, so the next rename on Sitecore AI would create a duplicate instead of matching back.
  2. **Apply (UPDATE branch)**: writes `[...task.labels, handle:<handle>]` to the wire, mirroring what the CREATE branch already does. The UPDATE path used to push the raw operator-authored labels directly, dropping the recipe's identity on every PUT.

  Net effect: a story whose tasks were authored before per-row handle minting (LLM-generated or seeded campaigns) can re-establish wire identity via a no-op push. Subsequent tenant-side renames then round-trip cleanly instead of surfacing as duplicates.

  No schema changes; deliverables are unaffected (no UPDATE path on that resource — separate follow-up).

## 0.3.0-canary.3

### Minor Changes

- 0b1c57e: `campaign sync push`: add `--conflict-policy` flag (mirrors brief sync).

  `scai ops campaign sync push` accepts `--conflict-policy <error | recipe-wins | cms-wins>` and threads it into `ctx.pushConflictPolicy`, identical to `scai ops brief sync push --conflict-policy` (shipped earlier).

  Closes a gap that forced the orchestrator to swallow the field — `campaignKind.plan()` defaults `pushConflictPolicy` to `"error"`, which blocks every cms-edit / conflict cell with `POLICY_DENIED`. Hand-driven CLI use can now pick `"cms-wins"` to preserve Sitecore AI edits or `"recipe-wins"` to clobber; automation flows (e.g. the showcase-orchestrater's `recipe_sync` campaign mode) forward whatever the caller's plan specifies so a story autosync doesn't hard-fail on the first tenant-side edit.

  No `RecipeKind` interface change; behaviour identical to the brief flag.

## 0.3.0-canary.2

### Minor Changes

- 47d69f1: `sync`, `brief`, `campaign`: registry-tracked Sitecore UUID identity, URL-safe baseline keys, and a `--identities-out` write-back surface.

  Three related changes that work together to let a registry-backed caller
  (the showcase-orchestrater) skip scai's marker-in-name / handle-label
  fallbacks and read tenant entities by id directly.

  **`KindRef.baselineKey?: string`** (new optional field on the shared
  sync interface).

  Lets the caller pass a stable, URL-safe key for remote baseline storage
  that's decoupled from `ref.id`. `ref.id` keeps the lookup semantics each
  kind already had — full marked display name for briefs, display name +
  labels for campaigns. `ref.baselineKey` rides through to the third path
  segment of the `HttpBaselineStorage` URL (`/<env>/<key>`), so
  URL-significant characters in display names (`&`, `?`, `#`, `%`,
  whitespace) no longer crash the baseline GET/PUT regex on the orchestrator
  end. The `campaigns/recipe/kind.ts` and `brief/recipe/instance-kind.ts`
  baseline calls fall back to `ref.id` when `baselineKey` is absent, so
  nothing changes for CLI invocations that don't supply it.

  **`KindRef.tenantId?: string`** (new optional field).

  Lets a registry-backed caller pin the tenant resource UUID
  authoritatively. When present, the brief + campaign kinds' apply paths
  prefer `getBrief(ref.tenantId)` / `getProject(ref.tenantId)` over the
  baseline-stored tenant id, which in turn beats the marker-in-name /
  label-search fallback. First-push behaviour is unchanged (the caller
  doesn't have a UUID yet); subsequent pushes resolve in O(1) instead of
  paging the tenant list.

  **`CampaignRecipeSchema.handle`, `CampaignRecipeSchema.sitecoreId`,
  `BriefInstanceRecipeSchema.handle`, `BriefInstanceRecipeSchema.sitecoreId`,
  `CampaignDeliverableSchema.sitecoreId`, `CampaignTaskSchema.sitecoreId`**
  (new optional fields).

  The sync commands (`commands/{brief,campaign}/sync.ts`) and the MCP
  tools (`mcp/tools/{brief,campaign}-recipe.ts`) lift `recipe.handle` into
  `KindRef.baselineKey` and `recipe.sitecoreId` into `KindRef.tenantId`.
  Deliverables and tasks gain their own `sitecoreId` on the wire (round-
  tripped through the campaign apply outcome) so callers can persist UUIDs
  for every nested entity, not just the top-level project.

  **`ApplyResult.identities?: ResolvedIdentity[]`** (new optional field
  on the shared `ApplyResult`; `ResolvedIdentity` exported from `@/sync`).

  Surfaces every Sitecore UUID scai resolved during apply, scoped by
  kind. The brief kind emits one identity per pushed brief. The campaign
  kind emits one for the project plus one per handled deliverable and per
  handled task, with `parentHandle` for nesting. Callers persist these
  back onto their own model so subsequent pushes ride the by-id path.

  **`scai ops brief sync push --identities-out <path>`** and
  **`scai ops campaign sync push --identities-out <path>`** (new CLI flag).

  Writes the apply outcome's `identities` to a JSON file at the given
  path (`{ identities: [...] }`). The orchestrator passes a temp path,
  reads the file after a successful push, and stamps the UUIDs into its
  own recipe row. CLI-only invocations can leave the flag unset.

  Composes cleanly with the brief-type three-way merge already shipped
  on `briefTypeKind` and the brief / campaign three-way merges in
  `briefInstanceKind` / `campaignKind`. No `RecipeKind` interface
  breakage — every change is opt-in via the new fields.

## 0.3.0-canary.1

### Minor Changes

- ef4240b: `brief-type`: three-way merge with baseline classification.

  `briefTypeKind` is upgraded from a straight two-way diff to baseline-aware
  three-way merge, matching `briefInstanceKind` and `brandKitKind`. The
  `--conflict-policy` flag (`error` | `recipe-wins` | `cms-wins`) on
  `scai ops brief sync push --kind brief-type` is now honoured — it was a
  no-op before because the kind never consulted `ctx.baselineStorage`.

  **`src/brief/recipe/baseline.ts` (new export):** `BriefTypeBaselinePayload`
  (flat cell map: scalars `name`/`label`/`description`/`icon`/`iconColor` +
  `fields.<codename>`), `hashBriefTypeCells`, `captureBriefTypeBaselinePayload`,
  `classifyBriefTypeCells` (per-cell `first-push` / `recipe-change` /
  `cms-edit` / `conflict` against the previous baseline),
  `mergeBriefTypeByPolicy` (policy-aware resolution; recipe owns the
  field-graph — tenant-only fields are not pulled in, matching brand-kit
  semantics).

  **`briefTypeKind.plan()`**: loads baseline via `ctx.baselineStorage`,
  classifies each cell, merges per `ctx.pushConflictPolicy`, annotates
  each `RecipeChange.meta` with `classification` +
  `perFieldClassification`, surfaces a `policyError` on the lead
  `stage: "type"` change when `error` policy + conflicts.

  **`briefTypeKind.apply()`**: refuses with `POLICY_DENIED` when the plan
  carries an unresolved `policyError`. Writes a fresh baseline reflecting
  the merged (post-policy) state after a successful push. Synthesizes a
  noop `stage: "type"` change when the diff would otherwise emit none, so
  a `cms-wins` full-resolution still refreshes the baseline (otherwise
  the same drift re-classifies as `cms-edit` on the next push —
  `briefInstanceKind` has this same gap, flagged for a future port-back).

  No `RecipeKind` interface change. The behaviour change is opt-in via
  `ctx.baselineStorage` — callers without a baseline store get the same
  two-way diff behaviour they had before.

  43 new unit tests across `tests/unit/brief/recipe/baseline.test.ts` and
  `tests/unit/brief/recipe/kind.test.ts` cover hashing, the four
  classifications, all three policies, field add/remove, field-graph
  ownership, and degradation when `ctx.baselineStorage` is absent.

## 0.3.0-canary.0

### Minor Changes

- 3f5c7fe: `recipe`: drop three registry-compat shims (breaking).

  Three shims that 0.2.5 added for the Sitecore Showcase Design System
  have been removed. The registry recipes have been authoring against the
  canonical shape for a while, so none of the shim paths were exercised
  in practice — but anyone who was relying on them needs to migrate.

  **Removed:**
  - `loadRecipe` no longer accepts `kind: "parameters-template"` as an
    alias for `"design-parameters-template"`. Recipes must spell the kind
    canonically. (Was added in 0.2.5; never used by the registry.)
  - `resolveSitecoreType` no longer defaults `shape: "enum"` fields with
    inline `values: [...]` and no `enumHandle` to `type: "droplist"`.
    Authors must declare `sitecore.type: "droplist"` explicitly. (The
    inline-Droplink rejection — "neither droplist nor enumHandle" — that
    was already in `resolveFieldSource` is the new behavior.)
  - `ComponentTemplateRecipe` no longer combines an external
    `parameters: { handle }` with `dynamicPlaceholders: true`. The
    per-recipe wrapper template synthesis that 0.2.5 added has been
    removed; the validator now surfaces this combination as
    `INPUT_INVALID` with a clear remediation hint. Inline the params via
    `params:` (the `_IDynamicPlaceholder` base chains onto the
    synthesised per-recipe template directly) or drop
    `dynamicPlaceholders` from the consumer.

  **Migration:**
  - `kind: "parameters-template"` → `kind: "design-parameters-template"`
  - inline-values enum params without `sitecore.type` → add `sitecore.type: "droplist"`
  - external `parameters: { handle }` + `dynamicPlaceholders: true` → inline `params: [...]` on the consumer

  Recipes using only canonical shapes (the registry's recipes today) are
  unaffected.

### Patch Changes

- 3f5c7fe: `cli`: drain stderr alongside stdout on force-exit.

  The force-exit path drained only stdout before calling `process.exit`.
  Parent processes that captured stderr — the orchestrator's recipe-sync
  workers do, to surface scai exit details — could lose the trailing log
  line, most visibly the error message the `runCli` catch block prints
  right before exit. Adding a symmetric stderr drain after the stdout
  drain makes both streams flush before the process tears down.

  No behavior change for callers that consume stdout only or that read
  both streams via line buffering.

- 3f5c7fe: `sync` + `recipe/runtime/baseline`: two internal seams for multi-kind
  baseline + per-cell-merge sharing.

  **`src/sync/merge-cells.ts` (new export):** `classifyCellHashMaps` +
  `resolveCellByPolicy` — generic per-cell three-way classifier + push
  policy resolver, factored out of the brand and campaign baseline
  modules (which each carried character-identical copies). Brand and
  campaign now delegate; brief stays standalone (single-cell helper, no
  shape to share).

  **`adaptSyncBaselineStorage(sync) -> BaselineStorage` (new export):**
  adapter that pins `kind: "content-recipe"` so a multi-kind sync
  `BaselineStorage` (e.g. `HttpBaselineStorage`) can back the
  content-recipe 2-arg surface. One orchestrator-side store can now
  serve brand / brief / campaign / story AND content recipes without
  recipe-side callsite changes. `CONTENT_RECIPE_BASELINE_KIND` is
  exported as the stable discriminator (serialised into orchestrator
  URLs / column values).

  No behavior change for existing consumers.

## 0.2.5

### Patch Changes

- 3735363: `recipe`: bidirectional sync — three-way merge between recipes, tenant, and a per-(env, recipe) baseline

  `scai recipe push` and `scai recipe pull` are now joined by a
  baseline-backed three-way merge that detects "the author edited this
  in the CMS since my last push" (push side) and "my local recipe has
  changes the tenant hasn't seen" (pull side). Before 0.3, push silently
  clobbered tenant-side author edits and pull was a snapshot-only dump
  that ignored your local recipes.

  **New on `scai provision recipe push`:**
  - `--conflict-policy=error|recipe-wins|cms-wins` (default `error`) —
    block on any cms-edit / conflict, or pick a side. `error` exits
    non-zero with per-(recipe, op) details so CI fails loud instead of
    silently overwriting.
  - `--no-baseline` — opt out of baseline load + post-apply write
    (legacy two-way diff behaviour).
  - Successful pushes write a baseline file to
    `<configDir>/.scai/baseline/<env>/<slug(handle)>.baseline.json`
    (atomic temp + rename; SHA-256 hashes per field, not values).

  **New `scai provision recipe pull` commands + flags:**
  - `pull` is the new reverse command — read tenant state to disk as
    `.recipe.json` files. Snapshot mode (default) dumps to
    `--output ./pulled-recipes`; never overwrites authored `.recipe.ts`
    source.
  - `--against <recipes-dir>` enables merge-detection mode. Pull
    classifies each recipe as `in-sync` / `disk-ahead` / `tenant-edited`
    / `conflict` / `disk-only` / `tenant-only`, surfaces per-field
    statuses, and blocks under default `--conflict-policy=error` if
    anything needs operator attention.
  - `--conflict-policy=error|disk-wins|tenant-wins` — direction-inverted
    from push. `tenant-wins` does **per-field merge** for ContentItem
    and Page recipes (preserves disk-ahead fields, adopts tenant
    elsewhere); `disk-wins` keeps local recipes authoritative.
  - `--write-plan <path>` emits a hand-editable JSON plan with one
    entry per per-recipe per-field classification + the default winner.
    Operator flips per-field `winner` between `"disk"` and `"tenant"`,
    then re-runs with `--apply-plan <path>` to commit. Apply-plan
    verifies the plan still matches the current tenant + disk state
    (refuses to apply stale plans against a moved world).
  - `--no-baseline` mirrors push.
  - `--dry-run` classifies + reports without writing any files.

  **Reverse-projection (`readCurrent`) coverage:** the projection now
  covers 10 recipe kinds with full multi-language + multi-version
  fidelity for `ContentItem` and `Page`. Layout XML is parsed +
  canonicalised before hashing so push (canonical XML) and tenant
  read-back (SXA delta XML) round-trip cleanly.

  **Public API additions** (importable from `@sitecoreai-labs/sitecoreai-cli/recipe`):
  - `BaselineStorage` interface + `FileBaselineStorage` class (default
    impl). Pass a custom storage to push / pull via
    `RecipeTenantOptions.baselineStorage` for orchestrator-hosted /
    in-memory backends.
  - `Baseline`, `BaselineFieldEntry`, `BaselineIndex` types +
    `BaselineSchema`, `BaselineFieldEntrySchema` Zod schemas.
  - `loadBaseline`, `writeBaseline`, `baselineFilePath`,
    `indexBaseline`, `hashFieldValue`, `hashFieldValueForBaseline`,
    `isLayoutFieldId`, `canonicaliseLayoutXml`.
  - `MergePlan`, `MergePlanRecipe`, `MergePlanField` types +
    `MergePlanSchema`, `MergePlanRecipeSchema`, `MergePlanFieldSchema`
    Zod schemas.

  **Behaviour changes operators will see:**
  - Successful `recipe push` now writes baseline files (one per
    recipe, per env) to `<configDir>/.scai/baseline/<env>/`. Add
    to `.gitignore` if you don't want them checked in; they regenerate
    on each push.
  - Default `recipe push` policy is `error` — out-of-band Sitecore UI
    edits will block re-pushes until the operator picks
    `--conflict-policy=recipe-wins` or `=cms-wins`. To restore the
    pre-0.3 silent-clobber behaviour, pass `--conflict-policy=recipe-wins`
    or `--no-baseline`.
  - `recipe pull` is new — no behaviour change for existing flows that
    don't run it.

  **Security:** the `Scai Handle` tenant marker field is now validated
  against `HANDLE_PATTERN` before being trusted in file-path composition
  (audit-flagged path-traversal hardening). Malformed markers
  (`'../../tmp/pwn@1'`, paths with separators, etc.) fall back to
  synthesising the handle from the Sitecore item name; defensive
  `assertWithinDir` guards added to `writeRecipeJson` +
  `FileBaselineStorage` as belt-and-braces.

  **Performance:** baseline loads run in parallel (was sequential);
  layout XML parses are deduped on the planner's hot path (4× → 2×
  parses per drift); template per-field rollup is O(1) per field
  (was O(T × S) via prefix-walk).

  Full operator walkthrough: [`docs/bidirectional-sync.md`](https://github.com/Sitecore-Studio-Labs/sitecoreai-cli/blob/main/docs/bidirectional-sync.md).
  Architecture rationale: [`docs/recipe-sync-architecture.md`](https://github.com/Sitecore-Studio-Labs/sitecoreai-cli/blob/main/docs/recipe-sync-architecture.md).

- 3735363: `recipe`: sanitise multi-segment subfolder when naming a per-location data-folder template

  A `datasource.locations: [{ scope: "site", subfolder: "Site Shared UI/Avatars", allowedTemplates: [...] }]` block compiled into a per-location data-folder template whose item NAME embedded the raw subfolder string — producing `"avatar-block Site Shared UI/Avatars Data Folder"`. Sitecore's `InvalidItemNameChars` setting rejects `/` in item names, so Authoring GraphQL aborted the upsert with:

  ```
  An item name cannot contain any of the following characters: \/:?"<>|[]
  ```

  `emitSiteDataFolderTemplate`'s per-location path now collapses `/` to `-` in the item NAME (and the path segment) so both subfolder segments stay legible without violating the name rule. The display NAME keeps the original `/` since Sitecore allows it there.

  ```ts
  // subfolder: "Site Shared UI/Avatars"

  // item name (sanitised):
  "avatar-block Site Shared UI - Avatars Data Folder";

  // display name (preserved):
  "Avatar Block Site Shared UI/Avatars Data Folder";
  ```

  The SHARED data-folder template path (cross-recipe coalescing) was already correct — it used `leafSegment` and routed intermediate segments into the path hierarchy. Only the per-location codepath had the bug.

  Repro: any `ComponentTemplateRecipe` with `datasource.locations` declaring a multi-segment subfolder + `allowedTemplates` aborted on push.

- 3735363: `recipe`: pair `UsePlaceholderDatasourceContext=true` with dynamic placeholders + skip phantom data templates for pure-layout renderings

  Two follow-ups to the Placeholders shared-field fix that round out the
  dynamic-placeholder chain so scai-emitted renderings match the SXA / XM
  Cloud starter Container shape end-to-end.

  **`UsePlaceholderDatasourceContext=true`** is now written alongside
  `IsRenderingsWithDynamicPlaceholders=true` in OtherProperties whenever
  `dynamicPlaceholders: true`. Without it, children dropped into a
  Container / Section Wrapper / partial-design slot can lose their
  relative-datasource binding when the layout service serialises the
  placeholder map — the parent-context binding gets dropped and child
  renderings resolve against the page root instead of the parent
  datasource. Both properties ride with the dynamic-placeholder chain on
  the XM Cloud starter Container rendering; both are needed.

  **Pure-layout renderings now skip data-template emission.** A recipe
  with no `fields:` and no `insertOptions:` (e.g. Container,
  ColumnSplitter, RowSplitter, SectionWrapper, partial designs)
  previously emitted a phantom empty data template at
  `<componentsRoot>/<section>/<Name>` — orphan, never referenced (the
  rendering's Datasource Template shared field was already omitted for
  the same case). The XM Cloud starter Container has only a Rendering
  item + Parameters Template; no template in the templates tree.
  `emitDatasourceTemplate` is now gated on `hasInlineFields ||
hasInsertOptions` so layout-only recipes match the starter shape.

  Recipes that bind content (`fields: [...]`) or compose child items via
  `insertOptions: [...]` still emit a data template — only the
  fields-empty + insertOptions-empty case is skipped.

- 3735363: `ComponentTemplateRecipe`: support `dynamicPlaceholders: true` combined with
  an external `parameters: { handle }` reference.

  Previously, scai rejected this combination because chaining
  `_IDynamicPlaceholder` onto the external shared parameters template would
  mutate behaviour for every other consumer. Authors had to inline the params
  on every recipe that wanted dynamic placeholders, losing the shared-template
  benefit.

  Now the compiler emits a thin per-recipe **wrapper** parameters template
  that inherits FROM the external shared template AND adds
  `_IDynamicPlaceholder`. The external template's base-template chain isn't
  mutated; the wrapper has no own fields (everything inherits via Sitecore
  template inheritance); the rendering's `Parameters Template` field points
  at the wrapper instead of the external directly. The wrapper's GUID is
  `designParametersTemplateId(site, recipe.handle)` — same as the inline-
  params synthesis (they're mutually exclusive).

  Behaviour for recipes that already work (inline-params-only OR
  external-params-without-dynamic-placeholders) is unchanged. Recipes that
  previously failed with the `combines dynamicPlaceholders + external
parameters template` error now compile.

- 3735363: `resolveSitecoreType`: default `shape: "enum"` fields with inline
  `values: [...]` and no `enumHandle` to `type: "droplist"`.

  Previously the default was `droplink`, which requires `sitecore.enumHandle`
  pointing at a shared `EnumerationRecipe`. Authors who wrote inline `values`
  had no shared enum to point at, so compile threw INPUT_INVALID and demanded
  they add a redundant `sitecore.type: "droplist"` to every enum field.

  Now the default tracks intent: inline `values` → droplist (pipe-list Source).
  Authors who want droplink + shared enum still get it: declare `enumHandle`
  without inline `values`, and the shape-based default (`droplink`) stands.

  Authors who explicitly set `sitecore.type` are unaffected.

- 3735363: `recipe`: drop the section-grouping folder under the Headless Variants tree so SXA Pages chrome can find variant items

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

- 3735363: `recipe`: encode `image` Standard Values defaults from an `alt|src` URL string

  `image`-shaped fields previously dropped their `default` value during SV
  emission — the encoder returned `undefined` for every remaining
  reference shape on the rationale that media-library item references
  weren't expressible from a recipe string. That left every recipe with
  a Media field rendering an empty image slot until an author manually
  picked a media item.

  The encoder now accepts a pipe-separated `"<alt>|<src>"` convention
  (or a bare `"<src>"` with no pipe) and emits Sitecore's image-field
  XML with the external-URL `src` form:

  ```ts
  { name: "Hero", shape: "image",
    default: "Hero placeholder|https://picsum.photos/seed/hero/1200/600" }

  // → <image src="https://picsum.photos/seed/hero/1200/600" alt="Hero placeholder" />
  ```

  Sitecore Layout Service surfaces the encoded value as `{ src, alt }`
  in the image-field JSON the React side reads. Authors swap to a real
  media-library item via the image picker at placement time; until they
  do, the seeded src renders the placeholder image so dropped renderings
  visualise immediately. Empty raw values or pipe-only with no src are
  skipped — they'd produce a broken `<img src="">` otherwise.

  `file`, `droplink`, `treelist`, and `treelist-with-search` are still
  skipped — they need GUID payloads the string convention can't express.
  Future work could resolve these against the recipe set's content
  recipes (find the content item by handle, emit its deterministic GUID).

- 3735363: `compileRecipeSet`: order recipes topologically within each apply-rank.

  Previously, recipes that shared an apply-rank (e.g. `ComponentTemplate` and
  `ContentTemplate`, both rank 0) were ordered by stable file-glob order. A
  referencing recipe whose filename sorted alphabetically before its referent
  (e.g. `accordion-block.recipe.ts` < `faq-content.recipe.ts`) would fail at
  push time with `ref-source-fields references handle 'faq-content@1'; not yet
in captured map` because the dependent's `field.sitecore.source.types: [...]`
  emitted before the dependency's `CreateItem`.

  Replace the coarse rank-only sort with stable Kahn topological sort within
  each rank group. `extractRecipeDependencies` mirrors `validate.ts`'s
  reference inventory across every recipe kind. Producer recipes emit before
  consumers; unrelated siblings preserve input order; cycles (shouldn't reach
  this layer) degrade gracefully to input order.

  No behaviour change for recipe sets without intra-rank cross-references.

- 3735363: `recipe`: stamp page Data folder Insert Options (`__Masters`) from the page's rendering datasource templates

  A `PageRecipe` with `placements[]` referencing rendering datasource templates materialised the `<page>/Data` folder as a bare `FOLDER` item with no `__Standard Values` `__Masters` field. Authors who turned off `autoCreate` on a rendering — or wanted to create another datasource later from the Sitecore Pages tree — saw an empty right-click Insert menu.

  `compile/page.ts` now walks every placement, collects the union of the rendering's `datasource.templates[]` / `datasource.template` / inline-fields handles (deduped, first-seen order), and emits a `SetField` op writing those template GUIDs as a `ref-recipe-list` into the Data folder's `__Masters` shared field. The resolver uses `tolerateMissing: true` so standalone single-recipe compiles still emit the field; multi-component pages get one entry per unique template across all placements.

  Three new tests in `tests/unit/recipe/page-level.test.ts` cover: union resolution across `templates[]` + `template` + inline-fields fallbacks (deduped across placements), no-emit when the page has no scoped slots, and `tolerateMissing` standalone compile.

- 3735363: `loadRecipe`: accept `kind: "parameters-template"` as an alias for
  `"design-parameters-template"`.

  The registry and some older recipes spell the design-parameters-template
  kind as `"parameters-template"`. `loadRecipe` now normalizes the kind
  literal before zod parse so `RecipeSchema`'s discriminated union finds
  the right variant. Rest of the pipeline (`RECIPE_APPLY_RANK`,
  `compileRecipeSet` dispatch, executor) still only knows the canonical
  `design-parameters-template` literal — the alias lives entirely at the
  loader boundary.

  Existing recipes using `"design-parameters-template"` are unaffected.

- 3735363: `recipe`: accept `allowedRenderingHandles` alias on inline placeholder slots

  The registry-side recipe schema names this field
  `allowedRenderingHandles` (handles ARE rendering handles, so the name
  is more descriptive); scai's canonical name had stayed
  `allowedComponents`. Recipes authored against the registry naming
  silently dropped their slot-side restriction at compile time — the
  field was present in the recipe JSON but ignored by both the compiler
  and `validateRecipeSet`, so the Placeholder Settings item ended up
  permissive (e.g. accordion-block's Headless `accordion-items-{*}`
  slot accepted any rendering instead of restricting to
  `accordion-item-rendering@1`).

  `PlaceholderDefinitionSchema` now accepts both fields; a new
  `resolveAllowedHandles` helper returns the de-duped union (source
  order). Compiler + validator both route through the helper, so
  recipes using either name compile to the same Sitecore artifact.
  Validation messages normalise to `allowedRenderingHandles` so the
  canonical name surfaces in author-facing errors.

- 3735363: `recipe`: encode `file`, `droplink`, `treelist`, and `treelist-with-search` Standard Values defaults

  Rounds out SV default encoding so every common field shape can be
  seeded from a recipe string. Authors no longer have to swap to a
  "populate after deploy" workflow just to get a non-empty initial
  field — every shape now has a path.

  **`file`** (same convention as `image`):

  ```ts
  { name: "Document", shape: "image", sitecore: { type: "file" },
    default: "Whitepaper|https://example.com/wp.pdf" }
  // → <file src="https://example.com/wp.pdf" alt="Whitepaper" />
  ```

  **`reference` shape — single (Droplink)**: the default is a recipe
  handle; the encoder resolves it to that handle's deterministic
  `contentItemId(site, handle)` GUID and emits a `ref-recipe`:

  ```ts
  { name: "Author", shape: "reference", multiple: false,
    sitecore: { type: "droplink" },
    default: "author-jane@1" }
  // → SV value = ref-recipe pointing at contentItemId(site, "author-jane@1")
  ```

  **`reference` shape — multi (Treelist / Treelist-with-search)**: the
  default is pipe-separated recipe handles; emits a `ref-recipe-list`:

  ```ts
  { name: "Authors", shape: "reference", multiple: true,
    sitecore: { type: "treelist" },
    default: "author-jane@1|author-bob@1" }
  // → SV value = ref-recipe-list, refKeys = [contentItemId(...), ...]
  ```

  The recipe set must materialise content items at the referenced
  handles in the same compile run. If a handle doesn't resolve, the SV
  write fails at apply time with the executor's standard "ref-recipe
  target not in captured-itemId map" error — author error, not silently
  masked. Same contract as enum-value defaults.

  Tests: 5,144 passing (+5 covering file + single/multi reference +
  empty-input safe handling).

- 3735363: `recipe`: drop `IncludeTemplatesForSelection` filter from `reference + enumHandle` Treelist sources

  Sitecore Pages's Treelist chrome rejects every pick under the combined
  `DataSource=<path>&IncludeTemplatesForSelection=<GUID>` form, leaving
  authors with "the source's filter doesn't allow those options" and no
  recovery path on any field whose recipe declares
  `shape: "reference"` + `sitecore.enumHandle`. The template filter
  wasn't load-bearing — scai deliberately doesn't emit per-folder
  `__Standard Values` items inside enum folders, so the enum folder's
  children are exactly the value items the picker should surface.
  Switched the compile to emit plain `DataSource=<enumPath>`.
  Regression-tested in `compile-shared.test.ts`.

- 3735363: `recipe`: honour `sitecore.enumHandle` on `shape: "reference"` (Treelist pick-from-enum)

  Previously `enumHandle` only worked on `shape: "enum"` (single-select
  Droplink). For multi-pick scenarios — "pick which social platforms to
  show", "pick which feature flags this site enables" — authors had to
  fall back to a free-text comma-separated convention because the
  recipe DSL couldn't express "Treelist sourced from this enum".

  Now `enumHandle` works on `shape: "reference"` too. Both branches use
  the same enum folder path resolution; the reference branch additionally
  restricts the picker to enum value items via
  `IncludeTemplatesForSelection`:

  ```ts
  // Single-pick Droplink (existing behaviour, unchanged):
  { name: "Platform", shape: "enum",
    sitecore: { enumHandle: "social-platform@1" } }
  // → Source: /sitecore/.../Enumerations/SocialPlatform

  // Multi-pick Treelist (NEW):
  { name: "Platforms", shape: "reference", multiple: true,
    sitecore: { type: "treelist", enumHandle: "social-platform@1" } }
  // → Source: DataSource=/sitecore/.../Enumerations/SocialPlatform
  //           &IncludeTemplatesForSelection={<enum-value-template-GUID>}
  ```

  Standard Values defaults follow the same rules:

  ```ts
  // Single-pick default = enum value name:
  { ..., default: "x" }
  // → SV value = ref-recipe pointing at enumValueId(folder, "x")

  // Multi-pick default = pipe-separated enum value names:
  { ..., default: "facebook|x|linkedin" }
  // → SV value = ref-recipe-list pointing at the three enum values
  ```

  Same author-error contract as enum-shape SV defaults: referencing a
  value name the enum doesn't define fails at apply time with the
  standard "ref-recipe target not in captured-itemId map" error.

  Tests: 5,147 passing (+3 covering the new branches).

- 3735363: `recipe`: wire rendering Placeholders Treelist to the Placeholder Settings items it creates

  `ComponentTemplateRecipe`'s `placeholders: [...]` block previously
  only emitted `Placeholder Settings` items at `placeholderSettingsRoot`
  — which carry per-key allow-lists and editor-toolbox metadata. The
  matching wire on the Rendering item that joins those settings items
  to the rendering was missing, so the layout service shipped no
  `placeholders` array for the rendering, child renderings never
  resolved, and the headless SDK warned

      Placeholder '<slot>-1' was not found in the current rendering data

  even when the recipe correctly set `dynamicPlaceholders: true`,
  chained the `_IDynamicPlaceholder` base template, and emitted every
  Placeholder Settings item the slot needed.

  `emitRendering` now writes the **Placeholders** (plural) Treelist
  shared field at `069a8361-b1cd-437c-8c32-a3be78941446` — the SXA
  Headless rendering-chain field, mixed in via
  `/sitecore/templates/System/Layout/Sections/Rendering Options/Layout Service/Placeholders`.
  Value is a `ref-recipe-list` of GUIDs, one per declared slot, each
  pointing at the matching Placeholder Settings item already emitted
  by `buildPlaceholderSettingsAggregate`:

  ```ts
  {
    placeholders: [
      { key: "container-{*}" },
      { key: "footer-{*}" },
    ],
  }
  // → Placeholders Treelist refs:
  //   [
  //     placeholderSettingsId(site, "container-{*}"),
  //     placeholderSettingsId(site, "footer-{*}"),
  //   ]
  ```

  The starter-kit `Container`, `Column Splitter`, `Row Splitter`, etc.
  all wire their slots through this exact field — the SXA Headless
  runtime dereferences each ref to read the `Placeholder Key` (the
  `container-{*}` template-shaped string) before emitting the
  `placeholders` map. The literal `{*}` token lives on the settings
  item, not on the rendering field, which is why earlier attempts at
  writing pipe-joined raw key strings to the rendering had no effect:
  the runtime never reads the rendering for keys.

  > Two unreleased earlier attempts at this fix targeted the wrong
  > field entirely — commit `885885c` wrote pipe-joined keys to the
  > standard CMS Layout's plural "Placeholders" (b687328e-...) which
  > the Headless Json Rendering template doesn't inherit (Authoring
  > GraphQL rejected the upsert outright); commit `84fa785` switched
  > to the Json Rendering template's singular "Placeholder" field
  > (592a1ce7-...) which Authoring accepts but the layout service
  > ignores. Caught + corrected (this changeset / commit) before any
  > release shipped: still 0.2.5 on `latest` after publishing.

- 3735363: `src/sync/baseline.ts`: add tests for the kind-agnostic baseline helpers.

  The new `stableStringify` + `hashJsonValue` + `classifyHashes` utilities
  (used by brand / brief / campaign three-way merge alongside scai's
  content-recipe baseline) shipped without tests. Add 21 unit cases
  covering: stable key ordering (object reordering yields identical
  hashes; array order preserved), nested + mixed-depth structures,
  known-good SHA-256 vector for the canonical empty string, classify-
  hashes truth table including the empty-string-baseline-vs-undefined
  distinction.

  No behaviour change — pure test addition. `src/sync` directory
  coverage jumps from ~50% → 96.85% statements.

## 0.2.4

### Patch Changes

- f44f6e5: `recipe`: encode `general-link` Standard Values defaults from a `text|url` string

  `general-link` fields previously dropped their `default` value during SV
  emission — the encoder returned `undefined` for every reference-shape
  type, on the rationale that they "need encoded payloads not expressible
  via the simple `default: string` recipe surface". That left
  recipe-authored CTAs landing with empty Link fields, so dropped
  renderings showed empty button shells until an author manually filled
  the link.

  The encoder now parses a pipe-separated `"<text>|<url>"` convention and
  emits the Sitecore link-field XML payload Standard Values stores
  natively. `linktype` is inferred from the URL prefix: `mailto:` →
  `mailto`, leading `#` → `anchor`, anything else → `external` (Sitecore
  runtime renders relative paths and absolute URLs identically; the link
  picker decides internal vs external at author-time for items it can
  resolve). Either half of the pipe may be empty (`"Click|"` → text only,
  `"|https://x"` → url only); a value with no pipe is treated as text +
  anchor `#`. Attribute values are XML-escaped.

  ```ts
  // Before: dropped silently.
  { name: "Link", shape: "link", sitecore: { type: "general-link" },
    default: "Get started|https://example.com" }

  // After: SV emits
  //   <link text="Get started" linktype="external" url="https://example.com" />
  ```

  `image`, `file`, `droplink`, `treelist`, and `treelist-with-search`
  defaults are still skipped — they need richer payloads (GUID references
  to media items / content items) that don't have an obvious string
  convention. Use the existing per-item content recipes to seed those.

- e0c09c0: `recipe`: fix `dynamicPlaceholders: true` to also inherit `_IDynamicPlaceholder`

  `ComponentTemplateRecipe`'s `dynamicPlaceholders: true` flag previously
  only wrote `IsRenderingsWithDynamicPlaceholders=true` into the rendering's
  `OtherProperties` shared field. That's necessary-but-not-sufficient: SXA
  Pages chrome also needs the parameters template to inherit
  `_IDynamicPlaceholder`
  (`/sitecore/templates/Foundation/Experience Accelerator/Dynamic Placeholders/Rendering Parameters/IDynamicPlaceholder`),
  which contributes the `DynamicPlaceholderID` field the chrome writes
  per-placement integers to.

  Without the base, the chrome had no field to write the placement ID, no
  `DynamicPlaceholderId` param appeared in layout-service rendering data,
  and nested children either failed to bind in Pages or persisted against
  the wrong slot key — symptom was the headless SDK warning
  `Placeholder '<slot>-1' was not found in the current rendering data` on
  visibly-authored containers.

  `emitParamsTemplate` now appends `_IDynamicPlaceholder` to the params
  template's `__Base template` chain whenever the recipe sets
  `dynamicPlaceholders: true`. The OtherProperties write is unchanged.

  Combining `dynamicPlaceholders: true` with `parameters: { handle }`
  (an external `ParametersTemplateRecipe` reference) now throws
  `INPUT_INVALID`. The external template may be shared across components;
  mutating its base-template chain from a single consumer would silently
  affect every other reader. Move to inline `params:` or extend
  `ParametersTemplateRecipe` with its own flag if/when needed.

- 2b56681: `recipe`: support multi-template datasources (compatible-datasources pattern)

  `ComponentTemplateRecipe`'s `datasource` block now accepts a new
  `templates: [{ handle }]` array alongside the existing single
  `template: { handle }` shortcut (mutually exclusive). When `templates`
  is set, the compiler emits a `ref-recipe-list` so each template's
  GUID resolves through the executor and pipe-joins into the rendering's
  `Datasource Template` shared field — letting the Pages picker surface
  items conforming to **any** of the listed templates.

  Use this when a single rendering can present multiple content shapes —
  e.g. an `avatar-block@1` that accepts either an `author@1` item (rich
  author profile) or a focused `avatar@1` item (just name + image +
  description). Pair on the React side with a `.sitecore.ts` adapter
  that normalises whichever field shape the layout service delivers.

  `datasource.template` (singular) continues to work unchanged for the
  common single-template case. With `templates` you'll typically want
  `autoCreate: false` so the dropping author is prompted to pick a
  template via the datasource picker (the compiler can't pick one
  unambiguously).

- 8bbee1c: `scai brand sync`: `--no-enrich` flag + always-lock operator PATCHes

  Two changes that materially affect how `scai brand sync push`
  interacts with Sitecore AI's brand-kit pipeline:

  **New: `--no-enrich` flag.** Power-user knob that skips every code
  path that would trigger a `BrandIngestionPipeline` /
  `EnrichSectionsPipeline` run on Sitecore. With the flag set:
  - the kit-creation path becomes an error (`INPUT_INVALID`) instead
    of seeding — sections only exist after enrichment, so PATCHes
    can't land on a fresh kit;
  - the self-heal cycle (existing kit where none of the recipe's
    section/field targets are reachable) is skipped;
  - the field-PATCH loop still runs. Operator-authored values land on
    whatever sections happen to exist; missed targets are surfaced as
    `skipped` with a diagnostic naming the live-kit structure.

  Useful when iterating on field values against a kit you know is
  already structured correctly and you don't want to wait 5–15 min
  for the pipeline.

  The flag is exposed on the underlying `SyncContext` as
  `skipEnrichment: boolean` so MCP tools / programmatic callers can
  route the same intent.

  **Always-lock operator PATCHes via `aiEditable: false`.** Every call
  to `updateBrandKitField` from `brandKitKind.apply()` now sets
  `aiEditable: false` on the target subsection. Sitecore's
  EnrichSections pipeline is asynchronous — it can keep writing field
  content for minutes after `seedBrandKit` returns (we only poll
  until sections _appear_, not until enrichment finishes). Without
  the lock, a late-arriving enrichment write overwrites the recipe
  value mid-PATCH, surfacing as "the values I authored vanished
  after the push." The flag pins each PATCHed field to its
  recipe-provided value so future enrichment runs can't touch it.

- daed6c7: `recipe`: add `Plugin` Sitecore field type + `plugin` source variant for Marketplace custom-field apps

  Two related additions to the field-augment surface, both needed before a
  recipe can wire a Sitecore template field to a Sitecore Marketplace
  custom-field plugin (e.g. the new `@sai/matrix-editor`):
  - **`type: "Plugin"`** joins the `SITECORE_FIELD_TYPES` enum. Stored
    verbatim in the field item's `Type` shared field — the Marketplace
    shell renders the custom plugin iframe instead of any built-in
    editor.
  - **`source: { kind: "plugin", id: "<slug>" }`** is the third variant on
    the `SitecoreFieldSourceSchema` discriminated union (alongside
    `filter` and `raw`). The compiler emits the slug verbatim into the
    field's `Source` property; the Marketplace looks it up against its
    installed-plugins catalog at render time to resolve the iframe URL.

  Example — adding the matrix editor plugin to `matrix.recipe.ts`:

  ```ts
  {
    name: "EditMatrix",
    shape: "text",                 // field stores a digest string
    sitecore: {
      type: "Plugin",
      source: { kind: "plugin", id: "sai/matrix-editor" },
      hint: "Visual editor for this matrix's rows, columns, and cells.",
      section: "Editor",
      sortOrder: 50,
    },
  }
  ```

  Internals: `augmentSourceToFields` maps the new variant to a
  `sourcePlugin` entry on the flat `SourceFields` bag; `renderSourceFields`
  returns the slug verbatim (same precedence semantics as `sourceRaw`,
  which already overrides everything else). `defaultSitecoreFieldType` is
  unchanged — Plugin is opt-in only, never inferred from a `shape`.

  Pull-side round-tripping (`recipe pull`) currently rebuilds plugin
  sources as `kind: "raw"`; the slug round-trips correctly but loses the
  plugin-vs-raw distinction. A follow-up can teach `read-current.ts` to
  detect `Type=Plugin` and emit the structured `kind: "plugin"` form.

## 0.2.3

### Patch Changes

- 413dbec: `scai brand sync push`: broaden self-heal to cover all "stuck kit" shapes

  Companion fix to the synthesize-stub-PDF + self-heal-bare-kit pair.
  The first cut of self-heal only fired when
  `listBrandKitSections` returned an empty array. Production testing
  on a real tenant surfaced a third stuck shape: sections exist on
  Sitecore but with no fields — or with field names that don't match
  what the recipe targets. In both cases the field-PATCH loop still
  skipped every write silently and the operator saw a green job that
  changed nothing.

  `apply` now indexes the live kit's sections first, then checks
  whether _any_ of the section/field pairs the recipe wants to write
  are reachable. If none are, it runs the synthesize → upload →
  publish → ingest → enrich cycle on the existing kit. The check
  covers all three stuck shapes — zero sections, sections-without-
  fields, sections-with-wrong-names — without firing on a partially-
  populated kit where some writes already resolve. The new log line
  reports the live field count so operators can see at a glance why
  self-heal triggered.

- 413dbec: `scai brand sync push`: surface the section/field mismatch when every write skips

  When `apply`'s field-PATCH loop produces zero applieds and a
  non-zero skipped count, the operator previously saw
  `Applied 0; N skipped` with no way to discover _why_ — the most
  common cause (a recipe section/field name that doesn't match the
  live kit) was invisible.

  The diagnostic log now lists the recipe targets that didn't
  resolve, the live kit's section list, and every section/field
  mapping the live kit actually exposes. It also points at
  `scai brand sync pull --kit "<name>"` so the operator can capture
  the live shape and reconcile their recipe in one step. Pure
  observability — no behaviour change for kits that apply cleanly.

- 413dbec: `scai brand sync push`: self-heal a pre-existing bare kit on re-push

  Companion to the synthesize-stub-PDF feature. When `apply` finds an
  existing brand kit by name and there are pending field writes, it now
  checks whether the kit has any sections. A kit stuck in the bare
  state (created without documents by older scai, or by a direct
  `createBrandKit` call) would previously fail every field write
  silently — the live kit's `listBrandKitSections` returned `[]`, so
  `indexFields` returned an empty map and `index.get(...)` produced
  `undefined` for every write, pushing each one into `skipped`. The
  operator would see a green job that changed nothing.

  `apply` now synthesizes a stub PDF and runs the
  upload → publish → ingest → enrich → poll cycle against the existing
  kit id via the new `enrichBrandKitWithDocuments` export. After
  enrichment produces the canonical section set, the field-PATCH loop
  finds targets and the values land. No tenant-side cleanup needed —
  the next `scai brand sync push` of a stuck kit heals it.

- 413dbec: `scai brand sync push`: synthesize a stub PDF when the recipe has section data but no source document

  Sitecore's Brand Management API has no "create section" endpoint — sections only appear as a side effect of `EnrichSectionsPipeline` running over an uploaded document. A recipe declaring field values but no `documents[]` previously created a bare kit, found zero sections to write into, and reported "Applied 1 change; N skipped" — the live kit ended up blank.

  `brandKitKind.apply` now detects this combination (no operator documents + field changes referencing sections) and synthesizes a minimal single-page PDF naming the declared sections. The stub flows through the same `seedBrandKit` create → upload → publish → ingest → enrich pipeline as a real document, producing the canonical section set; the recipe's actual field values then converge via `updateBrandKitField` PATCH calls immediately after.

  The synthesis is hand-rolled (no new dependency) and emits a valid PDF 1.4 file under 1KB. Input strings are ASCII-coerced (em-dashes → `-`, smart quotes → `'`/`"`, etc.) so byte counts stay consistent with the Helvetica/WinAnsiEncoding font the PDF references.

  Operators with a real brand-guidelines PDF should still declare it in `recipe.documents[]` — the synthesis only fires when no document is supplied. The synthesis path emits a distinguishing log line and tags the document `["scai-synthesized", "stub"]` so downstream filters can recognize it.

  **Note:** the synthesis fires on initial kit creation. A pre-existing bare kit (one previously created without sections) won't auto-heal — delete it on the tenant and push fresh to trigger the new path.

## 0.2.2

### Patch Changes

- 6a58526: `scai brand sync`: gate cached AI-skills token on expiry

  Sitecore returns `403 Token has expired` (not 401) for stale Bearers on
  the Brand APIs, and `requestBrandApi`'s re-mint path only triggers on 401. A stale OS-keychain entry therefore surfaced as a hard
  `BRAND_API_FAILED` on every `scai brand sync push` (and every other
  Brand API call) until the keychain entry was manually cleared. The
  showcase-orchestrator's `brandkit_deploy` worker hit this immediately
  whenever the cached token in a developer's keychain ticked past its
  ~24h lifetime.

  `acquireBrandToken` now decodes the cached token's `exp` claim and
  evicts + re-mints when the token is inside a 60s safety margin. New
  `isTokenExpired` helper in `shared/jwt.ts` (parallels the local copy
  already in `publishing/api/auth.ts`).

- 1154b7a: Cleanup release: verb normalization, envelope adoption, content mutations, `scai doctor`

  A consolidated batch of structural cleanups, surface normalizations,
  and new content-tree primitives. **Breaking CLI / MCP / SDK surfaces
  under 0.x** — see migration notes at the bottom.

  **New: `scai doctor`** — local config + credentials diagnostic. Walks
  `sitecoreai.cli.json`, the OS keychain, and the Node runtime;
  surfaces what needs fixing before remote calls work. `--json` for
  machine output, `--strict` for CI gating. Closes the 0.1.0
  publish-gate item.

  **New: content-tree mutations**
  - `scai content move` — relocates a Sitecore item to a new parent via
    the Authoring `moveItem` GraphQL mutation. Preserves itemId, name,
    and every inbound reference (delete + recreate was the only path
    before). New SDK `AuthoringApiClient.moveItem`, new CLI command,
    new MCP `cleanup_execute verb='move-item'`.
  - `scai hygiene cleanup multilist remove-ref` — removes one GUID from
    a multilist / treelist / droplink-list field on a single item.
    Promoted from the `scai/scripting/helpers/multilist.ts` `removeRef`
    helper. Case-insensitive, brace-tolerant.
  - MCP `cleanup_execute verb='delete-item'` — single-item delete with
    the same inbound-ref safety model as `subtree`, narrower contract.

  **Verb normalization (BREAKING — CLI + MCP)** — three different
  verbs collapsed to one each:
  - Read-one is `get`. `show` and `inspect` dropped.
  - Property setters go through `update`. `set-X` dropped.
  - Noun-as-verb collapses to a single noun. No more `list-` prefix.

  CLI renames:
  - `brief show <id>` → `brief get <id>`
  - `brief set-status <id> <s>` → `brief update <id> --status <s>`
  - `campaign show <id>` → `campaign get <id>` (and `task show` → `task get`)
  - `webhook inspect <ref>` → `webhook get <ref>`
  - `webhook event-types` → `webhook events`
  - `workflow inspect <ref>` → `workflow get <ref>`
  - `workflow list-commands <ref>` → `workflow commands <ref>`
  - `workflow list-defs` → `workflow definitions`
  - `content version inspect ...` → `content version get ...`

  MCP renames:
  - `brief_inspect` verb `show` → `get`
  - `brief_manage` verb `set-status` removed — pass `status` on `update`
    (`{ resource: 'brief', verb: 'update', briefId, status }`)
  - `campaign_inspect` verb `show` → `get`
  - `webhook_inspect` verb `event-types` → `events`
  - `workflow_inspect` verb `inspect` → `get`, `list-commands` →
    `commands`, `list-defs` → `definitions`

  SDK removals: `runBriefSetStatus`, `setBriefStatus` (use
  `runBriefUpdate` / `updateBrief` with `{ status }`).

  **ScaiEnvelope adoption (BREAKING — `--json` consumers)** — every
  CLI task that emits JSON under `--json` now wraps its output in the
  canonical envelope shape (`{ command, environment, data, count?,
whatIf?, totalCount?, summary?, meta? }`). Previously seven task
  families (`agents.*`, `brief.*`, `campaigns.*`, `workflow.*`,
  `serialization.push`, `brand review --format json`, `recipe push`)
  emitted raw JSON; consumers had to branch on shape per-command.
  SARIF stays unwrapped (OASIS schema, downstream tooling parses
  verbatim).

  **Brief CRUD + recipe sync (unstable)** — brief instances (not
  just brief types) now support `create`, `update`, and recipe sync.
  `scai ops brief create -f <file>`, `update <id> --status <s>`, and
  `sync {pull,diff,push} --kind brief|brief-type` (default
  `brief-type` for back-compat). New SDK `assertCreateBriefInput`,
  `briefInstanceKind`, `BriefInstanceRecipeSchema`. MCP
  `brief_manage` accepts `resource: 'brief'` with `create` and
  `update` verbs.

  **Internal cleanups (no consumer impact)**
  - New `@/auth` + `@/authoring` cross-domain barrels. The OAuth
    client-credentials helpers + Sitecore Authoring GraphQL transport
    that lived in `serialization/api` and `recipe/api` were de facto
    shared modules; cross-area callers now import via the new seams.
  - Shared `decodeJwtPayload` / `extractScopes` in `@/shared/jwt` —
    the per-domain auth modules previously each shipped their own copy.
  - Unified `ensureAllowWrite` naming across hygiene cleanup runners
    (alias `ensureAllowWriteForCleanup` dropped).
  - Fire-and-forget history + telemetry write failures now log to
    stderr (`[scai:history]` / `[scai:telemetry]`) instead of silent
    swallow. Suppressible via `SITECOREAI_OBSERVABILITY_SILENT=1`.
  - `isItemNotFoundError` (recipe prune-defaults) now matches against
    preserved GraphQL `extensions` payloads as well as the prose
    patterns — Sitecore phrasing changes are less likely to break it.
  - `RecipeKind<T>` → `RecipeKind<unknown>` erasure casts collapsed to
    a single `eraseKind` helper exported from `@/sync`.
  - `FieldFilter` (serialization module config) now declares its
    legacy PascalCase `FieldId` alias on the type itself instead of
    being read through an `as unknown as` cast at the loader boundary.

  **Migration**

  CLI scripts and agent prompts referencing the old verb names
  (`show`, `inspect`, `set-status`, `event-types`, `list-commands`,
  `list-defs`) will fail. Update to the new names; underlying API and
  library behaviour is unchanged.

  Scripts that read raw JSON output from `agents.*`, `brief.*`,
  `campaigns.*`, `workflow.*`, `serialization.push`,
  `brand review --format json`, or `recipe push` need to unwrap the
  envelope:

  ```diff
  -const result = JSON.parse(stdout);
  -console.log(result.id);
  +const envelope = JSON.parse(stdout);
  +console.log(envelope.data.id);
  ```

  The `command` field on the envelope identifies the source so a
  single parser can dispatch by it.

- 4380a3e: `scai provision recipe prune-defaults`: also prune the SXA Headless OOTB
  `Presentation/Styles` buckets

  Adds a fourth prune group covering the 12 default style buckets SXA
  seeds under `<site>/Presentation/Styles` (Spacing, Add Highlight,
  Content Alignment, Background Color, Background Layout, Navigation,
  Link List, Rich Text, Promo, Image, Common, Container). Parent
  `Styles` folder is preserved; only the named children are removed.
  Behaviour mirrors the existing three groups — idempotent, tolerant
  of the concurrent-delete race, names case-and-space exact (mismatches
  report `missing` rather than deleting the wrong thing).

  New env-profile field `presentationStylesRoot` (also exposed under
  `recipeRoots.presentationStyles`), env override
  `SITECOREAI_ENV_<NAME>_PRESENTATION_STYLES_ROOT`, and CLI flag
  `--presentation-styles-root`. The runner now requires all four roots —
  configurations that previously ran prune-defaults with only the three
  legacy roots will get `INPUT_INVALID` naming `presentationStylesRoot`
  until the new field is set.

## 0.2.1

### Patch Changes

- ae297fc: Add brief-instance CRUD and recipe sync (unstable surface)

  The `scai ops brief` surface previously exposed declarative recipe sync
  only for brief _types_ (the schema templates); brief instances had
  runtime-only `delete` / `set-status`. This adds the missing CRUD verbs
  and a parallel recipe kind so populated briefs can be authored, diffed,
  and pushed declaratively alongside their types.

  **CLI**
  - `scai ops brief create -f <file>` — POST a brief from a
    `CreateBriefInput` JSON document. Dry-runs by default; `--apply` to
    write.
  - `scai ops brief update <briefId> [-f <file>] [--status <s>]` —
    partial-PUT update of a brief. Pass `-f` for arbitrary patches or
    `--status` as a shortcut for a status-only move.
  - `scai ops brief sync {pull,diff,push} [--kind brief|brief-type]` —
    the recipe verbs now take a `--kind` discriminator. Defaults to
    `brief-type` for back-compat with existing scripts; `--kind brief`
    operates on brief instances (identified by display `name`,
    referencing their type by codename via `briefTypeName`).

  **SDK**
  - `assertCreateBriefInput` — validates the brief create body shape;
    mirrors `assertCreateBriefTypeInput`.
  - `briefInstanceKind` + `BriefInstanceRecipeSchema` — the new recipe
    kind; registered with the cross-domain aggregate sync so
    `scai sync` / the `recipe_sync` MCP tool fan out over brief
    instances automatically.

  **MCP**
  - `brief_manage` extended: `resource='brief'` now supports `create`
    (requires `briefTypeId` and a `brief` body) and `update` (partial
    PUT, any subset of name/locale/fields/isTemplate plus an optional
    `status`).
  - `brief_recipe_inspect` / `brief_recipe_push` extended with a
    `kind: 'brief-type' | 'brief'` discriminator (default `brief-type`).

  **Behavior to know**
  - Briefs are matched by display `name` on diff/push (first-match-wins,
    mirroring the campaign-instance precedent — the Brief list endpoint
    has no server-side name filter).
  - `createBrief` accepts no `status` field; the kind follows up with a
    PUT when the recipe pins a non-`Draft` status so the post-apply
    state matches the recipe.
  - Repointing an existing brief at a different brief type is refused
    with a typed error (`INPUT_INVALID`) — the Brief API has no
    verified path for that.
  - Surface remains `[unstable]` — schemas and behavior may change in
    any release.

## 0.2.0

### Minor Changes

- 7c243b6: Three related changes that let the showcase orchestrator drive
  `scai brand sync push` from a serverless context end-to-end and
  let recipe authors hand-write either array or slash-string folder
  paths:
  - **Brand credential env-var fallback.** `acquireBrandToken` (and the
    campaign auth seam that mints from the same AI APIs key) now resolve
    the client id, client secret, authority, and audience via a two-tier
    chain: `SITECOREAI_BRAND_CLIENT_ID` / `SITECOREAI_BRAND_CLIENT_SECRET`
    / `SITECOREAI_BRAND_AUTHORITY` / `SITECOREAI_BRAND_AUDIENCE`
    environment variables first, then the existing
    `brand[orgId]` config + OS keychain pair. Env-tier wins when both the
    id and secret are present so a Vercel function or CI runner can
    override per invocation without a keychain; a partial pair throws
    `AUTH_BRAND_REQUIRED` naming the missing var, never silently falling
    through. The new `resolveBrandSecrets` helper lives in
    `src/brand/credential.ts`.
  - **Brand-kit recipe schema superset.** `BrandKitRecipeSchema` now
    parses the richer recipe shape the registry's `sitecore-recipes.ts`
    exports: optional top-level `kind: "brandkit"`, `schemaVersion: "1"`,
    `handle` (regex `^[a-z][a-z0-9-]*@\d+$`), and `displayName`, plus a
    discriminated `documents[]` union (`url` | `registry-file`) with
    optional `tags` and `sections` ingestion hints. Back-compat is
    preserved via a preprocess step that defaults a missing `kind` to
    `"url"` whenever `url` is present, so existing scai-native YAML/JSON
    recipes keep parsing without a migration. `registry-file` documents
    carry a path relative to the recipe; the seed runner rejects them
    with `INPUT_INVALID` and a pointer at the orchestrator-side
    translation step (the Sitecore Documents API has no working
    bytes-upload path, so URL conversion has to happen upstream of
    scai). Also exports `BRAND_KIT_CANONICAL_SECTIONS` for the seven
    canonical section names that the EnrichSections pipeline produces.
  - **Recipe `FolderPath` normalization.** `location.folder` and
    `placeholder.folder` now accept either the canonical array form
    (`["Theme", "Color"]`) or the legacy slash-string form
    (`"Theme/Color"`). Both normalize to `string[]` during Zod parse,
    filtering empty segments after split + trim. The registry already
    moved to array form (slash-strings are fragile to author through
    Agent Studio with no IDE help inside the string); scai now accepts
    both so existing recipes keep working and new ones use the explicit
    shape. Downstream consumers (`compile/enumeration`, `compile/shared`,
    `items/read-current`) see `string[]` uniformly.

- 7c243b6: Recipe schema audit Tier A1: replace the four-peer `sourceTypes` /
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

- 7c243b6: Recipe schema audit Tier A3: campaign server-enum fields now use
  `z.union([z.enum(KNOWN_*), z.string()])` instead of bare `z.string()`,
  so AI authors get the observed values as a strong hint without
  breaking `recipe pull` when the API returns an unobserved enum
  value.
  - `CampaignTask.status` / `CampaignDeliverable.status` /
    `CampaignRecipe.status` accept `KNOWN_CAMPAIGN_STATUSES` =
    `["NOT_STARTED"]` plus any other string.
  - `CampaignDeliverable.funnelStage` accepts
    `KNOWN_CAMPAIGN_FUNNEL_STAGES` = `["TOP"]` plus any other string.
  - `KNOWN_CAMPAIGN_STATUSES` and `KNOWN_CAMPAIGN_FUNNEL_STAGES` are
    exported from `src/campaigns/recipe/schema.ts` — extend them as
    more enum values are observed in HAR captures.
  - `Task.priority` stays `z.string()` until any priority values are
    observed in capture.

  JSON Schema renders these as `anyOf: [{ enum: [...] }, { type:
"string" }]` so Agent Studio gets the confirmed set surfaced
  first while remaining schema-valid against unobserved values.

- 7c243b6: First pass of the recipe-schema audit (see
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

- 7c243b6: Unify recipe loading: the schema-aware `loadRecipe` from `@/sync`
  (used by `brand`, `agents`, `campaign`, `brief` sync verbs) now also
  loads `.ts` / `.tsx` / `.mts` / `.cts` recipes, going through the same
  sandboxed transpile path the CMS recipe loader already used.

  Recipe authors can now write a single format — `.recipe.ts` with
  Zod-derived `satisfies` checks — for every kind. YAML and JSON keep
  working unchanged (still the format `sync pull` round-trips).

  Shared TS-loader machinery moved to `src/sync/typescript-recipe.ts`
  and is now consumed by both `src/sync/io.ts` and `src/recipe/io.ts`.
  The library `loadRecipe(filePath, schema)` is now async; every
  existing call site already ran inside an `async` task runner or
  commander `command.action(async …)` handler.

## 0.1.2

### Patch Changes

- bc7fa7e: Hardens two security-adjacent paths and clears a sweep of CodeQL +
  AI-suggested findings:
  - `scai setup login` (Windows): the device-flow browser launcher now
    validates the URL via `new URL()` and switches the Windows code path
    from `cmd /c start "" <url>` (shell:true) to
    `rundll32 url.dll,FileProtocolHandler <url>` so shell metacharacters
    in a hostile verification URI can't chain commands. Closes the CodeQL
    `js/command-line-injection` finding.
  - `scai setup login --use-brand`: the AI-APIs-client detector matches
    the actual scope namespace (`ai.org.`) rather than the bare `ai.org`
    prefix, removing a spurious-match window against any scope that
    happens to start with those characters. Closes the CodeQL
    `js/incomplete-url-substring-sanitization` finding.

  Plus internal reliability cleanups (collapsed five redundant `??` /
  `&&` fallbacks flagged by `js/useless-expression`), CI workflow
  `permissions: contents: read` hardening on `ci.yml` + `smoke.yml`, a
  test-cleanup try/finally on the headless-CLI test, a corrected
  `RecipeInputResolution` mock value in `recipe push` tests, and three
  CHANGELOG markdown list-formatting repairs.

- bc7fa7e: Fix credential writes silently failing on Windows when a secret exceeds the
  Windows Credential Manager 2560-byte blob limit. Sitecore access tokens
  (deploy/CM/publishing/brief/campaign) and the CM token bundle routinely
  exceed it, which made `scai setup login` report success while the keychain
  write was rejected. Large secrets are now transparently split across
  companion keychain entries and reassembled on read; values that fit are
  stored unchanged, so existing credentials keep working. Keychain write
  failures also now surface the underlying error in the warning instead of
  being silently swallowed.

## 0.1.1

### Patch Changes

- a1b0336: Scope the `templatesRoot` / `renderingsRoot` requirement to recipe sets that actually create template or rendering items.

  `recipe compile` and `recipe push` previously required both roots to be configured (in the env profile or via `--templates-root` / `--renderings-root`) before they would run — even for a `workflow` or `webhook-authorization` recipe, whose compilers create items under hardcoded `/sitecore/system` roots and never read either value. A workflow recipe now compiles, plans, and pushes with neither root configured. An IR-only `recipe push` (no recipe-source files) skips the requirement for the same reason.

## 0.1.0

### Minor Changes

- d9ff377: **`scai agents` is now organized by resource, with a consistent CRUD surface per kind.**

  The `agents` command area used to be a flat list of reads (`agents list`,
  `agents skills`, `agents widgets`, …), a single `agents rm`, and `agents
sync`. There was no `agents create/update/delete` grouping, the only
  delete used the off-pattern `rm` verb, and HTML templates had no read
  command at all — they existed as a recipe kind but were invisible to the
  CLI.

  Each Agentic Studio resource is now its own subcommand group:

  ```
  scai agents
    agent          {list, get, create, update, delete, duplicate, run}
    space          {get, artifacts, update}
    skill          {list, get, create, update, delete}
    widget         {list, get, create, update, delete}
    schema         {list, get, create, update, delete}
    mcp            {list, get, create, update, delete}
    html-template  {list, get, create, update, delete}   ← `list` is new
    tool           {list}
    sync           {pull, diff, push}
  ```

  - **`agent`** has fully verified CRUD — every write hits a confirmed
    `/api/agents` endpoint. `create`/`update` take a recipe file (the same
    format `scai agents sync` uses). `agent run` now also surfaces the
    finished run's artifacts (the structured output), not just the stream.
  - **`space`** is new — the run container. `get` shows its config,
    `artifacts` reads a run's structured output (`/api/spaces/{id}/artifacts`),
    and `update` merges a patch into the live config (rename, change agents
    or context). A space has no list or delete endpoint, so the group has
    neither — all verified 2026-05-17.
  - **`skill` / `widget`** have full CRUD — `update` and `delete` were
    verified live on 2026-05-17 against `agentic-studio-euw`.
  - **`mcp`** has verified `list` / `get` / `create` / `delete`; it has no
    `update` at all (`PUT` → 405, and re-POSTing the create endpoint
    duplicates rather than upserting) — `update` stays gated.
  - **`schema`** has verified `list` / `get` / `create` / `update` —
    `update` re-runs the create server action, which upserts by name
    (verified 2026-05-17). `schema delete` is **UNVERIFIED** (`DELETE` → 405).
  - **`html-template`** has `create` and `update` — `update` replays the
    real `updateHtmlTemplateAction` server action, captured live with
    `scripts/record-agentic-actions.ts`. `GET /api/html-templates` returns
    404 on the tested tenant (no list/read path observed), so an
    html-template is addressed by id only and `list` / `get` do not work
    there; `delete` remains **UNVERIFIED**.
  - **`tool`** stays read-only — the catalog has no write path.
  - **`html-template list`** is new: the resource was reachable only via
    `agents sync` before.

  The UNVERIFIED writes are gated behind a new `--unverified` flag and fail
  fast with a pointer to `docs/agentic-studio-har-capture.md`, which records
  the live verification results and documents how to capture the rest.

  **Breaking:** the old flat commands are removed — there are no aliases.
  Update any scripts to the resource-grouped paths:

  | Removed          | Use instead           |
  | ---------------- | --------------------- |
  | `agents list`    | `agents agent list`   |
  | `agents skills`  | `agents skill list`   |
  | `agents tools`   | `agents tool list`    |
  | `agents widgets` | `agents widget list`  |
  | `agents schemas` | `agents schema list`  |
  | `agents mcps`    | `agents mcp list`     |
  | `agents run`     | `agents agent run`    |
  | `agents rm`      | `agents agent delete` |

  Declarative create/update across every kind is still available via `scai
agents sync` — unchanged.

  Also fixed: `scai agents login` intermittently failed with "Execution
  context was destroyed" — the browser User-Agent was read with
  `page.evaluate` after sign-in, racing the Auth0 redirect chain. It is now
  captured on the stable blank page before navigation.

  Also fixed: `discoverActionHash` (the login-time server-action hash
  discovery) never matched — its regex expected `createServerReference("…`
  but the minified bundle emits the `(0,x.createServerReference)("…` comma-
  expression form, so login silently discovered nothing and the server-action
  writes rode their hard-coded fallback hashes. The regex now matches the
  real call form (`scripts/scan-agentic-actions.ts` enumerates them).

- ce3af45: **BREAKING: `--apply` is now required to execute mutations on every destructive scai CLI command.**

  Pre-2026-05-14, scai mutated whenever the operator passed the
  command-specific affirmative — `--allow-write` for cleanup, `--force`
  for deploy delete. That made "I forgot `--what-if`" the same keystroke
  as "delete." Agent-first inversion: scai never destroys without an
  explicit affirmative on the command line.

  **New rule:** without `--apply` (and absent an explicit `--what-if`),
  destructive commands dry-run as if `--what-if` were set. A one-line
  stderr hint surfaces the change so operators don't wonder why no
  mutation happened:

  ```
  $ scai cleanup dead-templates purge
  Dry run (no --apply flag set). Pass --apply to execute the mutation.
  ... plan output ...
  ```

  **Commands now gated** (CLI layer only — library callers and MCP tools
  keep their existing per-call gating model):
  - All `scai cleanup *` verbs: archive, dead-templates, duplicates,
    empty-folders, field-set, find-replace, language-versions, publish,
    rename, roles, site-residue, slug-conflicts, subtree, users,
    versions (prune + archive), workflow (advance + apply).
  - `scai deploy environments delete`, `unlink-repository`, and
    `variables delete`.
  - `scai deploy projects delete` and `unlink-repository`.
  - `scai deploy editing-host delete`.

  **Migration:**
  - `scai cleanup X --allow-write` → `scai cleanup X --allow-write --apply`
  - `scai deploy environments delete --force` → `scai deploy environments delete --force --apply`
  - Existing `--what-if` scripts unchanged.
  - The relationship between flags:
    - `--apply` is the universal "yes really execute" affirmative.
    - `--what-if` (any of: `-w`, `--what-if`) explicitly plans without executing — still works.
    - `--force` keeps its prior meaning: skip confirmation prompts.
    - `--allow-write` keeps its prior meaning: per-env safety belt for cleanup ops.
    - `--apply --what-if` together is invalid: `--what-if` wins (plan-only).
  - The MCP write gate (`allowWrite: true` per call) is unchanged. MCP
    tools call task runners directly and bypass the CLI-layer `--apply`
    gate; their per-call write gate is already a strong affirmative.

  Implementation: a new `withApplyGate(runner)` helper in
  `src/commands/shared.ts` wraps each destructive command's `.action()`.
  Without `--apply`/`--what-if`, it coerces `whatIf: true` before
  invoking the runner. Six new unit tests in
  `tests/unit/commands/apply-gate.test.ts` lock the behavior.

- ce3af45: **`audit baseline` polish: surface counts in every audit summary + new `accept --from-stdin` pipeline verb.**

  The feedback agent's diagnosis (refined from the original "persistent
  session state" framing): baseline isn't a missing feature, it's an
  underused one. Two reasons it stayed invisible:
  1. Audit summaries didn't mention the baseline unless the operator
     passed `--baseline` — so nobody knew it was there.
  2. Adding a finding to the baseline meant copying its fingerprint
     out of `baseline show` and feeding it to a follow-up command, or
     running `baseline create` (which accepts _everything_ current,
     typically too broad).

  This release closes both gaps.

  ### Auto-surfaced baseline counts in audit output

  `finishAudit` (the shared printer behind every `audit X list`) now
  always opens the per-env baseline and surfaces the count of already-
  accepted findings for the audit being run — even when `--baseline`
  isn't set. The non-JSON output adds one gray line under the headline:

  ```
  30 broken-links findings.
    (5 findings in baseline; pass --baseline to filter, or
     'scai audit baseline accept --audit broken-links --from-stdin' to add more)
  ```

  The JSON envelope gets a `meta.baselineAcceptedTotal` field so agents
  can branch on it. When `--baseline` is on, the existing
  `ignoredCount` line wins — they're complementary, not redundant.

  Cost: one extra `fs.existsSync` + JSON parse per audit run, ~ms on
  warm disk.

  ### New verb: `scai audit baseline accept`

  ```bash
  $ scai audit broken-links list --json \
    | scai audit baseline accept --audit broken-links --note "known debt"

  Accepted 30 new findings into baseline .scai/audit-baseline-sandbox.json.
  ```

  Reads a `ScaiEnvelope` from stdin (composes with the
  audit→cleanup pipelining released in the prior changeset) and adds
  every finding in `envelope.data` to the baseline. Idempotent —
  running it twice doesn't double-count. Optional `--note <text>`
  records why a batch was accepted (recorded per-entry so future
  `baseline show` callers can see context).

  Implementation: new `runBaselineAccept` task runner in
  `src/hygiene/tasks/audit-baseline.ts`; CLI wiring in
  `src/commands/audit/baseline.ts`. 6 unit tests in
  `tests/unit/hygiene/tasks/audit-baseline-accept.test.ts` lock the
  input validation + idempotency + note recording.

- ce3af45: **`scai audit` + `scai cleanup` — expanded to 16 verbs.** Builds on the
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

- ce3af45: **`scai audit` + `scai cleanup` — content hygiene shipped.** XM-Cloud-shaped
  replacement for the content-shaped subset of dotnet's `sitecore dbcleanup`.
  Built on the Authoring GraphQL API; SQL-only operations (`clean-blobs`,
  `clean-fields`, `rebuild-descendants`) remain out of scope.

  **Read-only diagnostics — `scai audit <verb> list`:**
  - `scai audit broken-links list` — finds content with internal links
    (RichText `<link>` tags, bare GUIDs, Multilist pipe-delimited refs)
    that point to items the tenant doesn't have. Tree-crawl-and-scan
    approach; bounded by `--limit` (default 5000) and `--root` (default
    `/sitecore/content`).
  - `scai audit unused-media list` — two-pass diff between media items
    under `/sitecore/media library` and refs collected from content
    items (RichText `<link linktype="media">`, `<image mediaid="...">`
    XML, Multilist GUIDs). Bounded by `--media-limit` and
    `--reference-limit`.
  - `scai audit orphans list` — items in the XM Cloud archive (recycle
    bin). True SQL-orphans don't exist on XM Cloud (schema enforces
    parent integrity); the archive is the closest analogue and is what
    the dotnet `clean-orphan-items` cleaned in practice.
  - `scai audit stale-workflow list` — items in a non-final workflow
    state with no updates in `--days N` (default 30).
  - `scai audit language-data list` — items with empty per-language
    entries (no versions). **Read-only by design**: the XM Cloud
    Authoring API has no per-item language-entry removal mutation. The
    dotnet `clean-invalid-language-data` shape isn't portable.

  **Mutating cleanup — `scai cleanup versions prune`:**
  - `scai cleanup versions prune --root <path> --keep N` — trims
    per-(item, language) version history down to N most recent versions.
  - Safety rails: `--root` is required (no tenant-wide form), `--keep`
    must be ≥ 1, `/sitecore/system` and `/sitecore/templates/System`
    refuse without `--force`, honors `--allow-write` / `--what-if`.

  **Output:** all verbs honor `--json` for piping into `scai ser pull` /
  `scai ser push`.

  **XM Cloud quirk fixed.** The Authoring GraphQL endpoint's
  `SearchCriteriaType` enum can't be passed via JSON variables — the
  resolver returns `EXEC_INVALID_TYPE` even for spec-conformant
  bindings. The hygiene client inlines search documents as literal
  GraphQL with bare enum tokens (`criteriaType: CONTAINS`); user-input
  strings are JSON-escaped to prevent injection. See
  [src/hygiene/api/client.ts:74-128](src/hygiene/api/client.ts#L74-L128).

- ce3af45: **Audit → cleanup pipelining: `scai cleanup duplicates purge --from-stdin` skips the internal audit re-run.**

  The feedback agent flagged that `scai audit duplicates list` and
  `scai cleanup duplicates purge` run the same content-hash scan twice
  in series (the cleanup invokes `runAuditDuplicates` internally), and
  that the two CLI invocations can disagree on the group set when the
  tenant changes between calls. Same pattern applied to other cleanups
  that wrap their matching audit.

  The fix: cleanup tasks now accept a `preComputedGroups` (and similar
  pre-computed inputs in follow-ups) option that bypasses the internal
  audit and uses the supplied findings directly. At the CLI layer,
  `--from-stdin` reads a `ScaiEnvelope` from stdin and pipes its `data`
  into `preComputedGroups`:

  ```bash
  $ scai audit duplicates list --json > dupes.json
  $ scai cleanup duplicates purge --from-stdin --apply < dupes.json

  # or in one shell pipeline:
  $ scai audit duplicates list --json \
    | scai cleanup duplicates purge --from-stdin --apply
  ```

  This lets operators:
  - Inspect or filter the audit envelope between the two steps (e.g.
    drop groups they want to keep).
  - Run audit on a snapshot, archive it, and cleanup later against the
    exact same group set.
  - Compose audit + cleanup in CI without re-running the slow scan.

  Implementation:
  - New `readScaiEnvelopeFromStdin<T>()` helper in
    `src/shared/envelope.ts`. Validates required envelope keys
    (`command`, `data`) and surfaces clear errors for empty / non-JSON /
    non-object input. 7 unit tests pin the parsing contract.
  - `runCleanupDuplicates` accepts an optional `preComputedGroups:
DuplicatesGroup[]`. When set, the internal `runAuditDuplicates`
    call is skipped entirely. 1 unit test confirms the audit is not
    re-invoked under that path.
  - The CLI `cleanup duplicates purge --from-stdin` wraps the runner
    call with a stdin reader; pairs with `--apply` to actually delete.

  Follow-up: extend the same pattern to `cleanup subtree`
  (`preComputedSubtreeRoots`), `cleanup site-residue`
  (`preComputedFindings`), and `cleanup slug-conflicts`
  (`preComputedConflictGroups`) so the full audit↔cleanup surface
  supports composition. The shared reader helper is generic — each
  cleanup just needs to wire the appropriate `data` shape into its
  options.

- ce3af45: **Four new `scai audit` verbs — field-level quality checks.** Built
  on the Phase A substrate; all four honor `--baseline`, `--output`,
  `--exclude`, `--since`, and the perf knobs.
  - `audit large-fields list --threshold <bytes>` — items with field
    values exceeding the threshold (default 100KB). Surfaces
    Word-pasted RichText, base64-embedded images, raw JSON dumps.
    Reports per-field size + total bloat per item.
  - `audit heavy-templates list --threshold <count>` — templates
    with more than N fields (default 50). Counts fields by walking
    section → field children; correlates with slow editor renders +
    brittle fixtures.
  - `audit missing-meta list --required-fields <names>` — items lacking
    required (SEO) fields. Defaults to `meta-title,meta-description,
og-image,og-title`; configurable via `--required-fields`. Scope to
    Page templates with `--template-pattern Page`. Field-name matching
    tolerates space/hyphen variants ("Meta Description" matches
    "meta-description").
  - `audit alt-text-missing list` — Image-field values with empty or
    missing alt text. Pure regex scan over Image-field XML; per-field
    granularity in the report. Decorative `alt=""` cases need
    baseline ignore.

  All four are also part of `audit all` — running the meta-command
  now invokes 17 audits (up from 13) by default.

  11 new unit tests (160 total in hygiene module). Live-validated all
  four verbs against the sandbox tenant.

- ce3af45: **Four new `scai audit` verbs — content quality round 2.** Built on
  the Phase A substrate; all four honor `--baseline`, `--output`,
  `--exclude`, `--since`, and the perf knobs.
  - `audit broken-images list` — `<img src="...">` URLs in RichText
    fields that return non-2xx / timeout / network error. HEAD-probes
    with a `--request-timeout-ms` budget; falls back to range-limited
    GET for CDNs that reject HEAD. `--exclude-domains` skips hosts
    you can't reach. **Off by default in `audit all`** because it
    makes external HTTP requests.
  - `audit slug-conflicts list` — sibling items sharing the same name
    (case-insensitive by default). Catches URL ambiguity that
    routers resolve unpredictably.
  - `audit translation-coverage list --target-languages fr,de,es` —
    measures translation completeness between a reference and target
    language(s). Reports per-target `coveragePercent` + samples of
    missing items. **Required `--target-languages`**, so off by
    default in `audit all`.
  - `audit fallback-drift list --target-languages fr,de --drift-days N` —
    items where the target-language version's `updatedDate` lags
    the reference language by more than N days. Catches "English was
    edited but French wasn't refreshed." **Required
    `--target-languages`**, so off by default in `audit all`.

  7 new unit tests (178 total in hygiene module). Live-validated all
  four against the sandbox tenant.

- ce3af45: **`audit find-replace`, `cleanup find-replace`, `audit stale-content` —
  content-shaped hygiene additions.** Find/match/replace across field
  values and an abandoned-content (graveyard) detector.

  **New `scai audit *` verbs (read-only):**
  - `audit find-replace list --pattern <regex>` — search field values for
    a regex or literal (`--literal`) pattern. Reports per-item per-field
    match counts plus sample snippets (~80 chars of context).
    - `--ignore-case` adds the `i` flag.
    - `--fields a,b,c` filters which fields are searched (default: all
      author-facing fields). `--include-system-fields` opts into the
      `__`-prefixed ones.
    - `--max-matches-per-item N` caps sample collection (default 10).
  - `audit stale-content list --not-updated-in-days N` — items not
    updated in N days (default 365). Distinct from `audit
stale-workflow`: - `stale-workflow` finds items stuck mid-flight in a non-final
    workflow state. - `stale-content` finds **abandoned** content — published items no
    one has touched in a long time. - By default excludes items currently in a workflow (set
    `--no-exclude-workflow-items` to include).

  **New `scai cleanup *` verb (mutating, with `--what-if` / `--allow-write`):**
  - `cleanup find-replace apply --pattern <regex> --replacement <text>` —
    apply find-replace across content fields. Mirrors the audit's
    flag surface plus mutation safeguards:
    - `--max-mutations N` caps the change blast-radius (default 100).
    - `--include-system-fields` is gated behind the same flag; replacing
      `__Renderings` via regex would mangle the XML, so it's off by
      default.
    - `--what-if` reports the planned changes without mutating.
    - JS regex backreferences in `--replacement` are supported (`$1`,
      `$&`, `$<name>`). Literal `$` is `$$`.

  **Hygiene client extension:** `updateItemFields({ itemId, fields })` —
  new method for the cleanup find-replace path. Wraps the `updateItem`
  mutation on the Authoring API; throws when the response doesn't echo
  back an `itemId`.

  **Workflow recommendation:** always run `audit find-replace list` to
  verify match scope first, then `cleanup find-replace apply --what-if`
  to preview, then drop `--what-if` to apply. The `--max-mutations` cap
  protects against unintended scope creep when the regex is too loose.

  15 new unit tests (141 total in hygiene module). Live-validated all
  three new verbs against the sandbox tenant.

- ce3af45: **Audit suite + trend history — final polish on the hygiene surface.**
  Two new top-level capabilities for codifying hygiene policy + tracking
  how findings change over time.

  **`scai audit suite run --file <file.yaml>`** — execute a YAML-defined
  audit pipeline. Operators commit a suite file to version control,
  defining which audits to run with which options. Suite shape:

  ```yaml
  version: 1
  name: monthly-hygiene
  audits:
    - name: broken-links
      options: { root: /sitecore/content/MySite, limit: 1000 }
    - name: duplicates
      options: { min-group-size: 3 }
  output:
    format: markdown
    path: ./reports/{date}.md
  baseline:
    enabled: true
  ```

  Output-path tokens: `{date}`, `{datetime}`, `{env}`, `{suite}`.
  `--only audit-a,audit-b` runs a subset of the suite. Kebab-case
  option keys are converted to camelCase for the underlying audit
  options.

  **`scai audit history <capture|list|diff>`** — snapshot `audit all`
  results and compute deltas. Distinct from baselines (an ignore-list)
  — history is a journal.
  - `capture` — runs `audit all`, persists per-audit finding
    fingerprints + sample identifying fields to
    `.scai/audit-history/<env>/<datetime>.json`. Compact storage (no
    full payload).
  - `list` — show snapshots, newest first.
  - `diff [--from X --to Y]` — compare two snapshots; reports per-audit
    totals (from → to), added items, removed items. Defaults to the
    two most recent snapshots. Identity by fingerprint, same rules as
    baselines (transient fields like `daysSinceUpdate` excluded).

  **Behind the scenes:**
  - `src/hygiene/audit-suite.ts` — YAML loader + path-template
    expansion + suite-to-runner-input adapter.
  - `src/hygiene/history.ts` — `captureHistory`, `listHistory`,
    `loadSnapshot`, `diffSnapshots`. Per-env directories.

  13 new unit tests (199 total in hygiene module). Live-validated
  suite-run + capture/list flow against the sandbox tenant.

- ce3af45: **Three new `scai audit` verbs — security / permission hygiene.**
  Built on the Authoring API's user/role/profile surface.
  - `audit empty-roles list` — roles with zero direct members. Uses
    `members(first: 1)` as the count signal since AccountConnection
    doesn't expose `totalCount`.
  - `audit role-bloat list --threshold <count>` — users with more than
    N role memberships (default 10). Counts direct memberships only;
    excludes administrators by default. Soft signal for "this user
    accumulated emergency access that nobody cleaned up."
  - `audit stale-users list --not-active-days <count>` — users who
    haven't logged in (or had any activity, with `--use-activity-date`)
    in N days. Default 180 days, `lastLoginDate` signal. Excludes admins
    - likely service accounts (regex on user name) by default; pass
      `--include-admins` / `--include-service-accounts` to override.

  **Hygiene client extensions:** `listUsers`, `listRoles`, `getUserDetail`
  on the Authoring API. Per-call paging via `AccountConnection.pageInfo`.

  **Explicit scope:** `audit anonymous-write` and `audit excessive-acls`
  were considered but dropped. The Authoring API's `Item.access` only
  exposes booleans from the **caller's** perspective (the OAuth
  client-credentials identity); there's no per-role ACL detail exposed
  on items. Building those audits would require impersonation or a
  SQL-shaped surface that XM Cloud doesn't have.

  11 new unit tests (171 total in hygiene module). Live-validated all
  three against the sandbox tenant (188-day-stale `JssImport` service
  account surfaced as expected).

- ce3af45: **Audit operational substrate — `audit all`, baselines, cross-cutting
  filters, output adapters.** Changes the user contract from "run 13
  audit commands and merge the JSON" to "one invocation, baseline-aware,
  piping into your CI / report channel of choice."

  **New meta-command:**
  - `scai audit all` — runs every audit (skipping `find-replace`, which
    needs `--pattern`) and emits a consolidated envelope. Honors
    `--include broken-links,unused-media` to scope, `--exclude-audit
find-replace` to skip, plus all of the new cross-cutting flags
    below.

  **Baseline (ignore-list) management:**
  - `scai audit baseline show` — print current baseline entries.
  - `scai audit baseline create [--audits a,b] [--reset]` — run audits
    and accept every finding as the new baseline.
  - `scai audit baseline remove --audit X --fingerprint Y` — drop a
    single entry.
  - `scai audit baseline reset [--audit X]` — wipe entries for one
    audit (or all).
  - Baseline files live at `.scai/audit-baseline-<envName>.json`
    (per-env; commit to version control). Each entry stores a stable
    fingerprint per finding (excludes transient fields like
    `daysSinceUpdate`).
  - Every `scai audit *` command gains a `--baseline` flag — when set,
    results are filtered against the baseline file. Use this in CI:
    audits report 0 findings until something genuinely new appears.

  **Cross-cutting filters on every audit command:**
  - `--exclude <path>` — repeat or comma-separate; skips items whose
    path begins with any of these prefixes.
  - `--since <date>` — ISO 8601 or YYYY-MM-DD; only items updated
    on/after this date.
  - `--owner <user>` — reserved for createdBy/updatedBy filtering;
    currently the audit task layer must resolve owner per item, so this
    is documented but enforced lazily.

  **Output adapters on every audit command:**
  - `--output <file>` — write the audit envelope to a file instead of
    stdout. Format inferred from extension (`.json`, `.csv`, `.md` /
    `.markdown`).
  - `--format <fmt>` — explicit format override. Default `json`.
  - CSV serializer flattens result rows into columns; quotes values
    containing commas / quotes / newlines.
  - Markdown serializer emits heading + summary + a table when rows are
    flat, or fenced JSON when rows have nested objects.

  **Behind the scenes:**
  - `src/hygiene/baseline.ts` — per-env baseline file with
    `fingerprintFinding` policy per audit (excludes transient fields).
  - `src/hygiene/output-adapters.ts` — JSON / CSV / Markdown formatters
    - `writeAuditOutput` that creates intermediate directories.
  - `src/hygiene/tasks/shared.ts` — extended `printReport` /
    `finishAudit` helper applies baseline filtering and output
    redirection; cross-cutting scan filters (`resolveScanFilters`,
    `matchesScanFilters`) plumbed through `scanItemsAndFields`.

  23 new unit tests (149 total in hygiene module). Live-validated `audit
all` and the baseline round-trip (2289 findings → 0 after baseline
  filter) against the sandbox tenant.

- e220b90: **`brand seed` can now seed a kit from a JSON/YAML file, not just a PDF.**

  `scai brand seed` is the single "create a brand kit" entry point, and
  it now takes two sources:
  - `--url <pdf>` — the full pipeline (create → upload → publish →
    ingest → enrich → poll). Unchanged. `--name` required here.
  - `--file <kit.yaml|json>` — **new** — a kit-shaped recipe applied
    directly via the converge engine: no PDF, no paid AI pipeline. It is
    the same `BrandKitRecipe` shape `brand sync pull` emits, so
    `seed --file` and `sync pull` round-trip.

  The previously-unsupported `[file]` positional argument is gone —
  `--file` replaces it. `--name` is no longer a hard `requiredOption`
  (the recipe carries the kit name on the `--file` path); it is validated
  per source instead.

- ce3af45: **BREAKING: Canonical `ScaiEnvelope` shape for every `--json` CLI output.**

  Before this change, scai emitted three different keys for "the primary
  payload" depending on which surface produced the output:
  - `result` — deploy commands (`printDeployResultWithContext`)
  - `results` — hygiene audit/cleanup commands (`printReport`)
  - `request` — deploy what-if (`printDeployWhatIf`)

  Agents parsing CLI output had to branch on shape per-command. This
  release unifies all three on `data` and introduces a single
  `ScaiEnvelope<T>` type (`src/shared/envelope.ts`) that every CLI
  command emits under `--json`:

  ```jsonc
  {
    "command": "deploy.environments.list",
    "environment": "demo",
    "data": <T>,            // primary result (object, array, scalar, or null)
    "count": 30,            // when data is an array
    "totalCount": 100,      // when paginated and known
    "pageSize": 50,         // when paginated
    "whatIf": true,         // when plan-only
    "ignoredCount": 3,      // when baseline filtering applied
    "summary": "...",       // human-readable headline
    "meta": { /* command-specific extras */ }
  }
  ```

  A new `buildScaiEnvelope(...)` helper handles the assembly: it
  auto-computes `count` for array data, hoists canonical envelope keys
  from the `extra` bag to envelope-level, and collects everything else
  under `meta` so the top-level namespace stays reserved for structured
  slots.

  **Migration for downstream consumers parsing scai `--json`:**
  - `envelope.result` → `envelope.data` (deploy commands)
  - `envelope.results` → `envelope.data` (hygiene commands)
  - `envelope.request` → `envelope.data` (deploy what-if)
  - Extra fields previously spread at envelope root (e.g. `root`,
    `scannedCount`) are now under `envelope.meta`. Pagination
    fields (`totalCount`, `pageSize`) stay at root because they're
    canonical envelope keys.
  - `audit.all` envelope: the flat denormalized findings list moved from
    `results` to `data`. The structured `audits` map and `counts` block
    are unchanged.

  The MCP tool output envelope (`CallToolResult.structuredContent`) is a
  separate MCP protocol shape and is not affected by this change.
  Serialization commands that emit non-envelope payloads (the
  `info`/`env` outputs that ship structured fields like `excludedFields`
  and `modules` at root) are out of scope for this release; their
  unification is a follow-up.

- ce3af45: **Blocker reports in `cleanup subtree` and `cleanup site-residue` now categorize each inbound reference by structural kind.**

  Both cleanups already scanned every field on every active item, so
  they already caught structural references (`_basetemplates`,
  `__masters`, `__source`, `_template`, `datasource template`) as
  "this field's value mentions the target." What they didn't do was tell
  the operator _which kind_ of reference — a "field X" line read the
  same whether the blocker was a base-template inheritance (deleting it
  orphans every inheritor's fields) or a generic content link
  (recoverable: clear the field).

  Each `InboundBlocker` (subtree) and `InboundRef` (site-residue) now
  carries a `referenceKind` derived from the field name:
  - `primary-template` — `_template`
  - `base-template` — `_basetemplates`
  - `insert-options` — `__masters`
  - `branch-source` — `__source`
  - `datasource-template` — `datasource template` (rendering type-gate)
  - `field-value` — everything else (the catch-all for generic refs)

  The subtree command's block-mode error message now prefixes each
  sample line with the kind, sorted so structural blockers (base-
  template, insert-options) surface ahead of plain field refs:

  ```
  Refusing to delete subtree '/sitecore/templates/Project/MySite':
  3 external reference(s) point into it.
    [base-template] /sitecore/templates/Project/Other/T1 . _basetemplates → abc12345…
    [insert-options] /sitecore/templates/Project/Other/Folder/__Standard Values . __masters → def67890…
    [field-value] /sitecore/content/Home . RelatedItems → 11223344…
  ```

  A new `src/hygiene/tasks/reference-kind.ts` module exports
  `classifyReferenceKind(fieldName)` and a `REFERENCE_KIND_PRIORITY`
  table for sort ordering. The classifier is case-insensitive and
  whitespace-tolerant. 5 unit tests in
  `tests/unit/hygiene/tasks/reference-kind.test.ts` lock the mapping.

- ce3af45: **`cleanup dead-templates` now runs an `audit template-dependencies` pre-flight per candidate.**

  `audit dead-templates` only checks primary-template count — items whose
  `_template` points at the candidate. It misses the four other reference
  shapes that block a template delete: **base-template inheritance**,
  **`__masters` insert-options**, **`__source` branch sources**, and the
  **`datasource template`** field on Rendering items. Before this change
  the cleanup attempted the delete anyway and surfaced whatever the
  Authoring API returned — typically a terse "still used by other items"
  that didn't tell the operator which item or which reference kind.

  The cleanup now invokes `audit template-dependencies` (silent mode) per
  candidate before attempting the delete. If any inbound refs are found
  the action returns `status: "blocked"` with a structured `blockers:
TemplateDependencyReport[]` list grouped by reference kind and
  sorted by path. The operator (or agent) gets an actionable list:
  "`/sitecore/templates/Project/Inheritor` blocks via base-template",
  not a generic API error.
  - `--force` skips the pre-flight (preserves the existing escape hatch
    for cases where the Authoring API would accept the delete despite
    stale index entries — for example mid-rebuild).
  - `--what-if` reports the plan inclusive of blocked candidates so the
    operator sees what would and wouldn't proceed.
  - Empty-folder cleanup runs against the residual tree; blocked
    templates aren't deleted, so their folders aren't candidates for
    removal — matches existing semantics.

  A new `silent: boolean` option on `runAuditTemplateDependencies` lets
  callers (cleanup tasks here, future MCP `cleanup_preview` workflows)
  suppress the audit's own printed report and surface findings in their
  own combined output instead. Direct CLI / MCP callers see the report
  as before.

  Follow-up: extend the same pattern to `cleanup-duplicates` (no
  pre-flight today), `cleanup-subtree` and `cleanup-site-residue` (own
  field-value scan; add structural-ref coverage via the same audit).

- ce3af45: **`cleanup duplicates` now runs an `audit references` pre-flight per deletion candidate.**

  Previously the cleanup picked one survivor per group and deleted the
  rest with no inbound-reference check; the docstring acknowledged
  "refs to deleted dupes become broken — run `audit broken-links` after."
  That post-cleanup mitigation was easy for a human to forget and
  impossible for an agent to figure out unaided.

  The cleanup now invokes `audit references` (silent mode) for each
  dupe in the deletion set before calling `deleteItem`. Items with
  inbound refs return `status: "blocked"` with a structured
  `blockers: ReferenceReport[]` list, identical to the pattern
  `cleanup-dead-templates` uses for `audit template-dependencies`.
  `audit references` is invoked with `cache: true` so back-to-back
  checks against the same `--root` share a warm field cache; first dupe
  pays the O(items × fields) scan, subsequent ones land in ms.
  - New `--skip-ref-check` flag (CLI) / `skipRefCheck: boolean` (library)
    opts out for migrations that will rebuild refs separately.
  - `--force` (already part of the cleanup base options) also bypasses.
  - `--what-if` skips the pre-flight by design — plan-only output doesn't
    call deletion or scanning.
  - A new `silent: boolean` on `runAuditReferences` mirrors the flag now
    on `runAuditTemplateDependencies`; suppresses the audit's own report
    for cleanup callers that surface findings in their own combined output.

- ce3af45: **Four new `scai cleanup` verbs — workflow, folders, roles, users.**
  Pairs with the corresponding audit verbs.
  - `cleanup workflow advance --command-name <name> --stale-days N` —
    execute a workflow command on items stuck past N days. Resolves
    the command name (e.g. "Submit", "Approve") against each item's
    workflow at its current state (via `Workflow.commands(query: {item})`),
    not workflow-wide — same workflow can expose different commands per
    state. `--from-state` scopes by current state name; `--comments`
    records an audit-trail note; `--max-advances` caps blast radius
    (default 100).
  - `cleanup empty-folders purge --root <path>` — depth-first
    bottom-up cleanup of folder-like items with no children.
    Required `--root`; refuses `/sitecore/system`,
    `/sitecore/templates`, `/sitecore/layout` without `--force`.
  - `cleanup roles purge-empty` — delete roles flagged by `audit
empty-roles list`. `--domain` to scope, `--max-deletions` defaults
    to 50.
  - `cleanup users purge-stale --not-active-days N` — delete users
    flagged by `audit stale-users list`. **Default threshold is 365
    days** (vs 180 for the audit) since deleting users is more
    destructive than flagging them. `--max-deletions` defaults to 25.
    Administrators + likely service accounts excluded by default.

  **Hygiene client extensions:** `deleteUser`, `deleteRole`,
  `executeWorkflowCommand`, `getWorkflowCommandsForItem` on the
  Authoring API. The `getWorkflowCommandsForItem` form passes
  `query: { item: { itemId } }` to `Workflow.commands` — that argument
  is required and the commands available depend on the item's current
  state.

  8 new unit tests (186 total in hygiene module). Live-validated all
  four against the sandbox tenant (workflow advance correctly surfaced
  "Basic Workflow / Draft" candidates).

- 3982b1c: **Deploy environment / project deletion is now destructive-tier gated.**

  `scai provision deploy environment delete` and `… project delete` previously
  relied only on a `confirmDestructive` prompt (skippable with `--force`).
  They now also run through the workspace-policy `destructive` tier — an
  irreversible deletion is refused for `m2m` / `mcp` callers and for a `ci`
  caller without `ciWrites`, and honours the environment ceiling and step-up
  window. A no-op in unmanaged mode.

  This closes the Phase 3 follow-up that had left these two runners untiered.
  The remaining guardrails follow-up — OS-level confinement of the recipe
  sandbox child — is documented in `docs/recipe-sandbox.md`: it is blocked on
  a sandbox redesign, because tsx requires `--allow-worker`, which Node itself
  warns invalidates the permission model.

- ce3af45: **`deploy environments list` now walks every page by default.**

  The Deploy API caps single-page responses at 10 items by default, so
  `scai deploy environments list` (and `... --project X`) returned only
  the first page unless the operator remembered `--all`. That made
  "couldn't find" errors common the moment a project grew past ten
  environments — the resolver paths were fixed earlier; the `list`
  command was the remaining hole.
  - Default is now the walker (`fetchAllEnvironments` / `fetchAllProjectEnvironments`).
  - `--no-all` or `--page <n>` opts out and fetches a single page.
  - The `--project X` branch now honors `--all` / `--no-all` / `--page` —
    previously it always returned a single page and silently ignored the
    page-control flags.
  - Both branches now return the same `{ totalCount, pageSize, data }`
    envelope so downstream consumers don't have to branch on shape.
  - The type-filter fallback (re-fetch without server-side `Types` when
    the filtered response is empty) is mirrored into the walker path.

  `--page` and `--page-size` semantics are unchanged for callers who use
  them explicitly. Help text updated to reflect the new default.

- e220b90: **`hygiene cleanup publish` removed — publishing is not cleanup.**

  `cleanup publish` triggered the Authoring GraphQL `publish` mutation; it
  lived under `cleanup` only because it reused the CM token already in
  hand. Publishing isn't a hygiene operation, and `content publish`
  already covers every case:
  - `content publish all` — whole-environment republish to Edge (via the
    SAI Publishing API — no Authoring path needed).
  - `content publish item --site <name> --include-subitems` — a site
    subtree; `content publish item` — specific items.

  The `publish` verb is also removed from the `cleanup_execute` MCP tool.
  Use `content publish` / the publishing MCP tools instead.

- e220b90: **New: `scai hygiene explain orphan-site <site>`.**

  A second `explain` verb, composing two audits the way `explain
why-blocked` composes its pair:
  - `audit site-residue` — orphan tenant/site trees left behind after a
    Sites-API site delete.
  - `audit references` — inbound field references to each orphan tree.

  `explain orphan-site <site>` filters the residue to one site and counts
  inbound references per orphan tree, flagging the ones still referenced
  by live content — so you know which orphans `cleanup site-residue
purge` can take now and which need their referrers resolved first.

  `audit site-residue` gained a `silent` option (matching `audit
references` / `audit template-dependencies`) so the `explain` verb owns
  the printed report.

- ce3af45: **New CLI verb: `scai explain why-blocked <itemId>` — answer the "why won't this delete?" question with one call.**

  The Authoring API rejects delete requests with terse messages like
  "Template is used by at least one item" or "Item is referenced by
  other items" — enough to know something is wrong, not enough to
  know what. Operators were piecing together the picture by hand:
  `audit references` → `audit template-dependencies` → cross-reference
  field names → guess. Agents couldn't even start because they didn't
  know to compose those two audits in the first place.

  `explain why-blocked` does the composition once:

  ```bash
  $ scai explain why-blocked {ABC-DEF-...}
  abcdef0123456789abcdef0123456789 is blocked by 5 inbound reference(s):
    1 base-template, 1 insert-options, 3 field-value.
    - [base-template] /sitecore/templates/Project/Inheritor
    - [insert-options] /sitecore/templates/Project/Folder/__Standard Values
    - [field-value] /sitecore/content/Home . Body
    - [field-value] /sitecore/content/Home . RelatedItems
    - [field-value] /sitecore/content/Article . MainImage
  ```

  Internally it invokes both `runAuditReferences` and
  `runAuditTemplateDependencies` in parallel (each with `silent: true`,
  so the verb owns its own printed report), merges the findings into
  one list, and sorts them via `REFERENCE_KIND_PRIORITY` so structural
  blockers (base-template, insert-options, …) surface ahead of plain
  field-value refs — the operator's first triage decision is "what's
  the worst blocker?"

  Skip flags for perf:
  - `--skip-content-scan` — drop the slow field-value walk, only check
    structural template-dependency refs. Useful when the target is
    known to be a template.
  - `--skip-template-deps` — drop the five search-index queries, only
    scan field values. Useful when the target is a leaf content item
    that no template should reference.

  Output is the canonical `ScaiEnvelope` (`command:
"explain.why-blocked"`, `data: { itemId, blockers: [...] }`, summary
  - meta). 6 unit tests in
    `tests/unit/hygiene/tasks/explain-why-blocked.test.ts` pin the merge
    sort + skip-flag behavior.

- ce3af45: **`scai audit` performance — tunable concurrency, parallel pagination,
  and an opt-in field cache.** Cuts repeated-run audit time ~2.4× on
  warm cache and lets operators dial throughput up or down per tenant.

  **New flags on every `scai audit *` command:**
  - `--concurrency <N>` (default 8, env `SITECOREAI_HYGIENE_CONCURRENCY`) —
    parallel batch fan-out for field reads and ref resolution.
  - `--batch-size <N>` (default 50, env `SITECOREAI_HYGIENE_BATCH_SIZE`) —
    aliased GraphQL batch size per field-read query.
  - `--page-parallelism <N>` (default 4, env
    `SITECOREAI_HYGIENE_PAGE_PARALLELISM`) — parallel page-windows during
    search enumeration. The first page is always sequential (we need its
    `totalCount`); subsequent pages are fetched in concurrent windows.
  - `--cache` (env `SITECOREAI_AUDIT_CACHE=true`) — opt-in on-disk
    field cache at `~/.sitecoreai/audit-cache/<envName>.json`, keyed by
    `(itemId, updatedDate)`. LRU-capped at 50k entries. Best for running
    multiple audits back-to-back (e.g. `broken-links` then `unused-media`
    then `duplicates` in one CI pass): the second and third audits skip
    field re-fetches for unchanged items.

  **Behind the scenes:**
  - `HygieneApiClient.searchAll(query, perPage, parallel)` — new
    `parallel` parameter. Set to 1 (default for legacy callers) preserves
    the original sequential-page ordering. Higher values fetch
    page-windows concurrently after the first page reveals totalCount;
    cross-window order is still page-index order, but within-window
    ordering is non-deterministic so callers that need stable output
    should sort the final accumulated set.
  - `scanItemsAndFields` helper in `src/hygiene/tasks/shared.ts` —
    bundles the enumeration → field-fetch pipeline used by every
    field-reading audit. Centralizes the perf knobs + cache wiring so
    individual audits don't repeat the boilerplate.
  - New module `src/hygiene/cache.ts` — `createFieldCache`,
    `wrapFieldsBatchWithCache`, `isAuditCacheEnabled`. Per-env JSON
    files; corrupt-file recovery; LRU eviction.

  **Benchmark (sandbox tenant, 500 items, `audit broken-links list`):**
  - Cold cache: 2.9s
  - Warm cache (second run): 1.2s (~2.4× speedup)

  Parallelism wins are workload-dependent. Small tenants and
  restricted-throughput environments may prefer lower values (e.g.
  `--concurrency 4 --page-parallelism 1`). The defaults are tuned for
  typical XM Cloud tenants but every knob is overridable per-run.

  23 new unit tests (134 total in hygiene module).

- ce3af45: **Markdown polish for `audit all` + Management API security findings
  documented.**

  **Markdown output adapter** — `audit all` envelopes now render as
  human-readable reports:
  - Header block (`# Audit report — <env>`).
  - Summary callout (`> **Summary**`) with audits-run, total findings,
    baseline-ignored counts, and failed-audit count.
  - Breakdown table — per-audit row with findings count, ignored
    count, duration, and any error. Sorted by findings desc.
  - Per-audit `##` sections for audits with findings (or errors).
    Audits with zero findings collapse to just their breakdown row.
  - Failed audits get an `⚠️` callout with the error message.

  Single-audit envelopes (e.g. `audit broken-links list --format md`)
  retain their existing shape: heading + metadata bullets + table
  (flat rows) or fenced JSON (nested rows).

  **Management API introspection** — documented in `parity-with-devex.md`.
  The summary:
  - `Authoring.Item.access` exposes booleans from the **caller's**
    perspective only; no per-role ACL detail.
  - `Management.users(predicates)` + `Management.roles(predicates)`
    exist but `Predicate.pattern` is substring match (not glob/SQL
    LIKE), and the resolver is unreliable under repeated OAuth
    client-credentials calls.
  - Per-role ACL audits (`anonymous-write`, `excessive-acls`,
    `unapproved-users`) aren't reliably buildable from XM Cloud APIs.
    Stay out of scope until the API surface improves.

  1 new unit test covering the audit-all Markdown shape (199 hygiene
  tests total). Live-validated against the sandbox tenant — `audit all
--output report.md` produces a clean per-audit summary.

- ec4e19a: **MCP access preflight, environment onboarding, and traversal-based
  content browsing — plus a structured error-remediation contract.**

  **New MCP tools.**
  - `access_check` — a one-call config / policy / credential preflight.
    Each gate reports pass/fail with a structured remediation, so an MCP
    client can diagnose a misconfigured environment without a trial-and-
    error sequence of tool calls.
  - `content_browse` — bounded-depth, traversal-based content-tree
    listing. Unlike a search-backed listing it needs no provisioned search
    index, so it works on a freshly created environment.
  - `environment_onboard` — write-gated onboarding of a new environment
    profile.

  **Error-remediation contract.** `ScaiError` now carries a `remediation`
  with an `actor` classification (`agent`, `needs-human-terminal`,
  `transient-retry`), surfaced consistently in CLI JSON output, CLI text
  output, and the MCP error envelope, and wired into the policy and
  credential error sites. Human-only operations are declared as capability
  metadata and advertised by `scai_overview`, so an agent knows up front
  which steps it cannot complete unattended.

  **Fixes.**
  - `listItemTemplates --root` resolves the root by exact path match and
    post-filters by path prefix; an unresolved root now throws instead of
    silently returning an empty list.
  - The `dead-templates` audit gives a clear remediation when the
    environment has no search index, pointing at the traversal-based
    audits instead.
  - `setup env` polls a freshly minted client until it activates, rather
    than reporting success while the client still returns `AUTH_REQUIRED`.

- a8b4375: **MCP/CLI coherence pass — close the gaps the CLI surface cleanup
  opened.** The `scai mcp serve` tool surface now tracks the CLI commands
  added after the MCP server first shipped.

  **New MCP tools:**
  - **`recipe_sync`** — the projection of `scai sync`. A
    `{ verb }`-discriminated tool (`pull` / `status` / `push`) that fans
    pull / diff / push out over every enumerable recipe kind (brand kits
    and brief types) in one call. Previously the MCP only exposed the
    per-instance `*_recipe_*` tools, so "sync everything" had no agent
    path.
  - **`explain`** — the projection of `scai hygiene explain`. A
    `{ verb }`-discriminated tool (`why-blocked` / `orphan-site`) that
    composes multiple audits into one focused answer ("what blocks this
    delete?", "what residue did this deleted site leave?"). Read-only.

  **New resource:** `scai://help/topics` — the intent-based command index,
  mirroring `scai cli topics`. Both surfaces now render the one shared
  `TOPICS` list (`@/shared/topics`).

  **Shared source of truth:**
  - The cross-domain recipe-kinds list moved to `@/sync/aggregate-kinds`
    (`ENUMERABLE_RECIPE_KINDS`); `scai sync` and `recipe_sync` import the
    same list instead of hand-maintaining a copy each.
  - The `TOPICS` index moved to `@/shared/topics`; the CLI command and
    the MCP resource share it.

  **Help-resource refresh:** `scai://help/overview` now describes the full
  tool surface (brand, briefs, campaigns, Agentic Studio, hygiene,
  workflow, webhooks, publishing — not just deploy/serialization/recipe),
  the complete resource + prompt lists, and accurate concurrency notes
  (reads run concurrently; long writes honor cancellation + progress).
  `scai://help/sitecore-apis` now maps the SAI Publishing API to the
  shipped `publish_inspect` / `publish_lifecycle` tools.

  **Internal consistency:** `publish_inspect` / `publish_lifecycle`
  descriptions moved into `descriptions.ts` (the single audit point for
  agent-facing copy). The explain hygiene tasks gained a `silent` option
  so non-CLI callers get the structured report without a stdout write.

  **Guardrail:** `cli-mcp-parity.test.ts` now covers the `explain` and
  `recipe_sync` domains alongside workflow + webhook.

- ce3af45: **`scai mcp serve --transport http` — Streamable HTTP transport.** The
  MCP server is no longer stdio-only. `--transport http` runs a Streamable
  HTTP listener at `http://<host>:<port>/mcp`, so a browser-hosted MCP
  client — or any client that connects over a URL instead of spawning a
  child process — can reach the same 24-tool surface without an external
  proxy.

  **Flags:** `--transport stdio|http` (default `stdio`), `--port <n>`
  (default `3399`), `--host <addr>` (default `127.0.0.1`).

  **Stateless:** no `Mcp-Session-Id`, a fresh MCP server per request.
  scai's dispatch rwlock already serializes writes process-wide, so there
  is no per-session state worth keeping. Progress notifications still
  stream back on the per-request response.

  **Security:** binds to loopback by default (a non-loopback `--host`
  prints a warning); validates the `Host` header against the bound
  address as a DNS-rebinding defense; CORS is permissive on `Origin` so a
  browser client can connect. The `allowWrite` per-call write gate is
  unchanged.

- ce3af45: **MCP dispatch: parallel reads via an internal read/write lock.**
  Previously every tool call serialized through a single Promise-chain
  mutex — fine for write-time correctness, but agents issuing read tool
  calls (`*_inspect`, `environment_status`, `webhook_inspect`, …) had to
  wait their turn even though no shared mutable state was at risk. The
  mutex was documented as a v1 limitation.

  Replaces the mutex with an in-house rwlock in `src/shared/rwlock.ts`,
  threaded through `src/mcp/dispatch.ts`:
  - **Reads** (`auth: "read"` descriptors) run concurrently with other
    reads.
  - **Writes** (`auth: "write"`) are exclusive against everything —
    preserves the original v1 invariant that mutations don't observe
    each other's half-applied state.
  - **Writer preference.** A queued writer is admitted before queued
    readers when a write releases, so a long stream of reads can't
    starve a `recipe_push` waiting for an exclusive slot.

  Cancellation, `allowWrite` gating, redaction, and the `CANCELLED`
  envelope path are unchanged. The test-only reset helper renames from
  `__resetDispatchMutexForTests` to `__resetDispatchLockForTests`; the
  old name was never used outside the dispatch test file.

- ce3af45: **Internal aggregator barrels removed.**

  Every `index.ts` (and sibling `.ts` pass-through file) that existed
  solely to re-export from neighboring files has been deleted from the
  source tree. Production code now imports directly from the file that
  owns the symbol.

  Deleted internal aggregators:
  - `src/index.ts` (the SDK root namespace barrel)
  - `src/config/index.ts`
  - `src/deploy/api/common/index.ts` + `src/deploy/api/common.ts`
  - `src/deploy/tasks/index.ts` + `src/deploy/tasks.ts`
  - `src/hygiene/tasks/index.ts` + `src/hygiene/tasks.ts`
  - `src/publishing/tasks/index.ts`
  - `src/recipe/tasks/index.ts`
  - `src/serialization/filesystem-store/index.ts` + `src/serialization/filesystem-store.ts`
  - `src/serialization/sitecore-api.ts` (pass-through; the public-entry
    `src/serialization/sitecore-api/index.ts` is retained as SDK contract)
  - `src/serialization/tasks/index.ts` + `src/serialization/tasks.ts`
  - `src/serialization/tasks/env/index.ts` + `src/serialization/tasks/env.ts`
  - `src/serialization/tasks/helpers/index.ts` + `src/serialization/tasks/helpers.ts`
  - `src/sites/api/index.ts`
  - `src/webhooks/api/index.ts` + `src/webhooks/tasks/index.ts`
  - `src/workflow/api/index.ts` + `src/workflow/tasks/index.ts`

  What stays:
  - The **9 public package entries** that `package.json#exports` points at
    (`recipe`, `deploy`, `serialization`, `brand`, `sites`, `publishing`,
    `hygiene`, `webhooks`, `workflow`) — they're SDK contract files, not
    aggregator-of-convenience.
  - The **commander composition files** under `src/commands/**/index.ts`
    — they wire `Command` instances together, not bag-of-re-exports.

  Why: barrels cost tooling time (TS parses everything they re-export),
  hide which file owns a symbol, and encourage import-everything patterns
  inside the codebase. The 9 public entries get to stay because they
  define the SDK surface; the rest were convenience-only and gone.

  No public API breakage. The public package-entry surface is unchanged:
  the 9 subpaths still export the same symbols. Only internal import
  paths changed.

- ce3af45: **`scai mcp serve` — built-in Model Context Protocol server.** Launches
  a stdio MCP server bound to a single Sitecore environment, exposing
  scai's developer-side library surfaces (deploy + serialization +
  recipe) as agent tools. Developer-side counterpart to Sitecore's
  managed Marketer MCP — complementary, not competing.

  **Surface:**
  - **24 workflow-shaped tools** across deploy (12), serialization (4),
    recipe (4), bootstrap (2), inspector (2). Tools consolidate
    multiple library primitives into task-shaped operations using
    `*_inspect` snapshots and `*_manage` / `*_lifecycle` discriminated
    `action` inputs. Never 1:1 wrappers — that's an MCP anti-pattern.
  - **5 resources** for agent self-orientation:
    `scai://help/{overview,recipes-grammar,deploy-lifecycle}` and
    `scai://env/current/{manifest,last-deploy}`.
  - **3 prompts** (`scai.deploy_recipe`, `scai.diff_envs`,
    `scai.recover_failed_deploy`) as compatible-client slash commands.

  **Write gate:** every write tool's input schema declares
  `allowWrite: boolean` (defaults false). The dispatcher rejects calls
  with `allowWrite !== true` before any side effect runs. Per-call
  consent — no session-wide override.

  **Inspector CLI:** `scai mcp tools list` (TSV) and
  `scai mcp tools schema [--name <name>]` for offline introspection
  without binding to a tenant.

  **Transport:** stdio only in v1. HTTP / SSE deferred to v2.

  **Stdout discipline:** the MCP serve action sets
  `SITECOREAI_MCP_SERVE=1`, `SITECOREAI_JSON=1`, `SITECOREAI_QUIET=1`,
  `SITECOREAI_NON_INTERACTIVE=1` BEFORE any other scai module loads,
  and installs a consola reporter that forwards every log line to
  stderr. A new post-build smoke (`scripts/smoke-mcp.cjs`, wired into
  `pnpm smoke`) verifies stdout contains ONLY JSON-RPC frames.

  **What's NOT exposed:** edge tokens, editing secrets, source-control
  OAuth tokens, deploy access tokens, generic GraphQL escape hatches,
  multipart uploads, and watcher commands all stay off the tool
  surface by design.

  **Known v1 limitations:**
  - Tool calls serialize through a single mutex; no parallel dispatch.
  - No cancellation. Long-running tools finish-then-return.
  - No streaming partial results.
  - No HTTP transport.
  - Inline-TS recipe sources not supported (`recipe_compile` accepts
    a file path or a pre-parsed JSON recipe object).

  **Dependency:** `@modelcontextprotocol/sdk@^1.29.0` (dual ESM/CJS;
  TypeScript types resolve through the SDK's `typesVersions` block
  under scai's existing `moduleResolution: "node"` config).

  **Docs:** [docs/mcp.md](docs/mcp.md) for the full reference;
  [docs/parity-with-devex.md](docs/parity-with-devex.md) lists MCP under
  "Added in scai"; [README.md](README.md) has a quickstart.

- ce3af45: **MCP — progress notifications + cancellation for long-running tools.**
  `recipe_push` and `serialization_sync` now emit MCP
  `notifications/progress` frames while they run AND honor MCP
  `notifications/cancelled` for cooperative abort. Stdio transport only;
  no HTTP work in this round.

  **Progress:**
  - `recipe_push` — emits one notification per recipe op (`op-start`,
    `apply-success`, `apply-error`). Message format
    `[<recipe-handle>] op <i>: <op-kind>`. `total` left undefined (the
    compiled op set expands at runtime).
  - `serialization_sync` — emits one notification per database
    checkpoint (`database-start` / `database-changes-detected` /
    `database-applied` / `database-skipped`).
  - Clients opt in via `_meta.progressToken` on the tool call.
    Without the token the server skips emission — progress is strictly
    opt-in and never load-bearing.

  **Cancellation:**
  - Adds `CANCELLED` to `ScaiErrorCode` (exit code 130). Minor
    public-API extension — existing consumer code that narrows the
    union must add the new case.
  - Recipe executor honors `signal` between operations; partial
    mutations are rolled back via the existing LIFO rollback path.
  - Serialization tasks honor `signal` between databases; in-flight
    HTTP requests inside a single op are not interrupted. Filesystem
    / tenant state already applied before the cancel is left in place
    (best-effort cancellation, like `deploy_run_cancel`).
  - The dispatcher converts a post-handler aborted signal into a
    `CANCELLED` envelope, so clients see consistent typed errors
    whether the underlying library threw `AbortError` or returned
    normally.

  **Tool handler signature change (additive):**
  - `ToolDescriptor.handler` now receives a third `extra: ToolExtra`
    argument with `{ signal, progressToken, sendProgress, sendNotification }`.
  - Existing tools that don't care about progress/cancel ignore the
    arg — no breaking call-site changes.
  - New `dispatchTool` options shape: `{ context, extra }`.

  **Library extensions:**
  - `executeIr` (`src/recipe/execute.ts`) gains an optional
    `signal: AbortSignal` in `ExecuteOptions`.
  - `RecipePushOptions` (`src/recipe/tasks/shared.ts`) gains
    `emit?: (event: { recipe; event: ExecutionEvent }) => void` and
    `signal?: AbortSignal`.
  - `SyncOptions` + `DiffOptions` (`src/serialization/tasks/types.ts`)
    gain `SerializationProgressShape` (`{ emit?, signal? }`). New
    exported type `SerializationProgressEvent` describes the event
    union.
  - `runPull` / `runPush` / `runDiff` honor signal between databases
    and emit per-database progress events.

  **Docs:**
  - `docs/mcp.md` — new "Progress notifications" + "Cancellation"
    sections; the v1 limitations list now notes the cooperative
    (between-ops/databases) cancel semantics rather than "no cancel".

  **Tests:**
  - 4 new MCP unit tests (dispatch pre-aborted, dispatch mid-flight,
    recipe progress forwarding, serialization progress forwarding).
  - 1 new integration test (SDK client `AbortController` round-trip).

- ce3af45: **Phase A of the library-ization plan — transport decoupling.** Pure
  internal refactor; no public API breakage. Sets up future library
  consumers (subpath exports `./deploy`, `./serialization`, `./recipe`,
  `./errors`) to be drop-in callable without inheriting scai's env-var
  namespace or TTY side effects.
  - **`deployRequest`**: new optional `init.silent` (suppresses the TTY
    spinner) and `init.transport` (`timeoutMs` / `maxRetries` /
    `retryBaseMs` / `traceHttp`). When unset, behavior is identical to
    before — env-var fallbacks (`SITECOREAI_REQUEST_TIMEOUT_MS`,
    `SITECOREAI_HTTP_RETRIES`, `SITECOREAI_HTTP_RETRY_BASE_MS`,
    `SITECOREAI_TRACE_HTTP`) still apply. Library callers pass these
    explicitly so they don't depend on scai's env namespace.
  - **`startDeploySpinner`**: new optional `{ silent: true }` arg for the
    same reason.
  - **`acquireAccessToken`** (new export from
    `serialization/sitecore-api/auth`): pure OAuth acquisition — refresh
    on env, then client credentials — with no keychain reads or writes.
    Library callers that bring their own token cache can call this
    directly. `getAccessToken` keeps its keychain-backed semantics and
    now composes `acquireAccessToken` internally.
  - `src/shared/graphql.ts` was already library-ready (no spinner; env-var
    fallback already caller-overridable via `options.timeoutMs`) and
    required no changes — the Phase 1 design proposal over-scoped it.

- ce3af45: **Phase B of the library-ization plan — first public library exports + `CliError` → `ScaiError` rename.**

  `@sitecoreai-labs/sitecoreai-cli` now exposes two new subpath exports
  alongside the existing `./recipe`:
  - **`@sitecoreai-labs/sitecoreai-cli/deploy`** — Deploy API clients. Every
    `fetch*` / `create*` / `update*` / `delete*` / mutating helper from
    `src/deploy/api/*` (orgs, projects, environments, deployments, source
    control, editing host, logs, deployment logs) plus the request-layer
    primitives (`deployRequest`, `DEFAULT_DEPLOY_API_BASE`, the
    `DeployRequestTransport` config added in Phase A, and the type set).
  - **`@sitecoreai-labs/sitecoreai-cli/errors`** — the typed error envelope.

  **Class rename: `CliError` → `ScaiError`.** The error class, the
  `*Code` union, the factory, and the converter all gained `Scai*`
  names. The legacy `Cli*` names are re-exported as deprecated aliases
  that point at the same symbols — `instanceof CliError` and
  `instanceof ScaiError` both match any thrown error from scai. The
  deprecated names will be removed in the next major version.

  Backwards compatibility:
  - Existing `./recipe` consumers: unchanged.
  - New `./deploy` and `./errors` consumers: stable as of this release.
  - Pre-rename `CliError`/`createCliError`/`toCliError`/`CliErrorCode`
    callers: continue to work via aliases; migrate at your convenience.

  Internal:
  - ~70 source files migrated to the new `Scai*` names via codemod;
    full test suite still passes.
  - `src/deploy/lib.ts` and `src/shared/lib-errors.ts` are the new
    public barrel files. Internal helpers (`startDeploySpinner`,
    `parseJsonIfPossible`, `extractErrorMessage`) reach through
    `./deploy` for now — Phase C will tighten that surface.
  - New `tests/unit/lib-surface.test.ts` smoke-checks both subpath
    exports plus the existing `./recipe`. New
    `tests/unit/shared/errors.test.ts` case verifies the deprecated
    `CliError` alias.

- ce3af45: **Phase C — library entry points refactored; new `./serialization` subpath.**

  Drops the `lib.ts` wrapper pattern introduced in Phase B in favor of
  real, intentional public files. Each subpath in `package.json#exports`
  now points directly at a source-tree module whose explicit named
  exports ARE the contract — no `export *` cascades, no wrapper barrels
  whose only purpose is to re-export from another file.

  **New subpath: `@sitecoreai-labs/sitecoreai-cli/serialization`** —
  points at `dist/serialization/sitecore-api/index.js`. Re-exports the
  Sitecore Management + Authoring GraphQL clients (`fetchItemMetadata`,
  `fetchItemData`, `executeSerializationCommands`, history, roles, users,
  publishing), the auth primitives (`acquireAccessToken`,
  `getAccessToken`, `requestClientCredentialsToken`,
  `requestDeviceAuthorization`, `pollDeviceToken`,
  `DEFAULT_SITECORE_API_AUDIENCE`), the transport seam (`runGraphQL`,
  `GraphQLRequestOptions`), data types (`ItemData`, `ItemMetadata`,
  `ItemLanguage`, `ItemVersion`, `ItemFieldValue`, `FieldFilter`,
  `RoleData`, `UserData`, `HistoryEntry`, `RolePredicateItem`,
  `UserPredicateItem`), the domain object `ItemPath`, and the new
  `SitecoreApiClientOptions` structural type.

  **Existing `./deploy` and `./errors` subpaths moved to real files**
  (non-breaking — the API surface is unchanged):
  - `./deploy` was `dist/deploy/lib.js` (wrapper); now
    `dist/deploy/api/index.js` directly. Source-of-truth file is
    `src/deploy/api/index.ts` with explicit named exports.
  - `./errors` was `dist/shared/lib-errors.js` (wrapper); now
    `dist/shared/errors.js` directly. The `lib-errors.ts` file is
    removed.

  **Internal-helper leakage closed.** Phase B's `./deploy` accidentally
  exposed `startDeploySpinner`, `parseJsonIfPossible`, and
  `extractErrorMessage` via cascading `export *`. The new explicit
  public entry omits all three; internal scai callers still reach them
  via `@/deploy/api/common/request` as before.

  **`SitecoreApiClientOptions`** — a structural type covering the 11
  fields the GraphQL transport + OAuth flow actually use (`host`,
  `authority`, `clientId`, `clientSecret`, `audience`, `accessToken`,
  `refreshToken`, `refreshTokenParameters`, `useClientCredentials`,
  `cacheAuthenticationToken`, `name`). Library callers construct one
  of these directly. The CLI's full `EnvironmentConfiguration` (30+
  fields covering deploy tokens, recipe roots, allow-write gates, etc.)
  structurally satisfies the interface, so internal callers continue
  to pass it without change.

  **What's intentionally NOT exposed**:
  - `src/serialization/tasks/**` — task runners that mix in commander
    options, prompts, logger output, filesystem-store reads.
  - `src/serialization/filesystem-store/**` — YAML-on-disk is a CLI
    implementation detail; library callers operate on `ItemData` /
    `ItemMetadata` directly.
  - `compare.ts`, `field-filter.ts`, `signature.ts`, `commands.ts`,
    `wildcard.ts`, `yaml.ts`, `path-provider.ts`, `tree-spec.ts` —
    utility seams for the CLI tasks.
  - Deploy: `startDeploySpinner`, `parseJsonIfPossible`,
    `extractErrorMessage` (CLI / internal helpers).

- ce3af45: **Phase D — recipe client factories + Authoring GraphQL escape hatch.**

  Extends the existing `@sitecoreai-labs/sitecoreai-cli/recipe` public
  surface with three additions library consumers need to build their
  own recipe-execution flows without re-implementing the wire-protocol
  semantics. Purely additive — no existing `./recipe` consumer breaks.

  New exports from `./recipe`:
  - **`createAuthoringClient(options: AuthoringClientOptions): AuthoringApiClient`** —
    production factory for scai's `AuthoringApiClient` implementation.
    Includes path-resolution, parent-folder auto-creation (Folder /
    Template Folder / Rendering Folder / HeadlessVariantsGrouping
    template selection), and retry-on-throttle for read GETs. Library
    consumers that want the same wire protocol as `scai recipe push`
    use this factory directly. The interface-only `AuthoringApiClient`
    export was already public — this adds the implementation seam.
  - **`createSitesApiClient(options: SitesApiClientOptions): SitesApiClient`** —
    production factory for the Sites API client surface used by recipe
    execution (`createSite`, `getJobStatus`, `listSites`,
    `listSiteTemplates`, `listCollections`, `listLanguages`,
    `addLanguage`). Adapter over `src/sites/api/*` function-style API.
    Sites types — `Job`, `JobResponse`, `Language`, `NewSiteInput`,
    `Site`, `SiteCollection`, `SiteTemplate` — are also re-exported.
  - **`runAuthoringGraphQL` + `AuthoringRequestOptions`** — ad-hoc
    Authoring GraphQL escape hatch sharing retry / timeout / auth /
    redaction with `createAuthoringClient`. Use this when scai's typed
    clients don't cover the query/mutation you need but you want the
    same transport semantics.

  Nothing renamed, nothing relocated — these symbols already existed at
  `src/recipe/api/authoring-client.ts`, `src/recipe/api/sites-client.ts`,
  and `src/recipe/api/graphql.ts`. Phase D just makes them part of the
  public contract.

- a9d76fd: **Workspace policy guardrails — caller context and tier gating (Phase 2).**

  Phase 1 bounded _which_ environments scai may touch. Phase 2 bounds _who_ may
  do _what_ there.
  - **Caller context** — every invocation is classified `interactive-human` /
    `ci` / `m2m` / `mcp` from the process environment, computed fresh per call.
    This replaces the originally-planned "token provenance": a token outlives
    the session that created it, so its birth says nothing about who is
    invoking now.
  - **Mint gating** — `scai setup client create` now requires an interactive
    human operator on a mint-eligible environment. An agent (MCP), a CI run, or
    any unattended process can no longer mint an automation client. `scai setup
login` marks the environment it logs into as mint-eligible, so normal
    onboarding is unaffected.
  - **Write tier gating** — `ensureAllowWrite` consults the workspace policy: a
    CI caller needs the environment's `ciWrites` flag, and an environment
    capped at the `read` ceiling rejects writes. `--allow-write` still bypasses
    the config `allowWrite` requirement but never the policy.
  - **`scai policy set <env>`** — tune an enrolled environment's `ceiling`,
    `ci-writes`, and `mint` eligibility. `scai policy show` now displays them.

  Unmanaged mode (no `~/.sitecoreai/policy.json`) remains a full no-op, so
  nothing changes for a setup that has not opted in.

  The `destructive` tier is defined in the gate, but wiring each destructive
  command to call it is Phase 3. See `docs/policy-and-guardrails.md`.

- 1e239af: **Workspace policy guardrails — destructive-tier wiring and step-up (Phase 3).**

  Phase 2 built the `destructive` tier into the policy gate but left it
  unwired. Phase 3 classifies scai's irreversible operations and enforces the
  tier, and adds an opt-in auth-freshness requirement.
  - **Operation risk registry** (`src/policy/operations.ts`) — one auditable
    file classifying mutating operations by risk tier. The eight destructive
    cleanup verbs (version prune, archive purge, dead-template / duplicate /
    subtree / role / user / site-residue removal) and `recipe push` are
    registered `destructive`.
  - **Destructive-tier enforcement** — `ensureAllowWrite` takes an optional
    `operation` argument; a registered destructive operation authorizes at the
    `destructive` tier, so it is refused for `m2m` / `mcp` callers and for `ci`
    callers without `ciWrites`. (`recipe push` previously used a stale local
    copy of the gate that predated the policy layer — now removed; it goes
    through the shared gate.)
  - **Step-up** — `scai policy set <env> --step-up <minutes>` sets a
    per-environment freshness window: a `destructive` or `mint` operation then
    requires the deploy token to have been minted within it, else the gate
    refuses with a re-login instruction. Off by default; a repo policy may only
    shorten the window. `scai policy show` displays it.

  Unmanaged mode remains a full no-op. Deploy environment/project deletion is
  not policy-tiered (those runners carry no config-env); recipe-execution
  sandboxing — the `.recipe.ts` arbitrary-code concern — is tracked separately
  as Phase 4. See `docs/policy-and-guardrails.md`.

- d5a7ec4: **Workspace policy guardrails — scai now operates against a deny-by-default allowlist of environments (Phase 1).**

  `sitecoreai.cli.json` was both the target list _and_ the permission
  grant: anyone who could write that file could add a production
  environment and grant `allowWrite` to it in one edit. The new
  **workspace policy** separates the two — an operator-owned artifact,
  outside any repo, that bounds which Sitecore environments scai may touch.
  - **User-global policy** (`~/.sitecoreai/policy.json`) — a deny-by-default
    allowlist of environments. The hard ceiling.
  - **Repo policy** (`<repo>/scai.policy.json`, optional) — may only
    _narrow_ the user-global policy (drop environments, lower ceilings),
    never widen it. The effective verdict is the intersection of the layers.
  - **Identity pinning** — each enrolled environment's tenant triple
    (`organizationId` / `projectId` / `environmentId` / `host`) is pinned at
    enrollment. If an enrolled environment name later resolves to a
    _different_ tenant, scai refuses with `POLICY_DENIED` — catching a
    config whose IDs were swapped underneath a trusted name.

  Enforcement runs inside `resolveEnvironment` — the one resolver every
  surface (CLI, SDK, MCP) routes through. For the MCP server this means an
  agent cannot retarget a tool call at any environment the operator never
  enrolled.

  **Zero-config for the common case.** The environment you `scai setup
login` into, or bind a `scai mcp serve` to, is auto-enrolled — the policy
  file is created and maintained by tooling, never hand-edited. Only a
  _second_ environment needs a deliberate `scai policy allow`.

  **No regression for existing setups.** With no `~/.sitecoreai/policy.json`
  scai runs in "unmanaged mode" — enforcement is a no-op, behaviour is
  unchanged. The policy file appears (and guardrails switch on) the next
  time the operator runs `setup login`, `mcp serve`, or `scai policy init`.

  New command group `scai policy`: `show`, `init`, `allow <env>`,
  `remove <env>`, `trust <env>` (re-pin after a legitimate tenant change).
  New error code `POLICY_DENIED` (exit code 3).

  See `docs/policy-and-guardrails.md` for the design and threat model.
  Phase 2 (credential provenance, step-up auth, mint gating) is not in this
  change.

- ce3af45: **`scai publish` + `scai content version` — publishing surface shipped.**
  First-class wrapper around the SAI Publishing REST API
  (`edge-platform.sitecorecloud.io/authoring/publishing/v1`) with a
  two-step safety flow on every write.

  **Publishing verbs:**
  - `scai publish item` — item / subtree publish. Address by
    `--items <guid>`, `--paths <path>`, or `--site <name>` (composable).
    `--include-subitems` / `--include-related` for the dotnet `--subitems`
    / `--related` equivalents. `--mode Smart|Republish`.
  - `scai publish all` — whole-environment republish to Edge. Modes
    `Smart` (default) / `Republish` / `Incremental`. Maximum gating:
    always requires a scope token AND typed env-name confirmation, even
    on non-prod envs. In `--non-interactive` mode, auto-watches the job
    to completion and exits with the appropriate code (pass `--no-wait`
    to override). Dry-run surfaces the last whole-env publish timestamp
    and itemsSent count as a "modified since" baseline.
  - `scai publish unpublish` — three strategies: `never-publish`
    (reversible, default, writes `__Never publish: true`),
    `expire-now` (reversible, writes `__Valid to: <now>`), and
    `delete` (NOT reversible; requires typed-item-path confirmation per
    item).
  - `scai publish status [<jobId>]` — one-shot status, list queued/running
    jobs, or `--watch` to poll until terminal. Exits 0 on completed, 6 on
    failed, 130 on cancelled, 4 on watch timeout. JSON streaming for CI.
    Failed jobs surface structured failure diagnostics (reason,
    per-item errors).
  - `scai publish cancel <jobId>` — cancel a single job, or
    `--all-queued` to sweep the env (gated by typed env-name
    confirmation).
  - `scai publish history` — JSONL-friendly reader for the local audit
    log (`~/.sitecoreai/audit.log`), with `--env --since --command
--outcome --limit` filters.

  **Companion content-state verbs (`scai content version *`):** inspect,
  set-validity (`__Valid from`/`__Valid to`), set-never-publish. These
  mutate CM-side fields that affect what `scai publish` picks up; living
  under `content` (not `publish`) since they're content mutations, not
  publish operations.

  **Auth model:** publishing requires an **environment-level** automation
  client (carries `xmcpub.jobs.t:r`, `xmcpub.jobs.t:w`, `xmcpub.queue:r`
  scopes), not the org-level client used by other scai surfaces. scai
  mints + caches the publishing-scoped JWT transparently via the
  keychain, with stale-cache fallthrough (re-mint when cached token's
  scopes drift or it's inside a 60s expiry safety margin).

  **Safety design (non-negotiable):**
  - `--what-if` default on every mutating verb.
  - 5-minute scope tokens bound over (envName, resolved tenant, item IDs,
    languages, target). Scope drift invalidates the token.
  - Production-tier envs gate writes behind `--confirm-token` from a
    prior dry-run. Non-prod accepts `[y/N]` or `--yes`.
  - Append-only audit log at `~/.sitecoreai/audit.log` with scope hash,
    scope token, jobId, outcome, and per-field before/after for content-
    state mutations.
  - Whole-environment `publish all` is treated as max-risk regardless of
    prod flag — typed env-name confirmation required.
  - MCP surface: read-only `publish_inspect` (status/list-running/history)
    and cancel-only `publish_lifecycle`. Submission verbs are
    intentionally CLI-only — the consent token model requires a
    human-driven dry-run that the agent cannot synthesize.

  **Auto-resolve defaults:** locale flags are mutually exclusive
  (`--languages`, `--languages-from-site`, `--all-tenant-languages`).
  When none is set, scai auto-resolves tenant-wide languages and logs
  the resolved set ("auto-resolved tenant-wide; pass --languages to
  override"). The Publishing API has no implicit default — empirically
  verified.

  **Naming note documented inline:** the API field `xmc.site.mode` is
  whole-_environment_, not whole-_site_ (legacy XM terminology from when
  one Sitecore instance == one site == one DB). Empirically verified
  2026-05-14 — a Smart-mode `publish all` against a real env considered
  ~17K items across every site, with no API surface accepting a site
  identifier. To publish a single Sitecore site, use
  `scai publish item --site <name> --include-subitems`.

  See `docs/publish-walkthrough.md` for copy-pasteable runbooks,
  `docs/parity-with-devex.md` for the dotnet mapping + safety design
  rationale, and `docs/roadmap.md` for the open roadmap items.

- ce3af45: **`scai recipe push`: rollback compensating-op audit log on disk.**
  When an apply phase aborts (op error, plan-time error, or mid-flight
  cancel), the executor unwinds applied actions LIFO. Previously the
  only record of what rollback did or failed at lived in the
  in-memory `ExecutionFailedEvent.rollbackErrors` count, surfaced as a
  single warn line. Operators couldn't audit which items rollback
  failed on after the process exited — and "best-effort" failures leave
  zombie state on the tenant that you genuinely need to chase.

  Every `recipe push` invocation now generates a `runId` and (lazily)
  writes a JSONL file at:

  ```
  ~/.sitecoreai/rollback/<runId>.jsonl
  ```

  Override the directory via `SITECOREAI_ROLLBACK_LOG_DIR`. The file is
  only created on first append, so successful pushes leave nothing
  behind. Each line is `{ v, ts, runId, kind, recipe, … }`:
  - One `step` line per compensating op with `status` (`success` /
    `skip` / `failed`), `inverse` (`deleteItem` / `updateItem`), the
    captured `itemId` (so you can replay the rollback manually), and
    `error` / `reason` when applicable.
  - One `summary` line per recipe with the `trigger`
    (`apply-error` / `plan-error` / `cancelled`), `rolledBack` count,
    `errorCount`, and the upstream `forwardError`.

  Error and reason fields run through `redactSecrets` before write.

  The log path surfaces in two places:
  - **Human mode:** a `logger.warn` line after the push completes,
    printed only when at least one line was written.
  - **`--json` mode:** a new optional `rollbackLog: { runId, path }`
    field on the top-level envelope, omitted entirely when unused.

  Schema version pinned at `v: 1` for future tooling that wants to
  parse the log.

- cc694d0: **Recipe sandbox: OS-level confinement via Node's permission model.**

  The recipe sandbox isolated `.recipe.ts` execution in a child process with a
  clean environment and a timeout. This change adds real OS-level confinement
  on top, by restructuring how the child runs.

  The child no longer compiles TypeScript. `.recipe.ts` is transpiled to a
  self-contained CommonJS bundle in the trusted parent (via esbuild —
  transpiling is not executing); the child runs only that plain JS. Because
  the child needs no TypeScript toolchain, it is spawned under Node's
  permission model with **no worker threads, no `child_process`, no filesystem
  writes**, and filesystem reads scoped to the bundle. A hostile recipe can no
  longer delete or corrupt files, spawn processes, or escape via a worker.

  (The earlier in-child tsx approach could not be confined: tsx's transform
  needs a worker thread, and `--allow-worker` is the grant Node itself warns
  "could invalidate the permission model". Moving the compile to the parent
  removes that need.)

  `esbuild` is now a direct dependency. `SITECOREAI_RECIPE_SANDBOX=0` still
  forces the legacy in-process load. See docs/recipe-sandbox.md.

- ed67a67: **Recipe execution sandbox (Phase 4).**

  `.recipe.ts` files were compiled and `require()`d inside scai's own process —
  so loading a recipe ran arbitrary TypeScript with scai's full privileges
  (filesystem, `process.env`, the OS keychain, the network). A weaponized
  config that redirects the `recipes` glob could exploit that just by getting
  scai to list or compile recipes.

  `.recipe.ts` now loads in a confined child process:
  - a **clean allowlisted environment** — no scai tokens or secrets, so a
    hostile recipe has nothing to read or exfiltrate;
  - a **timeout** — a recipe that hangs is killed, not allowed to hang scai;
  - **crash isolation** — a recipe that throws or calls `process.exit` no
    longer takes scai down.

  Only the exported recipe — pure JSON-serialisable data, re-validated against
  the Zod schema — crosses back. `.recipe.json` is unaffected (no code runs).

  `SITECOREAI_RECIPE_SANDBOX=0` forces the legacy in-process load (with a
  warning) for debugging. OS-level filesystem/process confinement via Node's
  permission model is a noted hardening follow-up. See docs/recipe-sandbox.md.

- 5e0a415: **Recipes graduate.** Declarative Sitecore template + rendering definitions,
  authored as TypeScript files alongside React components and pushed to the CMS
  via the Authoring GraphQL API. The `scai recipe compile|plan|push|diff`
  subcommand and the `@sitecoreai-labs/sitecoreai-cli/recipe` subpath export
  are now public surface.

  **Five recipe kinds are stable for 0.1.0:**
  - `ComponentTemplateRecipe` — placeable component (datasource template +
    rendering item + Variants + DesignParameters)
  - `ContentTemplateRecipe` — content shape only (template + fields),
    used as a Treelist source or `insertOptions` child
  - `ComponentSectionRecipe` — reusable field section shared between components
  - `DesignParametersTemplateRecipe` — reusable rendering-parameters template
  - `EnumerationRecipe` — Droplink-backed reusable enum (e.g. ColorScheme)

  Composition kinds (`PartialDesign`, `PageDesign`, `SiteTemplate`,
  `SiteRecipe`, `ContentItem`) are present in the source but not part of the
  0.1.0 stability promise — they'll graduate in a follow-up release.

  **Read-before-write executor.** Idempotent across re-pushes (second push
  is zero mutations). Best-effort LIFO rollback on partial failure,
  snapshot-driven inverse mutations, full event audit trail.

  **Deterministic GUIDs.** Every item GUID derived via `uuidv5` from the
  recipe `handle@<version>`. Pinned forever once pushed.

  **`.recipe.ts` files are executed code, not data.** Every `scai recipe`
  command (including `recipe diff` and `recipe push --what-if`) imports
  each matched `.recipe.ts` and runs its top-level code with full Node
  privileges — same trust model as `webpack.config.js` or `vite.config.ts`.
  Only run `scai recipe` against repos and recipe files you trust. See
  README §Recipes and `docs/recipes.md` for the full discussion.

  **Naming:** the rendering-parameter family uses `DesignParameter` /
  `DesignParameters` throughout (types, schemas, GUID helpers, compiler
  fn, kind discriminator `"design-parameters-template"`). The recipe
  author surface (the `params:` and `parameters:` keys on recipe
  definitions) is unchanged.

  **Security hardening from the 2026-05-13 audit** (also in this release):
  - Strict HTTPS-only authority/host URLs (`SITECOREAI_ALLOW_HTTP=1`
    escape hatch for dev)
  - OAuth discovery `token_endpoint` host-pinned to the operator-supplied
    authority hostname
  - 60s default request timeout on all transports (`SITECOREAI_REQUEST_TIMEOUT_MS`
    override)
  - Recipe GraphQL writes hard-disable retries — no silent duplicate
    mutations (writes fail fast; rollback handles partial state)
  - Recipe glob: symlinks not followed, paths must live under the
    config directory
  - Config upward walk bounded at the nearest `.git` or `package.json`
    (no silent pickup from arbitrary parent directories)
  - `scai logout` clears `clientSecret` from `sitecoreai.cli.json`
  - Redaction regex widened to catch camelCase `accessToken`,
    `refreshToken`, `clientSecret`, `client_id`, `password`
  - Telemetry endpoint moved off `*.vercel.app` to
    `cli-telemetry.sitecoreai.dev` (the project-owned DNS zone)
  - `keytar` replaced by `@napi-rs/keyring` (atom/node-keytar was
    archived since Dec 2022)
  - npm publish via OIDC Trusted Publishing (no long-lived `NPM_TOKEN`
    in CI)
  - GitHub Actions pinned to commit SHA (Dependabot keeps them current
    via the new `.github/dependabot.yml`)
  - All 24 prior Dependabot vulnerabilities cleared (ajv, yaml,
    picomatch, fast-uri, etc.)

  **Config:** new `recipes: string[]` field in `sitecoreai.cli.json`
  locates recipe files (default `recipes/**/*.recipe.ts`). `tsx`
  runtime dep loads `.recipe.ts` directly with no build step.

- e220b90: **`ai-skills` renamed to `brand` — the credential is named for what it powers.**

  The credential formerly called "AI Skills" backs exactly one thing: the
  `scai brand` command surface (Brand Management, Review, Documents,
  Pipeline). It is unrelated to Deploy, CM, Brief, and Campaign — those
  all ride the env automation client. So it is now `brand` throughout.
  - **Command:** `scai setup login ai-skills` → `scai setup login brand`.
    `ai-skills` (and `aiskills`, `ai-skill`, `aiskill`) stay as aliases,
    so existing invocations keep working.
  - **Config:** the `aiSkills` block in `sitecoreai.cli.json` is now
    `brand`. Existing configs stay readable — a legacy `aiSkills` block is
    still honored — and the CLI writes `brand` going forward. The JSON
    schema accepts both, with `aiSkills` marked deprecated.
  - **`setup status`** shows the credential row as `brand:` (was
    `ai skills:`).
  - **SDK exports renamed:** `acquireAiSkillsToken` → `acquireBrandToken`,
    `AiSkillsCredential` → `BrandCredential`, `AI_SKILLS_API_HOST` →
    `BRAND_API_HOST`, `AI_SKILLS_REQUIRED_SCOPES` → `BRAND_REQUIRED_SCOPES`,
    and the `AUTH_AI_SKILLS_REQUIRED` error code → `AUTH_BRAND_REQUIRED`.
  - **No re-login needed.** The OS-keychain storage keys were deliberately
    kept stable, so already-stored brand secrets and tokens still resolve.

  The underlying Sitecore key is still created in Cloud Portal under
  "Stream → Admin → AI APIs keys" — that is Sitecore's term, and the help
  text keeps it.

- e220b90: **New: `scai sync` — the cross-domain recipe aggregate.**

  `brand sync` and `ops brief sync` each pull/diff/push one instance at a
  time. `scai sync` fans them out: it enumerates _every_ brand kit and
  _every_ brief type on the environment and operates on them all.
  - `scai sync pull` — capture every kit + type into a workspace
    (`.scai/sync/<kind>/<id>.yaml` by default; `--dir` to override).
  - `scai sync status` — diff every workspace recipe against the env.
  - `scai sync push` — converge them all (dry-run unless `--allow-write`).

  A domain that isn't configured for the environment (missing
  credential) is skipped with a warning, not fatal — the others still
  run.

  The recipe/sync engine's `RecipeKind` contract gained an optional
  `list(ctx)` method; `brand-kit` and `brief-type` implement it. Kinds
  without `list` (file-authored component/page/site recipes) are simply
  not part of the aggregate and stay with `provision recipe`.

- 0b43252: **0.1.0 release hardening — SDK surface, module boundaries, and security.**

  **SDK subpath exports restructured.** The published `exports` map now
  separates a stable core from an explicitly unstable namespace:
  - Unstable areas moved behind `./unstable/*` (no SemVer stability
    promise): `./agents` → `./unstable/agents`, `./campaigns` →
    `./unstable/campaigns`, `./scripting` → `./unstable/scripting`. These
    are reverse-engineered or not-yet-settled surfaces; they graduate to
    stable entries in a later release.
  - Recipe **composition kinds** (`ContentItem`, `PageDesign`,
    `PartialDesign`, `SiteRecipe`, `SiteTemplate` — schemas, types, and
    compilers) moved off `./recipe` to a new `./recipe/unstable` entry,
    matching the recipes-graduation promise that they are not part of the
    0.1.0 stability contract. The five stable recipe kinds and all shared
    recipe infrastructure stay on `./recipe`.
  - New `./envelope` entry exports the canonical `ScaiEnvelope` type so
    SDK consumers can type `--json` output.
  - `deploy` and `serialization` index files now enumerate their
    `./context` exports explicitly instead of `export *`.

  **Migration:** `import … from "@sitecoreai-labs/sitecoreai-cli/agents"` →
  `/unstable/agents` (likewise `campaigns`, `scripting`); recipe
  composition-kind imports move from `/recipe` to `/recipe/unstable`.

  **Module boundaries.** Two circular dependencies were removed so
  `src/shared/` is a true leaf again: `allow-write` and `env` moved out of
  `shared/` into `policy/` (`policy/allow-write.ts`,
  `policy/environment.ts`), and the shared `audit` / `consent` /
  `env-tier` modules moved from `publishing/` into `shared/`. A new
  `tests/unit/architecture/module-boundaries.test.ts` enforces that
  `shared/` imports no domain area and that `content/` never imports
  `publishing/`.

  **Security.** `normalizeHostUrl` (the Sitecore GraphQL transport) now
  rejects non-`https://` hosts — closing a gap where an explicitly
  configured `http://` host could send Bearer tokens in cleartext
  (`SITECOREAI_ALLOW_HTTP=1` remains the documented dev escape hatch). A
  `fast-uri` override (`>=3.1.2`) clears the last runtime `audit`
  advisories (host confusion via percent-encoded authority delimiters).

  **Packaging.** `declarationMap` is off for the publish build — the
  `.d.ts.map` files pointed at unpublished `src/` and only bloated the
  tarball.

- ce3af45: **SDK usability pass — package root, subpath coverage, client seams, stability contract.**

  Five changes that take scai from "internally-usable library buried under
  a CLI binary" to "explicit SDK with a public contract."

  ### 1. Package root no longer executes the CLI

  `package.json` `main` was `dist/cli.js`, which has a `#!/usr/bin/env node`
  shebang and runs commander on require. Any consumer doing
  `import "@sitecoreai-labs/sitecoreai-cli"` (no subpath) would execute the
  CLI.

  The `main` and `types` fields are removed and the `exports` map has no
  `"."` entry. Importing the package root now fails cleanly with
  `ERR_PACKAGE_PATH_NOT_EXPORTED` instead of running the CLI. SDK consumers
  import from subpaths; see "Using as a library" in the README.

  The CLI binary is still on `bin` and unchanged.

  ### 2. Four new subpath exports

  The following surfaces are now in `package.json#exports` with their own
  public `index.ts` (curated, with a stability-contract docstring):
  - `./sites` — XM Cloud Sites API client (sites, collections, languages,
    jobs, templates)
  - `./publishing` — XM Cloud Publishing API client + `PublishConsent`
    scope-token primitives + audit-log primitives + `isProductionTier`
  - `./hygiene` — audit/cleanup task runners, `HygieneApiClient` factory,
    output adapters (JSON / CSV / Markdown), baseline + history snapshots,
    field cache
  - `./webhooks` and `./workflow` — already had internal `index.ts`; now
    wired through the package's `exports` map

  ### 3. Client seams on `./deploy` and `./serialization`

  `./recipe` already shipped `createAuthoringClient` and `createSitesApiClient`
  factories. The other two surfaces only had bag-of-functions; the
  factories below close the shape gap:
  - `createDeployApiClient(options: DeployApiClientOptions): DeployApiClient` —
    curated 80%-use-case subset (~25 methods: orgs / projects /
    environments / deployments / logs / source control). The long-tail
    60+ functions remain exported for direct use.
  - `createSitecoreApiClient(options: SitecoreApiClientOptions): SitecoreApiClient` —
    full options-bound facade over items / history / roles / users /
    publish (12 methods).

  These are options-binding adapters, not behavioral wrappers — the
  behavioral seam (path resolution, parent-folder auto-create, retries)
  remains in `createAuthoringClient`.

  ### 4. "Using as a library" README section

  New section between MCP and "Going deeper" with one minimal example per
  subpath, namespace-import alternative, and the explicit 0.1.0 stability
  contract: symbols re-exported from each subpath's `index.ts` are the
  public contract; anything reachable only via `@/...` aliases is internal
  and may change without notice.

  ### 5. Stability contract at 0.1.0

  This release graduates the SDK surface. Breaking changes to exported
  symbols now require a major version bump (per Changesets). New symbols
  remain additive and ship in minor versions.

- e220b90: **Command tree: `setup client` consolidation and `brand` verb hoisting.**
  - **`setup env` + `setup clients` → `setup client {create,list,delete}`.**
    Those two commands were the create side and the manage side of the
    same object — an environment's CM automation client — but the names
    never said so. They are now one `setup client` noun:
    `create <env>` (was `setup env <env>`), `list [env]` and
    `delete <id> [env]` (were `setup clients` / `setup clients --delete`).
    The old commands are removed — no aliases (pre-release).
  - **`brand pipeline ingest|enrich` → `brand ingest` / `brand enrich`.**
    The `pipeline` parent added a word that said nothing about
    ingest-vs-enrich; the two verbs are now top-level under `brand`.
    `brand seed` still orchestrates the full happy-path flow.

- e220b90: **`scai setup` is less confusing — login and init flags.**
  - **`--non-interactive` removed from `setup login` and `setup login
ai-skills`.** It was bulk-inherited from the shared verbosity options
    but never made sense there: interactive login is a browser device
    flow that cannot run headless, and the client-credentials path is
    already non-interactive once `--client-id`/`--client-secret` are
    given. `setup login --help` now explains the two auth modes
    (interactive vs. client credentials) directly.
  - **`setup init`: Deploy-API flags renamed to stop colliding with the
    profile flags.** `--organization` → `--deploy-organization` and
    `--environment` → `--deploy-environment`, so they no longer read as
    near-duplicates of `--organization-id` and `--environment-name` (two
    genuinely different things). The old spellings keep working as hidden
    aliases — existing scripts are unaffected. `setup init --help` now
    groups the flags (identify-the-environment / authentication /
    identifiers) instead of listing 19 flags flat.

- e220b90: **Telemetry is now opt-out (enabled by default).** Anonymous usage
  telemetry — command names and timings only, never code, arguments, or
  credentials — is on by default across the CLI and `scai mcp serve`.
  Previously it was opt-in: disabled until consent was recorded.
  - **First-run notice, not a prompt.** The interactive `(y/N)` consent
    prompt is replaced by a one-time notice on the first interactive run.
    It explains what's collected and how to opt out, then records the
    default in `settings.telemetryEnabled`.
  - **Opt out anytime.** New `scai cli telemetry disable` (and `enable`)
    subcommands write `settings.telemetryEnabled`. The env signals
    `SITECOREAI_TELEMETRY=false` and the cross-tool `DO_NOT_TRACK=1` still
    disable telemetry and always win over the config setting. The redundant
    `DISABLE_TELEMETRY` env var is removed — `SITECOREAI_TELEMETRY=false`
    replaces it.
  - **`scai mcp serve`:** the `--telemetry` flag is replaced by
    `--no-telemetry`. Telemetry is on for MCP sessions by default;
    `--no-telemetry` turns it off for the session.

  `DO_NOT_TRACK` is honored unchanged — only the "no explicit choice"
  case flips from disabled to enabled. See `docs/telemetry-and-privacy.md`.

- ce3af45: **New verb: `scai topics` — intent-based command index for discoverability.**

  The feedback agent's diagnosis: "I spent an hour reinventing `audit
references`, `audit template-dependencies`, `audit site-residue`,
  `cleanup subtree`, and `cleanup site-residue` — all of which exist."
  The audit and cleanup help lists are alphabetical and described
  one-line-per-command; if you don't already know the name of the
  primitive you need, finding it via `--help` is a guess-and-grep loop.

  `scai topics` is the curated index — commands grouped by _what
  you're trying to do_, not where they live in the tree:

  ```
  $ scai topics
  scai topics — intent-based command index

    diagnose-blocked-delete
      Find out why a Sitecore item won't delete — what references hold it.
    clean-orphan-content
      Delete the residue left after a Sites-API site delete or a subtree-removal mistake.
    manage-known-debt
      Accept known-good findings into a per-env baseline so CI only flags new regressions.
    deduplicate-content
      Find and merge items with identical content hashes.
    pipeline-audit-cleanup
      Compose an audit + its cleanup in one shell pipeline to avoid running the same scan twice.
    automate-with-agents
      Run scai from an MCP-compatible agent host (Claude Code, Cursor, Windsurf, …).

  Show one topic's commands: `scai cli topics show <name>`
  ```

  `scai cli topics list` and bare `scai cli topics` both print the index.
  `scai cli topics show <name>` expands one topic into its commands in
  recommended-run order:

  ```
  $ scai cli topics show diagnose-blocked-delete
  scai cli topics: diagnose-blocked-delete
    Find out why a Sitecore item won't delete — what references hold it.

    scai explain why-blocked <itemId>
      One-shot: run audit references + audit template-dependencies and merge the findings, sorted by kind

    scai audit references --to <itemId>
      Walk content fields for items whose value mentions the target (slow but broad)

    scai audit template-dependencies --template-id <itemId>
      Index-driven check for the five structural reference shapes (base-template, insert-options, …)
  ```

  `--json` returns the same data as a canonical `ScaiEnvelope` for
  agent consumption.

  The topic list is **curated** — `src/commands/topics/index.ts`
  hand-edits the groupings to reflect workflows ("why won't this
  delete?"), not the directory layout. Cost: keeping the list in sync
  when commands move. Payoff: a single entry point that catches
  operators (and agents) before they reinvent a primitive that already
  exists.

  6 unit tests in `tests/unit/commands/topics.test.ts` lock slug
  uniqueness, non-empty descriptions, and the presence of the three
  topics most directly tied to the agent feedback (diagnose-blocked-
  delete, manage-known-debt, pipeline-audit-cleanup).

- ce3af45: **Two-environment `scai serialization diff` — shipped.** Closes parity
  with dotnet `sitecore ser diff --source A --destination B [--push]`.
  - New flag aliases: `--source-env` / `--target-env` (alias to existing
    `--source` / `--destination`) to match the dotnet naming.
  - New diff flags: `--what-if` (build the push plan, don't write),
    `--allow-write` (per-invocation override of the env's `allowWrite`),
    `--force` (skip the empty-source confirmation guard).
  - Empty-source push guard: when `--push` would recycle every item in
    the destination because the source has zero items, the diff prompts
    for confirmation (or refuses, in non-TTY mode, without `--force`).
  - Augmented `--json` output: includes `mode`
    (`local-vs-instance` | `instance-vs-instance`), a top-level `whatIf`
    flag, and per-database `whatIf` flag. With `--verbose`, each database
    carries a `changes` block listing the create / update / recycle /
    move / rename entries.

  **Performance refactor (also benefits `ser pull`, `ser push`, `ser package`):**
  - Source and destination metadata fetches now run in parallel.
  - Per-subtree metadata fetches within an environment now run with
    bounded concurrency.
  - On `--push`, source and destination item-body collection
    (`collectItemData`) runs in parallel.
  - The per-item `fetchItemData` fanout inside `collectItemData` is now
    bounded-concurrent — the largest wall-clock improvement for trees
    with many items. For 1000 items at ~100 ms/round-trip, the
    sequential path was ~100 s; with the default concurrency of 8 it's
    ~12.5 s. Same speedup applies to every consumer of `collectItemData`
    (`ser pull`, `ser push`, `ser package`, and the existing
    local-vs-remote diff path).
  - Concurrency is bounded by `SITECOREAI_HTTP_CONCURRENCY` (default 8)
    to avoid hitting tenant rate limits or exhausting sockets.

- 80c3b1a: **`brand`, `brief`, and `sites` move to the unstable surface.** All three
  are reverse-engineered from observed traffic and not yet settled enough to
  carry the 0.1.0 SemVer stability promise, so they join `agents` and
  `campaigns` under the `./unstable/` namespace.

  **Breaking — SDK subpath exports renamed:**
  - `@sitecoreai-labs/sitecoreai-cli/brand` → `.../unstable/brand`
  - `@sitecoreai-labs/sitecoreai-cli/brief` → `.../unstable/brief`
  - `@sitecoreai-labs/sitecoreai-cli/sites` → `.../unstable/sites`

  The old subpaths are removed, not aliased — update imports. The exported
  symbols and their behavior are unchanged; only the import path moves. The
  recipe planner's pinned subset of the Sites API (reached via
  `createSitesApiClient` on the stable `./recipe` entry) is unaffected.

  **CLI:** `scai brand`, `scai ops brief`, `scai ops campaign`, and
  `scai agents` are now flagged as unstable surfaces. Each carries an
  `[unstable]` tag in `--help`, appends a stability note, and prints a
  one-line stderr warning on every invocation — reverse-engineered, no
  SemVer stability promise.

  **MCP:** the brand / brief / campaign / agents tool descriptions lead with
  an `[unstable]` tag so an agent sees the stability signal before selecting
  the tool.

  The stable SDK core is now `./recipe`, `./deploy`, `./serialization`,
  `./errors`, `./envelope`, `./config`, `./publishing`, `./content`,
  `./hygiene`, `./webhooks`, `./workflow`, and `./sync`.

- ce3af45: **Webhook event-type discovery: new CLI subcommand + MCP verb.**
  Until now, agents (and humans) authoring webhooks had to guess the
  right strings for `webhook create --events <name>`. Typos like
  `item:saevd` only surfaced at create-time as a generic
  `INPUT_INVALID: Unknown webhook event type` error. The catalog
  isn't a Sitecore-published contract — it lives in the tenant's
  content tree under `/sitecore/system/Settings/Webhooks/Event Types/`
  and customers can extend it — so a static enum in the SDK would be
  both stale and wrong for customized tenants.

  This release adds a discovery surface:

  **CLI:**

  ```sh
  $ scai webhook event-types
  $ scai webhook event-types --category item
  $ scai webhook event-types --category publish --json
  ```

  **MCP:** `webhook_inspect` gains a third verb:

  ```
  { "verb": "event-types", "category"?: "item" | "publish" }
  ```

  Returns one entry per catalog item: `{ name, itemId, category, path }`.
  Walks the Item and Publish roots; a missing root yields an empty list
  rather than an error. Picks up custom event types operators have
  added to their tenant.

  **API:** `WebhookApiClient.listEventTypes()` is the underlying method —
  useful if you're embedding scai's webhook surface in another tool.

  Pair with `webhook_manage verb=create` so agents inspect-then-create
  rather than guess-then-fail. Recommended discovery pattern in the
  updated `webhook_inspect` tool description.

### Patch Changes

- e220b90: **Hygiene help cleanup + `dead-templates` auto-retry; `provision` IAR note.**
  - `hygiene cleanup --help` and `hygiene audit --help` dropped the
    "Database scope" notes (they restated XM Cloud basics without
    helping). `cleanup --help` cut its example block from 18 lines to 5;
    `audit --help` now groups its ~30 subcommands by theme (Links &
    references, Media & assets, Templates & layout, …) instead of one
    flat wall.
  - `hygiene cleanup dead-templates purge` now **auto-retries** the
    Authoring API's post-cascade-delete template-cache lag. The pre-flight
    already filters real structural dependents, so a "has dependents"
    error after that is the stale cache — the purge retries past the
    ~30-90s settle window instead of making the operator re-run by hand.
  - `provision --help` notes that `scai provision iar` (package content
    as Items-as-Resources) is planned but not yet shipped.

- e220b90: **`--config` help no longer prints an absolute path.** The shared
  `--config` option defaulted to `process.cwd()`, and Commander bakes the
  _resolved_ value into `--help` — so every command showed
  `(default: "/Users/.../wherever-it-ran")`, machine-specific noise.
  It now shows `(default: current directory)`. The runtime value is
  unchanged. Applies to all commands that take `--config`, plus
  `scai mcp serve`.
- e220b90: **`scai cli history` no longer prints nothing on an empty log.** When
  the history log file existed but was empty, the command produced zero
  output and exited 0 — indistinguishable from a broken command. It now
  prints `No CLI history recorded yet — log file: <path>`.

  A missing log file is treated the same as an empty one (previously a
  `WARN`, now the same empty-state message), and `--json` emits `[]`
  instead of nothing when there are no entries.

- ce3af45: **MCP startup: defer keychain access until the first tool call.**

  Some MCP hosts showed `scai mcp serve` stuck in "still connecting" and
  never registered the tool list. The root cause was a startup-order
  race: the handler awaited `bindMcpEnvironment` — which reads the deploy
  token from the OS keychain — **before** calling
  `server.connect(transport)`. On macOS a locked keychain can prompt the
  user to unlock (multi-second pause), so the JSON-RPC `initialize`
  request sat in the stdin buffer past the client's init timeout.

  The serve handler now resolves the config synchronously at startup
  (still fails fast on bad config or unknown env), then connects the
  stdio transport before any keychain access. The deploy token is fetched
  lazily by a memoized `McpContextProvider` on the first tool / resource
  / prompt invocation; concurrent first callers share the in-flight
  promise so the keychain prompt surfaces once, not per-call. Failures
  are not cached, so a tool call retries after the operator unlocks the
  keychain or runs `scai login`.

  Tool handler signatures and the `McpContext` shape are unchanged. Only
  `buildMcpServer` swaps its `context` option for `getContext:
McpContextProvider`; `bindMcpEnvironment` stays available as a
  convenience that combines resolve + token fetch.

- ce3af45: **MCP — adds two Sitecore API docs resources.** Brings the MCP server's
  resource count from 5 to 7:
  - `scai://help/sitecore-apis` — curated markdown index of the Sitecore
    REST + GraphQL APIs scai's library wraps (XM Cloud Deploy API,
    Authoring & Management GraphQL, Sites API, SAI Publishing API), with
    deep links into api-docs.sitecore.com and per-API tool mappings.
  - `https://api-docs.sitecore.com/` — companion external URI for clients
    that resolve `https://` resource URIs natively. The handler returns
    a one-line pointer; the actual fetch happens client-side.

  Both surfaced via `scai_overview`'s `resourceUris` snapshot and the
  overview resource's listing.

- e220b90: **`scai mcp tools list --names` — name-only listing.** The tools
  inspector gained a `--names` flag that prints just the registered tool
  names, one per line, with no auth class or description. Pipes and greps
  cleanly. Combined with `--json` it emits `{ "tools": ["name", ...] }`.
  The default TSV output (`name⇥[auth]⇥description`) is unchanged.

## 0.0.4

### Patch Changes

- 92cd29a: **Package renamed**: `@sitecoreai-demo/sitecoreai-deploy-and-sync` → `@sitecoreai-labs/sitecoreai-cli`. Repo now lives at `github.com/Sitecore-Studio-Labs/sitecoreai-cli`. The long-form CLI alias `sitecoreai-deploy-sync` is replaced by `sitecoreai-cli`; the primary `scai` command is unchanged.
  - `scai deploy site list` — list SXA sites in a CM environment via the Authoring API.
  - Discovery now recognizes XM Cloud Headless Tenant and Headless Site templates.
  - Default OAuth audience for client credentials is now `api.sitecorecloud.io`.
  - `scai deploy site bind` no longer polls the rendering host — faster, fewer retries (no behavior change for users).
  - Internal: audit-driven cleanup of structure and error contract.
  - Internal: `pnpm test` is now gated on `pnpm typecheck` via a pretest hook.

## 0.0.3

### Patch Changes

- Adjusting start up process to more cleaning login and manage environments. Some small logical errors with client credential configuration

## 0.0.2

### Patch Changes

- Improve CLI onboarding, deploy error reporting, and auth handling.

## 0.0.1

### Patch Changes

- Fix cross-platform smoke test execution, update deploy logs to use the monitoring API base, and improve CI/release workflow defaults.
- Improve test coverage for deploy and serialization flows.
