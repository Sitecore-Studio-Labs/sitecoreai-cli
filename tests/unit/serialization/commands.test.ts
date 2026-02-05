import { describe, expect, it } from "vitest";
import {
  buildCommandsForSubtree,
  buildUpdateCommandData,
  enrichCreateCommands,
  enrichUpdateCommands,
} from "../../../src/serialization/commands";
import {
  AllowedPushOperations,
  FilesystemTreeSpec,
  TreeScope,
} from "../../../src/serialization/tree-spec";
import { ItemPath } from "../../../src/serialization/item-path";
import { compareItems, ItemComparisonResult } from "../../../src/serialization/compare";
import { ItemData, ItemMetadata } from "../../../src/serialization/types";

const makeSpec = (): FilesystemTreeSpec => {
  const spec = new FilesystemTreeSpec();
  spec.name = "content";
  spec.database = "master";
  spec.physicalPath = "/tmp";
  spec.path = ItemPath.fromPathString("/sitecore/content");
  spec.scope = TreeScope.ItemAndDescendants;
  return spec;
};

const makeMeta = (overrides: Partial<ItemMetadata> = {}): ItemMetadata => ({
  id: "id-1",
  parentId: "parent-1",
  templateId: "template-1",
  path: ItemPath.fromPathString("/sitecore/content/home"),
  dataSignature: "sig-1",
  ...overrides,
});

const makeItem = (overrides: Partial<ItemData> = {}): ItemData => ({
  ...makeMeta(),
  name: "home",
  sharedFields: [],
  unversionedFields: [],
  versions: [],
  ...overrides,
});

