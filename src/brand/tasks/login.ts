import {
  readRootConfiguration,
  readRootConfigurationFile,
  writeRootConfigurationFile,
} from "@/config/root-config";
import type { AiSkillsCredential } from "@/config/types";
import {
  DEFAULT_SITECORE_API_AUDIENCE,
  requestClientCredentialsToken,
} from "@/serialization/sitecore-api/auth";
import { createScaiError } from "@/shared/errors";
import {
  getAiSkillsClientSecret,
  setAiSkillsClientSecret,
  setAiSkillsToken,
} from "@/shared/keychain";
import { toLogger, inputError } from "@/shared/cli-tasks";
import type { CommonOptions } from "@/shared/cli-options";
import { promptConfirm, promptSecret, promptText } from "@/shared/prompt";
import { extractScopes } from "../api/auth";

export interface AiSkillsLoginOptions extends CommonOptions {
  environmentName?: string;
  orgId?: string;
  clientId?: string;
  clientSecret?: string;
  authority?: string;
  audience?: string;
  /** Skip the overwrite confirmation when a credential already exists for this org. */
  force?: boolean;
}

const DEFAULT_AUTHORITY = "https://auth.sitecorecloud.io";

/**
 * Optional scopes the login flow surfaces when present, to give the
 * operator a complete view of what the AI APIs key carries. scai's
 * mint request does NOT pass an explicit `scope` param — Auth0 grants
 * whatever the client has, and we report it back.
 */
const KNOWN_AI_SKILLS_SCOPES = [
  "ai.org.brd:r",
  "ai.org.brd:w",
  "ai.org.docs:r",
  "ai.org.docs:w",
  "ai.org.br:gen",
  "ai.org:admin",
] as const;

const CLOUD_PORTAL_HINT =
  "Create the credential in Cloud Portal → Stream → Admin → AI APIs keys → Create credential.";

/**
 * Resolve the Sitecore `organizationId` to bind the AI Skills
 * credential to. Resolution order:
 *
 *   1. Explicit `orgId` (e.g. from `--org-id`).
 *   2. `organizationId` field on the active env profile (the env named
 *      by `--environment-name` / `--env`, or the default env profile).
 *
 * Fails with `INPUT_INVALID` when neither path resolves a value —
 * scai's AI Skills credentials are one-org-per-credential and we
 * can't store one without an org key.
 *
 * Exported for unit testing the resolution branches. The login flow
 * uses it; nothing else should need it.
 */
export const resolveAiSkillsOrgId = (
  explicitOrgId: string | undefined,
  envOrgId: string | undefined,
  envName: string | undefined
): string => {
  if (explicitOrgId) {
    return explicitOrgId;
  }
  if (envOrgId) {
    return envOrgId;
  }
  const envClause = envName ? ` (env '${envName}' has no organizationId)` : "";
  throw inputError(
    `Cannot resolve organizationId for AI Skills credential${envClause}.`,
    "Pass --org-id <id>, or set organizationId on the env profile in sitecoreai.cli.json."
  );
};

/**
 * Provision a Sitecore AI Skills credential for a Sitecore
 * organization. The flow is:
 *
 *   1. Resolve `orgId` (flag → env profile → error).
 *   2. Detect an existing credential for this org and confirm overwrite.
 *   3. Acquire `clientId` (flag → prompt) and `clientSecret`
 *      (flag → prompt, masked).
 *   4. Mint a test token against `auth.sitecorecloud.io/oauth/token`
 *      with `audience=https://api.sitecorecloud.io`, requesting the
 *      AI Skills scope set.
 *   5. Refuse to persist the credential if the granted scopes are
 *      missing — operators who paste the Pages/Sites automation
 *      client by mistake get a pointed error explaining the fix
 *      ([[project-scai-ai-skills-credential-model]]).
 *   6. Write `aiSkills[orgId].clientId` to `sitecoreai.cli.json`,
 *      store the secret in the OS keychain, and cache the minted
 *      token (keyed by orgId — multiple env profiles in the same
 *      org share both the credential and the cached token).
 *
 * `--print` is intentionally not supported here — the minted token
 * is short-lived and printing it would tempt operators to script
 * around the keychain. Use the library surface
 * (`acquireAiSkillsToken`) for non-interactive automation.
 */
