import { EnvironmentConfiguration } from "@/config";
import { createCliError } from "@/shared/errors";
import { redactSecrets } from "@/shared/redact";
import { getAccessToken } from "./auth";

/**
 * Authoring GraphQL transport for recipe execution.
 *
 * Parallels `src/serialization/sitecore-api/graphql.ts` (Management API) but
 * targets the Authoring endpoint, which is the surface that exposes
 * `createItem` / `updateItem` / `deleteItem` mutations.
 *
 * XM Cloud Authoring API path. If a SitecoreAI tenant ever exposes the
 * endpoint at a different path, override via `SITECOREAI_AUTHORING_PATH`.
 */
const DEFAULT_AUTHORING_PATH = "/sitecore/api/authoring/graphql/v1";

const resolveAuthoringPath = (): string =>
  process.env.SITECOREAI_AUTHORING_PATH ?? DEFAULT_AUTHORING_PATH;

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string; path?: Array<string | number> }>;
};

export type AuthoringRequestOptions = {
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

const normalizeHostUrl = (host: string): string => {
  const withScheme =
    host.startsWith("http://") || host.startsWith("https://") ? host : `https://${host}`;
  return withScheme.endsWith("/") ? withScheme.slice(0, -1) : withScheme;
};

export const runAuthoringGraphQL = async <T>(
  environment: EnvironmentConfiguration,
  query: string,
  variables?: Record<string, unknown>,
  options?: AuthoringRequestOptions
): Promise<T> => {
  if (!environment.host) {
    throw createCliError("Environment host is not configured.", "INPUT_INVALID", {
      hint: "Set a CM host with 'scai init' or pass --host.",
    });
  }
  const hostUrl = normalizeHostUrl(environment.host);
  const url = `${hostUrl}${resolveAuthoringPath()}`;

  const token = await getAccessToken(environment);
  if (!token) {
    throw createCliError("Sitecore Authoring API requires an access token.", "AUTH_REQUIRED", {
      hint: "Run 'scai login' to authenticate.",
    });
  }

  const controller = options?.timeoutMs ? new AbortController() : undefined;
  const timeout = controller
    ? setTimeout(() => controller.abort(), Math.max(options?.timeoutMs ?? 0, 0))
    : undefined;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
      signal: controller?.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw createCliError("Sitecore Authoring API request timed out.", "NETWORK", {
        hint: "Increase settings.apiClientTimeoutInMinutes if needed.",
      });
    }
    throw createCliError(
      redactSecrets(
        `Sitecore Authoring API request failed: ${
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
        `Sitecore Authoring API request failed (${response.status}).${message ? ` ${message}` : ""}`
      ),
      "NETWORK"
    );
  }

  const parsed = await parseJsonIfPossible(response);
  if (!parsed || typeof parsed !== "object") {
    throw createCliError("Authoring GraphQL response did not contain JSON data.", "NETWORK");
  }
  const result = parsed as GraphQLResponse<T>;
  if (result.errors?.length) {
    const message = result.errors.map((error) => error.message).join("; ");
    throw createCliError(redactSecrets(`Authoring GraphQL errors: ${message}`), "NETWORK");
  }
  if (!result.data) {
    throw createCliError("Authoring GraphQL response did not contain data.", "NETWORK");
  }
  return result.data;
};
