import {
  DeployApiClientOptions,
  DeployOrganization,
  deployRequest,
  withOrganizationHeaders,
} from "./common";

export const fetchOrganization = async (
  options: DeployApiClientOptions
): Promise<DeployOrganization> =>
  deployRequest<DeployOrganization>(options, "/api/organizations/v1");

export const fetchOrganizationHealth = async (
  options: DeployApiClientOptions,
  organizationId?: string
): Promise<unknown> =>
  organizationId
    ? deployRequest<unknown>(options, `/api/organizations/v4/${organizationId}/health`, undefined, {
        headers: withOrganizationHeaders(organizationId),
      })
    : deployRequest<unknown>(options, "/api/organizations/v1/health");

export const fetchOrganizationLicense = async (
  options: DeployApiClientOptions,
  organizationId: string
): Promise<unknown> =>
  deployRequest<unknown>(options, `/api/organizations/v1/${organizationId}/license`);

export const createOrganizationDemoSolution = async (
  options: DeployApiClientOptions
): Promise<unknown> =>
  deployRequest<unknown>(options, "/api/organizations/v1/demo-solution", undefined, {
    method: "POST",
  });
