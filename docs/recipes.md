# Recipes

`scai provision recipe` provides declarative Sitecore template + rendering definitions,
authored as TypeScript files alongside React components and pushed to the
CMS via the Authoring GraphQL API. The author writes a `.recipe.ts` describing
what should exist in the tenant; the CLI compiles it to an Operation IR,
diffs against the live tenant, and applies what's missing.

## Security model — `.recipe.ts` files are executed code, not data

A `.recipe.ts` file is code, not data — `scai` must execute it to read
the recipe. The commands that load `.recipe.ts` source are `recipe
compile`, `recipe push`, and `recipe diff` (`recipe plan` operates only
on a compiled `.ir.json` and never executes recipe code).

Every `.recipe.ts` file is loaded inside a **forked child-process
sandbox** by default. The child runs with a clean, deny-by-default
environment — no `SITECOREAI_*` credentials or tokens are passed in —
and is killed if it exceeds its time budget. A crashing or hanging
recipe cannot take down the CLI, and recipe code cannot read your
secrets out of `process.env`. Set `SITECOREAI_RECIPE_SANDBOX=0` to
disable the sandbox (dev-only escape hatch; prints a stderr warning).
See [docs/recipe-sandbox.md](./recipe-sandbox.md) for the full design.

What the sandbox does **not** do: it does not block filesystem writes
or network requests made by the recipe — those run as the same OS user.
So treat recipe files like any other build script (`webpack.config.js`,
`vite.config.ts`): only run `scai provision recipe` against repos and
recipe files you trust.

Other defenses already in place:

- Recipe glob does not follow symlinks (a planted symlink can't pull
  in `/etc/` or `~/.aws/` files for execution)
- All matched paths must live under the directory containing
  `sitecoreai.cli.json` — `..`-traversal escapes are rejected at
  compile time
- The config upward walk is bounded at the nearest `.git` or
  `package.json` — a planted `/tmp/sitecoreai.cli.json` won't get
  silently picked up

## Recipe kinds

**Nine recipe kinds are stable** — they carry the SemVer stability
promise and ship as named exports from
`@sitecoreai-labs/sitecoreai-cli/recipe`:

| Kind                             | Purpose                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| `ComponentTemplateRecipe`        | Placeable component: datasource template + rendering item + Variants + DesignParameters    |
| `ContentTemplateRecipe`          | Content shape only (template + fields). Used as a Treelist source or `insertOptions` child |
| `ComponentSectionRecipe`         | Reusable field section shared between components                                           |
| `DesignParametersTemplateRecipe` | Reusable rendering-parameters template                                                     |
| `EnumerationRecipe`              | Droplink-backed reusable enum (e.g. ColorScheme)                                           |
| `ContentItemRecipe`              | Shared content items (graduated 2026-08)                                                   |
| `PartialDesignRecipe`            | Presentation partial design (graduated 2026-08)                                            |
| `PageDesignRecipe`               | Presentation page design (graduated 2026-08)                                               |
| `DictionaryRecipe`               | Locale-aware phrase library (graduated 2026-08)                                            |

Every other kind is **present in the source and usable, but not part of
the stability promise** — its schema, type, or compiler may change shape
between minor releases:

| Kind                                                    | Purpose                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------- |
| `WorkflowRecipe`                                        | Sitecore workflow + states + commands + submit/validation webhook actions |
| `WebhookAuthorizationRecipe`                            | Reusable webhook Authorization item (ApiKey / Basic / OAuth2)             |
| `PageTemplateRecipe`, `PageRecipe`, `PlaceholderRecipe` | Page-level and placeholder templates (see below)                          |
| `VariantRecipe`                                         | Standalone SXA Headless rendering variant                                 |
| `SiteTemplateRecipe`, `SiteRecipe`                      | Site structure                                                            |

Only `SiteRecipe` and `SiteTemplateRecipe` still live on the separate
`@sitecoreai-labs/sitecoreai-cli/recipe/unstable` entry. `WorkflowRecipe`
and `WebhookAuthorizationRecipe` are reachable only through the
`compileRecipe` / `compileRecipeSet` union dispatch, not as individual
named exports.

