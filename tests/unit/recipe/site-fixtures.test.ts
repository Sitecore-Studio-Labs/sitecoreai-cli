import { describe, expect, it } from "vitest";
import { alarisRecipe } from "../../../example/recipes/alaris.recipe";
import { cclBrandTemplateRecipe } from "../../../example/recipes/ccl-brand-template.recipe";
import { solterraCoRecipe } from "../../../example/recipes/solterra-co.recipe";
import {
  type CompileContext,
  compileRecipe,
  compileSiteTemplateRecipe,
} from "../../../src/recipe/compile";
import { templateId } from "../../../src/recipe/items/guids";
import type { CreateItemOp, SetFieldOp } from "../../../src/recipe/ir/operations";
import {
  SITECORE_TEMPLATES,
  SITE_TEMPLATE_FIELDS,
  SYSTEM_FIELDS,
} from "../../../src/recipe/ir/sitecore-templates";
import {
  RecipeSchema,
  SiteRecipeSchema,
  SiteTemplateRecipeSchema,
} from "../../../src/recipe/schema/recipe";

/**
 * Smoke parses for the SiteTemplate + SiteRecipe worked examples.
 *
 * The `satisfies` annotation in each fixture catches type-shape
 * regressions at compile time; these tests catch RUNTIME parse
 * regressions (e.g. a refine landing on the schema later that
 * makes existing fixtures invalid).
 */

describe("ccl-brand-template@1 worked example", () => {
  it("parses against SiteTemplateRecipeSchema", () => {
    const result = SiteTemplateRecipeSchema.safeParse(cclBrandTemplateRecipe);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.handle).toBe("ccl-brand-template@1");
      expect(result.data.pageTemplates).toHaveLength(5);
      expect(result.data.pageDesigns).toHaveLength(3);
      expect(Object.keys(result.data.insertOptionsMatrix ?? {})).toHaveLength(5);
      expect(Object.keys(result.data.templatesToDesigns ?? {})).toHaveLength(4);
      expect(result.data.dictionary).toHaveLength(6);
      expect(result.data.taxonomy).toHaveLength(2);
    }
  });

  it("dispatches via the Recipe discriminated union", () => {
    const result = RecipeSchema.safeParse(cclBrandTemplateRecipe);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe("site-template");
    }
  });

  it("templatesToDesigns values reference handles in pageDesigns", () => {
    const designs = new Set(cclBrandTemplateRecipe.pageDesigns);
    for (const designHandle of Object.values(cclBrandTemplateRecipe.templatesToDesigns ?? {})) {
      expect(designs.has(designHandle)).toBe(true);
    }
  });

  it("insertOptionsMatrix values reference handles in pageTemplates", () => {
    const templates = new Set(cclBrandTemplateRecipe.pageTemplates);
    for (const allowed of Object.values(cclBrandTemplateRecipe.insertOptionsMatrix ?? {})) {
      for (const child of allowed) {
        expect(templates.has(child)).toBe(true);
      }
    }
  });
});

describe("solterra-co@1 worked example", () => {
  it("parses against SiteRecipeSchema", () => {
    const result = SiteRecipeSchema.safeParse(solterraCoRecipe);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.handle).toBe("solterra-co@1");
      expect(result.data.siteTemplate).toBe("ccl-brand-template@1");
      expect(result.data.collectionName).toBe("Click Click Launch");
      expect(result.data.collectionId).toBeUndefined();
      expect(result.data.dictionaryOverrides?.ContactUs).toBe("Get in touch with Solterra");
    }
  });

  it("dispatches via the Recipe discriminated union", () => {
    const result = RecipeSchema.safeParse(solterraCoRecipe);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe("site");
    }
  });
});

describe("alaris@1 worked example", () => {
  it("parses against SiteRecipeSchema", () => {
    const result = SiteRecipeSchema.safeParse(alarisRecipe);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.handle).toBe("alaris@1");
      expect(result.data.siteTemplate).toBe("ccl-brand-template@1");
      expect(result.data.collectionId).toBeDefined();
      expect(result.data.collectionName).toBeUndefined();
    }
  });

  it("references the same SiteTemplate as solterra-co (multi-brand pattern)", () => {
    expect(alarisRecipe.siteTemplate).toBe(solterraCoRecipe.siteTemplate);
    expect(alarisRecipe.handle).not.toBe(solterraCoRecipe.handle);
  });
});

// ---------------------------------------------------------------------------
// Phase 5 Milestone C: compileSiteTemplateRecipe smoke tests.
//
// The compiler emits the SiteTemplate item shell (CreateItem + system
// fields). Structural-metadata SetField ops (page templates list,
// designs list, insert-options matrix, templates-to-designs, dictionary,
// taxonomy) are deferred to Milestone C-extra pending sandbox
// introspection of the SXA SiteTemplate field GUIDs.
// ---------------------------------------------------------------------------

const COMPILE_CONTEXT: CompileContext = {
  templatesRoot: "/sitecore/templates/Project/Demo/Components",
  renderingsRoot: "/sitecore/layout/Renderings/Project/Demo",
  siteTemplatesRoot: "/sitecore/templates/Project/Demo",
};

const SITE = "default";

const findSet = (ir: ReturnType<typeof compileSiteTemplateRecipe>, label: string): SetFieldOp =>
  ir.operations.find((op): op is SetFieldOp => op.op === "SetField" && op.label === label)!;

