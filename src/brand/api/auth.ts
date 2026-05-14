import {
  DEFAULT_SITECORE_API_AUDIENCE,
  requestClientCredentialsToken,
} from "@/serialization/sitecore-api/auth";
import type { SitecoreApiClientOptions } from "@/serialization/sitecore-api/types";
import { createScaiError } from "@/shared/errors";
import {
  getAiSkillsClientSecret,
  getAiSkillsToken,
  setAiSkillsToken,
} from "@/shared/keychain";
import type { AiSkillsCredential } from "@/config/types";

/**
 * OAuth scopes the Sitecore AI Skills APIs require.
 *
 * The AI APIs key (Cloud Portal → Stream → Admin → AI APIs keys)
 * issues a single credential that, when minted, carries scopes
 * across the four AI Skills APIs:
 *
 *   - `ai.org.brd:r`  / `ai.org.brd:w`   — Brand Management read/write
 *   - `ai.org.docs:r` / `ai.org.docs:w`  — Documents read/write
 *   - `ai.orgs.br:gen`                   — Brand Review generate
 *   - `ai.org:admin`                     — org-level admin
 *
 * The minimum required set for scai's brand surface (Brand Management
 * + Brand Review) is `ai.org.brd:r`, `ai.org.brd:w`, `ai.orgs.br:gen`.
 * We validate against this minimum so an operator who provisions an
 * unnecessarily broad credential isn't rejected, but one who pastes
 * the wrong client (e.g. the Pages/Sites automation client) gets a
 * pointed error.
 */
export const AI_SKILLS_REQUIRED_SCOPES = [
  "ai.org.brd:r",
  "ai.org.brd:w",
  "ai.orgs.br:gen",
] as const;

const SCOPE_PARAM = [
  ...AI_SKILLS_REQUIRED_SCOPES,
  "ai.org.docs:r",
  "ai.org.docs:w",
].join(" ");

const NO_CREDENTIAL_HINT =
  "Run `scai login ai-skills --env <env>` to provision the credential, or paste an existing AI APIs key into `aiSkills.<orgId>` in sitecoreai.cli.json (clientId only; secret goes through the keychain via the login flow). Create the credential in Cloud Portal → Stream → Admin → AI APIs keys.";

export interface AcquireAiSkillsTokenOptions {
  orgId: string;
  credential: AiSkillsCredential;
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

export const extractScopes = (token: string): string[] => {
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

export const hasAiSkillsScopes = (token: string): boolean => {
  const granted = new Set(extractScopes(token));
  return AI_SKILLS_REQUIRED_SCOPES.every((s) => granted.has(s));
};

/**
 * Build a specific, actionable error when a minted token lacks the AI
 * Skills scopes. Names what it DID get and infers the likely cause
 * (e.g. operator pasted the Pages/Sites automation client by mistake)
 * so they know what to fix.
 */
const buildScopeMissingError = (
  orgId: string,
  token: string
): ReturnType<typeof createScaiError> => {
  const granted = extractScopes(token);
  const looksLikePagesSitesClient =
    granted.some((s) => s.startsWith("xmclouddeploy.") || s.startsWith("xmcpub.")) &&
    !granted.some((s) => s.startsWith("ai.org"));

  const grantSummary = granted.length > 0 ? granted.join(", ") : "(no scope claim in token)";
  const inference = looksLikePagesSitesClient
    ? "The credentials look like the Pages/Sites automation client (xmclouddeploy.* / xmcpub.* scopes), not an AI APIs key. The AI Skills APIs require a separate credential created under Cloud Portal → Stream → Admin → AI APIs keys."
    : "The credentials don't carry the expected AI Skills scopes.";

  return createScaiError(
    `Token minted for org '${orgId}' but missing AI Skills scopes. Expected: ${AI_SKILLS_REQUIRED_SCOPES.join(", ")}. Granted: ${grantSummary}.`,
    "AUTH_AI_SKILLS_REQUIRED",
    { hint: inference }
  );
};

const DEFAULT_AUTHORITY = "https://auth.sitecorecloud.io";

/**
 * Returns a Bearer JWT for the Sitecore AI Skills APIs.
 *
 * Resolution order, cheapest first:
 *
 *   1. Cached AI Skills token in the keychain (keyed by orgId) — set
 *      by a previous mint via this function. Reused while it still
 *      carries the required scopes; cleared on next 401 by callers.
 *   2. Fresh M2M mint against the `auth.sitecorecloud.io/oauth/token`
 *      endpoint with `audience=https://api.sitecorecloud.io`, using
 *      the org-scoped `clientId` from `aiSkills[orgId]` and the
 *      matching secret from the keychain. Cached on success.
 *
 * Refuses with `AUTH_AI_SKILLS_REQUIRED` when none of these paths
 * produces a token carrying the required scopes. The error message
 * decodes the granted-scope set and infers the credential class so
 * operators know whether they need to provision a new AI APIs key or
 * just re-login.
 */
export const acquireAiSkillsToken = async (
  options: AcquireAiSkillsTokenOptions
): Promise<string> => {
  const { orgId, credential } = options;

  // 1. Cached token keyed by orgId.
  const cached = await getAiSkillsToken(orgId);
  if (cached && hasAiSkillsScopes(cached)) {
    return cached;
  }

  // 2. Fresh M2M mint via the AI APIs key.
  const clientSecret = await getAiSkillsClientSecret(orgId);
  if (!credential.clientId || !clientSecret) {
    throw createScaiError(
      `No AI Skills credential is configured for org '${orgId}'.`,
      "AUTH_AI_SKILLS_REQUIRED",
      { hint: NO_CREDENTIAL_HINT }
    );
  }

  const authority = credential.authority ?? DEFAULT_AUTHORITY;
  const audience = credential.audience ?? DEFAULT_SITECORE_API_AUDIENCE;

  // Reuse the shared client-credentials helper. It accepts a
  // `SitecoreApiClientOptions`-shaped argument; we only need the
  // auth-relevant fields.
  const mintEnv: SitecoreApiClientOptions = {
    authority,
    clientId: credential.clientId,
    clientSecret,
    audience,
  };

  let result;
  try {
    result = await requestClientCredentialsToken(mintEnv, SCOPE_PARAM);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw createScaiError(
      `Auth0 refused the AI Skills scope request for org '${orgId}'.`,
      "AUTH_AI_SKILLS_REQUIRED",
      { hint: `Auth0 error: ${detail}. ${NO_CREDENTIAL_HINT}` }
    );
  }
  if (!result.accessToken) {
    throw createScaiError(
      `Sitecore did not return an access token for org '${orgId}'.`,
      "AUTH_AI_SKILLS_REQUIRED",
      { hint: NO_CREDENTIAL_HINT }
    );
  }
  if (!hasAiSkillsScopes(result.accessToken)) {
    throw buildScopeMissingError(orgId, result.accessToken);
  }
  await setAiSkillsToken(orgId, result.accessToken);
  return result.accessToken;
};
