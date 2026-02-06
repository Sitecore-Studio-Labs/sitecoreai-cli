export type CommonOptions = {
  config?: string;
  include?: string[];
  exclude?: string[];
  verbose?: boolean;
  trace?: boolean;
  json?: boolean;
  quiet?: boolean;
  logFile?: string;
};

export type LogoutOptions = CommonOptions & {
  environmentName?: string;
  all?: boolean;
};

export type SyncOptions = CommonOptions & {
  environmentName?: string;
  whatIf?: boolean;
  force?: boolean;
  skipValidation?: boolean;
  allowWrite?: boolean;
  publish?: boolean;
  targets?: string[];
  useDebugSignatures?: boolean;
};

export type DiffOptions = CommonOptions & {
  source: string;
  destination: string;
  push?: boolean;
  path?: string;
  sourceDatabase?: string;
  destinationDatabase?: string;
};

export type ExplainOptions = CommonOptions & {
  path: string;
  database: string;
};

export type WatchOptions = CommonOptions & {
  environmentName?: string;
  skipPull?: boolean;
  allowFileChanges?: boolean;
};

export type PackageCreateOptions = CommonOptions & {
  output: string;
  overwrite?: boolean;
};

export type PackageInstallOptions = CommonOptions & {
  package: string;
  environmentName?: string;
  whatIf?: boolean;
  publish?: boolean;
  authority?: string;
  cm?: string;
  clientId?: string;
  clientSecret?: string;
};

export type ConnectOptions = CommonOptions & {
  environmentName?: string;
  cm?: string;
  host?: string;
  ref?: string;
  allowWrite?: boolean;
  skipDeployLookup?: boolean;
  organizationId?: string;
  tenantId?: string;
  organization?: string;
  project?: string;
  environment?: string;
  deployToken?: string;
  clientId?: string;
  clientSecret?: string;
  useClientCredentials?: boolean;
  setDefault?: boolean;
  wizard?: boolean;
};

export type DeployBaseOptions = CommonOptions & {
  environmentName?: string;
  whatIf?: boolean;
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
