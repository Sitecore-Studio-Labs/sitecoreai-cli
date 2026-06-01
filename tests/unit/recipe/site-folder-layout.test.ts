import { describe, expect, it } from "vitest";
import {
  type CompileContext,
  compileComponentTemplateRecipe,
  compileContentTemplateRecipe,
  compileDesignParametersTemplateRecipe,
  compileRecipeSet,
} from "../../../src/recipe/compile";
import {
  componentFolderStandardValuesId,
  componentFolderTemplateId,
  componentFoldersBucketId,
  contentModelsGroupFolderId,
  designParametersTemplateId,
  presentationDesignParametersBucketId,
  renderingId,
  renderingsSectionFolderId,
  sectionFolderId,
  templateId,
} from "../../../src/recipe/items/guids";
import type { CreateItemOp, Operation, SetFieldOp } from "../../../src/recipe/ir/operations";
import { SITECORE_TEMPLATES } from "../../../src/recipe/ir/sitecore-templates";
import {
  ComponentTemplateRecipeSchema,
  ContentTemplateRecipeSchema,
  DesignParametersTemplateRecipeSchema,
  RecipeSchema,
  type ComponentSectionRecipe,
  type ComponentTemplateRecipe,
} from "../../../src/recipe/schema/recipe";

const SITE = "test-site";
const COMPONENTS_ROOT = `/sitecore/templates/Project/${SITE}/Components`;
const CONTENT_MODELS_ROOT = `/sitecore/templates/Project/${SITE}/Content Models`;
const RENDERINGS_ROOT = `/sitecore/layout/Renderings/Project/${SITE}/Components`;

const UI_SECTION_RECIPE: ComponentSectionRecipe = {
  kind: "component-section",
  schemaVersion: "1",
  handle: "ui-section@1",
  name: "ui",
};

const CONTEXT: CompileContext = {
  templatesRoot: `/sitecore/templates/Project/${SITE}`,
  componentsRoot: COMPONENTS_ROOT,
  contentModelsRoot: CONTENT_MODELS_ROOT,
  renderingsRoot: RENDERINGS_ROOT,
  headlessVariantsRoot: `/sitecore/content/test-tenant/${SITE}/Presentation/Headless Variants`,
  site: SITE,
  sectionsByHandle: new Map([[UI_SECTION_RECIPE.handle, UI_SECTION_RECIPE]]),
};

const findCreates = (ops: Operation[], predicate: (op: CreateItemOp) => boolean): CreateItemOp[] =>
  ops.filter((op): op is CreateItemOp => op.op === "CreateItem" && predicate(op));

const minimalComponentRecipe = (
  overrides: Partial<ComponentTemplateRecipe> = {}
): ComponentTemplateRecipe => ({
  kind: "component-template",
  schemaVersion: "1",
  handle: "accordion-block@1",
  name: "AccordionBlock",
  displayName: "Accordion Block",
  fields: [{ name: "Title", shape: "text" }],
  variants: [],
  params: [],
  ...overrides,
});

