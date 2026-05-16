import { createScaiError } from "@/shared/errors";
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
  const controller = timeoutMs > 0 ? new AbortController() : undefined;
  const timeoutHandle = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  let response: Response;
  try {
    response = await fetch(url, { method, headers, body, signal: controller?.signal });
  } catch (error) {
    throw createScaiError(
      redactSecrets(
        `Campaign API request failed: ${error instanceof Error ? error.message : String(error)}`
      ),
      "NETWORK",
      { hint: "Check network connectivity or try again later." }
    );
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }

  if (!response.ok) {
    const responseBody = await parseJsonIfPossible(response);
    const message = extractErrorMessage(responseBody);
    const sanitized = message ? redactSecrets(message) : undefined;
    throw createScaiError(
      sanitized ?? `Campaign API request failed (${response.status})`,
      "CAMPAIGN_API_FAILED"
    );
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  return (await parseJsonIfPossible(response)) as TResponse;
};
