/**
 * Option types for `scai deploy` task runners. Every option type
 * extends `CommonOptions` (from `@/shared/cli-options`) directly or
 * via `DeployBaseOptions`.
 */

import type { CommonOptions } from "@/shared/cli-options";

export type DeployBaseOptions = CommonOptions & {
  environmentName?: string;
  whatIf?: boolean;
};

export type DeploySiteListOptions = DeployBaseOptions & {
  /** Walk each site's Site Grouping items to surface declared
   *  hostnames. Off by default — adds an N+1 round trip per site. */
  hostnames?: boolean;
  /** Override the content root walked. Default `/sitecore/content`.
   *  Useful for tests or non-standard installations. */
  contentRoot?: string;
};

/**
 * Options for `scai deploy site bind` — populate the SXA Site
 * Grouping fields the Pages/Channels app requires (HostName,
 * StartItem, RenderingHost) so a freshly-created site appears in
 * the Cloud Portal.
 *
 * `RenderingHost` is a string-keyed lookup, so the bind has no
 * dependency on the editing host deploy completing — it can run
 * any time after the Site Grouping itself has been provisioned.
 */
export type DeploySiteBindOptions = DeployBaseOptions & {
  /** SXA site name (e.g. `e2e`). Required. The Site Grouping item
   *  is at `/sitecore/content/<siteCollection>/<siteName>/Settings/Site Grouping/<siteName>`. */
  siteName?: string;
  /** SXA SiteCollection (XMC product surface) — the Headless Tenant
   *  the site lives under. Required. */
  siteCollection?: string;
  /** Editing host environment id from the Deploy API. Required —
   *  used to resolve the editing host URL via Deploy API GET. */
  editingHostId?: string;
  /** Override the RenderingHost field value. Defaults to `siteName`. */
  renderingHostName?: string;
  /** Override the StartItem name (relative to the site root).
   *  Default `Home`. */
  startItemName?: string;
  /** Override HostName field value. Default `*` (wildcard — the
   *  standard SXA Headless setting since routing is hostname-agnostic). */
  hostNamePattern?: string;
  /** Bypass scai's allowWrite safety. Required to actually mutate the
   *  Site Grouping; without it the command runs in plan-mode and
   *  prints what it would change. */
  allowWrite?: boolean;
};

export type DeployLogsOptions = DeployEnvironmentOptions & {
  latest?: boolean;
};

export type DeployLogViewOptions = DeployEnvironmentOptions & {
  log?: string;
};

export type DeployLogDataOptions = DeployEnvironmentOptions & {
  log?: string;
  output?: string;
};

export type DeployTokenOptions = CommonOptions & {
  environmentName?: string;
  clientId?: string;
  clientSecret?: string;
  useClientCredentials?: boolean;
  print?: boolean;
};

export type DeployOrganizationOptions = DeployBaseOptions;

export type DeployProjectOptions = DeployBaseOptions & {
  id?: string;
  name?: string;
};

export type DeployProjectDeleteOptions = DeployProjectOptions & {
  force?: boolean;
};

export type DeployProjectNameValidationOptions = DeployBaseOptions & {
  name?: string;
};

export type DeployProjectUpdateOptions = DeployProjectOptions & {
  newName?: string;
  repositoryName?: string;
  repositoryId?: string;
  sourceControlIntegrationId?: string;
};

export type DeployProjectRepositoryLinkOptions = DeployProjectOptions & {
  id?: string;
  repositoryName?: string;
  repositoryId?: string;
  integrationId?: string;
  repositoryRelativePath?: string;
};

export type DeployProjectCreateOptions = DeployBaseOptions & {
  name?: string;
  repositoryName?: string;
  repositoryId?: string;
  sourceControlIntegrationId?: string;
};

export type DeploySourceControlOptions = DeployBaseOptions & {
  id?: string;
};

export type DeploySourceControlValidateOptions = DeployBaseOptions & {
  id?: string;
  integrationId?: string;
  repositoryName?: string;
};

export type DeploySourceControlRepositoryOptions = DeployBaseOptions & {
  integrationId?: string;
  repositoryId?: string;
  repositoryName?: string;
};

export type DeploySourceControlRepositoryBranchesOptions = DeployBaseOptions & {
  repositoryName?: string;
  integrationId?: string;
};

export type DeploySourceControlRepositoryCreateTemplateOptions = DeployBaseOptions & {
  provider?: string;
  templateRepository?: string;
  templateOwner?: string;
  repositoryName?: string;
  owner?: string;
  integrationId?: string;
  description?: string;
  privateRepository?: boolean;
  includeAllBranches?: boolean;
};

export type DeploySourceControlTemplatesOptions = DeployBaseOptions & {
  provider?: string;
};

export type DeployDeploymentsOptions = DeployBaseOptions & {
  id?: string;
  status?: string;
};

export type DeployDeploymentActionOptions = DeployDeploymentsOptions & {
  file?: string;
  directory?: string;
};

export type DeployEnvironmentOptions = DeployBaseOptions & {
  id?: string;
  name?: string;
  project?: string;
  type?: string;
  force?: boolean;
};

export type DeployEnvironmentsListOptions = DeployEnvironmentOptions & {
  /** Walk every page until the result set is exhausted. */
  all?: boolean;
  /** Explicit page number (1-based). Ignored when `all` is set. */
  page?: number;
  /** Page size. Defaults to 50 when `all` is set, otherwise the API
   *  default (10). */
  pageSize?: number;
};

export type DeployEnvironmentDeleteOptions = DeployEnvironmentOptions & {
  force?: boolean;
};

export type DeployEnvironmentRepositoryLinkOptions = DeployEnvironmentOptions & {
  repositoryName?: string;
  repositoryId?: string;
  integrationId?: string;
  repositoryRelativePath?: string;
  repositoryBranch?: string;
};

export type DeployEnvironmentCreateOptions = DeployEnvironmentOptions & {
  tenantType?: number;
  cmOnly?: boolean;
};

export type DeployEnvironmentVariableOptions = DeployEnvironmentOptions & {
  variable?: string;
  value?: string;
  target?: string;
  secret?: boolean;
};

export type DeployEnvironmentDeploymentsOptions = DeployEnvironmentOptions & {
  redeploy?: boolean;
};

export type DeployEnvironmentPromoteOptions = DeployEnvironmentOptions & {
  sourceId?: string;
  noStart?: boolean;
  noWatch?: boolean;
  waitForPostActions?: boolean;
  timeout?: number;
};

export type DeployDeploymentWatchOptions = DeployDeploymentsOptions & {
  waitForPostActions?: boolean;
  timeout?: number;
};

export type DeployDeploymentLogsOptions = DeployDeploymentsOptions & {
  output?: string;
};

export type DeployEditingHostCreateOptions = DeployBaseOptions & {
  cmEnvironmentId?: string;
  name?: string;
};

export type DeployEditingHostListOptions = DeployBaseOptions & {
  project?: string;
  /** When false, fetch only one page. Default behaviour walks all
   *  pages — see comment in `runDeployEditingHostList`. */
  all?: boolean;
  page?: number;
  pageSize?: number;
};

export type DeployEditingHostDeleteOptions = DeployBaseOptions & {
  id?: string;
  force?: boolean;
};

export type DeployEditingHostUpdateOptions = DeployBaseOptions & {
  id?: string;
  name?: string;
};

export type DeployEditingHostDeployOptions = DeployBaseOptions & {
  id?: string;
  redeploy?: boolean;
  noWatch?: boolean;
  waitForPostActions?: boolean;
  timeout?: number;
};
