/**
 * Fetch with retry on HTTP 429 (rate limit).
 *
 * Sitecore's Orchestrate (campaign) and Brief APIs sit in front of Cosmos
 * DB, which returns **429 TooManyRequests** (`Sub Status 3200`) with an
 * `x-ms-retry-after-ms` hint when the per-second RU budget is exceeded —
 * common when a reconnect pushes a whole story's campaigns → deliverables
 * → tasks in a burst.
 *
 * We retry 429 ONLY for idempotent methods (GET/HEAD/PUT/DELETE/OPTIONS).
 * A naive "429 is rejected before processing, so retrying any write is safe"
 * is WRONG for the Orchestrate API: creating a campaign is a multi-step POST
 * (project → deliverables → tasks), and the API can apply part of a create
 * before Cosmos throttles a later step and returns 429 to us. Retrying that
 * POST then DUPLICATES the already-created entity (observed: duplicate
 * campaigns on regenerate). POST/PATCH are non-idempotent and carry no
 * idempotency key, so we surface their 429 to the caller instead of
 * retrying. Updates (PUT) and deletes — the bulk of a re-push / reconnect —
 * are idempotent and still retry, which is what the burst actually needs.
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
 * Methods safe to replay after a 429. POST/PATCH are excluded: they're
 * non-idempotent and a partially-applied create would duplicate on retry.
 */
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);

/**
 * Cosmos / Orchestrate rate-limit markers that can appear in a NON-429 error
 * body when Sitecore wraps a throttle in a 5xx (e.g. `(TooManyRequests) The
 * request rate is too large … Sub Status: 3200`). Specific enough not to fire
 * on incidental text.
 */
const THROTTLE_BODY_RE =
  /too\s*many\s*requests|request rate is too large|RequestRateTooLarge|Sub\s*Status:\s*3200/i;

/** Peek a 5xx response body (via clone, so the caller's body stays intact) for a wrapped throttle. */
const isThrottleBody = async (response: Response): Promise<boolean> => {
  if (response.status < 500) return false;
  try {
    return THROTTLE_BODY_RE.test(await response.clone().text());
  } catch {
    return false;
  }
};

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
  // Only replay a 429 for idempotent methods — retrying a non-idempotent
  // POST/PATCH create that partially applied would duplicate it.
  const idempotent = IDEMPOTENT_METHODS.has(init.method.toUpperCase());

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

    // Retry on a throttle for idempotent methods. A clean `429` is the common
    // case, but Sitecore's Orchestrate API sometimes bubbles a Cosmos 429 up
    // INSIDE a 5xx — a raw exception body like
    // `TasksRepository: Error updating item: (TooManyRequests) … Sub Status: 3200`
    // — which never carries the 429 status. Detect that in the body so a
    // throttled PUT/DELETE still retries. (Body peeked via clone() so the
    // caller still gets an intact response on the final return.)
    const throttled = idempotent && (response.status === 429 || (await isThrottleBody(response)));
    if (!throttled || attempt >= maxRetries) return response;

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
