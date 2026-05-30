/**
 * Branch coverage for `src/recipe/compile/shared.ts` — the path
 * resolvers, folder-ensure helpers, field-op builder, and
 * standard-values default encoder shared by the per-kind compilers.
 *
 * Pure-function tests: build fixture `CompileContext` / `FieldDefinition`
 * inputs and assert the emitted `Operation[]` / `FieldValue[]` shapes,
 * or the thrown error's `.code`. No network, no compiler pipeline.
 */
import { describe, expect, it } from "vitest";
import {
  type CompileContext,
  buildFieldOp,
  buildStandardValuesFieldEntries,
  ensureComponentFoldersBucket,
  ensureContentModelsGroupFolder,
  ensurePageTemplatesGroupFolder,
  ensurePresentationDesignParametersBucket,
  ensureSectionFolder,
  joinPath,
  resolveComponentTemplateParent,
  resolveEnumFolderPath,
  resolvePresentationDesignParametersBucketPath,
  resolveRenderingParent,
  siteOf,
} from "../../../src/recipe/compile/shared";
import type { CreateItemOp, Operation } from "../../../src/recipe/ir/operations";
import type { EnumerationRecipe, FieldDefinition } from "../../../src/recipe/schema/recipe";

const baseContext: CompileContext = {
  templatesRoot: "/sitecore/templates/Project/site",
  renderingsRoot: "/sitecore/layout/Renderings/Project/site",
};

const field = (overrides: Partial<FieldDefinition>): FieldDefinition =>
  ({ name: "Field", shape: "text", ...overrides }) as FieldDefinition;

describe("joinPath", () => {
  it("joins a parent + child with a single slash", () => {
    expect(joinPath("/a/b", "c")).toBe("/a/b/c");
  });

  it("collapses a trailing slash on the parent", () => {
    expect(joinPath("/a/b/", "c")).toBe("/a/b/c");
  });
});

describe("siteOf", () => {
  it("returns the configured site name", () => {
    expect(siteOf({ ...baseContext, site: "solterra" })).toBe("solterra");
  });

  it("falls back to 'default' when no site is set", () => {
    expect(siteOf(baseContext)).toBe("default");
  });
});

describe("resolveComponentTemplateParent", () => {
  it("nests under componentsRoot/<section> when both are present", () => {
    const ctx = { ...baseContext, componentsRoot: "/cr" };
    expect(resolveComponentTemplateParent(ctx, "ui")).toBe("/cr/ui");
  });

  it("falls back to templatesRoot/<section> when componentsRoot is unset", () => {
    expect(resolveComponentTemplateParent(baseContext, "ui")).toBe(
      "/sitecore/templates/Project/site/ui"
    );
  });

  it("returns templatesRoot flat when no section is given", () => {
    expect(resolveComponentTemplateParent(baseContext, undefined)).toBe(
      "/sitecore/templates/Project/site"
    );
  });
});

describe("resolvePresentationDesignParametersBucketPath", () => {
  it("returns templatesRoot directly for a section-less recipe", () => {
    expect(resolvePresentationDesignParametersBucketPath(baseContext, undefined)).toBe(
      "/sitecore/templates/Project/site"
    );
  });

  it("nests the bucket under the section root when a section is given", () => {
    const ctx = { ...baseContext, componentsRoot: "/cr" };
    expect(resolvePresentationDesignParametersBucketPath(ctx, "ui")).toBe(
      "/cr/ui/Presentation Parameters"
    );
  });
});

describe("resolveRenderingParent", () => {
  it("nests under renderingsRoot/<section> with a section", () => {
    expect(resolveRenderingParent(baseContext, "ui")).toBe(
      "/sitecore/layout/Renderings/Project/site/ui"
    );
  });

  it("returns the flat renderingsRoot without a section", () => {
    expect(resolveRenderingParent(baseContext, undefined)).toBe(
      "/sitecore/layout/Renderings/Project/site"
    );
  });
});

