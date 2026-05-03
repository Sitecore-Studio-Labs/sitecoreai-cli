import { describe, expect, it } from "vitest";
import {
  type CompileContext,
  compileComponentTemplateRecipe,
  compileEnumerationRecipe,
} from "../../../src/recipe/compile";
import {
  enumerationFolderId,
  enumValueId,
  inlineEnumFolderId,
  paramsFieldId,
  paramsStandardValuesId,
  paramsTemplateId,
} from "../../../src/recipe/guids";
import {
  SITECORE_TEMPLATES,
  SYSTEM_FIELDS,
  TEMPLATE_FIELD_FIELDS,
} from "../../../src/recipe/ir/sitecore-templates";
import type {
  CreateItemOp,
  Operation,
  RefValue,
} from "../../../src/recipe/ir/operations";
import type {
  ComponentTemplateRecipe,
  EnumerationRecipe,
} from "../../../src/recipe/schema/recipe";

const SITE = "default";
const ENUMERATIONS_ROOT = "/sitecore/content/test-tenant/test-site/Settings/Enumerations";

const CONTEXT: CompileContext = {
  templatesRoot: "/sitecore/templates/Project/test-site/Components",
  renderingsRoot: "/sitecore/layout/Renderings/Project/test-site",
  headlessVariantsRoot:
    "/sitecore/content/test-tenant/test-site/Presentation/Headless Variants",
  enumerationsRoot: ENUMERATIONS_ROOT,
};

