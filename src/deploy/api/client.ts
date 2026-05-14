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
 *   - `fetchEnvironment*` + `createEnvironmentDeployment` +
 *     `probeEnvironmentHealth` + `resolveHostFromEnvironment` for the
 *     environment lifecycle
 *   - `fetchDeployment*` + `deployDeployment` + `uploadDeploymentSource`
 *     for the deploy flow
 *   - `fetchDeploymentLogs` + `fetchLogList` for log access
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
 */
import { fetchDeploymentLogs } from "./deployment-logs";
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
  probeEnvironmentHealth,
  resolveHostFromEnvironment,
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
import {
  fetchSourceControlIntegrations,
  fetchSourceControlRepository,
} from "./source-control";
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
  probeEnvironmentHealth: Tail<typeof probeEnvironmentHealth>;
  resolveHostFromEnvironment: Tail<typeof resolveHostFromEnvironment>;

  // Deployments
  fetchDeployments: Tail<typeof fetchDeployments>;
  fetchDeployment: Tail<typeof fetchDeployment>;
  fetchDeploymentStatus: Tail<typeof fetchDeploymentStatus>;
  deployDeployment: Tail<typeof deployDeployment>;
  cancelDeployment: Tail<typeof cancelDeployment>;
  uploadDeploymentSource: Tail<typeof uploadDeploymentSource>;

  // Logs
  fetchDeploymentLogs: Tail<typeof fetchDeploymentLogs>;
  fetchLogList: Tail<typeof fetchLogList>;

  // Source control
  fetchSourceControlIntegrations: Tail<typeof fetchSourceControlIntegrations>;
  fetchSourceControlRepository: Tail<typeof fetchSourceControlRepository>;
}

export const createDeployApiClient = (options: DeployApiClientOptions): DeployApiClient => ({
  options,

  fetchOrganization: (...args) => fetchOrganization(options, ...args),
  fetchOrganizationHealth: (...args) => fetchOrganizationHealth(options, ...args),
  fetchOrganizationLicense: (...args) => fetchOrganizationLicense(options, ...args),
  createOrganizationDemoSolution: (...args) => createOrganizationDemoSolution(options, ...args),

  fetchProjects: (...args) => fetchProjects(options, ...args),
  fetchAllProjects: (...args) => fetchAllProjects(options, ...args),
  fetchProject: (...args) => fetchProject(options, ...args),
  createProject: (...args) => createProject(options, ...args),
  fetchProjectEnvironments: (...args) => fetchProjectEnvironments(options, ...args),

  fetchEnvironments: (...args) => fetchEnvironments(options, ...args),
  fetchAllEnvironments: (...args) => fetchAllEnvironments(options, ...args),
  fetchEnvironment: (...args) => fetchEnvironment(options, ...args),
  fetchEnvironmentDeployments: (...args) => fetchEnvironmentDeployments(options, ...args),
  createEnvironmentDeployment: (...args) => createEnvironmentDeployment(options, ...args),
  probeEnvironmentHealth: (...args) => probeEnvironmentHealth(options, ...args),
  resolveHostFromEnvironment: (...args) => resolveHostFromEnvironment(options, ...args),

  fetchDeployments: (...args) => fetchDeployments(options, ...args),
  fetchDeployment: (...args) => fetchDeployment(options, ...args),
  fetchDeploymentStatus: (...args) => fetchDeploymentStatus(options, ...args),
  deployDeployment: (...args) => deployDeployment(options, ...args),
  cancelDeployment: (...args) => cancelDeployment(options, ...args),
  uploadDeploymentSource: (...args) => uploadDeploymentSource(options, ...args),

  fetchDeploymentLogs: (...args) => fetchDeploymentLogs(options, ...args),
  fetchLogList: (...args) => fetchLogList(options, ...args),

  fetchSourceControlIntegrations: (...args) => fetchSourceControlIntegrations(options, ...args),
  fetchSourceControlRepository: (...args) => fetchSourceControlRepository(options, ...args),
});
