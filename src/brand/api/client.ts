import { createScaiError } from "@/shared/errors";
import { clearBrandToken } from "@/shared/keychain";
import { runSitecoreRest } from "@/shared/rest";
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

/**
 * Pull the server's human-readable detail out of an error body. The body
 * has already been read + JSON-parsed by the shared transport
 * (`parseJsonIfPossible`): a JSON object exposes the Brand-API field
 * priority (`error_description` → `detail` → `message` → `error` →
 * `title`); a non-JSON body arrives as a raw string and is used verbatim.
 */
const parseErrorBody = (body: unknown): string => {
  if (typeof body === "string") {
    return body;
  }
  if (body && typeof body === "object") {
    const parsed = body as {
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
      JSON.stringify(body)
    );
  }
  return "";
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

  // Headers minus auth — the shared transport fills `Authorization`
  // per-attempt from `auth.getAuthHeader` so the 401 retry below carries a
  // freshly-minted token.
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(request.body !== undefined ? { "Content-Type": "application/json" } : {}),
  };

  const getToken = (): Promise<string> =>
    acquireBrandToken({ orgId: client.orgId, credential: client.credential });

  return runSitecoreRest<TResponse>({
    url,
    method: request.method,
    headers,
    body: request.body !== undefined ? JSON.stringify(request.body) : undefined,
    signal: request.signal,
    label: `Brand API ${request.method} ${request.path}`,
    auth: {
      getAuthHeader: async () => `Bearer ${await getToken()}`,
      // On 401, clear the cached token and retry once with a fresh one —
      // the documented 24h token-expiry recovery.
      refreshOnStatus: 401,
      onAuthFailure: async () => {
        await clearBrandToken(client.orgId);
      },
    },
    retry: {
      // Sitecore holds a brand-kit lock while its background AI enrichment
      // writes to the kit; a concurrent field PATCH then 409s ("Brand Kit
      // is locked by another user"). The lock is transient, so ride it out
      // with backoff rather than hard-failing the (idempotent) override
      // pass. 409 is the brand API's only "locked" status, so retrying it
      // is safe across every brand call. ~5 attempts ≈ up to ~15s of
      // backoff — enough for typical per-write locks; a longer hold still
      // surfaces and is handled by the caller's own retry.
      maxRetries: 5,
      shouldRetryStatus: (status) => status === 409,
    },
    // Preserve the pre-refactor behavior of letting a raw fetch rejection
    // (network error) propagate unmapped — brand callers never relied on a
    // structured NETWORK ScaiError here.
    mapNetworkError: (error) => {
      throw error;
    },
    mapHttpError: (response, body) => {
      const detail = parseErrorBody(body);
      return createScaiError(
        `Brand API ${request.method} ${request.path} failed (${response.status}): ${detail || "Unknown error"}`,
        "BRAND_API_FAILED"
      );
    },
  });
};
