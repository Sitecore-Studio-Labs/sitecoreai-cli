import { createScaiError } from "@/shared/errors";
import { withOrganizationHeaders } from "./common/headers";
import { deployRequest, extractErrorMessage, parseJsonIfPossible } from "./common/request";
import {
  DEFAULT_DEPLOY_API_BASE,
  type DeployApiClientOptions,
  type DeployQueryValueList,
} from "./common/types";

export const fetchDeployments = async (
  options: DeployApiClientOptions,
  query?: Record<string, DeployQueryValueList | undefined>,
  organizationId?: string
): Promise<unknown> =>
  deployRequest<unknown>(options, "/api/deployments/v3", query, {
    headers: withOrganizationHeaders(organizationId),
  });

export const fetchDeployment = async (
  options: DeployApiClientOptions,
  deploymentId: string,
  organizationId?: string
): Promise<unknown> =>
  deployRequest<unknown>(options, `/api/deployments/v3/${deploymentId}`, undefined, {
    headers: withOrganizationHeaders(organizationId),
  });

export const fetchDeploymentV3 = async (
  options: DeployApiClientOptions,
  deploymentId: string,
  organizationId?: string
): Promise<unknown> =>
  deployRequest<unknown>(options, `/api/deployments/v3/${deploymentId}`, undefined, {
    headers: withOrganizationHeaders(organizationId),
  });

export const fetchDeploymentStatus = async (
  options: DeployApiClientOptions,
  organizationId?: string
): Promise<unknown> =>
  deployRequest<unknown>(options, "/api/deployments/v1/status", undefined, {
    headers: withOrganizationHeaders(organizationId),
  });

export const deployDeployment = async (
  options: DeployApiClientOptions,
  deploymentId: string,
  organizationId?: string
): Promise<unknown> =>
  deployRequest<unknown>(options, `/api/deployments/v1/${deploymentId}/deploy`, undefined, {
    method: "POST",
    headers: withOrganizationHeaders(organizationId),
  });

export const cancelDeployment = async (
  options: DeployApiClientOptions,
  deploymentId: string,
  organizationId?: string
): Promise<unknown> =>
  deployRequest<unknown>(options, `/api/deployments/v1/${deploymentId}/cancel`, undefined, {
    method: "POST",
    headers: withOrganizationHeaders(organizationId),
  });

export const uploadDeploymentSource = async (
  options: DeployApiClientOptions,
  deploymentId: string,
  content: Buffer,
  contentType = "application/zip",
  organizationId?: string
): Promise<unknown> => {
  const baseUrl = options.baseUrl ?? DEFAULT_DEPLOY_API_BASE;
  const url = `${baseUrl.replace(/\/$/, "")}/api/deployments/v2/${deploymentId}/source`;
  const body = content.buffer.slice(
    content.byteOffset,
    content.byteOffset + content.byteLength
  ) as ArrayBuffer;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        Accept: "application/json",
        "Content-Type": contentType,
        ...(withOrganizationHeaders(organizationId) ?? {}),
      },
      body,
    });
  } catch {
    throw createScaiError("Deploy API request failed due to a network error.", "NETWORK", {
      hint: "Check network connectivity or try again later.",
    });
  }

  if (!response.ok) {
    const body = await parseJsonIfPossible(response);
    const message = extractErrorMessage(body);
    throw createScaiError(
      message ?? `Deploy API request failed (${response.status})`,
      "DEPLOY_FAILED"
    );
  }

  return (await parseJsonIfPossible(response)) as unknown;
};