export const runAiSkillsLogin = async (options: AiSkillsLoginOptions): Promise<void> => {
  const logger = toLogger(options);
  const configPath = options.config ?? process.cwd();
  const rootConfigFile = readRootConfigurationFile(configPath);
  const root = readRootConfiguration(configPath, options.environmentName);

  const envName = options.environmentName ?? root.defaultEnvironment;
  const env = root.environments[envName];

  const orgId = resolveAiSkillsOrgId(options.orgId, env?.organizationId, envName);

  const existing = rootConfigFile.config.aiSkills?.[orgId];
  const isInteractive =
    process.stdin.isTTY && process.stdout.isTTY && process.env.SITECOREAI_NON_INTERACTIVE !== "1";

  if (existing && !options.force) {
    if (!isInteractive) {
      throw createScaiError(
        `An AI Skills credential is already configured for org '${orgId}'.`,
        "INPUT_INVALID",
        {
          hint: "Re-run with --force to overwrite, or `scai logout ai-skills --org-id <id>` first.",
        }
      );
    }
    const overwrite = await promptConfirm(
      `An AI Skills credential is already configured for org '${orgId}'. Overwrite?`,
      false
    );
    if (!overwrite) {
      logger.info("Aborted. Existing credential left in place.");
      return;
    }
  }

  let clientId = options.clientId;
  if (!clientId) {
    if (!isInteractive) {
      throw inputError(
        "Client ID is required.",
        `Pass --client-id <id> (and --client-secret <secret>). ${CLOUD_PORTAL_HINT}`
      );
    }
    logger.info(CLOUD_PORTAL_HINT);
    clientId = await promptText("Client ID");
    if (!clientId) {
      throw inputError("Client ID is required.");
    }
  }

  let clientSecret = options.clientSecret;
  if (!clientSecret) {
    if (!isInteractive) {
      throw inputError(
        "Client secret is required.",
        "Pass --client-secret <secret>, or run interactively."
      );
    }
    clientSecret = await promptSecret("Client Secret: ");
  }

  const authority = options.authority ?? env?.authority ?? DEFAULT_AUTHORITY;
  const audience = options.audience ?? DEFAULT_SITECORE_API_AUDIENCE;

  logger.info("Validating credential by minting a test token...");
  let mintResult;
  try {
    // No explicit scope param — Auth0 grants whatever the AI APIs key
    // has been issued. Requesting scopes the client wasn't granted
    // causes Auth0 to 403 outright (verified 2026-05-14 with a
    // partial-scope client). Permissive login is intentional: the
    // operator may legitimately have a read-only or review-only key,
    // and per-operation scope checks downstream will surface the
    // exact missing scope when they go to run something.
    mintResult = await requestClientCredentialsToken({
      authority,
      clientId,
      clientSecret,
      audience,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw createScaiError(
      `Auth0 rejected the AI Skills credential for org '${orgId}'.`,
      "AUTH_AI_SKILLS_REQUIRED",
      {
        hint: `Auth0 error: ${detail}. Verify Client ID + Client Secret. ${CLOUD_PORTAL_HINT}`,
      }
    );
  }
  if (!mintResult.accessToken) {
    throw createScaiError(
      `Sitecore did not return an access token for org '${orgId}'.`,
      "AUTH_AI_SKILLS_REQUIRED",
      { hint: CLOUD_PORTAL_HINT }
    );
  }

  const grantedScopes = extractScopes(mintResult.accessToken);
  const hasReviewScope = grantedScopes.includes("ai.org.br:gen");
  const knownGranted = grantedScopes.filter((s) =>
    (KNOWN_AI_SKILLS_SCOPES as readonly string[]).includes(s)
  );
  const knownMissing = (KNOWN_AI_SKILLS_SCOPES as readonly string[]).filter(
    (s) => !grantedScopes.includes(s)
  );
  const looksLikePagesSitesClient =
    grantedScopes.some((s) => s.startsWith("xmclouddeploy.") || s.startsWith("xmcpub.")) &&
    !grantedScopes.some((s) => s.startsWith("ai.org"));
  if (looksLikePagesSitesClient) {
    // The credential is the wrong client class entirely — refuse to
    // persist. A typed Pages/Sites automation client never carries
    // any `ai.org*` scope, so it will fail every AI Skills call.
    throw createScaiError(
      `Credential for org '${orgId}' looks like the Pages/Sites automation client, not an AI APIs key.`,
      "AUTH_AI_SKILLS_REQUIRED",
      {
        hint: `Granted scopes: ${grantedScopes.join(", ") || "(none)"}. ${CLOUD_PORTAL_HINT}`,
      }
    );
  }
  if (knownGranted.length === 0) {
    // No recognizable AI Skills scope at all — probably the wrong
    // client class even though it doesn't match the Pages/Sites
    // shape. Refuse to persist to avoid storing a credential that's
    // guaranteed to fail every operation.
    throw createScaiError(
      `Credential minted for org '${orgId}' but carries no recognized AI Skills scopes.`,
      "AUTH_AI_SKILLS_REQUIRED",
      {
        hint: `Granted scopes: ${grantedScopes.join(", ") || "(none)"}. Expected at least one of: ${KNOWN_AI_SKILLS_SCOPES.join(", ")}. ${CLOUD_PORTAL_HINT}`,
      }
    );
  }

  // Persist: keychain first (secret + token), then config. If keychain
  // fails we don't want a config record pointing at a secret-less
  // entry.
  const secretStored = await setAiSkillsClientSecret(orgId, clientSecret);
  if (!secretStored) {
    throw createScaiError(
      "Failed to store the AI Skills client secret in the OS keychain.",
      "AUTH_AI_SKILLS_REQUIRED",
      {
        hint: "Check OS keychain availability. On CI runners without a keychain, set SITECOREAI_QUIET=1 to suppress warnings and use the library surface directly.",
      }
    );
  }
  await setAiSkillsToken(orgId, mintResult.accessToken);

  const credentialRecord: AiSkillsCredential = {
    clientId,
    audience,
    authority,
    tokenExpiresIn: mintResult.expiresIn ?? null,
    tokenLastUpdated: new Date().toISOString(),
  };

  const aiSkills = { ...(rootConfigFile.config.aiSkills ?? {}) };
  aiSkills[orgId] = credentialRecord;
  rootConfigFile.config.aiSkills = aiSkills;
  writeRootConfigurationFile(configPath, rootConfigFile.config);

  // Verify the credential we just wrote can be read back, in case the
  // keychain silently dropped it.
  const readback = await getAiSkillsClientSecret(orgId);
  if (!readback) {
    logger.warn(
      "AI Skills client secret was written but could not be read back. Subsequent calls may need a re-login.",
      "yellow"
    );
  }

  logger.info(`AI Skills credential saved for org '${orgId}'.`, "green");
  logger.info(`Scopes granted: ${grantedScopes.join(", ") || "(none)"}`);
  if (knownMissing.length > 0) {
    logger.warn(
      `Scopes NOT on this key: ${knownMissing.join(", ")}. Operations that need these will refuse.`,
      "yellow"
    );
  }
  if (!hasReviewScope) {
    logger.warn(
      "  → `scai brand review` needs `ai.org.br:gen`. Recreate the AI APIs key in Cloud Portal with that scope enabled.",
      "yellow"
    );
  }
};
