import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ItemPath } from "../../../../src/serialization/item-path";
import { ItemData, ItemMetadata } from "../../../../src/serialization/types";

const apiMocks = vi.hoisted(() => ({
  fetchItemMetadata: vi.fn(),
  fetchItemData: vi.fn(),
  executeSerializationCommands: vi.fn().mockResolvedValue([]),
  fetchHistoryTimestamp: vi.fn().mockResolvedValue("now"),
  fetchHistoryEntries: vi.fn().mockResolvedValue({ timestamp: "now", entries: [] }),
  fetchRoles: vi.fn().mockResolvedValue([]),
  pushRoleCommands: vi.fn().mockResolvedValue([]),
  fetchUsers: vi.fn().mockResolvedValue([]),
  pushUserCommands: vi.fn().mockResolvedValue([]),
  publishItems: vi.fn().mockResolvedValue({ id: "pub", processedCount: 1, stateName: "Done" }),
  requestClientCredentialsToken: vi.fn().mockResolvedValue({
    accessToken: "token",
    refreshToken: "refresh",
    expiresIn: 3600,
  }),
  requestDeviceAuthorization: vi.fn().mockResolvedValue({
    deviceCode: "device",
    userCode: "user",
    verificationUri: "https://verify",
    expiresIn: 30,
    interval: 1,
  }),
  pollDeviceToken: vi.fn().mockResolvedValue({
    accessToken: "token",
    refreshToken: "refresh",
    expiresIn: 3600,
    tokenType: "Bearer",
  }),
}));

const fsMocks = vi.hoisted(() => ({
  loadFilesystemItems: vi.fn(),
  removeItemFromFilesystem: vi.fn(),
  writeItemToFilesystem: vi.fn(),
  readRolesFromFilesystem: vi.fn().mockResolvedValue([]),
  writeRoleToFilesystem: vi.fn(),
  removeRoleFromFilesystem: vi.fn(),
  readUsersFromFilesystem: vi.fn().mockResolvedValue([]),
  writeUserToFilesystem: vi.fn(),
  removeUserFromFilesystem: vi.fn(),
}));

vi.mock("../../../../src/serialization/sitecore-api/items", () => apiMocks);
vi.mock("../../../../src/serialization/sitecore-api/history", () => apiMocks);
vi.mock("../../../../src/serialization/sitecore-api/roles", () => apiMocks);
vi.mock("../../../../src/serialization/sitecore-api/users", () => apiMocks);
vi.mock("../../../../src/serialization/sitecore-api/publish", () => apiMocks);
vi.mock("../../../../src/serialization/sitecore-api/auth", () => ({
  ...apiMocks,
  DEFAULT_SITECORE_API_AUDIENCE: "https://api.sitecorecloud.io",
  acquireAccessToken: vi.fn().mockResolvedValue("token"),
  getAccessToken: vi.fn().mockResolvedValue("token"),
}));
vi.mock("../../../../src/serialization/filesystem-store/items", () => fsMocks);
vi.mock("../../../../src/serialization/filesystem-store/roles", () => fsMocks);
vi.mock("../../../../src/serialization/filesystem-store/users", () => fsMocks);

const loadSerializationTasks = async (): Promise<
  typeof import("../../../../src/serialization/tasks/info") &
    typeof import("../../../../src/serialization/tasks/pull") &
    typeof import("../../../../src/serialization/tasks/push") &
    typeof import("../../../../src/serialization/tasks/diff") &
    typeof import("../../../../src/serialization/tasks/validate") &
    typeof import("../../../../src/serialization/tasks/package") &
    typeof import("../../../../src/serialization/tasks/env/status") &
    typeof import("../../../../src/serialization/tasks/env/logout") &
    typeof import("../../../../src/serialization/tasks/env/deploy-token") &
    typeof import("../../../../src/serialization/tasks/env/init")
