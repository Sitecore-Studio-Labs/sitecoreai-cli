import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { ItemPath } from "../../../../src/serialization/item-path";
import type { ItemData } from "../../../../src/serialization/types";

const sharedMocks = vi.hoisted(() => ({
  groupSubtreesByDatabase: vi.fn(),
  loadConfigAndModules: vi.fn(),
  resolveApiTimeoutMs: vi.fn(),
  toLogger: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  fetchHistoryEntries: vi.fn(),
  fetchHistoryTimestamp: vi.fn(),
  fetchItemData: vi.fn(),
}));

const fsMocks = vi.hoisted(() => ({
  removeItemFromFilesystem: vi.fn(),
  writeItemToFilesystem: vi.fn(),
}));

const runPull = vi.fn();

vi.mock("../../../../src/serialization/tasks/shared", () => sharedMocks);
vi.mock("../../../../src/serialization/sitecore-api", () => apiMocks);
vi.mock("../../../../src/serialization/filesystem-store", () => fsMocks);
vi.mock("../../../../src/serialization/tasks/pull", () => ({
  runPull: (...args: unknown[]) => runPull(...args),
}));
vi.mock("../../../../src/serialization/path-provider", () => ({
  FilesystemPathProvider: class {
    constructor() {}
  },
}));

describe("runWatch", () => {
  let runWatch: (typeof import("../../../../src/serialization/tasks/watch"))["runWatch"];

  beforeAll(async () => {
    ({ runWatch } = await import("../../../../src/serialization/tasks/watch"));
  });

  beforeEach(() => {
    vi.resetAllMocks();
    const logger = { info: vi.fn(), warn: vi.fn() };
    sharedMocks.toLogger.mockReturnValue(logger);
    sharedMocks.resolveApiTimeoutMs.mockReturnValue(5000);
    sharedMocks.loadConfigAndModules.mockResolvedValue({
      root: {
        defaultEnvironment: "demo",
        environments: { demo: { name: "demo" } },
        serialization: { excludedFields: [] },
      },
      modules: [],
    });
    sharedMocks.groupSubtreesByDatabase.mockReturnValue(
      new Map([
        [
          "master",
          [
            {
              includesPath: vi.fn().mockReturnValue(true),
            },
          ],
        ],
      ])
    );
    apiMocks.fetchHistoryTimestamp.mockResolvedValue("ts-0");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("removes recycled items and old paths", async () => {
    vi.useFakeTimers();

    apiMocks.fetchHistoryEntries
      .mockResolvedValueOnce({
        timestamp: "ts-1",
        entries: [
          {
            id: "item-1",
            database: "master",
            path: "/sitecore/content/home",
            changeType: "Recycle",
            oldPath: "/sitecore/content/old-home",
          },
        ],
      })
      .mockRejectedValueOnce(new Error("stop"));

    const runPromise = runWatch({ environmentName: "demo", skipPull: true });
    const expectation = expect(runPromise).rejects.toThrow("stop");

    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);

    await expectation;

    expect(fsMocks.removeItemFromFilesystem).toHaveBeenCalledTimes(2);
    const [firstCall] = fsMocks.removeItemFromFilesystem.mock.calls;
    expect(firstCall[1].path.toPathString()).toBe("/sitecore/content/home");
  });

  it("writes updated items to filesystem", async () => {
    vi.useFakeTimers();

    const item: ItemData = {
      id: "item-2",
      parentId: "parent-1",
      templateId: "template-1",
      path: ItemPath.fromPathString("/sitecore/content/home"),
      dataSignature: "sig-1",
      name: "home",
      database: "master",
      branchId: null,
      sharedFields: [],
      unversionedFields: [],
      versions: [],
    };

    apiMocks.fetchHistoryEntries
      .mockResolvedValueOnce({
        timestamp: "ts-1",
        entries: [
          {
            id: "item-2",
            database: "master",
            path: "/sitecore/content/home",
            changeType: "Update",
          },
        ],
      })
      .mockRejectedValueOnce(new Error("stop"));

    apiMocks.fetchItemData.mockResolvedValue([item]);

    const runPromise = runWatch({ environmentName: "demo", skipPull: true });
    const expectation = expect(runPromise).rejects.toThrow("stop");

    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);

    await expectation;

    expect(fsMocks.writeItemToFilesystem).toHaveBeenCalledWith(expect.anything(), item);
    expect(fsMocks.removeItemFromFilesystem).not.toHaveBeenCalled();
  });

  it("runs initial pull unless skipped", async () => {
    vi.useFakeTimers();

    apiMocks.fetchHistoryEntries.mockRejectedValueOnce(new Error("stop"));

    const runPromise = runWatch({ environmentName: "demo" });
    const expectation = expect(runPromise).rejects.toThrow("stop");

    await vi.advanceTimersByTimeAsync(2000);

    await expectation;

    expect(runPull).toHaveBeenCalledTimes(1);
  });
});
