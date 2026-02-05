import fs from "node:fs";
import path from "node:path";
import { createCliError } from "../shared/errors";
import {
  DEFAULT_ENVIRONMENT,
  DEFAULT_SERIALIZATION,
  DEFAULT_SETTINGS,
  EnvironmentConfiguration,
  RootConfiguration,
  RootConfigurationFile,
} from "./types";
import { applyEnvOverrides, stripAuthenticationTokensFromConfig } from "./env-overrides";
import { formatValidationErrors, readJsonFile, validateRootConfig } from "./validation";
import { resolveRootConfigurationPath } from "./paths";

export const readRootConfigurationFile = (
  configPath: string
): { rootPath: string; rootDir: string; config: RootConfigurationFile } => {
  const rootPath = resolveRootConfigurationPath(configPath);
  const rootDir = path.dirname(rootPath);
  const rootJson = readJsonFile<RootConfigurationFile>(rootPath);
  const valid = validateRootConfig(rootJson);
  if (!valid) {
    const details = validateRootConfig.errors
      ? formatValidationErrors(validateRootConfig.errors)
      : undefined;
    throw createCliError(`Invalid configuration file at ${rootPath}.`, "CONFIG_INVALID", {
      hint: "Fix the configuration or re-run 'scai init' to regenerate it.",
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
      ...applyEnvOverrides(name, env, includeGlobal),
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
    physicalPath: rootPath,
    defaultEnvironment: rootJson.defaultEnvProfile ?? DEFAULT_ENVIRONMENT,
  };
};

const resolveEnvironmentReferences = (
  environments: Record<string, EnvironmentConfiguration>
): Record<string, EnvironmentConfiguration> => {
  const resolving = new Set<string>();

  const resolveOne = (name: string): EnvironmentConfiguration => {
    if (resolving.has(name)) {
      throw createCliError(`Environment references are circular for '${name}'.`, "CONFIG_INVALID", {
        hint: "Remove circular refs in envProfiles.",
      });
    }
    const current = environments[name];
    if (!current) {
      throw createCliError(`Referenced environment '${name}' was not found.`, "CONFIG_INVALID", {
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