### The 2026-08 graduation

`ContentItemRecipe`, `PartialDesignRecipe`, `PageDesignRecipe`, and
`DictionaryRecipe` moved to the stable entry. They are still re-exported
from `./recipe/unstable` through a **deprecation window** — existing
imports keep working and can migrate lazily — and the re-exports drop in
the next major. New code should import from `./recipe`.

What justified it, beyond heavy first-party use:

- **Idempotent re-push.** Every item id these kinds produce is a `uuidv5`
  derivation over stable inputs (`contentItemId`, `pageDesignId`,
  `partialDesignId`, `dictionaryPhraseId`, `dictionaryFolderId`, …). No
  kind reaches for `randomUUID` on the compile path, so re-pushing the
  same recipe converges on the same items.
- **Rollback parity.** Rollback is driven by the operation IR, not by
  kind, so parity is a question of which ops a kind emits. These four emit
  only `CreateItem`, `SetField`, and `AddItemVersion`. `CreateItem`
  inverts to `deleteItem` and `SetField` inverts to a field restore from
  the plan-time snapshot — the same inverses the original five stable
  kinds rely on.

`SiteRecipe` and `SiteTemplateRecipe` were held back on exactly this
test. `SiteRecipe` emits `CreateSiteFromTemplate` and `SiteTemplateRecipe`
emits `MediaUpload`; both are deliberately **warn-only** on rollback
(site deletion cascades destructively through pages, media, and
presentation; media upload cannot yet distinguish an item it created from
one it re-used). A half-failed push of either leaves residue the pipeline
will not unwind, which is not a guarantee worth promising.

**One narrow gap on the graduated kinds:** `AddItemVersion` is warn-only
on rollback, affecting `ContentItemRecipe` and `DictionaryRecipe`. It is
narrower than "warn-only" suggests, because the _planner_ closes it
rather than the rollback path:

- When the item was created by the same push, it doesn't arise at all —
  the `CreateItem` inverse deletes the whole item, versions included.
- When the item pre-existed, a half-failed push can leave an empty extra
  version behind. No field values are written to it.
- **The next push repairs it.** `planAddItemVersion` (`runtime/build-action.ts`)
  reads the target language's current max version and emits `skip` when
  `currentMax >= op.version`, otherwise adds exactly the shortfall
  (`addCount: op.version - currentMax`). So a re-push does not stack a
  second version on top of the leftover — it skips the add and the
  `SetField` ops populate the version that's already there. State
  converges on exactly the declared shape, and repeated failed pushes
  cannot accumulate versions.

What remains is only the _abandoned_ case: a push fails and is never
retried, leaving one empty version. A precise inverse would need a
version-delete mutation. `addItemVersion` has no documented delete
counterpart in Sitecore's authoring-operations reference — though that
page is examples-only and doesn't document `addItemVersion` either, so
absence there isn't proof. Confirming it needs schema introspection
against a live tenant. Given the planner already converges the retried
case, the remaining value is small; this is a deliberate non-goal rather
than a known bug awaiting a fix.

`PageTemplateRecipe` is the page-level peer of `ComponentTemplateRecipe`
— a Sitecore template that inherits the SXA Headless page base set so
items conforming to it are authorable pages. `PageRecipe` is the
page-level peer of `ContentItemRecipe` — a concrete, navigable page in
the site content tree, conforming to a page template and carrying its
own `__Final Renderings` layout (`shared`/`scoped`/`none` placements;
page-tree nesting is expressed via `itemPath`, and a page nested under
another in-set page's path applies after that ancestor). `PlaceholderRecipe` (plus
the inline `ComponentTemplateRecipe.placeholders` slot list) is the
hybrid placeholder model: standalone recipes for site-chrome slots,
inline declarations for component-owned slots — both compile to
Placeholder Settings items with an `Allowed Controls` whitelist, and a
layout placement into a recipe-defined placeholder is validated against
it.

### Wildcard pages (slug-driven detail routes)

