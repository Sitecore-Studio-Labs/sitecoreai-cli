---
"@sitecoreai-labs/sitecoreai-cli": patch
---

Add a schema-only recipe entry: `@sitecoreai-labs/sitecoreai-cli/recipe/schema`.

Re-exports every recipe kind Zod schema (stable AND unstable composition kinds)
plus the field-type tables, with a **zod-only** module graph — no compiler,
planner, executor, IR, GUID derivation, or API clients. Importing the existing
`./recipe` / `./recipe/unstable` barrels pulls `./compile` → `sandbox/transpile`
→ esbuild; schema-only consumers (e.g. a frontend that re-exports these schemas
into client-reachable code, or a jsdom unit test) can now import from
`./recipe/schema` to get the Zod types + validators without dragging esbuild's
native binary into their bundle / test environment. Export-only, additive — the
`./recipe` and `./recipe/unstable` surfaces are unchanged.
