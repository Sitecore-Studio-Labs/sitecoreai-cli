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
 * `serialization/api/graphql.ts` are thin wrappers that supply
 * the per-API constants.
 */

import type { EnvironmentConfiguration } from "@/config/types";
import { sleep } from "./concurrency";
import { createScaiError } from "./errors";
import { redactSecrets } from "./redact";
import { assertValidUrl } from "./validate";

type GetAccessToken = (environment: EnvironmentConfiguration) => Promise<string | undefined>;

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{
    message: string;
    path?: Array<string | number>;
    /**
     * Sitecore Authoring GraphQL attaches a structured `code` (and
     * sometimes a stack/message bundle) under `extensions`. Preserved
     * verbatim so callers can match on `extensions.code` instead of
     * fragile message-text scraping.
     */
    extensions?: Record<string, unknown>;
  }>;
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
  /**
   * Whether AMBIGUOUS network failures — a client-side abort (our own
   * timeout) or a `TypeError: fetch failed` — are retryable. Default true.
   * Reads and idempotent callers leave it on. Mutation callers set it false:
   * after such a failure the request MAY have applied server-side, so a retry
   * risks a duplicate write. A server-side "operation was canceled" GraphQL
   * error is NOT gated by this — a cancelled op is rolled back (never applied)
   * so it is always safe to retry.
   */
  retryAmbiguousNetwork?: boolean;
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
  retryAmbiguousNetwork: true,
};

/**
 * A server-side cancellation of a GraphQL operation — the Authoring API's
 * `OperationCanceledException`, surfaced as an error message like "The
 * operation was canceled." under load or on a long-running mutation (e.g. a
 * localize pass writing many language versions at once). A cancelled operation
 * is aborted and rolled back, so it did NOT apply — always safe to retry, even
 * for a write.
 */
const CANCELLATION_MESSAGE_RE = /operation was cancel?led|operationcancell?ed/i;
const isCancellationErrors = (errors: ReadonlyArray<{ message?: string }>): boolean =>
  errors.some((e) => CANCELLATION_MESSAGE_RE.test(e.message ?? ""));

/**
 * Read-only callers can opt in to a broader retry set that includes
 * ambiguous 5xx codes. Safe for GETs since reads are idempotent — a
 * second fetch is harmless. Unsafe for mutations because 500/502/504
 * may indicate the server processed the request but failed to respond,
 * and retrying would create a duplicate.
 */
export const READ_RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

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

/**
 * Cloudflare serves an HTML error page (never JSON) when a request dies at its
 * edge. Sitecore's Authoring/Management APIs only ever return JSON, so a
 * Cloudflare HTML body is an unambiguous infra-transient failure — the CM host
 * was momentarily unroutable (commonly a cold-scaled or newly-provisioned
 * environment), not the API's own error. The status Cloudflare serves it under
 * is unrelated to the API (a 1018 "could not find host" page can arrive as a
 * 4xx/5xx that has nothing to do with a real conflict), so we detect the page
 * itself rather than trust the status — to (a) retry it and (b) surface a
 * concise message instead of dumping the raw HTML under a misleading code.
 *
 * Two retry classes:
 * - "safe": the request never reached the Sitecore origin (host / DNS /
 *   origin-down — Cloudflare 1016, 1018, 521, 523), so it did NOT apply —
 *   safe to retry even for a write (like a server-side cancellation).
 * - "ambiguous": the origin may have received it (524 edge timeout, 520), so
 *   retry only when the caller allows ambiguous-network retries — matching the
 *   abort / `fetch failed` posture, so mutation callers don't risk a duplicate.
 */
const CLOUDFLARE_EDGE_MARKER_RE = /cloudflare|cf-error-|cdn-cgi|\bcf-ray\b|\bray id\b/i;
const CLOUDFLARE_UNREACHED_ORIGIN_RE =
  /could not find host|origin dns error|web server is down|origin is unreachable|error\s*(?:10(?:16|18)|52[13])\b/i;

const cloudflareEdgeTitle = (body: string): string | undefined => {
  const title = /<title>\s*([^<|]+?)\s*(?:\||<\/title>)/i.exec(body)?.[1]?.trim();
  return title && !/^cloudflare$/i.test(title) ? title : undefined;
};

