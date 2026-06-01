# Recipe / Sync architecture

**Status:** implemented — `src/sync/` engine plus four kinds:
`brand-kit`, `brief-type`, `campaign`, and `recipe` (the Sitecore-item
compiler). The first three have CLI `sync` verbs + `*_recipe_*` MCP
tools. The `recipe` kind (`src/recipe/recipe-kind.ts`) implements the
contract — `plan`/`apply` wrap `compileRecipeSet`/`executeIr`;
`readCurrent` reverse-projects four item kinds (ComponentTemplate,
Enumeration, ComponentSection, ContentTemplate). Remaining: the
`Scai Handle` marker field (recipe identity — foundational, sequenced
first; see "Recipe identity" below); wire the `recipe` kind into the
CLI/MCP; reverse-projection for the other recipe kinds (PageDesign,
Site, …); component/page/site as CLI surfaces.
**Scope:** a unified declarative layer for every scai surface (Sitecore
items, brand kits, briefs, campaigns, and future component/page/site
areas), plus the engine that moves it.

## Why

scai grew several product surfaces — Brand (AI Skills), Brief (Content
Operations), Campaign (Orchestrate) — each with CLI + SDK + MCP coverage,
but **no declarative layer**. Meanwhile the existing `recipe` system
already does declarative-apply for Sitecore items, and `serialization`
already mirrors Sitecore items to disk as YAML.

The first instinct was a new `declarative` framework parallel to
`recipe`. That was wrong: "declarative" only names the _write_ side, and
that side already has a name. The reusable thing is not a new framework —
it is **one model and one engine** that every surface shares.

## The model: `recipe` (noun) + `sync` (verb)

- **recipe** — the _definition_. A clean, schema'd, validated description
  of a thing's desired state. Not raw GUID-heavy item YAML — a proper
  abstraction. Every surface is a _recipe kind_: `component`, `page`,
  `site`, `brand-kit`, `brief`, `campaign`.

- **sync** — the _engine_. Kind-agnostic. Moves recipes against live
  remote state in both directions:
  - `sync pull` — remote → recipe file (capture)
  - `sync push` — recipe file → remote (idempotent apply)
  - `sync diff` — the plan, no writes

`sync` is the recipe-native successor to `serialization`: same job
(mirror remote ↔ local), but the on-disk representation is a clean recipe
instead of verbose item YAML. `serialization` becomes the legacy path.

```
recipe   per-kind Zod schema          ── the model: ONE source of truth
   │
   ├─▶ sync   pull / push / diff       ── kind-agnostic transport
   ├─▶ CLI    scai <surface> …         ── projection of the schema
   └─▶ MCP    tools + resources        ── projection of the schema
```

## Recipe schema as the single source of truth

A recipe kind is **one Zod schema**. That schema feeds every surface:

- **sync** — defines what `pull` captures and what `push` applies.
- **CLI** — validates the recipe file; the field set drives the command.
- **MCP tool** — the Zod schema _is_ the tool's `inputSchema` (the MCP SDK
  consumes Zod directly); each `.describe()` becomes the parameter doc the
  model reads.
- **MCP resource** — "the current brand kit, as a recipe" is a natural
  read-resource: a clean, complete, model-legible description of live
  state — far better context than a raw API dump.

Write the recipe schema once; the MCP's understanding of that surface
comes for free and stays correct by construction. This is the reason to
invest in the schemas being genuinely good abstractions — they are not a
file format, they are the canonical description of each surface.

## The kind contract

```ts
interface RecipeKind<TRecipe> {
  name: string; // "brand-kit", "component", …
  schema: ZodType<TRecipe>; // validates files; feeds CLI + MCP

  readCurrent(ref, ctx): Promise<TRecipe | null>; // live remote → recipe
  plan(desired: TRecipe, ref, ctx): Promise<RecipePlan>; // compute the convergence plan
  apply(plan: RecipePlan, ref, ctx): Promise<ApplyResult>;
}
```

- `sync pull` = `readCurrent` → write file.
- `sync diff` = read file → validate → `plan`.
- `sync push` = `plan` → `apply` (consent-gated).

