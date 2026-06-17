import path from "node:path";
import fs from "node:fs/promises";
import AdmZip from "adm-zip";
import fg from "fast-glob";
import { readRootConfiguration } from "@/config/root-config";
import { normalizeModuleConfiguration } from "@/config/modules";
import type { SerializationModuleConfiguration } from "@/config/types";
import { ItemData, ItemMetadata } from "../types";
import { createFieldFilterSet } from "../field-filter";
import { fetchItemMetadata } from "../api/items";
import { readRolesFromFilesystem } from "../filesystem-store/roles";
import { readUsersFromFilesystem } from "../filesystem-store/users";
import { writeRoleYaml, writeUserYaml, readItemYamlFromString } from "../yaml";
import {
  ensureAllowWrite,
  groupSubtreesByDatabase,
  inputError,
  loadConfigAndModules,
  resolveApiTimeoutMs,
  toLogger,
} from "./shared";
import type { PackageCreateOptions, PackageInstallOptions } from "./types";
import { applySitecoreCommands } from "./helpers/sitecore";
import { buildCommandsForDatabase } from "./helpers/commands";
import { buildItemDataMap } from "./helpers/items";
import { collectItemData } from "./helpers/collect";
import { enrichCreateCommands, enrichUpdateCommands } from "../commands";

const exists = async (value: string): Promise<boolean> => {
  try {
    await fs.access(value);
    return true;
  } catch {
    return false;
  }
};

export const runPackageCreate = async (options: PackageCreateOptions): Promise<void> => {
  const logger = toLogger(options);
  const { root, modules } = await loadConfigAndModules(options);
  const rawOutput = options.output ?? "sitecore.package";
  const outputPath = path.resolve(rawOutput.endsWith(".zip") ? rawOutput : `${rawOutput}.zip`);

  if (await exists(outputPath)) {
    if (options.overwrite) {
      await fs.rm(outputPath, { force: true });
    } else {
      throw inputError(`Package ${outputPath} already exists. Use --overwrite to replace it.`);
    }
  }

  const zip = new AdmZip();
  const rootConfig = {
    modules: modules.map((module) => `${module.namespace}/${module.namespace}.module.json`),
    serialization: { excludedFields: root.serialization.excludedFields },
  };

  zip.addFile("sitecoreai.cli.json", Buffer.from(JSON.stringify(rootConfig, null, 2)));

  for (const module of modules) {
    const modulePath = `${module.namespace}/${module.namespace}.module.json`;
    const moduleContent = await fs.readFile(module.sourceIdentifier);
    zip.addFile(modulePath, moduleContent);
  }

  for (const module of modules) {
    for (const subtree of module.items.includes) {
      const files = await fg("**/*.yml", {
        cwd: subtree.physicalPath,
        absolute: true,
        onlyFiles: true,
      });
      for (const file of files) {
        const relative = path.relative(path.dirname(module.sourceIdentifier), file);
        const entryPath = path.posix.join(module.namespace, relative.split(path.sep).join("/"));
        zip.addFile(entryPath, await fs.readFile(file));
      }
    }

    const roles = await readRolesFromFilesystem(root, module);
    for (const role of roles) {
      const rolePath = role.serializedItemId ?? "";
      const relative = path.relative(path.dirname(module.sourceIdentifier), rolePath);
      const entryPath = path.posix.join(module.namespace, relative.split(path.sep).join("/"));
      zip.addFile(entryPath, Buffer.from(writeRoleYaml(role)));
    }

    const users = await readUsersFromFilesystem(root, module);
    for (const user of users) {
      const userPath = user.serializedItemId ?? "";
      const relative = path.relative(path.dirname(module.sourceIdentifier), userPath);
      const entryPath = path.posix.join(module.namespace, relative.split(path.sep).join("/"));
      zip.addFile(entryPath, Buffer.from(writeUserYaml(user)));
    }
  }

  zip.writeZip(outputPath);
  if (logger.isJson()) {
    logger.json({
      command: "serialization.package.create",
      outputPath,
      modules: modules.length,
    });
    return;
  }
  logger.info(`Created package at ${outputPath}`, "green");
};

