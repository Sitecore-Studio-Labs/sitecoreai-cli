import {
  DeployApiClientOptions,
  DeployEnvironment,
  DeployQueryValueList,
  deployRequest,
} from "./common";

export const fetchEnvironments = async (
  options: DeployApiClientOptions,
  query?: Record<string, DeployQueryValueList | undefined>
): Promise<unknown> => deployRequest<unknown>(options, "/api/environments/v2", query);

export const fetchEnvironmentsLimitation = async (
  options: DeployApiClientOptions
): Promise<unknown> => deployRequest<unknown>(options, "/api/environments/v1/limitation");

export const fetchEnvironment = async (
  options: DeployApiClientOptions,
  environmentId: string
): Promise<DeployEnvironment> =>
  deployRequest<DeployEnvironment>(options, `/api/environments/v2/${environmentId}`);

export const fetchEnvironmentDeployments = async (
  options: DeployApiClientOptions,
  environmentId: string
): Promise<unknown> =>
  deployRequest<unknown>(options, `/api/environments/v2/${environmentId}/deployments`);

export const createEnvironmentDeployment = async (
  options: DeployApiClientOptions,
  environmentId: string,
  redeploy?: boolean
): Promise<unknown> =>
  deployRequest<unknown>(
    options,
    `/api/environments/v2/${environmentId}/deployments`,
    redeploy === undefined ? undefined : { redeploy },
    { method: "POST" }
  );

export const fetchEnvironmentVariables = async (
  options: DeployApiClientOptions,
  environmentId: string
): Promise<unknown> =>
  deployRequest<unknown>(options, `/api/environments/v1/${environmentId}/variables`);

export const upsertEnvironmentVariable = async (
  options: DeployApiClientOptions,
  environmentId: string,
  variable: string,
  body: Record<string, unknown>
): Promise<unknown> =>
  deployRequest<unknown>(
    options,
    `/api/environments/v1/${environmentId}/variables/${encodeURIComponent(variable)}`,
    undefined,
    { method: "POST", body }
  );

export const deleteEnvironmentVariable = async (
  options: DeployApiClientOptions,
  environmentId: string,
  variable: string
): Promise<unknown> =>
  deployRequest<unknown>(
    options,
    `/api/environments/v1/${environmentId}/variables/${encodeURIComponent(variable)}`,
    undefined,
    { method: "DELETE" }
  );

export const fetchEnvironmentEdgeToken = async (
  options: DeployApiClientOptions,
  environmentId: string
): Promise<unknown> =>
  deployRequest<unknown>(options, `/api/environments/v1/${environmentId}/obtain-edge-token`);

export const fetchEnvironmentEditingSecret = async (
  options: DeployApiClientOptions,
  environmentId: string
): Promise<unknown> =>
  deployRequest<unknown>(options, `/api/environments/v1/${environmentId}/obtain-editing-secret`);

export const regenerateEnvironmentContext = async (
  options: DeployApiClientOptions,
  environmentId: string
): Promise<unknown> =>
  deployRequest<unknown>(
    options,
    `/api/environments/v1/${environmentId}/regenerate-context`,
    undefined,
    {
      method: "POST",
    }
  );

export const deleteEnvironment = async (
  options: DeployApiClientOptions,
  environmentId: string,
  force?: boolean
): Promise<unknown> =>
  deployRequest<unknown>(
    options,
    `/api/environments/v1/${environmentId}`,
    force ? { force } : undefined,
    { method: "DELETE" }
  );

export const updateEnvironment = async (
  options: DeployApiClientOptions,
  environmentId: string,
  body: Record<string, unknown>
): Promise<unknown> =>
  deployRequest<unknown>(options, `/api/environments/v1/${environmentId}`, undefined, {
    method: "PUT",
    body,
  });

export const promoteEnvironmentDeployment = async (
  options: DeployApiClientOptions,
  environmentId: string,
  deploymentId: string
): Promise<unknown> =>
  deployRequest<unknown>(
    options,
    `/api/environments/v2/${environmentId}/promote/${deploymentId}`,
    undefined,
    {
      method: "POST",
      body: { environmentId, deploymentId },
    }
  );

export const linkEnvironmentRepository = async (
  options: DeployApiClientOptions,
  environmentId: string,
  body: Record<string, unknown>
): Promise<unknown> =>
  deployRequest<unknown>(options, `/api/environments/v1/${environmentId}/repository`, undefined, {
    method: "PUT",
    body,
  });

export const unlinkEnvironmentRepository = async (
  options: DeployApiClientOptions,
  environmentId: string
): Promise<unknown> =>
  deployRequest<unknown>(options, `/api/environments/v1/${environmentId}/repository`, undefined, {
    method: "DELETE",
  });

export const fetchEnvironmentRestartStatus = async (
  options: DeployApiClientOptions,
  environmentId: string
): Promise<unknown> =>
  deployRequest<unknown>(options, `/api/environments/v1/${environmentId}/restart`);

export const restartEnvironment = async (
  options: DeployApiClientOptions,
  environmentId: string
): Promise<unknown> =>
  deployRequest<unknown>(options, `/api/environments/v1/${environmentId}/restart`, undefined, {
    method: "POST",
  });

export const resolveHostFromEnvironment = (environment: DeployEnvironment): string | undefined => {
  const direct = environment.cmUrl ?? environment.cmHost ?? environment.host ?? environment.url;
  if (direct) {
    return direct;
  }
  if (environment.hosts && environment.hosts.length > 0) {
    const host = environment.hosts[0];
    return host.url ?? host.hostName ?? host.hostname;
  }
  return undefined;
};
