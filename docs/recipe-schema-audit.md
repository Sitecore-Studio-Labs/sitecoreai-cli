# Recipe Schema Audit (2026-05-26)

Structural audit of every recipe kind across scai and the registry's
working-copy schema, scoped to surface (a) constraints expressed only as
`.refine()` predicates or TSDoc prose, (b) parallel-but-related optional
fields where a discriminated union would express intent more cleanly,
and (c) format-typed strings the schema doesn't constrain.

Driver: registry now emits per-kind JSON Schemas from the Zod source for
Agent Studio consumption (`registry/src/registry-content/schemas/`).
JSON Schema can't carry `.refine()` predicates or cross-document
constraints, so anywhere the author surface relies on them, Agent Studio
can emit invalid recipes that pass schema validation and fail at scai's
compile/seed time. The audit identifies which of those gaps are worth
closing by reshaping the schema, vs. which are intentional looseness
that should stay.

## Scope

| Repo     | File                                   | Kinds owned                                                                                                                                                                                                                                  |
| -------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| scai     | `src/recipe/schema/recipe.ts`          | placeholder, component-section, component-template, content-template, design-parameters-template, section-definition, enumeration, content-item, page-template, page, partial-design, page-design, site-template, site, webhook-\*, workflow |
| scai     | `src/brand/recipe/schema.ts`           | brandkit                                                                                                                                                                                                                                     |
| scai     | `src/brief/recipe/schema.ts`           | brief-type                                                                                                                                                                                                                                   |
| scai     | `src/campaigns/recipe/schema.ts`       | campaign                                                                                                                                                                                                                                     |
| registry | `src/lib/registry/sitecore-recipes.ts` | working copy of: component-section, component-template, content-template, parameters-template, section-definition, enumeration, page-item-template, page-item, brandkit, brief-type, brief, campaign, story (13 kinds)                       |

scai is canonical. The registry copy is documented as temporary; once
scai publishes a typed recipe export the registry will import it. That
makes scai the right place to land structural changes first, with the
registry copy mirroring after.

## Findings, by tier

### Tier A — Structural smells worth restructuring

**A1. `SitecoreFieldAugment.source*`** _(scai + registry)_

Four parallel optional fields — `sourceTypes`, `sourceQuery`,
`sourceScope`, `sourceRaw` — with a `.refine()` enforcing `sourceRaw`
is mutually exclusive with the structured trio. JSON Schema can't
express the predicate, so an Agent Studio agent can emit both
`sourceRaw` and `sourceTypes` and the schema won't push back.

Current call sites use only `sourceTypes` (7 registry recipes; scai
recipes follow the same shape). `sourceRaw` is a documented escape
hatch.

**Proposed shape**

```ts
source?:
  | {
      kind: "filter";
      types?: HandleString[];   // picker filter
      query?: string;           // Sitecore Query
      scope?: string;           // fixed content path
    }
  | { kind: "raw"; value: string }; // verbatim Source string
```

The "filter" branch keeps the structured trio composable (their
combinations preserve real Sitecore Source semantics — see
`src/recipe/schema/source-fields.ts`). The "raw" branch is the
escape hatch. JSON Schema's `oneOf` covers the mutex.

**Compiler impact**: `renderSourceFields` reshapes from a flat
`SourceFields` interface to switch on `source.kind`. Same outputs,
cleaner inputs.

---

**A2. `ComponentTemplateRecipe.parameters` (ref) vs `params` (inline)** _(scai + registry)_

A component can today declare BOTH a `parameters: { handle }` ref to
a `ParametersTemplateRecipe` AND an inline `params: ParamDefinition[]`.
TSDoc says the compiler synthesises an anonymous parameters template
from `params` only when `parameters` is absent. Setting both is
ambiguous; the compiler picks one without complaint.

**Proposed shape**

```ts
parameters?:
  | { kind: "ref"; handle: HandleString }
  | { kind: "inline"; params: ParamDefinition[] };
```

Forces the author to choose. Inline becomes named, which also makes
the spec read more clearly.

---

**A3. Server enums typed as `z.string()`** _(scai + registry)_

`CampaignTask.status`, `CampaignTask.priority`, `CampaignDeliverable.status`,
`CampaignDeliverable.funnelStage`, `CampaignRecipe.status` — all wire
enums on the Orchestrate server, all typed as plain strings with the
enum values documented only in TSDoc.