`plan` may do I/O. Simple kinds (brand-kit, brief-type, campaign)
implement it as `readCurrent` followed by a pure diff helper
(`diffBrandKit` etc.). The recipe (Sitecore-item) kind **cannot** use a
pure diff — its planner (`buildPlan`) reads remote state per-operation
because later ops resolve cross-references from earlier ops'
server-assigned itemIds. That mismatch is why `plan` (async, I/O-allowed)
replaced an earlier pure `diff` in the contract.

The engine, contract, plan types, and registry live in **`src/sync/`**.
Each kind lives in its domain (`src/brand/recipe/`, …). The existing
`src/recipe/` compiler becomes the Sitecore-item kind — its IR
(`CreateItemOp`/`SetFieldOp`/…) stays kind-internal, behind `apply`.

## Recipe identity — the marker field

A recipe-managed Sitecore item has no stable identity the recipe
controls. The Authoring API server-assigns itemIds on create — the
recipe cannot pin them — so the recipe's only identity hook is the
**path** (`<root>/<name>`). Path = location + name, and both are
editable by any CMS user. The consequences:

- Rename or move an item and the next `push` no longer finds it by
  path → it creates a duplicate; the moved item is orphaned.
- `readCurrent` has no stored handle to recover, so it _synthesises_
  one from the item name — a guess, not the author's handle.

**Decision: a marker field.** Every recipe-managed item carries its
recipe **handle** in a `Scai Handle` field. The handle — not the path —
is identity.

Chosen over **GUID-in-recipe** (the other candidate): a Sitecore GUID
is environment-specific (server-assigned, unpinnable), so a GUID-bearing
recipe binds to one environment; and GUID identity drags GUIDs into
content reference fields, making content recipes unreadable. The handle
is env-independent and human-readable — one recipe pushes cleanly to
dev / staging / prod, and content references stay as handles/paths.

**The field.** `Scai Handle` — a single shared string field added to the
**Standard Template**, so _every_ item (template, section, field,
enumeration, content) inherits it uniformly. Kept in an Advanced /
non-prominent slot so content authors don't edit it; it is scai-managed
metadata. scai bootstraps the field once per environment — itself
expressible as a template recipe that extends the Standard Template.

**The flow.**

- `push` writes the handle into `Scai Handle` on every item it creates
  or updates.
- `push` matching resolves "does this recipe's item exist?" by the
  marker, not the path → survives moves and renames. Path is the
  fallback only for first contact / unmarked items.
- `readCurrent` reads `Scai Handle` → the _exact_ original handle (no
  synthesis), and uses it to tell which items are recipe-managed.

**First contact.** An environment scai never pushed has no markers; the
first `pull` falls back to path/name (fine — a first capture has
nothing to match). Every sync after the first `push` is marker-robust.

This is foundational — matching cannot be trusted without it — so it is
sequenced **ahead of** extending `readCurrent` coverage.

_Verify on implementation:_ that adding a field to the Standard Template
behaves cleanly on XM Cloud, and the field-visibility setting that keeps
it out of the content editor.

## Content versioning — seeding a story

`ContentItemRecipe` describes one content item with a single flat `fields`
block. That covers catalog-shipped datasources, but not the **story-seed**
use case: standing up a demo environment whose content has a _narrative_ — a
page that reads "coming soon" at version 1 and "we launched" at version 2, an
item localized into three languages, a hero with a personalized variant for
returning visitors. Seeding a story requires real Sitecore items with real
versions, and the recipe must be able to author them.

This is a **push-only** capability. `readCurrent` does not reverse-project a
version stack (see "Asymmetry" below) — capturing arbitrary version history
is `serialization`'s job. A story-seed recipe is _authored_ material: every
version is intentional, curated, reproducible. That is what separates it from
a backup.

### Three axes, and the storage gate

A Sitecore content item varies along three independent axes:

- **Language** — the item exists in `en`, `fr`, `de`, …
- **Numbered version** — within a language, `1`, `2`, `3`: editorial evolution.
- **Personalization variant** — within a language version, an
  audience-conditional alternative.

Which axes a field _may_ vary along is fixed by its **storage** — the
template-side option `SitecoreFieldAugment.storage` (`shared` / `unversioned`
/ `versioned`):

| `storage`     | varies by language | varies by numbered version |
| ------------- | :----------------: | :------------------------: |
| `shared`      |         no         |             no             |
| `unversioned` |        yes         |             no             |
| `versioned`   |        yes         |            yes             |

