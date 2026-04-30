import { describe, expect, it } from "vitest";
import { type CompileContext, compileComponentTemplateRecipe } from "../../../src/recipe/compile";
import {
  fieldId,
  paramsFieldId,
  paramsSectionId,
  paramsTemplateId,
  renderingId,
  sectionId,
  standardValuesId,
  templateId,
  variantId,
  variantsFolderId,
} from "../../../src/recipe/guids";
import {
  RENDERING_FIELDS,
  SITECORE_TEMPLATES,
  STANDARD_TEMPLATE_ID,
  SYSTEM_FIELDS,
  TEMPLATE_FIELD_FIELDS,
} from "../../../src/recipe/ir/sitecore-templates";
import type {
  CreateItemOp,
  Operation,
  SetBaseTemplatesOp,
  SetStandardValuesOp,
} from "../../../src/recipe/ir/operations";
import { ctaButtonRecipe } from "../../../example/recipes/cta-button.recipe";

const CONTEXT: CompileContext = {
  templatesRoot: "/sitecore/templates/Project/test-site/Components",
  renderingsRoot: "/sitecore/layout/Renderings/Project/test-site",
};

const HANDLE = "cta-button@1";

const onlyOp = <K extends Operation["op"]>(
  ops: Operation[],
  kind: K,
  predicate: (op: Extract<Operation, { op: K }>) => boolean
): Extract<Operation, { op: K }> => {
  const matches = ops.filter(
    (op): op is Extract<Operation, { op: K }> =>
      op.op === kind && predicate(op as Extract<Operation, { op: K }>)
  );
  expect(matches).toHaveLength(1);
  return matches[0];
};

const findField = (
  fields: CreateItemOp["fields"],
  fieldGuid: string,
  language?: string
): CreateItemOp["fields"][number] | undefined =>
  fields.find(
    (f) => f.fieldId === fieldGuid && (language === undefined || f.language === language)
  );

