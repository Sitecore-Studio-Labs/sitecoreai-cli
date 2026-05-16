/**
 * Agentic Studio BFF transport — `agentsRequest()` + `agentsStream()`.
 *
 * The BFF is the Next.js app at `agentic-studio-<region>.sitecorecloud.io`;
 * its `/api/*` routes are reverse-engineered and unversioned (see the
 * project memory `project_scai_agentic_studio_api`), so callers parse
 * responses defensively.
 *
 * Errors map to `ScaiError`: `NETWORK` for transport failures,
 * `AUTH_REQUIRED` for an expired/absent session (401), `AUTH_DENIED` for
 * the Builder-role gate (403), `AGENTS_API_FAILED` otherwise.
 */
import { createScaiError, type ScaiError } from "@/shared/errors";
import { redactSecrets } from "@/shared/redact";
import type { AgentsRequestInit, AgentsSession } from "../session/types";

const toQueryString = (query?: AgentsRequestInit["query"]): string => {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const output = params.toString();
  return output ? `?${output}` : "";
};

const requestTimeoutMs = (): number => Number(process.env.SITECOREAI_REQUEST_TIMEOUT_MS ?? 60_000);

const buildHeaders = (
  session: AgentsSession,
  init?: AgentsRequestInit,
  hasBody = false
): Record<string, string> => {
  const headers: Record<string, string> = {
    ...session.authHeaders(),
    // `*/*` (not `application/json`) — the browser sends it and the edge
    // WAF is picky. Same-origin Origin/Referer cover CSRF checks on writes.
    Accept: "*/*",
    Origin: session.baseUrl,
    Referer: `${session.baseUrl}/`,
    ...(init?.headers ?? {}),
  };
  if (hasBody) headers["Content-Type"] = "application/json";
  return headers;
};

const serializeBody = (body: unknown): string | undefined => {
  if (body === undefined) return undefined;
  return typeof body === "string" ? body : JSON.stringify(body);
};

/** Map a non-2xx Agentic Studio response (with its body text) to a `ScaiError`. */
const mapHttpError = (status: number, body: string): ScaiError => {
  if (status === 401) {
    return createScaiError("Agentic Studio session is expired or missing.", "AUTH_REQUIRED", {
      hint: "Run `scai agents login` to capture a fresh browser session.",
    });
  }
  if (status === 403 && /builder/i.test(body)) {
    return createScaiError(
      "Agentic Studio rejected the request: Builder role and license required.",
      "AUTH_DENIED",
      {
        hint: "In Agentic Studio → User Management, set your account to Builder and confirm a Builder license seat, then retry.",
      }
    );
  }
  let message = `Agentic Studio request failed (${status}).`;
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    const detail = parsed.error ?? parsed.message;
    if (typeof detail === "string" && detail) message = detail;
  } catch {
    /* non-JSON body — keep the generic message */
  }
  return createScaiError(redactSecrets(message), "AGENTS_API_FAILED");
};

/** Node `fetch` reports the real failure on `error.cause` — surface it. */
const describeCause = (error: unknown): string => {
  if (!(error instanceof Error)) return "";
  const cause = (error as { cause?: unknown }).cause;
  if (cause === undefined) return "";
  const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? ` [${String((cause as { code?: unknown }).code)}]`
      : "";
  return ` (cause: ${detail}${code})`;
};

const networkError = (error: unknown): ScaiError =>
  createScaiError(
    redactSecrets(
      `Agentic Studio request failed: ${
        error instanceof Error ? error.message : String(error)
      }${describeCause(error)}`
    ),
    "NETWORK",
    { hint: "Check network connectivity or try again later." }
  );

/** Issue a JSON request against a BFF `/api/*` path. */
export const agentsRequest = async <TResponse>(
  session: AgentsSession,
  path: string,
  init?: AgentsRequestInit
): Promise<TResponse> => {
  const url = `${session.baseUrl}${path}${toQueryString(init?.query)}`;
  const method = init?.method ? init.method.toUpperCase() : "GET";
  const body = serializeBody(init?.body);
  const headers = buildHeaders(session, init, body !== undefined);

  const timeoutMs = requestTimeoutMs();
  const controller = timeoutMs > 0 && !init?.signal ? new AbortController() : undefined;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      signal: init?.signal ?? controller?.signal,
    });
  } catch (error) {
    throw networkError(error);
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  const text = await response.text();
  if (!response.ok) {
    throw mapHttpError(response.status, text);
  }
  if (!text) return undefined as TResponse;
  try {
    return JSON.parse(text) as TResponse;
  } catch {
    throw createScaiError("Agentic Studio returned a non-JSON response.", "AGENTS_API_FAILED");
  }
};

/**
 * Open a streaming request (the `chatv2` run endpoint emits
 * `text/event-stream`) and yield decoded text chunks. SSE framing is
 * left to the caller. Defaults to POST.
 */
export async function* agentsStream(
  session: AgentsSession,
  path: string,
  init: AgentsRequestInit
): AsyncIterable<string> {
  const url = `${session.baseUrl}${path}${toQueryString(init.query)}`;
  const body = serializeBody(init.body);
  const headers = buildHeaders(session, init, body !== undefined);

  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ? init.method.toUpperCase() : "POST",
      headers,
      body,
      signal: init.signal,
    });
  } catch (error) {
    throw networkError(error);
  }

  if (!response.ok) {
    throw mapHttpError(response.status, await response.text());
  }
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) yield decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

/** Next.js RSC encoding for an absent (`undefined`) server-action argument. */
export const RSC_UNDEFINED = "$undefined";

export interface ServerActionInit {
  /** The `Next-Action` hash. ROTATES on every Agentic Studio deploy. */
  actionHash: string;
  /** The `Next-Router-State-Tree` header value for the action's route. */
  routerStateTree: string;
  /** The server action's argument tuple — JSON-encoded as the request body. */
  args: unknown;
}

/**
 * Invoke a Next.js **server action** on the Agentic Studio app.
 *
 * Used by resources with no `/api/` write endpoint (schemas,
 * html-templates). UNSTABLE by nature — `actionHash` rotates on every
 * Agentic Studio deploy. Throws `AGENTS_API_FAILED` (with a re-capture
 * hint) on a non-2xx; the response is an RSC stream and is not parsed.
 */
export const agentsServerAction = async (
  session: AgentsSession,
  path: string,
  init: ServerActionInit
): Promise<void> => {
  let response: Response;
  try {
    response = await fetch(`${session.baseUrl}${path}`, {
      method: "POST",
      headers: {
        ...session.authHeaders(),
        "Content-Type": "text/plain;charset=UTF-8",
        "Next-Action": init.actionHash,
        "Next-Router-State-Tree": init.routerStateTree,
        Accept: "text/x-component",
        Origin: session.baseUrl,
        Referer: `${session.baseUrl}${path}`,
      },
      body: JSON.stringify(init.args),
    });
  } catch (error) {
    throw networkError(error);
  }
  if (!response.ok) {
    throw createScaiError(
      `Agentic Studio rejected the ${path} server action (HTTP ${response.status}).`,
      "AGENTS_API_FAILED",
      {
        hint:
          `${path} is a Next.js server action whose hash rotates on every Agentic ` +
          "Studio deploy. Re-capture it from a HAR and update the action hash, or wait " +
          "for a real /api/ write endpoint.",
      }
    );
  }
};
