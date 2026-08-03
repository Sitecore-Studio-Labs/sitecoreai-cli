---
name: recipe-authoring
description: Author Sitecore recipes (.recipe.ts) that compile to templates + renderings — map a React/SXA component to a component-template, model data with content-templates, define enums, group with component-sections. Use when creating or editing *.recipe.ts files, turning a component into a Sitecore rendering, or asking "how do I make a recipe / why doesn't my component show up in Pages".
---

# Recipe Authoring

A **recipe** is a TypeScript object describing one thing you want in Sitecore.
`scai provision recipe push` compiles the set to idempotent Authoring operations
and applies them. Re-running is a no-op.

## Quick start

```sh
# Validate offline — compiles the whole SET (resolves section/treelist/enum refs)
# and emits the cross-recipe aggregates (available renderings, placeholder settings)
scai provision recipe compile -n <env>

scai provision recipe diff  -n <env>            # read-only diff vs the tenant
scai provision recipe push  -n <env> --what-if  # plan, no writes
scai provision recipe push  -n <env> --allow-write
scai provision recipe roots -n <env>            # show the derived tree paths
```

Import the kind type straight from the package — defaulted fields are optional, so
you write only what you mean:

```ts
import type { ComponentTemplateRecipe } from "@sitecoreai-labs/sitecoreai-cli/recipe";
export default {
  kind: "component-template",
  schemaVersion: "1" /* … */,
} satisfies ComponentTemplateRecipe;
```

Stable kinds on `/recipe`: `ComponentTemplateRecipe`, `ContentTemplateRecipe`,
`EnumerationRecipe`, `ComponentSectionRecipe`, `DesignParametersTemplateRecipe`,
`PageTemplateRecipe`, `VariantRecipe`. Composition kinds (`PartialDesign`,
`PageDesign`, `Site`, `ContentItem`, `Dictionary`) live on `/recipe/unstable`.

## Authoring checklist

1. **One recipe per thing.** Each placeable component → one `component-template`.
   Each reusable data shape → one `content-template`. Each value list → one
   `enumeration`.
2. **Identity.** `handle: "<kebab-name>@<major>"` (e.g. `hero@1`) — load-bearing,
   seeds every GUID; never rename to change meaning, bump `@2` for a new identity.
   `name` **must match the component-map key / SDK component export** (e.g. `Hero`).
   `displayName` is the Title-Case label authors see.
3. **Props → `fields`.** Map each editable prop to a field shape (table below) and
   override with `sitecore: { type, required, hint, section, sortOrder, defaultValue }`.
   Group with `section` ("Content", "Action", "Style") and order with `sortOrder`
   (100-step increments; styles at 200+).
4. **Style / layout choices → `params`, not `fields`.** A `color`/`size`/`position`
   prop is a rendering parameter. Use `shape: "enum"` with either inline
   `values: [...]` + `sitecore: { type: "droplist" }`, or `sitecore: { enumHandle:
"<enum>@1" }` pointing at a shared `enumeration` recipe. Extract shared param sets
   into a `_params.ts` module and spread them.
5. **Repeating lists → a `content-template` + a `reference` field.** Don't hard-code
   arrays. Model the item as a `content-template`, then a `reference` (multiple)
   field with `sitecore: { source: { kind: "filter", types: ["<item>@1"] } }`
   (a Treelist). Optionally also list the handle in `insertOptions` so authors can
   create the items as children of the datasource (child-item pattern).
6. **Variants** are PascalCase and map 1:1 to React named exports (`Default`,
   `FullWidth`). The SDK looks them up case-sensitively.
7. **Containers vs leaves.** A wrapper that holds other renderings declares
   `placeholders: [{ key, allowedComponents: [...] }]` and renders
   `<Placeholder name={key} />`. A leaf lists the placeholder keys it can drop into
   in `placedIn: ["headless-main", …]`.
8. **⚠️ Every component-template MUST reference a `component-section`** via
   `section: { handle: "<section>@1" }`. Without it, the available-renderings
   aggregate skips the component and **it never appears in the Pages component
   list** — even though the rendering exists. Author one `ComponentSectionRecipe`
   per group and point every component at it.