So `storage` is the **gate**. A story-seed that authors per-version values is
only coherent when those fields are `versioned`; per-language values need
`versioned` or `unversioned`. The compiler validates a story-seed against the
template's storage and rejects (`INPUT_INVALID`) any value placed on an axis
the field cannot carry.

None of this touches identity. The handle's `@<major>` is the
_recipe-definition_ version — a `@2` is a deliberately new recipe — and the
`Scai Handle` marker is shared: one identity per item, never forked per
language or version. Languages and versions are modeled _inside_ the recipe
body.

### Schema — two modes

A `ContentItemRecipe` is authored in one of two mutually-exclusive modes.

**Simple mode** — one version per language; the common case. Flat `fields` is
the primary language; `translations` adds the rest. Backward-compatible —
every existing single-language content recipe still validates unchanged:

```yaml
kind: content-item
handle: homepage-hero@1
templateType: hero@1
fields: # primary language, single version
  Headline: { shape: text, value: "We launched!" }
translations:
  fr:
    fields:
      Headline: { shape: text, value: "Nous avons lancé !" }
```

**Story mode** — explicit numbered versions, for seeding a narrative.
`versions` is keyed by language; each entry is one numbered version and
carries, beyond its `fields`: an optional `workflow` state, a `date`, a
per-version `layout`, and `variants` (personalization). Story mode replaces
`fields`/`translations` — a recipe is simple _or_ a story, never both:

```yaml
kind: content-item
handle: homepage-hero@1
templateType: hero@1
shared: # storage:shared fields — item-level
  CampaignCode: { shape: text, value: "LAUNCH26" }
versions:
  en:
    - version: 1
      fields: { Headline: { shape: text, value: "Coming soon" } }
      workflow: "Draft"
      date: "2026-01-10T00:00:00Z"
    - version: 2
      fields: { Headline: { shape: text, value: "We launched!" } }
      workflow: "Approved"
      date: "2026-03-01T00:00:00Z"
      layout: { placeholders: { ... } } # per-version → __Final Renderings
      variants:
        - audience: "returning-visitor"
          fields: { Headline: { shape: text, value: "Welcome back" } }
  fr:
    - version: 1
      fields: { Headline: { shape: text, value: "Bientôt disponible" } }
```

`storage:shared` fields have no version to live under, so in story mode they
sit in a top-level `shared` block. (Simple mode needs no such split — every
field, whatever its storage, just lives in `fields`; the template decides how
each is stored.)

### Layout — shared vs final

A version's optional `layout` writes to the item's **`__Final Renderings`**
(per-version) field — not `__Renderings` (shared). This is the recipe surface
for the shared-vs-final layout distinction: design artifacts (partial design,
page design, page template) own _shared_ layout via `__Renderings` and that
stays kind-implicit; a story-seed version owns its _final_ layout, and
`__Final Renderings` is reached only here.

### Variants — personalization & experimentation

**Status: researched, not implemented — roadmap / future work.** A story
recipe that sets `variants` is rejected by the compiler today; everything
below is the design basis for when the work is picked up.

A version's `variants` cover two XM Cloud features that share one mechanism:

- **Personalization** — an audience-conditional alternative ("returning
  visitors see X"). Page-level (embedded personalization, up to 10 page
  variants) or component-level.
- **Experimentation** — an A/B/n test variant (up to 6 component variants,
  measured against a goal).

Sitecore's own framing: _personalization and A/B/n testing are the same
functionality with minor tweaks._ Both are decided at request time by
**Sitecore Personalize**, which returns a **variant ID** the renderer uses
to fetch the right content.

**A variant is two parts, in two systems** — this is the load-bearing fact:

1. **Content — in XM.** What the variant _looks like_: field deltas (XM
   Cloud copies the datasource to a `<name>_var2`-style item in the same
   folder) and/or layout deltas (swap or hide a component). It lives in the
   datasource items plus the page layout data, published to Experience Edge.
   **This is the part a recipe compiles.**

2. **Rule — in Sitecore Personalize.** _Who_ sees it (a personalization
   audience/condition) or the _experiment_ it belongs to (A/B/n config +
   goal). Created in Personalize, identified by an ID; the XM-side content
   is registered against it — `variantId` for personalization,
   `componentId_variantId` for component A/B/n. **A recipe does not create
   the rule; it references it by ID.**

**Consequence for the schema.** `ContentVariant` should become a content
delta plus a typed _rule reference_, not a free-form `audience` string:

