/**
 * Curated public Deploy API surface — re-exported by `../index.ts`
 * (`@sitecoreai-labs/sitecoreai-cli/deploy`).
 *
 * Source of truth for what's part of the public Deploy API surface.
 * Every symbol below is intentional — adding one here is a public API
 * decision. Internal helpers (`parseJsonIfPossible`, `extractErrorMessage`)
 * stay reachable from sibling `api/*` files via direct `./common/request`
 * imports but are not re-exported here, so library consumers never
 * accidentally pick them up. The transport reports request lifecycle to
 * an optional listener (`./common/transport-events`); the CLI installs an
 * `ora` spinner via it, but `deployRequest` itself carries no
 * `ora`/`consola` dependency.
 *
 * Internal scai callers should keep importing from
 * `@/deploy/api/common/*` for the unstable helpers; this index file is
 * the only path that's contract-stable.
 */

// --- Transport configuration --------------------------------------------

export {
  DEFAULT_DEPLOY_API_BASE,
  DEFAULT_MONITORING_API_BASE,
  type DeployApiClientOptions,
  type DeployRequestInit,
  type DeployRequestTransport,
  type DeployQueryValue,
  type DeployQueryValueList,
  type DeployOrganization,
  type DeployProject,
  type DeployEnvironment,
  type DeployEnvironmentProvisioningStatus,
} from "./common/types";

export { withOrganizationHeaders } from "./common/headers";
export { deployRequest } from "./common/request";

// --- Curated client seam ------------------------------------------------
//
// `createDeployApiClient(options)` returns a typed, options-bound facade
// over the most common Deploy API operations. Parallels
// `createSitesApiClient` in `recipe/` — the full 60+ function surface
// remains exported below as bag-of-functions for callers that need the
// long tail (env vars, source-control providers, etc.).

export { createDeployApiClient, type DeployApiClient } from "./client";

// --- Organizations -------------------------------------------------------

export {
  fetchOrganization,
  fetchOrganizationHealth,
  fetchOrganizationLicense,
  createOrganizationDemoSolution,
} from "./organizations";

// --- Projects ------------------------------------------------------------

export {
  fetchProjects,
  fetchAllProjects,
  fetchProjectsLimitation,
  fetchProject,
  validateProjectName,
  createProject,
  updateProject,
  deleteProject,
  linkProjectRepository,
  unlinkProjectRepository,
  fetchProjectEnvironments,
  fetchAllProjectEnvironments,
  createProjectEnvironment,
  type FetchAllProjectsResult,
  type FetchAllProjectEnvironmentsResult,
} from "./projects";

// --- Environments --------------------------------------------------------

export {
  fetchEnvironments,
  fetchAllEnvironments,
  fetchEnvironmentsLimitation,
  fetchEnvironment,
  fetchEnvironmentDeployments,
  createEnvironmentDeployment,
  fetchEnvironmentVariables,
  upsertEnvironmentVariable,
  deleteEnvironmentVariable,
  fetchEnvironmentEdgeToken,
  fetchEnvironmentEditingSecret,
  regenerateEnvironmentContext,
  deleteEnvironment,
  updateEnvironment,
  promoteEnvironmentDeployment,
  linkEnvironmentRepository,
  unlinkEnvironmentRepository,
  fetchEnvironmentRestartStatus,
  restartEnvironment,
  probeEnvironmentHealth,
  resolveHostFromEnvironment,
  getProvisioningStatus,
  type EnvironmentHealthResult,
  type FetchAllEnvironmentsResult,
} from "./environments";

// --- Deployments ---------------------------------------------------------

export {
  fetchDeployments,
  fetchDeployment,
  fetchDeploymentV3,
  fetchDeploymentStatus,
  deployDeployment,
  cancelDeployment,
  uploadDeploymentSource,
} from "./deployments";

// --- Deployment logs -----------------------------------------------------

export { fetchDeploymentLogs } from "./deployment-logs";

// --- Logs ----------------------------------------------------------------

export { fetchLogList, fetchLogFile, type LogFileResponse } from "./logs";

// --- Clients (credential minting) ----------------------------------------

export {
  mintCmClient,
  mintDeployClient,
  mintEdgeClient,
  mintEhBuildClient,
  listEnvironmentClients,
  listOrganizationClients,
  deleteClient,
  type CreateEnvironmentClientRequest,
  type CreateDeployClientRequest,
  type MintedClient,
  type DeployClientSummary,
  type OrganizationClientSummary,
  type ClientsListResponse,
  type OrganizationClientsListResponse,
} from "./clients";

export {
  SCAI_CLIENT_PREFIX,
  slugifyEnvName,
  buildScaiClientName,
  buildScaiClientDescription,
  isScaiManagedClient,
  parseScaiClientName,
  type ScaiClientType,
  type ScaiClientSurface,
  type BuildScaiClientDescriptionOptions,
} from "./client-naming";

// --- Source control ------------------------------------------------------

export {
  fetchSourceControlIntegrations,
  fetchSourceControlIntegration,
  fetchSourceControlIntegrationState,
  fetchSourceControlAccessToken,
  validateSourceControlIntegration,
  deleteSourceControlIntegration,
  fetchSourceControlProviders,
  fetchSourceControlRepository,
  fetchSourceControlRepositoryBranches,
  fetchSourceControlTemplates,
  createSourceControlRepository,
  createSourceControlRepositoryGithub,
  validateSourceControlRepository,
} from "./source-control";
