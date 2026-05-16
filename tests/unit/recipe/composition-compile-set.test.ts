import { describe, expect, it } from "vitest";
import { articleDesignRecipe } from "../../../example/recipes/article-design.recipe";
import { defaultPageDesignRecipe } from "../../../example/recipes/default-page-design.recipe";
import { landingDesignRecipe } from "../../../example/recipes/landing-design.recipe";
import { standardFooterRecipe } from "../../../example/recipes/standard-footer.recipe";
import { standardHeaderRecipe } from "../../../example/recipes/standard-header.recipe";
import { ctaButtonRecipe } from "../../../example/recipes/cta-button.recipe";
import {
  type CompileContext,
  compileRecipeSet,
  TEMPLATES_MAPPING_AGGREGATE_HANDLE,
} from "../../../src/recipe/compile";
import { PAGE_DESIGNS_ROOT_REF_KEY, pageDesignId, templateId } from "../../../src/recipe/guids";
import type { OperationIr, SetFieldOp } from "../../../src/recipe/ir/operations";
import { COMPOSITION_FIELDS } from "../../../src/recipe/ir/sitecore-templates";

const CONTEXT: CompileContext = {
  templatesRoot: "/sitecore/templates/Project/Demo/Components",
  renderingsRoot: "/sitecore/layout/Renderings/Project/Demo",
  partialDesignsRoot: "/sitecore/content/Demo/Presentation/Partial Designs",
  pageDesignsRoot: "/sitecore/content/Demo/Presentation/Page Designs",
  headlessVariantsRoot: "/sitecore/content/test-tenant/Demo/Presentation/Headless Variants",
  enumerationsRoot: "/sitecore/content/test-tenant/Demo/Settings/Enumerations",
};

const SITE = "default";

const findAggregate = (irs: OperationIr[]): OperationIr | undefined =>
  irs.find((ir) => ir.recipeHandle === TEMPLATES_MAPPING_AGGREGATE_HANDLE);

const aggregateOp = (ir: OperationIr): SetFieldOp => {
  expect(ir.operations).toHaveLength(1);
  const op = ir.operations[0];
  expect(op.op).toBe("SetField");
  return op as SetFieldOp;
};

describe("compileRecipeSet — basic shape", () => {
  it("returns one IR per input recipe when no page designs are present", () => {
    const irs = compileRecipeSet([standardHeaderRecipe, standardFooterRecipe], CONTEXT);
    expect(irs).toHaveLength(2);
    expect(irs.map((ir) => ir.recipeHandle)).toEqual(["standard-header@1", "standard-footer@1"]);
    expect(findAggregate(irs)).toBeUndefined();
  });

  it("does not emit an aggregate IR for page designs that declare empty appliesTo", () => {
    const irs = compileRecipeSet(
      [
        // Strip appliesTo so the page design contributes nothing to the
        // mapping — covered by the type via spread.
        { ...defaultPageDesignRecipe, appliesTo: [] },
      ],
      CONTEXT
    );
    expect(irs).toHaveLength(1);
    expect(findAggregate(irs)).toBeUndefined();
  });

  it("preserves input recipe order in the per-recipe IRs", () => {
    const irs = compileRecipeSet(
      [ctaButtonRecipe, standardHeaderRecipe, defaultPageDesignRecipe],
      CONTEXT
    );
    // Per-recipe IRs come first, in input order; aggregate (if any) is last.
    expect(irs.slice(0, 3).map((ir) => ir.recipeHandle)).toEqual([
      "cta-button@1",
      "standard-header@1",
      "default-page-design@1",
    ]);
  });
});

describe("compileRecipeSet — TemplatesMapping aggregate", () => {
  it("emits a single aggregate IR after all per-recipe IRs", () => {
    const irs = compileRecipeSet(
      [defaultPageDesignRecipe, landingDesignRecipe, articleDesignRecipe],
      CONTEXT
    );
    expect(irs).toHaveLength(4);
    expect(irs[3].recipeHandle).toBe(TEMPLATES_MAPPING_AGGREGATE_HANDLE);
  });

  it("aggregate IR carries one SetField op targeting the page-designs-root refKey", () => {
    const irs = compileRecipeSet([defaultPageDesignRecipe], CONTEXT);
    const aggregate = findAggregate(irs)!;
    const op = aggregateOp(aggregate);
    expect(op.itemRefKey).toBe(PAGE_DESIGNS_ROOT_REF_KEY);
    expect(op.fieldId).toBe(COMPOSITION_FIELDS.TEMPLATES_MAPPING);
    expect(op.policy).toBe("CreateAndUpdate");
  });

  it("encoded value carries every (template → design) pair from every page design", () => {
    const irs = compileRecipeSet(
      [defaultPageDesignRecipe, landingDesignRecipe, articleDesignRecipe],
      CONTEXT
    );
    const op = aggregateOp(findAggregate(irs)!);
    if (op.value.kind !== "string") throw new Error("aggregate must be kind: 'string'");
    const value = op.value.value;
    for (const [tplHandle, designHandle] of [
      ["home-page@1", "default-page-design@1"],
      ["landing-page@1", "landing-design@1"],
      ["article-page@1", "article-design@1"],
    ] as const) {
      expect(value).toContain(encodeURIComponent(`{${templateId(SITE, tplHandle).toUpperCase()}}`));
      expect(value).toContain(
        encodeURIComponent(`{${pageDesignId(SITE, designHandle).toUpperCase()}}`)
      );
    }
  });

  it("entry order is deterministic — sorting by templateGuid means recipe input order does not affect the output", () => {
    const ordered = compileRecipeSet(
      [defaultPageDesignRecipe, landingDesignRecipe, articleDesignRecipe],
      CONTEXT
    );
    const reversed = compileRecipeSet(
      [articleDesignRecipe, landingDesignRecipe, defaultPageDesignRecipe],
      CONTEXT
    );
    const a = aggregateOp(findAggregate(ordered)!);
    const b = aggregateOp(findAggregate(reversed)!);
    expect(a.value).toEqual(b.value);
  });
});