**Proposed shape**: pull the enum values out of scai's
`src/campaigns/api/schema.ts` (where they likely already exist on the
wire-shape schemas) and reuse via `z.enum([...])`. Same on the
registry side.

Agent Studio benefit: the LLM stops emitting `"In Progress"` /
`"in-progress"` / `"InProgress"` variants and converges on the
canonical wire value.

### Tier B — Format tightening (non-breaking)

**B1. ISO-8601 dates typed as bare `z.string()`** _(scai + registry)_

`CampaignTask.dueDate`, `CampaignDeliverable.dueDate`,
`CampaignRecipe.startDate/dueDate`, `StoryGenerated.generatedAt`.

**Fix**: `z.string().datetime()` for full ISO-8601 timestamps; or
`z.string().regex(/^\d{4}-\d{2}-\d{2}(...)/)` for date-only fields.
Pure addition — no migration needed.

---

**B2. ISO-4217 currencies** _(scai + registry — `BriefTypeRecipe` Budget field)_

`currencies: z.array(z.string())` accepts arbitrary strings.

**Fix**: `z.array(z.string().length(3).regex(/^[A-Z]{3}$/))` —
3-letter uppercase ISO-4217 code.

---

**B3. `BriefRecipe.briefType` as untyped string** _(scai + registry)_

References a `BriefTypeRecipe.name` (PascalCase codename, e.g.
`CreativeBrief`). Currently typed as `z.string().min(1)`.

**Fix**: apply the same `/^[A-Za-z][A-Za-z0-9_]*$/` pattern used on
the type-side `name`.

### Tier C — Schema lies (says one thing, runtime does another)

**C1. `EnumerationRecipe.location.scope: "siteCollection"`** _(registry — scai TBD)_

Schema accepts the literal; compiler throws `INPUT_INVALID` because
the path isn't implemented.

**Fix**: drop `"siteCollection"` from the enum until it's actually
supported. Add back when ready.

---

**C2. `ComponentTemplateRecipe.otherProperties` overlap** _(scai + registry)_

The `otherProperties: Record<string, string>` escape hatch can hold
keys that have first-class typed shortcuts elsewhere on the recipe:

- `IsAutoDatasourceRendering` ↔ `datasource.autoCreate`
- `IsRenderingsWithDynamicPlaceholders` ↔ `dynamicPlaceholders`

TSDoc says explicit `otherProperties` keys override the shortcut.
Real risk: an LLM emits both and the override silently wins.

**Fix options**: (a) type-narrow `otherProperties` to exclude the
reserved keys; (b) add a `.refine()` warning when both are set; (c)
move the reserved keys into a named sub-object so the schema makes
the overlap visible.

### Tier D — Minor structural inconsistencies

**D1. `ParametersTemplateRecipe.section: string` vs `ComponentTemplateRecipe.section: { handle }`** _(scai + registry)_

Same intent — point at a `ComponentSectionRecipe`. Different shape.

**Fix**: make `ParametersTemplateRecipe.section` a `{ handle: HandleString }`
ref to match.

---

**D2. `EnumerationRecipe.location.folder` as slash-separated string** _(registry)_

`folder: "Theme/Color"` splits on `/` internally; an array
`folder: ["Theme", "Color"]` would make the multi-segment structure
explicit.

---

**D3. `PageItemRecipe.itemPath` `{site}` placeholder** _(scai + registry)_

Free string with implicit template syntax (`/sitecore/content/{site}/Home/...`).

**Fix candidates**: split into `{ siteSubpath: string }` (no
placeholder needed — `{site}` is implied), or use a structured token
array. The former is simpler; the latter is more flexible if more
placeholders appear.

### Tier E — Won't fix (intentional looseness)

- `BriefRecipe.fields`, `PageItemRecipe.fields`,
  `PageItemDatasource.inline.fields` — `Record<string, unknown>`
  validated at seed time against external state.
- `BrandkitRecipe.sections` keys — `Record<string, ...>` so authors
  can extend; canonical names live in `BRAND_KIT_CANONICAL_SECTIONS`
  as documentation.
- `BrandFieldValue` (`string | string[] | BrandRichEntry[]`) — chosen
  at runtime based on the live kit's field type.

## Cross-reference constraints

These are real constraints but can't move into the schema (cross-
document, not cross-field). They stay in scai's validator:

- `EnumerationRecipe.default` ∈ `values[].name`
- `BriefRecipe.briefType` matches a deployed `BriefTypeRecipe.name`
- `BriefRecipe.fields[<x>]` shape matches the referenced type's
  field type
