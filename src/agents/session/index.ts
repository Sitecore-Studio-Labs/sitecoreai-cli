/**
 * Agentic Studio session factory + credential lifecycle.
 *
 * `createAgentsSession` turns a stored `AgentsCredential` into the
 * `AgentsSession` the transport consumes. `loginAgents` /
 * `acquireAgentsSession` / `logoutAgents` manage the keychain-backed
 * credential. The Playwright dependency is reached only via
 * `loginAgents` → `./playwright-login`.
 */
import { clearAgentsCredential, getAgentsCredential, setAgentsCredential } from "@/shared/keychain";
import { createScaiError } from "@/shared/errors";
import {
  agentsBaseUrl,
  DEFAULT_AGENTS_REGION,
  type AgentsCredential,
  type AgentsSession,
} from "./types";
import { runPlaywrightLogin } from "./playwright-login";

export {
  agentsBaseUrl,
  DEFAULT_AGENTS_REGION,
  type AgentsCredential,
  type AgentsRequestInit,
  type AgentsSession,
} from "./types";

/**
 * A current Chrome User-Agent, used when a stored credential predates
 * `userAgent` capture, so requests match the browser client.
 */
const FALLBACK_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

const platformBrand = (): string => {
  if (process.platform === "darwin") return '"macOS"';
  if (process.platform === "win32") return '"Windows"';
  return '"Linux"';
};

/**
 * Browser client headers paired with the captured `User-Agent`.
 * Part of the temporary cookie strategy — a future bearer session sends
 * none of this.
 */
const browserHeaders = (userAgent: string): Record<string, string> => ({
  "User-Agent": userAgent || FALLBACK_USER_AGENT,
  "Accept-Language": "en-US,en;q=0.9",
  "sec-ch-ua": '"Chromium";v="148", "Microsoft Edge";v="148", "Not/A)Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": platformBrand(),
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
});

const parseCredential = (raw: string): AgentsCredential | undefined => {
  try {
    const value = JSON.parse(raw) as Partial<AgentsCredential>;
    if (value.kind === "cookie" && typeof value.cookieHeader === "string" && value.cookieHeader) {
      return {
        kind: "cookie",
        region: value.region ?? DEFAULT_AGENTS_REGION,
        cookieHeader: value.cookieHeader,
        userAgent: value.userAgent ?? FALLBACK_USER_AGENT,
        actionHashes: value.actionHashes,
        capturedAt: value.capturedAt ?? new Date(0).toISOString(),
      };
    }
  } catch {
    /* not a credential — fall through */
  }
  return undefined;
};

/**
 * Build the transport-facing session handle from a stored credential.
 * Today every credential is a cookie; when a `kind: "bearer"` variant is
 * added, branch here to emit an `Authorization` header instead.
 */
export const createAgentsSession = (credential: AgentsCredential): AgentsSession => ({
  baseUrl: agentsBaseUrl(credential.region),
  authHeaders: () => ({
    Cookie: credential.cookieHeader,
    ...browserHeaders(credential.userAgent),
  }),
  actionHashes: credential.actionHashes,
});

export interface CookieSessionInput {
  /** `Cookie:` header value carrying a live BFF session. */
  cookieHeader: string;
  /** Agentic Studio region — defaults to EU West. */
  region?: string;
  /** Browser User-Agent that owns the cookie — defaults to a current Chrome UA. */
  userAgent?: string;
}

/**
 * Build a session straight from a browser session cookie — no Playwright,
 * no keychain. The entry point for embedding contexts that already hold
 * the cookie: a Sitecore Marketplace app runs inside the authenticated
 * portal, so the BFF session is present in its browser context and can be
 * handed straight in.
 *
 * One of three ways to reach an `AgentsSession`, all equivalent downstream:
 * Playwright login (`loginAgents`, CLI), this cookie injection (embedded
 * UI), and — once Sitecore ships it — a bearer token. See `./types`.
 */
export const agentsSessionFromCookie = (input: CookieSessionInput): AgentsSession =>
  createAgentsSession({
    kind: "cookie",
    region: input.region ?? DEFAULT_AGENTS_REGION,
    cookieHeader: input.cookieHeader,
    userAgent: input.userAgent ?? FALLBACK_USER_AGENT,
    capturedAt: new Date().toISOString(),
  });

/**
 * Load the stored session for an environment. Throws `AUTH_REQUIRED`
 * (pointing at `scai agents login`) when none is present. Staleness is
 * detected later — by the transport, on the first 401.
 */
export const acquireAgentsSession = async (envName: string): Promise<AgentsSession> => {
  const raw = await getAgentsCredential(envName);
  const credential = raw ? parseCredential(raw) : undefined;
  if (!credential) {
    throw createScaiError(
      `No Agentic Studio session stored for environment "${envName}".`,
      "AUTH_REQUIRED",
      { hint: `Run \`scai agents login -n ${envName}\` to capture a browser session.` }
    );
  }
  return createAgentsSession(credential);
};

export interface LoginAgentsOptions {
  envName: string;
  region?: string;
  /** Max time to wait for the interactive login (ms). */
  timeoutMs?: number;
}

/**
 * Run the (temporary) interactive browser login and persist the captured
 * session to the keychain. Returns the stored credential's metadata.
 */
export const loginAgents = async (
  options: LoginAgentsOptions
): Promise<{ region: string; capturedAt: string }> => {
  const region = options.region ?? DEFAULT_AGENTS_REGION;
  const credential = await runPlaywrightLogin({ region, timeoutMs: options.timeoutMs });
  await setAgentsCredential(options.envName, JSON.stringify(credential));
  return { region: credential.region, capturedAt: credential.capturedAt };
};

/** Forget the stored Agentic Studio session for an environment. */
export const logoutAgents = async (envName: string): Promise<boolean> =>
  clearAgentsCredential(envName);
