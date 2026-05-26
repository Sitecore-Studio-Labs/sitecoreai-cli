/**
 * Public entry for `@sitecoreai-labs/sitecoreai-cli/deploy`.
 *
 * `./api/index.ts` is itself a curated, explicit barrel (zero `export *`)
 * and stays the source of truth for the Deploy API surface — it is
 * re-exported wholesale. `./context` is a plain module, so its public
 * symbols are enumerated explicitly below: a new intra-area `export` in
 * `context.ts` must be added here deliberately to widen the SDK surface.
 */

// `export *` is safe here only because `./api/index.ts` is itself a
// curated, explicit barrel — every symbol there is an intentional
// public API decision. New exports added to `./api/index.ts` widen the
// SDK surface; new files under `./api/*` do NOT until added to
// `./api/index.ts`. Do not change this to `export * from "./api/*"`.
export * from "./api";

export {
  getDeployContext,
  resolveDeployOrganizationId,
  extractDeployEnvironmentList,
  getEnvironmentType,
  filterEnvironmentsByType,
  resolveDeployProjectId,
  resolveDeployEnvironmentId,
  resolveEnvironmentType,
  resolveTenantTypeValue,
  resolveProjectIdValue,
  type DeployContext,
} from "./context";
