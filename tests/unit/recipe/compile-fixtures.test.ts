import { describe, expect, it } from "vitest";
import {
  compileComponentTemplateRecipe,
  compileContentTemplateRecipe,
  type CompileContext,
} from "../../../src/recipe/compile";
import {
  fieldId,
  paramsFieldId,
  templateId,
  variantId,
  variantsFolderId,
} from "../../../src/recipe/guids";
import {
  SITECORE_TEMPLATES,
  SYSTEM_FIELDS,
  TEMPLATE_FIELD_FIELDS,
} from "../../../src/recipe/ir/sitecore-templates";
import type { CreateItemOp, Operation, SetFieldOp } from "../../../src/recipe/ir/operations";

import { ctaButtonRecipe } from "../../../example/recipes/cta-button.recipe";
import { badgeBlockRecipe } from "../../../example/recipes/badge-block.recipe";
import { cardBlockRecipe } from "../../../example/recipes/card-block.recipe";
import { richTextBlockRecipe } from "../../../example/recipes/rich-text-block.recipe";
import { accordionItemRecipe } from "../../../example/recipes/accordion-item.recipe";
import { accordionBlockRecipe } from "../../../example/recipes/accordion-block.recipe";
import { avatarBlockRecipe } from "../../../example/recipes/avatar-block.recipe";

const CONTEXT: CompileContext = {
  templatesRoot: "/sitecore/templates/Project/test-site/Components",
  renderingsRoot: "/sitecore/layout/Renderings/Project/test-site",
};

const findField = (op: CreateItemOp, fieldGuid: string) =>
  op.fields.find((f) => f.fieldId === fieldGuid);

const datasourceSectionsIn = (ops: Operation[], handle: string) =>
  ops.filter(
    (op): op is CreateItemOp =>
      op.op === "CreateItem" &&
      op.templateOf === SITECORE_TEMPLATES.TEMPLATE_SECTION &&
      op.parent.kind === "ref-recipe" &&
      op.parent.refKey === templateId(handle)
  );

const variantsIn = (ops: Operation[]) =>
  ops.filter(
    (op): op is CreateItemOp =>
      op.op === "CreateItem" &&
      op.templateOf === SITECORE_TEMPLATES.FOLDER &&
      op.name !== "Variants"
  );

/**
 * Per-fixture op counts. The numbers here are the canonical Phase 1
 * compiler output for each registry recipe — pinning them catches
 * unintended op emission changes (a new field, lost variant, etc.).
 */
describe("compile fixtures — registry recipes round-trip cleanly", () => {
  it("cta-button@1: 1 field, 4 variants, 2 params → 17 ops", () => {
    const ir = compileComponentTemplateRecipe(ctaButtonRecipe, CONTEXT);
    expect(ir.operations).toHaveLength(17);
  });

  it("badge-block@1: 1 field, 5 variants, 2 params → 18 ops", () => {
    const ir = compileComponentTemplateRecipe(badgeBlockRecipe, CONTEXT);
    expect(ir.operations).toHaveLength(18);
    const variants = variantsIn(ir.operations);
    expect(variants.map((v) => v.name)).toEqual([
      "default",
      "bold",
      "outline",
      "rounded",
      "rounded-bold",
    ]);
  });

  it("card-block@1: multi-section + shape→type override → 20 ops", () => {
    const ir = compileComponentTemplateRecipe(cardBlockRecipe, CONTEXT);
    expect(ir.operations).toHaveLength(20);
    const sections = datasourceSectionsIn(ir.operations, ir.recipeHandle);
    expect(sections.map((s) => s.name)).toEqual(["Content", "Media"]);
    // Description overrides text → multi-line-text via sitecore.type
    const description = ir.operations.find(
      (op): op is CreateItemOp => op.op === "CreateItem" && op.name === "Description"
    );
    expect(findField(description!, TEMPLATE_FIELD_FIELDS.TYPE)?.value).toEqual({
      kind: "string",
      value: "Multi-Line Text",
    });
    // Content shape=richText → Rich Text (default mapping). Filter by
    // templateOf to disambiguate from the same-named "Content" section.
    const content = ir.operations.find(
      (op): op is CreateItemOp =>
        op.op === "CreateItem" &&
        op.name === "Content" &&
        op.templateOf === SITECORE_TEMPLATES.TEMPLATE_FIELD
    );
    expect(findField(content!, TEMPLATE_FIELD_FIELDS.TYPE)?.value).toEqual({
      kind: "string",
      value: "Rich Text",
    });
  });

  it("rich-text-block@1: 5 variants, boolean param, 4 params total → 21 ops", () => {
    const ir = compileComponentTemplateRecipe(richTextBlockRecipe, CONTEXT);
    expect(ir.operations).toHaveLength(21);
    const variants = variantsIn(ir.operations);
    expect(variants.map((v) => v.name)).toEqual([
      "default",
      "full-width",
      "prose",
      "page-content",
      "title-only",
    ]);
    // boolean param — UseSectionWrapper → Checkbox
    const useSectionWrapper = ir.operations.find(
      (op): op is CreateItemOp => op.op === "CreateItem" && op.name === "UseSectionWrapper"
    );
    expect(findField(useSectionWrapper!, TEMPLATE_FIELD_FIELDS.TYPE)?.value).toEqual({
      kind: "string",
      value: "Checkbox",
    });
  });

  it("accordion-item@1: ContentTemplateRecipe, 5 fields across 2 sections → 11 ops, no rendering", () => {
    const ir = compileContentTemplateRecipe(accordionItemRecipe, CONTEXT);
    expect(ir.operations).toHaveLength(11);
    expect(
      ir.operations.find(
        (op) => op.op === "CreateItem" && op.templateOf === SITECORE_TEMPLATES.RENDERING
      )
    ).toBeUndefined();
    const sections = datasourceSectionsIn(ir.operations, ir.recipeHandle);
    expect(sections.map((s) => s.name)).toEqual(["Content", "Media"]);
  });

  it("accordion-block@1: Treelist source resolves + insertOptions emits SetField → 19 ops", () => {
    const ir = compileComponentTemplateRecipe(accordionBlockRecipe, CONTEXT);
    expect(ir.operations).toHaveLength(19);

    // The Items field's source references a recipe handle, so the compiler
    // emits ref-source-prefix and the executor renders with captured itemIds.
    const itemsField = ir.operations.find(
      (op): op is CreateItemOp => op.op === "CreateItem" && op.name === "Items"
    );
    expect(findField(itemsField!, TEMPLATE_FIELD_FIELDS.SOURCE)?.value).toEqual({
      kind: "ref-source-prefix",
      raw: "template:accordion-item@1",
    });

    // insertOptions emits a SetField on the standard-values item carrying
    // a ref-recipe-list (resolved at apply time via captured itemIds).
    const insertOps = ir.operations.find(
      (op): op is SetFieldOp => op.op === "SetField" && op.fieldId === SYSTEM_FIELDS.INSERT_OPTIONS
    );
    expect(insertOps).toBeDefined();
    expect(insertOps?.value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [templateId("accordion-item@1")],
    });
  });

  it("avatar-block@1: placeholders parse but Phase 1 emits no placeholder ops → 18 ops", () => {
    const ir = compileComponentTemplateRecipe(avatarBlockRecipe, CONTEXT);
    expect(ir.operations).toHaveLength(18);
    // Phase 4 will add placeholder-settings + AllowedRenderings ops; for now
    // the recipe parses (placeholders is in the schema) but the compiler
    // emits nothing for it.
    expect(
      ir.operations.find((op) => op.op === "CreateItem" && op.name === "avatar-author-content")
    ).toBeUndefined();
  });
});

