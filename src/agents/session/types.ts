/**
 * Auth seam for the Sitecore Agentic Studio BFF.
 *
 * Agentic Studio's `/api/*` routes are gated by a first-party browser
 * **session cookie**, not a bearer token — so this area does NOT use the
 * client-credentials OAuth the rest of scai relies on. An `AgentsSession`
 * is just "an origin plus the headers that authenticate a request": a
 * `Cookie` header today, an `Authorization` header once Sitecore exposes
 * the product to ordinary user credentials.
 *
 * TEMPORARY — the cookie path exists only until that happens. Everything
 * Playwright-specific is confined to `playwright-login.ts`; nothing else
 * in `src/agents/` imports it. To retire the browser path:
 *   1. add a `kind: "bearer"` variant to `AgentsCredential`,
 *   2. handle it in `createAgentsSession` (`authHeaders` → `Authorization`),
 *   3. delete `playwright-login.ts` and drop the `playwright-core` dep.
 * The transport in `api/request.ts` does not change.
 */

/** Default Agentic Studio region (EU West). */
export const DEFAULT_AGENTS_REGION = "euw";

/** Origin of a regional Agentic Studio deployment. */
export const agentsBaseUrl = (region: string = DEFAULT_AGENTS_REGION): string =>
  `https://agentic-studio-${region}.sitecorecloud.io`;

/**
 * A persisted Agentic Studio credential (OS keychain). The `kind`
 * discriminator is the seam — only `"cookie"` exists today.
 */
export interface AgentsCredential {
  kind: "cookie";
  /** Region the credential is bound to — selects the BFF origin. */
  region: string;
  /** `Cookie:` header value carrying the BFF session. */
  cookieHeader: string;
  /**
   * Browser User-Agent captured at login. Replayed on every request —
   * Sitecore Cloud's edge WAF answers HTTP 406 to non-browser callers.
   */
  userAgent: string;
  /**
   * Server-action hashes discovered at login, keyed by route (e.g.
   * `/schemas/create`). They rotate per Agentic Studio deploy —
   * capturing them fresh each login keeps the schema / html-template
   * writes working with no manual upkeep. Absent if discovery failed.
   */
  actionHashes?: Record<string, string>;
  /** ISO-8601 timestamp the session was captured. */
  capturedAt: string;
}

/** Per-request options understood by the Agentic Studio transport. */
export interface AgentsRequestInit {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

/**
 * An authenticated handle to one Agentic Studio tenant. The transport
 * (`api/request.ts`) talks only to this interface — it never learns
 * whether auth is a cookie (today) or a bearer token (future).
 */
export interface AgentsSession {
  /** BFF origin, e.g. `https://agentic-studio-euw.sitecorecloud.io`. */
  readonly baseUrl: string;
  /** Headers that authenticate a request — `Cookie` today. */
  authHeaders(): Record<string, string>;
  /**
   * Server-action hashes captured at login (see `AgentsCredential`),
   * keyed by route. Consumed by the server-action writes (schema,
   * html-template); absent for sessions built without Playwright.
   */
  readonly actionHashes?: Record<string, string>;
}
