import fg from "fast-glob";
import path from "node:path";
import fs from "node:fs/promises";
import { RoleData } from "../types";
import { readRoleYamlFromString, writeRoleYaml } from "../yaml";
import type { RootConfiguration, SerializationModuleConfiguration } from "@/config/types";
import { ROLES_FOLDER_SUFFIX } from "./constants";
import { exists } from "./utils";

export const readRolesFromFilesystem = async (
  rootConfig: RootConfiguration,
  moduleConfig: SerializationModuleConfiguration
): Promise<RoleData[]> => {
  const moduleDir = path.dirname(moduleConfig.sourceIdentifier);
  const rolesPath = path.join(
    moduleDir,
    rootConfig.serialization.defaultModuleRelativeSerializationPath,
    ROLES_FOLDER_SUFFIX
  );
  if (!(await exists(rolesPath))) {
    return [];
  }

  const files = await fg("**/*.yml", { cwd: rolesPath, absolute: true, onlyFiles: true });
  const results: RoleData[] = [];
  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    results.push(readRoleYamlFromString(content, file));
  }

  return results;
};

export const writeRoleToFilesystem = async (
  rootConfig: RootConfiguration,
  moduleConfig: SerializationModuleConfiguration,
  role: RoleData
): Promise<string> => {
  const moduleDir = path.dirname(moduleConfig.sourceIdentifier);
  const roleNameParts = role.roleName.split("\\");
  const domain = roleNameParts[0] ?? "default";
  const name = roleNameParts[1] ?? role.roleName;
  const roleDir = path.join(
    moduleDir,
    rootConfig.serialization.defaultModuleRelativeSerializationPath,
    ROLES_FOLDER_SUFFIX,
    domain
  );
  await fs.mkdir(roleDir, { recursive: true });
  const filePath = path.join(roleDir, `${name}.yml`);
  await fs.writeFile(filePath, writeRoleYaml(role), "utf8");
  return filePath;
};

export const removeRoleFromFilesystem = async (rolePath?: string): Promise<void> => {
  if (!rolePath) {
    return;
  }
  await fs.rm(rolePath, { force: true });
};
