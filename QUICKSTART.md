# Quick start — author and push your first recipe

This is the five-minute path from an empty repo to a component template living
in your Sitecore AI environment. It uses **only the scai CLI** — no registry, no
web app, no orchestrator. If you've landed here from the Showcase registry: the
registry is a distribution surface built on top of this; everything below is the
core it wraps.

A **recipe** is a TypeScript object describing one thing you want in Sitecore (a
component template, a content template, an enumeration, …). scai compiles it to
idempotent Authoring operations and applies them. Re-running a push is a no-op.

> Requires Node.js >= 22.12.0.

## 1. Install

```sh
npm install -g @sitecoreai-labs/sitecoreai-cli
# or add it to your website repo: pnpm add -D @sitecoreai-labs/sitecoreai-cli
```

The CLI is `scai` (also `sitecoreai-cli`).

## 2. Configure an environment

```sh
scai setup init --wizard      # prompts for org/project/env, writes config + caches a token
scai setup status             # confirm what got written
```

This creates `sitecoreai.cli.json` at your repo root. The recipe-relevant parts:

```jsonc
{
  "$schema": "https://schemas.sitecoreai.dev/v1/sitecoreai.cli.json",
  "recipes": ["recipes/**/*.recipe.ts"], // where your recipes live
  "envProfiles": {
    "dev": {
      "host": "https://<your-cm>.sitecorecloud.io",
      "authority": "https://auth.sitecorecloud.io",
      "audience": "https://api.sitecorecloud.io",
      "useClientCredentials": true,
      "allowWrite": true, // gate: writes also need --allow-write
      "recipeRoots": {
        // where each kind is materialized
        "templates": "/sitecore/templates/Project/MySite",
        "renderings": "/sitecore/layout/Renderings/Project/MySite",
        "enumerations": "/sitecore/content/MySite/Presentation/Enumerations",
      },
    },
  },
  "defaultEnvProfile": "dev",
}
```

See [docs/configuration.md](./docs/configuration.md) for every field, auth modes,
and the per-environment CI env vars (`SITECOREAI_ENV_<NAME>_*`).

## 3. Write a recipe

Create `recipes/cta-button.recipe.ts`. Import the kind type **straight from the
package** — defaulted fields (`fields`, `variants`, `params`, an empty
`datasource.query`, …) are optional, so you only write what you mean:

```ts
import type { ComponentTemplateRecipe } from "@sitecoreai-labs/sitecoreai-cli/recipe";

export default {
  kind: "component-template",
  schemaVersion: "1",
  handle: "cta-button@1", // stable identity: name@version — seeds every GUID
  name: "CtaButton",
  displayName: "CTA Button",
  fields: [{ name: "Link", shape: "link", sitecore: { type: "general-link" } }],
  variants: [{ name: "default" }, { name: "outline" }],
} satisfies ComponentTemplateRecipe;
```

The five stable recipe kinds (`ComponentTemplateRecipe`, `ContentTemplateRecipe`,
`ComponentSectionRecipe`, `DesignParametersTemplateRecipe`, `EnumerationRecipe`)
live on `@sitecoreai-labs/sitecoreai-cli/recipe`. The composition kinds
(`ContentItem`, `PageDesign`, `PartialDesign`, `SiteRecipe`, `SiteTemplate`,
`Dictionary`) are present and usable but carry no stability promise, and live on
`@sitecoreai-labs/sitecoreai-cli/recipe/unstable`. See
[docs/recipes.md](./docs/recipes.md) for every kind and field.

## 4. Dry-run, then apply

```sh
scai provision recipe push -n dev --what-if      # prints the plan, writes nothing
scai provision recipe push -n dev --allow-write  # applies (needs allowWrite in config too)
```

Useful neighbors:

```sh
scai provision recipe list           # list recipes found by the `recipes` glob
scai provision recipe diff -n dev    # human-readable diff vs the tenant (read-only)
scai provision recipe plan -n dev    # operational plan diff (read-only)
scai provision recipe roots -n dev   # print the resolved recipe target roots
scai provision recipe pull -n dev    # extract tenant state back into *.recipe.json
scai provision recipe prune-defaults -n dev --allow-write  # remove OOTB SXA defaults
```

The full verb set: `compile`, `list`, `plan`, `diff`, `push`, `pull`,
`prune-defaults`, `roots`.

A second push is idempotent (zero mutations). A partial failure rolls back via a
LIFO unwind of the snapshot-driven inverse operations.

## A complete, working example

[`example/showcase/`](./example/showcase) is a coherent recipe set that compiles
and pushes cleanly — eight recipes (component templates, a partial design, a page
template, a page item) with cross-recipe references. Copy its
`sitecoreai.cli.json` shape and recipes as a starting point:

```sh
scai provision recipe push --config example/showcase/sitecoreai.cli.json -n showcase --what-if
```

## Where to go next

- [docs/recipes.md](./docs/recipes.md) — every recipe kind, handles, field shapes,
  the authoring-vs-parsed type model.
- [docs/configuration.md](./docs/configuration.md) — config schema, auth, CI.
- [docs/commands.md](./docs/commands.md) — the full command reference.
- `scai mcp serve -n dev` — drive all of the above from an agent over MCP.
