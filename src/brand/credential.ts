/**
 * Brand credential resolution shared by every `scai brand` surface and
 * by `scai setup login brand`.
 *
 * Three layers:
 *   - `resolveBrandOrgId` — the pure orgId-resolution rule.
 *   - `resolveBrandClient` — reads the config, resolves the orgId, looks
 *     up the `brand[orgId]` credential, and returns the API client
 *     options a brand operation needs.
 *   - `resolveBrandSecrets` — pulls the `{ clientId, clientSecret,
 *     authority, audience }` quartet a token mint needs. Env-var
 *     overrides take precedence over the config-and-keychain pair so
 *     serverless callers (the showcase orchestrator) can drive brand
 *     ops without an OS keychain.
 *
 * (`src/brand/recipe/client.ts` has a separate `resolveBrandClient` that
 * resolves from a sync `SyncContext` rather than CLI options — the sync
 * engine always carries an explicit environment, so it does not need
 * the fallbacks here.)
 */

import { readRootConfiguration } from "@/config/root-config";
import { createScaiError } from "@/shared/errors";
import { inputError } from "@/shared/cli-tasks";
import { getBrandClientSecret } from "@/shared/keychain";
import type { BrandApiClientOptions } from "./api/client";
import type { BrandCredential } from "@/config/types";

/**
 * Resolve the Sitecore `organizationId` for a Brand credential.
 * Resolution order:
 *
 *   1. Explicit `orgId` (e.g. from `--org-id`).
 *   2. When an env was explicitly named — via `--environment-name` or a
 *      configured `defaultEnvProfile` — that env profile's
 *      `organizationId`. A named env is authoritative: we never fall
 *      through to a different profile's org behind the operator's back.
 *   3. When no env was named: the first env profile that carries an
 *      `organizationId`. A single-environment config resolves here with
 *      no flag and no default — you don't have to designate a default
 *      env just to use the brand surface.
 *
 * Fails with `INPUT_INVALID` when none of the above yields a value —
 * scai's Brand credentials are one-org-per-credential and we can't
 * act without an org key.
 *
 * Exported for unit testing the resolution branches.
 */
export const resolveBrandOrgId = (
  explicitOrgId: string | undefined,
  environments: Record<string, { organizationId?: string }>,
  envName: string | undefined
): string => {
  if (explicitOrgId) {
    return explicitOrgId;
  }

  if (envName) {
    const named = environments[envName];
    if (named?.organizationId) {
      return named.organizationId;
    }
    throw inputError(
      `Cannot resolve organizationId for Brand credential (env '${envName}' has no organizationId).`,
      "Pass --org-id <id>, or set organizationId on the env profile in sitecoreai.cli.json."
    );
  }

  // No env named and no defaultEnvProfile configured: fall back to the
  // env profiles. The first profile that carries an organizationId wins.
  const fromProfile = Object.values(environments).find((env) => env.organizationId);
  if (fromProfile?.organizationId) {
    return fromProfile.organizationId;
  }

  throw inputError(
    "Cannot resolve organizationId for Brand credential.",
    "Pass --org-id <id>, or set organizationId on an env profile in sitecoreai.cli.json."
  );
};

/** The slice of CLI options `resolveBrandClient` needs. */
export interface BrandClientResolveOptions {
  config?: string;
  environmentName?: string;
  orgId?: string;
}

/**
 * Resolve the `BrandApiClientOptions` a `scai brand` operation runs
 * against: read the config, resolve the orgId (see `resolveBrandOrgId`),
 * and look up the `brand[orgId]` credential.
 *
 * Throws `AUTH_BRAND_REQUIRED` when the org resolves but has no
 * registered credential — the operator must run `scai setup login brand`
 * first.
 */
export const resolveBrandClient = (options: BrandClientResolveOptions): BrandApiClientOptions => {
  const configPath = options.config ?? process.cwd();
  const root = readRootConfiguration(configPath, options.environmentName);
  // `root.defaultEnvProfile` is the raw config value (undefined when no
  // default is set) — distinct from `root.defaultEnvironment`, which
  // collapses an unset default to the literal "default". Only an
  // explicit flag or a real configured default counts as a named env.
  const envName = options.environmentName ?? root.defaultEnvProfile;

  const orgId = resolveBrandOrgId(options.orgId, root.environments, envName);

  const credential = root.brand?.[orgId];
  if (!credential) {
    const envFlag = envName ? ` -n ${envName}` : "";
    throw createScaiError(
      `No Brand credential is configured for org '${orgId}'.`,
      "AUTH_BRAND_REQUIRED",
      { hint: `Run \`scai setup login brand${envFlag}\` to provision one.` }
    );
  }

  return { orgId, credential };
};

/**
 * Default Auth0 authority for Brand credentials. Kept aligned with the
 * one `acquireBrandToken` previously hard-coded so callers that drop in
 * `resolveBrandSecrets` see no behavioural change.
 */
const DEFAULT_BRAND_AUTHORITY = "https://auth.sitecorecloud.io";
const DEFAULT_BRAND_AUDIENCE = "https://api.sitecorecloud.io";

/**
 * Env-var names the serverless fallback honors. The serverless caller —
 * today the showcase orchestrator's `brandkit_deploy` handler — sets
 * these per invocation: there is no shared OS keychain in a Vercel
 * function, so the credential MUST come from the environment.
 *
 * Generic names (no per-org / per-env normalization) on purpose: a
 * single function invocation is always scoped to one org, and the host
 * sets the env vars right before calling scai. If a future caller needs
 * multi-org concurrency in one process, this will need a key-normalized
 * variant — but that day hasn't come.
 */
