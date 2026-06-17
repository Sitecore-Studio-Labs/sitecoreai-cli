/**
 * Shared REST transport for Sitecore Cloud JSON APIs.
 *
 * Sister module to `shared/graphql.ts`. Where that one owns the GraphQL
 * wire protocol (POST a query, unwrap `data`/`errors`), this one owns the
 * plain-REST wire protocol: bearer auth, JSON request/response, a
 * timeout/abort guard, optional retry-with-backoff, and a JSON-parse step
 * that tolerates empty / non-JSON bodies.
 *
 * Several REST clients used to hand-roll this plumbing — `deployRequest`
 * (the canonical one), plus near-identical copies in `sites/api/request.ts`,
 * `brand/api/client.ts`, and `publishing/api/client.ts`. They target
 * different hosts with different auth and different error-body shapes, but
 * everything *except* those per-API concerns was duplicated.
 *
 * This module owns the spine. The per-API specifics — how to obtain a
 * bearer token, which status codes retry, how to turn a non-2xx body into
 * a `ScaiError`, and which empty-body statuses mean "no content" — are
 * injected via {@link RestRequestConfig}. The four clients become thin
 * wrappers that supply those constants.
 *
 * Hard-leaf constraint: `src/shared/` imports no domain area. Auth is
 * *injected* (a callback or a pre-resolved header), never imported, so
 * this module never reaches across a layer boundary. Type-only `@/config`
 * imports are allowed (graphql.ts follows the same rule).
 */

import { createScaiError, type ScaiError, type ScaiErrorCode } from "./errors";
import { redactSecrets } from "./redact";

/**
 * Pull the field-level detail out of an error body's `errors` member.
 * ASP.NET `ValidationProblemDetails` shapes it as `Record<string,
 * string[]>` (field → messages); some endpoints use an array of
 * `{ message }` objects instead. This detail is the part that actually
 * says what was wrong — the sibling `title` is only the generic
 * "One or more validation errors occurred."
 */
const extractFieldErrors = (errors: unknown): string | undefined => {
  if (Array.isArray(errors)) {
    const parts = errors
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (entry && typeof entry === "object") {
          const entryRecord = entry as Record<string, unknown>;
          const entryMessage = entryRecord.message ?? entryRecord.detail ?? entryRecord.error;
          if (typeof entryMessage === "string") {
            return entryMessage;
          }
        }
        return undefined;
      })
      .filter((value): value is string => Boolean(value));
    return parts.length > 0 ? parts.join("; ") : undefined;
  }
  if (errors && typeof errors === "object") {
    const parts: string[] = [];
    for (const [field, messages] of Object.entries(errors as Record<string, unknown>)) {
      if (Array.isArray(messages)) {
        const flat = messages.filter((m): m is string => typeof m === "string");
        if (flat.length > 0) {
          parts.push(field ? `${field}: ${flat.join(" ")}` : flat.join(" "));
        }
      } else if (typeof messages === "string" && messages.trim().length > 0) {
        parts.push(field ? `${field}: ${messages.trim()}` : messages.trim());
      }
    }
    return parts.length > 0 ? parts.join("; ") : undefined;
  }
  return undefined;
};

/**
 * Best-effort human-readable message out of an arbitrary JSON error body.
 * Handles the three shapes scai's upstreams emit: a bare string, an
 * ASP.NET `ProblemDetails` (`detail`/`title`/`errors`), and a
 * FastAPI/pydantic `detail: [{ loc, msg }]` array. The generic summary
 * (`detail`/`message`/`title`/`error`) is captured but never allowed to
 * short-circuit ahead of the field-level `errors` detail, which is the
 * part that actually says what was wrong.
 *
 * Previously lived in `deploy/api/common/request.ts`; lifted here so the
 * deploy and sites clients share one implementation.
 */
export const extractErrorMessage = (body: unknown): string | undefined => {
  if (typeof body === "string") {
    return body;
  }
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const record = body as Record<string, unknown>;

  // The generic summary. For an ASP.NET ValidationProblemDetails this is
  // only "One or more validation errors occurred." — so it must NOT
  // short-circuit ahead of the field-level `errors` detail below.
  let summary: string | undefined;
  for (const candidate of [record.detail, record.message, record.title, record.error]) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      summary = candidate.trim();
      break;
    }
  }

  // FastAPI / pydantic shape: `detail: [{loc: ["body", "due_date"],
  // msg: "Field required", type: "missing"}, …]`. The Orchestrate API
  // returns this. Without this branch a 422 surfaces as just
  // "(422)" — opaque to operators and worker logs.
  if (Array.isArray(record.detail)) {
    const fastApi = record.detail
      .map((d) => {
        if (!d || typeof d !== "object") return undefined;
        const entry = d as { loc?: unknown; msg?: unknown };
        const loc = Array.isArray(entry.loc)
          ? entry.loc.map((p) => String(p)).join(".")
          : undefined;
        const msg = typeof entry.msg === "string" ? entry.msg : undefined;
        if (!msg) return undefined;
        return loc ? `${loc}: ${msg}` : msg;
      })
      .filter((s): s is string => Boolean(s))
      .join("; ");
    if (fastApi) return summary ? `${summary} ${fastApi}` : fastApi;
  }

  const fieldErrors = extractFieldErrors(record.errors);
  if (fieldErrors) {
    return summary ? `${summary} ${fieldErrors}` : fieldErrors;
  }
  return summary;
};

