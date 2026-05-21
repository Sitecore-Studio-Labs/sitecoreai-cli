/**
 * Public entry for `@sitecoreai-labs/sitecoreai-cli/serialization`.
 *
 * `./api/index.ts` is itself a curated, explicit barrel (zero `export *`)
 * and stays the source of truth for the Sitecore Management + Authoring
 * GraphQL client surface — it is re-exported wholesale. `./context` is a
 * plain module, so its public symbols are enumerated explicitly below: a
 * new intra-area `export` in `context.ts` must be added here deliberately
 * to widen the SDK surface.
 */

// `export *` is safe here only because `./api/index.ts` is itself a
// curated, explicit barrel. See the matching comment in
// `src/deploy/index.ts`.
export * from "./api";

export {
  loadConfigAndModules,
  groupSubtreesByDatabase,
  type LoadSerializationModulesOptions,
} from "./context";

// Single source of truth for the write gate — see `@/policy/allow-write`.
export { ensureAllowWrite } from "@/policy/allow-write";
