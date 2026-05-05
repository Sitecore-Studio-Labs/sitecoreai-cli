import { describe, expect, it } from "vitest";
import {
  type CompileContext,
  compileEnumerationRecipe,
  compileRecipeSet,
  ENUMERATIONS_ROOT_AGGREGATE_HANDLE,
} from "../../../src/recipe/compile";
import {
  enumerationFolderId,
  enumerationsFolderTemplateId,
  enumerationsFolderTemplateStandardValuesId,
  enumerationsGroupingFolderId,
  enumerationsRootStandardValuesId,
  enumerationTemplateId,
} from "../../../src/recipe/guids";
import {
  SITECORE_TEMPLATES,
  SYSTEM_FIELDS,
} from "../../../src/recipe/ir/sitecore-templates";
import type {
  CreateItemOp,
  Operation,
  OperationIr,
  SetFieldOp,
} from "../../../src/recipe/ir/operations";
import type { EnumerationRecipe } from "../../../src/recipe/schema/recipe";

const SITE = "default";
const ENUMERATIONS_ROOT = "/sitecore/content/test-tenant/test-site/Settings/Enumerations";
const TEMPLATES_ROOT = "/sitecore/templates/Project/test-site/Components";
const SITE_TEMPLATES_ROOT = "/sitecore/templates/Project/test-site";

const CONTEXT: CompileContext = {
  templatesRoot: TEMPLATES_ROOT,
  renderingsRoot: "/sitecore/layout/Renderings/Project/test-site",
  enumerationsRoot: ENUMERATIONS_ROOT,
};

const baseEnum = (overrides: Partial<EnumerationRecipe>): EnumerationRecipe =>
  ({
    kind: "enumeration",
    schemaVersion: "1",
    handle: "color-scheme@1",
    name: "ColorScheme",
    displayName: "Color Scheme",
    values: [{ name: "primary" }, { name: "neutral" }],
    ...overrides,
  }) as EnumerationRecipe;

const findAggregate = (irs: OperationIr[]): OperationIr | undefined =>
  irs.find((ir) => ir.recipeHandle === ENUMERATIONS_ROOT_AGGREGATE_HANDLE);

const findOp = <T extends Operation>(
  ops: Operation[],
  predicate: (op: Operation) => op is T
): T | undefined => ops.find(predicate);

const findCreateItem = (
  ops: Operation[],
  predicate: (op: CreateItemOp) => boolean
): CreateItemOp | undefined =>
  ops.find((op): op is CreateItemOp => op.op === "CreateItem" && predicate(op));

