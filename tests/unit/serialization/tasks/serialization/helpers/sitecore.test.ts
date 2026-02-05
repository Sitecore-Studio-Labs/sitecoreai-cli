import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
import { ItemPath } from "../../../../../../src/serialization/item-path";
import type { ItemCommand } from "../../../../../../src/serialization/commands";
import type { ItemData, ItemMetadata } from "../../../../../../src/serialization/types";

const apiMocks = vi.hoisted(() => ({
  executeSerializationCommands: vi.fn(),
}));

const sharedMocks = vi.hoisted(() => ({
  resolveApiTimeoutMs: vi.fn(),
}));

vi.mock("../../../../../../src/serialization/sitecore-api", () => apiMocks);
vi.mock("../../../../../../src/serialization/tasks/shared", () => sharedMocks);

describe("applySitecoreCommands", () => {
  let applySitecoreCommands: (typeof import("../../../../../../src/serialization/tasks/serialization/helpers/sitecore"))["applySitecoreCommands"];

  beforeAll(async () => {
    ({ applySitecoreCommands } =
      await import("../../../../../../src/serialization/tasks/serialization/helpers/sitecore"));
  });

  beforeEach(() => {
    vi.resetAllMocks();
    sharedMocks.resolveApiTimeoutMs.mockReturnValue(1234);
  });

  const makeItemData = (id: string, path: string): ItemData => ({
    id,
    parentId: "parent-1",
    templateId: "template-1",
    path: ItemPath.fromPathString(path),
    dataSignature: "sig-1",
    name: path.split("/").pop() ?? "item",
    database: "master",
    branchId: null,
    sharedFields: [
      { fieldId: "field-1", nameHint: "Title", value: "value", blobId: "blob-1" },
      { fieldId: "field-2", nameHint: "Empty", value: undefined, blobId: undefined },
    ],
    unversionedFields: [
      {
        language: "en",
        fields: [{ fieldId: "u-1", nameHint: "Unversioned", value: "u-value" }],
      },
    ],
    versions: [
      {
        language: "en",
        version: 1,
        fields: [{ fieldId: "v-1", nameHint: "Versioned", value: "v-value" }],
      },
    ],
  });

  const toMetadata = (item: ItemData): ItemMetadata => ({
    id: item.id,
    parentId: item.parentId,
    templateId: item.templateId,
    path: item.path,
    dataSignature: item.dataSignature,
    database: item.database,
  });

  it("maps item commands to API payloads and logs results", async () => {
    const root = {
      environments: {
        demo: { name: "demo" },
      },
    } as unknown as ReturnType<
      (typeof import("../../../../../../src/config"))["readRootConfiguration"]
    >;
    const logger = { info: vi.fn() };

    const createItem = makeItemData("create-1", "/sitecore/content/create");
    const updateItem = makeItemData("update-1", "/sitecore/content/update");
    const moveItem = makeItemData("move-1", "/sitecore/content/move");
    const renameItem = makeItemData("rename-1", "/sitecore/content/rename");
    const recycleItem = makeItemData("recycle-1", "/sitecore/content/recycle");

    const moveDestination = {
      ...toMetadata(moveItem),
      parentId: "parent-2",
    };
    const renameDestination = {
      ...toMetadata(renameItem),
      parentId: "parent-3",
    };

    const commands: ItemCommand[] = [
      { type: "create", source: toMetadata(createItem), sourceData: createItem },
      { type: "update", source: toMetadata(updateItem), sourceData: updateItem },
      { type: "move", source: toMetadata(moveItem), destination: moveDestination },
      { type: "rename", source: toMetadata(renameItem), destination: renameDestination },
      { type: "recycle", source: toMetadata(recycleItem) },
    ];

    apiMocks.executeSerializationCommands.mockResolvedValue([
      { messages: [{ message: "ok", logLevel: "Info" }] },
    ]);

    const result = await applySitecoreCommands(root, "demo", "master", commands, logger, false);

    expect(result).toEqual(["create-1", "update-1", "move-1", "rename-1"]);
    expect(apiMocks.executeSerializationCommands).toHaveBeenCalledTimes(1);

    const [, apiCommands, , options] = apiMocks.executeSerializationCommands.mock.calls[0];
    expect(options).toEqual({ timeoutMs: 1234 });
    expect(apiCommands).toHaveLength(5);
    expect(apiCommands[0]).toMatchObject({
      command: "CREATE",
      itemID: "create-1",
      parentID: "parent-1",
      data: expect.objectContaining({
        id: "create-1",
        path: "/sitecore/content/create",
        branchId: undefined,
        sharedFields: [
          { fieldId: "field-1", nameHint: "Title", value: "value", blobId: "blob-1" },
          { fieldId: "field-2", nameHint: "Empty", value: "", blobId: undefined },
        ],
      }),
    });
    expect(apiCommands[2]).toMatchObject({
      command: "MOVE",
      itemID: "move-1",
      parentID: "parent-2",
      data: "parent-1",
    });
    expect(apiCommands[3]).toMatchObject({
      command: "RENAME",
      itemID: "rename-1",
      parentID: "parent-3",
      data: "rename",
    });
    expect(apiCommands[4]).toMatchObject({
      command: "RECYCLE",
      itemID: "recycle-1",
      data: null,
    });
    expect(logger.info).toHaveBeenCalledWith("ok");
  });

  it("returns empty results when what-if is enabled", async () => {
    const root = {
      environments: {
        demo: { name: "demo" },
      },
    } as unknown as ReturnType<
      (typeof import("../../../../../../src/config"))["readRootConfiguration"]
    >;
    const logger = { info: vi.fn() };
    const commands: ItemCommand[] = [];

    const result = await applySitecoreCommands(root, "demo", "master", commands, logger, true);

    expect(result).toEqual([]);
    expect(apiMocks.executeSerializationCommands).not.toHaveBeenCalled();
  });
});
