import { readRootConfiguration, SerializationModuleConfiguration } from "@/config";
import { Logger } from "@/shared/logger";
import { fetchUsers, pushUserCommands } from "../../sitecore-api";
import {
  readUsersFromFilesystem,
  removeUserFromFilesystem,
  writeUserToFilesystem,
} from "../../filesystem-store";
import { UserData } from "../../types";
import { resolveApiTimeoutMs } from "../shared";
import { rolesEqual } from "./roles";

const profilePropsEqual = (
  left: UserData["profileProperties"],
  right: UserData["profileProperties"]
): boolean => {
  const serialize = (props: UserData["profileProperties"]) =>
    [...props]
      .map((prop) => `${prop.name}:${prop.content}:${prop.contentType}:${prop.isCustomProperty}`)
      .sort();
  const leftSerialized = serialize(left);
  const rightSerialized = serialize(right);
  if (leftSerialized.length !== rightSerialized.length) {
    return false;
  }
  return leftSerialized.every((value, idx) => value === rightSerialized[idx]);
};

const usersEqual = (left: UserData, right: UserData): boolean =>
  left.userName.toLowerCase() === right.userName.toLowerCase() &&
  (left.email ?? "") === (right.email ?? "") &&
  (left.comment ?? "") === (right.comment ?? "") &&
  left.isApproved === right.isApproved &&
  rolesEqual(left.roles, right.roles) &&
  profilePropsEqual(left.profileProperties, right.profileProperties);

export const syncUsersPull = async (
  root: ReturnType<typeof readRootConfiguration>,
  module: SerializationModuleConfiguration,
  environmentName: string,
  logger: Logger
): Promise<void> => {
  if (module.users.length === 0) {
    return;
  }

  const apiTimeoutMs = resolveApiTimeoutMs(root);
  const predicates = module.users.map((user) => ({ domain: user.domain, pattern: user.pattern }));
  const sourceUsers = await fetchUsers(root.environments[environmentName], predicates, {
    timeoutMs: apiTimeoutMs,
  });
  const destUsers = await readUsersFromFilesystem(root, module);
  const destMap = new Map(destUsers.map((user) => [user.userName.toLowerCase(), user]));

  for (const user of sourceUsers) {
    const existing = destMap.get(user.userName.toLowerCase());
    if (!existing || !usersEqual(existing, user)) {
      await writeUserToFilesystem(root, module, user);
    }
  }

  if (root.serialization.removeOrphansForUsers) {
    const sourceNames = new Set(sourceUsers.map((user) => user.userName.toLowerCase()));
    for (const dest of destUsers) {
      if (!sourceNames.has(dest.userName.toLowerCase())) {
        await removeUserFromFilesystem(dest.serializedItemId);
      }
    }
  }

  logger.info(`[users] Synced ${sourceUsers.length} users`, "green");
};

export const syncUsersPush = async (
  root: ReturnType<typeof readRootConfiguration>,
  module: SerializationModuleConfiguration,
  environmentName: string,
  logger: Logger
): Promise<void> => {
  if (module.users.length === 0) {
    return;
  }

  const apiTimeoutMs = resolveApiTimeoutMs(root);
  const predicates = module.users.map((user) => ({ domain: user.domain, pattern: user.pattern }));
  const sourceUsers = await readUsersFromFilesystem(root, module);
  const destinationUsers = await fetchUsers(root.environments[environmentName], predicates, {
    timeoutMs: apiTimeoutMs,
  });
  const destMap = new Map(destinationUsers.map((user) => [user.userName.toLowerCase(), user]));

  const commands: Array<{ userData: UserData; userCommandType: string }> = [];
  for (const user of sourceUsers) {
    const dest = destMap.get(user.userName.toLowerCase());
    if (!dest) {
      commands.push({ userData: user, userCommandType: "ADD" });
      continue;
    }
    if (!usersEqual(user, dest)) {
      commands.push({ userData: user, userCommandType: "UPDATE" });
    }
  }

  if (root.serialization.removeOrphansForUsers) {
    const sourceNames = new Set(sourceUsers.map((user) => user.userName.toLowerCase()));
    for (const user of destinationUsers) {
      if (!sourceNames.has(user.userName.toLowerCase())) {
        commands.push({ userData: user, userCommandType: "REMOVE" });
      }
    }
  }

  if (commands.length > 0) {
    await pushUserCommands(root.environments[environmentName], commands, {
      timeoutMs: apiTimeoutMs,
    });
  }

  logger.info(`[users] Synced ${commands.length} user changes`, "green");
};