describe("compileRecipeSet — enumerations root Standard Values aggregator", () => {
  it("single enum → SV op + Insert Options [Folder, that enum's folder]", () => {
    const recipe = baseEnum({});
    const irs = compileRecipeSet([recipe], CONTEXT);
    const aggregate = findAggregate(irs);
    expect(aggregate).toBeDefined();
    expect(aggregate!.operations).toHaveLength(2);

    const sv = findOp(
      aggregate!.operations,
      (op): op is CreateItemOp => op.op === "CreateItem"
    );
    expect(sv!.id).toBe(enumerationsRootStandardValuesId(SITE));
    expect(sv!.path).toBe(`${ENUMERATIONS_ROOT}/__Standard Values`);
    expect(sv!.parent).toEqual({ kind: "ref-path", value: ENUMERATIONS_ROOT });
    expect(sv!.templateOf).toBe(SITECORE_TEMPLATES.FOLDER);
    expect(sv!.policy).toBe("CreateOnly");
    expect(sv!.fields).toEqual([]);

    const insert = findOp(
      aggregate!.operations,
      (op): op is SetFieldOp => op.op === "SetField"
    );
    expect(insert!.itemRefKey).toBe(enumerationsRootStandardValuesId(SITE));
    expect(insert!.fieldId).toBe(SYSTEM_FIELDS.INSERT_OPTIONS);
    expect(insert!.value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [SITECORE_TEMPLATES.FOLDER, enumerationFolderId(SITE, "color-scheme@1")],
    });
  });

  it("multiple enums → Insert Options sorted alphabetically by handle", () => {
    const a = baseEnum({ handle: "tone@1", name: "Tone" });
    const b = baseEnum({ handle: "color-scheme@1", name: "ColorScheme" });
    const c = baseEnum({ handle: "size-scale@1", name: "SizeScale" });
    // Pass in a deliberately scrambled order; aggregate output should be
    // alphabetic by handle regardless.
    const irs = compileRecipeSet([a, b, c], CONTEXT);
    const insert = findOp(
      findAggregate(irs)!.operations,
      (op): op is SetFieldOp => op.op === "SetField"
    );
    expect(insert!.value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [
        SITECORE_TEMPLATES.FOLDER,
        enumerationFolderId(SITE, "color-scheme@1"),
        enumerationFolderId(SITE, "size-scale@1"),
        enumerationFolderId(SITE, "tone@1"),
      ],
    });
  });

  it("zero enum recipes → no SV op emitted", () => {
    const irs = compileRecipeSet([], CONTEXT);
    expect(findAggregate(irs)).toBeUndefined();
  });

  it("enumerationsRoot unset → silent skip (no SV op)", () => {
    // Construct a context without an enumerationsRoot so the aggregator
    // must early-return. A recipe set with NO enumeration recipes can't
    // exercise the gate either, so we use an empty recipe list.
    const ctx: CompileContext = {
      templatesRoot: TEMPLATES_ROOT,
      renderingsRoot: CONTEXT.renderingsRoot,
      // enumerationsRoot intentionally unset.
    };
    const irs = compileRecipeSet([], ctx);
    expect(findAggregate(irs)).toBeUndefined();
  });
});

describe("compileEnumerationRecipe — Standard Values lives on the template, not the data folder", () => {
  it("does NOT emit a __Standard Values ITEM under the enum data folder", () => {
    const recipe = baseEnum({});
    const ir = compileEnumerationRecipe(recipe, CONTEXT);

    const folderRefKey = enumerationFolderId(SITE, "color-scheme@1");
    const svUnderDataFolder = ir.operations.find(
      (op) =>
        op.op === "CreateItem" &&
        op.name === "__Standard Values" &&
        op.parent.kind === "ref-recipe" &&
        op.parent.refKey === folderRefKey
    );
    // Per-data-folder SVs are gone — they showed up as siblings of the
    // enum value items in Droplink picker enumeration. SV now lives on
    // the template definition (asserted in the next case).
    expect(svUnderDataFolder).toBeUndefined();
  });

  it("emits one template-level __Standard Values under Enumerations Folder, linked + Insert Options=[Enumerations Folder, Enumeration]", () => {
    const recipe = baseEnum({});
    const ir = compileEnumerationRecipe(recipe, CONTEXT);

    const folderTemplateRefKey = enumerationsFolderTemplateId(SITE);
    const valueTemplateRefKey = enumerationTemplateId(SITE);
    const svRefKey = enumerationsFolderTemplateStandardValuesId(SITE);

    const sv = findCreateItem(ir.operations, (o) => o.id === svRefKey);
    expect(sv).toBeDefined();
    expect(sv!.name).toBe("__Standard Values");
    expect(sv!.path).toBe(
      `${SITE_TEMPLATES_ROOT}/Presentation/Enumerations Folder/__Standard Values`
    );
    expect(sv!.parent).toEqual({ kind: "ref-recipe", refKey: folderTemplateRefKey });

    const link = findOp(
      ir.operations,
      (op): op is Operation & { op: "SetStandardValues" } =>
        op.op === "SetStandardValues" && op.standardValuesRefKey === svRefKey
    );
    expect(link).toBeDefined();
    expect(link!.templateRefKey).toBe(folderTemplateRefKey);

    const insert = findOp(
      ir.operations,
      (op): op is SetFieldOp => op.op === "SetField" && op.itemRefKey === svRefKey
    );
    expect(insert).toBeDefined();
    expect(insert!.fieldId).toBe(SYSTEM_FIELDS.INSERT_OPTIONS);
    expect(insert!.value).toEqual({
      kind: "ref-guid-list",
      values: [folderTemplateRefKey, valueTemplateRefKey],
    });
  });
});