describe("resolveEnumFolderPath", () => {
  const enumRecipe = (folder?: string | string[]): EnumerationRecipe =>
    ({
      kind: "enumeration",
      schemaVersion: "1",
      handle: "color@1",
      name: "Color",
      values: [{ name: "red" }],
      ...(folder
        ? {
            location: {
              scope: "site",
              folder: Array.isArray(folder) ? folder : folder.split("/"),
            },
          }
        : {}),
    }) as EnumerationRecipe;

  it("throws INPUT_INVALID when enumerationsRoot is unset", () => {
    try {
      resolveEnumFolderPath(baseContext, "color@1", "consumer@1");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as { code?: string }).code).toBe("INPUT_INVALID");
    }
  });

  it("throws INPUT_INVALID when the enum handle is not in the set", () => {
    const ctx = { ...baseContext, enumerationsRoot: "/enums", enumsByHandle: new Map() };
    try {
      resolveEnumFolderPath(ctx, "missing@1", "consumer@1");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as { code?: string }).code).toBe("INPUT_INVALID");
    }
  });

  it("resolves a flat path when the enum has no location.folder", () => {
    const ctx: CompileContext = {
      ...baseContext,
      enumerationsRoot: "/enums",
      enumsByHandle: new Map([["color@1", enumRecipe()]]),
    };
    expect(resolveEnumFolderPath(ctx, "color@1", "consumer@1")).toBe("/enums/Color");
  });

  it("resolves a folder-nested path when the enum carries location.folder", () => {
    const ctx: CompileContext = {
      ...baseContext,
      enumerationsRoot: "/enums",
      enumsByHandle: new Map([["color@1", enumRecipe("Theme/Brand")]]),
    };
    expect(resolveEnumFolderPath(ctx, "color@1", "consumer@1")).toBe("/enums/Theme/Brand/Color");
  });
});

describe("ensureSectionFolder — idempotency", () => {
  it("emits a CreateItem op the first time and is a no-op on repeat", () => {
    const ops: Operation[] = [];
    const emitted = new Set<string>();
    const key1 = ensureSectionFolder(ops, baseContext, "ui", emitted);
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toBe("CreateItem");
    const key2 = ensureSectionFolder(ops, baseContext, "ui", emitted);
    expect(key2).toBe(key1);
    // Second call short-circuits — no new op.
    expect(ops).toHaveLength(1);
  });

  it("parents under componentsRoot when one is configured", () => {
    const ops: Operation[] = [];
    ensureSectionFolder(ops, { ...baseContext, componentsRoot: "/cr" }, "ui", new Set());
    expect((ops[0] as CreateItemOp).path).toBe("/cr/ui");
  });
});

describe("ensureComponentFoldersBucket", () => {
  it("emits the section folder + the bucket folder, then dedups", () => {
    const ops: Operation[] = [];
    const emitted = new Set<string>();
    ensureComponentFoldersBucket(ops, baseContext, "ui", emitted);
    // section folder + component-folders bucket
    expect(ops).toHaveLength(2);
    const lengthAfterFirst = ops.length;
    ensureComponentFoldersBucket(ops, baseContext, "ui", emitted);
    expect(ops).toHaveLength(lengthAfterFirst);
  });
});

describe("ensurePresentationDesignParametersBucket", () => {
  it("emits the section folder + the parameters bucket", () => {
    const ops: Operation[] = [];
    ensurePresentationDesignParametersBucket(ops, baseContext, "ui", new Set());
    expect(ops).toHaveLength(2);
    expect((ops[1] as CreateItemOp).name).toBe("Presentation Parameters");
  });
});

describe("ensureContentModelsGroupFolder", () => {
  it("returns undefined and emits nothing when contentModelsRoot is unset", () => {
    const ops: Operation[] = [];
    const result = ensureContentModelsGroupFolder(ops, baseContext, "Accordion", new Set());
    expect(result).toBeUndefined();
    expect(ops).toHaveLength(0);
  });

  it("emits a group folder under contentModelsRoot and dedups on repeat", () => {
    const ops: Operation[] = [];
    const ctx = { ...baseContext, contentModelsRoot: "/cm" };
    const emitted = new Set<string>();
    const key = ensureContentModelsGroupFolder(ops, ctx, "Accordion", emitted);
    expect(key).toBeDefined();
    expect((ops[0] as CreateItemOp).path).toBe("/cm/Accordion");
    ensureContentModelsGroupFolder(ops, ctx, "Accordion", emitted);
    expect(ops).toHaveLength(1);
  });
});

