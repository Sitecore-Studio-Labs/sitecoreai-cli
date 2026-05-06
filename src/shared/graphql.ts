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
  /**
   * Override retry behaviour for transient failures (429 throttling, 502/503/504,
   * network blips, abort-but-not-timeout). Defaults to 5 attempts with
   * exponential backoff + jitter, honoring `Retry-After` on 429/503.
   */
  retry?: RetryOptions;
}

export interface RetryOptions {
  /** Total attempts including the initial one. Default 5. */
  maxAttempts?: number;
  /** Base delay in ms; doubled per retry, jittered ±50%. Default 500ms. */
  baseDelayMs?: number;
  /** Cap on a single backoff delay. Default 15s. */
  maxDelayMs?: number;
  /**
   * Which HTTP status codes are retryable. Defaults to the conservative
   * "definite-throttle / never-reached-origin" set: 408, 425, 429, 503.
   * Read-only callers can pass a wider set (`READ_RETRYABLE_STATUSES`)
   * that includes ambiguous 5xx codes like 500/502/504; mutation callers
   * keep the conservative default so a transient 5xx-after-success
   * doesn't trigger a duplicate-write retry. Network blips
   * (`TypeError: fetch failed`) are always retryable regardless of this
   * set since no request was sent.
   */
  retryableStatuses?: ReadonlySet<number>;
}

/**
 * Default to one attempt — no retry — so existing callers (serialization,
 * deploy) keep their current "fail fast on first error" semantics. Hot
 * paths that benefit from retry (the recipe executor's parallel batched
 * reads + applies) opt in via `retry: { maxAttempts: N }`. This keeps the
 * shared transport's error-mapping tests stable while letting the recipe
 * path get throttle-aware behavior for free.
 */
const DEFAULT_RETRY: Required<RetryOptions> = {
  maxAttempts: 1,
  baseDelayMs: 500,
  maxDelayMs: 15_000,
  retryableStatuses: new Set([408, 425, 429, 503]),
};

/**
 * Read-only callers can opt in to a broader retry set that includes
 * ambiguous 5xx codes. Safe for GETs since reads are idempotent — a
 * second fetch is harmless. Unsafe for mutations because 500/502/504
 * may indicate the server processed the request but failed to respond,
 * and retrying would create a duplicate.
 */
export const READ_RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Sleep with abort-on-signal so a Ctrl-C during backoff still exits promptly. */
const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

const jitter = (n: number): number => n * (0.5 + Math.random());

const computeBackoff = (
  attempt: number,
  cfg: Required<RetryOptions>,
  retryAfterSeconds?: number
): number => {
  if (retryAfterSeconds && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, cfg.maxDelayMs);
  }
  const exp = cfg.baseDelayMs * 2 ** attempt;
  return Math.min(jitter(exp), cfg.maxDelayMs);
};

const parseRetryAfter = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds;
  const httpDate = Date.parse(value);
  if (!Number.isNaN(httpDate)) {
    return Math.max(0, (httpDate - Date.now()) / 1000);
  }
  return undefined;
};

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

  const retryCfg: Required<RetryOptions> = {
    ...DEFAULT_RETRY,
    ...(options?.retry ?? {}),
  };

  const sendOnce = async (): Promise<T> => {
    const controller = options?.timeoutMs ? new AbortController() : undefined;
    const timeout = controller
      ? setTimeout(() => controller.abort(), Math.max(options?.timeoutMs ?? 0, 0))
      : undefined;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ query, variables }),
        signal: controller?.signal,
      });

      if (!response.ok) {
        const body = await parseJsonIfPossible(response);
        const message =
          typeof body === "string"
            ? body
            : body && typeof body === "object"
              ? JSON.stringify(body)
              : undefined;
        const httpError = new HttpError(
          response.status,
          // Test mocks of `Response` may omit `headers`; defensive access
          // avoids `Cannot read properties of undefined`. Production
          // `fetch` always populates a `Headers` object.
          parseRetryAfter(response.headers?.get?.("retry-after") ?? null),
          redactSecrets(
            `Sitecore ${transport.label} API request failed (${response.status}).${
              message ? ` ${message}` : ""
            }`
          )
        );
        throw httpError;
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
        throw createCliError(
          redactSecrets(`${transport.label} GraphQL errors: ${message}`),
          "NETWORK"
        );
      }
      if (!result.data) {
        throw createCliError(
          `${transport.label} GraphQL response did not contain data.`,
          "NETWORK"
        );
      }
      return result.data;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };

  let lastError: unknown;
  for (let attempt = 0; attempt < retryCfg.maxAttempts; attempt += 1) {
    try {
      return await sendOnce();
    } catch (error) {
      lastError = error;

      if (error instanceof HttpError && retryCfg.retryableStatuses.has(error.status)) {
        if (attempt < retryCfg.maxAttempts - 1) {
          await sleep(computeBackoff(attempt, retryCfg, error.retryAfterSeconds));
          continue;
        }
      } else if (
        error instanceof Error &&
        error.name === "AbortError" &&
        attempt < retryCfg.maxAttempts - 1 &&
        // Honor explicit per-call timeoutMs as a hard cap — if the caller
        // set one, an abort means "took longer than the budget", and
        // silently retrying behind their back violates their intent.
        // Without timeoutMs, an abort is most likely a transient
        // upstream cancellation (proxy hiccup) — safe to retry.
        options?.timeoutMs === undefined
      ) {
        await sleep(computeBackoff(attempt, retryCfg));
        continue;
      } else if (
        // `fetch` failures from network blips (DNS, ECONNRESET, EAI_AGAIN, etc.)
        // surface as `TypeError: fetch failed` in Node's undici. Retry these.
        error instanceof TypeError &&
        attempt < retryCfg.maxAttempts - 1
      ) {
        await sleep(computeBackoff(attempt, retryCfg));
        continue;
      }

      break;
    }
  }

  // Final mapping to CliError. HttpError → NETWORK; AbortError → timeout hint;
  // everything else → generic NETWORK with the original message.
  if (lastError instanceof HttpError) {
    throw createCliError(lastError.message, "NETWORK");
  }
  if (lastError instanceof Error && lastError.name === "AbortError") {
    throw createCliError(`Sitecore ${transport.label} API request timed out.`, "NETWORK", {
      hint: "Increase settings.apiClientTimeoutInMinutes if needed.",
    });
  }
  if (lastError instanceof Error) {
    if ("code" in lastError && (lastError as { code?: unknown }).code) {
      // Already a CliError-shaped object — re-throw as-is.
      throw lastError;
    }
    throw createCliError(
      redactSecrets(`Sitecore ${transport.label} API request failed: ${lastError.message}`),
      "NETWORK"
    );
  }
  throw createCliError(
    redactSecrets(`Sitecore ${transport.label} API request failed: ${String(lastError)}`),
    "NETWORK"
  );
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSeconds: number | undefined,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}