export const classifyCloudflareEdgeError = (
  body: unknown
): { retry: "safe" | "ambiguous"; summary: string } | undefined => {
  // Only a non-JSON (string) body can be a Cloudflare page; a genuine Sitecore
  // JSON error parses to an object and never reaches this classifier.
  if (typeof body !== "string" || !CLOUDFLARE_EDGE_MARKER_RE.test(body)) {
    return undefined;
  }
  const retry: "safe" | "ambiguous" = CLOUDFLARE_UNREACHED_ORIGIN_RE.test(body)
    ? "safe"
    : "ambiguous";
  const title = cloudflareEdgeTitle(body);
  return {
    retry,
    summary: `host temporarily unreachable at the Cloudflare edge${title ? ` (${title})` : ""}`,
  };
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
  // Reject http:// (and every other non-https scheme) before a Bearer token
  // rides this URL — every Sitecore GraphQL POST inherits this scheme. A bare
  // host got the https:// prefix above, so this only bites when an operator
  // explicitly persisted or passed an http:// host. assertValidUrl honours the
  // SITECOREAI_ALLOW_HTTP=1 dev-only escape hatch.
  assertValidUrl(withScheme, "Environment host");
  return withScheme.endsWith("/") ? withScheme.slice(0, -1) : withScheme;
};

/**
 * Build the `HttpError` for a non-2xx response. A Cloudflare edge page (HTML,
 * never JSON) means the request died at the CDN, not inside the API — surface
 * it as a concise, classified, retryable edge failure rather than the raw page
 * under a misleading status. A genuine JSON API error parses to an object and
 * is reported verbatim (with its real status).
 */
const buildHttpErrorFromResponse = async (
  response: Response,
  transport: GraphQLTransportConfig
): Promise<HttpError> => {
  const body = await parseJsonIfPossible(response);
  const edge = classifyCloudflareEdgeError(body);
  const rawMessage =
    typeof body === "string"
      ? body
      : body && typeof body === "object"
        ? JSON.stringify(body)
        : undefined;
  return new HttpError(
    response.status,
    // Test mocks of `Response` may omit `headers`; defensive access avoids
    // `Cannot read properties of undefined`. Production `fetch` always
    // populates a `Headers` object.
    parseRetryAfter(response.headers?.get?.("retry-after") ?? null),
    redactSecrets(
      edge
        ? `Sitecore ${transport.label} API ${edge.summary}.`
        : `Sitecore ${transport.label} API request failed (${response.status}).${
            rawMessage ? ` ${rawMessage}` : ""
          }`
    ),
    edge?.retry
  );
};

/**
 * Whether a failed attempt should be retried. Extracted from the retry loop so
 * the transport's control flow stays flat; the loop guards the attempt count
 * and picks the backoff delay.
 *
 * - HttpError: a retryable status, OR a Cloudflare edge failure — "safe" (never
 *   reached origin) always retries; "ambiguous" (524/520) only when the caller
 *   allows ambiguous-network retries.
 * - A server-side cancellation (rolled back, never applied) always retries,
 *   even for writes.
 * - An AbortError (our own timeout) retries only for ambiguous-network callers
 *   AND when no explicit per-call timeout was set — an explicit budget is a
 *   hard cap we must honor rather than silently retry behind.
 * - A `TypeError: fetch failed` (DNS/ECONNRESET/EAI_AGAIN blip) retries for
 *   ambiguous-network callers.
 */
const shouldRetryTransportError = (
  error: unknown,
  retryCfg: Required<RetryOptions>,
  options: GraphQLRequestOptions | undefined
): boolean => {
  if (error instanceof HttpError) {
    return (
      retryCfg.retryableStatuses.has(error.status) ||
      error.edgeRetry === "safe" ||
      (error.edgeRetry === "ambiguous" && retryCfg.retryAmbiguousNetwork)
    );
  }
  if ((error as { retryableCancellation?: boolean })?.retryableCancellation === true) {
    return true;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return retryCfg.retryAmbiguousNetwork && options?.timeoutMs === undefined;
  }
  if (error instanceof TypeError) {
    return retryCfg.retryAmbiguousNetwork;
  }
  return false;
};