A Sitecore **wildcard item** is an item literally named `*`. At request
time it matches any URL segment at its level, which makes it the
standard pattern for slug-driven detail pages — one wildcard page
serves `/cocktails/margarita`, `/cocktails/negroni`, and every other
slug under the same section. Slug resolution happens in the **head
app** (the route reads the matched segment from the URL and fetches the
corresponding content); Sitecore just serves the wildcard item's layout
for every matching route.

A `PageRecipe` authors one by ending its `itemPath` with a `*` leaf
(set `name: "*"` too — the itemPath leaf supersedes `name` for path
emission, but keeping them equal keeps the recipe honest):

```ts
// recipes/cocktail-detail.recipe.ts
import type { PageRecipe } from "@sitecoreai-labs/sitecoreai-cli/recipe";

export default {
  kind: "page",
  schemaVersion: "1",
  handle: "cocktail-detail@1",
  name: "*",
  displayName: "Cocktail Detail",
  template: "article-page@1",
  itemPath: "/sitecore/content/{site}/Home/Cocktails/*",
  layout: {
    placeholders: {
      "headless-main": [
        { componentHandle: "cocktail-hero@1", datasourceRef: { kind: "scoped", slot: "Hero" } },
      ],
    },
  },
} satisfies PageRecipe;
```

The compiler emits a plain `CreateItem` with `name: "*"` under the
itemPath's parent directory — no special casing, and scoped datasources
land under the wildcard item's own `./Data` folder as usual. When the
parent section page (`…/Home/Cocktails` above) is another `PageRecipe`
in the same set, apply ordering places the ancestor first — pages order
by `itemPath` ancestry as well as handle references — so the wildcard
child never forces its parent segment to be auto-created as a plain
folder.

### Content items: `folder` placement

By default a `ContentItemRecipe` lands flat at
`<contentItemsRoot>/<name>`. The optional `folder` field nests it —
array form (`["Data", "Cocktails"]`) or slash-string (`"Data/Cocktails"`)
— at `<contentItemsRoot>/<folder…>/<name>`. The compiler emits one
CreateOnly generic-`Folder` item per segment (shared folders
materialise once per recipe set), ordered before the item itself.

Identity is handle-derived (`contentItemId(site, handle)`), never
path-derived, so `reference` field refs and layout
`datasourceRef: { kind: "shared" }` bindings resolve identically with
or without a folder. **Caveat:** plan-time existence is path-based —
changing `folder` on an already-pushed item plans a fresh create at the
new path; the live item is not moved. Move it first (Authoring
`moveItem` / the CMS) or prune the old item after the push.

The workflow + webhook-authorization kinds have a dedicated reference
covering payload shape, endpoint contract, authorization handling, and
failure modes: [`docs/recipes/workflow.md`](recipes/workflow.md).

## File layout

Recipes are discovered via the `recipes` glob in `sitecoreai.cli.json`
(default `recipes/**/*.recipe.ts`):

```jsonc
{
  "recipes": ["recipes/**/*.recipe.ts"],
  "envProfiles": {
    "sandbox": {
      "host": "https://<your-sandbox>.sitecorecloud.io",
      "authority": "https://auth.sitecorecloud.io",
      "audience": "https://api.sitecorecloud.io",
      "clientId": "...",
      "useClientCredentials": true,
      "allowWrite": true,
    },
  },
}
```

## Authoring example

```ts
// recipes/cta-button.recipe.ts
import type { ComponentTemplateRecipe } from "@sitecoreai-labs/sitecoreai-cli/recipe";

export default {
  kind: "component-template",
  schemaVersion: "1",
  handle: "cta-button@1",
  name: "CtaButton",
  displayName: "CTA Button",
  fields: [{ name: "Link", shape: "link", sitecore: { type: "general-link", required: true } }],
  variants: [{ name: "default" }, { name: "outline" }, { name: "ghost" }, { name: "link" }],
  params: [
    { name: "Size", shape: "enum", values: ["sm", "md", "lg"], default: "md" },
    {
      name: "ColorScheme",
      shape: "enum",
      sitecore: { type: "droplink", enumHandle: "color-scheme@1" },
    },
  ],
  rendering: { datasourceLocation: "current-item", openPropertiesAfterAdd: false },
} satisfies ComponentTemplateRecipe;
```

