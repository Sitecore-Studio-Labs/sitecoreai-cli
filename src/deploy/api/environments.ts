import {
  DeployApiClientOptions,
  DeployEnvironment,
  DeployEnvironmentProvisioningStatus,
  DeployQueryValueList,
  deployRequest,
} from "./common";

export const fetchEnvironments = async (
  options: DeployApiClientOptions,
  query?: Record<string, DeployQueryValueList | undefined>
): Promise<unknown> => deployRequest<unknown>(options, "/api/environments/v2", query);

export type FetchAllEnvironmentsResult = {
  totalCount?: number;
  pageSize: number;
  items: DeployEnvironment[];
};

/**
 * Walk every page of `/api/environments/v2` and concatenate the results.
 * The Deploy API caps each page at 10 unless `PageSize` is set; this
 * helper bumps it to 50 by default and follows `totalCount` (or an
 * under-full page) to know when to stop. Callers that want a single
 * page should use `fetchEnvironments` directly.
 */
export const fetchAllEnvironments = async (
  options: DeployApiClientOptions,
  query?: Record<string, DeployQueryValueList | undefined>,
  pageSize: number = 50
): Promise<FetchAllEnvironmentsResult> => {
  const items: DeployEnvironment[] = [];
  let totalCount: number | undefined;
  // Hard cap: defends against APIs that never report totalCount and
  // keep returning full pages. At pageSize=50 this is 5000 envs — far
  // beyond any plausible tenant.
  const maxPages = 100;
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const page = (await fetchEnvironments(options, {
      ...query,
      PageNumber: pageNumber,
      PageSize: pageSize,
    })) as { data?: DeployEnvironment[]; totalCount?: number };
    const data = Array.isArray(page?.data) ? page.data : [];
    items.push(...data);
    if (typeof page?.totalCount === "number") {
      totalCount = page.totalCount;
    }
    if (data.length < pageSize) {
      break;
    }
    if (totalCount !== undefined && items.length >= totalCount) {
      break;
    }
  }
  return { totalCount, pageSize, items };
};

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

export type EnvironmentHealthResult = {
  host: string;
  url: string;
  status: number;
  ok: boolean;
  body: string;
};

export const probeEnvironmentHealth = async (
  host: string,
  timeoutMs: number = 30_000
): Promise<EnvironmentHealthResult> => {
  const normalized =
    host.startsWith("http://") || host.startsWith("https://") ? host : `https://${host}`;
  const url = `${normalized.replace(/\/$/, "")}/healthz/ready`;
  const controller = timeoutMs > 0 ? new AbortController() : undefined;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "text/plain, application/json" },
      signal: controller?.signal,
    });
    const body = await response.text();
    return {
      host: normalized,
      url,
      status: response.status,
      ok: response.ok,
      body: body.trim(),
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

/**
 * Translate the Deploy API's numeric `provisioningStatus` to a stable
 * string label. See the doc comment on `DeployEnvironmentProvisioningStatus`
 * for which codes are observed vs inferred.
 */
export const getProvisioningStatus = (
  environment: Pick<DeployEnvironment, "provisioningStatus">
): DeployEnvironmentProvisioningStatus => {
  switch (environment.provisioningStatus) {
    case 0:
      return "unprovisioned";
    case 1:
      return "provisioning";
    case 2:
      return "provisioned";
    case 3:
      return "failed";
    case 4:
      return "deleting";
    default:
      return "unknown";
  }
};

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
