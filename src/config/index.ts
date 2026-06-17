/**
 * Internal configuration module. The standalone `./config` published
 * subpath was removed in 0.4.2 to slim the SDK surface; this barrel is
 * still used across the CLI and other domain modules.
 *
 * The scai root configuration model — reading, writing, validating, and
 * environment-resolving `sitecoreai.cli.json`. SDK consumers that embed
 * scai need this to resolve the same configuration the CLI does (which
 * environment, which credentials, which recipe roots) instead of
 * re-deriving it.
 *
 * Pure: no CLI dependencies, no stdout writes, no `process.exit`.
 */

// --- Configuration model -------------------------------------------------

export * from "./types";

// --- Read / write / merge ------------------------------------------------

export {
  readRootConfigurationFile,
  writeRootConfigurationFile,
  mergeEnvironmentConfigurations,
  readRootConfiguration,
} from "./root-config";

// --- Path resolution -----------------------------------------------------

export { resolveRootConfigurationPath } from "./paths";

// --- Validation ----------------------------------------------------------

export {
  validateRootConfig,
  validateModuleConfig,
  formatValidationErrors,
  readJsonFile,
} from "./validation";

// --- Serialization modules ----------------------------------------------

export { normalizeModuleConfiguration, readSerializationModules } from "./modules";

// --- Environment overrides ----------------------------------------------

export { applyEnvOverrides, stripAuthenticationTokensFromConfig } from "./env-overrides";
