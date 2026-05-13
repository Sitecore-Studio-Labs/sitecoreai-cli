import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from "vitest";
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
  requestDeviceAuthorization: vi.fn(),
  pollDeviceToken: vi.fn(),
}));

const fsMocks = vi.hoisted(() => ({
  loadFilesystemItems: vi.fn().mockResolvedValue({ items: [], metadata: [] }),
  removeItemFromFilesystem: vi.fn(),
  writeItemToFilesystem: vi.fn(),
  readRolesFromFilesystem: vi.fn().mockResolvedValue([]),
  writeRoleToFilesystem: vi.fn(),
  removeRoleFromFilesystem: vi.fn(),
  readUsersFromFilesystem: vi.fn().mockResolvedValue([]),
  writeUserToFilesystem: vi.fn(),
  removeUserFromFilesystem: vi.fn(),
}));

vi.mock("../../../../src/serialization/sitecore-api", () => apiMocks);
vi.mock("../../../../src/serialization/filesystem-store", () => fsMocks);
vi.mock("../../../../src/shared/keychain", () => ({
  getCmTokens: vi.fn().mockResolvedValue({ accessToken: "cm-token" }),
  setCmTokens: vi.fn().mockResolvedValue(true),
  clearCmTokens: vi.fn().mockResolvedValue(true),
  getDeployToken: vi.fn().mockResolvedValue("token"),
  setDeployToken: vi.fn().mockResolvedValue(true),
  clearDeployToken: vi.fn().mockResolvedValue(true),
}));

const sourceMeta: ItemMetadata = {
  id: "item-a",
  parentId: "parent-1",
  templateId: "template-1",
  path: ItemPath.fromPathString("/sitecore/content/a"),
  dataSignature: "sig-a",
  database: "master",
};

const destMeta: ItemMetadata = {
  id: "item-b",
  parentId: "parent-1",
  templateId: "template-1",
  path: ItemPath.fromPathString("/sitecore/content/b"),
  dataSignature: "sig-b",
  database: "master",
};

const sourceItem: ItemData = {
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
};

const writeTwoEnvConfig = async (rootDir: string): Promise<void> => {
  await fs.writeFile(
    path.join(rootDir, "module.module.json"),
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
    path.join(rootDir, "sitecoreai.cli.json"),
    JSON.stringify(
      {
        modules: ["./module.module.json"],
        envProfiles: {
          source: {
            name: "source",
            host: "https://source.example",
            authority: "https://auth.example",
            accessToken: "src-token",
            allowWrite: false,
          },
          target: {
            name: "target",
            host: "https://target.example",
            authority: "https://auth.example",
            accessToken: "tgt-token",
            allowWrite: true,
          },
        },
        defaultEnvProfile: "source",
      },
      null,
      2
    ),
    "utf8"
  );
};

