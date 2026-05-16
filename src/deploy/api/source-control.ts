import { withOrganizationHeaders } from "./common/headers";
import { deployRequest } from "./common/request";
import type { DeployApiClientOptions, DeployQueryValueList } from "./common/types";

export const fetchSourceControlIntegrations = async (
  options: DeployApiClientOptions
): Promise<unknown> => deployRequest<unknown>(options, "/api/sourcecontrol/v2/integrations");

export const fetchSourceControlIntegrationState = async (
  options: DeployApiClientOptions,
  organizationId?: string
): Promise<unknown> =>
  deployRequest<unknown>(options, "/api/sourcecontrol/v1/integration/state", undefined, {
    headers: withOrganizationHeaders(organizationId),
  });

export const fetchSourceControlAccessToken = async (
  options: DeployApiClientOptions,
  integrationId: string,
  organizationId?: string
): Promise<unknown> =>
  deployRequest<unknown>(
    options,
    "/api/sourcecontrol/v1/accesstoken",
    { IntegrationId: integrationId },
    {
      headers: withOrganizationHeaders(organizationId),
    }
  );

export const validateSourceControlIntegration = async (
  options: DeployApiClientOptions,
  body: Record<string, unknown>,
  organizationId?: string
): Promise<unknown> =>
  deployRequest<unknown>(
    options,
    "/api/sourcecontrol/v2/integration/validate",
    {
      IntegrationId:
        typeof body.integrationId === "string"
          ? body.integrationId
          : typeof body.IntegrationId === "string"
            ? body.IntegrationId
            : typeof body.id === "string"
              ? body.id
              : undefined,
    },
    { headers: withOrganizationHeaders(organizationId) }
  );

export const validateSourceControlRepository = async (
  options: DeployApiClientOptions,
  body: Record<string, unknown>,
  organizationId?: string
): Promise<unknown> =>
  deployRequest<unknown>(
    options,
    "/api/sourcecontrol/v2/repository/validate",
    {
      RepositoryName:
        typeof body.repositoryName === "string"
          ? body.repositoryName
          : typeof body.RepositoryName === "string"
            ? body.RepositoryName
            : undefined,
      IntegrationId:
        typeof body.integrationId === "string"
          ? body.integrationId
          : typeof body.IntegrationId === "string"
            ? body.IntegrationId
            : undefined,
    },
    { headers: withOrganizationHeaders(organizationId) }
  );

export const fetchSourceControlRepository = async (
  options: DeployApiClientOptions,
  query?: Record<string, DeployQueryValueList | undefined>,
  organizationId?: string
): Promise<unknown> =>
  deployRequest<unknown>(options, "/api/sourcecontrol/v1/repository", query, {
    headers: withOrganizationHeaders(organizationId),
  });

export const fetchSourceControlRepositoryBranches = async (
  options: DeployApiClientOptions,
  repositoryName: string,
  query?: Record<string, DeployQueryValueList | undefined>,
  organizationId?: string
): Promise<unknown> =>
  deployRequest<unknown>(
    options,
    `/api/sourcecontrol/v1/${encodeURIComponent(repositoryName)}/branches`,
    query,
    {
      headers: withOrganizationHeaders(organizationId),
    }
  );

export const fetchSourceControlTemplates = async (
  options: DeployApiClientOptions,
  query?: Record<string, DeployQueryValueList | undefined>,
  organizationId?: string
): Promise<unknown> =>
  deployRequest<unknown>(options, "/api/sourcecontrol/v1/templates", query, {
    headers: withOrganizationHeaders(organizationId),
  });

export const createSourceControlRepository = async (
  options: DeployApiClientOptions,
  body: Record<string, unknown>,
  organizationId?: string
): Promise<unknown> =>
  deployRequest<unknown>(options, "/api/sourcecontrol/v1/repository", undefined, {
    method: "POST",
    body,
    headers: withOrganizationHeaders(organizationId),
  });

export const createSourceControlRepositoryGithub = async (
  options: DeployApiClientOptions,
  body: Record<string, unknown>,
  organizationId?: string
): Promise<unknown> =>
  deployRequest<unknown>(options, "/api/sourcecontrol/v1/repository/github", undefined, {
    method: "POST",
    body,
    headers: withOrganizationHeaders(organizationId),
  });

export const fetchSourceControlProviders = async (
  options: DeployApiClientOptions,
  organizationId?: string
): Promise<unknown> =>
  deployRequest<unknown>(options, "/api/sourcecontrol/v1/providers", undefined, {
    headers: withOrganizationHeaders(organizationId),
  });

export const fetchSourceControlIntegration = async (
  options: DeployApiClientOptions,
  integrationId: string
): Promise<unknown> =>
  deployRequest<unknown>(options, `/api/sourcecontrol/v1/integration/${integrationId}`);

export const deleteSourceControlIntegration = async (
  options: DeployApiClientOptions,
  integrationId: string
): Promise<unknown> =>
  deployRequest<unknown>(options, `/api/sourcecontrol/v1/integration/${integrationId}`, undefined, {
    method: "DELETE",
  });