const findField = (
  fields: CreateItemOp["fields"],
  fieldGuid: string,
  language?: string
) =>
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

  it("emits 1 folder op + 1 op per value, in declared order", () => {
    const ir = compileEnumerationRecipe(recipe, CONTEXT);
    expect(ir.recipeHandle).toBe("color-scheme@1");
    expect(ir.operations).toHaveLength(4);
    expect(ir.operations.map((op) => op.op)).toEqual([
      "CreateItem",
      "CreateItem",
      "CreateItem",
      "CreateItem",
    ]);
  });

  it("folder lands at <enumerationsRoot>/<recipe.name> with the recipe's deterministic refKey", () => {
    const ir = compileEnumerationRecipe(recipe, CONTEXT);
    const folder = ir.operations[0] as CreateItemOp;
    expect(folder.id).toBe(enumerationFolderId(SITE, "color-scheme@1"));
    expect(folder.path).toBe(`${ENUMERATIONS_ROOT}/ColorScheme`);
    expect(folder.parent).toEqual({ kind: "ref-path", value: ENUMERATIONS_ROOT });
    expect(folder.templateOf).toBe(SITECORE_TEMPLATES.FOLDER);
    expect(folder.name).toBe("ColorScheme");
    expect(findField(folder.fields, SYSTEM_FIELDS.DISPLAY_NAME, "en")?.value).toEqual({
      kind: "string",
      value: "Color Scheme",
    });
  });

  it("falls back displayName -> name when displayName is omitted on the recipe", () => {
    const ir = compileEnumerationRecipe(
      { ...recipe, displayName: undefined },
      CONTEXT,
    );
    const folder = ir.operations[0] as CreateItemOp;
    expect(findField(folder.fields, SYSTEM_FIELDS.DISPLAY_NAME, "en")?.value).toEqual({
      kind: "string",
      value: "ColorScheme",
    });
  });

  it("each value item is parented under the folder via ref-recipe and conforms to FOLDER", () => {
    const ir = compileEnumerationRecipe(recipe, CONTEXT);
    const folderRefKey = enumerationFolderId(SITE, "color-scheme@1");
    for (const value of recipe.values) {
      const op = findCreateItem(ir.operations, (o) => o.name === value.name);
      expect(op).toBeDefined();
      expect(op!.id).toBe(enumValueId(folderRefKey, value.name));
      expect(op!.parent).toEqual({ kind: "ref-recipe", refKey: folderRefKey });
      expect(op!.path).toBe(`${ENUMERATIONS_ROOT}/ColorScheme/${value.name}`);
      expect(op!.templateOf).toBe(SITECORE_TEMPLATES.FOLDER);
      expect(findField(op!.fields, SYSTEM_FIELDS.DISPLAY_NAME, "en")?.value).toEqual({
        kind: "string",
        value: value.displayName ?? value.name,
      });
    }
  });

  it("every op carries CreateAndUpdate policy (registry-owned vocabulary)", () => {
    const ir = compileEnumerationRecipe(recipe, CONTEXT);
    for (const op of ir.operations) {
      expect(op.policy).toBe("CreateAndUpdate");
    }
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

/**
 * Cross-cutting: enum-shaped fields on a ComponentTemplateRecipe.
 *
 * Inline enum (no `enumHandle`):
 *   - Source = `ref-recipe` to `inlineEnumFolderId(site, recipeHandle,
 *     fieldName)` — same shape as shared, just keyed per-(recipe, field).
 *     SXA Headless's rendering parameter dialog can resolve a `ref-recipe`
 *     Source to a content-tree folder (it can't resolve `query:` Source
 *     against the field-definition item, which is why the prior layout
 *     came up empty).
 *   - One Folder CreateItem at `<enumerationsRoot>/<recipeName>--<fieldName>/`
 *     plus one CreateItem per declared value parented under that folder.
 *   - SV default encodes as `ref-recipe` to `enumValueId(folder, default)`.
 *
 * Shared enum (`enumHandle: "<EnumerationRecipe.handle>"`):
 *   - Source = `ref-recipe` to `enumerationFolderId(site, enumHandle)`.
 *   - No value-item children emitted by the consuming field — the
 *     `EnumerationRecipe` owns those.
 *   - SV default encodes as `ref-recipe` to
 *     `enumValueId(enumerationFolderId(site, enumHandle), default)`.
 */
describe("compileComponentTemplateRecipe — inline enum field", () => {
  const recipe: ComponentTemplateRecipe = {
    kind: "component-template",
    schemaVersion: "1",
    handle: "inline-enum-comp@1",
    name: "InlineEnumComp",
    displayName: "Inline Enum Comp",
    fields: [
      {
        name: "Mood",
        shape: "enum",
        values: ["calm", "loud"],
        default: "calm",
      },
    ],
    rendering: { datasourceLocation: "current-item", openPropertiesAfterAdd: false },
  } as ComponentTemplateRecipe;

  it("Type defaults to Droplink for shape=enum (no sitecore.type override)", () => {
    const ir = compileComponentTemplateRecipe(recipe, CONTEXT);
    const fieldOp = findCreateItem(ir.operations, (o) => o.name === "Mood");
    expect(findField(fieldOp!.fields, TEMPLATE_FIELD_FIELDS.TYPE)?.value).toEqual({
      kind: "string",
      value: "Droplink",
    });
  });

  it("Source is a ref-recipe to the per-field inline-enum folder", () => {
    const ir = compileComponentTemplateRecipe(recipe, CONTEXT);
    const fieldOp = findCreateItem(ir.operations, (o) => o.name === "Mood");
    expect(findField(fieldOp!.fields, TEMPLATE_FIELD_FIELDS.SOURCE)?.value).toEqual<RefValue>({
      kind: "ref-recipe",
      refKey: inlineEnumFolderId(SITE, recipe.handle, "Mood"),
    });
  });

  it("emits a per-field Folder under <enumerationsRoot> plus one CreateItem per declared value, parented at the folder", () => {
    const ir = compileComponentTemplateRecipe(recipe, CONTEXT);
    const folderRefKey = inlineEnumFolderId(SITE, recipe.handle, "Mood");
    const folderName = `${recipe.name}--Mood`;
    const folder = findCreateItem(ir.operations, (o) => o.id === folderRefKey);
    expect(folder).toBeDefined();
    expect(folder!.parent).toEqual({ kind: "ref-path", value: ENUMERATIONS_ROOT });
    expect(folder!.path).toBe(`${ENUMERATIONS_ROOT}/${folderName}`);
    expect(folder!.templateOf).toBe(SITECORE_TEMPLATES.FOLDER);
    expect(folder!.name).toBe(folderName);

    for (const value of recipe.fields[0].values!) {
      const valueOp = findCreateItem(ir.operations, (o) => o.name === value);
      expect(valueOp).toBeDefined();
      expect(valueOp!.id).toBe(enumValueId(folderRefKey, value));
      expect(valueOp!.parent).toEqual({ kind: "ref-recipe", refKey: folderRefKey });
      expect(valueOp!.path).toBe(`${ENUMERATIONS_ROOT}/${folderName}/${value}`);
      expect(valueOp!.templateOf).toBe(SITECORE_TEMPLATES.FOLDER);
    }
  });

  it("SV default encodes as ref-recipe to the inline value-item GUID under the per-field folder", () => {
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
    const expectedRefKey = enumValueId(
      inlineEnumFolderId(SITE, recipe.handle, "Mood"),
      "calm",
    );
    expect(moodEntry!.value).toEqual<RefValue>({
      kind: "ref-recipe",
      refKey: expectedRefKey,
    });
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
    rendering: { datasourceLocation: "current-item", openPropertiesAfterAdd: false },
  } as ComponentTemplateRecipe;

  it("Type defaults to Droplink for shape=enum", () => {
    const ir = compileComponentTemplateRecipe(recipe, CONTEXT);
    const fieldOp = findCreateItem(
      ir.operations,
      (o) => o.id === paramsFieldId(SITE, recipe.handle, "ColorScheme")
    );
    expect(findField(fieldOp!.fields, TEMPLATE_FIELD_FIELDS.TYPE)?.value).toEqual({
      kind: "string",
      value: "Droplink",
    });
  });

  it("Source is a ref-recipe to enumerationFolderId — executor resolves apply-time path", () => {
    const ir = compileComponentTemplateRecipe(recipe, CONTEXT);
    const fieldOp = findCreateItem(
      ir.operations,
      (o) => o.id === paramsFieldId(SITE, recipe.handle, "ColorScheme")
    );
    expect(findField(fieldOp!.fields, TEMPLATE_FIELD_FIELDS.SOURCE)?.value).toEqual<RefValue>({
      kind: "ref-recipe",
      refKey: enumerationFolderId(SITE, "color-scheme@1"),
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
      (o) => o.id === paramsStandardValuesId(SITE, recipe.handle)
    );
    expect(paramsSv).toBeDefined();
    const colorEntry = paramsSv!.fields.find((f) => f.fieldName === "ColorScheme");
    expect(colorEntry).toBeDefined();
    expect(colorEntry!.value).toEqual<RefValue>({
      kind: "ref-recipe",
      refKey: enumValueId(enumerationFolderId(SITE, "color-scheme@1"), "primary"),
    });
    // Avoid an unused-import warning on paramsTemplateId — the SV's
    // parent is the params template by construction.
    expect(paramsSv!.parent).toEqual({
      kind: "ref-recipe",
      refKey: paramsTemplateId(SITE, recipe.handle),
    });
  });
});
