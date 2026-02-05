export type DeployApiClientOptions = {
  baseUrl?: string;
  accessToken: string;
};

export type DeployOrganization = {
  id?: string;
  organizationId?: string;
  name?: string;
  tenantId?: string;
};

export type DeployProject = {
  id?: string;
  projectId?: string;
  name?: string;
  organizationId?: string;
};

export type DeployEnvironment = {
  id?: string;
  environmentId?: string;
  name?: string;
  tenantId?: string;
  projectId?: string;
  organizationId?: string;
  host?: string;
  cmUrl?: string;
  cmHost?: string;
  url?: string;
  hosts?: Array<{ hostName?: string; url?: string; hostname?: string }>;
};

export const DEFAULT_DEPLOY_API_BASE = "https://xmclouddeploy-api.sitecorecloud.io";
export const DEFAULT_MONITORING_API_BASE = "https://xmcloud-monitoring-api.sitecorecloud.io";

export type DeployQueryValue = string | number | boolean;
export type DeployQueryValueList = DeployQueryValue | DeployQueryValue[];
export type DeployRequestInit = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  whatIf?: boolean;
};
