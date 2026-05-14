import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { FilesystemTreeSpec } from "../../../src/serialization/tree-spec";
import { ItemPath } from "../../../src/serialization/item-path";
import { FilesystemPathProvider } from "../../../src/serialization/path-provider";
import {
  loadFilesystemItems,
  writeItemToFilesystem,
  removeItemFromFilesystem,
} from "../../../src/serialization/filesystem-store/items";
import {
  readRolesFromFilesystem,
  writeRoleToFilesystem,
  removeRoleFromFilesystem,
} from "../../../src/serialization/filesystem-store/roles";
import {
  readUsersFromFilesystem,
  writeUserToFilesystem,
  removeUserFromFilesystem,
} from "../../../src/serialization/filesystem-store/users";
import { ItemData, RoleData, UserData } from "../../../src/serialization/types";
import type {
  RootConfiguration,
  SerializationModuleConfiguration,
} from "../../../src/config/types";

describe("filesystem store", () => {
  it("writes and loads items", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "scai-fs-"));
    const subtree = new FilesystemTreeSpec();
    subtree.name = "content";
    subtree.database = "master";
    subtree.physicalPath = root;
    subtree.path = ItemPath.fromPathString("/sitecore/content");
    const provider = new FilesystemPathProvider([subtree]);

    const item: ItemData = {
      id: "id-1",
      parentId: "parent-1",
      templateId: "template-1",
      path: ItemPath.fromPathString("/sitecore/content/home"),
      dataSignature: "",
      name: "home",
      database: "master",
      branchId: null,
      sharedFields: [],
      unversionedFields: [],
      versions: [],
    };

    const filePath = await writeItemToFilesystem(provider, item);
    const loaded = await loadFilesystemItems([subtree]);
    expect(loaded.items.length).toBe(1);
    expect(loaded.items[0].path.toPathString()).toBe(item.path.toPathString());

    await removeItemFromFilesystem(provider, loaded.metadata[0]);
    await expect(fs.stat(filePath)).rejects.toThrow();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("writes and reads role and user data", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "scai-fs-roles-"));
    const modulePath = path.join(root, "module.module.json");
    await fs.writeFile(modulePath, "{}", "utf8");

    const rootConfig: RootConfiguration = {
      modules: [],
      serialization: {
        defaultMaxRelativeItemPathLength: 120,
        defaultModuleRelativeSerializationPath: "serialization",
        removeOrphansForRoles: true,
        removeOrphansForUsers: true,
        continueOnItemFailure: false,
        excludedFields: [],
      },
      settings: {
        telemetryEnabled: false,
        cacheAuthenticationToken: true,
        versionComparisonEnabled: true,
        apiClientTimeoutInMinutes: 5,
      },
      environments: {},
      physicalPath: root,
      defaultEnvironment: "demo",
    };
    const moduleConfig: SerializationModuleConfiguration = {
      namespace: "demo",
      items: {
        path: "serialization",
        includes: [],
        excludedFields: [],
      },
      sourceIdentifier: modulePath,
      references: [],
    };

    const role: RoleData = {
      roleName: "sitecore\\editor",
      memberOfRoles: ["sitecore\\author"],
      privileges: [],
    };
    const rolePath = await writeRoleToFilesystem(rootConfig, moduleConfig, role);
    const roles = await readRolesFromFilesystem(rootConfig, moduleConfig);
    expect(roles[0].roleName).toContain("sitecore");
    await removeRoleFromFilesystem(rolePath);

    const user: UserData = {
      userName: "sitecore\\admin",
      email: "admin@example.com",
      comment: "",
      creationDate: new Date().toISOString(),
      isApproved: true,
      roles: ["sitecore\\editor"],
      profileProperties: [],
    };
    const userPath = await writeUserToFilesystem(rootConfig, moduleConfig, user);
    const users = await readUsersFromFilesystem(rootConfig, moduleConfig);
    expect(users[0].userName).toContain("sitecore");
    await removeUserFromFilesystem(userPath);

    await fs.rm(root, { recursive: true, force: true });
  });

  it("returns empty roles/users when folders missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "scai-fs-empty-"));
    const modulePath = path.join(root, "module.module.json");
    await fs.writeFile(modulePath, "{}", "utf8");

    const rootConfig = {
      modules: [],
      serialization: {
        defaultMaxRelativeItemPathLength: 120,
        defaultModuleRelativeSerializationPath: "serialization",
        removeOrphansForRoles: true,
        removeOrphansForUsers: true,
        continueOnItemFailure: false,
        excludedFields: [],
      },
      settings: {
        telemetryEnabled: false,
        cacheAuthenticationToken: true,
        versionComparisonEnabled: true,
        apiClientTimeoutInMinutes: 5,
      },
      environments: {},
      physicalPath: root,
      defaultEnvironment: "demo",
    } as RootConfiguration;
    const moduleConfig = {
      namespace: "demo",
      items: {
        path: "serialization",
        includes: [],
        excludedFields: [],
      },
      sourceIdentifier: modulePath,
      references: [],
    } as SerializationModuleConfiguration;

    expect(await readRolesFromFilesystem(rootConfig, moduleConfig)).toEqual([]);
    expect(await readUsersFromFilesystem(rootConfig, moduleConfig)).toEqual([]);
    await fs.rm(root, { recursive: true, force: true });
  });
});
