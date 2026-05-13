import { describe, expect, it } from "vitest";
import {
  type CompileContext,
  compileComponentTemplateRecipe,
  compileEnumerationRecipe,
} from "../../../src/recipe/compile";
import {
  enumerationContainerSectionId,
  enumerationContainerValueFieldId,
  enumerationFolderId,
  enumerationsFolderTemplateId,
  enumerationsFolderTemplateStandardValuesId,
  enumerationsGroupingFolderId,
  enumerationTemplateId,
  enumerationTemplateSectionId,
  enumerationTemplateStandardValuesId,
  enumerationTemplateValueFieldId,
  enumerationValueTemplateId,
  enumValueId,
  designParameterFieldId,
  designParametersStandardValuesId,
  designParametersTemplateId,
} from "../../../src/recipe/guids";
import {
  SITECORE_TEMPLATES,
  STANDARD_TEMPLATE_ID,
  SYSTEM_FIELDS,
  TEMPLATE_FIELD_FIELDS,
} from "../../../src/recipe/ir/sitecore-templates";
import { sitecoreFieldTypeLabel } from "../../../src/recipe/schema/field-types";
import type { CreateItemOp, Operation, RefValue } from "../../../src/recipe/ir/operations";
import type { ComponentTemplateRecipe, EnumerationRecipe } from "../../../src/recipe/schema/recipe";

const SITE = "default";
const ENUMERATIONS_ROOT = "/sitecore/content/test-tenant/test-site/Settings/Enumerations";
const SITE_TEMPLATES_ROOT = "/sitecore/templates/Project/test-site";

// Sibling EnumerationRecipe required by `compileComponentTemplateRecipe`
// when a component declares `sitecore.enumHandle`. Standalone callers
// (no `compileRecipeSet`) must seed `enumsByHandle` themselves so the
// field compiler can resolve the enum's tenant path.
const COLOR_SCHEME_ENUM: EnumerationRecipe = {
  kind: "enumeration",
  schemaVersion: "1",
  handle: "color-scheme@1",
  name: "ColorScheme",
  values: [{ name: "primary" }, { name: "neutral" }],
};

const CONTEXT: CompileContext = {
  templatesRoot: "/sitecore/templates/Project/test-site/Components",
  renderingsRoot: "/sitecore/layout/Renderings/Project/test-site",
  headlessVariantsRoot: "/sitecore/content/test-tenant/test-site/Presentation/Headless Variants",
  enumerationsRoot: ENUMERATIONS_ROOT,
  enumsByHandle: new Map([[COLOR_SCHEME_ENUM.handle, COLOR_SCHEME_ENUM]]),
};

const findField = (fields: CreateItemOp["fields"], fieldGuid: string, language?: string) =>
  fields.find(
    (f) => f.fieldId === fieldGuid && (language === undefined || f.language === language)
  );

const findCreateItem = (
  ops: Operation[],
  predicate: (op: CreateItemOp) => boolean
): CreateItemOp | undefined =>
  ops.find((op): op is CreateItemOp => op.op === "CreateItem" && predicate(op));

