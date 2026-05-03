/**
 * Helpers specific to `scai serialization` task runners — config and
 * module loading, subtree grouping by database, allowWrite check.
 * Neutral helpers (`toLogger`, `selectMatch`, `confirmDestructive`,
 * etc.) live in `@/shared/cli-tasks`; deploy-specific helpers
 * (`getDeployContext`, `extractDeployEnvironmentList`, etc.) live in
 * `@/deploy/tasks/shared`.
 */

import {
  readRootConfiguration,
  readRootConfigurationFile,
  readSerializationModules,
  RootConfiguration,
  SerializationModuleConfiguration,
} from "@/config";
import { FilesystemTreeSpec } from "../tree-spec";
import { createCliError } from "@/shared/errors";
import type { CommonOptions } from "./types";

// Re-exports preserve the existing barrel surface; new code should
// import these directly from `@/shared/cli-tasks`.
export {
  toLogger,
  applyIfDefined,
  inputError,
  confirmDestructive,
  selectMatch,
  selectFromList,
  resolveApiTimeoutMs,
} from "@/shared/cli-tasks";

export const loadConfigAndModules = async (
  options: CommonOptions
): Promise<{ root: RootConfiguration; modules: SerializationModuleConfiguration[] }> => {
  const configPath = options.config ?? process.cwd();
  const rootFile = readRootConfigurationFile(configPath);
  const envName =
    (options as { environmentName?: string }).environmentName ?? rootFile.config.defaultEnvProfile;
  const root = readRootConfiguration(configPath, envName);
  const modules = await readSerializationModules(root, options.include, options.exclude);
  return { root, modules };
};

export const groupSubtreesByDatabase = (
  modules: SerializationModuleConfiguration[]
): Map<string, FilesystemTreeSpec[]> => {
  const map = new Map<string, FilesystemTreeSpec[]>();
  for (const module of modules) {
    for (const subtree of module.items.includes) {
      if (!map.has(subtree.database)) {
        map.set(subtree.database, []);
      }
      map.get(subtree.database)!.push(subtree);
    }
  }
  return map;
};

export const ensureAllowWrite = (root: RootConfiguration, environmentName: string): void => {
  const env = root.environments[environmentName];
  if (!env?.allowWrite) {
    const envKey = environmentName
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    throw createCliError(
      `Environment ${environmentName} is not configured to allow writing data.`,
      "INPUT_INVALID",
      {
        hint: `Set allowWrite in sitecoreai.cli.json, set SITECOREAI_ENV_${envKey}_ALLOW_WRITE=true, or pass --allow-write.`,
      }
    );
  }
};
