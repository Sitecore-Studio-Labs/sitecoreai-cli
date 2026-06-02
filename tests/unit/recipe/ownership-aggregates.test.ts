import { describe, expect, it } from "vitest";
import {
  COMPONENT_SECTION_OWNERSHIP_AGGREGATE_HANDLE,
  type CompileContext,
  compileRecipeSet,
} from "../../../src/recipe/compile";
import type { Recipe } from "../../../src/recipe/schema/recipe";
import {
  renderingId,
  renderingsSectionFolderId,
  sectionFolderId,
  templateId,
} from "../../../src/recipe/items/guids";
import { SITECORE_TEMPLATES } from "../../../src/recipe/ir/sitecore-templates";
import type { OperationIr, PruneChildrenOp } from "../../../src/recipe/ir/operations";

const SITE = "default";
const CONTEXT: CompileContext = {
  templatesRoot: "/sitecore/templates/Project/test-site/Components",
  renderingsRoot: "/sitecore/layout/Renderings/Project/test-site",
  componentsRoot: "/sitecore/templates/Project/test-site/Components",
};

const componentRecipe = (handle: string, name: string, sectionHandle: string): Recipe => ({
  kind: "component-template",
  schemaVersion: "1",
  handle,
  name,
  displayName: name,
  fields: [],
  variants: [],
  section: { handle: sectionHandle },
});

const componentSectionRecipe = (ownership?: {
  mode: "additive" | "exclusive";
  pruneMode?: "warn" | "delete";
}): Recipe => ({
  kind: "component-section",
  schemaVersion: "1",
  handle: "ui-section@1",
  name: "UI",
  displayName: "UI",
  ...(ownership ? { ownership } : {}),
});

const findAggregate = (irs: OperationIr[], handle: string): OperationIr | undefined =>
  irs.find((ir) => ir.recipeHandle === handle);