describe("compileEnumerationRecipe — emits one folder + one value-item per declared value", () => {
  const recipe: EnumerationRecipe = {
    kind: "enumeration",
    schemaVersion: "1",
    handle: "color-scheme@1",
    name: "ColorScheme",
    displayName: "Color Scheme",
    values: [
      { name: "primary", displayName: "Primary" },
      { name: "neutral" },
      { name: "destructive", displayName: "Destructive" },
    ],
  };

  it("emits per-site template-ensure ops (3 templates incl. inner section/field on both Enumeration + Enumeration Value + 2 SV blocks) + 1 container op + 1 op per value", () => {
    const ir = compileEnumerationRecipe(recipe, CONTEXT);
    expect(ir.recipeHandle).toBe("color-scheme@1");
    // ensureEnumerationTemplates:
    //   • 3 template CreateItem + 3 SetBaseTemplates       (= 6 ops)
    //   • 4 inner CreateItem: Enumeration template's
    //     Section + Value field + Enumeration Value
    //     template's Section + Value field                  (= 4 ops)
    //   • Standard Values block per insertable template
    //     (Enumerations Folder + Enumeration), each:
    //     CreateItem + SetStandardValues + SetField        (= 6 ops)
    // Per recipe: 1 container CreateItem + 3 value CreateItems = 4 ops.
    expect(ir.operations).toHaveLength(20);
    expect(ir.operations.map((op) => op.op)).toEqual([
      "CreateItem", // Enumerations Folder template
      "SetBaseTemplates",
      "CreateItem", // Enumeration template (per-enum container)
      "SetBaseTemplates",
      "CreateItem", // Enumeration Value template (leaf values)
      "SetBaseTemplates",
      "CreateItem", // Enumeration template's inner Enumeration section
      "CreateItem", // Enumeration template's inner Value field (default carrier)
      "CreateItem", // Enumeration Value template's inner Enumeration section
      "CreateItem", // Enumeration Value template's inner Value field (leaf payload carrier)
      "CreateItem", // Enumerations Folder __Standard Values
      "SetStandardValues",
      "SetField", // Insert Options on Enumerations Folder SV
      "CreateItem", // Enumeration __Standard Values
      "SetStandardValues",
      "SetField", // Insert Options on Enumeration SV
      "CreateItem", // per-enum container item (recipe)
      "CreateItem", // value 1
      "CreateItem", // value 2
      "CreateItem", // value 3
    ]);
  });

  it("scaffolds the per-site Enumerations Folder + Enumeration + Enumeration Value templates under <templatesRoot>/Presentation", () => {
    const ir = compileEnumerationRecipe(recipe, CONTEXT);
    const folderTpl = findCreateItem(
      ir.operations,
      (o) => o.id === enumerationsFolderTemplateId(SITE)
    );
    const enumTpl = findCreateItem(ir.operations, (o) => o.id === enumerationTemplateId(SITE));
    const valueTpl = findCreateItem(
      ir.operations,
      (o) => o.id === enumerationValueTemplateId(SITE)
    );
    expect(folderTpl).toBeDefined();
    expect(folderTpl!.name).toBe("Enumerations Folder");
    // Lands at the SITE templates root's `/Presentation` (sibling of
    // /Components), not nested under /Components — derived by stripping
    // the trailing `/Components` segment from `templatesRoot`.
    expect(folderTpl!.path).toBe(`${SITE_TEMPLATES_ROOT}/Presentation/Enumerations Folder`);
    expect(folderTpl!.templateOf).toBe(SITECORE_TEMPLATES.TEMPLATE);
    expect(folderTpl!.policy).toBe("CreateOnly");
    expect(enumTpl).toBeDefined();
    expect(enumTpl!.name).toBe("Enumeration");
    expect(enumTpl!.path).toBe(`${SITE_TEMPLATES_ROOT}/Presentation/Enumeration`);
    expect(enumTpl!.templateOf).toBe(SITECORE_TEMPLATES.TEMPLATE);
    expect(enumTpl!.policy).toBe("CreateOnly");
    expect(valueTpl).toBeDefined();
    expect(valueTpl!.name).toBe("Enumeration Value");
    expect(valueTpl!.path).toBe(`${SITE_TEMPLATES_ROOT}/Presentation/Enumeration Value`);
    expect(valueTpl!.templateOf).toBe(SITECORE_TEMPLATES.TEMPLATE);
    expect(valueTpl!.policy).toBe("CreateOnly");
    // All three inherit Standard Template only.
    for (const tplRefKey of [
      enumerationsFolderTemplateId(SITE),
      enumerationTemplateId(SITE),
      enumerationValueTemplateId(SITE),
    ]) {
      const baseOp = ir.operations.find(
        (op) => op.op === "SetBaseTemplates" && op.itemRefKey === tplRefKey
      );
      expect(baseOp).toBeDefined();
      expect((baseOp as { baseTemplates: string[] }).baseTemplates).toEqual([STANDARD_TEMPLATE_ID]);
    }
  });

  it("Enumeration Value template carries an inner `Enumeration` section with a single `Value` field (Single-Line Text, shared)", () => {
    const ir = compileEnumerationRecipe(recipe, CONTEXT);
    const valueTplRefKey = enumerationValueTemplateId(SITE);
    const sectionRefKey = enumerationTemplateSectionId(SITE);
    const valueFieldRefKey = enumerationTemplateValueFieldId(SITE);

    const section = findCreateItem(ir.operations, (o) => o.id === sectionRefKey);
    expect(section).toBeDefined();
    expect(section!.name).toBe("Enumeration");
    expect(section!.path).toBe(`${SITE_TEMPLATES_ROOT}/Presentation/Enumeration Value/Enumeration`);
    expect(section!.parent).toEqual({ kind: "ref-recipe", refKey: valueTplRefKey });
    expect(section!.templateOf).toBe(SITECORE_TEMPLATES.TEMPLATE_SECTION);
    expect(section!.policy).toBe("CreateOnly");

    const valueField = findCreateItem(ir.operations, (o) => o.id === valueFieldRefKey);
    expect(valueField).toBeDefined();
    expect(valueField!.name).toBe("Value");
    expect(valueField!.path).toBe(
      `${SITE_TEMPLATES_ROOT}/Presentation/Enumeration Value/Enumeration/Value`
    );
    expect(valueField!.parent).toEqual({ kind: "ref-recipe", refKey: sectionRefKey });
    expect(valueField!.templateOf).toBe(SITECORE_TEMPLATES.TEMPLATE_FIELD);
    expect(valueField!.policy).toBe("CreateOnly");

    // Type=Single-Line Text, Shared=1, __Sortorder=100 — matches the
    // canonical click-click-launch Value field exactly so SXA editor
    // recognises the enumeration entry shape.
    expect(findField(valueField!.fields, TEMPLATE_FIELD_FIELDS.TYPE)?.value).toEqual({
      kind: "string",
      value: sitecoreFieldTypeLabel("single-line-text"),
    });
    expect(findField(valueField!.fields, TEMPLATE_FIELD_FIELDS.SHARED)?.value).toEqual({
      kind: "string",
      value: "1",
    });
    expect(findField(valueField!.fields, SYSTEM_FIELDS.SORT_ORDER)?.value).toEqual({
      kind: "number",
      value: 100,
    });
  });

  it("Enumeration template ALSO carries an inner `Enumeration` section with a `Value` field — for the per-enum container's default value", () => {
    const ir = compileEnumerationRecipe(recipe, CONTEXT);
    const enumTplRefKey = enumerationTemplateId(SITE);
    const sectionRefKey = enumerationContainerSectionId(SITE);
    const valueFieldRefKey = enumerationContainerValueFieldId(SITE);

    const section = findCreateItem(ir.operations, (o) => o.id === sectionRefKey);
    expect(section).toBeDefined();
    expect(section!.name).toBe("Enumeration");
    expect(section!.path).toBe(`${SITE_TEMPLATES_ROOT}/Presentation/Enumeration/Enumeration`);
    expect(section!.parent).toEqual({ kind: "ref-recipe", refKey: enumTplRefKey });
    expect(section!.templateOf).toBe(SITECORE_TEMPLATES.TEMPLATE_SECTION);

    const valueField = findCreateItem(ir.operations, (o) => o.id === valueFieldRefKey);
    expect(valueField).toBeDefined();
    expect(valueField!.name).toBe("Value");
    expect(valueField!.path).toBe(
      `${SITE_TEMPLATES_ROOT}/Presentation/Enumeration/Enumeration/Value`
    );
    expect(valueField!.parent).toEqual({ kind: "ref-recipe", refKey: sectionRefKey });
    expect(valueField!.templateOf).toBe(SITECORE_TEMPLATES.TEMPLATE_FIELD);
    // Same Single-Line Text shared shape as the Value field on the
    // Enumeration Value template — consistent so Edge consumers query
    // either container or leaf with `item.field("Value").value`.
    expect(findField(valueField!.fields, TEMPLATE_FIELD_FIELDS.TYPE)?.value).toEqual({
      kind: "string",
      value: sitecoreFieldTypeLabel("single-line-text"),
    });
    expect(findField(valueField!.fields, TEMPLATE_FIELD_FIELDS.SHARED)?.value).toEqual({
      kind: "string",
      value: "1",
    });

    // Distinct GUID from the Enumeration Value template's `Value` field —
    // they live on different templates with different paths, so different
    // refKeys are expected.
    expect(valueFieldRefKey).not.toBe(enumerationTemplateValueFieldId(SITE));
  });

  it("Enumeration template's __Standard Values has Insert Options pointing at Enumeration Value", () => {
    const ir = compileEnumerationRecipe(recipe, CONTEXT);
    const enumSvRefKey = enumerationTemplateStandardValuesId(SITE);
    const sv = findCreateItem(ir.operations, (o) => o.id === enumSvRefKey);
    expect(sv).toBeDefined();
    expect(sv!.name).toBe("__Standard Values");
    expect(sv!.path).toBe(`${SITE_TEMPLATES_ROOT}/Presentation/Enumeration/__Standard Values`);
    expect(sv!.templateOf).toBe(enumerationTemplateId(SITE));

    const insertOp = ir.operations.find(
      (op) =>
        op.op === "SetField" &&
        op.itemRefKey === enumSvRefKey &&
        op.fieldId === SYSTEM_FIELDS.INSERT_OPTIONS
    );
    expect(insertOp).toBeDefined();
    // ref-recipe-list (NOT ref-guid-list) — executor resolves each
    // refKey to the server-assigned template itemId before rendering.
    expect((insertOp as { value: { kind: string; refKeys: string[] } }).value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [enumerationValueTemplateId(SITE)],
    });
  });

  it("Enumerations Folder template's __Standard Values Insert Options allow Enumeration + nested Enumerations Folder", () => {
    const ir = compileEnumerationRecipe(recipe, CONTEXT);
    const folderSvRefKey = enumerationsFolderTemplateStandardValuesId(SITE);
    const insertOp = ir.operations.find(
      (op) =>
        op.op === "SetField" &&
        op.itemRefKey === folderSvRefKey &&
        op.fieldId === SYSTEM_FIELDS.INSERT_OPTIONS
    );
    expect(insertOp).toBeDefined();
    expect((insertOp as { value: { kind: string; refKeys: string[] } }).value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [enumerationTemplateId(SITE), enumerationsFolderTemplateId(SITE)],
    });
  });

  it("dedups template-ensure ops across recipes when emittedFolders is shared", () => {
    const emittedFolders = new Set<string>();
    const first = compileEnumerationRecipe(recipe, CONTEXT, emittedFolders);
    const second = compileEnumerationRecipe(
      { ...recipe, handle: "size-scale@1", name: "SizeScale" },
      CONTEXT,
      emittedFolders
    );
    // First IR carries the full template scaffolding; second IR doesn't.
    for (const refKey of [
      enumerationsFolderTemplateId(SITE),
      enumerationTemplateId(SITE),
      enumerationValueTemplateId(SITE),
      enumerationContainerSectionId(SITE),
      enumerationContainerValueFieldId(SITE),
      enumerationTemplateSectionId(SITE),
      enumerationTemplateValueFieldId(SITE),
      enumerationsFolderTemplateStandardValuesId(SITE),
      enumerationTemplateStandardValuesId(SITE),
    ]) {
      expect(findCreateItem(first.operations, (o) => o.id === refKey)).toBeDefined();
      expect(findCreateItem(second.operations, (o) => o.id === refKey)).toBeUndefined();
    }
  });

  it("per-enum container item lands at <enumerationsRoot>/<recipe.name> conforming to the Enumeration template", () => {
    const ir = compileEnumerationRecipe(recipe, CONTEXT);
    const container = findCreateItem(
      ir.operations,
      (o) => o.id === enumerationFolderId(SITE, "color-scheme@1")
    );
    expect(container).toBeDefined();
    expect(container!.path).toBe(`${ENUMERATIONS_ROOT}/ColorScheme`);
    expect(container!.parent).toEqual({ kind: "ref-path", value: ENUMERATIONS_ROOT });
    // Container conforms to Enumeration (NOT Enumerations Folder, which
    // is reserved for grouping items).
    expect(container!.templateOf).toBe(enumerationTemplateId(SITE));
    expect(container!.name).toBe("ColorScheme");
    expect(findField(container!.fields, SYSTEM_FIELDS.DISPLAY_NAME, "en")?.value).toEqual({
      kind: "string",
      value: "Color Scheme",
    });
  });

  it("does NOT write a Value field on the per-enum container when recipe.default is omitted", () => {
    const ir = compileEnumerationRecipe(recipe, CONTEXT);
    const container = findCreateItem(
      ir.operations,
      (o) => o.id === enumerationFolderId(SITE, "color-scheme@1")
    );
    const valueFieldRefKey = enumerationContainerValueFieldId(SITE);
    expect(container!.fields.find((f) => f.fieldId === valueFieldRefKey)).toBeUndefined();
  });

  it("writes recipe.default to the per-enum container's Value shared field with fieldName='Value'", () => {
    const withDefault: EnumerationRecipe = { ...recipe, default: "primary" };
    const ir = compileEnumerationRecipe(withDefault, CONTEXT);
    const container = findCreateItem(
      ir.operations,
      (o) => o.id === enumerationFolderId(SITE, "color-scheme@1")
    );
    const valueFieldRefKey = enumerationContainerValueFieldId(SITE);
    const valueEntry = container!.fields.find((f) => f.fieldId === valueFieldRefKey);
    expect(valueEntry).toBeDefined();
    expect(valueEntry!.fieldName).toBe("Value");
    expect(valueEntry!.language).toBeUndefined();
    expect(valueEntry!.version).toBeUndefined();
    expect(valueEntry!.value).toEqual({ kind: "string", value: "primary" });
  });

  it("throws INPUT_INVALID when recipe.default does not match any value.name", () => {
    const bogus: EnumerationRecipe = { ...recipe, default: "not-a-real-value" };
    expect(() => compileEnumerationRecipe(bogus, CONTEXT)).toThrowError(
      /default='not-a-real-value'/
    );
  });

  it("falls back displayName -> name when displayName is omitted on the recipe", () => {
    const ir = compileEnumerationRecipe({ ...recipe, displayName: undefined }, CONTEXT);
    const container = findCreateItem(
      ir.operations,
      (o) => o.id === enumerationFolderId(SITE, "color-scheme@1")
    );
    expect(findField(container!.fields, SYSTEM_FIELDS.DISPLAY_NAME, "en")?.value).toEqual({
      kind: "string",
      value: "ColorScheme",
    });
  });

  it("each value item is parented under the container via ref-recipe and conforms to per-site Enumeration Value template", () => {
    const ir = compileEnumerationRecipe(recipe, CONTEXT);
    const containerRefKey = enumerationFolderId(SITE, "color-scheme@1");
    const valueFieldRefKey = enumerationTemplateValueFieldId(SITE);
    for (const value of recipe.values) {
      const op = findCreateItem(ir.operations, (o) => o.name === value.name);
      expect(op).toBeDefined();
      expect(op!.id).toBe(enumValueId(containerRefKey, value.name));
      expect(op!.parent).toEqual({ kind: "ref-recipe", refKey: containerRefKey });
      expect(op!.path).toBe(`${ENUMERATIONS_ROOT}/ColorScheme/${value.name}`);
      // Value items conform to Enumeration Value (NOT Enumeration, which
      // is reserved for the per-enum container).
      expect(op!.templateOf).toBe(enumerationValueTemplateId(SITE));
      expect(findField(op!.fields, SYSTEM_FIELDS.DISPLAY_NAME, "en")?.value).toEqual({
        kind: "string",
        value: value.displayName ?? value.name,
      });
      // Each value item writes its `Value` shared field to the value's
      // name — matches the canonical click-click-launch pattern (e.g.
      // `Background Themes/shooting-star` carries `Value: "shooting-star"`).
      // `fieldName` is required so the executor's tenant-side resolver
      // can match the recipe-derived field GUID against the
      // server-assigned one.
      const valueEntry = op!.fields.find((f) => f.fieldId === valueFieldRefKey);
      expect(valueEntry).toBeDefined();
      expect(valueEntry!.fieldName).toBe("Value");
      expect(valueEntry!.language).toBeUndefined();
      expect(valueEntry!.version).toBeUndefined();
      expect(valueEntry!.value).toEqual({ kind: "string", value: value.name });
    }
  });

  it("template-ensure CreateItem + SetBaseTemplates ops carry CreateOnly; SV link + Insert Options carry CreateAndUpdate; recipe-owned ops carry CreateAndUpdate", () => {
    const ir = compileEnumerationRecipe(recipe, CONTEXT);
    const containerRefKey = enumerationFolderId(SITE, "color-scheme@1");
    const ensureRefKeys = new Set([
      enumerationsFolderTemplateId(SITE),
      enumerationTemplateId(SITE),
      enumerationValueTemplateId(SITE),
      enumerationContainerSectionId(SITE),
      enumerationContainerValueFieldId(SITE),
      enumerationTemplateSectionId(SITE),
      enumerationTemplateValueFieldId(SITE),
      enumerationsFolderTemplateStandardValuesId(SITE),
      enumerationTemplateStandardValuesId(SITE),
    ]);
    for (const op of ir.operations) {
      const isTemplateEnsure =
        ("itemRefKey" in op && ensureRefKeys.has(op.itemRefKey)) ||
        ("id" in op && ensureRefKeys.has(op.id)) ||
        ("templateRefKey" in op && ensureRefKeys.has(op.templateRefKey)) ||
        ("standardValuesRefKey" in op && ensureRefKeys.has(op.standardValuesRefKey));
      if (!isTemplateEnsure) {
        expect(op.policy).toBe("CreateAndUpdate");
        continue;
      }
      // SetStandardValues link + Insert Options SetField are recipe-
      // controlled — CreateAndUpdate so re-pushes always reconcile.
      // Everything else under template-ensure is CreateOnly (the
      // template/section/field/SV items themselves).
      const isReconcileOp =
        op.op === "SetStandardValues" ||
        (op.op === "SetField" && op.fieldId === SYSTEM_FIELDS.INSERT_OPTIONS);
      expect(op.policy).toBe(isReconcileOp ? "CreateAndUpdate" : "CreateOnly");
    }
    // Sanity-check the per-enum container + value items are CreateAndUpdate.
    const container = findCreateItem(ir.operations, (o) => o.id === containerRefKey);
    expect(container!.policy).toBe("CreateAndUpdate");
  });

  it("throws INPUT_INVALID when context.enumerationsRoot is unset", () => {
    expect(() =>
      compileEnumerationRecipe(recipe, {
        ...CONTEXT,
        enumerationsRoot: undefined,
      })
    ).toThrowError(/enumerationsRoot/);
  });
});

