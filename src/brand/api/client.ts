import { createScaiError } from "@/shared/errors";
import { clearBrandToken } from "@/shared/keychain";
import { acquireBrandToken } from "./auth";
import { BRAND_API_HOST } from "./types";
import type { BrandCredential } from "@/config/types";

export interface BrandApiClientOptions {
  /**
   * Sitecore organization ID. Required because AI APIs keys are
   * one-org-per-credential — the orgId selects which credential to
   * use, and shows up in Brand Management URLs (`/organizations/{orgId}/…`).
   */
  orgId: string;
  /** Credential record from `brand[orgId]` in the root config. */
  credential: BrandCredential;
  /** Override the API host. Defaults to edge-platform.sitecorecloud.io. */
  host?: string;
}

export interface BrandApiRequest {
  /** Base path under the API host (e.g. `/stream/ai-skills-api`). */
  basePath: string;
  /** Path appended to `basePath`. Should start with a slash. */
  path: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, string | undefined>;
  /** Parsed JSON body. Stringified by the client. */
  body?: unknown;
  /** Optional AbortSignal for cancellation. */
  signal?: AbortSignal;
}

const buildUrl = (
  host: string,
  basePath: string,
  path: string,
  query?: BrandApiRequest["query"]
): string => {
  const url = new URL(`${basePath.replace(/\/$/, "")}${path}`, host);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
  }
  return url.toString();
};

const parseErrorBody = async (response: Response): Promise<string> => {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as {
      error?: string;
      error_description?: string;
      message?: string;
      title?: string;
      detail?: string;
    };
    return (
      parsed.error_description ??
      parsed.detail ??
      parsed.message ??
      parsed.error ??
      parsed.title ??
      text
    );
  } catch {
    return text;
  }
};

/**
 * Issue a single request to a Brand API and parse JSON.
 *
 * Auth handling:
 *   - Acquires a token via `acquireBrandToken` (cache → mint).
 *   - On 401, clears the cached token once and retries. This handles
 *     the documented 24h token expiry; if the retry also 401s we
 *     surface the failure rather than loop.
 *
 * Errors surface as `BRAND_API_FAILED` with the server's
 * `error_description` / `detail` / `message` in the message, leaving
 * `AUTH_BRAND_REQUIRED` for credential-resolution failures inside
 * `acquireBrandToken`.
 */
export const requestBrandApi = async <TResponse>(
  client: BrandApiClientOptions,
  request: BrandApiRequest
): Promise<TResponse> => {
  const host = client.host ?? BRAND_API_HOST;
  const url = buildUrl(host, request.basePath, request.path, request.query);

  const fire = async (token: string): Promise<Response> =>
    fetch(url, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(request.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: request.body !== undefined ? JSON.stringify(request.body) : undefined,
      signal: request.signal,
    });

  let token = await acquireBrandToken({
    orgId: client.orgId,
    credential: client.credential,
  });
  let response = await fire(token);

  if (response.status === 401) {
    await clearBrandToken(client.orgId);
    token = await acquireBrandToken({
      orgId: client.orgId,
      credential: client.credential,
    });
    response = await fire(token);
  }

  if (!response.ok) {
    const detail = await parseErrorBody(response);
    throw createScaiError(
      `Brand API ${request.method} ${request.path} failed (${response.status}): ${detail || "Unknown error"}`,
      "BRAND_API_FAILED"
    );
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }
  return (await response.json()) as TResponse;
};