describe("compileComponentTemplateRecipe — cta-button worked example", () => {
  const ir = compileComponentTemplateRecipe(ctaButtonRecipe, CONTEXT);

  it("emits exactly 17 operations in the canonical order", () => {
    expect(ir.schemaVersion).toBe("1");
    expect(ir.recipeHandle).toBe(HANDLE);
    expect(ir.operations.map((op) => op.op)).toEqual([
      "CreateItem", // 1. template
      "SetBaseTemplates", // 2. template → Standard Template
      "CreateItem", // 3. section "Content"
      "CreateItem", // 4. field "Link"
      "CreateItem", // 5. __Standard Values
      "SetStandardValues", // 6. back-fill
      "CreateItem", // 7. params-template
      "SetBaseTemplates", // 8. params-template → Standard Template
      "CreateItem", // 9. params-section "Parameters"
      "CreateItem", // 10. params-field "Size"
      "CreateItem", // 11. params-field "ColorScheme"
      "CreateItem", // 12. rendering
      "CreateItem", // 13. variants-folder
      "CreateItem", // 14. variant "default"
      "CreateItem", // 15. variant "outline"
      "CreateItem", // 16. variant "ghost"
      "CreateItem", // 17. variant "link"
    ]);
  });

  it("compilation is pure: same inputs produce identical IR", () => {
    const second = compileComponentTemplateRecipe(ctaButtonRecipe, CONTEXT);
    expect(second).toEqual(ir);
  });

  it("template item uses recipe.name, displayName goes to __Display name", () => {
    const op = ir.operations[0] as CreateItemOp;
    expect(op.id).toBe(templateId(HANDLE));
    expect(op.path).toBe(`${CONTEXT.templatesRoot}/CtaButton`);
    expect(op.parent).toEqual({ kind: "ref-path", value: CONTEXT.templatesRoot });
    expect(op.templateOf).toBe(SITECORE_TEMPLATES.TEMPLATE);
    expect(op.name).toBe("CtaButton");
    const displayName = findField(op.fields, SYSTEM_FIELDS.DISPLAY_NAME, "en");
    expect(displayName?.value).toEqual({ kind: "string", value: "CTA Button" });
  });

  it("template gets Standard Template as its base", () => {
    const op = ir.operations[1] as SetBaseTemplatesOp;
    expect(op.itemRefKey).toBe(templateId(HANDLE));
    expect(op.baseTemplates).toEqual([STANDARD_TEMPLATE_ID]);
  });

  it("section 'Content' is parented under the template", () => {
    const op = ir.operations[2] as CreateItemOp;
    expect(op.id).toBe(sectionId(HANDLE, "Content"));
    expect(op.parent).toEqual({ kind: "ref-recipe", refKey: templateId(HANDLE) });
    expect(op.path).toBe(`${CONTEXT.templatesRoot}/CtaButton/Content`);
    expect(op.templateOf).toBe(SITECORE_TEMPLATES.TEMPLATE_SECTION);
    expect(op.name).toBe("Content");
  });

  it("Link field carries General Link type (sitecore.type override) and sortOrder 100", () => {
    const op = onlyOp(ir.operations, "CreateItem", (o) => o.name === "Link");
    expect(op.id).toBe(fieldId(HANDLE, "Link"));
    expect(op.parent).toEqual({
      kind: "ref-recipe",
      refKey: sectionId(HANDLE, "Content"),
    });
    const type = findField(op.fields, TEMPLATE_FIELD_FIELDS.TYPE);
    expect(type?.value).toEqual({ kind: "string", value: "General Link" });
    const sortOrder = findField(op.fields, SYSTEM_FIELDS.SORT_ORDER);
    expect(sortOrder?.value).toEqual({ kind: "number", value: 100 });
  });

  it("standard values item has templateOf = template's own refKey (chicken-and-egg)", () => {
    const op = ir.operations[4] as CreateItemOp;
    expect(op.id).toBe(standardValuesId(HANDLE));
    expect(op.parent).toEqual({ kind: "ref-recipe", refKey: templateId(HANDLE) });
    // templateOf carries the template's recipe-internal refKey; the executor
    // resolves it to the assigned itemId via capturedItemIds at apply time.
    expect(op.templateOf).toBe(templateId(HANDLE));
    expect(op.name).toBe("__Standard Values");
  });

  it("back-fills template.__Standard values via SetStandardValues op", () => {
    const op = ir.operations[5] as SetStandardValuesOp;
    expect(op.templateRefKey).toBe(templateId(HANDLE));
    expect(op.standardValuesRefKey).toBe(standardValuesId(HANDLE));
  });

  it("params template lands under the templates root with `<name> Parameters`", () => {
    const op = ir.operations[6] as CreateItemOp;
    expect(op.id).toBe(paramsTemplateId(HANDLE));
    expect(op.parent).toEqual({ kind: "ref-path", value: CONTEXT.templatesRoot });
    expect(op.path).toBe(`${CONTEXT.templatesRoot}/CtaButton Parameters`);
    expect(op.name).toBe("CtaButton Parameters");
    const displayName = findField(op.fields, SYSTEM_FIELDS.DISPLAY_NAME, "en");
    expect(displayName?.value).toEqual({ kind: "string", value: "CTA Button Parameters" });
  });

  it("params section is parented under the params template", () => {
    const op = ir.operations[8] as CreateItemOp;
    expect(op.id).toBe(paramsSectionId(HANDLE, "Parameters"));
    expect(op.parent).toEqual({
      kind: "ref-recipe",
      refKey: paramsTemplateId(HANDLE),
    });
    expect(op.name).toBe("Parameters");
  });

  it("params field 'Size' carries Droplist + values pipe-joined as Source", () => {
    const op = onlyOp(
      ir.operations,
      "CreateItem",
      (o) =>
        o.name === "Size" &&
        o.parent.kind === "ref-recipe" &&
        o.parent.refKey === paramsSectionId(HANDLE, "Parameters")
    );
    expect(op.id).toBe(paramsFieldId(HANDLE, "Size"));
    const type = findField(op.fields, TEMPLATE_FIELD_FIELDS.TYPE);
    expect(type?.value).toEqual({ kind: "string", value: "Droplist" });
    const source = findField(op.fields, TEMPLATE_FIELD_FIELDS.SOURCE);
    expect(source?.value).toEqual({ kind: "string", value: "default|lg|sm|xs" });
  });

  it("rendering carries componentName, ref-recipe Datasource Template + Parameters Template", () => {
    const op = onlyOp(ir.operations, "CreateItem", (o) => o.id === renderingId(HANDLE));
    expect(op.parent).toEqual({ kind: "ref-path", value: CONTEXT.renderingsRoot });
    expect(op.templateOf).toBe(SITECORE_TEMPLATES.RENDERING);
    expect(op.name).toBe("CtaButton");
    expect(findField(op.fields, RENDERING_FIELDS.COMPONENT_NAME)?.value).toEqual({
      kind: "string",
      value: "CtaButton",
    });
    expect(findField(op.fields, RENDERING_FIELDS.DATASOURCE_TEMPLATE)?.value).toEqual({
      kind: "ref-recipe",
      refKey: templateId(HANDLE),
    });
    expect(findField(op.fields, RENDERING_FIELDS.PARAMETERS_TEMPLATE)?.value).toEqual({
      kind: "ref-recipe",
      refKey: paramsTemplateId(HANDLE),
    });
  });

  it("rendering's Datasource Location is the recipe's query string", () => {
    const op = onlyOp(ir.operations, "CreateItem", (o) => o.id === renderingId(HANDLE));
    expect(findField(op.fields, RENDERING_FIELDS.DATASOURCE_LOCATION)?.value).toEqual({
      kind: "query",
      value: "query:$site/*[@@name='Data']",
    });
  });

  it("rendering's OtherProperties merges compiler defaults with recipe overrides", () => {
    const op = onlyOp(ir.operations, "CreateItem", (o) => o.id === renderingId(HANDLE));
    const otherProps = findField(op.fields, RENDERING_FIELDS.OTHER_PROPERTIES);
    expect(otherProps?.value).toMatchObject({
      kind: "url-string-map",
      entries: { IsAutoDatasourceRendering: "true" },
    });
  });

  it("variants folder is parented under the rendering item, name 'Variants'", () => {
    const op = onlyOp(ir.operations, "CreateItem", (o) => o.id === variantsFolderId(HANDLE));
    expect(op.parent).toEqual({ kind: "ref-recipe", refKey: renderingId(HANDLE) });
    expect(op.templateOf).toBe(SITECORE_TEMPLATES.FOLDER);
    expect(op.name).toBe("Variants");
  });

  it("emits one Variant item per recipe.variants entry, all under the variants folder", () => {
    const variantNames = ["default", "outline", "ghost", "link"];
    for (const name of variantNames) {
      const op = onlyOp(ir.operations, "CreateItem", (o) => o.id === variantId(HANDLE, name));
      expect(op.parent).toEqual({ kind: "ref-recipe", refKey: variantsFolderId(HANDLE) });
      expect(op.templateOf).toBe(SITECORE_TEMPLATES.FOLDER);
      expect(op.name).toBe(name);
    }
  });

  it("every operation carries policy CreateAndUpdate (default for registry-owned items)", () => {
    for (const op of ir.operations) {
      expect(op.policy).toBe("CreateAndUpdate");
    }
  });
});