describe("compileEnumerationRecipe — location.folder grouping", () => {
  const recipeInTheme: EnumerationRecipe = {
    kind: "enumeration",
    schemaVersion: "1",
    handle: "color-scheme@1",
    name: "ColorScheme",
    displayName: "Color Scheme",
    location: { scope: "site", folder: "Theme" },
    values: [{ name: "primary" }, { name: "neutral" }],
  };

  it("nests the enum folder under the configured location.folder", () => {
    const ir = compileEnumerationRecipe(recipeInTheme, CONTEXT);
    const groupingRefKey = enumerationsGroupingFolderId(SITE, "Theme");
    const grouping = findCreateItem(ir.operations, (o) => o.id === groupingRefKey);
    expect(grouping).toBeDefined();
    expect(grouping!.path).toBe(`${ENUMERATIONS_ROOT}/Theme`);
    expect(grouping!.parent).toEqual({ kind: "ref-path", value: ENUMERATIONS_ROOT });
    expect(grouping!.templateOf).toBe(enumerationsFolderTemplateId(SITE));
    expect(grouping!.policy).toBe("CreateOnly");
    expect(grouping!.name).toBe("Theme");

    const folder = findCreateItem(
      ir.operations,
      (o) => o.id === enumerationFolderId(SITE, "color-scheme@1")
    );
    expect(folder!.path).toBe(`${ENUMERATIONS_ROOT}/Theme/ColorScheme`);
    expect(folder!.parent).toEqual({ kind: "ref-recipe", refKey: groupingRefKey });
    // Value items follow the new path too.
    const primary = findCreateItem(ir.operations, (o) => o.name === "primary");
    expect(primary!.path).toBe(`${ENUMERATIONS_ROOT}/Theme/ColorScheme/primary`);
  });

  it("dedups the grouping folder across recipes when emittedFolders is shared", () => {
    const emittedFolders = new Set<string>();
    const first = compileEnumerationRecipe(recipeInTheme, CONTEXT, emittedFolders);
    const sibling: EnumerationRecipe = {
      ...recipeInTheme,
      handle: "tone@1",
      name: "Tone",
      values: [{ name: "warm" }, { name: "cool" }],
    };
    const second = compileEnumerationRecipe(sibling, CONTEXT, emittedFolders);
    const groupingRefKey = enumerationsGroupingFolderId(SITE, "Theme");
    expect(findCreateItem(first.operations, (o) => o.id === groupingRefKey)).toBeDefined();
    expect(findCreateItem(second.operations, (o) => o.id === groupingRefKey)).toBeUndefined();
    // The sibling's enum folder still parents under the (already-emitted)
    // grouping folder via ref-recipe — the executor resolves the refKey
    // at apply time against the captured-itemId map.
    const siblingFolder = findCreateItem(
      second.operations,
      (o) => o.id === enumerationFolderId(SITE, "tone@1")
    );
    expect(siblingFolder!.parent).toEqual({ kind: "ref-recipe", refKey: groupingRefKey });
  });

  it("emits no grouping ops when location is omitted (flat layout)", () => {
    const flat: EnumerationRecipe = { ...recipeInTheme, location: undefined };
    const ir = compileEnumerationRecipe(flat, CONTEXT);
    expect(
      findCreateItem(ir.operations, (o) => o.id === enumerationsGroupingFolderId(SITE, "Theme"))
    ).toBeUndefined();
    const folder = findCreateItem(
      ir.operations,
      (o) => o.id === enumerationFolderId(SITE, "color-scheme@1")
    );
    expect(folder!.path).toBe(`${ENUMERATIONS_ROOT}/ColorScheme`);
    expect(folder!.parent).toEqual({ kind: "ref-path", value: ENUMERATIONS_ROOT });
  });

  it("rejects location.scope='siteCollection' with a clear hint", () => {
    const collectionScoped: EnumerationRecipe = {
      ...recipeInTheme,
      location: { scope: "siteCollection", folder: "Theme" },
    };
    expect(() => compileEnumerationRecipe(collectionScoped, CONTEXT)).toThrowError(
      /siteCollection enumerations root isn't wired up yet/
    );
  });
});