describe("ensurePageTemplatesGroupFolder", () => {
  it("emits under pageTemplatesRoot when set", () => {
    const ops: Operation[] = [];
    const ctx = { ...baseContext, pageTemplatesRoot: "/pt" };
    ensurePageTemplatesGroupFolder(ops, ctx, "Marketing", new Set());
    expect((ops[0] as CreateItemOp).path).toBe("/pt/Marketing");
  });

  it("falls back to templatesRoot when pageTemplatesRoot is unset", () => {
    const ops: Operation[] = [];
    ensurePageTemplatesGroupFolder(ops, baseContext, "Marketing", new Set());
    expect((ops[0] as CreateItemOp).path).toBe("/sitecore/templates/Project/site/Marketing");
  });

  it("returns undefined when neither root resolves", () => {
    const ops: Operation[] = [];
    const result = ensurePageTemplatesGroupFolder(
      ops,
      { templatesRoot: "", renderingsRoot: "r" },
      "Marketing",
      new Set()
    );
    expect(result).toBeUndefined();
    expect(ops).toHaveLength(0);
  });
});

describe("buildFieldOp — sort order + storage axis", () => {
  it("derives a 1-based-by-100 sort order from the zero-based index", () => {
    const ops = buildFieldOp({
      recipeHandle: "h@1",
      fieldRefKey: "fk",
      fieldPath: "/p/Field",
      parentRefKey: "pk",
      labelPrefix: "field:h@1",
      field: field({ name: "Title" }),
      zeroBasedIndex: 2,
      policy: "CreateOnly",
      site: "default",
    });
    const created = ops[0] as CreateItemOp;
    const sortField = created.fields.find((f) => f.value.kind === "number");
    expect(sortField?.value).toMatchObject({ value: 300 });
  });

  it("honours an explicit sitecore.sortOrder override", () => {
    const ops = buildFieldOp({
      recipeHandle: "h@1",
      fieldRefKey: "fk",
      fieldPath: "/p/Field",
      parentRefKey: "pk",
      labelPrefix: "field:h@1",
      field: field({ sitecore: { sortOrder: 42 } }),
      zeroBasedIndex: 0,
      policy: "CreateOnly",
      site: "default",
    });
    const created = ops[0] as CreateItemOp;
    const sortField = created.fields.find((f) => f.value.kind === "number");
    expect(sortField?.value).toMatchObject({ value: 42 });
  });

  it("adds sortOrderBase to the auto-assigned sort order", () => {
    // Parameters templates pass `sortOrderBase: PARAMS_SORT_ORDER_BASE`
    // (1000) so synthesised rendering parameters sort below the
    // inherited base-template fields (RenderingIdentifier, Styles,
    // GridParameters, etc., all in the low hundreds).
    const ops = buildFieldOp({
      recipeHandle: "h@1",
      fieldRefKey: "fk",
      fieldPath: "/p/Field",
      parentRefKey: "pk",
      labelPrefix: "field:h@1",
      field: field({ name: "Headline" }),
      zeroBasedIndex: 0,
      sortOrderBase: 1000,
      policy: "CreateOnly",
      site: "default",
    });
    const created = ops[0] as CreateItemOp;
    const sortField = created.fields.find((f) => f.value.kind === "number");
    expect(sortField?.value).toMatchObject({ value: 1100 });
  });

  it("sortOrderBase does not override an explicit sitecore.sortOrder", () => {
    const ops = buildFieldOp({
      recipeHandle: "h@1",
      fieldRefKey: "fk",
      fieldPath: "/p/Field",
      parentRefKey: "pk",
      labelPrefix: "field:h@1",
      field: field({ sitecore: { sortOrder: 50 } }),
      zeroBasedIndex: 0,
      sortOrderBase: 1000,
      policy: "CreateOnly",
      site: "default",
    });
    const created = ops[0] as CreateItemOp;
    const sortField = created.fields.find((f) => f.value.kind === "number");
    expect(sortField?.value).toMatchObject({ value: 50 });
  });

  it("emits a Shared flag for shared-storage fields", () => {
    const ops = buildFieldOp({
      recipeHandle: "h@1",
      fieldRefKey: "fk",
      fieldPath: "/p/Field",
      parentRefKey: "pk",
      labelPrefix: "field:h@1",
      field: field({ sitecore: { storage: "shared" } }),
      zeroBasedIndex: 0,
      policy: "CreateOnly",
      site: "default",
    });
    const created = ops[0] as CreateItemOp;
    // A shared-flag string field with value "1" is present.
    expect(created.fields.some((f) => f.value.kind === "string" && f.value.value === "1")).toBe(
      true
    );
  });

  it("emits an Unversioned flag for unversioned-storage fields", () => {
    const ops = buildFieldOp({
      recipeHandle: "h@1",
      fieldRefKey: "fk",
      fieldPath: "/p/Field",
      parentRefKey: "pk",
      labelPrefix: "field:h@1",
      field: field({ sitecore: { storage: "unversioned" } }),
      zeroBasedIndex: 0,
      policy: "CreateOnly",
      site: "default",
    });
    const created = ops[0] as CreateItemOp;
    expect(created.fields.some((f) => f.value.kind === "string" && f.value.value === "1")).toBe(
      true
    );
  });

  it("emits no storage flag for a default (versioned) field", () => {
    const ops = buildFieldOp({
      recipeHandle: "h@1",
      fieldRefKey: "fk",
      fieldPath: "/p/Field",
      parentRefKey: "pk",
      labelPrefix: "field:h@1",
      field: field({}),
      zeroBasedIndex: 0,
      policy: "CreateOnly",
      site: "default",
    });
    const created = ops[0] as CreateItemOp;
    // Only Type / SortOrder / Title / Display name — no "1" storage flag.
    expect(created.fields.some((f) => f.value.kind === "string" && f.value.value === "1")).toBe(
      false
    );
  });

  it("emits a literal pipe-list Source for an inline droplist enum field", () => {
    const ops = buildFieldOp({
      recipeHandle: "h@1",
      fieldRefKey: "fk",
      fieldPath: "/p/Field",
      parentRefKey: "pk",
      labelPrefix: "field:h@1",
      field: field({
        shape: "enum",
        sitecore: { type: "droplist" },
        values: ["sm", "md", "lg"],
      }),
      zeroBasedIndex: 0,
      policy: "CreateOnly",
      site: "default",
    });
    const created = ops[0] as CreateItemOp;
    expect(
      created.fields.some((f) => f.value.kind === "string" && f.value.value === "sm|md|lg")
    ).toBe(true);
  });

  it("throws INPUT_INVALID for an inline droplist enum field with no values", () => {
    expect(() =>
      buildFieldOp({
        recipeHandle: "h@1",
        fieldRefKey: "fk",
        fieldPath: "/p/Field",
        parentRefKey: "pk",
        labelPrefix: "field:h@1",
        field: field({ shape: "enum", sitecore: { type: "droplist" } }),
        zeroBasedIndex: 0,
        policy: "CreateOnly",
        site: "default",
      })
    ).toThrowError(/droplist/);
  });

  it("throws INPUT_INVALID for a bare enum field with neither droplist nor enumHandle", () => {
    try {
      buildFieldOp({
        recipeHandle: "h@1",
        fieldRefKey: "fk",
        fieldPath: "/p/Field",
        parentRefKey: "pk",
        labelPrefix: "field:h@1",
        field: field({ shape: "enum" }),
        zeroBasedIndex: 0,
        policy: "CreateOnly",
        site: "default",
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as { code?: string }).code).toBe("INPUT_INVALID");
    }
  });

  it("throws INPUT_INVALID for an enumHandle field built without a CompileContext", () => {
    try {
      buildFieldOp({
        recipeHandle: "h@1",
        fieldRefKey: "fk",
        fieldPath: "/p/Field",
        parentRefKey: "pk",
        labelPrefix: "field:h@1",
        field: field({ shape: "enum", sitecore: { enumHandle: "color@1" } }),
        zeroBasedIndex: 0,
        policy: "CreateOnly",
        site: "default",
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as { code?: string }).code).toBe("INPUT_INVALID");
    }
  });

  it("emits the enum folder path as Source for an enumHandle field with context", () => {
    const enumCtx: CompileContext = {
      ...baseContext,
      enumerationsRoot: "/enums",
      enumsByHandle: new Map<string, EnumerationRecipe>([
        [
          "color@1",
          {
            kind: "enumeration",
            schemaVersion: "1",
            handle: "color@1",
            name: "Color",
            values: [{ name: "red" }],
          } as EnumerationRecipe,
        ],
      ]),
    };
    const ops = buildFieldOp({
      recipeHandle: "h@1",
      fieldRefKey: "fk",
      fieldPath: "/p/Field",
      parentRefKey: "pk",
      labelPrefix: "field:h@1",
      field: field({ shape: "enum", sitecore: { enumHandle: "color@1" } }),
      zeroBasedIndex: 0,
      policy: "CreateOnly",
      site: "default",
      context: enumCtx,
    });
    const created = ops[0] as CreateItemOp;
    expect(
      created.fields.some((f) => f.value.kind === "string" && f.value.value === "/enums/Color")
    ).toBe(true);
  });
});