describe("compileComponentTemplateRecipe — section grouping", () => {
  it("groups fields by sitecore.section in first-occurrence order", () => {
    const ir = compileComponentTemplateRecipe(
      {
        kind: "component-template",
        schemaVersion: "1",
        handle: "two-section@1",
        name: "TwoSection",
        displayName: "Two Section",
        fields: [
          {
            name: "Title",
            shape: "text",
            sitecore: { section: "Content", sortOrder: 100 },
          },
          {
            name: "Media",
            shape: "image",
            sitecore: { section: "Media", sortOrder: 100 },
          },
          {
            name: "Description",
            shape: "text",
            sitecore: { section: "Content", sortOrder: 200, type: "multi-line-text" },
          },
        ],
        rendering: {
          datasourceLocation: "current-item",
          openPropertiesAfterAdd: false,
        },
      },
      CONTEXT
    );

    const sectionCreates = ir.operations.filter(
      (op): op is CreateItemOp =>
        op.op === "CreateItem" && op.templateOf === SITECORE_TEMPLATES.TEMPLATE_SECTION
    );
    expect(sectionCreates.map((op) => op.name)).toEqual(["Content", "Media"]);

    const description = ir.operations.find(
      (op): op is CreateItemOp => op.op === "CreateItem" && op.name === "Description"
    );
    const type = description?.fields.find((f) => f.fieldId === TEMPLATE_FIELD_FIELDS.TYPE);
    expect(type?.value).toEqual({ kind: "string", value: "Multi-Line Text" });
  });
});

