/**
 * Serialization context — root config + serialization-module loading,
 * subtree grouping by database, and the write-consent guard.
 *
 * This is the substantive orchestration the CLI runners (`./tasks`) and
 * MCP tools share. It is exported from the area barrel so an SDK
 * consumer can load the same config + module set the CLI works against.
 *
 * Presentation-free: no logger, no stdout, no `process.exit`.
 */
import { readRootConfiguration, readRootConfigurationFile } from "@/config/root-config";
import { readSerializationModules } from "@/config/modules";
import type { RootConfiguration, SerializationModuleConfiguration } from "@/config/types";
import { createScaiError } from "@/shared/errors";
import { FilesystemTreeSpec } from "./tree-spec";

/** Options for {@link loadConfigAndModules}. */
export interface LoadSerializationModulesOptions {
  /** Base directory for resolving `sitecoreai.cli.json`; defaults to cwd. */
  config?: string;
  /** Environment profile name; defaults to the config's default profile. */
  environmentName?: string;
  /** Module-namespace include filter. */
  include?: string[];
  /** Module-namespace exclude filter. */
  exclude?: string[];
}

/**
 * Resolve the root configuration for an environment and load every
 * serialization module it references.
 */
export const loadConfigAndModules = async (
  options: LoadSerializationModulesOptions
): Promise<{ root: RootConfiguration; modules: SerializationModuleConfiguration[] }> => {
  const configPath = options.config ?? process.cwd();
  const rootFile = readRootConfigurationFile(configPath);
  const envName = options.environmentName ?? rootFile.config.defaultEnvProfile;
  const root = readRootConfiguration(configPath, envName);
  const modules = await readSerializationModules(root, options.include, options.exclude);
  return { root, modules };
};

/** Group every module's subtrees by the database they target. */
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

/** Throw unless the environment is configured to allow writes. */
export const ensureAllowWrite = (root: RootConfiguration, environmentName: string): void => {
  const env = root.environments[environmentName];
  if (!env?.allowWrite) {
    const envKey = environmentName
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    throw createScaiError(
      `Environment ${environmentName} is not configured to allow writing data.`,
      "INPUT_INVALID",
      {
        hint: `Set allowWrite in sitecoreai.cli.json, set SITECOREAI_ENV_${envKey}_ALLOW_WRITE=true, or pass --allow-write.`,
      }
    );
  }
};
