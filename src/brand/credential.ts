/**
 * Brand credential resolution shared by every `scai brand` surface and
 * by `scai setup login brand`.
 *
 * Two layers:
 *   - `resolveBrandOrgId` — the pure orgId-resolution rule.
 *   - `resolveBrandClient` — reads the config, resolves the orgId, looks
 *     up the `brand[orgId]` credential, and returns the API client
 *     options a brand operation needs.
 *
 * (`src/brand/recipe/client.ts` has a separate `resolveBrandClient` that
 * resolves from a sync `SyncContext` rather than CLI options — the sync
 * engine always carries an explicit environment, so it does not need
 * the fallbacks here.)
 */

import { readRootConfiguration } from "@/config/root-config";
import { createScaiError } from "@/shared/errors";
import { inputError } from "@/shared/cli-tasks";
import type { BrandApiClientOptions } from "./api/client";

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