9. **Cross-references resolve by handle** at compile time (deterministic GUIDs);
   `compile` fails `INPUT_INVALID` on an unresolved handle.
10. **Organize + verify.** Recipes must live in a **subdirectory** of the glob
    (`recipes/**/*.recipe.ts` does not match files at the glob root). Keep shared
    enums/sections/params in their own folders. Always `compile` before `push`.

## Field shapes

| Prop (React)            | `shape`                        | Default Sitecore type | Notes                                                                    |
| ----------------------- | ------------------------------ | --------------------- | ------------------------------------------------------------------------ |
| `string` heading/label  | `text`                         | Single-Line Text      |                                                                          |
| rich body / `ReactNode` | `richText`                     | Rich Text             |                                                                          |
| `imageSrc` + `imageAlt` | `image`                        | Image                 |                                                                          |
| `{ label, href }`       | `link`                         | General Link          |                                                                          |
| `boolean` flag          | `boolean`                      | Checkbox              |                                                                          |
| number                  | `number` / `integer`           | Number / Integer      |                                                                          |
| `"a" \| "b"` union      | `enum`                         | Droplink              | inline → set `sitecore.type: "droplist"`; shared → `sitecore.enumHandle` |
| list of items           | `reference` (`multiple: true`) | Treelist              | `sitecore.source: { kind: "filter", types: ["<item>@1"] }`               |

`reference` with `multiple: false` → Droplink. Override any default with
`sitecore.type`.

## Examples

**Component template** — fields + params + treelist + variants + section + placement:

```ts
import type { ComponentTemplateRecipe } from "@sitecoreai-labs/sitecoreai-cli/recipe";

export default {
  kind: "component-template",
  schemaVersion: "1",
  handle: "hero@1",
  name: "Hero", // = component-map key / React export
  displayName: "Hero",
  section: { handle: "sodra@1" }, // ← required for it to appear in Pages
  fields: [
    {
      name: "Title",
      shape: "richText",
      sitecore: { required: true, section: "Content", sortOrder: 100 },
    },
    { name: "Intro", shape: "richText", sitecore: { section: "Content", sortOrder: 200 } },
    {
      name: "Buttons",
      shape: "reference",
      multiple: true,
      sitecore: { source: { kind: "filter", types: ["nav-link@1"] } },
    },
  ],
  insertOptions: ["nav-link@1"], // also author nav-links as datasource children
  params: [
    {
      name: "Color",
      shape: "enum",
      values: ["Grey", "Yellow", "Green"],
      default: "Grey",
      sitecore: { type: "droplist", section: "Style", sortOrder: 200 },
    },
  ],
  variants: [{ name: "Default" }],
  placedIn: ["headless-main"],
  meta: { tax: { group: "components", subgroup: "hero" } }, // optional UI taxonomy
} satisfies ComponentTemplateRecipe;
```

**Content template** — a reusable child shape (no rendering):

```ts
export default {
  kind: "content-template",
  schemaVersion: "1",
  handle: "nav-link@1",
  name: "NavLink",
  displayName: "Nav Link",
  fields: [
    { name: "Label", shape: "text", sitecore: { required: true } },
    { name: "Link", shape: "link", sitecore: { required: true } },
  ],
} satisfies ContentTemplateRecipe;
```

**Component section** — the toolbox group every component points at:

```ts
export default {
  kind: "component-section",
  schemaVersion: "1",
  handle: "sodra@1",
  name: "Sodra",
  displayName: "Södra",
} satisfies ComponentSectionRecipe;
```

**Enumeration** — shared droplist values referenced via `enumHandle`:

```ts
export default {
  kind: "enumeration",
  schemaVersion: "1",
  handle: "button-variant@1",
  name: "ButtonVariant",
  displayName: "Button Variant",
  default: "default",
  values: [
    { name: "default", displayName: "Default" }, // name kebab/machine, displayName Title
    { name: "outline", displayName: "Outline" },
  ],
} satisfies EnumerationRecipe;
```

## Placeholders

Two directions — keep them straight:

- **EXPOSE a slot** (container components): put `placeholders: [{ key, displayName?,
folder?, dynamic?, allowedComponents: [...] }]` on the component-template and
  render `<Placeholder name={key} rendering={rendering} />`. For a site-chrome slot
  that belongs to no single component (`/header`, `/footer`, `headless-main`),
  author a standalone `kind: "placeholder"` recipe (`PlaceholderRecipe`, on
  `/recipe/unstable`) with `key`, `name`, `allowedComponents`.
- **PLACE INTO a slot** (leaf components): list the keys in
  `placedIn: ["headless-main", …]`.

**Allowed Controls = the union** of a placeholder's `allowedComponents` and every
component that names that `key` in `placedIn`. Either side grants placement — you
don't need both.

- **Static vs dynamic.** A static `key` is one slot per page. For a container that
  repeats (appears multiple times, or holds N children), set `dynamic: true` on the
  placeholder **and** `dynamicPlaceholders: true` on the host component-template —
  SXA appends `-{uid}-{index}` per instance. Registry `placedIn` patterns use a
  `{*}` wildcard suffix (`headless-main-{*}`) to match those dynamic keys.
- **Resolution.** Keys a recipe in the set declares converge in one push (the
  placeholder-settings aggregate). Keys with no recipe declaration are patched onto
  the tenant's existing Placeholder Settings after push. Per-site settings land
  under `placeholderSettingsCreate` (derived from `site`/`siteCollection`).

```ts
// Container exposing a slot
placeholders: [
  { key: "sodra-grid", displayName: "Section Grid Tiles",
    allowedComponents: ["text-with-link@1", "text-and-image@1"] },
],
// component renders: <Placeholder name="sodra-grid" rendering={rendering} />
```

## Datasources

A component-template's `fields` **are** its datasource template. The optional
`datasource` block controls where instances live and how the add-to-page dialog
behaves:

```ts
datasource: {
  template: { handle: "destination-card@1" },   // single; or templates: [{handle}, …]
  autoCreate: true,                              // IsAutoDatasourceRendering — auto-make a datasource on add (default true)
  openPropertiesAfterAdd: false,
  locations: [
    { scope: "page", subfolder: "Destinations" },  // under the page's ./Data — one-off content
    { scope: "site", subfolder: "Destinations" },  // shared pool under contentItemsRoot — reused content
  ],
  query: ["fast:/sitecore/content/…//*[@@templatename='Foo']"],  // raw Source segments (escape hatch)
}
```

- **`scope: "page"`** → datasource items live under the page (`./Data/<subfolder>`);
  **`scope: "site"`** → a shared pool under `contentItemsRoot`. Offer both so authors
  pick where content lives.
- **`allowedTemplates`** on a location constrains that subfolder's Insert Options to
  specific handles (one rendering, several subfolders, each with its own allow-list).
- **Two ways to model child/related content (they can coexist):**
  - **Treelist (reference):** a `reference` field with `source: { kind: "filter",
types: ["<item>@1"] }` — author picks existing items from anywhere.
  - **Child items:** `insertOptions: ["<item>@1"]` — author creates the items as
    children of the datasource. List the same handle in both to support either flow;
    the React component reads whichever path the layout service delivers.
- A static component with no author-pickable data omits `datasource` entirely.

## Gotchas (hard-won)

- **No `section` → invisible in Pages.** The #1 "my component doesn't show up" cause.
  Add a `component-section` and `section: { handle }` on every component-template.
- **Glob needs a subfolder.** A glob like `recipes/**/*.recipe.ts` won't match a recipe at
  the glob root — put recipes under `blocks/`, `_content/`, `_sections/`, etc.
- **`name` must equal the component-map key**, or the SDK renders the
  missing-component fallback. Variants must be exact-case React exports.
- **`recipe compile` is set-aware** — it resolves `section`/treelist/enum handles
  across the whole glob and emits the available-renderings + placeholder-settings
  aggregates to `.scai/`. A single-file `--input` of a recipe that references a
  section in another file can't resolve it; compile the set.
- **Inline `enum` params need `sitecore.type: "droplist"`** (inline Droplink isn't
  supported) — or point at a shared `enumeration` with `enumHandle`.
- **Tree paths derive from `site` + `siteCollection`** on the env profile (no
  hand-written `recipeRoots` needed). Inspect with `scai provision recipe roots`.
