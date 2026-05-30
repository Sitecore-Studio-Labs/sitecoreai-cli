import { describe, expect, it } from "vitest";
import {
  AVAILABLE_RENDERINGS_AGGREGATE_HANDLE,
  type CompileContext,
  compileComponentTemplateRecipe,
  compileRecipe,
  compileRecipeSet,
} from "../../../src/recipe/compile";
import type { Recipe } from "../../../src/recipe/schema/recipe";
import {
  fieldId,
  designParameterFieldId,
  designParametersSectionId,
  designParametersTemplateId,
  renderingId,
  sectionId,
  standardValuesId,
  templateId,
  variantId,
  variantsFolderId,
} from "../../../src/recipe/items/guids";
import {
  IDYNAMIC_PLACEHOLDER_TEMPLATE_ID,
  RENDERING_FIELDS,
  SITECORE_TEMPLATES,
  STANDARD_TEMPLATE_ID,
  SXA_COMPONENT_BASE_TEMPLATES,
  SXA_HEADLESS_PARAMS_BASE_TEMPLATES,
  SYSTEM_FIELDS,
  TEMPLATE_FIELD_FIELDS,
} from "../../../src/recipe/ir/sitecore-templates";
import type {
  CreateItemOp,
  Operation,
  SetBaseTemplatesOp,
  SetFieldOp,
  SetStandardValuesOp,
} from "../../../src/recipe/ir/operations";
import { ctaButtonRecipe } from "../../../example/recipes/cta-button.recipe";

const ENUMERATIONS_ROOT = "/sitecore/content/test-tenant/test-site/Settings/Enumerations";