describe("compileEnumerationRecipe — multi-segment location.folder", () => {
  it("single-segment folder lands at <enumerationsRoot>/<folder>/<EnumName>", () => {
    const recipe = baseEnum({ location: { scope: "site", folder: "Theme" } });
    const ir = compileEnumerationRecipe(recipe, CONTEXT);

    const groupingRefKey = enumerationsGroupingFolderId(SITE, "Theme");
    const grouping = findCreateItem(ir.operations, (o) => o.id === groupingRefKey);
    expect(grouping!.path).toBe(`${ENUMERATIONS_ROOT}/Theme`);
    expect(grouping!.parent).toEqual({ kind: "ref-path", value: ENUMERATIONS_ROOT });
    expect(grouping!.name).toBe("Theme");

    const folder = findCreateItem(
      ir.operations,
      (o) => o.id === enumerationFolderId(SITE, "color-scheme@1")
    );
    expect(folder!.path).toBe(`${ENUMERATIONS_ROOT}/Theme/ColorScheme`);
    expect(folder!.parent).toEqual({ kind: "ref-recipe", refKey: groupingRefKey });
  });

  it("multi-segment folder splits on `/` — only leaf segment gets explicit CreateItem", () => {
    const recipe = baseEnum({ location: { scope: "site", folder: "Theme/Color" } });
    const ir = compileEnumerationRecipe(recipe, CONTEXT);

    const groupingRefKey = enumerationsGroupingFolderId(SITE, "Theme/Color");
    const grouping = findCreateItem(ir.operations, (o) => o.id === groupingRefKey);
    expect(grouping).toBeDefined();
    // Path is the full folder path; name is just the leaf segment
    // (Sitecore item names can't contain `/`). Parent is the
    // intermediate path so the path-walker auto-creates "Theme".
    expect(grouping!.path).toBe(`${ENUMERATIONS_ROOT}/Theme/Color`);
    expect(grouping!.parent).toEqual({
      kind: "ref-path",
      value: `${ENUMERATIONS_ROOT}/Theme`,
    });
    expect(grouping!.name).toBe("Color");

    // The enum folder itself parents under the leaf grouping folder.
    const folder = findCreateItem(
      ir.operations,
      (o) => o.id === enumerationFolderId(SITE, "color-scheme@1")
    );
    expect(folder!.path).toBe(`${ENUMERATIONS_ROOT}/Theme/Color/ColorScheme`);
    expect(folder!.parent).toEqual({ kind: "ref-recipe", refKey: groupingRefKey });

    // Value items follow the new path too.
    const primary = findCreateItem(ir.operations, (o) => o.name === "primary");
    expect(primary!.path).toBe(`${ENUMERATIONS_ROOT}/Theme/Color/ColorScheme/primary`);
  });

  it("two recipes with the same multi-segment folder share the leaf folder via emittedFolders", () => {
    const a = baseEnum({
      handle: "color-scheme@1",
      name: "ColorScheme",
      location: { scope: "site", folder: "Theme/Color" },
    });
    const b = baseEnum({
      handle: "tone@1",
      name: "Tone",
      location: { scope: "site", folder: "Theme/Color" },
    });
    const emittedFolders = new Set<string>();
    const irA = compileEnumerationRecipe(a, CONTEXT, emittedFolders);
    const irB = compileEnumerationRecipe(b, CONTEXT, emittedFolders);

    const groupingRefKey = enumerationsGroupingFolderId(SITE, "Theme/Color");
    expect(findCreateItem(irA.operations, (o) => o.id === groupingRefKey)).toBeDefined();
    expect(findCreateItem(irB.operations, (o) => o.id === groupingRefKey)).toBeUndefined();
  });
});
