import { extractErrorMessage, parseJsonIfPossible } from "./common";

const DEFAULT_DEPLOY_MONITORING_BASE = "https://xmcloud-monitoring-api.sitecorecloud.io";

export const fetchDeploymentLogs = async (
  deploymentId: string,
  accessToken: string
): Promise<unknown> => {
  const url = `${DEFAULT_DEPLOY_MONITORING_BASE.replace(/\/$/, "")}/api/Deployments/v1/${deploymentId}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    const body = await parseJsonIfPossible(response);
    const message = extractErrorMessage(body);
    throw new Error(message ?? `Deploy API request failed (${response.status})`);
  }
  return (await parseJsonIfPossible(response)) as unknown;
};
