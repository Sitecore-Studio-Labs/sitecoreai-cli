/**
 * Production `DeployApiClient` factory for the Sitecore Cloud Deploy API.
 *
 * Like `createSitesApiClient` in `recipe/`, this is an options-bound
 * adapter over the function-style Deploy API surface. It exposes a
 * curated 80%-use-case subset of the operations exported from
 * `@sitecoreai-labs/sitecoreai-cli/deploy`:
 *
 *   - `fetchOrganization*` for org metadata + license
 *   - `fetchProject*` + `createProject` for project navigation
 *   - `fetchEnvironment*` + `createEnvironmentDeployment` for the
 *     environment lifecycle
 *   - `fetchDeployment*` + `deployDeployment` + `uploadDeploymentSource`
 *     for the deploy flow
 *   - `fetchLogList` for environment log access
 *   - `fetchSourceControlIntegrations` + `fetchSourceControlRepository`
 *     for source-control discovery
 *
 * The full operation set (60+ functions) remains exported from
 * `@sitecoreai-labs/sitecoreai-cli/deploy` for callers that need the
 * long-tail surface (env vars, regenerate context, source-control
 * provider management, etc.) — bind them yourself by passing
 * `options` as the first argument.
 *
 * This factory exists primarily for shape uniformity with the recipe
 * surface; it does not add retry, caching, or path-resolution behavior
 * beyond what the underlying functions already do.
 *
 * Note: a few deploy operations are intentionally NOT on this interface
 * because their signatures don't take a `DeployApiClientOptions`:
 *   - `probeEnvironmentHealth(host, timeoutMs)` — direct HTTP probe by URL
 *   - `resolveHostFromEnvironment(env)` — pure object accessor
 *   - `fetchDeploymentLogs(deploymentId, accessToken)` — takes the access
 *     token directly rather than the full options object
 * Import these directly from `@sitecoreai-labs/sitecoreai-cli/deploy`.
 */
import {
  cancelDeployment,
  deployDeployment,
  fetchDeployment,
  fetchDeploymentStatus,
  fetchDeployments,
  uploadDeploymentSource,
} from "./deployments";
import {
  createEnvironmentDeployment,
  fetchAllEnvironments,
  fetchEnvironment,
  fetchEnvironmentDeployments,
  fetchEnvironments,
} from "./environments";
import { fetchLogList } from "./logs";
import {
  createOrganizationDemoSolution,
  fetchOrganization,
  fetchOrganizationHealth,
  fetchOrganizationLicense,
} from "./organizations";
import {
  createProject,
  fetchAllProjects,
  fetchProject,
  fetchProjectEnvironments,
  fetchProjects,
} from "./projects";
import { fetchSourceControlIntegrations, fetchSourceControlRepository } from "./source-control";
import type { DeployApiClientOptions } from "./common/types";

type Tail<F> = F extends (head: DeployApiClientOptions, ...rest: infer R) => infer X
  ? (...args: R) => X
  : never;

export interface DeployApiClient {
  readonly options: DeployApiClientOptions;

  // Organizations
  fetchOrganization: Tail<typeof fetchOrganization>;
  fetchOrganizationHealth: Tail<typeof fetchOrganizationHealth>;
  fetchOrganizationLicense: Tail<typeof fetchOrganizationLicense>;
  createOrganizationDemoSolution: Tail<typeof createOrganizationDemoSolution>;

  // Projects
  fetchProjects: Tail<typeof fetchProjects>;
  fetchAllProjects: Tail<typeof fetchAllProjects>;
  fetchProject: Tail<typeof fetchProject>;
  createProject: Tail<typeof createProject>;
  fetchProjectEnvironments: Tail<typeof fetchProjectEnvironments>;

  // Environments
  fetchEnvironments: Tail<typeof fetchEnvironments>;
  fetchAllEnvironments: Tail<typeof fetchAllEnvironments>;
  fetchEnvironment: Tail<typeof fetchEnvironment>;
  fetchEnvironmentDeployments: Tail<typeof fetchEnvironmentDeployments>;
  createEnvironmentDeployment: Tail<typeof createEnvironmentDeployment>;

  // Deployments
  fetchDeployments: Tail<typeof fetchDeployments>;
  fetchDeployment: Tail<typeof fetchDeployment>;
  fetchDeploymentStatus: Tail<typeof fetchDeploymentStatus>;
  deployDeployment: Tail<typeof deployDeployment>;
  cancelDeployment: Tail<typeof cancelDeployment>;
  uploadDeploymentSource: Tail<typeof uploadDeploymentSource>;

  // Logs
  fetchLogList: Tail<typeof fetchLogList>;

  // Source control
  fetchSourceControlIntegrations: () => ReturnType<typeof fetchSourceControlIntegrations>;
  fetchSourceControlRepository: Tail<typeof fetchSourceControlRepository>;
}

export const createDeployApiClient = (options: DeployApiClientOptions): DeployApiClient => ({
  options,

  fetchOrganization: () => fetchOrganization(options),
  fetchOrganizationHealth: (orgId) => fetchOrganizationHealth(options, orgId),
  fetchOrganizationLicense: (orgId) => fetchOrganizationLicense(options, orgId),
  createOrganizationDemoSolution: () => createOrganizationDemoSolution(options),

  fetchProjects: (query) => fetchProjects(options, query),
  fetchAllProjects: (pageSize) => fetchAllProjects(options, pageSize),
  fetchProject: (projectId) => fetchProject(options, projectId),
  createProject: (body) => createProject(options, body),
  fetchProjectEnvironments: (projectId, query) =>
    fetchProjectEnvironments(options, projectId, query),

  fetchEnvironments: (query) => fetchEnvironments(options, query),
  fetchAllEnvironments: (pageSize) => fetchAllEnvironments(options, pageSize),
  fetchEnvironment: (environmentId) => fetchEnvironment(options, environmentId),
  fetchEnvironmentDeployments: (environmentId) =>
    fetchEnvironmentDeployments(options, environmentId),
  createEnvironmentDeployment: (environmentId, redeploy) =>
    createEnvironmentDeployment(options, environmentId, redeploy),

  fetchDeployments: (query) => fetchDeployments(options, query),
  fetchDeployment: (deploymentId) => fetchDeployment(options, deploymentId),
  fetchDeploymentStatus: (organizationId) => fetchDeploymentStatus(options, organizationId),
  deployDeployment: (deploymentId, organizationId) =>
    deployDeployment(options, deploymentId, organizationId),
  cancelDeployment: (deploymentId, organizationId) =>
    cancelDeployment(options, deploymentId, organizationId),
  uploadDeploymentSource: (deploymentId, content) =>
    uploadDeploymentSource(options, deploymentId, content),

  fetchLogList: (environmentId, latest) => fetchLogList(options, environmentId, latest),

  fetchSourceControlIntegrations: () => fetchSourceControlIntegrations(options),
  fetchSourceControlRepository: (query, organizationId) =>
    fetchSourceControlRepository(options, query, organizationId),
});
