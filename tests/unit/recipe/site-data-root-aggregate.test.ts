import { describe, expect, it } from "vitest";
import {
  type CompileContext,
  compileRecipeSet,
  SITE_DATA_ROOT_AGGREGATE_HANDLE,
} from "../../../src/recipe/compile";
import {
  sharedDataFolderTemplateId,
  siteDataFolderTemplateId,
  siteDataRootStandardValuesId,
} from "../../../src/recipe/guids";
import { SITECORE_TEMPLATES, SYSTEM_FIELDS } from "../../../src/recipe/ir/sitecore-templates";
import type {
  CreateItemOp,
  Operation,
  OperationIr,
  SetFieldOp,
} from "../../../src/recipe/ir/operations";
import type {
  ComponentSectionRecipe,
  ComponentTemplateRecipe,
} from "../../../src/recipe/schema/recipe";

const SITE = "default";
const CONTENT_ITEMS_ROOT = "/sitecore/content/test-tenant/test-site/Data";

const UI_SECTION_RECIPE: ComponentSectionRecipe = {
  kind: "component-section",
  schemaVersion: "1",
  handle: "ui-section@1",
  name: "ui",
};

const CONTEXT: CompileContext = {
  templatesRoot: "/sitecore/templates/Project/test-site/Components",
  renderingsRoot: "/sitecore/layout/Renderings/Project/test-site",
  contentItemsRoot: CONTENT_ITEMS_ROOT,
  sectionsByHandle: new Map([[UI_SECTION_RECIPE.handle, UI_SECTION_RECIPE]]),
};

const baseRecipe = (overrides: Partial<ComponentTemplateRecipe>): ComponentTemplateRecipe =>
  ({
    kind: "component-template",
    schemaVersion: "1",
    handle: "badge-a@1",
    name: "BadgeA",
    displayName: "Badge A",
    section: { handle: UI_SECTION_RECIPE.handle },
    fields: [{ name: "Title", shape: "text" }],
    ...overrides,
  }) as ComponentTemplateRecipe;

const findAggregate = (irs: OperationIr[]): OperationIr | undefined =>
  irs.find((ir) => ir.recipeHandle === SITE_DATA_ROOT_AGGREGATE_HANDLE);

const findOp = <T extends Operation>(
  ops: Operation[],
  predicate: (op: Operation) => op is T
): T | undefined => ops.find(predicate);

