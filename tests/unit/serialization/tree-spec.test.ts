import { describe, expect, it } from "vitest";
import {
  FilesystemTreeSpec,
  FilesystemTreeSpecRule,
  TreeScope,
  TreeRuleScope,
  AllowedPushOperations,
} from "../../../src/serialization/tree-spec";
import { ItemPath, ItemPathMatch } from "../../../src/serialization/item-path";

describe("tree spec", () => {
  it("validates and matches paths", () => {
    const spec = new FilesystemTreeSpec();
    spec.name = "content";
    spec.database = "master";
    spec.physicalPath = "/tmp";
    spec.path = ItemPath.fromPathString("/sitecore/content");
    spec.scope = TreeScope.ItemAndDescendants;

    spec.validate();

    const match = spec.includesPath(ItemPath.fromPathString("/sitecore/content/home"));
    expect(match).toBe(true);
    const miss = spec.includesPath(ItemPath.fromPathString("/sitecore/layout"));
    expect(miss).toBe(false);
  });

  it("validates rules and aliases", () => {
    const spec = new FilesystemTreeSpec();
    spec.name = "content";
    spec.database = "master";
    spec.physicalPath = "/tmp";
    spec.path = ItemPath.fromPathString("/sitecore/content");

    const rule = new FilesystemTreeSpecRule();
    rule.path = ItemPath.fromSegments(["sitecore", "content", "home"]);
    rule.scope = TreeRuleScope.SingleItem;
    spec.rules = [rule];
    expect(() => spec.validate()).toThrow();

    const wildcardRule = new FilesystemTreeSpecRule();
    wildcardRule.path = ItemPathMatch.fromPathMatch("/sitecore/content/*");
    wildcardRule.scope = TreeRuleScope.ItemAndDescendants;
    spec.rules = [wildcardRule];
    expect(() => spec.validate()).not.toThrow();
  });

  it("honors scopes and rule inclusions", () => {
    const spec = new FilesystemTreeSpec();
    spec.name = "content";
    spec.database = "master";
    spec.physicalPath = "/tmp";
    spec.path = ItemPath.fromPathString("/sitecore/content");
    spec.scope = TreeScope.SingleItem;
    expect(spec.includesPath(ItemPath.fromPathString("/sitecore/content/home"))).toBe(false);

    spec.scope = TreeScope.ItemAndChildren;
    expect(spec.includesPath(ItemPath.fromPathString("/sitecore/content/home/child"))).toBe(false);

    spec.scope = TreeScope.DescendantsOnly;
    expect(spec.includesPath(ItemPath.fromPathString("/sitecore/content"))).toBe(false);

    spec.scope = TreeScope.ItemAndDescendants;
    const ignore = new FilesystemTreeSpecRule();
    ignore.path = ItemPath.fromSegments(["hidden"]);
    ignore.scope = TreeRuleScope.Ignored;
    const include = new FilesystemTreeSpecRule();
    include.path = ItemPath.fromSegments(["visible"]);
    include.scope = TreeRuleScope.ItemAndDescendants;
    include.allowedPushOperations = AllowedPushOperations.CreateOnly;
    spec.rules = [ignore, include];
    expect(spec.includesPath(ItemPath.fromPathString("/sitecore/content/hidden"))).toBe(false);
    expect(spec.includesPath(ItemPath.fromPathString("/sitecore/content/visible/child"))).toBe(
      true
    );
    expect(
      spec.getAllowedPushOperationsForItem(
        ItemPath.fromPathString("/sitecore/content/visible/child")
      )
    ).toBe(AllowedPushOperations.CreateOnly);
  });

  it("rejects invalid rule configurations", () => {
    const spec = new FilesystemTreeSpec();
    spec.name = "content";
    spec.database = "master";
    spec.physicalPath = "/tmp";
    spec.path = ItemPath.fromPathString("/sitecore/content");
    spec.scope = TreeScope.ItemAndChildren;

    const missingScope = new FilesystemTreeSpecRule();
    missingScope.path = ItemPath.fromSegments(["child"]);
    spec.rules = [missingScope];
    expect(() => spec.validate()).toThrow();

    const wildcard = new FilesystemTreeSpecRule();
    wildcard.path = ItemPathMatch.fromPathMatch("/sitecore/content/*");
    wildcard.scope = TreeRuleScope.SingleItem;
    spec.rules = [wildcard];
    expect(() => spec.validate()).toThrow();

    const alias = new FilesystemTreeSpecRule();
    alias.path = ItemPath.fromSegments(["child"]);
    alias.alias = "bad*alias";
    spec.rules = [alias];
    expect(() => spec.validate()).toThrow();
  });

  it("requires a non-empty path and rule path", () => {
    const spec = new FilesystemTreeSpec();
    spec.name = "content";
    spec.database = "master";
    spec.physicalPath = "/tmp";
    spec.path = ItemPath.fromSegments([]);
    expect(() => spec.validate()).toThrow("TreeSpec path is null or empty");

    spec.path = ItemPath.fromPathString("/sitecore/content");
    const emptyRule = new FilesystemTreeSpecRule();
    spec.rules = [emptyRule];
    expect(() => spec.validate()).toThrow("TreeSpec rule path is null or empty");
  });

  it("enforces alias rule restrictions", () => {
    const spec = new FilesystemTreeSpec();
    spec.name = "content";
    spec.database = "master";
    spec.physicalPath = "/tmp";
    spec.path = ItemPath.fromPathString("/sitecore/content");

    const aliasScope = new FilesystemTreeSpecRule();
    aliasScope.path = ItemPath.fromSegments(["alias"]);
    aliasScope.alias = "short";
    aliasScope.scope = TreeRuleScope.SingleItem;
    spec.rules = [aliasScope];
    expect(() => spec.validate()).toThrow("alias and scope");

    const aliasWildcard = new FilesystemTreeSpecRule();
    aliasWildcard.path = ItemPathMatch.fromPathMatch("/alias/*");
    aliasWildcard.alias = "short";
    spec.rules = [aliasWildcard];
    expect(() => spec.validate()).toThrow("match rule");
  });

  it("handles rule scopes for single item and children", () => {
    const spec = new FilesystemTreeSpec();
    spec.name = "content";
    spec.database = "master";
    spec.physicalPath = "/tmp";
    spec.path = ItemPath.fromPathString("/sitecore/content");
    spec.scope = TreeScope.ItemAndDescendants;

    const single = new FilesystemTreeSpecRule();
    single.path = ItemPath.fromSegments(["alias"]);
    single.scope = TreeRuleScope.SingleItem;
    spec.rules = [single];
    expect(spec.includesPath(ItemPath.fromPathString("/sitecore/content/alias"))).toBe(true);
    expect(spec.includesPath(ItemPath.fromPathString("/sitecore/content/alias/child"))).toBe(false);

    const children = new FilesystemTreeSpecRule();
    children.path = ItemPath.fromSegments(["child"]);
    children.scope = TreeRuleScope.ItemAndChildren;
    spec.rules = [children];
    expect(
      spec.includesPath(ItemPath.fromPathString("/sitecore/content/child/grandchild/great"))
    ).toBe(false);
  });

  it("defaults to create-only when item is outside subtree", () => {
    const spec = new FilesystemTreeSpec();
    spec.name = "content";
    spec.database = "master";
    spec.physicalPath = "/tmp";
    spec.path = ItemPath.fromPathString("/sitecore/content");
    spec.scope = TreeScope.ItemAndDescendants;

    expect(spec.getAllowedPushOperationsForItem(ItemPath.fromPathString("/sitecore/layout"))).toBe(
      AllowedPushOperations.CreateOnly
    );
  });
});
