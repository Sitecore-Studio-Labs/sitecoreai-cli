import { createScaiError } from "@/shared/errors";
import { fetchWithRateLimitRetry } from "@/shared/rate-limit-retry";
import { redactSecrets } from "@/shared/redact";
import { extractErrorMessage, parseJsonIfPossible } from "@/deploy/api/common/request";
import {
  DEFAULT_CAMPAIGN_API_BASE,
  type CampaignApiClientOptions,
  type CampaignQueryRecord,
  type CampaignRequestInit,
} from "./types";

/**
 * Campaign (Orchestrate) API transport — `campaignRequest()`.
 *
 * Mirrors `briefRequest()`: bearer auth, JSON request/response, error
 * mapping that surfaces Sitecore's structured error bodies. The
 * Orchestrate API uses **snake_case** JSON (unlike the camelCase Brief
 * and Sites APIs) — helpers in sibling files type the wire shapes
 * verbatim rather than remapping.
 *
 * Errors map to scai's `ScaiError` — `NETWORK` for transport failures,
 * `CAMPAIGN_API_FAILED` for non-2xx responses.
 */

const toQueryString = (query?: CampaignQueryRecord): string => {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
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

/**
 * Parse the `auth-param`s out of an RFC 6750 `WWW-Authenticate: Bearer …`
 * challenge — `error`, `error_description`, and (for `insufficient_scope`)
 * the required `scope`. A 401/403 from an OAuth-protected API carries the
 * reason here, not in the JSON body. The Orchestrate API's exact scope is
 * otherwise unverified (see `auth.ts`), so this header is the one place
 * scai can learn it. Keys are lower-cased; a missing header yields `{}`.
 */
const parseBearerChallenge = (header: string | null): Record<string, string> => {
  if (!header) return {};
  const challenge = /^\s*bearer\s+(.*)$/is.exec(header);
  const params = challenge ? challenge[1] : header;
  const out: Record<string, string> = {};
  const pair = /([A-Za-z_-]+)\s*=\s*(?:"([^"]*)"|([^,\s]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pair.exec(params)) !== null) {
    out[match[1].toLowerCase()] = match[2] ?? match[3] ?? "";
  }
  return out;
};

export const campaignRequest = async <TResponse>(
  options: CampaignApiClientOptions,
  path: string,
  init?: CampaignRequestInit & { body?: unknown; query?: CampaignQueryRecord }
): Promise<TResponse> => {
  const baseUrl = options.baseUrl ?? DEFAULT_CAMPAIGN_API_BASE;
  const url = `${baseUrl.replace(/\/$/, "")}${path}${toQueryString(init?.query)}`;
  const method = init?.method ? init.method.toUpperCase() : "GET";

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

  const timeoutMs = Number(process.env.SITECOREAI_REQUEST_TIMEOUT_MS ?? 60_000);

  let response: Response;
  try {
    // Retries on Cosmos 429 (TooManyRequests) — a reconnect bursts a whole
    // story's projects/deliverables/tasks past the per-second RU budget.
    // Safe for writes: a 429 is rejected before processing.
    response = await fetchWithRateLimitRetry(url, { method, headers, body }, { timeoutMs });
  } catch (error) {
    throw createScaiError(
      redactSecrets(
        `Campaign API request failed: ${error instanceof Error ? error.message : String(error)}`
      ),
      "NETWORK",
      { hint: "Check network connectivity or try again later." }
    );
  }

  if (!response.ok) {
    const responseBody = await parseJsonIfPossible(response);
    const message = extractErrorMessage(responseBody);
    const sanitized = message ? redactSecrets(message) : undefined;
    // On an auth failure, the `WWW-Authenticate` Bearer challenge often
    // names the scope the token is missing — surface it so the operator
    // (and a future `acquireCampaignToken` scope pin) can act on it.
    const challenge = parseBearerChallenge(response.headers.get("www-authenticate"));
    const isAuthFailure =
      response.status === 401 ||
      response.status === 403 ||
      challenge.error === "insufficient_scope";
    let hint: string | undefined;
    if (isAuthFailure) {
      const required = challenge.scope
        ? ` The Orchestrate API requires the '${challenge.scope}' scope.`
        : "";
      hint =
        `The environment's automation client is not authorized for the Orchestrate API.${required} ` +
        `Grant the missing scope to the client in the Sitecore Cloud Portal, then re-run.`;
    }
    throw createScaiError(
      sanitized ??
        challenge.error_description ??
        challenge.error ??
        `Campaign API request failed (${response.status})`,
      "CAMPAIGN_API_FAILED",
      hint ? { hint } : {}
    );
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  return (await parseJsonIfPossible(response)) as TResponse;
};
