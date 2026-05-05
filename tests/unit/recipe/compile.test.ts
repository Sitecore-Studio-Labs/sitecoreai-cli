import { describe, expect, it } from "vitest";
import { type CompileContext, compileComponentTemplateRecipe } from "../../../src/recipe/compile";
import {
  fieldId,
  inlineEnumFolderId,
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
  SXA_COMPONENT_BASE_TEMPLATES,
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

const ENUMERATIONS_ROOT = "/sitecore/content/test-tenant/test-site/Settings/Enumerations";

const CONTEXT: CompileContext = {
  templatesRoot: "/sitecore/templates/Project/test-site/Components",
  renderingsRoot: "/sitecore/layout/Renderings/Project/test-site",
  headlessVariantsRoot:
    "/sitecore/content/test-tenant/test-site/Presentation/Headless Variants",
  enumerationsRoot: ENUMERATIONS_ROOT,
};

const SITE = "default";
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

  it("emits exactly 19 operations in the canonical order", () => {
    expect(ir.schemaVersion).toBe("1");
    expect(ir.recipeHandle).toBe(HANDLE);
    // Both `Size` and `ColorScheme` carry sitecore.type: "droplist", so
    // they don't trigger the inline-enum folder + value-item emission
    // (Droplist enumerates from a pipe-list Source string; the folder
    // would just be unused content). The per-site Enumeration template
    // pair is also skipped — nothing references them.
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
      "CreateItem", // 10. params-field "Size" (Droplist, pipe-list Source)
      "CreateItem", // 11. params-field "ColorScheme" (Droplist, pipe-list Source)
      "CreateItem", // 12. params __Standard Values
      "SetStandardValues", // 13. back-fill params-template
      "CreateItem", // 14. rendering
      "CreateItem", // 15. variants-folder
      "CreateItem", // 16. variant "Default"
      "CreateItem", // 17. variant "Outline"
      "CreateItem", // 18. variant "Ghost"
      "CreateItem", // 19. variant "Link"
    ]);
  });

  it("compilation is pure: same inputs produce identical IR", () => {
    const second = compileComponentTemplateRecipe(ctaButtonRecipe, CONTEXT);
    expect(second).toEqual(ir);
  });

  it("template item uses recipe.name, displayName goes to __Display name", () => {
    const op = ir.operations[0] as CreateItemOp;
    expect(op.id).toBe(templateId(SITE, HANDLE));
    expect(op.path).toBe(`${CONTEXT.templatesRoot}/CtaButton`);
    expect(op.parent).toEqual({ kind: "ref-path", value: CONTEXT.templatesRoot });
    expect(op.templateOf).toBe(SITECORE_TEMPLATES.TEMPLATE);
    expect(op.name).toBe("CtaButton");
    const displayName = findField(op.fields, SYSTEM_FIELDS.DISPLAY_NAME, "en");
    expect(displayName?.value).toEqual({ kind: "string", value: "CTA Button" });
  });

  it("template inherits Standard Template + the SXA Foundation bases (per-site SVs, Horizon datasource grouping, publishing grouping)", () => {
    const op = ir.operations[1] as SetBaseTemplatesOp;
    expect(op.itemRefKey).toBe(templateId(SITE, HANDLE));
    expect(op.baseTemplates).toEqual([
      STANDARD_TEMPLATE_ID,
      ...SXA_COMPONENT_BASE_TEMPLATES,
    ]);
  });

  it("section 'Content' is parented under the template", () => {
    const op = ir.operations[2] as CreateItemOp;
    expect(op.id).toBe(sectionId(SITE, HANDLE, "Content"));
    expect(op.parent).toEqual({ kind: "ref-recipe", refKey: templateId(SITE, HANDLE) });
    expect(op.path).toBe(`${CONTEXT.templatesRoot}/CtaButton/Content`);
    expect(op.templateOf).toBe(SITECORE_TEMPLATES.TEMPLATE_SECTION);
    expect(op.name).toBe("Content");
  });

  it("Link field carries General Link type (sitecore.type override) and sortOrder 100", () => {
    const op = onlyOp(
      ir.operations,
      "CreateItem",
      (o) => o.name === "Link" && o.templateOf === SITECORE_TEMPLATES.TEMPLATE_FIELD
    );
    expect(op.id).toBe(fieldId(SITE, HANDLE, "Link"));
    expect(op.parent).toEqual({
      kind: "ref-recipe",
      refKey: sectionId(SITE, HANDLE, "Content"),
    });
    const type = findField(op.fields, TEMPLATE_FIELD_FIELDS.TYPE);
    expect(type?.value).toEqual({ kind: "string", value: "General Link" });
    const sortOrder = findField(op.fields, SYSTEM_FIELDS.SORT_ORDER);
    expect(sortOrder?.value).toEqual({ kind: "number", value: 100 });
  });

  it("standard values item has templateOf = template's own refKey (chicken-and-egg)", () => {
    const op = ir.operations[4] as CreateItemOp;
    expect(op.id).toBe(standardValuesId(SITE, HANDLE));
    expect(op.parent).toEqual({ kind: "ref-recipe", refKey: templateId(SITE, HANDLE) });
    // templateOf carries the template's recipe-internal refKey; the executor
    // resolves it to the assigned itemId via capturedItemIds at apply time.
    expect(op.templateOf).toBe(templateId(SITE, HANDLE));
    expect(op.name).toBe("__Standard Values");
  });

  it("back-fills template.__Standard values via SetStandardValues op", () => {
    const op = ir.operations[5] as SetStandardValuesOp;
    expect(op.templateRefKey).toBe(templateId(SITE, HANDLE));
    expect(op.standardValuesRefKey).toBe(standardValuesId(SITE, HANDLE));
  });

  it("params template lands under the templates root with `<name> Parameters`", () => {
    const op = ir.operations[6] as CreateItemOp;
    expect(op.id).toBe(paramsTemplateId(SITE, HANDLE));
    expect(op.parent).toEqual({ kind: "ref-path", value: CONTEXT.templatesRoot });
    expect(op.path).toBe(`${CONTEXT.templatesRoot}/CtaButton Parameters`);
    expect(op.name).toBe("CtaButton Parameters");
    const displayName = findField(op.fields, SYSTEM_FIELDS.DISPLAY_NAME, "en");
    expect(displayName?.value).toEqual({ kind: "string", value: "CTA Button Parameters" });
  });

  it("params section is parented under the params template", () => {
    const op = ir.operations[8] as CreateItemOp;
    expect(op.id).toBe(paramsSectionId(SITE, HANDLE, "Parameters"));
    expect(op.parent).toEqual({
      kind: "ref-recipe",
      refKey: paramsTemplateId(SITE, HANDLE),
    });
    expect(op.name).toBe("Parameters");
  });

  it("params field 'Size' carries Droplist (sitecore.type override) + pipe-list Source", () => {
    const op = onlyOp(
      ir.operations,
      "CreateItem",
      (o) =>
        o.name === "Size" &&
        o.parent.kind === "ref-recipe" &&
        o.parent.refKey === paramsSectionId(SITE, HANDLE, "Parameters")
    );
    expect(op.id).toBe(paramsFieldId(SITE, HANDLE, "Size"));
    // sitecore.type: "droplist" override → Type=Droplist + Source as a
    // pipe-separated value list. The Droplist field reads its options
    // straight from the Source string; no folder lookup, no per-field
    // enum value items emitted.
    const type = findField(op.fields, TEMPLATE_FIELD_FIELDS.TYPE);
    expect(type?.value).toEqual({ kind: "string", value: "Droplist" });
    const source = findField(op.fields, TEMPLATE_FIELD_FIELDS.SOURCE);
    expect(source?.value).toEqual({
      kind: "string",
      value: "default|lg|sm|xs",
    });
  });

  it("rendering carries componentName, ref-recipe Datasource Template + Parameters Template", () => {
    const op = onlyOp(ir.operations, "CreateItem", (o) => o.id === renderingId(SITE, HANDLE));
    expect(op.parent).toEqual({ kind: "ref-path", value: CONTEXT.renderingsRoot });
    expect(op.templateOf).toBe(SITECORE_TEMPLATES.RENDERING);
    expect(op.name).toBe("CtaButton");
    expect(findField(op.fields, RENDERING_FIELDS.COMPONENT_NAME)?.value).toEqual({
      kind: "string",
      value: "CtaButton",
    });
    expect(findField(op.fields, RENDERING_FIELDS.DATASOURCE_TEMPLATE)?.value).toEqual({
      kind: "ref-recipe",
      refKey: templateId(SITE, HANDLE),
    });
    expect(findField(op.fields, RENDERING_FIELDS.PARAMETERS_TEMPLATE)?.value).toEqual({
      kind: "ref-recipe",
      refKey: paramsTemplateId(SITE, HANDLE),
    });
  });

  it("rendering's Datasource Location is the recipe's query string", () => {
    const op = onlyOp(ir.operations, "CreateItem", (o) => o.id === renderingId(SITE, HANDLE));
    expect(findField(op.fields, RENDERING_FIELDS.DATASOURCE_LOCATION)?.value).toEqual({
      kind: "string",
      value: "query:$site/*[@@name='Data']",
    });
  });

  it("rendering's OtherProperties merges compiler defaults with recipe overrides", () => {
    const op = onlyOp(ir.operations, "CreateItem", (o) => o.id === renderingId(SITE, HANDLE));
    const otherProps = findField(op.fields, RENDERING_FIELDS.OTHER_PROPERTIES);
    expect(otherProps?.value).toMatchObject({
      kind: "url-string-map",
      entries: { IsAutoDatasourceRendering: "true" },
    });
  });

  it("per-rendering Headless Variants folder lands under the configured root with HeadlessVariants template (no section)", () => {
    // cta-button has no `section`, so the per-rendering folder is parented
    // directly at headlessVariantsRoot (no grouping layer above).
    const op = onlyOp(ir.operations, "CreateItem", (o) => o.id === variantsFolderId(SITE, HANDLE));
    expect(op.parent).toEqual({
      kind: "ref-path",
      value: CONTEXT.headlessVariantsRoot,
    });
    expect(op.templateOf).toBe(SITECORE_TEMPLATES.HEADLESS_VARIANTS);
    expect(op.name).toBe("CtaButton");
    expect(op.path).toBe(`${CONTEXT.headlessVariantsRoot}/CtaButton`);
  });

  it("emits one Variant Definition item per recipe.variants entry under the per-rendering folder", () => {
    const variantNames = ["Default", "Outline", "Ghost", "Link"];
    for (const name of variantNames) {
      const op = onlyOp(ir.operations, "CreateItem", (o) => o.id === variantId(SITE, HANDLE, name));
      expect(op.parent).toEqual({ kind: "ref-recipe", refKey: variantsFolderId(SITE, HANDLE) });
      expect(op.templateOf).toBe(SITECORE_TEMPLATES.VARIANT_DEFINITION);
      expect(op.name).toBe(name);
      expect(op.path).toBe(`${CONTEXT.headlessVariantsRoot}/CtaButton/${name}`);
    }
  });

  it("every operation carries policy CreateAndUpdate (cta-button has no inline-enum + Droplink, so no template-ensure CreateOnly ops)", () => {
    // The per-site Enumeration template pair only emits when an inline
    // enum field with Type=Droplink (the default for shape=enum) is
    // encountered. cta-button overrides every enum param to Droplist,
    // so no template-ensure ops fire and every op stays CreateAndUpdate.
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