For an enum to back the `ColorScheme` Droplink, see
[`example/recipes/color-scheme.recipe.ts`](../example/recipes/color-scheme.recipe.ts).

### Authoring types omit defaults

The exported `<Kind>Recipe` types (`ComponentTemplateRecipe`,
`EnumerationRecipe`, …) are the **authoring** shape: every field that the
schema gives a `.default(...)` is **optional** in your object literal. You
only write what you mean — omit `fields`, `variants`, `params`, an empty
`datasource.query`, `dynamicPlaceholders`, and the like, and the compiler
fills the defaults at parse time. So the minimal placeable component is just:

```ts
import type { ComponentTemplateRecipe } from "@sitecoreai-labs/sitecoreai-cli/recipe";

export default {
  kind: "component-template",
  schemaVersion: "1",
  handle: "cta-button@1",
  name: "CtaButton",
  displayName: "CTA Button",
} satisfies ComponentTemplateRecipe;
```

(Internally the compiler operates on the parsed, defaults-present shape —
exposed as `<Kind>RecipeParsed` for scai's own use; authors never need it.)

## Handles

Every recipe declares a `handle` — a stable identity string in the form
`name@version`, e.g. `cta-button@1`. The format is enforced at compile
time (`/^[a-z][a-z0-9-]*@[0-9]+$/`): a lower-case name, then a numeric
version after `@`.

The handle is load-bearing. It is the seed from which every Sitecore
item the recipe emits derives its GUID.

### Handles produce deterministic GUIDs

Recipe items don't get server-assigned GUIDs — each item's GUID is a
`uuidv5` hash of the handle (under a per-kind namespace):

```
templateId(site, handle) = uuidv5(`${site}::${handle}`, NAMESPACE_TEMPLATE)
```

Because the hash is pure, the same handle produces the same GUID every
time, with no server-side state. That is what makes a re-push
**idempotent**: the second push recomputes identical GUIDs, so Sitecore
sees "update these existing items" rather than "create duplicates" — a
recipe set pushed twice yields zero mutations the second time.

The namespace root is frozen — a hardcoded literal in
[`src/recipe/items/guids.ts`](../src/recipe/items/guids.ts), not a value recomputed
at runtime — so changes to the derivation code can never silently
re-namespace items on a tenant that already has a push.

### A handle roots a whole subtree

The handle's GUID isn't a single item — it's the root of a stable tree.
Fields, sections, variants, and standard-values derive their GUIDs
_under_ the template's GUID:

```
fieldId(site, handle, fieldName) = uuidv5(fieldName, templateId(site, handle))
```

So renaming a field moves only that field's GUID; renaming the handle
moves the entire subtree.

### Component items are site-scoped

For component-shaped items (templates, renderings, fields, variants, …)
the GUID seed is `<site>::<handle>`. The same recipe pushed to two sites
produces two distinct item sets under each site's `Project/<site>/`
tree — without site-scoping the second push would collide with the first
on Sitecore's global-GUID constraint. Tenant-wide items (workflows,
webhook authorizations) live at fixed system paths and derive from the
handle alone.

### Versioning is pinned — a handle never changes meaning

`cta-button@1` and `cta-button@2` are **different templates** — different
GUIDs, different items. Bumping the version does not migrate the old
template; it creates a new one and orphans the old. Renaming the name
portion does the same. The `@version` suffix is the explicit,
intentional mechanism for "I need a new identity" — e.g. a
backwards-incompatible change to the recipe's own schema. For any change
that should update existing items in place, keep the handle stable.

## Lifecycle commands

