import {
  fetchOrganization,
  fetchOrganizationHealth,
  fetchOrganizationLicense,
  createOrganizationDemoSolution,
} from "@/deploy/api/organizations";
import {
  getDeployContext,
  inputError,
  printDeployResultWithContext,
  resolveDeployOrganizationId,
  toLogger,
} from "./shared";
import type { DeployBaseOptions, DeployOrganizationOptions } from "./types";

export const runDeployOrganizationsGet = async (options: DeployBaseOptions): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const result = await fetchOrganization({
    accessToken: context.token,
    baseUrl: context.baseUrl,
  });
  printDeployResultWithContext(logger, context, "deploy.organizations.get", result);
};

export const runDeployOrganizationsHealth = async (
  options: DeployOrganizationOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const organizationId = await resolveDeployOrganizationId(context);
  if (!organizationId) {
    throw inputError("Organization ID is required. Run init or pass --organization-id.");
  }
  const result = await fetchOrganizationHealth(
    { accessToken: context.token, baseUrl: context.baseUrl },
    organizationId
  );
  printDeployResultWithContext(logger, context, "deploy.organizations.health", result);
};

export const runDeployOrganizationsLicense = async (
  options: DeployOrganizationOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const organizationId = await resolveDeployOrganizationId(context);
  if (!organizationId) {
    throw inputError("Organization ID is required. Run init or pass --organization-id.");
  }
  const result = await fetchOrganizationLicense(
    { accessToken: context.token, baseUrl: context.baseUrl },
    organizationId
  );
  printDeployResultWithContext(logger, context, "deploy.organizations.license", result);
};

export const runDeployOrganizationsLaunchDemo = async (
  options: DeployOrganizationOptions
): Promise<void> => {
  const logger = toLogger(options);
  const context = await getDeployContext(options);
  const organizationId = await resolveDeployOrganizationId(context);
  if (!organizationId) {
    throw inputError("Organization ID is required. Run init or pass --organization-id.");
  }
  const result = await createOrganizationDemoSolution({
    accessToken: context.token,
    baseUrl: context.baseUrl,
  });
  printDeployResultWithContext(logger, context, "deploy.organizations.launch-demo", result);
};
