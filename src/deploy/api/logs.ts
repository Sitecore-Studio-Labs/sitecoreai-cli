import {
  DEFAULT_MONITORING_API_BASE,
  DeployApiClientOptions,
  deployRequest,
  extractErrorMessage,
  parseJsonIfPossible,
  withOrganizationHeaders,
} from "./common";

export type LogFileResponse = {
  buffer: Buffer;
  contentType?: string;
};

export const fetchLogList = async (
  options: DeployApiClientOptions,
  environmentId: string,
  latest?: boolean,
  organizationId?: string
): Promise<unknown> =>
  deployRequest<unknown>(
    { ...options, baseUrl: options.baseUrl ?? DEFAULT_MONITORING_API_BASE },
    `/api/logs/v1/${environmentId}`,
    latest === undefined ? undefined : { latest },
    { headers: withOrganizationHeaders(organizationId) }
  );

export const fetchLogFile = async (
  options: DeployApiClientOptions,
  environmentId: string,
  filename: string,
  download?: boolean,
  organizationId?: string
): Promise<LogFileResponse> => {
  const baseUrl = options.baseUrl ?? DEFAULT_MONITORING_API_BASE;
  const query = download === undefined ? "" : `?download=${download ? "true" : "false"}`;
  const url = `${baseUrl.replace(/\/$/, "")}/api/logs/v2/${environmentId}/${encodeURIComponent(filename)}${query}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      Accept: "*/*",
      ...(withOrganizationHeaders(organizationId) ?? {}),
    },
  });
  if (!response.ok) {
    const body = await parseJsonIfPossible(response);
    const message = extractErrorMessage(body);
    throw new Error(message ?? `Deploy API request failed (${response.status})`);
  }
  const contentType = response.headers.get("content-type") ?? undefined;
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, contentType };
};
