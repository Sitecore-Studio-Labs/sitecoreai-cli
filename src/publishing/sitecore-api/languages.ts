import { getAccessToken } from "@/serialization/sitecore-api/auth";
import type { EnvironmentConfiguration } from "@/config/types";
import { listLanguages } from "@/sites/api/languages";
import { listSites } from "@/sites/api/sites";
import { createScaiError } from "@/shared/errors";
import type { Logger } from "@/shared/logger";

/**
 * Sites API helpers for resolving per-site or tenant-wide publish
 * languages. Used by `scai publish *` verbs to back the explicit
 * `--languages-from-site <name>` and `--all-tenant-languages` flags
 * (no implicit resolution — each flag does exactly what its name
 * says).
 *
 * Auth: the Sites API uses `xmcloud.cm:admin` (already in scai's
 * deploy token scope set). No additional grants required — same
 * credentials that mint the publishing token cover site lookups.
 */

/**
 * Look up a single site by exact `name` and return its configured
 * languages. Throws if the site doesn't exist in the env so the
 * caller surfaces a clear error before any publish-API write.
 */
export const lookupSiteLanguages = async (
  environment: EnvironmentConfiguration,
  siteName: string
): Promise<string[]> => {
  const accessToken = await getAccessToken(environment);
  if (!accessToken) {
    throw createScaiError(
      `Could not acquire an access token for site lookup.`,
      "AUTH_REQUIRED",
      { hint: `Run 'scai login -n <env>' first; the Sites API needs the same xmcloud.cm:admin scope scai uses for deploy.` }
    );
  }
  const sites = await listSites({ accessToken });
  const match = sites.find((s) => s.name === siteName);
  if (!match) {
    const available = sites
      .map((s) => s.name)
      .filter((n): n is string => Boolean(n))
      .slice(0, 12);
    throw createScaiError(
      `Site '${siteName}' not found in this env.`,
      "INPUT_INVALID",
      {
        hint: `Available sites: ${available.join(", ")}${
          sites.length > available.length ? ` (and ${sites.length - available.length} more)` : ""
        }.`,
      }
    );
  }
  return (match.languages ?? []).filter((l): l is string => Boolean(l));
};

/**
 * Look up the env's tenant-wide language inventory (all languages
 * registered in the tenant, regardless of which sites use them).
 * Useful as a fallback when an operator wants "every language the
 * tenant supports."
 */
export const lookupTenantLanguages = async (
  environment: EnvironmentConfiguration
): Promise<string[]> => {
  const accessToken = await getAccessToken(environment);
  if (!accessToken) {
    throw createScaiError(
      `Could not acquire an access token for language lookup.`,
      "AUTH_REQUIRED"
    );
  }
  const languages = await listLanguages({ accessToken });
  return languages.map((l) => l.name).filter((n): n is string => Boolean(n));
};
