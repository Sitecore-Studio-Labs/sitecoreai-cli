import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { ItemPath } from "../../../src/serialization/item-path";
import type { FilesystemTreeSpec } from "../../../src/serialization/tree-spec";
import type { ItemData } from "../../../src/serialization/types";

const fgMocks = vi.hoisted(() => ({
  default: vi.fn(),
}));

vi.mock("fast-glob", () => ({
  default: (...args: unknown[]) => fgMocks.default(...args),
}));

const yamlMocks = vi.hoisted(() => ({
  readItemYaml: vi.fn(),
  writeItemYaml: vi.fn(),
}));

vi.mock("../../../src/serialization/yaml", () => ({
  readItemYaml: (...args: unknown[]) => yamlMocks.readItemYaml(...args),
  writeItemYaml: (...args: unknown[]) => yamlMocks.writeItemYaml(...args),
}));

const signatureMocks = vi.hoisted(() => ({
  createDataSignatureBase: vi.fn(),
  createSignature: vi.fn(),
}));

vi.mock("../../../src/serialization/signature", () => ({
  createDataSignatureBase: (...args: unknown[]) => signatureMocks.createDataSignatureBase(...args),
  createSignature: (...args: unknown[]) => signatureMocks.createSignature(...args),
}));

const fsMocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: fsMocks,
  ...fsMocks,
}));

const makeSubtree = (options: {
  physicalPath: string;
  database: string;
  includesPath: (value: unknown) => boolean;
}): FilesystemTreeSpec =>
  ({
    physicalPath: options.physicalPath,
    database: options.database,
    includesPath: options.includesPath,
  }) as FilesystemTreeSpec;

describe("filesystem store items", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("skips items outside the subtree and preserves signatures", async () => {
    const { loadFilesystemItems } =
      await import("../../../src/serialization/filesystem-store/items");
    const subtree = makeSubtree({
      physicalPath: "/root",
      database: "master",
      includesPath: (value) =>
        typeof value === "object" &&
        value !== null &&
        "toPathString" in value &&
        typeof (value as { toPathString: () => string }).toPathString === "function" &&
        (value as { toPathString: () => string }).toPathString() === "/sitecore/content/home",
    });

    fgMocks.default.mockResolvedValue(["/root/one.yml", "/root/two.yml"]);
    yamlMocks.readItemYaml
      .mockResolvedValueOnce({
        id: "item-1",
        parentId: "parent-1",
        templateId: "template-1",
        path: ItemPath.fromPathString("/sitecore/other"),
        dataSignature: "sig-1",
        name: "other",
        database: "web",
        branchId: null,
        sharedFields: [],
        unversionedFields: [],
        versions: [],
      } satisfies ItemData)
      .mockResolvedValueOnce({
        id: "item-2",
        parentId: "parent-1",
        templateId: "template-1",
        path: ItemPath.fromPathString("/sitecore/content/home"),
        dataSignature: "sig-2",
        name: "home",
        database: "master",
        branchId: null,
        sharedFields: [],
        unversionedFields: [],
        versions: [],
      } satisfies ItemData);

    const result = await loadFilesystemItems([subtree]);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe("item-2");
    expect(signatureMocks.createDataSignatureBase).not.toHaveBeenCalled();
    expect(signatureMocks.createSignature).not.toHaveBeenCalled();
  });

  it("fills missing database and data signature", async () => {
    const { loadFilesystemItems } =
      await import("../../../src/serialization/filesystem-store/items");
    const subtree = makeSubtree({
      physicalPath: "/root",
      database: "master",
      includesPath: () => true,
    });

    fgMocks.default.mockResolvedValue(["/root/one.yml"]);
    yamlMocks.readItemYaml.mockResolvedValue({
      id: "item-3",
      parentId: "parent-1",
      templateId: "template-1",
      path: ItemPath.fromPathString("/sitecore/content/home"),
      name: "home",
      branchId: null,
      sharedFields: [],
      unversionedFields: [],
      versions: [],
    } satisfies ItemData);
    signatureMocks.createDataSignatureBase.mockReturnValue("base");
    signatureMocks.createSignature.mockReturnValue("sig-3");

    const result = await loadFilesystemItems([subtree]);

    expect(result.items[0].database).toBe("master");
    expect(result.items[0].dataSignature).toBe("sig-3");
    expect(result.metadata[0].dataSignature).toBe("sig-3");
    expect(signatureMocks.createDataSignatureBase).toHaveBeenCalled();
    expect(signatureMocks.createSignature).toHaveBeenCalledWith("base");
  });

  it("throws when unable to resolve an item path for write", async () => {
    const { writeItemToFilesystem } =
      await import("../../../src/serialization/filesystem-store/items");
    const provider = {
      getPhysicalPathForItemPath: () => null,
    };

    const item = {
      id: "item-4",
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
    } satisfies ItemData;

    await expect(writeItemToFilesystem(provider as never, item)).rejects.toThrow(
      "Unable to resolve file path"
    );
  });

  it("writes item content to a resolved path", async () => {
    const { writeItemToFilesystem } =
      await import("../../../src/serialization/filesystem-store/items");
    const provider = {
      getPhysicalPathForItemPath: () => "/root/items/home.yml",
    };
    const item = {
      id: "item-5",
      parentId: "parent-1",
      templateId: "template-1",
      path: ItemPath.fromPathString("/sitecore/content/home"),
      dataSignature: "sig",
      name: "home",
      database: "master",
      branchId: null,
      sharedFields: [],
      unversionedFields: [],
      versions: [],
    } satisfies ItemData;
    yamlMocks.writeItemYaml.mockReturnValue("yaml");

    const target = await writeItemToFilesystem(provider as never, item);

    expect(target).toBe("/root/items/home.yml");
    expect(fsMocks.mkdir).toHaveBeenCalledWith(path.dirname(target), { recursive: true });
    expect(fsMocks.writeFile).toHaveBeenCalledWith(target, "yaml", "utf8");
  });

  it("skips removal when path is unavailable", async () => {
    const { removeItemFromFilesystem } =
      await import("../../../src/serialization/filesystem-store/items");
    const provider = {
      getPhysicalPathForItemPath: () => null,
    };

    await removeItemFromFilesystem(provider as never, {
      id: "item-6",
      parentId: "parent-1",
      templateId: "template-1",
      path: ItemPath.fromPathString("/sitecore/content/home"),
      dataSignature: "sig",
      database: "master",
    });

    expect(fsMocks.rm).not.toHaveBeenCalled();
  });
});
