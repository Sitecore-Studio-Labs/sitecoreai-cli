import fg from "fast-glob";
import path from "node:path";
import fs from "node:fs/promises";
import { UserData } from "../types";
import { readUserYamlFromString, writeUserYaml } from "../yaml";
import type { RootConfiguration, SerializationModuleConfiguration } from "@/config/types";
import { USERS_FOLDER_SUFFIX } from "./constants";
import { exists } from "./utils";

export const readUsersFromFilesystem = async (
  rootConfig: RootConfiguration,
  moduleConfig: SerializationModuleConfiguration
): Promise<UserData[]> => {
  const moduleDir = path.dirname(moduleConfig.sourceIdentifier);
  const usersPath = path.join(
    moduleDir,
    rootConfig.serialization.defaultModuleRelativeSerializationPath,
    USERS_FOLDER_SUFFIX
  );
  if (!(await exists(usersPath))) {
    return [];
  }

  const files = await fg("**/*.yml", { cwd: usersPath, absolute: true, onlyFiles: true });
  const results: UserData[] = [];
  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    results.push(readUserYamlFromString(content, file));
  }

  return results;
};

export const writeUserToFilesystem = async (
  rootConfig: RootConfiguration,
  moduleConfig: SerializationModuleConfiguration,
  user: UserData
): Promise<string> => {
  const moduleDir = path.dirname(moduleConfig.sourceIdentifier);
  const usernameParts = user.userName.split("\\");
  const domain = usernameParts[0] ?? "default";
  const name = usernameParts[1] ?? user.userName;
  const userDir = path.join(
    moduleDir,
    rootConfig.serialization.defaultModuleRelativeSerializationPath,
    USERS_FOLDER_SUFFIX,
    domain
  );
  await fs.mkdir(userDir, { recursive: true });
  const filePath = path.join(userDir, `${name}.yml`);
  await fs.writeFile(filePath, writeUserYaml(user), "utf8");
  return filePath;
};

export const removeUserFromFilesystem = async (userPath?: string): Promise<void> => {
  if (!userPath) {
    return;
  }
  await fs.rm(userPath, { force: true });
};
