/**
 * Shared GraphQL transport for Sitecore tenant APIs.
 *
 * Two near-identical transports — the Authoring API (used by `recipe`)
 * and the Management API (used by `serialization`) — used to ship as
 * separate copies of timeout/abort/error/redaction plumbing. They live
 * in different modules because they target different Sitecore endpoints
 * with different auth contracts, but everything *except* the endpoint
 * URL, the human-readable label, and whether the bearer token is
 * required vs optional was duplicated.
 *
 * This module owns the wire protocol; `recipe/api/graphql.ts` and
 * `serialization/sitecore-api/graphql.ts` are thin wrappers that supply
 * the per-API constants.
 */

import type { EnvironmentConfiguration } from "@/config";
import { createCliError } from "./errors";
import { redactSecrets } from "./redact";

type GetAccessToken = (environment: EnvironmentConfiguration) => Promise<string | undefined>;

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string; path?: Array<string | number> }>;
};

export interface GraphQLRequestOptions {
  timeoutMs?: number;
}

export interface GraphQLTransportConfig {
  /** URL path appended to `environment.host`. */
  servicePath: string;
  /** Human-readable label used in error messages — e.g. `"Authoring"` or `"Management"`. */
  label: string;
  /**
   * When `true`, the call throws `AUTH_REQUIRED` if no token is available
   * (Authoring API). When `false`, the request is sent without the
   * Authorization header (Management API — anonymous access valid for
   * some queries).
   */
  requireToken: boolean;
  /**
   * Strategy for fetching a Bearer token for the request. Wrappers pass
   * this in so the shared module doesn't reach across layer boundaries
   * to import auth, and so tests can mock auth at the wrapper's seam
   * without crossing layers.
   */
  getAccessToken: GetAccessToken;
}

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

export const runSitecoreGraphQL = async <T>(
  environment: EnvironmentConfiguration,
  query: string,
  variables: Record<string, unknown> | undefined,
  transport: GraphQLTransportConfig,
  options?: GraphQLRequestOptions
): Promise<T> => {
  if (!environment.host) {
    throw createCliError("Environment host is not configured.", "INPUT_INVALID", {
      hint: "Set a CM host with 'scai init' or pass --host.",
    });
  }
  const hostUrl = normalizeHostUrl(environment.host);
  const url = `${hostUrl}${transport.servicePath}`;

  const token = await transport.getAccessToken(environment);
  if (transport.requireToken && !token) {
    throw createCliError(
      `Sitecore ${transport.label} API requires an access token.`,
      "AUTH_REQUIRED",
      { hint: "Run 'scai login' to authenticate." }
    );
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
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ query, variables }),
      signal: controller?.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw createCliError(`Sitecore ${transport.label} API request timed out.`, "NETWORK", {
        hint: "Increase settings.apiClientTimeoutInMinutes if needed.",
      });
    }
    throw createCliError(
      redactSecrets(
        `Sitecore ${transport.label} API request failed: ${
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
        `Sitecore ${transport.label} API request failed (${response.status}).${
          message ? ` ${message}` : ""
        }`
      ),
      "NETWORK"
    );
  }

  const parsed = await parseJsonIfPossible(response);
  if (!parsed || typeof parsed !== "object") {
    throw createCliError(
      `${transport.label} GraphQL response did not contain JSON data.`,
      "NETWORK"
    );
  }
  const result = parsed as GraphQLResponse<T>;
  if (result.errors?.length) {
    const message = result.errors.map((error) => error.message).join("; ");
    throw createCliError(redactSecrets(`${transport.label} GraphQL errors: ${message}`), "NETWORK");
  }
  if (!result.data) {
    throw createCliError(`${transport.label} GraphQL response did not contain data.`, "NETWORK");
  }
  return result.data;
};
