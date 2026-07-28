import { redactSecrets } from "@/shared/redact";
import { createScaiError } from "@/shared/errors";
// `extractErrorMessage` + `parseJsonIfPossible` are the canonical REST
// error/parse helpers — they now live in `shared/rest.ts` (the single
// source shared with the sites/brand/publishing transports). Re-exported
// here so the many deploy modules (and campaigns/brief) that import them
// from this path keep working unchanged.
import { extractErrorMessage, parseJsonIfPossible } from "@/shared/rest";
export { extractErrorMessage, parseJsonIfPossible };
import { getDeployTransportListener, type DeployRequestSpan } from "./transport-events";
import {
  DEFAULT_DEPLOY_API_BASE,
  DeployApiClientOptions,
  DeployQueryValueList,
  DeployRequestInit,
} from "./types";

const toQueryString = (query?: Record<string, DeployQueryValueList | undefined>): string => {
  if (!query) {
    return "";
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        params.append(key, String(entry));
      }
      continue;
    }
    params.set(key, String(value));
  }
  const output = params.toString();
  return output ? `?${output}` : "";
};

const withJitter = (value: number): number => {
  const jitter = 0.5 + Math.random();
  return Math.round(value * jitter);
};

/**
 * Resolve a transport tuning value: explicit caller value wins; falls
 * back to env-var; falls back to built-in default. Pure-library callers
 * pass these explicitly via `init.transport` so they don't depend on
 * scai's env namespace; the CLI keeps env-var fallbacks unchanged.
 */
const resolveTransportInt = (
  explicit: number | undefined,
  envVar: string,
  defaultValue: number
): number => {
  if (explicit !== undefined) return explicit;
  const raw = process.env[envVar];
  if (raw === undefined) return defaultValue;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : defaultValue;
};

const resolveTransportBool = (explicit: boolean | undefined, envVar: string): boolean => {
  if (explicit !== undefined) return explicit;
  return process.env[envVar] === "1";
};

/** Build the request headers + serialized body for a deploy call. */
const buildRequestPayload = (
  options: DeployApiClientOptions,
  init: DeployRequestInit | undefined
): { headers: Record<string, string>; body: string | undefined } => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.accessToken}`,
    Accept: "application/json",
  };
  if (init?.headers) {
    Object.assign(headers, init.headers);
  }
  let body: string | undefined;
  if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = typeof init.body === "string" ? init.body : JSON.stringify(init.body);
  }
  return { headers, body };
};

interface RetryTuning {
  maxRetries: number;
  retryBaseMs: number;
  timeoutMs: number;
  traceEnabled: boolean;
}

/** Resolve the retry/timeout/trace knobs from init + env-var fallbacks. */
const resolveRetryTuning = (init: DeployRequestInit | undefined): RetryTuning => ({
  maxRetries: resolveTransportInt(init?.transport?.maxRetries, "SITECOREAI_HTTP_RETRIES", 2),
  retryBaseMs: resolveTransportInt(
    init?.transport?.retryBaseMs,
    "SITECOREAI_HTTP_RETRY_BASE_MS",
    500
  ),
  // Default 60s per-attempt timeout. Override via SITECOREAI_REQUEST_TIMEOUT_MS
  // or init.transport.timeoutMs (0 disables). Defends against slowloris /
  // black-hole upstreams.
  timeoutMs: resolveTransportInt(
    init?.transport?.timeoutMs,
    "SITECOREAI_REQUEST_TIMEOUT_MS",
    60_000
  ),
  traceEnabled: resolveTransportBool(init?.transport?.traceHttp, "SITECOREAI_TRACE_HTTP"),
});

interface FetchLoopParams {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  tuning: RetryTuning;
  span: DeployRequestSpan | null;
}

/**
 * Run the fetch with exponential-backoff retry on network errors and
 * retryable status codes (GET only). Throws a NETWORK ScaiError when a
 * network error exhausts the retry budget; otherwise returns the final
 * `Response` (which may still be `!response.ok`).
 */
const fetchWithRetry = async (params: FetchLoopParams): Promise<Response> => {
  const { url, method, headers, body, tuning, span } = params;
  const { maxRetries, retryBaseMs, timeoutMs, traceEnabled } = tuning;
  const shouldRetry = (status?: number): boolean =>
    method === "GET" && (status === 429 || (status !== undefined && status >= 500));
  const backoff = async (attempt: number): Promise<void> => {
    const delay = withJitter(retryBaseMs * Math.pow(2, attempt - 1));
    await new Promise((resolve) => setTimeout(resolve, delay));
  };

  let attempt = 0;
  while (true) {
    const controller = timeoutMs > 0 ? new AbortController() : undefined;
    const timeoutHandle = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    let response: Response;
    try {
      if (traceEnabled) {
        getDeployTransportListener()?.onTrace?.(`HTTP ${method} ${url}`);
      }
      response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller?.signal,
      });
    } catch {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (attempt < maxRetries && method === "GET") {
        attempt += 1;
        await backoff(attempt);
        continue;
      }
      span?.fail();
      throw createScaiError("Deploy API request failed due to a network error.", "NETWORK", {
        hint: "Check network connectivity or try again later.",
      });
    }

    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (!response.ok && shouldRetry(response.status) && attempt < maxRetries) {
      attempt += 1;
      await backoff(attempt);
      continue;
    }
    return response;
  }
};

export const deployRequest = async <T>(
  options: DeployApiClientOptions,
  path: string,
  query?: Record<string, DeployQueryValueList | undefined>,
  init?: DeployRequestInit
): Promise<T> => {
  const baseUrl = options.baseUrl ?? DEFAULT_DEPLOY_API_BASE;
  const url = `${baseUrl.replace(/\/$/, "")}${path}${toQueryString(query)}`;
  const method = init?.method ? init.method.toUpperCase() : "GET";
  const span =
    (await getDeployTransportListener()?.onRequestStart?.(method, path, Boolean(init?.silent))) ??
    null;
  if (init?.whatIf) {
    span?.succeed();
    return {
      whatIf: true,
      request: {
        method,
        path,
        url,
        query,
        body: init?.body,
      },
    } as T;
  }
  const tuning = resolveRetryTuning(init);
  const { headers, body } = buildRequestPayload(options, init);

  const response = await fetchWithRetry({ url, method, headers, body, tuning, span });

  if (!response.ok) {
    span?.fail();
    const body = await parseJsonIfPossible(response);
    const message = extractErrorMessage(body);
    const sanitized = message ? redactSecrets(message) : undefined;
    throw createScaiError(
      sanitized ?? `Deploy API request failed (${response.status})`,
      "DEPLOY_FAILED"
    );
  }

  span?.succeed();
  if (tuning.traceEnabled) {
    getDeployTransportListener()?.onTrace?.(`HTTP ${method} ${path} -> ${response.status}`);
  }
  return (await parseJsonIfPossible(response)) as T;
};