/**
 * Cross-cutting: enum-shaped fields on a ComponentTemplateRecipe.
 *
 * Two supported shapes (anything else throws INPUT_INVALID):
 *
 * Inline Droplist (`sitecore.type: "droplist"` + inline `values: [...]`):
 *   - Source = pipe-separated literal of the values.
 *   - No value items emitted; Sitecore enumerates from the Source string.
 *   - SV default encodes as raw string.
 *
 * Shared Droplink (`sitecore.enumHandle: "<EnumerationRecipe.handle>"`):
 *   - Source = `ref-recipe` to `enumerationFolderId(site, enumHandle)`.
 *   - No value-item children emitted by the consuming field — the
 *     `EnumerationRecipe` owns those.
 *   - SV default encodes as `ref-recipe` to
 *     `enumValueId(enumerationFolderId(site, enumHandle), default)`.
 *
 * Inline Droplink (shape=enum + inline `values` + neither override) is
 * NOT supported — the SXA Headless rendering parameters dialog never
 * reliably picked up the per-field folder of values, so the compiler
 * rejects this combo with INPUT_INVALID at field-emission time.
 */
describe("compileComponentTemplateRecipe — inline Droplink (rejected)", () => {
  const recipe: ComponentTemplateRecipe = {
    kind: "component-template",
    schemaVersion: "1",
    handle: "inline-droplink-comp@1",
    name: "InlineDroplinkComp",
    displayName: "Inline Droplink Comp",
    fields: [
      {
        name: "Mood",
        shape: "enum",
        values: ["calm", "loud"],
        default: "calm",
      },
    ],
  } as ComponentTemplateRecipe;

  it("throws INPUT_INVALID on shape=enum + values without sitecore.type=droplist or sitecore.enumHandle", () => {
    expect(() => compileComponentTemplateRecipe(recipe, CONTEXT)).toThrowError(
      /inline Droplink isn't supported/
    );
  });
});

