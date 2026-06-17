import { redactSecrets } from "../../../shared/redact";
import { createScaiError } from "../../../shared/errors";
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
