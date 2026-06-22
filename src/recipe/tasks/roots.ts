import { discoverSites } from "@/authoring";
import { readRootConfiguration } from "@/config/root-config";
import type { EnvironmentConfiguration, EnvironmentRecipeRoots } from "@/config/types";
import { buildScaiEnvelope } from "@/shared/envelope";
import { createScaiError } from "@/shared/errors";
import { deriveRecipeRoots } from "./derive-roots";
import { ensureSiteCollection, toLogger, type RecipeCommonOptions } from "./shared";

export interface RecipeRootsOptions extends RecipeCommonOptions {
  environmentName?: string;
  /** SXA Headless site name. Falls back to envProfiles[<name>].site. */
  site?: string;
  /** SXA Headless site collection. Falls back to the env profile, else discovery. */
  siteCollection?: string;
}

export type DerivedRootsResult = {
  site: string;
  siteCollection: string;
  recipeRoots: EnvironmentRecipeRoots;
};

/**
 * Resolve the site + collection — flag > env profile > discovery — and derive
 * the recipeRoots. `discover` is injected (callers wire `discoverSites`) so the
 * resolution is unit-testable without a tenant.
 */
export const resolveDerivedRoots = async (
  inputs: {
    site?: string;
    siteCollection?: string;
    environment: EnvironmentConfiguration | undefined;
    envName: string;
  },
  discover: (
    environment: EnvironmentConfiguration
  ) => Promise<ReadonlyArray<{ name: string; tenantName: string }>>
): Promise<DerivedRootsResult> => {
  const site = inputs.site?.trim() || inputs.environment?.site?.trim();
  if (!site) {
    throw createScaiError("No site to derive recipe roots from.", "INPUT_INVALID", {
      hint: "Pass --site <name>, or set `site` on the env profile in sitecoreai.cli.json.",
    });
  }

  let siteCollection = inputs.siteCollection?.trim() || inputs.environment?.siteCollection?.trim();
  if (!siteCollection) {
    if (!inputs.environment) {
      throw createScaiError(
        `Cannot resolve a site collection for site '${site}' without an environment to discover from.`,
        "INPUT_INVALID",
        {
          hint: "Pass --site-collection <name>, or --environment-name <env> so scai can discover it.",
        }
      );
    }
    // Reuse the push-path resolver: it discovers the collection by matching the
    // site name against the environment's sites, throwing a clear error on miss.
    const resolved = await ensureSiteCollection(
      { ...inputs.environment, site, siteCollection: undefined },
      inputs.envName,
      discover
    );
    siteCollection = resolved?.siteCollection;
  }

  if (!siteCollection) {
    throw createScaiError(
      `Could not resolve a site collection for site '${site}'.`,
      "INPUT_INVALID",
      { hint: "Pass --site-collection <name> explicitly." }
    );
  }

  return { site, siteCollection, recipeRoots: deriveRecipeRoots(site, siteCollection) };
};

/**
 * `scai provision recipe roots` — print the recipeRoots derived from a site
 * (+ collection). Read-only: no tenant mutation. Lets authors materialise the
 * ~13 SXA paths for `sitecoreai.cli.json` instead of hand-writing them, or
 * inspect exactly what `recipe push` will use.
 */
export const runRecipeRoots = async (options: RecipeRootsOptions): Promise<void> => {
  const logger = toLogger(options);
  const root = readRootConfiguration(options.config ?? process.cwd(), options.environmentName);
  const envName = options.environmentName ?? root.defaultEnvironment;
  const environment = envName ? root.environments[envName] : undefined;

  const result = await resolveDerivedRoots(
    {
      site: options.site,
      siteCollection: options.siteCollection,
      environment,
      envName: envName ?? "(no environment)",
    },
    (env) => discoverSites(env)
  );

  if (logger.isJson()) {
    logger.json(
      buildScaiEnvelope({ command: "recipe.roots", environment: envName ?? null, data: result })
    );
    return;
  }

  logger.info(
    `Derived recipe roots for site '${result.site}' (collection '${result.siteCollection}'):`,
    "cyan"
  );
  logger.info("");
  logger.info("Paste into envProfiles.<name>.recipeRoots in sitecoreai.cli.json:");
  logger.info(JSON.stringify({ recipeRoots: result.recipeRoots }, null, 2));
};
