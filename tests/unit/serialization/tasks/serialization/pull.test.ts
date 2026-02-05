import { beforeEach, describe, expect, it, vi } from "vitest";

const logger = {
  isJson: vi.fn(),
  json: vi.fn(),
  info: vi.fn(),
};

const sharedMocks = vi.hoisted(() => ({
  loadConfigAndModules: vi.fn(),
  groupSubtreesByDatabase: vi.fn(),
  resolveApiTimeoutMs: vi.fn(),
  toLogger: () => logger,
}));

vi.mock("../../../../../src/serialization/tasks/shared", () => sharedMocks);

const apiMocks = vi.hoisted(() => ({
  fetchItemMetadata: vi.fn(),
}));

vi.mock("../../../../../src/serialization/sitecore-api", () => ({
  fetchItemMetadata: (...args: unknown[]) => apiMocks.fetchItemMetadata(...args),
}));

const fsMocks = vi.hoisted(() => ({
  loadFilesystemItems: vi.fn(),
}));

vi.mock("../../../../../src/serialization/filesystem-store", () => ({
  loadFilesystemItems: (...args: unknown[]) => fsMocks.loadFilesystemItems(...args),
}));

const helperMocks = vi.hoisted(() => ({
  applyFilesystemCommands: vi.fn(),
  buildCommandsForDatabase: vi.fn(),
  buildItemDataMap: vi.fn(),
  collectItemData: vi.fn(),
}));

vi.mock("../../../../../src/serialization/tasks/serialization/helpers", () => ({
  applyFilesystemCommands: (...args: unknown[]) => helperMocks.applyFilesystemCommands(...args),
  buildCommandsForDatabase: (...args: unknown[]) => helperMocks.buildCommandsForDatabase(...args),
  buildItemDataMap: (...args: unknown[]) => helperMocks.buildItemDataMap(...args),
  collectItemData: (...args: unknown[]) => helperMocks.collectItemData(...args),
}));

const commandMocks = vi.hoisted(() => ({
  enrichCreateCommands: vi.fn(),
  enrichUpdateCommands: vi.fn(),
}));

vi.mock("../../../../../src/serialization/commands", () => ({
  enrichCreateCommands: (...args: unknown[]) => commandMocks.enrichCreateCommands(...args),
  enrichUpdateCommands: (...args: unknown[]) => commandMocks.enrichUpdateCommands(...args),
}));

const spinnerMocks = vi.hoisted(() => ({
  startSpinner: vi.fn(),
}));

vi.mock("../../../../../src/shared/spinner", () => ({
  startSpinner: (...args: unknown[]) => spinnerMocks.startSpinner(...args),
}));

const pathProviderMocks = vi.hoisted(() => ({
  getPhysicalPathForItemPath: vi.fn(),
}));

vi.mock("../../../../../src/serialization/path-provider", () => ({
  FilesystemPathProvider: class {
    constructor(_specs: unknown[]) {}
    getPhysicalPathForItemPath(...args: unknown[]) {
      return pathProviderMocks.getPhysicalPathForItemPath(...args);
    }
  },
}));

const roleMocks = vi.hoisted(() => ({
  syncRolesPull: vi.fn(),
}));
const userMocks = vi.hoisted(() => ({
  syncUsersPull: vi.fn(),
}));

vi.mock("../../../../../src/serialization/tasks/serialization/roles", () => ({
  syncRolesPull: (...args: unknown[]) => roleMocks.syncRolesPull(...args),
}));
vi.mock("../../../../../src/serialization/tasks/serialization/users", () => ({
  syncUsersPull: (...args: unknown[]) => userMocks.syncUsersPull(...args),
}));

describe("serialization pull task", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    logger.isJson.mockReturnValue(false);
    spinnerMocks.startSpinner.mockResolvedValue({
      succeed: vi.fn(),
      fail: vi.fn(),
    });
    sharedMocks.resolveApiTimeoutMs.mockReturnValue(1000);
  });

  it("skips apply when no changes are detected", async () => {
    const { runPull } = await import("../../../../../src/serialization/tasks/serialization/pull");
    const root = {
      defaultEnvironment: "demo",
      environments: { demo: {} },
      serialization: { excludedFields: [] },
    };
    const modules = [{ items: { includes: [] }, roles: [], users: [] }];
    const subtree = {
      path: { toPathString: () => "/sitecore/content" },
      scope: "DescendantsOnly",
      includesPath: () => true,
    };
    sharedMocks.loadConfigAndModules.mockResolvedValue({ root, modules });
    sharedMocks.groupSubtreesByDatabase.mockReturnValue(new Map([["master", [subtree]]]));
    apiMocks.fetchItemMetadata.mockResolvedValue([
      { path: { toPathString: () => "/sitecore/content" } },
    ]);
    fsMocks.loadFilesystemItems.mockResolvedValue({ items: [], metadata: [] });
    helperMocks.buildCommandsForDatabase.mockReturnValue([]);

    await runPull({ environmentName: "demo" });

    expect(logger.info).toHaveBeenCalledWith("No changes detected for master.", "green");
    expect(helperMocks.applyFilesystemCommands).not.toHaveBeenCalled();
    expect(roleMocks.syncRolesPull).toHaveBeenCalled();
    expect(userMocks.syncUsersPull).toHaveBeenCalled();
  });

  it("reports changes in what-if mode and emits JSON summary", async () => {
    const { runPull } = await import("../../../../../src/serialization/tasks/serialization/pull");
    logger.isJson.mockReturnValue(true);
    const root = {
      defaultEnvironment: "demo",
      environments: { demo: {} },
      serialization: { excludedFields: [] },
    };
    const modules = [{ items: { includes: [] }, roles: [], users: [] }];
    const subtree = {
      path: { toPathString: () => "/sitecore/content" },
      scope: "DescendantsOnly",
      includesPath: () => true,
    };
    sharedMocks.loadConfigAndModules.mockResolvedValue({ root, modules });
    sharedMocks.groupSubtreesByDatabase.mockReturnValue(new Map([["master", [subtree]]]));
    apiMocks.fetchItemMetadata.mockResolvedValue([]);
    fsMocks.loadFilesystemItems.mockResolvedValue({ items: [], metadata: [] });
    helperMocks.buildCommandsForDatabase.mockReturnValue([{ id: "cmd" }]);

    await runPull({ environmentName: "demo", whatIf: true });

    expect(helperMocks.applyFilesystemCommands).not.toHaveBeenCalled();
    expect(logger.json).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "serialization.pull",
        environment: "demo",
        whatIf: true,
        totalChanges: 1,
      })
    );
  });
});
