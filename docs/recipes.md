# Recipes

`scai provision recipe` provides declarative Sitecore template + rendering definitions,
authored as TypeScript files alongside React components and pushed to the
CMS via the Authoring GraphQL API. The author writes a `.recipe.ts` describing
what should exist in the tenant; the CLI compiles it to an Operation IR,
diffs against the live tenant, and applies what's missing.

## Security model — `.recipe.ts` files are executed code, not data

When you run any `scai provision recipe` command (including `recipe diff` and
`recipe push --what-if`), every matched `.recipe.ts` file is imported and
its top-level code runs with the full privileges of your shell —
filesystem access, network, and environment variables. Treat recipe files
like any other build script (`webpack.config.js`, `vite.config.ts`):
only run `scai provision recipe` against repos and recipe files you trust. To
inspect an untrusted recipe set, compile it to `.recipe.json` in a
sandboxed environment first and operate on the JSON form.

Defenses already in place:

- Recipe glob does not follow symlinks (a planted symlink can't pull
  in `/etc/` or `~/.aws/` files for execution)
- All matched paths must live under the directory containing
  `sitecoreai.cli.json` — `..`-traversal escapes are rejected at
  compile time
- The config upward walk is bounded at the nearest `.git` or
  `package.json` — a planted `/tmp/sitecoreai.cli.json` won't get
  silently picked up

## Recipe kinds (0.1.0 stability)

| Kind                             | Purpose                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| `ComponentTemplateRecipe`        | Placeable component: datasource template + rendering item + Variants + DesignParameters    |
| `ContentTemplateRecipe`          | Content shape only (template + fields). Used as a Treelist source or `insertOptions` child |
| `ComponentSectionRecipe`         | Reusable field section shared between components                                           |
| `DesignParametersTemplateRecipe` | Reusable rendering-parameters template                                                     |
| `EnumerationRecipe`              | Droplink-backed reusable enum (e.g. ColorScheme)                                           |
| `WorkflowRecipe`                 | Sitecore workflow + states + commands + submit/validation webhook actions                  |
| `WebhookAuthorizationRecipe`     | Reusable webhook Authorization item (ApiKey / Basic / OAuth2)                              |

Composition kinds (`PartialDesignRecipe`, `PageDesignRecipe`,
`PageTemplateRecipe`, `PageRecipe`, `PlaceholderRecipe`,
`SiteTemplateRecipe`, `SiteRecipe`, `ContentItemRecipe`) are present in
the source but not part of the 0.1.0 stability promise. They'll graduate
in a follow-up release.

`PageTemplateRecipe` is the page-level peer of `ComponentTemplateRecipe`
— a Sitecore template that inherits the SXA Headless page base set so
items conforming to it are authorable pages. `PageRecipe` is the
page-level peer of `ContentItemRecipe` — a concrete, navigable page in
the site content tree, conforming to a page template and carrying its
own `__Final Renderings` layout (v1: `shared`/`none` placements; scoped
datasources and page-tree nesting are deferred). `PlaceholderRecipe` (plus
the inline `ComponentTemplateRecipe.placeholders` slot list) is the
hybrid placeholder model: standalone recipes for site-chrome slots,
inline declarations for component-owned slots — both compile to
Placeholder Settings items with an `Allowed Controls` whitelist, and a
layout placement into a recipe-defined placeholder is validated against
it.

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
[`src/recipe/guids.ts`](../src/recipe/guids.ts), not a value recomputed
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
```

A second push is idempotent (zero mutations). A partial failure rolls
back the operations it already applied via a LIFO unwind of
snapshot-driven inverse mutations. Use `SITECOREAI_TRACE_HTTP=1` to log
every Authoring GraphQL call for diagnosing path / GUID issues.

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
