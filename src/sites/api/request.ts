import { createScaiError } from "@/shared/errors";
import { redactSecrets } from "@/shared/redact";
import { extractErrorMessage, runSitecoreRest } from "@/shared/rest";
import {
  DEFAULT_SITES_API_BASE,
  type SitesApiClientOptions,
  type SitesQueryRecord,
  type SitesRequestInit,
} from "./types";

/**
 * Sites API transport — `sitesRequest()`.
 *
 * A thin wrapper over the shared REST transport (`@/shared/rest`),
 * mirroring `deployRequest()` from `src/deploy/api/common/request.ts` in
 * shape: bearer auth, JSON request/response, error mapping that surfaces
 * Sitecore's structured error bodies. Differences from Deploy:
 *
 *  - Different base URL (`xmapps-api.sitecorecloud.io`)
 *  - No retry — single attempt, fail fast (Deploy retries GETs)
 *  - Type generics — the path + method + body + response shapes come
 *    from the OpenAPI codegen output (`schema.d.ts`). Helpers in
 *    `sites.ts` / `collections.ts` / `languages.ts` pick the right
 *    operation and pass typed body / response generics through. Each
 *    operation gets a one-line wrapper; the transport stays generic.
 *
 * Errors map to scai's `ScaiError` — `NETWORK` for transport failures,
 * `SITES_API_FAILED` for non-2xx responses with a message extracted
 * from the body when present.
 */

const toQueryString = (query?: SitesQueryRecord): string => {
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
 * Generic typed request to the Sites API.
 *
 * Helpers parameterise the response type via the `TResponse` generic
 * — the transport stays untyped on body so each helper can pick its
 * operation's request body shape from `schema.d.ts`.
 *
 * @example
 *   const sites = await sitesRequest<SitesListResponse>(
 *     options,
 *     "/api/v1/sites",
 *   );
 *   const created = await sitesRequest<SiteResponse>(
 *     options,
 *     "/api/v1/sites",
 *     { method: "POST", body: { name: "Foo", siteTemplate: "..." } },
 *   );
 */
export const sitesRequest = async <TResponse>(
  options: SitesApiClientOptions,
  path: string,
  init?: SitesRequestInit & { body?: unknown; query?: SitesQueryRecord }
): Promise<TResponse> => {
  const baseUrl = options.baseUrl ?? DEFAULT_SITES_API_BASE;
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

  // Default 60s timeout. Override via SITECOREAI_REQUEST_TIMEOUT_MS (0 disables).
  // Defends against slowloris / black-hole upstreams.
  const timeoutMs = Number(process.env.SITECOREAI_REQUEST_TIMEOUT_MS ?? 60_000);

  return runSitecoreRest<TResponse>({
    url,
    method,
    headers,
    body,
    timeoutMs,
    label: "Sites API",
    // 204 No Content responses (e.g. DELETE) have no body — resolve to
    // `undefined as TResponse` and let helpers type their return as `void`.
    mapHttpError: (response, parsedBody) => {
      const message = extractErrorMessage(parsedBody);
      const sanitized = message ? redactSecrets(message) : undefined;
      return createScaiError(
        sanitized ?? `Sites API request failed (${response.status})`,
        "SITES_API_FAILED"
      );
    },
  });
};