```yaml
variants:
  - rule: { kind: personalization, variantId: "<id-from-Personalize>" }
    fields: { Headline: { shape: text, value: "Welcome back" } }
  - rule: { kind: experiment, experimentId: "<id>", variantId: "<id>" }
    fields: { … }
    layout: { … }
```

The compiler emits the content delta (datasource `_varN` items + layout
entries keyed by the variant ID). The rule is authored in Personalize and
the recipe carries only its ID — which keeps the recipe env-portable: the
same content delta binds to a per-environment rule.

**Future work — roadmap (not scheduled).** Variants are deliberately
deferred; the research above is the design basis. The work, in order:

1. Revise `ContentVariant` — a content delta + a typed _rule reference_
   (`{ kind: personalization | experiment, … }`), replacing the free-form
   `audience` string.
2. Teach `compileContentItemRecipe` to emit the content delta — datasource
   `_varN` items + layout-data entries keyed by the variant ID. The exact
   `componentId_variantId` layout-JSON encoding is to be pinned against a
   live tenant at that point.
3. Decide whether scai grows a **Sitecore Personalize integration** so a
   recipe can _create_ the audience/experiment rule — a separate product
   surface (the Personalize API, not XM authoring; likely its own recipe
   kind). The v1 line is reference-by-ID; rule-creation is the bigger bet.
4. Possibly a distinct page-level page-variant shape — component-level
   (component personalization + A/B/n) lands first.

Until then, `compileContentItemRecipe` rejects a version that sets
`variants` with a clear `INPUT_INVALID`. The rest of story mode — `fields`,
`translations`, `shared`, `workflowState`, `date`, `layout` — is fully
compiled and shipped.

### Asymmetry — push is rich, pull is not

`push` materializes the whole story — every language, version, and variant.
`readCurrent` does **not** reverse-project it: it captures only the latest
numbered version of each language, projected back into _simple mode_. A
`pull` of a story-seeded item is therefore lossy by design; recovering a full
version stack is `serialization`'s job. This is consistent with `readCurrent`
already being a documented best-effort projection.

**Bidirectional sync (0.3+):** `readCurrent` is now the read half of a
three-way merge — `recipe push` writes a per-(env, recipe) baseline
file after each successful apply, and `recipe pull --against <recipes>`
compares disk + tenant + baseline to classify per-field drift as
`recipe-change` / `cms-edit` / `conflict` (push side) or `disk-ahead`
/ `tenant-edited` / `conflict` (pull side). See
[`docs/bidirectional-sync.md`](./bidirectional-sync.md) for the full
walkthrough including `--conflict-policy` / `--write-plan` /
`--apply-plan` and the `BaselineStorage` interface for remote backends.

### Decisions

- Two mutually-exclusive authoring modes: **simple** (`fields` +
  `translations`) and **story** (`versions`).
- `translations` is additive — existing single-language recipes are unchanged.
- `storage` (implemented) gates which axes a field may vary along; the
  compiler enforces it.
- A version entry carries `fields`, `workflow`, `date`, `layout`, `variants`.
- Per-version `layout` → `__Final Renderings`; shared/design layout →
  `__Renderings`.
- `readCurrent` stays latest-only — push is rich, pull is simple.
- A `variant` is two parts: content (in XM, recipe-compiled) + a rule (in
  Sitecore Personalize, referenced by ID). Covers both personalization and
  A/B/n experimentation. `ContentVariant` is to be revised from a free-form
  `audience` to a content delta + typed rule reference.

## Relationship to existing modules

| Module               | Role after this lands                                                         |
| -------------------- | ----------------------------------------------------------------------------- |
| `src/sync/` (new)    | The kind-agnostic engine + `RecipeKind` contract                              |
| `src/recipe/`        | The Sitecore-item recipe kind; IR becomes kind-internal                       |
| `src/serialization/` | Legacy. Superseded by `sync`; retired once item `pull` produces clean recipes |
| `declarative`        | Dropped — never created as a term or module                                   |

## Locked decisions