describe("compileComponentTemplateRecipe — shape defaults", () => {
  it("defaults `text` to single-line-text when no sitecore.type override", () => {
    const ir = compileComponentTemplateRecipe(
      {
        kind: "component-template",
        schemaVersion: "1",
        handle: "default-text@1",
        name: "DefaultText",
        displayName: "Default Text",
        fields: [{ name: "Title", shape: "text" }],
        rendering: { datasourceLocation: "current-item", openPropertiesAfterAdd: false },
      },
      CONTEXT
    );
    const titleField = ir.operations.find(
      (op): op is CreateItemOp => op.op === "CreateItem" && op.name === "Title"
    );
    const type = titleField?.fields.find((f) => f.fieldId === TEMPLATE_FIELD_FIELDS.TYPE);
    expect(type?.value).toEqual({ kind: "string", value: "Single-Line Text" });
  });

  it("defaults `reference` with multiple=true to treelist", () => {
    const ir = compileComponentTemplateRecipe(
      {
        kind: "component-template",
        schemaVersion: "1",
        handle: "ref-multi@1",
        name: "RefMulti",
        displayName: "Ref Multi",
        fields: [{ name: "Tags", shape: "reference", multiple: true }],
        rendering: { datasourceLocation: "current-item", openPropertiesAfterAdd: false },
      },
      CONTEXT
    );
    const tagsField = ir.operations.find(
      (op): op is CreateItemOp => op.op === "CreateItem" && op.name === "Tags"
    );
    const type = tagsField?.fields.find((f) => f.fieldId === TEMPLATE_FIELD_FIELDS.TYPE);
    expect(type?.value).toEqual({ kind: "string", value: "Treelist" });
  });
});

describe("compileComponentTemplateRecipe — recipes without optional buckets", () => {
  it("compiles a fields-only recipe (no params, no variants) to a smaller IR", () => {
    const ir = compileComponentTemplateRecipe(
      {
        kind: "component-template",
        schemaVersion: "1",
        handle: "minimal@1",
        name: "Minimal",
        displayName: "Minimal",
        fields: [{ name: "Title", shape: "text" }],
        rendering: { datasourceLocation: "current-item", openPropertiesAfterAdd: false },
      },
      CONTEXT
    );
    expect(
      ir.operations.find((op) => op.op === "CreateItem" && op.name === "Variants")
    ).toBeUndefined();
    expect(
      ir.operations.find((op) => op.op === "CreateItem" && op.name === "Minimal Parameters")
    ).toBeUndefined();
    const renderingOp = ir.operations.find(
      (op): op is CreateItemOp =>
        op.op === "CreateItem" && op.templateOf === SITECORE_TEMPLATES.RENDERING
    );
    expect(
      renderingOp?.fields.find((f) => f.fieldId === RENDERING_FIELDS.PARAMETERS_TEMPLATE)
    ).toBeUndefined();
  });
});