describe("compile fixtures — cross-recipe deterministic ID linkage", () => {
  it("accordion-block's Items field source carries the accordion-item recipe handle for runtime resolution", () => {
    const ir = compileComponentTemplateRecipe(accordionBlockRecipe, CONTEXT);
    const itemsField = ir.operations.find(
      (op): op is CreateItemOp => op.op === "CreateItem" && op.name === "Items"
    );
    const sourceValue = findField(itemsField!, TEMPLATE_FIELD_FIELDS.SOURCE)?.value;
    if (sourceValue?.kind !== "ref-source-prefix") {
      throw new Error("expected ref-source-prefix");
    }
    expect(sourceValue.raw).toContain("accordion-item@1");
  });

  it("accordion-block's insertOptions refKeys match accordion-item's templateId refKey", () => {
    const ir = compileComponentTemplateRecipe(accordionBlockRecipe, CONTEXT);
    const insertOps = ir.operations.find(
      (op): op is SetFieldOp => op.op === "SetField" && op.fieldId === SYSTEM_FIELDS.INSERT_OPTIONS
    );
    if (insertOps?.value.kind !== "ref-recipe-list") throw new Error("expected ref-recipe-list");
    expect(insertOps.value.refKeys).toEqual([templateId("accordion-item@1")]);
  });
});

describe("compile fixtures — paramsField IDs scope under paramsTemplateId", () => {
  it("rich-text-block params land under the params template, not the datasource template", () => {
    const ir = compileComponentTemplateRecipe(richTextBlockRecipe, CONTEXT);
    const useSectionWrapper = ir.operations.find(
      (op): op is CreateItemOp => op.op === "CreateItem" && op.name === "UseSectionWrapper"
    );
    expect(useSectionWrapper?.id).toBe(paramsFieldId("rich-text-block@1", "UseSectionWrapper"));
    // Sanity: the field id is NOT the datasource-template's fieldId
    expect(useSectionWrapper?.id).not.toBe(fieldId("rich-text-block@1", "UseSectionWrapper"));
  });
});

describe("compile fixtures — variant IDs scope under each rendering's variants folder", () => {
  it("badge-block variants live under badge-block's variants folder", () => {
    const ir = compileComponentTemplateRecipe(badgeBlockRecipe, CONTEXT);
    const folderId = variantsFolderId("badge-block@1");
    const variants = variantsIn(ir.operations);
    for (const v of variants) {
      expect(v.parent).toEqual({ kind: "ref-recipe", refKey: folderId });
      expect(v.id).toBe(variantId("badge-block@1", v.name));
    }
  });
});