- **File format:** YAML, JSON, or TypeScript (`.recipe.ts` / `.tsx` /
  `.mts` / `.cts`) — every kind through one loader. `sync pull`
  round-trips to YAML; `.recipe.ts` is the authoring format when
  Zod-derived `satisfies` checks are wanted (registry-style recipes).
  The TS trust-model issue from the 0.1.0 security audit is mitigated
  by the recipe sandbox (`docs/recipe-sandbox.md`): the file is
  transpiled in the trusted parent and executed in a forked child
  locked down with Node's permission model — no FS writes, no worker
  threads, no child_process, scai secrets withheld from the child env.
  `SITECOREAI_RECIPE_SANDBOX=0` opts out (with a stderr warning) for
  debugging.
- **Apply is additive by default** — `push` creates/updates only; never
  prunes remote state absent from the file. Pruning, if added, goes behind
  an explicit `--prune` flag (destructive → consent).
- **Consent-gated** — `push` honors `--what-if` (default: print the plan,
  no writes) / `--allow-write`, consistent with `publish` and the
  destructive-ops consent rule.
- **Idempotent** — re-running `push` on a converged target yields an
  all-`noop` plan.
- **Brand-kit `apply` is full orchestration** — when the kit or its
  sections are absent, `apply` runs the create → upload → publish →
  ingest → enrich flow (reusing `seedBrandKit`), then converges field
  values. Not value-only. Because ingestion/enrichment are _paid_ AI
  pipeline runs (~5 min each), `what-if` must spell out the cost and
  `apply` requires explicit `--allow-write`.
- **Recipe identity is the handle, carried in a `Scai Handle` marker
  field** on every managed item — not the path (mutable) and not a GUID
  (environment-specific, and unreadable in content references). See
  "Recipe identity — the marker field" above.

## Build sequence

Brand-first, because `brand-kit`'s `readCurrent` is a trivial API GET,
while the Sitecore-item kind's `readCurrent` (reverse-engineering items
into a _clean_ recipe) is the hard research problem. Brand proves the
engine; items follow once that is solved.

1. **`src/sync/`** — `RecipeKind` contract, plan types, the
   pull/diff/push engine, kind registry, consent gating. Pure, no domain
   imports; unit-tested in isolation.
2. **`brand-kit` kind** — `src/brand/recipe/schema.ts`
   (`BrandKitRecipeSchema`: `name`, `description?`, `industry?`,
   `documents[]`, `sections{}`) + `kind.ts`:
   - `readCurrent` — `getBrandKit` + `listBrandKitSections` +
     `listBrandKitFields`, projected into the recipe shape (server
     `id`s dropped).
   - `diff` — match sections/fields by name; emit a _heterogeneous_
     plan: kit-lifecycle stages (create / publish / ingest / enrich,
     when the kit or its sections are absent) plus per-field value
     changes.
   - `apply` — run the needed lifecycle stages via `seedBrandKit`, then
     `updateBrandKitField` per value change. Idempotent: skip
     seed/ingest when the kit already has populated sections.
     `seedBrandKit` accepts a `documents` array — a multi-document
     brand-kit recipe uploads them all before a single ingest/enrich pass.
3. **CLI** — `sync` verbs for the brand surface (`pull`/`push`/`diff`),
   `--what-if`/`--allow-write`, fit into the reorganized command tree.
4. **MCP** — derive the brand-kit tool `inputSchema` from
   `BrandKitRecipeSchema`; expose "current kit as recipe" as a resource.
5. **Tests** — `diff` is pure (highest-value unit target); schema
   validation; mocked `apply`; CLI; `smoke-exports`-style coverage.

Fast-follow: adapt `src/recipe/` to implement `RecipeKind` (an adapter,
not a rewrite — `recipe push` keeps working, routed through `sync`).
Then `brief`, `campaign`, then `component`/`page`/`site` as kinds.

## Open questions

- CLI verb placement — `scai brand sync push` vs `scai sync push --kind
brand`; how `recipe compile/plan/push` verbs reconcile with `sync`.
- ~~Whether existing `.recipe.ts` item recipes convert to JSON/YAML.~~
  Resolved: every kind accepts both. `.recipe.ts` for authoring (Zod
  `satisfies` checks), YAML for `sync pull` round-trips, JSON for
  non-engineer authoring. One loader handles all three.
- `serialization` retirement — scope and timing of the migration.
- The hard one: turning arbitrary live Sitecore items into a _clean_
  recipe (`readCurrent` for the item kind) without leaking raw item YAML.
- How `what-if` surfaces paid-pipeline cost (two ~5-min AI runs) in the
  plan output so the operator sees it before approving `apply`.
