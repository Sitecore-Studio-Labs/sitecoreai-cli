import { describe, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";
import {
  FilesystemTreeSpec,
  FilesystemTreeSpecRule,
  TreeScope,
} from "../../../src/serialization/tree-spec";
import { ItemPath } from "../../../src/serialization/item-path";
import { FilesystemPathProvider } from "../../../src/serialization/path-provider";

const makeSpec = (root: string, scope: TreeScope, maxRelativePathLength?: number) => {
  const spec = new FilesystemTreeSpec();
  spec.name = "content";
  spec.database = "master";
  spec.physicalPath = root;
  spec.path = ItemPath.fromPathString("/sitecore/content");
  spec.scope = scope;
  if (maxRelativePathLength !== undefined) {
    spec.maxRelativePathLength = maxRelativePathLength;
  }
  return spec;
};

describe("filesystem path provider", () => {
  it("throws when extension is missing dot", () => {
    const root = path.join(os.tmpdir(), "scai-paths");
    const provider = new FilesystemPathProvider([makeSpec(root, TreeScope.ItemAndDescendants)]);
    expect(() =>
      provider.getPhysicalPathForItemPath(ItemPath.fromPathString("/sitecore/content/home"), "yml")
    ).toThrow("Extension must start");
  });

  it("normalizes invalid filenames", () => {
    const root = path.join(os.tmpdir(), "scai-paths");
    const provider = new FilesystemPathProvider([
      makeSpec(root, TreeScope.ItemAndDescendants, 120),
    ]);
    const itemPath = ItemPath.fromPathString("/sitecore/content/CON");
    const physical = provider.getPhysicalPathForItemPath(itemPath, ".yml");
    expect(physical).toContain("#CON");
  });

  it("hashes long paths when needed", () => {
    const root = path.join(os.tmpdir(), "scai-paths");
    const provider = new FilesystemPathProvider([makeSpec(root, TreeScope.ItemAndDescendants, 16)]);
    const itemPath = ItemPath.fromPathString("/sitecore/content/very/long/path/segment/name");
    const paths = provider.getChildrenPathsForItemPath(itemPath);
    expect(paths).not.toBeNull();
    expect(paths?.some((entry) => /[a-f0-9]{16}/.test(entry))).toBe(true);
  });

  it("rejects paths when maxRelativePathLength is too small", () => {
    const root = path.join(os.tmpdir(), "scai-paths");
    const provider = new FilesystemPathProvider([makeSpec(root, TreeScope.ItemAndDescendants, 10)]);
    const itemPath = ItemPath.fromPathString("/sitecore/content/one/two/three/four");
    expect(() => provider.getPhysicalPathForItemPath(itemPath, ".yml")).toThrow(
      "below minimum value"
    );
  });

  it("throws when multiple subtrees match", () => {
    const rootA = path.join(os.tmpdir(), "scai-paths-a");
    const rootB = path.join(os.tmpdir(), "scai-paths-b");
    const specA = new FilesystemTreeSpec();
    specA.name = "root";
    specA.database = "master";
    specA.physicalPath = rootA;
    specA.path = ItemPath.fromPathString("/sitecore");
    specA.scope = TreeScope.ItemAndDescendants;

    const specB = new FilesystemTreeSpec();
    specB.name = "content";
    specB.database = "master";
    specB.physicalPath = rootB;
    specB.path = ItemPath.fromPathString("/sitecore/content");
    specB.scope = TreeScope.ItemAndDescendants;

    const provider = new FilesystemPathProvider([specA, specB]);
    expect(() =>
      provider.getPhysicalPathForItemPath(ItemPath.fromPathString("/sitecore/content/home"), ".yml")
    ).toThrow("included in multiple places");
  });

  it("returns null when item is outside subtree", () => {
    const root = path.join(os.tmpdir(), "scai-paths");
    const provider = new FilesystemPathProvider([makeSpec(root, TreeScope.ItemAndDescendants)]);
    const physical = provider.getPhysicalPathForItemPath(
      ItemPath.fromPathString("/sitecore/layout"),
      ".yml"
    );
    expect(physical).toBeNull();
  });

  it("applies alias rules when present", () => {
    const root = path.join(os.tmpdir(), "scai-paths-alias");
    const spec = makeSpec(root, TreeScope.ItemAndDescendants);
    const aliasRule = new FilesystemTreeSpecRule();
    aliasRule.path = ItemPath.fromSegments(["alias"]);
    aliasRule.alias = "short";
    spec.rules = [aliasRule];

    const provider = new FilesystemPathProvider([spec]);
    const physical = provider.getPhysicalPathForItemPath(
      ItemPath.fromPathString("/sitecore/content/alias/item"),
      ".yml"
    );
    expect(physical).toContain(path.join(root, "short", "alias", "item.yml"));
  });
});
