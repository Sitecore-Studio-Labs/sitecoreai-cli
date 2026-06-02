import fs from "node:fs";
import path from "node:path";
import { createScaiError } from "../shared/errors";
import {
  DEFAULT_ENVIRONMENT,
  DEFAULT_RECIPES_GLOBS,
  DEFAULT_SERIALIZATION,
  DEFAULT_SETTINGS,
  EnvironmentConfiguration,
  RootConfiguration,
  RootConfigurationFile,
} from "./types";
import { applyEnvOverrides, stripAuthenticationTokensFromConfig } from "./env-overrides";
import { formatValidationErrors, readJsonFile, validateRootConfig } from "./validation";
import { resolveRootConfigurationPath } from "./paths";

/**
 * Surface the resolved config path under `--verbose` so an operator can spot
 * a `sitecoreai.cli.json` picked up from an unexpected ancestor directory.
 * The upward walk is already bounded at the nearest `.git`/`package.json`
 * (see `resolveRootConfigurationPath`) — this is the observability half of
 * that defense. Deduped per process: config is re-read by many tasks within
 * a single command. Stays silent unless `--verbose` is passed (CLI sets the
 * env flag); SDK consumers never see it.
 */
const announcedConfigPaths = new Set<string>();
const announceResolvedConfigPath = (rootPath: string): void => {
  if (process.env.SITECOREAI_VERBOSE !== "1" || process.env.SITECOREAI_QUIET === "1") {
    return;
  }
  if (announcedConfigPaths.has(rootPath)) {
    return;
  }
  announcedConfigPaths.add(rootPath);
  process.stderr.write(`Resolved configuration: ${rootPath}\n`);
};

export const readRootConfigurationFile = (
  configPath: string
): { rootPath: string; rootDir: string; config: RootConfigurationFile } => {
  const rootPath = resolveRootConfigurationPath(configPath);
  announceResolvedConfigPath(rootPath);
  const rootDir = path.dirname(rootPath);
  let rootJson: RootConfigurationFile;
  try {
    rootJson = readJsonFile<RootConfigurationFile>(rootPath);
  } catch (error) {
    const details = error instanceof Error && error.message ? [error.message] : undefined;
    throw createScaiError(`Invalid configuration file at ${rootPath}.`, "CONFIG_INVALID", {
      hint: "Fix the configuration or re-run 'scai setup init' to regenerate it.",
      details,
    });
  }
  const valid = validateRootConfig(rootJson);
  if (!valid) {
    const details = validateRootConfig.errors
      ? formatValidationErrors(validateRootConfig.errors)
      : undefined;
    throw createScaiError(`Invalid configuration file at ${rootPath}.`, "CONFIG_INVALID", {
      hint: "Fix the configuration or re-run 'scai setup init' to regenerate it.",
      details,
    });
  }
  return { rootPath, rootDir, config: rootJson ?? {} };
};

export const writeRootConfigurationFile = (
  configPath: string,
  config: RootConfigurationFile
): void => {
  const rootPath = resolveRootConfigurationPath(configPath);
  const sanitized = stripAuthenticationTokensFromConfig(config);
  fs.writeFileSync(rootPath, JSON.stringify(sanitized, null, 2), "utf8");
};

export const mergeEnvironmentConfigurations = (
  primary?: Record<string, EnvironmentConfiguration>,
  fallback?: Record<string, EnvironmentConfiguration>
): Record<string, EnvironmentConfiguration> => ({
  ...(fallback ?? {}),
  ...(primary ?? {}),
});

export const readRootConfiguration = (
  configPath: string,
  activeEnvironmentName?: string
): RootConfiguration => {
  const { rootPath, config: rootJson } = readRootConfigurationFile(configPath);
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(rootJson.settings ?? {}),
  };
  const environments = resolveEnvironmentReferences(rootJson.envProfiles ?? {});
  const envWithOverrides: Record<string, EnvironmentConfiguration> = {};
  for (const [name, env] of Object.entries(environments)) {
    const includeGlobal = activeEnvironmentName
      ? name.toLowerCase() === activeEnvironmentName.toLowerCase()
      : false;
    envWithOverrides[name] = {
      ...applyEnvOverrides(name, flattenRecipeRoots(name, env), includeGlobal),
      name,
      cacheAuthenticationToken: settings.cacheAuthenticationToken,
    };
  }

  return {
    modules: rootJson.modules ?? [],
    serialization: {
      ...DEFAULT_SERIALIZATION,
      ...(rootJson.serialization ?? {}),
      excludedFields:
        rootJson.serialization?.excludedFields ?? DEFAULT_SERIALIZATION.excludedFields,
    },
    settings,
    environments: envWithOverrides,
    // `aiSkills` is the pre-rename name; read it as a fallback so configs
    // written by older CLI versions keep working. New writes use `brand`.
    brand: rootJson.brand ?? rootJson.aiSkills ?? {},
    orgClients: rootJson.orgClients ?? {},
    physicalPath: rootPath,
    defaultEnvironment: rootJson.defaultEnvProfile ?? DEFAULT_ENVIRONMENT,
    defaultEnvProfile: rootJson.defaultEnvProfile,
    recipes: rootJson.recipes ?? DEFAULT_RECIPES_GLOBS,
    marketplacePluginOverrides: rootJson.marketplacePluginOverrides ?? {},
  };
};

