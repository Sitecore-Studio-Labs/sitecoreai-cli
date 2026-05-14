import { readRootConfiguration } from "@/config/root-config";
import type { SerializationModuleConfiguration } from "@/config/types";
import { Logger } from "@/shared/logger";
import { fetchRoles, pushRoleCommands } from "../sitecore-api/roles";
import {
  readRolesFromFilesystem,
  removeRoleFromFilesystem,
  writeRoleToFilesystem,
} from "../filesystem-store/roles";
import { resolveApiTimeoutMs } from "./shared";

const normalizeRoleMembers = (roles: string[]): string[] =>
  [...roles].map((role) => role.toLowerCase()).sort();

export const rolesEqual = (left: string[], right: string[]): boolean => {
  const leftSorted = normalizeRoleMembers(left);
  const rightSorted = normalizeRoleMembers(right);
  if (leftSorted.length !== rightSorted.length) {
    return false;
  }
  return leftSorted.every((role, idx) => role === rightSorted[idx]);
};

export const syncRolesPull = async (
  root: ReturnType<typeof readRootConfiguration>,
  module: SerializationModuleConfiguration,
  environmentName: string,
  logger: Logger
): Promise<void> => {
  if (module.roles.length === 0) {
    return;
  }
  const apiTimeoutMs = resolveApiTimeoutMs(root);
  const predicates = module.roles.map((role) => ({ domain: role.domain, pattern: role.pattern }));
  const sourceRoles = await fetchRoles(root.environments[environmentName], predicates, {
    timeoutMs: apiTimeoutMs,
  });
  const destRoles = await readRolesFromFilesystem(root, module);
  const destMap = new Map(destRoles.map((role) => [role.roleName.toLowerCase(), role]));

  for (const role of sourceRoles) {
    const existing = destMap.get(role.roleName.toLowerCase());
    if (!existing || !rolesEqual(existing.memberOfRoles, role.memberOfRoles)) {
      await writeRoleToFilesystem(root, module, role);
    }
  }

  if (root.serialization.removeOrphansForRoles) {
    const sourceNames = new Set(sourceRoles.map((role) => role.roleName.toLowerCase()));
    for (const dest of destRoles) {
      if (!sourceNames.has(dest.roleName.toLowerCase())) {
        await removeRoleFromFilesystem(dest.serializedItemId);
      }
    }
  }

  logger.info(`[roles] Synced ${sourceRoles.length} roles`, "green");
};

export const syncRolesPush = async (
  root: ReturnType<typeof readRootConfiguration>,
  module: SerializationModuleConfiguration,
  environmentName: string,
  logger: Logger
): Promise<void> => {
  if (module.roles.length === 0) {
    return;
  }

  const apiTimeoutMs = resolveApiTimeoutMs(root);
  const predicates = module.roles.map((role) => ({ domain: role.domain, pattern: role.pattern }));
  const sourceRoles = await readRolesFromFilesystem(root, module);
  const destinationRoles = await fetchRoles(root.environments[environmentName], predicates, {
    timeoutMs: apiTimeoutMs,
  });

  const destMap = new Map(destinationRoles.map((role) => [role.roleName.toLowerCase(), role]));

  const commands: Array<{
    roleData: { roleName: string; memberOfRoles: string[] };
    parentRoleData?: { roleName: string };
    roleCommandType: string;
  }> = [];

  for (const role of sourceRoles) {
    const dest = destMap.get(role.roleName.toLowerCase());
    if (!dest) {
      commands.push({
        roleData: { roleName: role.roleName, memberOfRoles: [] },
        roleCommandType: "ADD",
      });
    }

    const destMembers = dest?.memberOfRoles ?? [];
    for (const member of role.memberOfRoles) {
      if (!destMembers.some((existing) => existing.toLowerCase() === member.toLowerCase())) {
        commands.push({
          roleData: { roleName: role.roleName, memberOfRoles: [] },
          parentRoleData: { roleName: member },
          roleCommandType: "ASSIGN",
        });
      }
    }

    for (const member of destMembers) {
      if (!role.memberOfRoles.some((existing) => existing.toLowerCase() === member.toLowerCase())) {
        commands.push({
          roleData: { roleName: role.roleName, memberOfRoles: [] },
          parentRoleData: { roleName: member },
          roleCommandType: "UNASSIGN",
        });
      }
    }
  }

  if (root.serialization.removeOrphansForRoles) {
    const sourceNames = new Set(sourceRoles.map((role) => role.roleName.toLowerCase()));
    for (const role of destinationRoles) {
      if (!sourceNames.has(role.roleName.toLowerCase())) {
        commands.push({
          roleData: { roleName: role.roleName, memberOfRoles: [] },
          roleCommandType: "REMOVE",
        });
      }
    }
  }

  if (commands.length > 0) {
    await pushRoleCommands(root.environments[environmentName], commands, {
      timeoutMs: apiTimeoutMs,
    });
  }

  logger.info(`[roles] Synced ${commands.length} role changes`, "green");
};
