import fg from "fast-glob";
import path from "node:path";
import { createScaiError } from "../shared/errors";
import { ItemPath } from "../serialization/item-path";
import {
  AllowedPushOperations,
  FilesystemTreeSpec,
  FilesystemTreeSpecRule,
  TreeRuleScope,
  TreeScope,
  parseItemPathMatch,
} from "../serialization/tree-spec";
import { FieldFilter, RolePredicateItem, UserPredicateItem } from "../serialization/types";
import type { RootConfiguration, SerializationModuleConfiguration } from "./types";
import { formatValidationErrors, readJsonFile, validateModuleConfig } from "./validation";

const resolveScope = (scope?: string): TreeScope => {
  switch ((scope ?? "").toLowerCase()) {
    case "singleitem":
      return TreeScope.SingleItem;
    case "itemandchildren":
      return TreeScope.ItemAndChildren;
    case "descendantsonly":
      return TreeScope.DescendantsOnly;
    case "itemanddescendants":
    default:
      return TreeScope.ItemAndDescendants;
  }
};

const resolveRuleScope = (scope?: string): TreeRuleScope | undefined => {
  if (!scope) {
    return undefined;
  }
  switch (scope.toLowerCase()) {
    case "ignored":
      return TreeRuleScope.Ignored;
    case "singleitem":
      return TreeRuleScope.SingleItem;
    case "itemandchildren":
      return TreeRuleScope.ItemAndChildren;
    case "itemanddescendants":
      return TreeRuleScope.ItemAndDescendants;
    default:
      return undefined;
  }
};

const resolveAllowedPushOperations = (value?: string): AllowedPushOperations => {
  switch ((value ?? "").toLowerCase()) {
    case "createonly":
      return AllowedPushOperations.CreateOnly;
    case "createandupdate":
      return AllowedPushOperations.CreateAndUpdate;
    case "createupdateanddelete":
    default:
      return AllowedPushOperations.CreateUpdateAndDelete;
  }
};

const resolveModuleItemsPath = (
  moduleConfig: SerializationModuleConfiguration,
  modulePath: string,
  rootConfig: RootConfiguration
): string => {
  const raw =
    moduleConfig.items.path ?? rootConfig.serialization.defaultModuleRelativeSerializationPath;
  if (raw.startsWith("~/")) {
    const rooted = raw.slice(2).replace("$(module)", moduleConfig.namespace ?? "module");
    return path.join(path.dirname(rootConfig.physicalPath), rooted);
  }

  return path.join(path.dirname(modulePath), raw);
};

const normalizeFieldFilters = (filters?: FieldFilter[]): FieldFilter[] =>
  (filters ?? []).map((filter) => ({
    fieldId: filter.fieldId ?? (filter as unknown as { FieldId?: string }).FieldId ?? "",
    description: filter.description,
  }));

export const normalizeModuleConfiguration = (
  raw: Partial<SerializationModuleConfiguration>,
  moduleFile: string,
  rootConfig: RootConfiguration
): SerializationModuleConfiguration => {
  const moduleConfig: SerializationModuleConfiguration = {
    namespace: raw.namespace ?? "",
    description: raw.description,
    references: raw.references ?? [],
    items: {
      path: raw.items?.path,
      includes: [],
      excludedFields: normalizeFieldFilters(raw.items?.excludedFields as FieldFilter[]),
    },
    roles: (raw.roles ?? []) as RolePredicateItem[],
    users: (raw.users ?? []) as UserPredicateItem[],
    tags: raw.tags ?? [],
    sourceIdentifier: moduleFile,
  };

  const basePath = resolveModuleItemsPath(moduleConfig, moduleFile, rootConfig);
  for (const includeSpec of raw.items?.includes ?? []) {
    const include = includeSpec as unknown as {
      name?: string;
      database?: string;
      path?: string;
      scope?: string;
      allowedPushOperations?: string;
      rules?: Array<{
        path: string;
        scope?: string;
        allowedPushOperations?: string;
        alias?: string;
      }>;
      maxRelativePathLength?: number;
    };

    if (!include.path || !include.name) {
      continue;
    }

    const subtree = new FilesystemTreeSpec();
    subtree.name = include.name;
    subtree.database = include.database ?? "master";
    subtree.path = ItemPath.fromPathString(include.path);
    subtree.scope = resolveScope(include.scope);
    subtree.allowedPushOperations = resolveAllowedPushOperations(include.allowedPushOperations);
    subtree.maxRelativePathLength = include.maxRelativePathLength;
    subtree.physicalPath = path.join(basePath, include.name);

    subtree.rules = (include.rules ?? []).map((rule) => {
      const treeRule = new FilesystemTreeSpecRule();
      treeRule.path = parseItemPathMatch(rule.path);
      treeRule.scope = resolveRuleScope(rule.scope);
      treeRule.allowedPushOperations = rule.allowedPushOperations
        ? resolveAllowedPushOperations(rule.allowedPushOperations)
        : undefined;
      treeRule.alias = rule.alias;
      return treeRule;
    });

    moduleConfig.items.includes.push(subtree);
  }

  return moduleConfig;
};

export const readSerializationModules = async (
  rootConfig: RootConfiguration,
  include?: string[],
  exclude?: string[]
): Promise<SerializationModuleConfiguration[]> => {
  if (!rootConfig.modules.length) {
    throw createScaiError(
      "Root configuration does not contain any module path definitions.",
      "CONFIG_INVALID"
    );
  }

  const rootDir = path.dirname(rootConfig.physicalPath);
  const moduleFiles = await fg(rootConfig.modules, {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
  });

  const modules: SerializationModuleConfiguration[] = [];
  for (const moduleFile of moduleFiles) {
    const raw = readJsonFile<Partial<SerializationModuleConfiguration>>(moduleFile);
    const valid = validateModuleConfig(raw);
    if (!valid) {
      const details = validateModuleConfig.errors
        ? formatValidationErrors(validateModuleConfig.errors)
        : undefined;
      throw createScaiError(`Invalid module configuration at ${moduleFile}.`, "CONFIG_INVALID", {
        hint: "Fix the module JSON to match the serialization module schema.",
        details,
      });
    }
    modules.push(normalizeModuleConfiguration(raw, moduleFile, rootConfig));
  }

  const filtered = modules.filter((module) => {
    if (include && include.length > 0) {
      const matches = include.some((pattern) =>
        module.namespace.toLowerCase().includes(pattern.toLowerCase())
      );
      if (!matches) {
        return false;
      }
    }

    if (exclude && exclude.length > 0) {
      const excluded = exclude.some((pattern) =>
        module.namespace.toLowerCase().includes(pattern.toLowerCase())
      );
      if (excluded) {
        return false;
      }
    }

    return true;
  });

  return filtered;
};
