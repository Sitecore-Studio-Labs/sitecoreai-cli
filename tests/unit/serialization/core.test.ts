import { describe, expect, it } from "vitest";
import { isWildcard, isWildcardMatch } from "../../../src/serialization/wildcard";
import { ItemPath, ItemPathMatch } from "../../../src/serialization/item-path";
import { createDataSignatureBase, createSignature } from "../../../src/serialization/signature";
import { compareItems } from "../../../src/serialization/compare";
import { createFieldFilterSet, filterFieldIds } from "../../../src/serialization/field-filter";
import { ItemData } from "../../../src/serialization/types";

const createItem = (overrides: Partial<ItemData> = {}): ItemData => ({
  id: "item-1",
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
  ...overrides,
});

describe("serialization core utilities", () => {
  it("matches wildcards", () => {
    expect(isWildcard("foo*")).toBe(true);
    expect(isWildcardMatch("sitecore", "site*")).toBe(true);
    expect(isWildcardMatch("sitecore", "site?ore")).toBe(true);
    expect(isWildcardMatch("Sitecore", "sitecore")).toBe(true);
    expect(isWildcardMatch("Sitecore", "sitecore", true)).toBe(false);
  });

  it("handles wildcard edge cases", () => {
    expect(() => isWildcard(null as unknown as string)).toThrow(
      "Wildcard candidate is null or undefined."
    );
    expect(() => isWildcardMatch(null as unknown as string, "site*")).toThrow(
      "Input is null or undefined."
    );
    expect(isWildcardMatch("Sitecore", "S*re", true)).toBe(true);
    expect(isWildcardMatch("sitecore", "sitecore", true)).toBe(true);
  });

  it("handles ItemPath operations", () => {
    const path = ItemPath.fromPathString("/sitecore/content/home");
    expect(path.count).toBe(3);
    expect(path.itemName).toBe("home");
    expect(path.toPathString()).toBe("/sitecore/content/home");
    const parent = path.createParentPath();
    expect(parent?.toPathString()).toBe("/sitecore/content");
    const relative = path.createRelativePathFrom(ItemPath.fromPathString("/sitecore"));
    expect(relative?.toPathString()).toBe("/content/home");
    expect(path.isDescendantOrSelfOf(ItemPath.fromPathString("/sitecore"))).toBe(true);
  });

  it("covers ItemPath error and mismatch branches", () => {
    expect(() => ItemPath.fromPathString("sitecore")).toThrow("did not start with /");
    const root = ItemPath.fromSegments([]);
    expect(root.createParentPath()).toBeNull();
    expect(() => ItemPath.fromPathString("/sitecore").prepend("bad/segment")).toThrow(
      "Cannot prepend multiple segments."
    );
    expect(() => ItemPath.fromPathString("/sitecore").concatenate("bad/segment")).toThrow(
      "Cannot concatenate multiple segments using string."
    );
    const shorter = ItemPath.fromPathString("/sitecore");
    const longer = ItemPath.fromPathString("/sitecore/content/home");
    expect(shorter.createRelativePathFrom(longer)).toBeNull();
    const mismatch = ItemPath.fromPathString("/sitecore/content");
    expect(mismatch.createRelativePathFrom(ItemPath.fromPathString("/sitecore/media"))).toBeNull();
    const match = ItemPathMatch.fromPathMatch("/sitecore/*");
    expect(ItemPath.fromPathString("/sitecore/content").isDescendantOrSelfOf(match)).toBe(true);
  });

  it("creates signatures", () => {
    const item = createItem({
      sharedFields: [{ fieldId: "f1", value: "value" }],
    });
    const base = createDataSignatureBase(item);
    const sig = createSignature(base);
    expect(base).toContain("template-1");
    expect(sig).toBeTruthy();
  });

  it("creates signatures with blob and excluded fields", () => {
    const item = createItem({
      sharedFields: [
        { fieldId: "B1E16562-F3F9-4DDD-84CA-6E099950ECC0", value: "skip" },
        { fieldId: "f2", value: "blob", blobId: "blob-1" },
      ],
    });
    const base = createDataSignatureBase(item, true);
    expect(base).toContain("blob-1");
    expect(base).toContain("blob");
    expect(base).not.toContain("skip");
    expect(createSignature(null)).toBeNull();
  });

  it("compares items", () => {
    const left = createItem({
      name: "home",
      sharedFields: [{ fieldId: "f1", value: "one" }],
    });
    const right = createItem({
      name: "home-renamed",
      sharedFields: [{ fieldId: "f1", value: "two" }],
    });
    const result = compareItems(left, right);
    expect(result.isRenamed).toBe(true);
    expect(result.changedSharedFields.length).toBeGreaterThan(0);
  });

  it("captures field and version differences", () => {
    const left = createItem({
      sharedFields: [
        { fieldId: "a", value: "one", blobId: "blob-a" },
        { fieldId: "c", value: "left-only" },
      ],
      unversionedFields: [{ language: "en", fields: [{ fieldId: "u1", value: "left" }] }],
      versions: [{ language: "en", version: 1, fields: [{ fieldId: "v1", value: "left" }] }],
    });
    const right = createItem({
      sharedFields: [
        { fieldId: "a", value: "one", blobId: "blob-b" },
        { fieldId: "b", value: "right-only" },
      ],
      unversionedFields: [{ language: "fr", fields: [{ fieldId: "u2", value: "right" }] }],
      versions: [{ language: "en", version: 2, fields: [{ fieldId: "v2", value: "right" }] }],
    });
    const result = compareItems(left, right);
    expect(result.changedSharedFields.length).toBeGreaterThan(0);
    expect(result.changedUnversionedFields.length).toBeGreaterThan(0);
    expect(result.changedVersions.length).toBeGreaterThan(0);
  });

  it("builds field filter sets", () => {
    const filter = createFieldFilterSet([{ fieldId: "ABC" }], [{ fieldId: "DEF" }]);
    const ids = filterFieldIds(filter);
    expect(ids).toContain("abc");
    expect(ids).toContain("def");
  });

  it("ignores empty field filter ids", () => {
    const filter = createFieldFilterSet([{ fieldId: "" }], [{ fieldId: "ABC" }]);
    expect(filterFieldIds(filter)).toEqual(["abc"]);
  });
});