- Component `section.handle` resolves to a `ComponentSectionRecipe`
  in the same set
- `availableIn` handles resolve to a `SectionDefinitionRecipe`

## Sequencing

Recommended order:

1. Tier A in scai (three PRs, one per restructure). Bump
   `schemaVersion` on any recipe whose author surface changes.
2. Mirror Tier A into `registry/src/lib/registry/sitecore-recipes.ts`;
   migrate the 7 registry call sites; regenerate the JSON Schemas.
3. Tier B in both repos (no migration needed; pure pattern
   tightening).
4. Tier C/D as independent follow-ups.

Until step 1 lands, the registry schemas carry the same structural
gaps as today.

## Status — 2026-05-26 first pass

What landed on `agent/recipe-schema-audit`:

- **B1**: ISO-8601 `Iso8601` schema shared across `CampaignRecipe`,
  `CampaignDeliverable`, `CampaignTask` date fields (+ rejection
  tests).
- **B2**: `BudgetFieldSchema.currencies` items now require a 3-letter
  uppercase ISO-4217 pattern (+ rejection tests).
- **C2**: `ComponentTemplateRecipeSchema.otherProperties` carries an
  explicit `.describe()` that calls out which keys are reserved for
  the typed shortcuts (`IsAutoDatasourceRendering`,
  `IsRenderingsWithDynamicPlaceholders`). Stayed light-touch — a
  refine would break the documented escape-hatch case where authors
  intentionally override a typed default.
- **A2**: `ComponentTemplateRecipeSchema` carries a `.refine()` that
  rejects setting both `parameters` (external template ref) AND
  inline `params` on the same recipe. Doesn't translate to JSON
  Schema (refines never do), but closes the parse-time gap.
  Full discriminated-union restructure deferred to A2-v2 (would
  require moving `params` inside the union, ripples through ~7
  compiler call sites + tests).
- **D1**: `DesignParametersTemplateRecipeSchema.section` is now
  `{ handle: HandleString }` instead of a bare-string section name —
  matches `ComponentTemplateRecipeSchema.section` shape. Compiler
  resolves the handle via `resolveSectionRecipe` like
  component-template already does. Cross-recipe lookup fails at
  compile time (`INPUT_INVALID`) if the section handle doesn't
  resolve.

What stayed deferred to follow-up branches:

- **A1** (resolved 2026-05-26): landed as a discriminated union
  `source: { kind: "filter" | "raw", ... }` on
  `SitecoreFieldAugmentSchema`. The four-peer `sourceTypes` /
  `sourceQuery` / `sourceScope` / `sourceRaw` legacy keys are
  rejected loudly at parse time via `.passthrough()` +
  `.superRefine` with a migration pointer (so unmigrated recipes
  fail visibly rather than silently losing their picker scope to
  Zod's default `.strip()`).
  Internal compiler is unchanged — a new `augmentSourceToFields()`
  adapter in `recipe/schema/source-fields.ts` flattens the union
  for `renderSourceFields()` and the `ref-source-fields` IR op,
  both of which keep their flat shape (they're internal wire,
  never author surface). `compile/shared.ts` + `validate.ts` use
  the adapter / new walk shape; `items/read-current.ts` emits
  `source: { kind: "raw", value }` on `recipe pull`. JSON Schema
  now expresses the mutex structurally via `oneOf`.
- **A3** (resolved 2026-05-26): landed as
  `z.union([z.enum(KNOWN_*), z.string()])` for `status` and
  `funnelStage`, with shared `KNOWN_CAMPAIGN_STATUSES` /
  `KNOWN_CAMPAIGN_FUNNEL_STAGES` constants exported from
  `src/campaigns/recipe/schema.ts` (and mirrored in the registry).
  JSON Schema renders as `anyOf: [{ enum: [...] }, { type: "string" }]`,
  which gives Agent Studio the observed values as a strong hint
  without rejecting future server-side enum additions or
  `recipe pull` round-trips. `Task.priority` stays plain `z.string()`
  until any priority values are observed in capture.
- **D3** (`PageItemRecipe.itemPath` placeholder): N/A to scai —
  scai has no `PageItemRecipe`. Registry-only; carried over to
  the registry follow-up.
- **C2-v2** (structural type-narrowing of `otherProperties`
  reserved keys): superseded by the light-touch description fix
  above for now.