describe("ComponentSectionRecipe.ownership — exclusive", () => {
  it("emits two PruneChildren ops (renderings folder + templates section folder)", () => {
    const irs = compileRecipeSet(
      [
        componentSectionRecipe({ mode: "exclusive" }),
        componentRecipe("alpha@1", "Alpha", "ui-section@1"),
        componentRecipe("beta@1", "Beta", "ui-section@1"),
      ],
      CONTEXT
    );
    const aggregate = findAggregate(irs, COMPONENT_SECTION_OWNERSHIP_AGGREGATE_HANDLE);
    expect(aggregate).toBeDefined();
    expect(aggregate!.operations).toHaveLength(2);

    const renderingsPrune = aggregate!.operations.find((op) =>
      op.label.startsWith("prune:renderings-section:")
    ) as PruneChildrenOp;
    expect(renderingsPrune).toBeDefined();
    expect(renderingsPrune.op).toBe("PruneChildren");
    expect(renderingsPrune.parentRefKey).toBe(renderingsSectionFolderId(SITE, "UI"));
    expect(renderingsPrune.templateFilter).toEqual([SITECORE_TEMPLATES.RENDERING]);
    expect(renderingsPrune.mode).toBe("warn");
    const renderingRefKeys = renderingsPrune.allowedHandles
      .map((h) => (h.kind === "ref-recipe" ? h.refKey : h.value))
      .sort();
    expect(renderingRefKeys).toEqual(
      [renderingId(SITE, "alpha@1"), renderingId(SITE, "beta@1")].sort()
    );

    const templatesPrune = aggregate!.operations.find((op) =>
      op.label.startsWith("prune:templates-section:")
    ) as PruneChildrenOp;
    expect(templatesPrune).toBeDefined();
    expect(templatesPrune.parentRefKey).toBe(sectionFolderId(SITE, "UI"));
    expect(templatesPrune.templateFilter).toEqual([SITECORE_TEMPLATES.TEMPLATE]);
    expect(templatesPrune.mode).toBe("warn");
    const templateRefKeys = templatesPrune.allowedHandles
      .map((h) => (h.kind === "ref-recipe" ? h.refKey : h.value))
      .sort();
    expect(templateRefKeys).toEqual(
      [templateId(SITE, "alpha@1"), templateId(SITE, "beta@1")].sort()
    );
  });

  it("respects ownership.pruneMode = delete on both prune ops", () => {
    const irs = compileRecipeSet(
      [
        componentSectionRecipe({ mode: "exclusive", pruneMode: "delete" }),
        componentRecipe("alpha@1", "Alpha", "ui-section@1"),
      ],
      CONTEXT
    );
    const aggregate = findAggregate(irs, COMPONENT_SECTION_OWNERSHIP_AGGREGATE_HANDLE);
    expect(aggregate!.operations).toHaveLength(2);
    for (const op of aggregate!.operations) {
      expect((op as PruneChildrenOp).mode).toBe("delete");
    }
  });

  it("emits NO PruneChildren aggregate when ownership is unset", () => {
    const irs = compileRecipeSet(
      [componentSectionRecipe(), componentRecipe("alpha@1", "Alpha", "ui-section@1")],
      CONTEXT
    );
    expect(findAggregate(irs, COMPONENT_SECTION_OWNERSHIP_AGGREGATE_HANDLE)).toBeUndefined();
  });

  it("emits both ops with empty allowedHandles when the exclusive section has no components", () => {
    const irs = compileRecipeSet([componentSectionRecipe({ mode: "exclusive" })], CONTEXT);
    const aggregate = findAggregate(irs, COMPONENT_SECTION_OWNERSHIP_AGGREGATE_HANDLE);
    expect(aggregate).toBeDefined();
    expect(aggregate!.operations).toHaveLength(2);
    for (const op of aggregate!.operations) {
      expect((op as PruneChildrenOp).allowedHandles).toEqual([]);
    }
  });

  it("cross-recipe: a component from recipe B targets a section recipe A owns exclusively (audit gap #11)", () => {
    // Two notional "recipe set" entries that, in a real workspace, would
    // come from separate .recipe.ts files. The compiler treats them as
    // one set when compiled together — the section's allowedHandles
    // must collect refKeys from BOTH the owning recipe's contributors
    // AND any sibling recipe's contributors targeting the same section.
    const irs = compileRecipeSet(
      [
        // Recipe A: declares the section + owns it.
        componentSectionRecipe({ mode: "exclusive" }),
        componentRecipe("alpha@1", "Alpha", "ui-section@1"),
        // Recipe B (different source file): contributes ANOTHER component
        // to the same section.
        componentRecipe("beta@1", "Beta", "ui-section@1"),
        // Recipe C: contributes to a DIFFERENT section — not in
        // allowedHandles for the owned one.
        {
          kind: "component-section",
          schemaVersion: "1",
          handle: "other-section@1",
          name: "Other",
          displayName: "Other",
        } as Recipe,
        componentRecipe("gamma@1", "Gamma", "other-section@1"),
      ],
      CONTEXT
    );
    const aggregate = findAggregate(irs, COMPONENT_SECTION_OWNERSHIP_AGGREGATE_HANDLE);
    const renderingsPrune = aggregate!.operations.find((op) =>
      op.label.includes("renderings-section:default:UI")
    ) as PruneChildrenOp;
    expect(renderingsPrune).toBeDefined();
    const refKeys = renderingsPrune.allowedHandles
      .map((h) => (h.kind === "ref-recipe" ? h.refKey : h.value))
      .sort();
    // alpha + beta land in UI's allowedHandles; gamma does NOT (it's in
    // the unowned Other section).
    expect(refKeys).toEqual([renderingId(SITE, "alpha@1"), renderingId(SITE, "beta@1")].sort());
    expect(refKeys).not.toContain(renderingId(SITE, "gamma@1"));
  });

  it("templateFilter on the templates-section prune leaves bucket folders untouched", () => {
    // This is a structural assertion — the bucket folders ("Component
    // Folders" / "Presentation Parameters") use TEMPLATE_FOLDER, not
    // TEMPLATE, so the templateFilter excludes them. Without this filter
    // the prune would wipe the buckets and orphan every per-component
    // datasource / params template that lives inside.
    const irs = compileRecipeSet(
      [
        componentSectionRecipe({ mode: "exclusive" }),
        componentRecipe("alpha@1", "Alpha", "ui-section@1"),
      ],
      CONTEXT
    );
    const aggregate = findAggregate(irs, COMPONENT_SECTION_OWNERSHIP_AGGREGATE_HANDLE);
    const templatesPrune = aggregate!.operations.find((op) =>
      op.label.startsWith("prune:templates-section:")
    ) as PruneChildrenOp;
    // Asserting the actual template-filter GUID — Template, not
    // TEMPLATE_FOLDER. If anyone widens the filter (or drops it), this
    // catches the regression at the IR level before any apply runs.
    expect(templatesPrune.templateFilter).toEqual([SITECORE_TEMPLATES.TEMPLATE]);
    expect(templatesPrune.templateFilter).not.toContain(SITECORE_TEMPLATES.TEMPLATE_FOLDER);
  });
});
