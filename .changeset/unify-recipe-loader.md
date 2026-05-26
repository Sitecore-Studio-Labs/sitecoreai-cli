---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Unify recipe loading: the schema-aware `loadRecipe` from `@/sync`
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
