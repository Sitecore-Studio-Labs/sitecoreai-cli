/**
 * `scai provision serialization` task-runner helpers.
 *
 * The substantive helpers — root config + serialization-module loading,
 * subtree grouping, and the write-consent guard — moved to
 * `@/serialization/context` (presentation-free, barrel-exported); this
 * file re-exports them so the runners keep their `./shared` import
 * surface. Neutral helpers (`toLogger`, `selectMatch`, etc.) live in
 * `@/shared/cli-tasks`.
 */

// Re-exports preserve the existing barrel surface; new code should
// import these directly from `@/shared/cli-tasks`.
export {
  toLogger,
  applyIfDefined,
  inputError,
  confirmDestructive,
  selectMatch,
  selectFromList,
  resolveApiTimeoutMs,
} from "@/shared/cli-tasks";

// The serialization context helpers, re-exported so the runners keep
// their `./shared` import surface.
export {
  loadConfigAndModules,
  groupSubtreesByDatabase,
  ensureAllowWrite,
  type LoadSerializationModulesOptions,
} from "@/serialization/context";