describe("compileSiteTemplateRecipe", () => {
  it("emits CreateItem + SetField ops for the SXA Solution-template fields", () => {
    const ir = compileSiteTemplateRecipe(cclBrandTemplateRecipe, COMPILE_CONTEXT);
    expect(ir.recipeHandle).toBe("ccl-brand-template@1");
    // CreateItem + Name + Description + Enabled + Built-in template = 5
    expect(ir.operations).toHaveLength(5);
    expect(ir.operations[0].op).toBe("CreateItem");
    expect(ir.operations.filter((op) => op.op === "SetField")).toHaveLength(4);
  });

  it("CreateItem identity uses templateId(handle) — site templates are regular template items", () => {
    const ir = compileSiteTemplateRecipe(cclBrandTemplateRecipe, COMPILE_CONTEXT);
    const create = ir.operations[0] as CreateItemOp;
    expect(create.id).toBe(templateId(SITE, "ccl-brand-template@1"));
  });

  it("CreateItem lands under siteTemplatesRoot at <root>/<recipe.name>", () => {
    const ir = compileSiteTemplateRecipe(cclBrandTemplateRecipe, COMPILE_CONTEXT);
    const create = ir.operations[0] as CreateItemOp;
    expect(create.path).toBe("/sitecore/templates/Project/Demo/ClickClickLaunchBrand");
    expect(create.parent).toEqual({
      kind: "ref-path",
      value: "/sitecore/templates/Project/Demo",
    });
  });

  it("CreateItem templateOf is the SXA Solution template GUID (sandbox-verified)", () => {
    const ir = compileSiteTemplateRecipe(cclBrandTemplateRecipe, COMPILE_CONTEXT);
    const create = ir.operations[0] as CreateItemOp;
    expect(create.templateOf).toBe(SITECORE_TEMPLATES.SITE_TEMPLATE);
    // The actual GUID — same one verified via introspection 2026-05-01.
    expect(create.templateOf).toBe("1b2dfd3b-f2f2-4f40-a75c-f6c2490919c4");
  });

  it("CreateItem carries DisplayName + Icon as initial fields", () => {
    const ir = compileSiteTemplateRecipe(cclBrandTemplateRecipe, COMPILE_CONTEXT);
    const create = ir.operations[0] as CreateItemOp;
    const display = create.fields.find((f) => f.fieldId === SYSTEM_FIELDS.DISPLAY_NAME);
    expect(display?.value).toEqual({
      kind: "string",
      value: "Click Click Launch Brand Template",
    });
  });

  it("emits SetField on Solution-template's `Name` field with the recipe's displayName", () => {
    const ir = compileSiteTemplateRecipe(cclBrandTemplateRecipe, COMPILE_CONTEXT);
    const nameOp = findSet(ir, "site-template-name:ccl-brand-template@1");
    expect(nameOp.fieldId).toBe(SITE_TEMPLATE_FIELDS.NAME);
    expect(nameOp.value).toEqual({
      kind: "string",
      value: "Click Click Launch Brand Template",
    });
  });

  it("emits SetField on Description when recipe.description is set", () => {
    const ir = compileSiteTemplateRecipe(cclBrandTemplateRecipe, COMPILE_CONTEXT);
    const descOp = findSet(ir, "site-template-description:ccl-brand-template@1");
    expect(descOp.fieldId).toBe(SITE_TEMPLATE_FIELDS.DESCRIPTION);
    expect(descOp.value.kind).toBe("string");
  });

  it("omits the Description SetField when recipe.description is unset", () => {
    const { description: _omit, ...withoutDesc } = cclBrandTemplateRecipe;
    void _omit;
    const ir = compileSiteTemplateRecipe(withoutDesc, COMPILE_CONTEXT);
    const descOp = ir.operations.find(
      (op) => op.op === "SetField" && op.label.startsWith("site-template-description:")
    );
    expect(descOp).toBeUndefined();
  });

  it("marks the template as Enabled='1' and Built-in='0' (recipe-authored, not SXA-shipped)", () => {
    const ir = compileSiteTemplateRecipe(cclBrandTemplateRecipe, COMPILE_CONTEXT);
    const enabledOp = findSet(ir, "site-template-enabled:ccl-brand-template@1");
    expect(enabledOp.fieldId).toBe(SITE_TEMPLATE_FIELDS.ENABLED);
    expect(enabledOp.value).toEqual({ kind: "string", value: "1" });

    const builtinOp = findSet(ir, "site-template-builtin:ccl-brand-template@1");
    expect(builtinOp.fieldId).toBe(SITE_TEMPLATE_FIELDS.BUILT_IN_TEMPLATE);
    expect(builtinOp.value).toEqual({ kind: "string", value: "0" });
  });

  it("throws a clear error when siteTemplatesRoot is missing", () => {
    expect(() =>
      compileSiteTemplateRecipe(cclBrandTemplateRecipe, {
        templatesRoot: COMPILE_CONTEXT.templatesRoot,
        renderingsRoot: COMPILE_CONTEXT.renderingsRoot,
      })
    ).toThrow(/siteTemplatesRoot/);
  });

  it("compileRecipe dispatcher routes site-template kind to compileSiteTemplateRecipe", () => {
    const ir = compileRecipe(cclBrandTemplateRecipe, COMPILE_CONTEXT);
    expect(ir.recipeHandle).toBe("ccl-brand-template@1");
    expect(ir.operations[0].op).toBe("CreateItem");
  });

  it("compileRecipe dispatcher routes kind: site through compileSiteRecipe (Milestone E)", () => {
    const ir = compileRecipe(solterraCoRecipe, COMPILE_CONTEXT);
    expect(ir.recipeHandle).toBe(solterraCoRecipe.handle);
    // Phase 5 Milestone E v2: a SiteRecipe compiles to exactly one
    // CreateSiteFromTemplate op followed by N SetField ops (one per
    // dictionary override). Taxonomy emission is still deferred to v3.
    expect(ir.operations[0].op).toBe("CreateSiteFromTemplate");
  });
});