> => {
  const [info, pull, push, diff, validate, pkg, status, logout, deployToken, init] =
    await Promise.all([
      import("../../../../src/serialization/tasks/info"),
      import("../../../../src/serialization/tasks/pull"),
      import("../../../../src/serialization/tasks/push"),
      import("../../../../src/serialization/tasks/diff"),
      import("../../../../src/serialization/tasks/validate"),
      import("../../../../src/serialization/tasks/package"),
      import("../../../../src/serialization/tasks/env/status"),
      import("../../../../src/serialization/tasks/env/logout"),
      import("../../../../src/serialization/tasks/env/deploy-token"),
      import("../../../../src/serialization/tasks/env/init"),
    ]);
  return {
    ...info,
    ...pull,
    ...push,
    ...diff,
    ...validate,
    ...pkg,
    ...status,
    ...logout,
    ...deployToken,
    ...init,
  };
};
vi.mock("../../../../src/shared/keychain", () => ({
  getCmTokens: vi.fn().mockResolvedValue(undefined),
  setCmTokens: vi.fn().mockResolvedValue(true),
  clearCmTokens: vi.fn().mockResolvedValue(true),
  getDeployToken: vi.fn().mockResolvedValue("token"),
  setDeployToken: vi.fn().mockResolvedValue(true),
  clearDeployToken: vi.fn().mockResolvedValue(true),
}));

