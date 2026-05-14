# Recipes

`scai recipe` provides declarative Sitecore template + rendering definitions,
authored as TypeScript files alongside React components and pushed to the
CMS via the Authoring GraphQL API. The author writes a `.recipe.ts` describing
what should exist in the tenant; the CLI compiles it to an Operation IR,
diffs against the live tenant, and applies what's missing.

## Security model — `.recipe.ts` files are executed code, not data

When you run any `scai recipe` command (including `recipe diff` and
`recipe push --what-if`), every matched `.recipe.ts` file is imported and
its top-level code runs with the full privileges of your shell —
filesystem access, network, and environment variables. Treat recipe files
like any other build script (`webpack.config.js`, `vite.config.ts`):
only run `scai recipe` against repos and recipe files you trust. To
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
`SiteTemplateRecipe`, `SiteRecipe`, `ContentItemRecipe`) are present in
the source but not part of the 0.1.0 stability promise. They'll graduate
in a follow-up release.

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

## Lifecycle commands

```sh
# Compile to Operation IR (pure logic, no tenant access)
scai recipe compile --input recipes/cta-button.recipe.ts \
  --output cta-button.ir.json \
  --templates-root /sitecore/templates/Project/<site>/Components \
  --renderings-root /sitecore/layout/Renderings/Project/<site>

# Plan: read-then-diff against the configured tenant (read-only)
scai recipe plan -n sandbox

# Dry-run push: prints the plan, doesn't write
scai recipe push -n sandbox --what-if

# For-real push (gated on env's allowWrite + the explicit flag)
scai recipe push -n sandbox --allow-write

# Diff: compute the same plan but in a human-readable summary
scai recipe diff -n sandbox
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
`scai recipe compile` fails with `INPUT_INVALID` if a referenced handle
doesn't resolve.

## Safety

- Writes require `allowWrite: true` in the environment config AND the
  explicit `--allow-write` flag on `recipe push`
- `--what-if` previews the plan without contacting the API for writes
  (reads happen — the plan needs to know what's already there)
- Recipe GraphQL writes do not retry on 5xx — a write that gets an
  ambiguous response fails fast, the rollback layer handles partial
  state. Avoids silent duplicate mutations.

## Determinism

Every item GUID is derived via `uuidv5` from the recipe `handle@<version>`.
Same handle → same GUID, forever. Pinning a recipe to `@1` and bumping to
`@2` is the migration path when you need a new identity (e.g. backwards-
incompatible schema change in the recipe itself).

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