describe("ComponentTemplateRecipe schema — new fields", () => {
  it("accepts `section`, `datasource`, `parameters`, `children`", () => {
    const result = ComponentTemplateRecipeSchema.safeParse({
      ...minimalComponentRecipe(),
      section: { handle: "ui-section@1" },
      datasource: { template: { handle: "accordion-content@1" } },
      parameters: { handle: "accordion-params@1" },
      children: { allowedHandles: ["accordion-item@1"] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects `children.allowedHandles` with an empty array", () => {
    const result = ComponentTemplateRecipeSchema.safeParse({
      ...minimalComponentRecipe(),
      children: { allowedHandles: [] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects `datasource.template.handle` not matching the handle pattern", () => {
    const result = ComponentTemplateRecipeSchema.safeParse({
      ...minimalComponentRecipe(),
      datasource: { template: { handle: "not a handle" } },
    });
    expect(result.success).toBe(false);
  });
});

describe("ContentTemplateRecipe schema — meta.tax", () => {
  it("accepts `meta.tax.{group,subgroup,section,tag}`", () => {
    const result = ContentTemplateRecipeSchema.safeParse({
      kind: "content-template",
      schemaVersion: "1",
      handle: "accordion-content@1",
      name: "AccordionContent",
      displayName: "Accordion Content",
      meta: {
        tax: {
          section: "showcase",
          group: "sitecore-blocks",
          subgroup: "ui",
          tag: "Sitecore",
        },
      },
      fields: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("DesignParametersTemplateRecipe schema", () => {
  it("accepts a minimal parameters-template recipe with a section handle ref", () => {
    const result = DesignParametersTemplateRecipeSchema.safeParse({
      kind: "design-parameters-template",
      schemaVersion: "1",
      handle: "accordion-params@1",
      name: "Accordion Parameters",
      displayName: "Accordion Parameters",
      section: { handle: "ui-section@1" },
      params: [{ name: "Variant", shape: "text" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing `section` (required for layout)", () => {
    const result = DesignParametersTemplateRecipeSchema.safeParse({
      kind: "design-parameters-template",
      schemaVersion: "1",
      handle: "accordion-params@1",
      name: "Accordion Parameters",
      displayName: "Accordion Parameters",
      params: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a bare-string `section` (legacy shape)", () => {
    const result = DesignParametersTemplateRecipeSchema.safeParse({
      kind: "design-parameters-template",
      schemaVersion: "1",
      handle: "accordion-params@1",
      name: "Accordion Parameters",
      displayName: "Accordion Parameters",
      section: "ui",
      params: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-conforming `section.handle`", () => {
    const result = DesignParametersTemplateRecipeSchema.safeParse({
      kind: "design-parameters-template",
      schemaVersion: "1",
      handle: "accordion-params@1",
      name: "Accordion Parameters",
      displayName: "Accordion Parameters",
      section: { handle: "no-version" },
      params: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("Recipe discriminated union — parameters-template kind", () => {
  it("RecipeSchema accepts parameters-template", () => {
    expect(
      RecipeSchema.safeParse({
        kind: "design-parameters-template",
        schemaVersion: "1",
        handle: "p@1",
        name: "P",
        displayName: "P",
        section: { handle: "ui-section@1" },
        params: [],
      }).success
    ).toBe(true);
  });
});

describe("Component template path — section-aware emission", () => {
  it("emits the template under <componentsRoot>/<section>/<Component>", () => {
    const ir = compileComponentTemplateRecipe(
      minimalComponentRecipe({ section: { handle: UI_SECTION_RECIPE.handle } }),
      CONTEXT
    );
    const tplOp = findCreates(ir.operations, (op) => op.label === "template:accordion-block@1")[0];
    expect(tplOp.path).toBe(`${COMPONENTS_ROOT}/ui/AccordionBlock`);
  });

  it("falls back to flat layout when no section is set", () => {
    const ir = compileComponentTemplateRecipe(minimalComponentRecipe(), CONTEXT);
    const tplOp = findCreates(ir.operations, (op) => op.label === "template:accordion-block@1")[0];
    expect(tplOp.path).toBe(`${CONTEXT.templatesRoot}/AccordionBlock`);
  });

  it("emits the rendering at <renderingsRoot>/<section>/<Component>", () => {
    const ir = compileComponentTemplateRecipe(
      minimalComponentRecipe({ section: { handle: UI_SECTION_RECIPE.handle } }),
      CONTEXT
    );
    const renderingOp = findCreates(
      ir.operations,
      (op) => op.id === renderingId(SITE, "accordion-block@1")
    )[0];
    expect(renderingOp.path).toBe(`${RENDERINGS_ROOT}/ui/AccordionBlock`);
  });

  it("emits a section folder CreateOnly op once for a (site, section) pair", () => {
    const ir = compileComponentTemplateRecipe(
      minimalComponentRecipe({ section: { handle: UI_SECTION_RECIPE.handle } }),
      CONTEXT
    );
    const sectionFolders = ir.operations.filter(
      (op) => op.op === "CreateItem" && op.id === sectionFolderId(SITE, "ui")
    );
    expect(sectionFolders).toHaveLength(1);
    expect((sectionFolders[0] as CreateItemOp).policy).toBe("CreateOnly");
    expect((sectionFolders[0] as CreateItemOp).path).toBe(`${COMPONENTS_ROOT}/ui`);
    expect((sectionFolders[0] as CreateItemOp).templateOf).toBe(SITECORE_TEMPLATES.TEMPLATE_FOLDER);
  });

  it("emits a renderings-side section folder distinct from the templates-side one", () => {
    const ir = compileComponentTemplateRecipe(
      minimalComponentRecipe({ section: { handle: UI_SECTION_RECIPE.handle } }),
      CONTEXT
    );
    const tplFolderId = sectionFolderId(SITE, "ui");
    const renderingFolderId = renderingsSectionFolderId(SITE, "ui");
    expect(tplFolderId).not.toBe(renderingFolderId);

    const renderingFolder = ir.operations.find(
      (op) => op.op === "CreateItem" && op.id === renderingFolderId
    ) as CreateItemOp | undefined;
    expect(renderingFolder).toBeDefined();
    expect(renderingFolder!.path).toBe(`${RENDERINGS_ROOT}/ui`);
  });
});

describe("Component Folder template — emitted when children: declared", () => {
  it("emits a `<Component> Folder` template at Component Folders/<Component> Folder", () => {
    const recipe = minimalComponentRecipe({
      section: { handle: UI_SECTION_RECIPE.handle },
      children: { allowedHandles: ["accordion-item@1"] },
    });
    const ir = compileComponentTemplateRecipe(recipe, CONTEXT);
    const folderTplOp = ir.operations.find(
      (op) => op.op === "CreateItem" && op.id === componentFolderTemplateId(SITE, recipe.handle)
    ) as CreateItemOp | undefined;
    expect(folderTplOp).toBeDefined();
    expect(folderTplOp!.path).toBe(`${COMPONENTS_ROOT}/ui/Component Folders/AccordionBlock Folder`);
    expect(folderTplOp!.name).toBe("AccordionBlock Folder");
  });

  it("emits a Component Folders bucket folder once per (site, section)", () => {
    const recipe = minimalComponentRecipe({
      section: { handle: UI_SECTION_RECIPE.handle },
      children: { allowedHandles: ["accordion-item@1"] },
    });
    const ir = compileComponentTemplateRecipe(recipe, CONTEXT);
    const bucket = ir.operations.filter(
      (op) => op.op === "CreateItem" && op.id === componentFoldersBucketId(SITE, "ui")
    );
    expect(bucket).toHaveLength(1);
    expect((bucket[0] as CreateItemOp).policy).toBe("CreateOnly");
  });

  it("emits an Insert Options SetField on the folder template's standard values", () => {
    const recipe = minimalComponentRecipe({
      section: { handle: UI_SECTION_RECIPE.handle },
      children: { allowedHandles: ["accordion-item@1", "accordion-divider@1"] },
    });
    const ir = compileComponentTemplateRecipe(recipe, CONTEXT);
    const setField = ir.operations.find(
      (op) =>
        op.op === "SetField" &&
        (op as SetFieldOp).itemRefKey === componentFolderStandardValuesId(SITE, recipe.handle)
    ) as SetFieldOp | undefined;
    expect(setField).toBeDefined();
    expect(setField!.value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [templateId(SITE, "accordion-item@1"), templateId(SITE, "accordion-divider@1")],
    });
  });

  it("does NOT emit a Component Folder template when children is absent", () => {
    const ir = compileComponentTemplateRecipe(
      minimalComponentRecipe({ section: { handle: UI_SECTION_RECIPE.handle } }),
      CONTEXT
    );
    const folderTpl = ir.operations.find(
      (op) =>
        op.op === "CreateItem" && op.id === componentFolderTemplateId(SITE, "accordion-block@1")
    );
    expect(folderTpl).toBeUndefined();
  });
});

describe("Parameters template path — section-aware emission", () => {
  it("places inline-hoisted params at <section>/Presentation Parameters/", () => {
    const recipe = minimalComponentRecipe({
      section: { handle: UI_SECTION_RECIPE.handle },
      params: [{ name: "Variant", shape: "text" }],
    });
    const ir = compileComponentTemplateRecipe(recipe, CONTEXT);
    const paramsTpl = ir.operations.find(
      (op) => op.op === "CreateItem" && op.id === designParametersTemplateId(SITE, recipe.handle)
    ) as CreateItemOp | undefined;
    expect(paramsTpl).toBeDefined();
    expect(paramsTpl!.path).toBe(
      `${COMPONENTS_ROOT}/ui/Presentation Parameters/AccordionBlock Parameters`
    );
  });

  it("emits a Presentation Parameters bucket once per (site, section)", () => {
    const recipe = minimalComponentRecipe({
      section: { handle: UI_SECTION_RECIPE.handle },
      params: [{ name: "Variant", shape: "text" }],
    });
    const ir = compileComponentTemplateRecipe(recipe, CONTEXT);
    const buckets = ir.operations.filter(
      (op) => op.op === "CreateItem" && op.id === presentationDesignParametersBucketId(SITE, "ui")
    );
    expect(buckets).toHaveLength(1);
  });

  it("does NOT synthesise inline params when `parameters: { handle }` is set", () => {
    const recipe = minimalComponentRecipe({
      section: { handle: UI_SECTION_RECIPE.handle },
      parameters: { handle: "shared-params@1" },
    });
    const ir = compileComponentTemplateRecipe(recipe, CONTEXT);
    // The recipe's own designParametersTemplateId should NOT be emitted — the
    // rendering points at the external one instead.
    const ownParams = ir.operations.find(
      (op) => op.op === "CreateItem" && op.id === designParametersTemplateId(SITE, recipe.handle)
    );
    expect(ownParams).toBeUndefined();
  });

  it("rendering's Parameters Template field points at the external `parameters.handle` when set", () => {
    const recipe = minimalComponentRecipe({
      section: { handle: UI_SECTION_RECIPE.handle },
      parameters: { handle: "shared-params@1" },
    });
    const ir = compileComponentTemplateRecipe(recipe, CONTEXT);
    const renderingOp = ir.operations.find(
      (op) => op.op === "CreateItem" && op.id === renderingId(SITE, recipe.handle)
    ) as CreateItemOp | undefined;
    expect(renderingOp).toBeDefined();
    const paramsField = renderingOp!.fields.find(
      (f) => f.fieldId === "a77e8568-1ab3-44f1-a664-b7c37ec7810d"
    );
    expect(paramsField?.value).toEqual({
      kind: "ref-recipe",
      refKey: designParametersTemplateId(SITE, "shared-params@1"),
    });
  });

  it("rejects setting both `parameters` (ref) and inline `params` on the same recipe", () => {
    expect(() =>
      ComponentTemplateRecipeSchema.parse(
        minimalComponentRecipe({
          section: { handle: UI_SECTION_RECIPE.handle },
          params: [{ name: "Variant", shape: "text" }],
          parameters: { handle: "shared-params@1" },
        })
      )
    ).toThrow(/Set either `parameters`/);
  });
});

describe("Standalone DesignParametersTemplateRecipe compile", () => {
  it("emits at <componentsRoot>/<section>/Presentation Parameters/<name>", () => {
    const ir = compileDesignParametersTemplateRecipe(
      {
        kind: "design-parameters-template",
        schemaVersion: "1",
        handle: "shared-params@1",
        name: "SharedParams",
        displayName: "Shared Params",
        section: { handle: UI_SECTION_RECIPE.handle },
        params: [{ name: "Mode", shape: "text" }],
      },
      CONTEXT
    );
    const tplOp = ir.operations.find(
      (op) =>
        op.op === "CreateItem" && op.id === designParametersTemplateId(SITE, "shared-params@1")
    ) as CreateItemOp | undefined;
    expect(tplOp).toBeDefined();
    expect(tplOp!.path).toBe(`${COMPONENTS_ROOT}/ui/Presentation Parameters/SharedParams`);
  });
});

describe("ContentTemplateRecipe — group-based path emission", () => {
  it("places the template under <contentModelsRoot>/<group>/<name> when group is set", () => {
    const ir = compileContentTemplateRecipe(
      {
        kind: "content-template",
        schemaVersion: "1",
        handle: "accordion-content@1",
        name: "AccordionContent",
        displayName: "Accordion Content",
        meta: { tax: { group: "sitecore-blocks" } },
        fields: [{ name: "Title", shape: "text" }],
      },
      CONTEXT
    );
    const tplOp = ir.operations.find(
      (op) => op.op === "CreateItem" && op.id === templateId(SITE, "accordion-content@1")
    ) as CreateItemOp | undefined;
    expect(tplOp!.path).toBe(`${CONTENT_MODELS_ROOT}/sitecore-blocks/AccordionContent`);
  });

  it("places the template flat when group is absent", () => {
    const ir = compileContentTemplateRecipe(
      {
        kind: "content-template",
        schemaVersion: "1",
        handle: "loose-content@1",
        name: "LooseContent",
        displayName: "Loose Content",
        fields: [{ name: "Title", shape: "text" }],
      },
      CONTEXT
    );
    const tplOp = ir.operations.find(
      (op) => op.op === "CreateItem" && op.id === templateId(SITE, "loose-content@1")
    ) as CreateItemOp | undefined;
    expect(tplOp!.path).toBe(`${CONTENT_MODELS_ROOT}/LooseContent`);
  });

  it("emits a CreateOnly group folder once per (site, group)", () => {
    const ir = compileContentTemplateRecipe(
      {
        kind: "content-template",
        schemaVersion: "1",
        handle: "accordion-content@1",
        name: "AccordionContent",
        displayName: "Accordion Content",
        meta: { tax: { group: "sitecore-blocks" } },
        fields: [],
      },
      CONTEXT
    );
    const groupFolders = ir.operations.filter(
      (op) =>
        op.op === "CreateItem" && op.id === contentModelsGroupFolderId(SITE, "sitecore-blocks")
    );
    expect(groupFolders).toHaveLength(1);
    expect((groupFolders[0] as CreateItemOp).policy).toBe("CreateOnly");
  });
});

describe("compileRecipeSet — folder dedup across recipes in the same section", () => {
  it("emits each section / Component Folders / Presentation Parameters bucket once per set", () => {
    const irs = compileRecipeSet(
      [
        UI_SECTION_RECIPE,
        minimalComponentRecipe({
          handle: "accordion-block@1",
          name: "AccordionBlock",
          section: { handle: UI_SECTION_RECIPE.handle },
          children: { allowedHandles: ["accordion-item@1"] },
          params: [{ name: "Mode", shape: "text" }],
        }),
        minimalComponentRecipe({
          handle: "tabs-block@1",
          name: "TabsBlock",
          section: { handle: UI_SECTION_RECIPE.handle },
          children: { allowedHandles: ["tab-item@1"] },
          params: [{ name: "Mode", shape: "text" }],
        }),
      ],
      CONTEXT
    );

    const allOps = irs.flatMap((ir) => ir.operations);

    // One section folder for ui, one Component Folders bucket, one
    // Presentation Parameters bucket — even though two recipes touch them.
    const sectionFolders = allOps.filter(
      (op) => op.op === "CreateItem" && op.id === sectionFolderId(SITE, "ui")
    );
    expect(sectionFolders).toHaveLength(1);

    const componentFoldersBucket = allOps.filter(
      (op) => op.op === "CreateItem" && op.id === componentFoldersBucketId(SITE, "ui")
    );
    expect(componentFoldersBucket).toHaveLength(1);

    const presentationParamsBucket = allOps.filter(
      (op) => op.op === "CreateItem" && op.id === presentationDesignParametersBucketId(SITE, "ui")
    );
    expect(presentationParamsBucket).toHaveLength(1);
  });
});

describe("Deterministic GUID extensions", () => {
  it("sectionFolderId(site, section) is stable", () => {
    const a = sectionFolderId(SITE, "ui");
    const b = sectionFolderId(SITE, "ui");
    expect(a).toBe(b);
  });

  it("componentFolderTemplateId(handle) is stable and distinct from templateId(handle)", () => {
    expect(componentFolderTemplateId(SITE, "accordion-block@1")).not.toBe(
      templateId(SITE, "accordion-block@1")
    );
    expect(componentFolderTemplateId(SITE, "accordion-block@1")).toBe(
      componentFolderTemplateId(SITE, "accordion-block@1")
    );
  });

  it("renderingsSectionFolderId(site, section) differs from sectionFolderId", () => {
    expect(renderingsSectionFolderId(SITE, "ui")).not.toBe(sectionFolderId(SITE, "ui"));
  });
});