/**
 * Read a response body once and parse it as JSON, tolerating empty and
 * non-JSON bodies. Returns `undefined` for an empty body, the parsed
 * value for valid JSON, and the raw text for anything that fails to
 * parse (e.g. an HTML 500 page). Used on both the success and error
 * paths so a single `text()` read covers both.
 *
 * Previously lived in `deploy/api/common/request.ts`; lifted here as the
 * single source for every REST client.
 */
export const parseJsonIfPossible = async (response: Response): Promise<unknown> => {
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

/** Multiply a delay by a 0.5–1.5× jitter factor to de-correlate retries. */
const withJitter = (value: number): number => {
  const jitter = 0.5 + Math.random();
  return Math.round(value * jitter);
};

export interface RestRetryConfig {
  /**
   * Total retries (in addition to the first attempt) on transient
   * failures. Default 0 — no retry — so clients keep their current
   * "fail fast" semantics unless they opt in.
   */
  maxRetries?: number;
  /** Base backoff in ms; doubled per attempt and jittered ±50%. Default 500. */
  retryBaseMs?: number;
  /**
   * Decide whether a non-2xx `Response` is worth retrying. Called with
   * the status and the request method. Defaults to never. Deploy/sites
   * pass a GET-only "429 or 5xx" predicate here.
   */
  shouldRetryStatus?: (status: number, method: string) => boolean;
  /**
   * Whether a *network* error (fetch rejection — DNS, ECONNRESET, an
   * abort) is worth retrying. Called with the request method. Defaults
   * to never. Deploy retries network errors on GET only.
   */
  shouldRetryNetworkError?: (method: string) => boolean;
}

/**
 * Per-attempt auth + auth-failure recovery. Lets a client mint a bearer
 * token lazily and, on an auth-failure status, refresh it and retry once
 * — the Brand API's documented 24h-token-expiry recovery. Kept separate
 * from {@link RestRetryConfig} (which does backoff on transient statuses)
 * because an auth refresh is a credential operation, not a backoff wait,
 * and it must run *between* attempts so the retry carries a fresh token.
 */
export interface RestAuthConfig {
  /** Resolve the `Authorization` header value (e.g. `Bearer <token>`) for an attempt. */
  getAuthHeader: () => Promise<string>;
  /**
   * Status that signals a stale token (typically `401`). When the first
   * attempt returns this, the transport calls {@link onAuthFailure},
   * re-resolves the header via {@link getAuthHeader}, and retries exactly
   * once. A second occurrence is surfaced as an error.
   */
  refreshOnStatus: number;
  /** Invoked before the single auth retry — e.g. clear the cached token. */
  onAuthFailure: () => Promise<void>;
}

export interface RestRequestConfig {
  /**
   * Fully-resolved request URL (host + path + query). Callers build this
   * — the various clients disagree on query encoding and base-URL
   * joining, and that's their concern, not the transport's.
   */
  url: string;
  /** HTTP method. Defaults to `GET`. */
  method?: string;
  /**
   * Serialized request body. Already a string (or `undefined`); the
   * caller decides how to stringify so each client controls its own
   * `Content-Type` handling.
   */
  body?: string;
  /**
   * Request headers. When {@link RestRequestConfig.auth} is set, the
   * `Authorization` header is filled per-attempt from `auth.getAuthHeader`
   * and merged on top of these; otherwise this must carry a static
   * `Authorization` already.
   */
  headers: Record<string, string>;
  /**
   * Lazy auth + auth-failure recovery (Brand API's 401-clear-and-retry).
   * Omit for static-token clients that pre-set the `Authorization` header.
   */
  auth?: RestAuthConfig;
  /** AbortSignal for caller-driven cancellation, merged with the timeout. */
  signal?: AbortSignal;
  /**
   * Per-attempt timeout in ms. `0` (or negative) disables the guard.
   * Each client resolves this from its own env-var fallbacks before
   * calling in.
   */
  timeoutMs?: number;
  /** Retry behaviour. Omit for no retry. */
  retry?: RestRetryConfig;
  /**
   * Human-readable label for the API, used by the default network-error
   * message — e.g. `"Sites API"`. Wrappers that map their own errors via
   * `mapNetworkError` can ignore this.
   */
  label: string;
  /**
   * Statuses whose body is empty by contract and should resolve to
   * `undefined` instead of being parsed (e.g. `204`, `202`). Default
   * `[204]`.
   */
  emptyStatuses?: ReadonlySet<number>;
  /**
   * Map a non-2xx `Response` to a `ScaiError`. The body has already been
   * read + JSON-parsed (via {@link parseJsonIfPossible}) and is passed in
   * so each client maps its own error-body shape and error code. Must
   * return (not throw) the error to throw.
   */
  mapHttpError: (response: Response, body: unknown) => ScaiError;
  /**
   * Map a fetch rejection (network error / abort) to a `ScaiError`.
   * Defaults to a redacted `NETWORK` error built from `label`.
   */
  mapNetworkError?: (error: unknown) => ScaiError;
}

/**
 * Default fetch-rejection mapper: a redacted `NETWORK` `ScaiError` with a
 * connectivity hint. Matches what the sites/deploy clients emitted by
 * hand. Used when a wrapper doesn't supply its own `mapNetworkError`.
 */
const defaultNetworkErrorMapper =
  (label: string) =>
  (error: unknown): ScaiError =>
    createScaiError(
      redactSecrets(
        `${label} request failed: ${error instanceof Error ? error.message : String(error)}`
      ),
      "NETWORK" as ScaiErrorCode,
      { hint: "Check network connectivity or try again later." }
    );

/**
 * Run a single REST request against a Sitecore Cloud JSON API and return
 * the parsed response. Centralizes the timeout/abort guard, the fetch +
 * retry loop, the JSON parse, and the success/error split. Per-API
 * concerns (auth header, URL building, retry predicates, error mapping)
 * come in through {@link RestRequestConfig}.
 *
 * Throws a `ScaiError` (via `mapHttpError` for non-2xx, `mapNetworkError`
 * for transport failures). Resolves to `undefined as TResponse` for the
 * configured empty-body statuses, otherwise the parsed JSON body.
 */
/**
 * Build the abort signal for one attempt: a timeout controller (when a
 * positive `timeoutMs` is set) chained to the caller's signal, plus the
 * handle to clear. Returns the effective signal and a `clear` callback.
 */
const buildAttemptSignal = (
  config: RestRequestConfig
): { signal: AbortSignal | undefined; clear: () => void } => {
  const timeoutMs = config.timeoutMs;
  const controller = timeoutMs && timeoutMs > 0 ? new AbortController() : undefined;
  const timeoutHandle = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  // Forward the caller's signal too: aborting either the timeout or the
  // caller's signal cancels the in-flight fetch.
  if (controller && config.signal) {
    if (config.signal.aborted) controller.abort();
    else config.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return {
    signal: controller?.signal ?? config.signal,
    clear: () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    },
  };
};

export const runSitecoreRest = async <TResponse>(config: RestRequestConfig): Promise<TResponse> => {
  const method = config.method ? config.method.toUpperCase() : "GET";
  const emptyStatuses = config.emptyStatuses ?? new Set([204]);
  const mapNetworkError = config.mapNetworkError ?? defaultNetworkErrorMapper(config.label);
  const maxRetries = config.retry?.maxRetries ?? 0;
  const retryBaseMs = config.retry?.retryBaseMs ?? 500;

  const backoff = async (attempt: number): Promise<void> => {
    const delay = withJitter(retryBaseMs * 2 ** (attempt - 1));
    await new Promise((resolve) => setTimeout(resolve, delay));
  };

  // Resolve the per-attempt auth header. For an auth-driven client the
  // first call mints/loads the token; a later call (after an auth refresh)
  // re-resolves it. Static-token clients carry it in `headers` and skip this.
  const resolveHeaders = async (): Promise<Record<string, string>> => {
    if (!config.auth) return config.headers;
    const authorization = await config.auth.getAuthHeader();
    return { ...config.headers, Authorization: authorization };
  };

  // Run one fetch attempt, clearing the timeout handle on both paths.
  // Returns the response, or throws once retries are exhausted.
  const runAttempt = async (
    headers: Record<string, string>,
    attempt: number
  ): Promise<{ response: Response } | { retry: true }> => {
    const { signal, clear } = buildAttemptSignal(config);
    try {
      const response = await fetch(config.url, { method, headers, body: config.body, signal });
      clear();
      return { response };
    } catch (error) {
      clear();
      if (attempt < maxRetries && config.retry?.shouldRetryNetworkError?.(method)) {
        return { retry: true };
      }
      throw mapNetworkError(error);
    }
  };

  let authRetried = false;
  let attempt = 0;
  while (true) {
    const headers = await resolveHeaders();
    const outcome = await runAttempt(headers, attempt);
    if ("retry" in outcome) {
      attempt += 1;
      await backoff(attempt);
      continue;
    }
    const { response } = outcome;

    // Auth-failure recovery (Brand API): on a stale-token status, clear the
    // cached token once and retry with a freshly-minted one. A second
    // occurrence falls through to the normal error mapping below.
    if (config.auth && !authRetried && response.status === config.auth.refreshOnStatus) {
      authRetried = true;
      await config.auth.onAuthFailure();
      continue;
    }

    if (!response.ok) {
      if (attempt < maxRetries && config.retry?.shouldRetryStatus?.(response.status, method)) {
        attempt += 1;
        await backoff(attempt);
        continue;
      }
      const body = await parseJsonIfPossible(response);
      throw config.mapHttpError(response, body);
    }

    if (emptyStatuses.has(response.status)) {
      return undefined as TResponse;
    }
    return (await parseJsonIfPossible(response)) as TResponse;
  }
};
