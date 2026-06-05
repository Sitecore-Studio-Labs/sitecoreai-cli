import { describe, expect, it } from "vitest";
import {
  type CompileContext,
  compileRecipe,
  compileVariantRecipe,
} from "../../../src/recipe/compile";
import { variantId, variantsFolderId } from "../../../src/recipe/items/guids";
import { SITECORE_TEMPLATES } from "../../../src/recipe/ir/sitecore-templates";
import type { CreateItemOp, Operation } from "../../../src/recipe/ir/operations";
import type { VariantRecipe } from "../../../src/recipe/schema/recipe";

/**
 * Tests for `compileVariantRecipe` — brand-scoped sidecar variant
 * compilation. The compiler emits exactly two writes (the per-rendering
 * Headless Variants folder + the VARIANT_DEFINITION item) and never
 * touches the canonical rendering.
 */

const HEADLESS_VARIANTS_ROOT = "/sitecore/content/Demo/Site/Presentation/Headless Variants";

const CONTEXT: CompileContext = {
  templatesRoot: "/sitecore/templates/Project/Demo",
  renderingsRoot: "/sitecore/layout/Renderings/Project/Demo",
  headlessVariantsRoot: HEADLESS_VARIANTS_ROOT,
};

const SITE = "default";

const findOps = (ops: Operation[]): CreateItemOp[] =>
  ops.filter((op): op is CreateItemOp => op.op === "CreateItem");

const buildRecipe = (overrides: Partial<VariantRecipe> = {}): VariantRecipe => ({
  kind: "variant",
  schemaVersion: "1",
  handle: "hero-allstate-skinny@1",
  targetRendering: { handle: "hero@1", name: "hero" },
  name: "AllstateSkinny",
  content: "export function AllstateSkinny() { return null; }",
  ...overrides,
});

describe("compileVariantRecipe — IR shape", () => {
  it("emits exactly two CreateItem ops: folder + variant", () => {
    const ir = compileVariantRecipe(buildRecipe(), CONTEXT);
    const creates = findOps(ir.operations);
    expect(ir.recipeHandle).toBe("hero-allstate-skinny@1");
    expect(creates).toHaveLength(2);
    expect(ir.operations.every((op) => op.op === "CreateItem")).toBe(true);
  });

  it("folder lands directly under headlessVariantsRoot — no section grouping intermediate", () => {
    const ir = compileVariantRecipe(buildRecipe(), CONTEXT);
    const [folder] = findOps(ir.operations);
    expect(folder.path).toBe(`${HEADLESS_VARIANTS_ROOT}/hero`);
    expect(folder.parent).toEqual({
      kind: "ref-path",
      value: HEADLESS_VARIANTS_ROOT,
    });
    expect(folder.templateOf).toBe(SITECORE_TEMPLATES.HEADLESS_VARIANTS);
    expect(folder.name).toBe("hero");
    expect(folder.id).toBe(variantsFolderId(SITE, "hero@1"));
  });

  it("variant item lands under the folder with VARIANT_DEFINITION template", () => {
    const ir = compileVariantRecipe(buildRecipe(), CONTEXT);
    const [folder, variant] = findOps(ir.operations);
    expect(variant.path).toBe(`${HEADLESS_VARIANTS_ROOT}/hero/AllstateSkinny`);
    expect(variant.parent).toEqual({
      kind: "ref-recipe",
      refKey: folder.id,
    });
    expect(variant.templateOf).toBe(SITECORE_TEMPLATES.VARIANT_DEFINITION);
    expect(variant.name).toBe("AllstateSkinny");
    expect(variant.id).toBe(variantId(SITE, "hero@1", "AllstateSkinny"));
  });

  it("DISPLAY_NAME field defaults to `name` when displayName is omitted", () => {
    const ir = compileVariantRecipe(buildRecipe(), CONTEXT);
    const [, variant] = findOps(ir.operations);
    expect(variant.fields).toHaveLength(1);
    expect(variant.fields[0]!.value).toEqual({
      kind: "string",
      value: "AllstateSkinny",
    });
  });

  it("DISPLAY_NAME uses displayName when provided", () => {
    const ir = compileVariantRecipe(
      buildRecipe({ displayName: "Allstate — Skinny Hero" }),
      CONTEXT
    );
    const [, variant] = findOps(ir.operations);
    expect(variant.fields[0]!.value).toEqual({
      kind: "string",
      value: "Allstate — Skinny Hero",
    });
  });

  it("variant id is deterministic across compiles (same site + canonical + name)", () => {
    const ir1 = compileVariantRecipe(buildRecipe(), CONTEXT);
    const ir2 = compileVariantRecipe(buildRecipe(), CONTEXT);
    expect(ir1.operations[1]!).toMatchObject({ id: (ir2.operations[1] as CreateItemOp).id });
  });

  it("two variants of the same canonical share the per-rendering folder id", () => {
    const irA = compileVariantRecipe(
      buildRecipe({ handle: "hero-a@1", name: "VariantA" }),
      CONTEXT
    );
    const irB = compileVariantRecipe(
      buildRecipe({ handle: "hero-b@1", name: "VariantB" }),
      CONTEXT
    );
    expect((irA.operations[0] as CreateItemOp).id).toBe((irB.operations[0] as CreateItemOp).id);
  });

  it("throws INPUT_INVALID when headlessVariantsRoot is not configured", () => {
    const ctxWithoutRoot: CompileContext = {
      templatesRoot: CONTEXT.templatesRoot,
      renderingsRoot: CONTEXT.renderingsRoot,
    };
    expect(() => compileVariantRecipe(buildRecipe(), ctxWithoutRoot)).toThrow(
      /headlessVariantsRoot/
    );
  });

  it("`content` field is carried through schema parse but not emitted as a Sitecore op", () => {
    const ir = compileVariantRecipe(
      buildRecipe({ content: "export function AllstateSkinny() { return <div /> }" }),
      CONTEXT
    );
    // No operation references the TSX content — that's the install
    // descriptor / head-repo file-drop pipeline's job, not scai's.
    for (const op of ir.operations) {
      expect(JSON.stringify(op)).not.toContain("function AllstateSkinny");
    }
  });

  it("dispatches through the public compileRecipe entry point", () => {
    const ir = compileRecipe(buildRecipe(), CONTEXT);
    expect(findOps(ir.operations)).toHaveLength(2);
  });

  it("rejects non-PascalCase variant names at the schema layer", () => {
    expect(() =>
      compileVariantRecipe(buildRecipe({ name: "not-pascal" } as never), CONTEXT)
    ).toThrow();
  });
});