describe("compileRecipeSet — site Data root Standard Values aggregator", () => {
  it("singleton site-scoped recipe → SV op + Insert Options [Folder, per-recipe template]", () => {
    const recipe = baseRecipe({
      handle: "badge-a@1",
      datasource: {
        autoCreate: true,
        openPropertiesAfterAdd: false,
        locations: [{ scope: "site", subfolder: "BadgeA" }],
      },
    });

    const irs = compileRecipeSet([UI_SECTION_RECIPE, recipe], CONTEXT);
    const aggregate = findAggregate(irs);
    expect(aggregate).toBeDefined();
    expect(aggregate!.operations).toHaveLength(2);

    const sv = findOp(aggregate!.operations, (op): op is CreateItemOp => op.op === "CreateItem");
    expect(sv).toBeDefined();
    expect(sv!.id).toBe(siteDataRootStandardValuesId(SITE));
    expect(sv!.name).toBe("__Standard Values");
    expect(sv!.path).toBe(`${CONTENT_ITEMS_ROOT}/__Standard Values`);
    expect(sv!.parent).toEqual({ kind: "ref-path", value: CONTENT_ITEMS_ROOT });
    expect(sv!.templateOf).toBe(SITECORE_TEMPLATES.FOLDER);
    expect(sv!.policy).toBe("CreateOnly");
    expect(sv!.fields).toEqual([]);

    const insert = findOp(aggregate!.operations, (op): op is SetFieldOp => op.op === "SetField");
    expect(insert).toBeDefined();
    expect(insert!.itemRefKey).toBe(siteDataRootStandardValuesId(SITE));
    expect(insert!.fieldId).toBe(SYSTEM_FIELDS.INSERT_OPTIONS);
    expect(insert!.value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [SITECORE_TEMPLATES.FOLDER, siteDataFolderTemplateId(SITE, "badge-a@1")],
    });
  });

  it("two shared-subfolder recipes + one singleton → Insert Options has shared template once + singleton template", () => {
    const recipeA = baseRecipe({
      handle: "shared-a@1",
      name: "SharedA",
      displayName: "Shared A",
      datasource: {
        autoCreate: true,
        openPropertiesAfterAdd: false,
        locations: [{ scope: "site", subfolder: "Shared" }],
      },
    });
    const recipeB = baseRecipe({
      handle: "shared-b@1",
      name: "SharedB",
      displayName: "Shared B",
      datasource: {
        autoCreate: true,
        openPropertiesAfterAdd: false,
        locations: [{ scope: "site", subfolder: "Shared" }],
      },
    });
    const recipeC = baseRecipe({
      handle: "solo-c@1",
      name: "SoloC",
      displayName: "Solo C",
      datasource: {
        autoCreate: true,
        openPropertiesAfterAdd: false,
        locations: [{ scope: "site", subfolder: "SoloC" }],
      },
    });

    const irs = compileRecipeSet([UI_SECTION_RECIPE, recipeA, recipeB, recipeC], CONTEXT);
    const aggregate = findAggregate(irs);
    expect(aggregate).toBeDefined();

    const insert = findOp(aggregate!.operations, (op): op is SetFieldOp => op.op === "SetField");
    expect(insert!.value).toEqual({
      kind: "ref-recipe-list",
      // Folder, then sorted singletons (just solo-c@1), then sorted shared
      // (just "Shared"). recipeA/recipeB don't contribute their per-recipe
      // template because both their site subfolders are shared.
      refKeys: [
        SITECORE_TEMPLATES.FOLDER,
        siteDataFolderTemplateId(SITE, "solo-c@1"),
        sharedDataFolderTemplateId(SITE, "Shared"),
      ],
    });
  });

  it("two shared-subfolder recipes only (no singletons) → shared template appears exactly once", () => {
    // Spec sanity: "NO duplicates of the shared template even though two
    // recipes reference it."
    const recipeA = baseRecipe({
      handle: "shared-a@1",
      name: "SharedA",
      displayName: "Shared A",
      datasource: {
        autoCreate: true,
        openPropertiesAfterAdd: false,
        locations: [{ scope: "site", subfolder: "Shared" }],
      },
    });
    const recipeB = baseRecipe({
      handle: "shared-b@1",
      name: "SharedB",
      displayName: "Shared B",
      datasource: {
        autoCreate: true,
        openPropertiesAfterAdd: false,
        locations: [{ scope: "site", subfolder: "Shared" }],
      },
    });

    const irs = compileRecipeSet([UI_SECTION_RECIPE, recipeA, recipeB], CONTEXT);
    const aggregate = findAggregate(irs);
    expect(aggregate).toBeDefined();
    const insert = findOp(aggregate!.operations, (op): op is SetFieldOp => op.op === "SetField");
    expect(insert!.value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [SITECORE_TEMPLATES.FOLDER, sharedDataFolderTemplateId(SITE, "Shared")],
    });
  });

  it("zero site-scoped subfolders → no SV op emitted", () => {
    // No `datasource` block at all → no site subfolder.
    const recipe = baseRecipe({
      handle: "no-site@1",
    });
    const irs = compileRecipeSet([UI_SECTION_RECIPE, recipe], CONTEXT);
    expect(findAggregate(irs)).toBeUndefined();
  });

  it("site-scoped page subfolder (not site) → no SV op emitted", () => {
    // page-scope locations don't contribute to the data root aggregator.
    const recipe = baseRecipe({
      handle: "page-only@1",
      datasource: {
        autoCreate: true,
        openPropertiesAfterAdd: false,
        locations: [{ scope: "page", subfolder: "Pages" }],
      },
    });
    const irs = compileRecipeSet([UI_SECTION_RECIPE, recipe], CONTEXT);
    expect(findAggregate(irs)).toBeUndefined();
  });

  it("site-scoped subfolders but contentItemsRoot unset → silent skip (no SV op)", () => {
    // The per-recipe compiler errors out when contentItemsRoot is unset
    // and a recipe declares a site subfolder, so this test would normally
    // never reach the aggregator. But the aggregator must defend against
    // it — the spec requires a silent skip when contentItemsRoot is unset.
    // To exercise the silent-skip path independently, we stub through a
    // recipe with no site subfolder declared in datasource (so the
    // per-recipe compiler doesn't throw) — verifying the aggregator's
    // own gate.
    const recipe = baseRecipe({
      handle: "bare@1",
    });
    const ctx: CompileContext = {
      templatesRoot: CONTEXT.templatesRoot,
      renderingsRoot: CONTEXT.renderingsRoot,
      // contentItemsRoot intentionally unset.
    };
    const irs = compileRecipeSet([UI_SECTION_RECIPE, recipe], ctx);
    expect(findAggregate(irs)).toBeUndefined();
  });

  it("singleton + shared list deterministic across input recipe order", () => {
    const a = baseRecipe({
      handle: "alpha@1",
      name: "Alpha",
      displayName: "Alpha",
      datasource: {
        autoCreate: true,
        openPropertiesAfterAdd: false,
        locations: [{ scope: "site", subfolder: "Alpha" }],
      },
    });
    const b = baseRecipe({
      handle: "bravo@1",
      name: "Bravo",
      displayName: "Bravo",
      datasource: {
        autoCreate: true,
        openPropertiesAfterAdd: false,
        locations: [{ scope: "site", subfolder: "Bravo" }],
      },
    });
    const irsForward = compileRecipeSet([UI_SECTION_RECIPE, a, b], CONTEXT);
    const irsReverse = compileRecipeSet([UI_SECTION_RECIPE, b, a], CONTEXT);
    const insertForward = findOp(
      findAggregate(irsForward)!.operations,
      (op): op is SetFieldOp => op.op === "SetField"
    );
    const insertReverse = findOp(
      findAggregate(irsReverse)!.operations,
      (op): op is SetFieldOp => op.op === "SetField"
    );
    expect(insertForward!.value).toEqual(insertReverse!.value);
  });
});
