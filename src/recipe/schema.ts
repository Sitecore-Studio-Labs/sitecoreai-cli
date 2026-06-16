/**
 * Schema-only recipe entry —
 * `import { ... } from "@sitecoreai-labs/sitecoreai-cli/recipe/schema"`.
 *
 * Re-exports ONLY the recipe Zod schemas and the field-type tables — for
 * BOTH the stable kinds and the unstable composition kinds — with NONE of the
 * compiler, planner, executor, IR, GUID derivation, or API clients that the
 * `./recipe` and `./recipe/unstable` barrels carry.
 *
 * Why this exists: importing `./recipe` pulls `./compile` →
 * `./sandbox/transpile` → **esbuild** (the recipe sandbox transpiles author
 * TSX via esbuild's native binary). That is correct for the compile path, but
 * a schema-only consumer that just wants Zod types + validators (e.g. a
 * frontend that re-exports these schemas into client-reachable code, or a
 * jsdom unit test) must NOT drag esbuild into its module graph — esbuild's
 * load-time invariant throws under jsdom, and the native binary bloats client
 * bundles. This entry's transitive imports are zod-only (`schema/recipe` →
 * `schema/field-types` → `zod`), so it stays compiler-free.
 *
 * Stability: this is a strict subset of the schemas already exposed on
 * `./recipe` + `./recipe/unstable`; it carries the same stability contract as
 * those entries (the composition-kind schemas remain unstable). Use `./recipe`
 * when you also need the compiler / IR / GUIDs.
 */

export * from "./schema/recipe";
export * from "./schema/field-types";
