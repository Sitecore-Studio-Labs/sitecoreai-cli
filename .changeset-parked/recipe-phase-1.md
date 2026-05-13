---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Add `recipe` command group: declarative templates, renderings, and
SXA Variants for Sitecore via the Authoring GraphQL API.

- New commands: `scai recipe compile|plan|push`
- Two recipe kinds: `ComponentTemplateRecipe` (rendering + datasource +
  Variants + params) and `ContentTemplateRecipe` (data shape only)
- Authoring surface mirrors the registry's `sitecore-recipes.ts` schema;
  `import { ComponentTemplateRecipeSchema } from "@sitecoreai-labs/sitecoreai-cli/recipe"`
  is now the source-of-truth subpath export
- Deterministic uuidv5 GUIDs from each recipe `handle@<version>`; pinned
  forever once pushed (snapshot-tested for the seven Sitecore Blocks UI
  components)
- Read-then-diff executor: idempotent across re-pushes (second push is
  zero mutations) with best-effort rollback on partial failure (LIFO
  unwind, snapshot-driven inverse mutations, full event audit trail)
- New `recipes: string[]` field in `sitecoreai.cli.json` locates recipe
  files (default `recipes/**/*.recipe.ts`); `tsx` promoted to a runtime
  dep so `.recipe.ts` files load directly without a build step