describe("serialization task runners", () => {
  let rootDir: string;
  let packagePath: string;
  let item: ItemData;
  let metadata: ItemMetadata;

  beforeAll(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-serialization-"));
    const modulePath = path.join(rootDir, "module.module.json");
    await fs.writeFile(
      modulePath,
      JSON.stringify(
        {
          namespace: "demo",
          items: {
            path: "serialization",
            includes: [{ name: "root", path: "/sitecore/content", scope: "singleItem" }],
          },
        },
        null,
        2
      ),
      "utf8"
    );

    const subtreeDir = path.join(rootDir, "serialization", "root");
    await fs.mkdir(subtreeDir, { recursive: true });
    await fs.writeFile(
      path.join(subtreeDir, "item.yml"),
      `---
ID: item-1
Parent: parent-1
Template: template-1
Path: /sitecore/content
SharedFields: []
Languages: []
`,
      "utf8"
    );

    await fs.writeFile(
      path.join(rootDir, "sitecoreai.cli.json"),
      JSON.stringify(
        {
          modules: ["./module.module.json"],
          envProfiles: {
            demo: {
              name: "demo",
              host: "https://cm.example",
              authority: "https://auth.example",
              accessToken: "token",
              allowWrite: true,
            },
          },
          defaultEnvProfile: "demo",
        },
        null,
        2
      ),
      "utf8"
    );

    item = {
      id: "item-1",
      parentId: "parent-1",
      templateId: "template-1",
      path: ItemPath.fromPathString("/sitecore/content"),
      dataSignature: "sig-1",
      name: "content",
      database: "master",
      branchId: null,
      sharedFields: [],
      unversionedFields: [],
      versions: [],
    };
    metadata = {
      id: "item-1",
      parentId: "parent-1",
      templateId: "template-1",
      path: ItemPath.fromPathString("/sitecore/content"),
      dataSignature: "sig-1",
      database: "master",
    };
    apiMocks.fetchItemMetadata.mockResolvedValue([metadata]);
    apiMocks.fetchItemData.mockResolvedValue([item]);
    fsMocks.loadFilesystemItems.mockResolvedValue({ items: [item], metadata: [metadata] });

    packagePath = path.join(rootDir, "package.zip");
  });

  afterAll(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("runs core serialization flows", async () => {
    const tasks = await loadSerializationTasks();
    const keychain = await import("../../../../src/shared/keychain");
    const base = { config: rootDir, environmentName: "demo" };

    await tasks.runInfo(base);
    await tasks.runExplain({ ...base, path: "/sitecore/content", database: "master" });
    await tasks.runPull({ ...base, whatIf: true });
    await tasks.runPush({ ...base, whatIf: true });
    await tasks.runDiff({ ...base, path: "/sitecore/content" });
    await tasks.runValidate({ ...base });

    if ("getCmTokens" in keychain) {
      (
        keychain.getCmTokens as unknown as { mockResolvedValue: (value: unknown) => void }
      ).mockResolvedValue({ accessToken: "cm-token" });
    }
    await tasks.runStatus(base);
    await tasks.runLogout({ ...base, all: true });

    await tasks.runDeployToken({
      ...base,
      clientId: "client",
      clientSecret: "secret",
      useClientCredentials: true,
      print: true,
    });

    await tasks.runPackageCreate({ ...base, output: packagePath, overwrite: true });
    await tasks.runPackageInstall({
      ...base,
      package: packagePath,
      whatIf: true,
    });

    expect(apiMocks.fetchItemMetadata).toHaveBeenCalled();
  });

  it("runs info in JSON mode and explains missing paths", async () => {
    const tasks = await loadSerializationTasks();
    await tasks.runInfo({ config: rootDir, json: true });
    await tasks.runExplain({ config: rootDir, path: "/sitecore/missing", database: "master" });
  });

  it("runs pull/push without what-if and publishes", async () => {
    const tasks = await loadSerializationTasks();
    const base = { config: rootDir, environmentName: "demo" };

    apiMocks.fetchItemMetadata.mockResolvedValue([metadata]);
    apiMocks.fetchItemData.mockResolvedValue([item]);
    apiMocks.executeSerializationCommands.mockResolvedValue([]);
    apiMocks.publishItems.mockResolvedValue({ id: "pub", processedCount: 1, stateName: "Done" });
    fsMocks.loadFilesystemItems
      .mockResolvedValueOnce({ items: [], metadata: [] })
      .mockResolvedValueOnce({ items: [item], metadata: [metadata] });

    await tasks.runPull(base);
    apiMocks.fetchItemMetadata.mockResolvedValueOnce([]);
    await tasks.runPush({ ...base, publish: true, targets: ["web"] });

    expect(apiMocks.executeSerializationCommands).toHaveBeenCalled();
    expect(apiMocks.publishItems).toHaveBeenCalled();
  });

  it("detects duplicate ids in validate", async () => {
    const tasks = await loadSerializationTasks();
    const duplicateMeta: ItemMetadata = {
      id: "dup",
      parentId: "parent",
      templateId: "template",
      path: ItemPath.fromPathString("/sitecore/content"),
      dataSignature: "sig",
      database: "master",
    };
    fsMocks.loadFilesystemItems.mockResolvedValueOnce({
      items: [],
      metadata: [duplicateMeta, duplicateMeta],
    });
    await expect(tasks.runValidate({ config: rootDir, fix: false })).rejects.toThrow("Errors");
  });

  it("reports unresolvable errors when fix is enabled", async () => {
    const tasks = await loadSerializationTasks();
    const duplicateMeta: ItemMetadata = {
      id: "dup",
      parentId: "parent",
      templateId: "template",
      path: ItemPath.fromPathString("/sitecore/content"),
      dataSignature: "sig",
      database: "master",
    };
    fsMocks.loadFilesystemItems.mockResolvedValueOnce({
      items: [],
      metadata: [duplicateMeta, duplicateMeta],
    });
    await expect(tasks.runValidate({ config: rootDir, fix: true })).rejects.toThrow(
      "Unresolvable errors were detected"
    );
  });

  it("runs diff without a path when push is disabled", async () => {
    const tasks = await loadSerializationTasks();
    await tasks.runDiff({ config: rootDir });
  });

  it("applies pull changes when differences exist", async () => {
    const tasks = await loadSerializationTasks();
    const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), "scai-pull-"));
    await fs.writeFile(
      path.join(localRoot, "module.module.json"),
      JSON.stringify(
        {
          namespace: "demo",
          items: {
            path: "serialization",
            includes: [{ name: "root", path: "/sitecore/content", scope: "itemAndDescendants" }],
          },
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(localRoot, "sitecoreai.cli.json"),
      JSON.stringify(
        {
          modules: ["./module.module.json"],
          envProfiles: {
            demo: {
              name: "demo",
              host: "https://cm.example",
              authority: "https://auth.example",
              accessToken: "token",
              allowWrite: true,
            },
          },
          defaultEnvProfile: "demo",
        },
        null,
        2
      ),
      "utf8"
    );

    const sourceMeta: ItemMetadata[] = [
      {
        id: "item-a",
        parentId: "parent-1",
        templateId: "template-1",
        path: ItemPath.fromPathString("/sitecore/content/a"),
        dataSignature: "sig-a",
        database: "master",
      },
      {
        id: "item-b",
        parentId: "parent-1",
        templateId: "template-1",
        path: ItemPath.fromPathString("/sitecore/content/b"),
        dataSignature: "sig-b",
        database: "master",
      },
    ];
    const destMeta: ItemMetadata[] = [
      {
        id: "item-b",
        parentId: "parent-1",
        templateId: "template-1",
        path: ItemPath.fromPathString("/sitecore/content/b"),
        dataSignature: "sig-b-old",
        database: "master",
      },
      {
        id: "item-c",
        parentId: "parent-1",
        templateId: "template-1",
        path: ItemPath.fromPathString("/sitecore/content/c"),
        dataSignature: "sig-c",
        database: "master",
      },
    ];
    const sourceData: ItemData[] = [
      {
        id: "item-a",
        parentId: "parent-1",
        templateId: "template-1",
        path: ItemPath.fromPathString("/sitecore/content/a"),
        dataSignature: "sig-a",
        name: "a",
        database: "master",
        branchId: null,
        sharedFields: [],
        unversionedFields: [],
        versions: [],
      },
      {
        id: "item-b",
        parentId: "parent-1",
        templateId: "template-1",
        path: ItemPath.fromPathString("/sitecore/content/b"),
        dataSignature: "sig-b",
        name: "b",
        database: "master",
        branchId: null,
        sharedFields: [],
        unversionedFields: [],
        versions: [],
      },
    ];

    apiMocks.fetchItemMetadata.mockResolvedValueOnce(sourceMeta);
    apiMocks.fetchItemData.mockResolvedValueOnce(sourceData);
    fsMocks.loadFilesystemItems.mockResolvedValueOnce({ items: [], metadata: destMeta });

    await tasks.runPull({ config: localRoot, environmentName: "demo" });
    expect(fsMocks.writeItemToFilesystem).toHaveBeenCalled();
    await fs.rm(localRoot, { recursive: true, force: true });
  });

  it("applies push changes when differences exist", async () => {
    const tasks = await loadSerializationTasks();
    const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), "scai-push-"));
    await fs.writeFile(
      path.join(localRoot, "module.module.json"),
      JSON.stringify(
        {
          namespace: "demo",
          items: {
            path: "serialization",
            includes: [{ name: "root", path: "/sitecore/content", scope: "itemAndDescendants" }],
          },
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(localRoot, "sitecoreai.cli.json"),
      JSON.stringify(
        {
          modules: ["./module.module.json"],
          envProfiles: {
            demo: {
              name: "demo",
              host: "https://cm.example",
              authority: "https://auth.example",
              accessToken: "token",
              allowWrite: true,
            },
          },
          defaultEnvProfile: "demo",
        },
        null,
        2
      ),
      "utf8"
    );
    const sourceItems: ItemData[] = [
      {
        id: "item-a",
        parentId: "parent-1",
        templateId: "template-1",
        path: ItemPath.fromPathString("/sitecore/content/a"),
        dataSignature: "sig-a",
        name: "a",
        database: "master",
        branchId: null,
        sharedFields: [],
        unversionedFields: [],
        versions: [],
      },
    ];
    const sourceMeta: ItemMetadata[] = [
      {
        id: "item-a",
        parentId: "parent-1",
        templateId: "template-1",
        path: ItemPath.fromPathString("/sitecore/content/a"),
        dataSignature: "sig-a",
        database: "master",
      },
    ];
    const destMeta: ItemMetadata[] = [
      {
        id: "item-a",
        parentId: "parent-1",
        templateId: "template-1",
        path: ItemPath.fromPathString("/sitecore/content/a"),
        dataSignature: "sig-old",
        database: "master",
      },
    ];

    fsMocks.loadFilesystemItems.mockResolvedValueOnce({ items: sourceItems, metadata: sourceMeta });
    apiMocks.fetchItemMetadata.mockResolvedValueOnce(destMeta);
    apiMocks.fetchItemData.mockResolvedValueOnce(sourceItems);

    await tasks.runPush({ config: localRoot, environmentName: "demo" });
    expect(apiMocks.executeSerializationCommands).toHaveBeenCalled();
    await fs.rm(localRoot, { recursive: true, force: true });
  });

  it("syncs roles and users on pull", async () => {
    const tasks = await loadSerializationTasks();
    const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), "scai-roles-pull-"));
    await fs.writeFile(
      path.join(localRoot, "module.module.json"),
      JSON.stringify(
        {
          namespace: "security",
          items: { path: "serialization", includes: [] },
          roles: [{ domain: "sitecore", pattern: "*" }],
          users: [{ domain: "sitecore", pattern: "*" }],
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(localRoot, "sitecoreai.cli.json"),
      JSON.stringify(
        {
          modules: ["./module.module.json"],
          envProfiles: {
            demo: {
              name: "demo",
              host: "https://cm.example",
              authority: "https://auth.example",
              accessToken: "token",
              allowWrite: true,
            },
          },
          serialization: {
            removeOrphansForRoles: true,
            removeOrphansForUsers: true,
          },
          defaultEnvProfile: "demo",
        },
        null,
        2
      ),
      "utf8"
    );

    apiMocks.fetchRoles.mockResolvedValueOnce([
      { roleName: "sitecore\\author", memberOfRoles: ["sitecore\\editor"] },
    ]);
    fsMocks.readRolesFromFilesystem.mockResolvedValueOnce([
      { roleName: "sitecore\\author", memberOfRoles: [], serializedItemId: "role-1" },
      { roleName: "sitecore\\old", memberOfRoles: [], serializedItemId: "role-old" },
    ]);
    apiMocks.fetchUsers.mockResolvedValueOnce([
      {
        userName: "sitecore\\jdoe",
        email: "jdoe@example.com",
        comment: "",
        creationDate: new Date().toISOString(),
        isApproved: true,
        roles: [],
        profileProperties: [],
      },
    ]);
    fsMocks.readUsersFromFilesystem.mockResolvedValueOnce([
      {
        userName: "sitecore\\jdoe",
        email: "old@example.com",
        comment: "",
        creationDate: new Date().toISOString(),
        isApproved: false,
        roles: [],
        profileProperties: [],
        serializedItemId: "user-1",
      },
      {
        userName: "sitecore\\old",
        email: "old@example.com",
        comment: "",
        creationDate: new Date().toISOString(),
        isApproved: true,
        roles: [],
        profileProperties: [],
        serializedItemId: "user-old",
      },
    ]);

    await tasks.runPull({ config: localRoot, environmentName: "demo", whatIf: true });

    expect(fsMocks.writeRoleToFilesystem).toHaveBeenCalled();
    expect(fsMocks.removeRoleFromFilesystem).toHaveBeenCalledWith("role-old");
    expect(fsMocks.writeUserToFilesystem).toHaveBeenCalled();
    expect(fsMocks.removeUserFromFilesystem).toHaveBeenCalledWith("user-old");

    await fs.rm(localRoot, { recursive: true, force: true });
  });

  it("syncs roles and users on push", async () => {
    const tasks = await loadSerializationTasks();
    const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), "scai-roles-push-"));
    await fs.writeFile(
      path.join(localRoot, "module.module.json"),
      JSON.stringify(
        {
          namespace: "security",
          items: { path: "serialization", includes: [] },
          roles: [{ domain: "sitecore", pattern: "*" }],
          users: [{ domain: "sitecore", pattern: "*" }],
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(localRoot, "sitecoreai.cli.json"),
      JSON.stringify(
        {
          modules: ["./module.module.json"],
          envProfiles: {
            demo: {
              name: "demo",
              host: "https://cm.example",
              authority: "https://auth.example",
              accessToken: "token",
              allowWrite: true,
            },
          },
          serialization: {
            removeOrphansForRoles: true,
            removeOrphansForUsers: true,
          },
          defaultEnvProfile: "demo",
        },
        null,
        2
      ),
      "utf8"
    );

    fsMocks.readRolesFromFilesystem.mockResolvedValueOnce([
      { roleName: "sitecore\\author", memberOfRoles: ["sitecore\\parent"] },
    ]);
    apiMocks.fetchRoles.mockResolvedValueOnce([
      { roleName: "sitecore\\author", memberOfRoles: ["sitecore\\legacy"] },
      { roleName: "sitecore\\orphan", memberOfRoles: [] },
    ]);
    fsMocks.readUsersFromFilesystem.mockResolvedValueOnce([
      {
        userName: "sitecore\\jdoe",
        email: "jdoe@example.com",
        comment: "",
        creationDate: new Date().toISOString(),
        isApproved: true,
        roles: ["sitecore\\author"],
        profileProperties: [],
      },
    ]);
    apiMocks.fetchUsers.mockResolvedValueOnce([
      {
        userName: "sitecore\\jdoe",
        email: "jdoe@example.com",
        comment: "",
        creationDate: new Date().toISOString(),
        isApproved: true,
        roles: ["sitecore\\old"],
        profileProperties: [],
      },
      {
        userName: "sitecore\\orphan",
        email: "orphan@example.com",
        comment: "",
        creationDate: new Date().toISOString(),
        isApproved: true,
        roles: [],
        profileProperties: [],
      },
    ]);

    await tasks.runPush({ config: localRoot, environmentName: "demo" });

    expect(apiMocks.pushRoleCommands).toHaveBeenCalled();
    expect(apiMocks.pushUserCommands).toHaveBeenCalled();

    await fs.rm(localRoot, { recursive: true, force: true });
  });
});