describe("compileComponentTemplateRecipe — inline Droplist field (sitecore.type override)", () => {
  const recipe: ComponentTemplateRecipe = {
    kind: "component-template",
    schemaVersion: "1",
    handle: "inline-droplist-comp@1",
    name: "InlineDroplistComp",
    displayName: "Inline Droplist Comp",
    fields: [
      {
        name: "Mood",
        shape: "enum",
        values: ["calm", "loud"],
        default: "calm",
        sitecore: { type: "droplist" },
      },
    ],
  } as ComponentTemplateRecipe;

  it("Type=Droplist + Source is the pipe-separated value list", () => {
    const ir = compileComponentTemplateRecipe(recipe, CONTEXT);
    const fieldOp = findCreateItem(ir.operations, (o) => o.name === "Mood");
    expect(findField(fieldOp!.fields, TEMPLATE_FIELD_FIELDS.TYPE)?.value).toEqual({
      kind: "string",
      value: "Droplist",
    });
    expect(findField(fieldOp!.fields, TEMPLATE_FIELD_FIELDS.SOURCE)?.value).toEqual({
      kind: "string",
      value: "calm|loud",
    });
  });

  it("emits no per-field folder or value items (Droplist enumerates from the Source string)", () => {
    const ir = compileComponentTemplateRecipe(recipe, CONTEXT);
    // No CreateItem for any of the value names — Droplist has no shadow content.
    for (const value of recipe.fields[0].values!) {
      expect(findCreateItem(ir.operations, (o) => o.name === value)).toBeUndefined();
    }
    // Per-site Enumeration templates also stay un-emitted (only the
    // shared-Droplink path scaffolds them).
    expect(
      findCreateItem(ir.operations, (o) => o.id === enumerationsFolderTemplateId(SITE))
    ).toBeUndefined();
    expect(
      findCreateItem(ir.operations, (o) => o.id === enumerationTemplateId(SITE))
    ).toBeUndefined();
    expect(
      findCreateItem(ir.operations, (o) => o.id === enumerationValueTemplateId(SITE))
    ).toBeUndefined();
  });

  it("SV default encodes as the raw string (Droplist matches by name in the Source list)", () => {
    const ir = compileComponentTemplateRecipe(recipe, CONTEXT);
    const sv = findCreateItem(
      ir.operations,
      (o) =>
        o.templateOf !== SITECORE_TEMPLATES.TEMPLATE_FIELD &&
        o.name === "__Standard Values" &&
        o.parent.kind === "ref-recipe"
    );
    expect(sv).toBeDefined();
    const moodEntry = sv!.fields.find((f) => f.fieldName === "Mood");
    expect(moodEntry).toBeDefined();
    expect(moodEntry!.value).toEqual<RefValue>({ kind: "string", value: "calm" });
  });

  it("throws INPUT_INVALID when sitecore.type=droplist but no inline values are declared", () => {
    const noValues = {
      ...recipe,
      fields: [
        {
          name: "Mood",
          shape: "enum",
          default: "calm",
          sitecore: { type: "droplist" },
        },
      ],
    } as ComponentTemplateRecipe;
    expect(() => compileComponentTemplateRecipe(noValues, CONTEXT)).toThrowError(
      /Droplist needs an inline value list/
    );
  });
});