/**
 * Resolve the environment profile a command should act on.
 *
 * Resolution order:
 *   1. An explicitly named env (`--environment-name` / `-n`).
 *   2. The configured `defaultEnvProfile`.
 *   3. The sole env profile, when exactly one is configured — a
 *      single-environment config then works without anyone having to
 *      designate a default. Declining "set as default" during
 *      `setup init` must not strand the only environment.
 *
 * Throws `INPUT_INVALID` when none applies — no profiles configured, or
 * several with no default to disambiguate them — and `ENV_NOT_FOUND`
 * when the resolved name has no matching profile (a stale
 * `--environment-name` or `defaultEnvProfile`).
 *
 * `root` is returned read with the resolved name as the active env, so
 * callers see correct env-override layering without re-reading.
 */
export const resolveActiveEnvironment = (
  configPath: string,
  explicitEnvName: string | undefined
): { envName: string; env: EnvironmentConfiguration; root: RootConfiguration } => {
  const { config } = readRootConfigurationFile(configPath);
  const profileNames = Object.keys(config.envProfiles ?? {});

  let envName = explicitEnvName ?? config.defaultEnvProfile;
  if (!envName) {
    if (profileNames.length === 1) {
      envName = profileNames[0];
    } else if (profileNames.length === 0) {
      throw createScaiError("No environment is configured.", "INPUT_INVALID", {
        hint: "Run `scai setup init` to create one.",
      });
    } else {
      throw createScaiError(
        "No environment specified and no defaultEnvProfile is set.",
        "INPUT_INVALID",
        {
          hint: `Pass an environment name (one of: ${profileNames.join(", ")}), or set a default with \`scai setup init -n <name> --set-default\`.`,
        }
      );
    }
  }

  const root = readRootConfiguration(configPath, envName);
  const env = root.environments[envName];
  if (!env) {
    throw createScaiError(`Environment '${envName}' is not configured.`, "ENV_NOT_FOUND", {
      hint: `Configured environments: ${profileNames.join(", ") || "(none)"}. Run \`scai setup init\` to add it.`,
    });
  }

  return { envName, env, root };
};

/**
 * Pairing of nested-form key (under `recipeRoots`) and its flat-form
 * counterpart on `EnvironmentConfiguration`. The flatten step copies
 * each nested entry into the matching flat field.
 */
const RECIPE_ROOT_PAIRS: ReadonlyArray<
  [keyof NonNullable<EnvironmentConfiguration["recipeRoots"]>, keyof EnvironmentConfiguration]
> = [
  ["templates", "templatesRoot"],
  ["renderings", "renderingsRoot"],
  ["components", "componentsRoot"],
  ["contentModels", "contentModelsRoot"],
  ["partialDesigns", "partialDesignsRoot"],
  ["pageDesigns", "pageDesignsRoot"],
  ["pageTemplates", "pageTemplatesRoot"],
  ["pages", "pagesRoot"],
  ["contentItems", "contentItemsRoot"],
  ["headlessVariants", "headlessVariantsRoot"],
  ["availableRenderings", "availableRenderingsRoot"],
  ["presentationStyles", "presentationStylesRoot"],
  ["enumerations", "enumerationsRoot"],
  ["placeholderSettings", "placeholderSettingsRoots"],
  ["placeholderSettingsCreate", "placeholderSettingsRoot"],
];

/**
 * Flatten `env.recipeRoots.<x>` entries into the matching flat
 * `env.<x>Root` fields so internal consumers see one shape. When the
 * same field is set both nested and flat, **nested wins** (preferred
 * form takes precedence for migrating configs) and a one-line warning
 * fires so the operator can pick a side.
 */
const flattenRecipeRoots = (
  envName: string,
  env: EnvironmentConfiguration
): EnvironmentConfiguration => {
  if (!env.recipeRoots) {
    return env;
  }
  const flattened: EnvironmentConfiguration = { ...env };
  const collisions: string[] = [];
  for (const [nestedKey, flatKey] of RECIPE_ROOT_PAIRS) {
    const nestedValue = env.recipeRoots[nestedKey];
    if (nestedValue === undefined) {
      continue;
    }
    if (env[flatKey] !== undefined) {
      collisions.push(`${flatKey}/recipeRoots.${nestedKey}`);
    }
    (flattened as Record<string, unknown>)[flatKey] = nestedValue;
  }
  if (collisions.length > 0) {
    process.stderr.write(
      `Warning: env profile '${envName}' sets these roots both flat and under recipeRoots: ` +
        `${collisions.join(", ")}. recipeRoots wins. Pick one form.\n`
    );
  }
  return flattened;
};

const resolveEnvironmentReferences = (
  environments: Record<string, EnvironmentConfiguration>
): Record<string, EnvironmentConfiguration> => {
  const resolving = new Set<string>();

  const resolveOne = (name: string): EnvironmentConfiguration => {
    if (resolving.has(name)) {
      throw createScaiError(
        `Environment references are circular for '${name}'.`,
        "CONFIG_INVALID",
        {
          hint: "Remove circular refs in envProfiles.",
        }
      );
    }
    const current = environments[name];
    if (!current) {
      throw createScaiError(`Referenced environment '${name}' was not found.`, "CONFIG_INVALID", {
        hint: "Update envProfiles to reference a valid environment name.",
      });
    }
    if (!current.ref) {
      return { ...current };
    }

    resolving.add(name);
    const base = resolveOne(current.ref);
    resolving.delete(name);

    return { ...base, ...current };
  };

  const resolved: Record<string, EnvironmentConfiguration> = {};
  for (const name of Object.keys(environments)) {
    resolved[name] = resolveOne(name);
  }

  return resolved;
};
