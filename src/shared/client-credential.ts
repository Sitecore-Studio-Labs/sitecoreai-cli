/**
 * Automation-client secret resolution — the single place every API
 * auth path resolves a `clientId` + `clientSecret` pair from.
 *
 * Per `docs/credentials.md` the config file holds every credential's
 * **non-secret metadata** (`clientId`, `name`, `mintedAt`); the OS
 * keychain holds **only secrets**. So a `clientId` always comes from the
 * config and the matching `clientSecret` from the keychain. Resolution
 * walks three tiers:
 *
 *   1. `SITECOREAI_ENV_<ENV>_CLIENT_SECRET` (or the global
 *      `SITECOREAI_CLIENT_SECRET`) environment variable — the
 *      bring-your-own-client escape hatch. Paired with a `clientId` from
 *      the env profile (or `SITECOREAI_ENV_<ENV>_CLIENT_ID`).
 *   2. The scai-minted env-scoped automation client: `clientId` from the
 *      env profile's `automationClient` block, secret from the OS
 *      keychain (`cm-client:<env>`).
 *   3. The scai-minted org-scoped automation client: `clientId` from the
 *      root config's `orgClients[orgId]` block, secret from the OS
 *      keychain (`org-client:<orgId>`). The fallback for org-level
 *      profiles with no project/environment of their own.
 *
 * Lives in `shared/` (a leaf module): it depends only on the keychain
 * wrapper and `process.env`, never on `config/`. Callers pass the
 * non-secret `clientId`s — already read from the resolved config — in.
 */

import { getCmClientSecret, getOrgClientSecret } from "./keychain";
import { trimEdgeChar } from "./strings";

/**
 * Normalize an env-profile name into the `SITECOREAI_ENV_<ENV>_*` key
 * segment — uppercased, non-alphanumerics collapsed to `_`. Mirrors the
 * normalization `config/env-overrides.ts` applies; kept local so this
 * leaf module has no `config/` dependency.
 */
const normalizeEnvKey = (name: string): string =>
  trimEdgeChar(
    name
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_"),
    "_"
  );

const readEnvVar = (key: string): string | undefined => {
  const value = process.env[key];
  if (value && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
};

/**
 * Tier 1 of secret resolution: the `SITECOREAI_ENV_<ENV>_CLIENT_SECRET`
 * environment variable, falling back to the global
 * `SITECOREAI_CLIENT_SECRET`. This is the bring-your-own-client escape
 * hatch — the operator supplies their own automation client and feeds
 * its secret in via the environment, never the config file.
 *
 * Returns `undefined` when neither variable is set.
 */
export const resolveEnvClientSecret = (envName: string): string | undefined =>
  readEnvVar(`SITECOREAI_ENV_${normalizeEnvKey(envName)}_CLIENT_SECRET`) ??
  readEnvVar("SITECOREAI_CLIENT_SECRET");

/**
 * Tier 1's matching `clientId`: the `SITECOREAI_ENV_<ENV>_CLIENT_ID`
 * environment variable, falling back to the global `SITECOREAI_CLIENT_ID`.
 * Used only when the env profile itself carries no `clientId`.
 */
const resolveEnvClientId = (envName: string): string | undefined =>
  readEnvVar(`SITECOREAI_ENV_${normalizeEnvKey(envName)}_CLIENT_ID`) ??
  readEnvVar("SITECOREAI_CLIENT_ID");

/** A resolved automation-client credential pair. */
export interface ResolvedClientCredential {
  clientId: string;
  clientSecret: string;
  /** Which tier supplied the credential — useful for diagnostics. */
  source: "env-var" | "cm-client" | "org-client";
}

export interface ResolveClientCredentialOptions {
  /**
   * Env-profile name — keys tier 1's `SITECOREAI_ENV_<ENV>_*` env vars
   * and tier 2's `cm-client:<env>` keychain slot. Optional: an org-scoped
   * caller (brief, campaign) may have no env profile, in which case
   * tiers 1 and 2 are skipped and only tier 3 (the org-scoped client)
   * can resolve.
   */
  envName?: string;
  /**
   * `clientId` from the env profile (the bring-your-own-client escape
   * hatch). Pairs with the tier-1 env-var secret when set.
   */
  clientId?: string;
  /**
   * `clientId` of the scai-minted env-scoped automation client — read
   * from the env profile's `automationClient` block. Pairs with the
   * tier-2 `cm-client:<env>` keychain secret.
   */
  automationClientId?: string;
  /** Organization id — keys the tier-3 `org-client:<orgId>` slot. */
  organizationId?: string;
  /**
   * `clientId` of the scai-minted org-scoped automation client — read
   * from the root config's `orgClients[orgId]` block. Pairs with the
   * tier-3 `org-client:<orgId>` keychain secret.
   */
  orgClientId?: string;
}

/**
 * Resolve a full `{ clientId, clientSecret }` automation-client pair via
 * the three-tier chain (env var → env-scoped keychain client → org-scoped
 * keychain client). `clientId` and `clientSecret` are always taken as a
 * matched pair from whichever tier supplies the secret.
 *
 * Returns `undefined` when no tier yields a usable pair — the caller
 * decides how to surface the missing credential.
 */
export const resolveClientCredential = async (
  options: ResolveClientCredentialOptions
): Promise<ResolvedClientCredential | undefined> => {
  // Tier 1: bring-your-own-client — secret from the environment, id from
  // the env profile or the matching `SITECOREAI_*_CLIENT_ID` env var.
  // Skipped entirely when there is no env profile to key the env vars by.
  const envSecret = options.envName ? resolveEnvClientSecret(options.envName) : undefined;
  if (envSecret && options.envName) {
    const clientId = options.clientId ?? resolveEnvClientId(options.envName);
    if (clientId) {
      return { clientId, clientSecret: envSecret, source: "env-var" };
    }
  }

  // Tier 2: env-scoped automation client minted by `scai setup client
  // create`. The `clientId` comes from the env profile's
  // `automationClient` block; the secret from the keychain.
  if (options.automationClientId && options.envName) {
    const cmSecret = await getCmClientSecret(options.envName);
    if (cmSecret) {
      return {
        clientId: options.automationClientId,
        clientSecret: cmSecret,
        source: "cm-client",
      };
    }
  }

  // Tier 3: org-scoped automation client — the fallback for org-level
  // profiles with no project/environment of their own. The `clientId`
  // comes from the root config's `orgClients[orgId]` block; the secret
  // from the keychain.
  if (options.organizationId && options.orgClientId) {
    const orgSecret = await getOrgClientSecret(options.organizationId);
    if (orgSecret) {
      return {
        clientId: options.orgClientId,
        clientSecret: orgSecret,
        source: "org-client",
      };
    }
  }

  return undefined;
};
