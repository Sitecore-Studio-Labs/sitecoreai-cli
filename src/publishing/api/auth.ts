import { requestClientCredentialsToken } from "@/serialization/api/auth";
import type { SitecoreApiClientOptions } from "@/serialization/api/types";
import { resolveClientCredential } from "@/shared/client-credential";
import { createScaiError } from "@/shared/errors";
import { getDeployToken, getPublishingToken, setPublishingToken } from "@/shared/keychain";

/**
 * OAuth scopes the SAI Publishing API requires.
 *
 * Per the Publishing API architect (2026-05-14):
 *
 *   - Every Sitecore Cloud **environment** has its own automation
 *     client (Cloud Portal → Environments → [env] → Automation
 *     Clients). Env-level clients carry the tenant-tier `.t` scopes
 *     below by default. ORG-level clients (used for org/project/env
 *     management) do NOT.
 *   - The api-docs page lists both `.a` (admin-tier, for Pages-UI
 *     user tokens with Organization Owner role) and `.t` (tenant-
 *     tier, for automation clients). Use `.t` for any flow whose
 *     credentials are scoped to a single environment.
 *
 *   - `xmcpub.jobs.t:r` — read publishing jobs
 *   - `xmcpub.jobs.t:w` — create / cancel publishing jobs
 *   - `xmcpub.queue:r`  — read the publish queue
 *
 * Audience: `https://api.sitecorecloud.io` (standard).
 */
export const PUBLISHING_SCOPES_REQUESTED = [
  "xmcpub.jobs.t:r",
  "xmcpub.jobs.t:w",
  "xmcpub.queue:r",
] as const;

const M2M_SCOPE_PARAM = PUBLISHING_SCOPES_REQUESTED.join(" ");

const NO_CREDENTIALS_HINT =
  "Two paths work: (1) run `scai setup login -n <env>` against an env-level automation client (publishing scopes are part of the default scope set scai requests), or (2) put env-level `clientId`+`clientSecret` on this env's profile in sitecoreai.cli.json, or set `SITECOREAI_ENV_<NAME>_CLIENT_ID`/`_CLIENT_SECRET`. Create the env-level client in Cloud Portal → Environments → [env] → Automation Clients.";

export interface AcquirePublishingTokenOptions {
  envName: string;
  environment: SitecoreApiClientOptions;
}