export const runSitecoreGraphQL = async <T>(
  environment: EnvironmentConfiguration,
  query: string,
  variables: Record<string, unknown> | undefined,
  transport: GraphQLTransportConfig,
  options?: GraphQLRequestOptions
): Promise<T> => {
  if (!environment.host) {
    throw createScaiError("Environment host is not configured.", "INPUT_INVALID", {
      hint: "Set a CM host with 'scai setup init' or pass --host.",
    });
  }
  const hostUrl = normalizeHostUrl(environment.host);
  const url = `${hostUrl}${transport.servicePath}`;

  const token = await transport.getAccessToken(environment);
  if (transport.requireToken && !token) {
    throw createScaiError(
      `Sitecore ${transport.label} API requires an access token.`,
      "AUTH_REQUIRED",
      {
        hint: "Authenticate with 'scai setup login', then run 'scai setup client create <env>' to provision the CM automation client this API mints its token from.",
      }
    );
  }

  const retryCfg: Required<RetryOptions> = {
    ...DEFAULT_RETRY,
    ...(options?.retry ?? {}),
  };

  const sendOnce = async (): Promise<T> => {
    // Default to 60s if neither the caller nor SITECOREAI_REQUEST_TIMEOUT_MS
    // sets one. Defends against slowloris / black-hole upstreams that send
    // response headers then stall the body indefinitely. `options.timeoutMs`
    // stays undefined when defaulting — the retry-on-abort heuristic at the
    // outer attempt loop (~L281) still treats explicit caller timeouts as
    // "definitive" and default-timeouts as "probably transient, safe to retry".
    const resolvedTimeoutMs =
      options?.timeoutMs ?? Number(process.env.SITECOREAI_REQUEST_TIMEOUT_MS ?? 60_000);
    const controller = resolvedTimeoutMs > 0 ? new AbortController() : undefined;
    const timeout = controller
      ? setTimeout(() => controller.abort(), resolvedTimeoutMs)
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
        throw await buildHttpErrorFromResponse(response, transport);
      }

      const parsed = await parseJsonIfPossible(response);
      if (!parsed || typeof parsed !== "object") {
        throw createScaiError(
          `${transport.label} GraphQL response did not contain JSON data.`,
          "NETWORK"
        );
      }
      const result = parsed as GraphQLResponse<T>;
      if (result.errors?.length) {
        const message = result.errors.map((error) => error.message).join("; ");
        // Surface any structured `extensions` payloads as `details` so
        // callers can pattern-match on `extensions.code` / `code` /
        // `errorCode` without re-parsing the human-readable message.
        // Each detail line is one GraphQL error's extensions blob,
        // JSON-stringified. Errors without extensions are dropped.
        const details = result.errors
          .map((error) => (error.extensions ? JSON.stringify(error.extensions) : undefined))
          .filter((line): line is string => typeof line === "string");
        const gqlError = createScaiError(
          redactSecrets(`${transport.label} GraphQL errors: ${message}`),
          "NETWORK",
          details.length > 0 ? { details } : undefined
        );
        // A server-side cancellation is rolled back (never applied), so flag
        // it retryable even for writes — the retry loop honors this.
        if (isCancellationErrors(result.errors)) {
          (gqlError as { retryableCancellation?: boolean }).retryableCancellation = true;
        }
        throw gqlError;
      }
      if (!result.data) {
        throw createScaiError(
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

      if (
        attempt < retryCfg.maxAttempts - 1 &&
        shouldRetryTransportError(error, retryCfg, options)
      ) {
        // Only an HttpError carries a `Retry-After`; other retryable failures
        // fall back to exponential backoff.
        const retryAfter = error instanceof HttpError ? error.retryAfterSeconds : undefined;
        await sleep(computeBackoff(attempt, retryCfg, retryAfter));
        continue;
      }

      break;
    }
  }

  // Final mapping to ScaiError. HttpError → NETWORK; AbortError → timeout hint;
  // everything else → generic NETWORK with the original message.
  if (lastError instanceof HttpError) {
    throw createScaiError(
      lastError.message,
      "NETWORK",
      lastError.edgeRetry
        ? {
            hint: "The CM host was momentarily unreachable at the CDN edge — often a cold-scaled or newly-provisioned environment. Retrying shortly usually succeeds.",
          }
        : undefined
    );
  }
  if (lastError instanceof Error && lastError.name === "AbortError") {
    throw createScaiError(`Sitecore ${transport.label} API request timed out.`, "NETWORK", {
      hint: "Increase settings.apiClientTimeoutInMinutes if needed.",
    });
  }
  if (lastError instanceof Error) {
    if ("code" in lastError && (lastError as { code?: unknown }).code) {
      // Already a ScaiError-shaped object — re-throw as-is.
      throw lastError;
    }
    throw createScaiError(
      redactSecrets(`Sitecore ${transport.label} API request failed: ${lastError.message}`),
      "NETWORK"
    );
  }
  throw createScaiError(
    redactSecrets(`Sitecore ${transport.label} API request failed: ${String(lastError)}`),
    "NETWORK"
  );
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSeconds: number | undefined,
    message: string,
    /**
     * Set when the failure is a Cloudflare edge page rather than a real API
     * error. "safe" = the request never reached the origin (retryable even for
     * writes); "ambiguous" = the origin may have received it (retry only when
     * the caller allows ambiguous-network retries).
     */
    readonly edgeRetry?: "safe" | "ambiguous"
  ) {
    super(message);
    this.name = "HttpError";
  }
}
