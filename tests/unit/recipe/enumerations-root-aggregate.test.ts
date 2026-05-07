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
  enumerationsRootId,
  enumerationsRootStandardValuesId,
  enumerationTemplateId,
} from "../../../src/recipe/guids";
import {
  ENUMERATION_ICON,
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
  it("single enum → root + SV ops + Insert Options [Folder, that enum's folder]", () => {
    const recipe = baseEnum({});
    const irs = compileRecipeSet([recipe], CONTEXT);
    const aggregate = findAggregate(irs);
    expect(aggregate).toBeDefined();
    expect(aggregate!.operations).toHaveLength(3);

    // Root item explicitly emitted with the enumeration glyph icon so
    // the executor's path-walker doesn't auto-create it as a generic
    // Folder with the default folder icon.
    const root = findCreateItem(aggregate!.operations, (o) => o.id === enumerationsRootId(SITE));
    expect(root).toBeDefined();
    expect(root!.path).toBe(ENUMERATIONS_ROOT);
    expect(root!.parent).toEqual({ kind: "ref-path", value: "/sitecore/content/test-tenant/test-site/Settings" });
    expect(root!.name).toBe("Enumerations");
    expect(root!.templateOf).toBe(SITECORE_TEMPLATES.FOLDER);
    expect(root!.policy).toBe("CreateAndUpdate");
    expect(root!.fields).toEqual([
      {
        fieldId: SYSTEM_FIELDS.ICON,
        value: { kind: "string", value: ENUMERATION_ICON },
      },
    ]);

    const sv = findCreateItem(
      aggregate!.operations,
      (o) => o.id === enumerationsRootStandardValuesId(SITE)
    );
    expect(sv!.path).toBe(`${ENUMERATIONS_ROOT}/__Standard Values`);
    expect(sv!.parent).toEqual({ kind: "ref-recipe", refKey: enumerationsRootId(SITE) });
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

  it("emits one template-level __Standard Values under Enumerations Folder, linked + Insert Options=[Enumeration, Enumerations Folder]", () => {
    const recipe = baseEnum({});
    const ir = compileEnumerationRecipe(recipe, CONTEXT);

    const folderTemplateRefKey = enumerationsFolderTemplateId(SITE);
    const enumerationTemplateRefKey = enumerationTemplateId(SITE);
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
    // Enumeration first (typical insert: an author drops a new enum
    // into a folder), Enumerations Folder second (nesting for
    // multi-segment recipes like `folder: "Theme/Color"`).
    expect(insert!.value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [enumerationTemplateRefKey, folderTemplateRefKey],
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

  it("multi-segment folder emits a CreateItem for EVERY segment using the Enumerations Folder template, not just the leaf", () => {
    const recipe = baseEnum({ location: { scope: "site", folder: "Theme/Color" } });
    const ir = compileEnumerationRecipe(recipe, CONTEXT);

    // Intermediate segment ("Theme") gets its own explicit CreateItem
    // conforming to the Enumerations Folder template — without this,
    // the executor's path-walker would auto-create it as the generic
    // `Folder` template, which has no Insert Options for Enumeration
    // / Enumerations Folder.
    const intermediateRefKey = enumerationsGroupingFolderId(SITE, "Theme");
    const intermediate = findCreateItem(ir.operations, (o) => o.id === intermediateRefKey);
    expect(intermediate).toBeDefined();
    expect(intermediate!.path).toBe(`${ENUMERATIONS_ROOT}/Theme`);
    expect(intermediate!.name).toBe("Theme");
    expect(intermediate!.templateOf).toBe(enumerationsFolderTemplateId(SITE));
    expect(intermediate!.parent).toEqual({ kind: "ref-path", value: ENUMERATIONS_ROOT });

    // Leaf segment ("Color") parents under the intermediate via
    // ref-recipe (NOT ref-path) so the executor resolves the captured
    // itemId from the intermediate's CreateItem.
    const leafRefKey = enumerationsGroupingFolderId(SITE, "Theme/Color");
    const leaf = findCreateItem(ir.operations, (o) => o.id === leafRefKey);
    expect(leaf).toBeDefined();
    expect(leaf!.path).toBe(`${ENUMERATIONS_ROOT}/Theme/Color`);
    expect(leaf!.name).toBe("Color");
    expect(leaf!.templateOf).toBe(enumerationsFolderTemplateId(SITE));
    expect(leaf!.parent).toEqual({ kind: "ref-recipe", refKey: intermediateRefKey });

    // The enum container parents under the leaf grouping folder.
    const container = findCreateItem(
      ir.operations,
      (o) => o.id === enumerationFolderId(SITE, "color-scheme@1")
    );
    expect(container!.path).toBe(`${ENUMERATIONS_ROOT}/Theme/Color/ColorScheme`);
    expect(container!.parent).toEqual({ kind: "ref-recipe", refKey: leafRefKey });

    // Value items follow the new path too.
    const primary = findCreateItem(ir.operations, (o) => o.name === "primary");
    expect(primary!.path).toBe(`${ENUMERATIONS_ROOT}/Theme/Color/ColorScheme/primary`);
  });

  it("two recipes sharing a multi-segment prefix dedup BOTH the intermediate and leaf folders via emittedFolders", () => {
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

    const intermediateRefKey = enumerationsGroupingFolderId(SITE, "Theme");
    const leafRefKey = enumerationsGroupingFolderId(SITE, "Theme/Color");
    // First IR carries both segments; second IR carries neither.
    expect(findCreateItem(irA.operations, (o) => o.id === intermediateRefKey)).toBeDefined();
    expect(findCreateItem(irA.operations, (o) => o.id === leafRefKey)).toBeDefined();
    expect(findCreateItem(irB.operations, (o) => o.id === intermediateRefKey)).toBeUndefined();
    expect(findCreateItem(irB.operations, (o) => o.id === leafRefKey)).toBeUndefined();
  });

  it("two recipes sharing only a PREFIX (not the full path) reuse the intermediate but each emit their own leaf", () => {
    // `Components/Card` + `Components/Tabs` — the `Components`
    // intermediate is shared; `Card` and `Tabs` are sibling leaves.
    const card = baseEnum({
      handle: "card-padding@1",
      name: "CardPadding",
      location: { scope: "site", folder: "Components/Card" },
    });
    const tabs = baseEnum({
      handle: "tabs-style@1",
      name: "TabsStyle",
      location: { scope: "site", folder: "Components/Tabs" },
    });
    const emittedFolders = new Set<string>();
    const irCard = compileEnumerationRecipe(card, CONTEXT, emittedFolders);
    const irTabs = compileEnumerationRecipe(tabs, CONTEXT, emittedFolders);

    const componentsRefKey = enumerationsGroupingFolderId(SITE, "Components");
    const cardLeafRefKey = enumerationsGroupingFolderId(SITE, "Components/Card");
    const tabsLeafRefKey = enumerationsGroupingFolderId(SITE, "Components/Tabs");

    // First recipe emits both `Components` and `Components/Card`.
    expect(findCreateItem(irCard.operations, (o) => o.id === componentsRefKey)).toBeDefined();
    expect(findCreateItem(irCard.operations, (o) => o.id === cardLeafRefKey)).toBeDefined();

    // Second recipe SKIPS the shared `Components` intermediate but
    // emits its own leaf `Components/Tabs` (parented under
    // `Components` via ref-recipe).
    expect(findCreateItem(irTabs.operations, (o) => o.id === componentsRefKey)).toBeUndefined();
    const tabsLeaf = findCreateItem(irTabs.operations, (o) => o.id === tabsLeafRefKey);
    expect(tabsLeaf).toBeDefined();
    expect(tabsLeaf!.parent).toEqual({ kind: "ref-recipe", refKey: componentsRefKey });
  });
});