describe("serialization commands", () => {
  it("builds commands for creates, updates, and deletes", () => {
    const spec = makeSpec();
    const source = [
      makeMeta({ id: "id-1", dataSignature: "a" }),
      makeMeta({
        id: "id-2",
        dataSignature: "b",
        path: ItemPath.fromPathString("/sitecore/content/a"),
      }),
    ];
    const destination = [
      makeMeta({ id: "id-1", dataSignature: "x" }),
      makeMeta({
        id: "id-3",
        dataSignature: "c",
        path: ItemPath.fromPathString("/sitecore/content/old"),
      }),
    ];
    const commands = buildCommandsForSubtree(spec, source, destination, false);
    const types = commands.map((cmd) => cmd.type);
    expect(types).toContain("update");
    expect(types).toContain("create");
    expect(types).toContain("recycle");
  });

  it("builds update commands from comparisons", () => {
    const left = makeItem({
      sharedFields: [{ fieldId: "f1", value: "one" }],
      versions: [{ language: "en", version: 1, fields: [{ fieldId: "f2", value: "v1" }] }],
    });
    const right = makeItem({
      sharedFields: [{ fieldId: "f1", value: "two" }],
      versions: [],
    });
    const comparison = compareItems(left, right);
    const updates = buildUpdateCommandData(comparison, true);
    expect(updates.length).toBeGreaterThan(0);
  });

  it("respects allowed push operations when enabled", () => {
    const spec = makeSpec();
    spec.allowedPushOperations = AllowedPushOperations.CreateOnly;

    const source = [
      makeMeta({ id: "id-1", dataSignature: "a" }),
      makeMeta({ id: "id-2", dataSignature: "b" }),
    ];
    const destination = [
      makeMeta({ id: "id-1", dataSignature: "x" }),
      makeMeta({ id: "id-3", dataSignature: "c" }),
    ];

    const commands = buildCommandsForSubtree(spec, source, destination, true);
    expect(commands).toHaveLength(1);
    expect(commands[0].type).toBe("create");
  });

  it("enriches update and create commands with item data", () => {
    const spec = makeSpec();
    const source = [
      makeMeta({ id: "id-1", dataSignature: "a" }),
      makeMeta({ id: "id-2", dataSignature: "b" }),
    ];
    const destination = [makeMeta({ id: "id-1", dataSignature: "x" })];
    const commands = buildCommandsForSubtree(spec, source, destination, false);

    const sourceData = new Map([
      [
        "id-1",
        makeItem({ id: "id-1", dataSignature: "a", sharedFields: [{ fieldId: "f1", value: "a" }] }),
      ],
      ["id-2", makeItem({ id: "id-2", dataSignature: "b" })],
    ]);
    const destinationData = new Map([
      [
        "id-1",
        makeItem({ id: "id-1", dataSignature: "x", sharedFields: [{ fieldId: "f1", value: "b" }] }),
      ],
    ]);

    enrichUpdateCommands(commands, sourceData, destinationData, true);
    enrichCreateCommands(commands, sourceData);

    const update = commands.find((command) => command.type === "update");
    const create = commands.find((command) => command.type === "create");
    expect(update?.updateCommands?.length).toBeGreaterThan(0);
    expect(create?.sourceData).toBeDefined();
  });

  it("handles version and field resets with restrictions", () => {
    const restrictedTemplateId = "AB86861A-6030-46C5-B394-E8F99E8B87DB";
    const restrictedFieldId = "8CDC337E-A112-42FB-BBB4-4143751E123F";

    const left = makeItem({ templateId: "template-left" });
    const right = makeItem({ templateId: restrictedTemplateId });
    const comparison: ItemComparisonResult = {
      leftItem: left,
      rightItem: right,
      isRenamed: false,
      isMoved: false,
      isTemplateChanged: true,
      isBranchChanged: false,
      changedSharedFields: [],
      changedUnversionedFields: [],
      changedVersions: [
        {
          leftVersion: {
            language: "en",
            version: 1,
            fields: [{ fieldId: "v-left", value: "one" }],
          },
          rightVersion: null,
          changedFields: [{ leftField: { fieldId: "v-left", value: "one" }, rightField: null }],
          versionNumber: 1,
          language: "en",
        },
        {
          leftVersion: null,
          rightVersion: {
            language: "en",
            version: 2,
            fields: [{ fieldId: restrictedFieldId, value: "two" }],
          },
          changedFields: [
            { leftField: null, rightField: { fieldId: restrictedFieldId, value: "two" } },
          ],
          versionNumber: 2,
          language: "en",
        },
        {
          leftVersion: {
            language: "en",
            version: 3,
            fields: [{ fieldId: "v-both", value: "one" }],
          },
          rightVersion: {
            language: "en",
            version: 3,
            fields: [{ fieldId: restrictedFieldId, value: "two" }],
          },
          changedFields: [
            { leftField: null, rightField: { fieldId: restrictedFieldId, value: "two" } },
          ],
          versionNumber: 3,
          language: "en",
        },
      ],
    };
    const updatesPush = buildUpdateCommandData(comparison, true);
    expect(updatesPush.some((update) => update.command === "CHANGE_TEMPLATE")).toBe(true);
    expect(updatesPush.some((update) => update.command === "ADD_VERSION")).toBe(true);
    expect(updatesPush.some((update) => update.command === "REMOVE_VERSION")).toBe(true);
    const versionResetsPush = updatesPush.filter(
      (update) => update.command === "RESET_FIELD" && "version" in update.data
    );
    expect(versionResetsPush).toHaveLength(0);

    const updatesPull = buildUpdateCommandData(comparison, false);
    expect(
      updatesPull.some((update) => update.command === "RESET_FIELD" && "version" in update.data)
    ).toBe(true);
  });

  it("orders standard values after other creates", () => {
    const spec = makeSpec();
    const source = [
      makeMeta({
        id: "id-standard",
        path: ItemPath.fromPathString("/sitecore/content/__Standard Values"),
      }),
      makeMeta({
        id: "id-normal",
        path: ItemPath.fromPathString("/sitecore/content/home"),
      }),
    ];
    const commands = buildCommandsForSubtree(spec, source, [], false);
    const commandIds = commands.map((command) => command.source.id);
    expect(commandIds[commandIds.length - 1]).toBe("id-standard");
  });
});