const BRAND_ENV_CLIENT_ID = "SITECOREAI_BRAND_CLIENT_ID";
const BRAND_ENV_CLIENT_SECRET = "SITECOREAI_BRAND_CLIENT_SECRET";
const BRAND_ENV_AUTHORITY = "SITECOREAI_BRAND_AUTHORITY";
const BRAND_ENV_AUDIENCE = "SITECOREAI_BRAND_AUDIENCE";

const trimmedEnv = (key: string): string | undefined => {
  const raw = process.env[key];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/**
 * The `{ clientId, clientSecret, authority, audience }` a Brand-API
 * client-credentials mint needs, plus the tier that supplied each
 * field for diagnostics.
 */
export interface ResolvedBrandSecrets {
  clientId: string;
  clientSecret: string;
  authority: string;
  audience: string;
  /**
   * Which tier the **secret** came from. `"env"` means the
   * orchestrator-style override; `"keychain"` is the developer-laptop
   * default. The `clientId` / `authority` / `audience` may still come
   * from the config when the secret is from the env (one-shot override
   * of just the secret is supported and useful for short-lived CI
   * secrets paired with a config-pinned client).
   */
  source: "env" | "keychain";
}

export interface ResolveBrandSecretsOptions {
  /** Sitecore organization id — keys the `getBrandClientSecret` slot. */
  orgId: string;
  /** `brand[orgId]` block from the root config — may be absent in serverless. */
  credential?: BrandCredential;
}

/**
 * Resolve the secrets a Brand-API M2M mint needs, walking two tiers:
 *
 *   1. **Environment variables** (`SITECOREAI_BRAND_CLIENT_ID` +
 *      `SITECOREAI_BRAND_CLIENT_SECRET`). Both must be present for this
 *      tier to apply. `SITECOREAI_BRAND_AUTHORITY` and
 *      `SITECOREAI_BRAND_AUDIENCE` are optional overrides that compose
 *      with either tier.
 *   2. **Config + OS keychain** — the developer-laptop default: client
 *      id from the `brand[orgId]` config block, secret from the keychain
 *      (`getBrandClientSecret`).
 *
 * **Precedence:** env wins. Rationale — the env-var path is the
 * explicit, per-invocation override a serverless host (Vercel function,
 * CI runner) sets right before calling scai; treating it as the
 * higher-priority lookup means a host can swap credentials between
 * invocations without touching disk or the keychain. The keychain path
 * is the long-lived default for human developers.
 *
 * Error contract — `AUTH_BRAND_REQUIRED` in three flavors so operators
 * know which knob to turn:
 *
 *   - **Partial env**: one of `SITECOREAI_BRAND_CLIENT_ID` /
 *     `SITECOREAI_BRAND_CLIENT_SECRET` is set but the other isn't.
 *     We treat that as malformed (operator intended env-tier but
 *     missed a var) rather than silently falling through to the
 *     keychain — silent fallthrough would mask a typo and hand the
 *     wrong credential to the API.
 *   - **No credential anywhere**: neither env nor keychain has the
 *     secret, and the config has no `clientId` for the org.
 *   - **Keychain only, no secret**: the config has a `clientId` but
 *     the keychain lookup came back empty (re-login needed).
 *
 * Returns `undefined` only as a sentinel for the "no credential
 * anywhere" case so the caller can build the right hint with the
 * orgId in scope. Other malformed states throw immediately.
 */
export const resolveBrandSecrets = async (
  options: ResolveBrandSecretsOptions
): Promise<ResolvedBrandSecrets | undefined> => {
  const envClientId = trimmedEnv(BRAND_ENV_CLIENT_ID);
  const envClientSecret = trimmedEnv(BRAND_ENV_CLIENT_SECRET);
  const envAuthority = trimmedEnv(BRAND_ENV_AUTHORITY);
  const envAudience = trimmedEnv(BRAND_ENV_AUDIENCE);

  // Tier 1: env vars. Require BOTH the id and the secret — a partial
  // pair is almost always a misconfiguration (forgot to set the other
  // half), and silently falling through to a different credential
  // tier would surface as a confusing 401 from Sitecore rather than
  // the real "your env is malformed" message.
  if (envClientId && envClientSecret) {
    return {
      clientId: envClientId,
      clientSecret: envClientSecret,
      authority: envAuthority ?? options.credential?.authority ?? DEFAULT_BRAND_AUTHORITY,
      audience: envAudience ?? options.credential?.audience ?? DEFAULT_BRAND_AUDIENCE,
      source: "env",
    };
  }
  if (envClientId || envClientSecret) {
    const missing = envClientId ? BRAND_ENV_CLIENT_SECRET : BRAND_ENV_CLIENT_ID;
    throw createScaiError(
      `Brand credential env vars are partially set: ${missing} is missing.`,
      "AUTH_BRAND_REQUIRED",
      {
        hint: `Set both ${BRAND_ENV_CLIENT_ID} and ${BRAND_ENV_CLIENT_SECRET}, or unset both to fall back to the OS keychain.`,
      }
    );
  }

  // Tier 2: config + OS keychain. The config supplies the non-secret
  // metadata (clientId / authority / audience); the keychain supplies
  // the secret.
  if (!options.credential?.clientId) {
    return undefined;
  }
  const keychainSecret = await getBrandClientSecret(options.orgId);
  if (!keychainSecret) {
    return undefined;
  }
  return {
    clientId: options.credential.clientId,
    clientSecret: keychainSecret,
    authority: envAuthority ?? options.credential.authority ?? DEFAULT_BRAND_AUTHORITY,
    audience: envAudience ?? options.credential.audience ?? DEFAULT_BRAND_AUDIENCE,
    source: "keychain",
  };
};