describe("compileComponentTemplateRecipe — shared enum field (sitecore.enumHandle)", () => {
  const recipe: ComponentTemplateRecipe = {
    kind: "component-template",
    schemaVersion: "1",
    handle: "shared-enum-comp@1",
    name: "SharedEnumComp",
    displayName: "Shared Enum Comp",
    fields: [],
    params: [
      {
        name: "ColorScheme",
        shape: "enum",
        default: "primary",
        sitecore: {
          enumHandle: "color-scheme@1",
          sortOrder: 100,
        },
      },
    ],
  } as ComponentTemplateRecipe;

  it("Type defaults to Droplink for shape=enum", () => {
    const ir = compileComponentTemplateRecipe(recipe, CONTEXT);
    const fieldOp = findCreateItem(
      ir.operations,
      (o) => o.id === designParameterFieldId(SITE, recipe.handle, "ColorScheme")
    );
    expect(findField(fieldOp!.fields, TEMPLATE_FIELD_FIELDS.TYPE)?.value).toEqual({
      kind: "string",
      value: "Droplink",
    });
  });

  it("Source is the enum folder's tenant path — Sitecore Droplink picker enumerates by path, not by GUID", () => {
    const ir = compileComponentTemplateRecipe(recipe, CONTEXT);
    const fieldOp = findCreateItem(
      ir.operations,
      (o) => o.id === designParameterFieldId(SITE, recipe.handle, "ColorScheme")
    );
    expect(findField(fieldOp!.fields, TEMPLATE_FIELD_FIELDS.SOURCE)?.value).toEqual<RefValue>({
      kind: "string",
      value: `${ENUMERATIONS_ROOT}/${COLOR_SCHEME_ENUM.name}`,
    });
  });

  it("emits NO inline value-item children (the EnumerationRecipe owns those)", () => {
    const ir = compileComponentTemplateRecipe(recipe, CONTEXT);
    // The shared-enum value names should not appear as CreateItem ops
    // under this component's ops at all.
    expect(findCreateItem(ir.operations, (o) => o.name === "primary")).toBeUndefined();
  });

  it("SV default encodes as ref-recipe to enumValueId(folder, default)", () => {
    const ir = compileComponentTemplateRecipe(recipe, CONTEXT);
    const paramsSv = findCreateItem(
      ir.operations,
      (o) => o.id === designParametersStandardValuesId(SITE, recipe.handle)
    );
    expect(paramsSv).toBeDefined();
    const colorEntry = paramsSv!.fields.find((f) => f.fieldName === "ColorScheme");
    expect(colorEntry).toBeDefined();
    expect(colorEntry!.value).toEqual<RefValue>({
      kind: "ref-recipe",
      refKey: enumValueId(enumerationFolderId(SITE, "color-scheme@1"), "primary"),
    });
    // Avoid an unused-import warning on designParametersTemplateId — the SV's
    // parent is the params template by construction.
    expect(paramsSv!.parent).toEqual({
      kind: "ref-recipe",
      refKey: designParametersTemplateId(SITE, recipe.handle),
    });
  });
});