describe("buildStandardValuesFieldEntries", () => {
  it("skips a field with no declared default", () => {
    const entries = buildStandardValuesFieldEntries("default", "h@1", [field({})]);
    expect(entries).toEqual([]);
  });

  it("encodes a string default for a text field", () => {
    const entries = buildStandardValuesFieldEntries("default", "h@1", [
      field({ name: "Title", default: "Hello" }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      fieldName: "Title",
      value: { kind: "string", value: "Hello" },
    });
  });

  it("prefers sitecore.defaultValue over the abstract default", () => {
    const entries = buildStandardValuesFieldEntries("default", "h@1", [
      field({ name: "Title", default: "abstract", sitecore: { defaultValue: "override" } }),
    ]);
    expect(entries[0].value).toMatchObject({ value: "override" });
  });

  it("encodes a checkbox default as '1' for truthy strings", () => {
    const entries = buildStandardValuesFieldEntries("default", "h@1", [
      field({ name: "Flag", shape: "boolean", default: "yes" }),
    ]);
    expect(entries[0].value).toMatchObject({ kind: "string", value: "1" });
  });

  it("encodes a checkbox default as '' for falsey strings", () => {
    const entries = buildStandardValuesFieldEntries("default", "h@1", [
      field({ name: "Flag", shape: "boolean", default: "no" }),
    ]);
    expect(entries[0].value).toMatchObject({ kind: "string", value: "" });
  });

  it("skips a reference-shape default (link / image are not string-expressible)", () => {
    const entries = buildStandardValuesFieldEntries("default", "h@1", [
      field({ name: "Hero", shape: "image", default: "/some/path" }),
    ]);
    expect(entries).toEqual([]);
  });

  it("encodes an inline droplist enum default as the raw string", () => {
    const entries = buildStandardValuesFieldEntries("default", "h@1", [
      field({
        name: "Size",
        shape: "enum",
        sitecore: { type: "droplist" },
        values: ["sm", "lg"],
        default: "lg",
      }),
    ]);
    expect(entries[0].value).toMatchObject({ kind: "string", value: "lg" });
  });

  it("encodes a shared-enum (droplink + enumHandle) default as a ref-recipe", () => {
    const entries = buildStandardValuesFieldEntries("default", "h@1", [
      field({
        name: "Color",
        shape: "enum",
        sitecore: { enumHandle: "color@1" },
        default: "red",
      }),
    ]);
    expect(entries[0].value).toMatchObject({ kind: "ref-recipe" });
  });

  it("throws INPUT_INVALID for an enum default with neither droplist nor enumHandle", () => {
    try {
      buildStandardValuesFieldEntries("default", "h@1", [
        field({ name: "Bad", shape: "enum", default: "x" }),
      ]);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as { code?: string }).code).toBe("INPUT_INVALID");
    }
  });
});
