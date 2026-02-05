import { EnvironmentConfiguration } from "@/config";
import { createCliError } from "@/shared/errors";
import { redactSecrets } from "@/shared/redact";
import { getAccessToken } from "./auth";

const SERVICE_PATH = "/sitecore/api/management";

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

export type GraphQLRequestOptions = {
  timeoutMs?: number;
};

const parseJsonIfPossible = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export const runGraphQL = async <T>(
  environment: EnvironmentConfiguration,
  query: string,
  variables?: Record<string, unknown>,
  options?: GraphQLRequestOptions
): Promise<T> => {
  if (!environment.host) {
    throw new Error("Environment host is not configured.");
  }

  const host =
    environment.host.startsWith("http://") || environment.host.startsWith("https://")
      ? environment.host
      : `https://${environment.host}`;
  const hostUrl = host.endsWith("/") ? host.slice(0, -1) : host;

  const token = await getAccessToken(environment);
  const controller = options?.timeoutMs ? new AbortController() : undefined;
  const timeout = controller
    ? setTimeout(() => controller.abort(), Math.max(options?.timeoutMs ?? 0, 0))
    : undefined;
  let response: Response;
  try {
    response = await fetch(`${hostUrl}${SERVICE_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ query, variables }),
      signal: controller?.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw createCliError("Sitecore Management API request timed out.", "NETWORK", {
        hint: "Increase settings.apiClientTimeoutInMinutes if needed.",
      });
    }
    throw createCliError(
      redactSecrets(
        `Sitecore Management API request failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      ),
      "NETWORK"
    );
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }

  if (!response.ok) {
    const body = await parseJsonIfPossible(response);
    const message =
      typeof body === "string"
        ? body
        : body && typeof body === "object"
          ? JSON.stringify(body)
          : undefined;
    throw createCliError(
      redactSecrets(
        `Sitecore Management API request failed (${response.status}).${message ? ` ${message}` : ""}`
      ),
      "NETWORK"
    );
  }

  const parsed = await parseJsonIfPossible(response);
  if (!parsed || typeof parsed !== "object") {
    throw createCliError("GraphQL response did not contain JSON data.", "NETWORK");
  }
  const result = parsed as GraphQLResponse<T>;
  if (result.errors?.length) {
    const message = result.errors.map((error) => error.message).join("; ");
    throw createCliError(redactSecrets(`GraphQL errors: ${message}`), "NETWORK");
  }

  if (!result.data) {
    throw createCliError("GraphQL response did not contain data.", "NETWORK");
  }

  return result.data;
};