const decodeJwtPayload = (token: string): Record<string, unknown> | undefined => {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return undefined;
  }
  const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "==".slice(0, (4 - (b64.length % 4)) % 4);
  try {
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

const extractScopes = (token: string): string[] => {
  const payload = decodeJwtPayload(token);
  if (!payload) return [];
  const raw =
    typeof payload.scope === "string"
      ? payload.scope
      : Array.isArray(payload.scp)
        ? (payload.scp as unknown[]).join(" ")
        : "";
  return raw.split(/\s+/).filter(Boolean);
};

const hasPublishingScopes = (token: string): boolean => {
  const granted = new Set(extractScopes(token));
  return PUBLISHING_SCOPES_REQUESTED.every((s) => granted.has(s));
};

/**
 * 60-second safety margin: a token whose `exp` falls inside this window
 * is treated as expired so we don't hand a soon-to-be-invalid Bearer to
 * a long-running publish call. Bumped up from the typical 5-15s window
 * because publish-API requests can hold the connection for tens of
 * seconds and we'd rather mint fresh than 401 mid-request.
 */
const TOKEN_EXPIRY_MARGIN_S = 60;

const isTokenExpired = (token: string): boolean => {
  const payload = decodeJwtPayload(token);
  if (!payload) {
    return false; // can't decode → trust the caller to handle 401
  }
  const exp = typeof payload.exp === "number" ? payload.exp : Number(payload.exp);
  if (!Number.isFinite(exp)) {
    return false;
  }
  const nowS = Math.floor(Date.now() / 1000);
  return exp - nowS <= TOKEN_EXPIRY_MARGIN_S;
};

/** Cache entry is usable iff it has the publishing scopes AND isn't
 *  inside the expiry safety margin. Either condition failing falls
 *  through to the next resolution step (deploy-token reuse or fresh
 *  M2M mint), not a throw — keeps a stale cache from blocking a valid
 *  call when fresh credentials are available. */
const isUsablePublishingToken = (token: string): boolean =>
  hasPublishingScopes(token) && !isTokenExpired(token);

/**
 * Build a specific, actionable error when a minted token lacks
 * publishing scopes. Decodes the token, names what it DID get, and
 * infers the likely credential class (org-level vs misconfigured)
 * so the operator knows what to fix in the Cloud Portal.
 */
const buildScopeMissingError = (
  envName: string,
  token: string
): ReturnType<typeof createScaiError> => {
  const granted = extractScopes(token);
  const orgLevelMarkers = granted.filter((s) => s.startsWith("xmclouddeploy."));
  const looksLikeOrg =
    orgLevelMarkers.some((s) => s.includes("organizations:") || s.includes("projects:")) &&
    !granted.some((s) => s.startsWith("xmcpub."));

  const grantSummary = granted.length > 0 ? granted.join(", ") : "(no scope claim in token)";
  const inference = looksLikeOrg
    ? "The credentials look like an ORG-LEVEL automation client (carries org/project management scopes but not xmcpub.*). The Publishing API requires an ENVIRONMENT-LEVEL automation client."
    : "The credentials don't carry the expected publishing scopes for this environment.";

  const envSlug = envName.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return createScaiError(
    `Token minted for env '${envName}' but missing publishing scopes. Expected: ${PUBLISHING_SCOPES_REQUESTED.join(", ")}. Granted: ${grantSummary}.`,
    "AUTH_REQUIRED",
    {
      hint: `${inference} In the Sitecore Cloud Portal: Environments → ${envName} → Automation Clients → Create a new client (env-level), then re-run \`scai setup login -n ${envName}\` or set SITECOREAI_ENV_${envSlug}_CLIENT_ID and _CLIENT_SECRET.`,
    }
  );
};

/**
 * Returns a Bearer JWT for the SAI Publishing API.
 *
 * Resolution order, cheapest first:
 *
 *   1. Cached publishing token in the keychain — set by a previous
 *      successful mint via this function. Reused until expiry / clear.
 *   2. The deploy token in the keychain, IF its scope claim already
 *      includes `xmcpub.jobs.t:*`. This is the zero-config path:
 *      operators who logged in interactively against an env-level
 *      automation client get a single token covering both deploy
 *      and publishing scopes (scai's default scope set requests
 *      both — see `SCAI_API_SCOPES`).
 *   3. Fresh M2M mint via the env's `clientId` + `clientSecret`,
 *      explicitly requesting publishing scopes. Cached on success.
 *
 * Refuses with `AUTH_REQUIRED` when none of these paths produces a
 * token carrying the required scopes. The error message decodes the
 * granted-scope set and infers the credential class so operators know
 * whether they need an env-level client or just need to re-login.
 */
export const acquirePublishingToken = async (
  options: AcquirePublishingTokenOptions
): Promise<string> => {
  // 1. Cached publishing-specific token.
  const cachedPublishing = await getPublishingToken(options.envName);
  if (cachedPublishing && isUsablePublishingToken(cachedPublishing)) {
    return cachedPublishing;
  }

  // 2. Deploy token reused if it carries publishing scopes (i.e. the
  //    operator logged in against an env-level automation client and
  //    scai's default scope set picked up the `.t` grants).
  const deployToken = await getDeployToken(options.envName);
  if (deployToken && isUsablePublishingToken(deployToken)) {
    return deployToken;
  }

  // 3. Fresh M2M mint via env-level client credentials. The
  //    `{ clientId, clientSecret }` pair resolves through the same
  //    three-tier chain serialization uses (`SITECOREAI_ENV_<ENV>_*`
  //    env var → `cm-client:<env>` keychain → `org-client:<orgId>`
  //    keychain). The publishing path used to read `env.clientSecret`
  //    directly off the env profile, which silently skipped the keychain
  //    tiers — fixed 2026-05-21.
  const env = options.environment;
  const resolved = env.clientSecret
    ? env
    : env.name
      ? await (async () => {
          const credential = await resolveClientCredential({
            envName: env.name,
            clientId: env.clientId,
            automationClientId: env.automationClient?.clientId,
            organizationId: env.organizationId,
            orgClientId: env.orgClientId,
          });
          return credential
            ? { ...env, clientId: credential.clientId, clientSecret: credential.clientSecret }
            : env;
        })()
      : env;
  if (resolved.clientId && resolved.clientSecret && resolved.authority) {
    let result;
    try {
      result = await requestClientCredentialsToken(resolved, M2M_SCOPE_PARAM);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw createScaiError(
        `Auth0 refused the publishing scope request for env '${options.envName}'.`,
        "AUTH_REQUIRED",
        { hint: `Auth0 error: ${detail}. ${NO_CREDENTIALS_HINT}` }
      );
    }
    if (!result.accessToken) {
      throw createScaiError(
        `Sitecore did not return an access token for env '${options.envName}'.`,
        "AUTH_REQUIRED",
        { hint: NO_CREDENTIALS_HINT }
      );
    }
    if (!hasPublishingScopes(result.accessToken)) {
      throw buildScopeMissingError(options.envName, result.accessToken);
    }
    await setPublishingToken(options.envName, result.accessToken);
    return result.accessToken;
  }

  // Last-ditch: an existing token exists but lacks publishing scopes.
  // Surface the scope-missing diagnostic against whichever token we
  // have so the operator can act on it.
  const diagToken = cachedPublishing ?? deployToken;
  if (diagToken) {
    throw buildScopeMissingError(options.envName, diagToken);
  }

  throw createScaiError(
    `No publishing-scoped token available for env '${options.envName}'.`,
    "AUTH_REQUIRED",
    { hint: NO_CREDENTIALS_HINT }
  );
};
