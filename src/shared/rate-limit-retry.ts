/**
 * Fetch with retry on HTTP 429 (rate limit).
 *
 * Sitecore's Orchestrate (campaign) and Brief APIs sit in front of Cosmos
 * DB, which returns **429 TooManyRequests** (`Sub Status 3200`) with an
 * `x-ms-retry-after-ms` hint when the per-second RU budget is exceeded —
 * common when a reconnect pushes a whole story's campaigns → deliverables
 * → tasks in a burst.
 *
 * A 429 is rejected by Cosmos BEFORE the request is processed, so retrying
 * is safe even for non-idempotent writes (PUT/POST/PATCH) — unlike a 5xx,
 * which may have partially applied. We therefore retry 429 for ALL methods.
 *
 * The wait is the server's hint when present (`x-ms-retry-after-ms`, else a
 * standard `Retry-After` in seconds or as an HTTP-date), otherwise
 * exponential backoff + jitter capped at {@link MAX_BACKOFF_MS}. Network
 * errors and every non-429 response are returned/propagated unchanged for
 * the caller to map — this helper owns ONLY the rate-limit retry, nothing
 * else about the transport.
 *
 * Leaf module: imports no domain area (`src/shared/` constraint).
 */

/** Default number of 429 retries before giving up. Override via env. */
const DEFAULT_MAX_429_RETRIES = 5;
/** Base delay for the exponential-backoff fallback (ms). Override via env. */
const DEFAULT_BASE_MS = 500;
/** Cap on a single backoff wait so a hostile/garbage hint can't hang a run. */
const MAX_BACKOFF_MS = 20_000;

/**
 * Read the server's retry hint. Cosmos surfaces `x-ms-retry-after-ms`
 * (milliseconds); a plain `Retry-After` is seconds or an HTTP-date.
 * Returns the wait in ms (capped), or undefined when no usable hint exists.
 */
const parseRetryAfterMs = (response: Response): number | undefined => {
  const ms = response.headers.get("x-ms-retry-after-ms");
  if (ms !== null) {
    const n = Number(ms);
    if (Number.isFinite(n) && n >= 0) return Math.min(n, MAX_BACKOFF_MS);
  }
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, MAX_BACKOFF_MS);
    const at = Date.parse(retryAfter);
    if (!Number.isNaN(at)) return Math.min(Math.max(0, at - Date.now()), MAX_BACKOFF_MS);
  }
  return undefined;
};

export interface RateLimitRetryOptions {
  /** Per-attempt timeout (ms). 0 disables the per-attempt timeout. */
  timeoutMs: number;
  /** Max 429 retries (default {@link DEFAULT_MAX_429_RETRIES} / env). */
  maxRetries?: number;
  /** Backoff base in ms (default {@link DEFAULT_BASE_MS} / env). */
  baseMs?: number;
  /** Caller's cancellation signal — chained into each attempt's timeout. */
  signal?: AbortSignal;
}

/**
 * `fetch` with transparent retry on HTTP 429. The final response (a non-429
 * outcome, or a 429 after the retry budget is spent) is returned for the
 * caller to handle exactly as before.
 */
export const fetchWithRateLimitRetry = async (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
  opts: RateLimitRetryOptions
): Promise<Response> => {
  const maxRetries =
    opts.maxRetries ?? Number(process.env.SITECOREAI_HTTP_429_RETRIES ?? DEFAULT_MAX_429_RETRIES);
  const baseMs = opts.baseMs ?? Number(process.env.SITECOREAI_HTTP_429_BASE_MS ?? DEFAULT_BASE_MS);

  let attempt = 0;
  for (;;) {
    const controller = opts.timeoutMs > 0 ? new AbortController() : undefined;
    const timeoutHandle = controller
      ? setTimeout(() => controller.abort(), opts.timeoutMs)
      : undefined;
    // Chain the caller's signal so external cancellation aborts the attempt.
    if (controller && opts.signal) {
      if (opts.signal.aborted) controller.abort();
      else
        opts.signal.addEventListener("abort", () => controller.abort(), {
          once: true,
        });
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        signal: controller?.signal ?? opts.signal,
      });
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }

    if (response.status !== 429 || attempt >= maxRetries) return response;

    attempt += 1;
    const hinted = parseRetryAfterMs(response);
    const backoff = Math.min(MAX_BACKOFF_MS, baseMs * 2 ** (attempt - 1));
    const jitter = Math.floor(Math.random() * baseMs);
    const delay = hinted ?? backoff + jitter;
    // Release the throttled response body so the socket can be reused.
    await response.body?.cancel().catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
};