```sh
# Compile to Operation IR (pure logic, no tenant access)
scai provision recipe compile --input recipes/cta-button.recipe.ts \
  --output cta-button.ir.json \
  --templates-root /sitecore/templates/Project/<site>/Components \
  --renderings-root /sitecore/layout/Renderings/Project/<site>

# Plan: read-then-diff against the configured tenant (read-only)
scai provision recipe plan -n sandbox

# Dry-run push: prints the plan, doesn't write
scai provision recipe push -n sandbox --what-if

# For-real push (gated on env's allowWrite + the explicit flag)
scai provision recipe push -n sandbox --allow-write

# Diff: compute the same plan but in a human-readable summary
scai provision recipe diff -n sandbox

# List the recipes discovered by the `recipes` glob (no tenant access)
scai provision recipe list

# Print the resolved recipe target roots for an env (templates, renderings, …)
scai provision recipe roots -n sandbox

# Pull tenant state back into *.recipe.json
scai provision recipe pull -n sandbox

# Prune the OOTB defaults SXA seeds (e.g. the default Styles buckets)
scai provision recipe prune-defaults -n sandbox --allow-write
```

The full verb set is `compile`, `list`, `plan`, `diff`, `push`, `pull`,
`prune-defaults`, and `roots` (`scai provision recipe --help`).

A second push is idempotent (zero mutations). A partial failure rolls
back the operations it already applied via a LIFO unwind of
snapshot-driven inverse mutations. Use `SITECOREAI_TRACE_HTTP=1` to log
every Authoring GraphQL call for diagnosing path / GUID issues.

### Strict vs tolerant push (`SITECOREAI_RECIPE_PUSH_MODE`)

By default a push is **strict**: the first apply-time op error aborts the
recipe, rolls back everything it applied, and exits non-zero
(`DEPLOY_FAILED`). A missing field or a dead media URL fails the whole
install loudly so the underlying content defect gets fixed — the mode to
develop against.

Set `SITECOREAI_RECIPE_PUSH_MODE=tolerant` to make apply-time op errors
**non-fatal**: the executor skips just the failing op (recording it as an
`apply-error` event and in the per-recipe `error` count), keeps applying
the rest, does **not** roll back, and the push exits 0. Use it to let an
install complete past transient external failures (e.g. a media host 5xx)
or a known generated-content defect instead of aborting the whole batch.
Cancellation and three-way-merge conflicts still abort in either mode —
tolerant only downgrades apply-time op errors.

## Cross-recipe references

Recipes can reference each other by `handle`. The compiler resolves
references to deterministic GUIDs:

```ts
// Treelist field that pulls from a separate content template
{
  name: "Items",
  shape: "treelist",
  sitecore: { type: "treelist", source: "template:accordion-item@1" },
}

// Droplink field backed by a separate Enumeration
{
  name: "ColorScheme",
  shape: "enum",
  sitecore: { type: "droplink", enumHandle: "color-scheme@1" },
}
```

Cross-recipe references are validated at compile time —
`scai provision recipe compile` fails with `INPUT_INVALID` if a referenced handle
doesn't resolve.

Resolution is two-phase. At **compile time**, each referenced handle is
turned into a _refKey_ — the deterministic GUID computed from that
handle (see [Handles](#handles)). At **execute time**, the refKey is
substituted for the referenced item's resolved itemId from the per-run
captured-itemId map, once that item's `CreateItem` op has run
(topological ordering guarantees the producer runs first). Because the
GUIDs are deterministic, a reference resolves identically whether its
target is in the same push or was pushed to the tenant earlier.

## Safety

- Writes require `allowWrite: true` in the environment config AND the
  explicit `--allow-write` flag on `recipe push`
- `--what-if` previews the plan without contacting the API for writes
  (reads happen — the plan needs to know what's already there)
- Recipe GraphQL writes do not retry on 5xx — a write that gets an
  ambiguous response fails fast, the rollback layer handles partial
  state. Avoids silent duplicate mutations.

## What ships in the npm tarball

Importable types and the compiler are available at the
`@sitecoreai-labs/sitecoreai-cli/recipe` subpath:

```ts
import {
  ComponentTemplateRecipeSchema,
  type ComponentTemplateRecipe,
  compileComponentTemplateRecipe,
  buildPlan,
  executeIr,
} from "@sitecoreai-labs/sitecoreai-cli/recipe";
```

See `dist/recipe/index.d.ts` for the full exported surface.
