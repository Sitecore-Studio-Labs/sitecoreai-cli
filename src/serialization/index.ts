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

export * from "./api";

export {
  loadConfigAndModules,
  groupSubtreesByDatabase,
  ensureAllowWrite,
  type LoadSerializationModulesOptions,
} from "./context";
