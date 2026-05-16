import { getAccessToken } from "@/serialization/api/auth";
import type { EnvironmentConfiguration } from "@/config/types";
import { listLanguages } from "@/sites/api/languages";
import { listSites } from "@/sites/api/sites";
import { createScaiError } from "@/shared/errors";
import type { Logger } from "@/shared/logger";

/**
 * Sites API helpers for resolving per-site or tenant-wide publish
 * languages. Used by `scai content publish *` verbs to back the explicit
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
    throw createScaiError(`Could not acquire an access token for site lookup.`, "AUTH_REQUIRED", {
      hint: `Run 'scai setup login -n <env>' first; the Sites API needs the same xmcloud.cm:admin scope scai uses for deploy.`,
    });
  }
  const sites = await listSites({ accessToken });
  const match = sites.find((s) => s.name === siteName);
  if (!match) {
    const available = sites
      .map((s) => s.name)
      .filter((n): n is string => Boolean(n))
      .slice(0, 12);
    throw createScaiError(`Site '${siteName}' not found in this env.`, "INPUT_INVALID", {
      hint: `Available sites: ${available.join(", ")}${
        sites.length > available.length ? ` (and ${sites.length - available.length} more)` : ""
      }.`,
    });
  }
  return (match.languages ?? []).filter((l): l is string => Boolean(l));
};

/**
 * Look up the env's tenant-wide language inventory (all languages
 * registered in the tenant, regardless of which sites use them).
 * Useful as a fallback when an operator wants "every language the
 * tenant supports."
 */
/**
 * The three mutually-exclusive locale-source flags every publish-side
 * task accepts. Pass exactly one (or none, to let the Publishing API
 * use the env's configured publish languages). `resolvePublishingLocales`
 * enforces the exclusivity contract and surfaces the resolved set in
 * non-quiet output so operators never wonder which locales the publish
 * job will see.
 */
export interface PublishLocaleOptions {
  /** Literal language list (e.g. `["en-US"]`). */
  languages?: string[];
  /** Resolve from the named site's `languages` array via Sites API. */
  languagesFromSite?: string;
  /** Resolve from the tenant-wide `listLanguages` set. */
  allTenantLanguages?: boolean;
}

/**
 * Pick the locale list for a publishing call.
 *
 * Exactly one of the three flags may be set. When none is set, scai
 * auto-resolves the tenant-wide language inventory (same as
 * `--all-tenant-languages`) and logs it as "auto-resolved" so the
 * operator sees what's being sent. This default exists because the
 * Publishing API rejects requests with no locales — empirically
 * verified 2026-05-14 against the agents env, the request returns
 * `400 "Publishing locales should be specified either in the job
 * options or per item"`. The `[]` fall-through (claimed by the prior
 * docstring to use "env-configured defaults") is a phantom path the
 * API doesn't support, so we close it here.
 *
 * If the tenant truly has zero languages (misconfigured env), the
 * function still returns `[]` and surfaces a warning — the publish
 * will fail at the API with a clearer error than scai could synthesize.
 */
export const resolvePublishingLocales = async (
  logger: Logger,
  environment: EnvironmentConfiguration,
  options: PublishLocaleOptions
): Promise<string[]> => {
  const flagsSet = [
    options.languages && options.languages.length > 0 ? "--languages" : null,
    options.languagesFromSite ? "--languages-from-site" : null,
    options.allTenantLanguages ? "--all-tenant-languages" : null,
  ].filter((s): s is string => s !== null);
  if (flagsSet.length > 1) {
    throw createScaiError(
      `Locale source is over-specified: ${flagsSet.join(", ")}. Pass exactly one.`,
      "INPUT_INVALID"
    );
  }

  if (options.languages && options.languages.length > 0) {
    logger.info(`Locales: ${options.languages.join(", ")} (literal)`, "cyan");
    return options.languages;
  }

  if (options.languagesFromSite) {
    logger.info(
      `Locales: resolving from site '${options.languagesFromSite}' via Sites API...`,
      "gray"
    );
    const resolved = await lookupSiteLanguages(environment, options.languagesFromSite);
    if (resolved.length === 0) {
      throw createScaiError(
        `Site '${options.languagesFromSite}' has no configured languages.`,
        "INPUT_INVALID",
        { hint: "Add a language to the site or pass --languages explicitly." }
      );
    }
    logger.info(
      `Locales: ${resolved.join(", ")} (from site '${options.languagesFromSite}')`,
      "cyan"
    );
    return resolved;
  }

  if (options.allTenantLanguages) {
    logger.info(`Locales: resolving from tenant-wide listLanguages...`, "gray");
    const resolved = await lookupTenantLanguages(environment);
    if (resolved.length === 0) {
      throw createScaiError("Tenant has no registered languages.", "INPUT_INVALID");
    }
    logger.info(`Locales: ${resolved.join(", ")} (tenant-wide)`, "cyan");
    return resolved;
  }

  // No explicit flag → auto-resolve tenant languages. The Publishing
  // API has no implicit default, so we make the default explicit and
  // log it. Operator can override with --languages or scope with
  // --languages-from-site.
  logger.info(
    `Locales: no --languages flag — auto-resolving from tenant-wide listLanguages...`,
    "gray"
  );
  const resolved = await lookupTenantLanguages(environment);
  if (resolved.length === 0) {
    logger.warn(
      `Tenant has no registered languages — the publish API will reject this request. Add at least one language to the tenant or pass --languages <list>.`,
      "yellow"
    );
    return [];
  }
  logger.info(
    `Locales: ${resolved.join(", ")} (auto-resolved tenant-wide; pass --languages to override or --languages-from-site to narrow)`,
    "cyan"
  );
  return resolved;
};

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
