import { ItemPath } from "../item-path";
import { FilesystemPathProvider } from "../path-provider";
import { loadConfigAndModules, toLogger } from "./shared";
import type { CommonOptions, ExplainOptions } from "./types";

export const runInfo = async (options: CommonOptions): Promise<void> => {
  const logger = toLogger(options);
  const { root, modules } = await loadConfigAndModules(options);

  if (logger.isJson()) {
    logger.json({
      excludedFields: root.serialization.excludedFields,
      modules,
    });
    return;
  }

  if (root.serialization.excludedFields.length > 0) {
    logger.info("Excluded Fields From Default Serialization Config:", "cyan");
    for (const field of root.serialization.excludedFields) {
      logger.verbose(`  ${field.fieldId} ${field.description ?? ""}`.trim(), "yellow");
    }
  }

  if (modules.length === 0) {
    logger.warn("No modules were resolved with file globs.");
    return;
  }

  for (const module of modules) {
    if (!module.items.includes.length && !module.roles.length && !module.users.length) {
      continue;
    }
    logger.info("");
    logger.info(module.namespace, "green");
    if (module.description) {
      logger.info(module.description);
    }
    logger.verbose(`  File: ${module.sourceIdentifier}`, "gray");
    if (module.references.length > 0) {
      logger.verbose(`  Depends on: ${module.references.join(", ")}`, "gray");
    }
    logger.info("  Subtrees:", "gray");
    for (const subtree of module.items.includes) {
      logger.info(
        `    ${subtree.name}: ${subtree.database}:${subtree.path.toPathString()}`,
        "cyan"
      );
      logger.verbose(`      Scope: ${subtree.scope}`, "gray");
      logger.verbose(`      Push operations: ${subtree.allowedPushOperations}`, "gray");
      logger.verbose(`      Path: ${subtree.physicalPath}`, "gray");
    }
    if (module.roles.length > 0) {
      logger.info(`  Roles: ${module.roles.length}`, "gray");
    }
    if (module.users.length > 0) {
      logger.info(`  Users: ${module.users.length}`, "gray");
    }
  }
};

export const runExplain = async (options: ExplainOptions): Promise<void> => {
  const logger = toLogger(options);
  const { modules } = await loadConfigAndModules(options);
  const database = options.database ?? "master";
  const itemPath = ItemPath.fromPathString(options.path);

  const includeSpecs = modules
    .flatMap((module) => module.items.includes)
    .filter((spec) => spec.database.toLowerCase() === database.toLowerCase());
  const pathProvider = new FilesystemPathProvider(includeSpecs);

  for (const module of modules) {
    for (const include of module.items.includes) {
      if (include.database.toLowerCase() !== database.toLowerCase()) {
        continue;
      }

      if (include.includesPath(itemPath)) {
        logger.info(
          `Path ${itemPath.toPathString()} of ${database} database is included!`,
          "green"
        );
        const physicalPath = pathProvider.getPhysicalPathForItemPath(itemPath, ".yml");
        if (physicalPath) {
          logger.info(`Physical path:\n${physicalPath}`);
        }
        return;
      }
    }
  }

  logger.info(
    `Path ${itemPath.toPathString()} of ${database} database is not included in any module configuration.`,
    "red"
  );
};
