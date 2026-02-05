import { beforeEach, describe, expect, it, vi } from "vitest";

const logger = {
  isJson: vi.fn(),
  json: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  verbose: vi.fn(),
};

const sharedMocks = vi.hoisted(() => ({
  toLogger: () => logger,
  loadConfigAndModules: vi.fn(),
}));

vi.mock("../../../../../src/serialization/tasks/shared", () => sharedMocks);

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

describe("serialization info tasks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("prints JSON payload when requested", async () => {
    const { runInfo } = await import("../../../../../src/serialization/tasks/serialization/info");
    logger.isJson.mockReturnValue(true);
    sharedMocks.loadConfigAndModules.mockResolvedValue({
      root: {
        serialization: { excludedFields: [{ fieldId: "field-1", description: "desc" }] },
      },
      modules: [{ namespace: "demo" }],
    });

    await runInfo({ json: true });

    expect(logger.json).toHaveBeenCalledWith(
      expect.objectContaining({
        excludedFields: [{ fieldId: "field-1", description: "desc" }],
        modules: [{ namespace: "demo" }],
      })
    );
  });

  it("warns when no modules were resolved", async () => {
    const { runInfo } = await import("../../../../../src/serialization/tasks/serialization/info");
    logger.isJson.mockReturnValue(false);
    sharedMocks.loadConfigAndModules.mockResolvedValue({
      root: { serialization: { excludedFields: [] } },
      modules: [],
    });

    await runInfo({});

    expect(logger.warn).toHaveBeenCalledWith("No modules were resolved with file globs.");
  });

  it("prints modules, subtrees, roles, and users", async () => {
    const { runInfo } = await import("../../../../../src/serialization/tasks/serialization/info");
    logger.isJson.mockReturnValue(false);
    sharedMocks.loadConfigAndModules.mockResolvedValue({
      root: {
        serialization: {
          excludedFields: [{ fieldId: "field-1", description: "desc" }],
        },
      },
      modules: [
        {
          namespace: "demo",
          description: "Demo module",
          sourceIdentifier: "demo.module.json",
          references: ["base"],
          items: {
            includes: [
              {
                name: "content",
                database: "master",
                path: { toPathString: () => "/sitecore/content" },
                scope: "DescendantsOnly",
                allowedPushOperations: "CreateAndUpdate",
                physicalPath: "/tmp/content",
              },
            ],
          },
          roles: [{ domain: "sitecore", pattern: "*" }],
          users: [{ domain: "sitecore", pattern: "*" }],
        },
      ],
    });

    await runInfo({});

    expect(logger.info).toHaveBeenCalledWith("demo", "green");
    expect(logger.info).toHaveBeenCalledWith("  Subtrees:", "gray");
    expect(logger.info).toHaveBeenCalledWith("    content: master:/sitecore/content", "cyan");
    expect(logger.info).toHaveBeenCalledWith("  Roles: 1", "gray");
    expect(logger.info).toHaveBeenCalledWith("  Users: 1", "gray");
  });

  it("explains included paths and prints physical path", async () => {
    const { runExplain } =
      await import("../../../../../src/serialization/tasks/serialization/info");
    logger.isJson.mockReturnValue(false);
    pathProviderMocks.getPhysicalPathForItemPath.mockReturnValue("/tmp/item.yml");
    sharedMocks.loadConfigAndModules.mockResolvedValue({
      modules: [
        {
          items: {
            includes: [
              {
                database: "master",
                includesPath: () => true,
              },
            ],
          },
        },
      ],
    });

    await runExplain({ path: "/sitecore/content", database: "master" });

    expect(logger.info).toHaveBeenCalledWith(
      "Path /sitecore/content of master database is included!",
      "green"
    );
    expect(logger.info).toHaveBeenCalledWith("Physical path:\n/tmp/item.yml");
  });

  it("explains when path is not included", async () => {
    const { runExplain } =
      await import("../../../../../src/serialization/tasks/serialization/info");
    logger.isJson.mockReturnValue(false);
    sharedMocks.loadConfigAndModules.mockResolvedValue({
      modules: [
        {
          items: {
            includes: [
              {
                database: "master",
                includesPath: () => false,
              },
            ],
          },
        },
      ],
    });

    await runExplain({ path: "/sitecore/content", database: "master" });

    expect(logger.info).toHaveBeenCalledWith(
      "Path /sitecore/content of master database is not included in any module configuration.",
      "red"
    );
  });
});