describe("two-environment ser diff", () => {
  let rootDir: string;

  beforeAll(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-two-env-diff-"));
    await writeTwoEnvConfig(rootDir);
  });

  afterAll(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    apiMocks.fetchItemMetadata.mockReset();
    apiMocks.fetchItemData.mockReset();
    apiMocks.executeSerializationCommands.mockReset().mockResolvedValue([]);
  });

  it("fetches source and target metadata in parallel (one call per env per subtree)", async () => {
    apiMocks.fetchItemMetadata.mockResolvedValue([sourceMeta]);
    const tasks = await import("../../../../src/serialization/tasks");
    await tasks.runDiff({
      config: rootDir,
      source: "source",
      destination: "target",
    });
    // 1 subtree × 2 envs = 2 metadata fetches in module mode.
    expect(apiMocks.fetchItemMetadata).toHaveBeenCalledTimes(2);
    // Verify both envs were hit.
    const calls = apiMocks.fetchItemMetadata.mock.calls.map((args) => args[0]);
    const hosts = calls.map((env) => env.host);
    expect(hosts).toContain("https://source.example");
    expect(hosts).toContain("https://target.example");
    // Without --push, executeSerializationCommands must NOT fire.
    expect(apiMocks.executeSerializationCommands).not.toHaveBeenCalled();
  });

  it("emits mode=instance-vs-instance in --json output when source !== destination", async () => {
    apiMocks.fetchItemMetadata.mockResolvedValue([sourceMeta]);
    const logs: string[] = [];
    const tasks = await import("../../../../src/serialization/tasks");
    const consola = (await import("consola")).consola;
    const writeSpy = vi.spyOn(consola, "info").mockImplementation((message: unknown) => {
      logs.push(String(message));
    });
    try {
      await tasks.runDiff({
        config: rootDir,
        source: "source",
        destination: "target",
        json: true,
      });
    } finally {
      writeSpy.mockRestore();
    }
    const payload = JSON.parse(logs.join(""));
    expect(payload.command).toBe("serialization.diff");
    expect(payload.mode).toBe("instance-vs-instance");
    expect(payload.source).toBe("source");
    expect(payload.destination).toBe("target");
  });

  it("emits mode=local-vs-instance when source === destination", async () => {
    apiMocks.fetchItemMetadata.mockResolvedValue([sourceMeta]);
    const logs: string[] = [];
    const tasks = await import("../../../../src/serialization/tasks");
    const consola = (await import("consola")).consola;
    const writeSpy = vi.spyOn(consola, "info").mockImplementation((message: unknown) => {
      logs.push(String(message));
    });
    try {
      await tasks.runDiff({
        config: rootDir,
        source: "source",
        destination: "source",
        json: true,
      });
    } finally {
      writeSpy.mockRestore();
    }
    const payload = JSON.parse(logs.join(""));
    expect(payload.mode).toBe("local-vs-instance");
  });

  it("rejects --push with empty source and no --force (catastrophic stomp guard)", async () => {
    // Source returns empty metadata; target has items. Push would
    // recycle everything in target — the guard must trigger.
    apiMocks.fetchItemMetadata.mockImplementation(async (env: { host: string }) => {
      if (env.host === "https://source.example") return [];
      return [destMeta];
    });
    apiMocks.fetchItemData.mockResolvedValue([sourceItem]);
    const tasks = await import("../../../../src/serialization/tasks");
    await expect(
      tasks.runDiff({
        config: rootDir,
        source: "source",
        destination: "target",
        push: true,
      })
    ).rejects.toThrow(/Confirmation required/);
    expect(apiMocks.executeSerializationCommands).not.toHaveBeenCalled();
  });

  it("--push --what-if builds the plan but does not write (executeSerializationCommands sees whatIf=true)", async () => {
    apiMocks.fetchItemMetadata.mockResolvedValue([sourceMeta]);
    apiMocks.fetchItemData.mockResolvedValue([sourceItem]);
    const tasks = await import("../../../../src/serialization/tasks");
    await tasks.runDiff({
      config: rootDir,
      source: "source",
      destination: "target",
      push: true,
      whatIf: true,
    });
    // sitecore.ts:16-18 short-circuits when whatIf=true — it returns
    // early without calling executeSerializationCommands. So whatIf=true
    // means the API mock should NOT be hit.
    expect(apiMocks.executeSerializationCommands).not.toHaveBeenCalled();
  });

  it("emits verbose changes block in JSON when --verbose set", async () => {
    apiMocks.fetchItemMetadata.mockImplementation(async (env: { host: string }) => {
      if (env.host === "https://source.example") return [sourceMeta];
      return [destMeta];
    });
    const logs: string[] = [];
    const tasks = await import("../../../../src/serialization/tasks");
    const consola = (await import("consola")).consola;
    const writeSpy = vi.spyOn(consola, "info").mockImplementation((message: unknown) => {
      logs.push(String(message));
    });
    try {
      await tasks.runDiff({
        config: rootDir,
        source: "source",
        destination: "target",
        verbose: true,
        json: true,
      });
    } finally {
      writeSpy.mockRestore();
    }
    const payload = JSON.parse(logs.join(""));
    expect(payload.databases[0].changes).toBeDefined();
    expect(payload.databases[0].changes.create).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "item-a", path: "/sitecore/content/a" }),
      ])
    );
    expect(payload.databases[0].changes.recycle).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "item-b", path: "/sitecore/content/b" }),
      ])
    );
  });

  it("throws INPUT_INVALID when source environment is not defined", async () => {
    const tasks = await import("../../../../src/serialization/tasks");
    await expect(
      tasks.runDiff({
        config: rootDir,
        source: "nope",
        destination: "target",
      })
    ).rejects.toThrow(/Source environment 'nope'/);
  });

  it("throws INPUT_INVALID when target environment is not defined", async () => {
    const tasks = await import("../../../../src/serialization/tasks");
    await expect(
      tasks.runDiff({
        config: rootDir,
        source: "source",
        destination: "nope",
      })
    ).rejects.toThrow(/Target environment 'nope'/);
  });
});

describe("normalizeArgs flag aliases", () => {
  it("rewrites --source-env to --source and --target-env to --destination", async () => {
    const { normalizeArgs } = await import("../../../../src/commands/shared");
    expect(normalizeArgs(["--source-env", "prod", "--target-env", "stage", "--push"])).toEqual([
      "--source",
      "prod",
      "--destination",
      "stage",
      "--push",
    ]);
  });

  it("leaves the original --source and --destination forms alone", async () => {
    const { normalizeArgs } = await import("../../../../src/commands/shared");
    expect(normalizeArgs(["--source", "a", "--destination", "b"])).toEqual([
      "--source",
      "a",
      "--destination",
      "b",
    ]);
  });
});