const CONTEXT: CompileContext = {
  templatesRoot: "/sitecore/templates/Project/test-site/Components",
  renderingsRoot: "/sitecore/layout/Renderings/Project/test-site",
  headlessVariantsRoot: "/sitecore/content/test-tenant/test-site/Presentation/Headless Variants",
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
    expect(op.baseTemplates).toEqual([STANDARD_TEMPLATE_ID, ...SXA_COMPONENT_BASE_TEMPLATES]);
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
    expect(op.id).toBe(designParametersTemplateId(SITE, HANDLE));
    expect(op.parent).toEqual({ kind: "ref-path", value: CONTEXT.templatesRoot });
    expect(op.path).toBe(`${CONTEXT.templatesRoot}/CtaButton Parameters`);
    expect(op.name).toBe("CtaButton Parameters");
    const displayName = findField(op.fields, SYSTEM_FIELDS.DISPLAY_NAME, "en");
    expect(displayName?.value).toEqual({ kind: "string", value: "CTA Button Parameters" });
  });

  it("params section is parented under the params template", () => {
    const op = ir.operations[8] as CreateItemOp;
    expect(op.id).toBe(designParametersSectionId(SITE, HANDLE, "Parameters"));
    expect(op.parent).toEqual({
      kind: "ref-recipe",
      refKey: designParametersTemplateId(SITE, HANDLE),
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
        o.parent.refKey === designParametersSectionId(SITE, HANDLE, "Parameters")
    );
    expect(op.id).toBe(designParameterFieldId(SITE, HANDLE, "Size"));
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
      refKey: designParametersTemplateId(SITE, HANDLE),
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

// ---------------------------------------------------------------------------
// Coverage top-up: compileRecipeSet's Available Renderings aggregate and the
// compileRecipe front-door dispatcher.
// ---------------------------------------------------------------------------

const uiSection: Recipe = {
  kind: "component-section",
  schemaVersion: "1",
  handle: "ui-section@1",
  name: "UI",
  displayName: "UI Components",
  sortOrder: 10,
};

const componentInSection = (handle: string, name: string): Recipe => ({
  kind: "component-template",
  schemaVersion: "1",
  handle,
  name,
  displayName: name,
  section: { handle: "ui-section@1" },
  fields: [{ name: "Title", shape: "text" }],
});

describe("compileRecipeSet — Available Renderings aggregate", () => {
  const CTX_WITH_RENDERINGS: CompileContext = {
    ...CONTEXT,
    availableRenderingsRoot:
      "/sitecore/content/test-tenant/test-site/Presentation/Available Renderings",
  };

  it("emits no Available Renderings IR when availableRenderingsRoot is unset", () => {
    const irs = compileRecipeSet([uiSection, componentInSection("card@1", "Card")], CONTEXT);
    expect(
      irs.find((ir) => ir.recipeHandle === AVAILABLE_RENDERINGS_AGGREGATE_HANDLE)
    ).toBeUndefined();
  });

  it("emits no Available Renderings IR when no component carries a section", () => {
    const sectionlessComponent: Recipe = {
      kind: "component-template",
      schemaVersion: "1",
      handle: "loose@1",
      name: "Loose",
      displayName: "Loose",
      fields: [{ name: "Title", shape: "text" }],
    };
    const irs = compileRecipeSet([sectionlessComponent], CTX_WITH_RENDERINGS);
    expect(
      irs.find((ir) => ir.recipeHandle === AVAILABLE_RENDERINGS_AGGREGATE_HANDLE)
    ).toBeUndefined();
  });

  it("emits a CreateItem + Renderings SetField per section, carrying the section displayName and sortOrder", () => {
    const irs = compileRecipeSet(
      [uiSection, componentInSection("card@1", "Card"), componentInSection("badge@1", "Badge")],
      CTX_WITH_RENDERINGS
    );
    const aggregate = irs.find((ir) => ir.recipeHandle === AVAILABLE_RENDERINGS_AGGREGATE_HANDLE);
    expect(aggregate).toBeDefined();

    const sectionCreate = aggregate!.operations.find(
      (op): op is CreateItemOp => op.op === "CreateItem"
    );
    expect(sectionCreate?.name).toBe("UI");
    expect(
      sectionCreate?.fields.find((f) => f.fieldId === SYSTEM_FIELDS.DISPLAY_NAME)?.value
    ).toEqual({ kind: "string", value: "UI Components" });
    expect(
      sectionCreate?.fields.find((f) => f.fieldId === SYSTEM_FIELDS.SORT_ORDER)?.value
    ).toEqual({ kind: "number", value: 10 });

    const renderingsField = aggregate!.operations.find(
      (op): op is SetFieldOp => op.op === "SetField"
    );
    // Two components in the section → the rendering list has two refKeys,
    // sorted by handle (badge@1 before card@1).
    expect(renderingsField?.value).toMatchObject({ kind: "ref-recipe-list" });
    expect((renderingsField?.value as { refKeys: string[] }).refKeys).toHaveLength(2);
  });
});

describe("compileRecipe — front-door dispatcher", () => {
  it("dispatches a section-definition recipe", () => {
    const sectionDef: Recipe = {
      kind: "section-definition",
      schemaVersion: "1",
      handle: "hero-section@1",
      name: "HeroSection",
      displayName: "Hero Section",
      sitePath: "/sitecore/content/test-tenant/test-site/Presentation/Available Renderings/Hero",
    };
    // A standalone section-definition is a resolution target — it emits
    // no ops itself (AppendToMultiList ops only fire when referenced),
    // but the dispatcher must still route it to the right compiler.
    const ir = compileRecipe(sectionDef, CONTEXT);
    expect(ir.recipeHandle).toBe("hero-section@1");
    expect(ir.schemaVersion).toBe("1");
  });

  it("dispatches a placeholder recipe", () => {
    const placeholder: Recipe = {
      kind: "placeholder",
      schemaVersion: "1",
      handle: "header-slot@1",
      key: "/header",
      name: "Header",
      displayName: "Header",
    };
    const ir = compileRecipe(placeholder, {
      ...CONTEXT,
      placeholderSettingsRoot:
        "/sitecore/content/test-tenant/test-site/Presentation/Placeholder Settings",
    });
    expect(ir.recipeHandle).toBe("header-slot@1");
  });

  it("dispatches a component-section recipe", () => {
    const ir = compileRecipe(uiSection, CONTEXT);
    expect(ir.recipeHandle).toBe("ui-section@1");
  });

  it("is idempotent — re-running compileRecipe yields identical IR", () => {
    const first = compileRecipe(uiSection, CONTEXT);
    const second = compileRecipe(uiSection, CONTEXT);
    expect(second).toEqual(first);
  });
});

// ---------------------------------------------------------------------------
// Branch coverage — compileRecipeSet's cross-recipe aggregate IRs.
// ---------------------------------------------------------------------------

const componentWithSiteSubfolder = (handle: string, name: string, subfolder: string): Recipe => ({
  kind: "component-template",
  schemaVersion: "1",
  handle,
  name,
  displayName: name,
  fields: [{ name: "Title", shape: "text" }],
  datasource: {
    locations: [{ scope: "site", subfolder }],
  },
});

describe("compileRecipeSet — Shared Data Folders aggregate", () => {
  const CTX: CompileContext = {
    ...CONTEXT,
    componentsRoot: "/sitecore/templates/Project/test-site/Components",
    contentItemsRoot: "/sitecore/content/test-tenant/test-site/Data",
  };

  it("emits no Shared Data Folders IR when no site subfolder is shared by ≥2 recipes", () => {
    // Single component touching the subfolder → singleton, not shared.
    const irs = compileRecipeSet([componentWithSiteSubfolder("badge@1", "Badge", "ui")], CTX);
    expect(irs.find((ir) => ir.recipeHandle === "__shared-data-folders__")).toBeUndefined();
  });

  it("emits a shared template + SV + base-templates + Insert Options for a subfolder shared by 2 recipes", () => {
    const irs = compileRecipeSet(
      [
        componentWithSiteSubfolder("badge@1", "Badge", "ui/badges"),
        componentWithSiteSubfolder("tag@1", "Tag", "ui/badges"),
      ],
      CTX
    );
    const aggregate = irs.find((ir) => ir.recipeHandle === "__shared-data-folders__");
    expect(aggregate).toBeDefined();
    // Per shared (site, subfolder): CreateItem template, SetBaseTemplates,
    // CreateItem __Standard Values, SetStandardValues, SetField insert-options.
    const opKinds = aggregate!.operations.map((op) => op.op);
    expect(opKinds).toEqual([
      "CreateItem",
      "SetBaseTemplates",
      "CreateItem",
      "SetStandardValues",
      "SetField",
    ]);
    // Multi-segment subfolder `ui/badges`: leaf becomes `badges Data Folder`.
    const tpl = aggregate!.operations.find(
      (op): op is CreateItemOp => op.op === "CreateItem" && op.name.endsWith("Data Folder")
    );
    expect(tpl!.name).toBe("badges Data Folder");
    // Insert Options aggregates both contributing recipes' datasource
    // templates, sorted by handle (badge@1 before tag@1).
    const insertOptions = aggregate!.operations.find(
      (op): op is SetFieldOp => op.op === "SetField"
    );
    expect((insertOptions!.value as { refKeys: string[] }).refKeys).toHaveLength(2);
  });
});

describe("compileRecipeSet — Site Data Root aggregate", () => {
  const CTX: CompileContext = {
    ...CONTEXT,
    componentsRoot: "/sitecore/templates/Project/test-site/Components",
    contentItemsRoot: "/sitecore/content/test-tenant/test-site/Data",
  };

  it("emits no Site Data Root IR when no recipe has a site-scoped subfolder", () => {
    const irs = compileRecipeSet([componentInSection("card@1", "Card"), uiSection], CTX);
    expect(irs.find((ir) => ir.recipeHandle === "__site-data-root__")).toBeUndefined();
  });

  it("aggregates singleton + shared Data Folder templates into the root SV Insert Options", () => {
    const irs = compileRecipeSet(
      [
        // Singleton site subfolder → one per-recipe Data Folder template.
        componentWithSiteSubfolder("hero@1", "Hero", "heroes"),
        // Shared site subfolder → coalesced shared Data Folder template.
        componentWithSiteSubfolder("badge@1", "Badge", "badges"),
        componentWithSiteSubfolder("tag@1", "Tag", "badges"),
      ],
      CTX
    );
    const aggregate = irs.find((ir) => ir.recipeHandle === "__site-data-root__");
    expect(aggregate).toBeDefined();
    expect(aggregate!.operations.map((op) => op.op)).toEqual(["CreateItem", "SetField"]);
    const insertOptions = aggregate!.operations.find(
      (op): op is SetFieldOp => op.op === "SetField"
    );
    const refKeys = (insertOptions!.value as { refKeys: string[] }).refKeys;
    // Folder template + 1 singleton (hero) + 1 shared subfolder (badges).
    expect(refKeys).toHaveLength(3);
  });
});

describe("compileRecipeSet — Enumerations Root aggregate", () => {
  const enumRecipe = (handle: string, name: string): Recipe => ({
    kind: "enumeration",
    schemaVersion: "1",
    handle,
    name,
    values: [{ name: "alpha" }, { name: "beta" }],
  });

  it("emits no Enumerations Root IR when there are no enumeration recipes", () => {
    const irs = compileRecipeSet([componentInSection("card@1", "Card"), uiSection], CONTEXT);
    expect(irs.find((ir) => ir.recipeHandle === "__enumerations-root__")).toBeUndefined();
  });

  it("emits the root item + SV + Insert Options aggregating every enumeration handle", () => {
    const irs = compileRecipeSet(
      [enumRecipe("tone@1", "Tone"), enumRecipe("size@1", "Size")],
      CONTEXT
    );
    const aggregate = irs.find((ir) => ir.recipeHandle === "__enumerations-root__");
    expect(aggregate).toBeDefined();
    // root CreateItem + SV CreateItem + Insert Options SetField.
    expect(aggregate!.operations.map((op) => op.op)).toEqual([
      "CreateItem",
      "CreateItem",
      "SetField",
    ]);
    const insertOptions = aggregate!.operations.find(
      (op): op is SetFieldOp => op.op === "SetField"
    );
    // Folder template + one folder per enumeration handle.
    expect((insertOptions!.value as { refKeys: string[] }).refKeys).toHaveLength(3);
  });
});

describe("compileRecipeSet — Placeholder Settings aggregate", () => {
  const CTX_WITH_PH: CompileContext = {
    ...CONTEXT,
    placeholderSettingsRoot:
      "/sitecore/content/test-tenant/test-site/Presentation/Placeholder Settings",
  };

  const placeholderRecipe = (handle: string, key: string, folder?: string | string[]): Recipe => ({
    kind: "placeholder",
    schemaVersion: "1",
    handle,
    key,
    name: key.replace(/[^a-zA-Z0-9]/g, "") || "ph",
    displayName: key,
    ...(folder
      ? {
          folder: Array.isArray(folder) ? folder : folder.split("/").filter(Boolean),
        }
      : {}),
  });

  it("emits no Placeholder Settings IR when the set declares no placeholders", () => {
    const irs = compileRecipeSet([componentInSection("card@1", "Card"), uiSection], CTX_WITH_PH);
    expect(irs.find((ir) => ir.recipeHandle === "__placeholder-settings__")).toBeUndefined();
  });

  it("throws INPUT_INVALID when placeholders are declared but placeholderSettingsRoot is unset", () => {
    expect(() => compileRecipeSet([placeholderRecipe("hdr@1", "/header")], CONTEXT)).toThrow(
      /placeholderSettingsRoot/
    );
  });

  it("emits a CreateItem + Allowed Controls SetField per standalone placeholder recipe", () => {
    const irs = compileRecipeSet(
      [placeholderRecipe("hdr@1", "/header"), placeholderRecipe("ftr@1", "/footer")],
      CTX_WITH_PH
    );
    const aggregate = irs.find((ir) => ir.recipeHandle === "__placeholder-settings__");
    expect(aggregate).toBeDefined();
    // Two placeholders × (CreateItem + SetField).
    const creates = aggregate!.operations.filter((op) => op.op === "CreateItem");
    const sets = aggregate!.operations.filter((op) => op.op === "SetField");
    expect(creates).toHaveLength(2);
    expect(sets).toHaveLength(2);
  });

  it("materialises grouping folders for a placeholder declared with a multi-segment folder", () => {
    const irs = compileRecipeSet(
      [placeholderRecipe("hdr@1", "/header", "Partial Design/Header")],
      CTX_WITH_PH
    );
    const aggregate = irs.find((ir) => ir.recipeHandle === "__placeholder-settings__")!;
    const folderCreates = aggregate.operations.filter(
      (op): op is CreateItemOp =>
        op.op === "CreateItem" && op.label.startsWith("placeholder-settings-folder:")
    );
    // One CreateOnly folder per path segment: "Partial Design", "Header".
    expect(folderCreates.map((op) => op.name)).toEqual(["Partial Design", "Header"]);
    for (const op of folderCreates) {
      expect(op.policy).toBe("CreateOnly");
    }
  });

  it("unions a component's placedIn into the placeholder Allowed Controls whitelist", () => {
    const componentPlacedIn: Recipe = {
      kind: "component-template",
      schemaVersion: "1",
      handle: "hero@1",
      name: "Hero",
      displayName: "Hero",
      fields: [{ name: "Title", shape: "text" }],
      placedIn: ["/header"],
    };
    const irs = compileRecipeSet([placeholderRecipe("hdr@1", "/header"), componentPlacedIn], {
      ...CTX_WITH_PH,
      headlessVariantsRoot: CONTEXT.headlessVariantsRoot,
    });
    const aggregate = irs.find((ir) => ir.recipeHandle === "__placeholder-settings__")!;
    const allowControls = aggregate.operations.find(
      (op): op is SetFieldOp =>
        op.op === "SetField" && op.label.startsWith("placeholder-allowed-controls:")
    );
    // hero@1 named /header in placedIn → it joins the whitelist.
    expect((allowControls!.value as { refKeys: string[] }).refKeys).toHaveLength(1);
  });

  it("collects an inline component placeholder slot into the aggregate", () => {
    const componentWithInlineSlot: Recipe = {
      kind: "component-template",
      schemaVersion: "1",
      handle: "grid@1",
      name: "Grid",
      displayName: "Grid",
      fields: [{ name: "Title", shape: "text" }],
      placeholders: [{ key: "grid-content", displayName: "Grid Content" }],
    };
    const irs = compileRecipeSet([componentWithInlineSlot], {
      ...CTX_WITH_PH,
      headlessVariantsRoot: CONTEXT.headlessVariantsRoot,
    });
    const aggregate = irs.find((ir) => ir.recipeHandle === "__placeholder-settings__")!;
    const create = aggregate.operations.find(
      (op): op is CreateItemOp =>
        op.op === "CreateItem" && op.label.startsWith("placeholder-settings:")
    );
    expect(create).toBeDefined();
    expect(create!.label).toContain("grid-content");
  });
});

describe("compileComponentTemplateRecipe — layout-only (no fields, no datasource)", () => {
  // Mirrors the registry's `container@1` / `column-splitter@1` /
  // `row-splitter@1` recipes: only params + placeholders, no fields,
  // no datasource block. Pure-layout renderings in stock SXA are
  // dropped without a "create or pick a datasource" prompt — and
  // Pages gates that prompt on the `Datasource Template` shared
  // field being non-empty. The compiler must NOT emit a value for
  // that field when the recipe describes no datasource surface.
  const LAYOUT_HANDLE = "container@1";
  const layoutRecipe: Recipe = {
    kind: "component-template",
    schemaVersion: "1",
    handle: LAYOUT_HANDLE,
    name: "container",
    displayName: "Container",
    params: [
      {
        name: "BackgroundImage",
        shape: "image",
        sitecore: { type: "image", sortOrder: 100 },
      },
    ],
    dynamicPlaceholders: true,
    placeholders: [{ key: "container-{*}" }],
  };

  const ir = compileComponentTemplateRecipe(layoutRecipe, CONTEXT);

  it("rendering item omits the Datasource Template field entirely (so Pages doesn't prompt for a content item)", () => {
    const op = onlyOp(
      ir.operations,
      "CreateItem",
      (o) => o.id === renderingId(SITE, LAYOUT_HANDLE)
    );
    expect(findField(op.fields, RENDERING_FIELDS.DATASOURCE_TEMPLATE)).toBeUndefined();
  });

  it("rendering still carries componentName + Parameters Template (params are unaffected)", () => {
    const op = onlyOp(
      ir.operations,
      "CreateItem",
      (o) => o.id === renderingId(SITE, LAYOUT_HANDLE)
    );
    expect(findField(op.fields, RENDERING_FIELDS.COMPONENT_NAME)?.value).toEqual({
      kind: "string",
      value: "container",
    });
    expect(findField(op.fields, RENDERING_FIELDS.PARAMETERS_TEMPLATE)?.value).toEqual({
      kind: "ref-recipe",
      refKey: designParametersTemplateId(SITE, LAYOUT_HANDLE),
    });
  });

  it("still emits Datasource Template when the recipe declares inline fields (existing behavior)", () => {
    const withFields: Recipe = {
      ...layoutRecipe,
      handle: "with-fields@1",
      name: "with-fields",
      displayName: "With Fields",
      fields: [
        {
          name: "Title",
          shape: "text",
          sitecore: { type: "single-line-text" },
        },
      ],
    };
    const ir2 = compileComponentTemplateRecipe(withFields, CONTEXT);
    const op = onlyOp(
      ir2.operations,
      "CreateItem",
      (o) => o.id === renderingId(SITE, "with-fields@1")
    );
    expect(findField(op.fields, RENDERING_FIELDS.DATASOURCE_TEMPLATE)?.value).toEqual({
      kind: "ref-recipe",
      refKey: templateId(SITE, "with-fields@1"),
    });
  });

  it("still emits Datasource Template when the recipe declares an explicit datasource.template (compatible-data-source pattern)", () => {
    const withExplicitDatasource: Recipe = {
      ...layoutRecipe,
      handle: "explicit-ds@1",
      name: "explicit-ds",
      displayName: "Explicit Datasource",
      datasource: { template: { handle: "shared-author@1" } },
    };
    const ir3 = compileComponentTemplateRecipe(withExplicitDatasource, CONTEXT);
    const op = onlyOp(
      ir3.operations,
      "CreateItem",
      (o) => o.id === renderingId(SITE, "explicit-ds@1")
    );
    expect(findField(op.fields, RENDERING_FIELDS.DATASOURCE_TEMPLATE)?.value).toEqual({
      kind: "ref-recipe",
      refKey: templateId(SITE, "shared-author@1"),
    });
  });

  it("emits a ref-recipe-list when datasource.templates lists multiple compatible templates", () => {
    const multiTemplate: Recipe = {
      ...layoutRecipe,
      handle: "multi-ds@1",
      name: "multi-ds",
      displayName: "Multi Datasource",
      datasource: {
        templates: [{ handle: "author@1" }, { handle: "avatar@1" }],
      },
    };
    const ir = compileComponentTemplateRecipe(multiTemplate, CONTEXT);
    const op = onlyOp(ir.operations, "CreateItem", (o) => o.id === renderingId(SITE, "multi-ds@1"));
    expect(findField(op.fields, RENDERING_FIELDS.DATASOURCE_TEMPLATE)?.value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [templateId(SITE, "author@1"), templateId(SITE, "avatar@1")],
    });
  });

  // Both halves of dynamicPlaceholders: true — without the base
  // template, Pages chrome has no DynamicPlaceholderID field to write
  // per-placement IDs to, and nested children ship out under the
  // wrong slot key. Regression coverage to keep both writes wired.
  it("params template inherits _IDynamicPlaceholder when dynamicPlaceholders: true", () => {
    const op = onlyOp(
      ir.operations,
      "SetBaseTemplates",
      (o) => o.itemRefKey === designParametersTemplateId(SITE, LAYOUT_HANDLE)
    );
    expect(op.baseTemplates).toEqual([
      ...SXA_HEADLESS_PARAMS_BASE_TEMPLATES,
      IDYNAMIC_PLACEHOLDER_TEMPLATE_ID,
    ]);
  });

  it("rendering item carries IsRenderingsWithDynamicPlaceholders=true in OtherProperties", () => {
    const op = onlyOp(
      ir.operations,
      "CreateItem",
      (o) => o.id === renderingId(SITE, LAYOUT_HANDLE)
    );
    const otherProps = findField(op.fields, RENDERING_FIELDS.OTHER_PROPERTIES);
    expect(otherProps?.value).toEqual({
      kind: "url-string-map",
      entries: { IsRenderingsWithDynamicPlaceholders: "true" },
    });
  });

  // The Placeholders shared field is what SXA reads to enumerate
  // slots on a rendering. Without it the layout service ships no
  // `placeholders` map and the headless SDK warns
  // `Placeholder '<slot>-1' was not found in the current rendering data`.
  // The literal `{*}` token survives into the field value because the
  // SDK's runtime substitution path expects exactly that template
  // form (see `getDynamicPlaceholderPattern` in the Content SDK).
  it("rendering item carries pipe-separated placeholder keys in the Placeholders field", () => {
    const op = onlyOp(
      ir.operations,
      "CreateItem",
      (o) => o.id === renderingId(SITE, LAYOUT_HANDLE)
    );
    expect(findField(op.fields, RENDERING_FIELDS.PLACEHOLDERS)?.value).toEqual({
      kind: "string",
      value: "container-{*}",
    });
  });

  it("joins multiple placeholder keys with a pipe in the Placeholders field", () => {
    const multiSlot: Recipe = {
      ...layoutRecipe,
      handle: "multi-slot@1",
      name: "multi-slot",
      displayName: "Multi Slot",
      placeholders: [
        { key: "header-start-{*}" },
        { key: "header-nav-{*}" },
        { key: "header-end-{*}" },
      ],
    };
    const irMulti = compileComponentTemplateRecipe(multiSlot, CONTEXT);
    const op = onlyOp(
      irMulti.operations,
      "CreateItem",
      (o) => o.id === renderingId(SITE, "multi-slot@1")
    );
    expect(findField(op.fields, RENDERING_FIELDS.PLACEHOLDERS)?.value).toEqual({
      kind: "string",
      value: "header-start-{*}|header-nav-{*}|header-end-{*}",
    });
  });

  it("omits the Placeholders field when the recipe declares no placeholders", () => {
    const noPlaceholders: Recipe = {
      ...layoutRecipe,
      handle: "no-placeholders@1",
      name: "no-placeholders",
      displayName: "No Placeholders",
      dynamicPlaceholders: false,
      placeholders: undefined,
    };
    const irNone = compileComponentTemplateRecipe(noPlaceholders, CONTEXT);
    const op = onlyOp(
      irNone.operations,
      "CreateItem",
      (o) => o.id === renderingId(SITE, "no-placeholders@1")
    );
    expect(findField(op.fields, RENDERING_FIELDS.PLACEHOLDERS)).toBeUndefined();
  });

  it("params template does NOT inherit _IDynamicPlaceholder when dynamicPlaceholders is false/absent", () => {
    const noDynamic: Recipe = {
      ...layoutRecipe,
      handle: "no-dynamic@1",
      name: "no-dynamic",
      displayName: "No Dynamic",
      dynamicPlaceholders: false,
    };
    const irNoDynamic = compileComponentTemplateRecipe(noDynamic, CONTEXT);
    const op = onlyOp(
      irNoDynamic.operations,
      "SetBaseTemplates",
      (o) => o.itemRefKey === designParametersTemplateId(SITE, "no-dynamic@1")
    );
    expect(op.baseTemplates).toEqual([...SXA_HEADLESS_PARAMS_BASE_TEMPLATES]);
    expect(op.baseTemplates).not.toContain(IDYNAMIC_PLACEHOLDER_TEMPLATE_ID);
  });

  // External params-template references are owned by a separate
  // ParametersTemplateRecipe deployment. Mutating its base-template
  // chain from a consuming component would silently affect every other
  // consumer. Reject the combo until the params recipe grows its own
  // dynamicPlaceholder flag (the right home for shared-template config).
  it("throws INPUT_INVALID when dynamicPlaceholders is combined with an external parameters template", () => {
    const externalRef: Recipe = {
      ...layoutRecipe,
      handle: "ext-ref@1",
      name: "ext-ref",
      displayName: "External Ref",
      params: [],
      parameters: { handle: "shared-params@1" },
    };
    expect(() => compileComponentTemplateRecipe(externalRef, CONTEXT)).toThrow(
      /ext-ref@1.*dynamicPlaceholders.*external parameters template/i
    );
  });
});

describe("compileRecipe — front-door dispatcher remaining kinds", () => {
  it("dispatches an enumeration recipe", () => {
    const ir = compileRecipe(
      {
        kind: "enumeration",
        schemaVersion: "1",
        handle: "tone@1",
        name: "Tone",
        values: [{ name: "calm" }, { name: "bold" }],
      },
      CONTEXT
    );
    expect(ir.recipeHandle).toBe("tone@1");
  });

  it("dispatches a workflow recipe", () => {
    const ir = compileRecipe(
      {
        kind: "workflow",
        schemaVersion: "1",
        handle: "editorial@1",
        name: "Editorial",
        displayName: "Editorial Workflow",
        initialState: "draft",
        states: [
          { key: "draft", name: "Draft", displayName: "Draft", final: false },
          { key: "published", name: "Published", displayName: "Published", final: true },
        ],
      },
      CONTEXT
    );
    expect(ir.recipeHandle).toBe("editorial@1");
  });
});