export const runPackageInstall = async (options: PackageInstallOptions): Promise<void> => {
  const logger = toLogger(options);
  const root = readRootConfiguration(options.config ?? process.cwd());
  const envName = options.environmentName ?? root.defaultEnvironment;
  const apiTimeoutMs = resolveApiTimeoutMs(root);
  const summary = {
    command: "serialization.package.install",
    environment: envName,
    package: options.package,
    whatIf: Boolean(options.whatIf),
    totalChanges: 0,
    databases: [] as Array<{ database: string; changes: number; applied: boolean }>,
  };

  if (!options.whatIf) {
    ensureAllowWrite(root, envName);
  } else if (!logger.isJson()) {
    logger.info("What if mode is active. No changes will be made.", "yellow");
  }

  const zip = new AdmZip(options.package);
  const rootEntry = zip.getEntry("sitecoreai.cli.json");
  if (!rootEntry) {
    throw inputError("Package did not contain sitecoreai.cli.json index.");
  }

  const rootConfig = JSON.parse(rootEntry.getData().toString("utf8")) as { modules: string[] };
  const moduleConfigs: SerializationModuleConfiguration[] = [];
  for (const modulePath of rootConfig.modules ?? []) {
    const entry = zip.getEntry(modulePath);
    if (!entry) {
      continue;
    }
    const raw = JSON.parse(
      entry.getData().toString("utf8")
    ) as Partial<SerializationModuleConfiguration>;
    moduleConfigs.push(normalizeModuleConfiguration(raw, modulePath, root));
  }

  const subtreesByDb = groupSubtreesByDatabase(moduleConfigs);
  const entries = zip.getEntries().filter((entry) => entry.entryName.endsWith(".yml"));
  for (const [database, subtrees] of subtreesByDb) {
    const packageItems: ItemData[] = [];
    for (const entry of entries) {
      const item = readItemYamlFromString(entry.getData().toString("utf8"));
      const matches = subtrees.find((subtree) => subtree.includesPath(item.path));
      if (!matches) {
        continue;
      }
      item.database = item.database ?? database;
      packageItems.push(item);
    }

    const packageMetadata = packageItems.map((item) => ({
      id: item.id,
      parentId: item.parentId,
      templateId: item.templateId,
      path: item.path,
      dataSignature: item.dataSignature,
    }));

    const destinationMetadata: ItemMetadata[] = [];
    for (const subtree of subtrees) {
      const filter = createFieldFilterSet(root.serialization.excludedFields, []);
      const metadata = await fetchItemMetadata(
        root.environments[envName],
        database,
        subtree.path.toPathString(),
        subtree.scope,
        filter,
        false,
        { timeoutMs: apiTimeoutMs }
      );
      destinationMetadata.push(...metadata.filter((item) => subtree.includesPath(item.path)));
    }

    const commands = buildCommandsForDatabase(subtrees, packageMetadata, destinationMetadata, true);
    const changes = commands.length;
    summary.totalChanges += changes;
    summary.databases.push({
      database,
      changes,
      applied: changes > 0 && !options.whatIf,
    });
    const sourceDataMap = new Map(packageItems.map((item) => [item.id, item]));
    const destData = await collectItemData(envName, root, subtrees, false);
    const destDataMap = buildItemDataMap(destData.items);
    enrichCreateCommands(commands, sourceDataMap);
    enrichUpdateCommands(commands, sourceDataMap, destDataMap, true);

    await applySitecoreCommands({
      root,
      environmentName: envName,
      database,
      commands,
      logger,
      whatIf: options.whatIf,
    });
  }

  if (logger.isJson()) {
    logger.json(summary);
  }
};
