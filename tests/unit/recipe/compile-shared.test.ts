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
  joinPath,
  resolveComponentTemplateParent,
  resolveEnumFolderPath,
  resolvePresentationDesignParametersBucketPath,
  resolveRenderingParent,
  siteOf,
} from "../../../src/recipe/compile/shared";
import { buildFieldOp } from "../../../src/recipe/compile/field-ops";
import { buildStandardValuesFieldEntries } from "../../../src/recipe/compile/standard-values";
import {
  ensureComponentFoldersBucket,
  ensureContentModelsGroupFolder,
  ensurePageTemplatesGroupFolder,
  ensurePresentationDesignParametersBucket,
  ensureSectionFolder,
} from "../../../src/recipe/compile/folders";
import type { CreateItemOp, MediaUploadOp, Operation } from "../../../src/recipe/ir/operations";
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

  it("sortOrderBase offsets an explicit sitecore.sortOrder (relative-to-base semantics)", () => {
    // Recipes were authored with sortOrder values like 100, 200, 300
    // when the params base was 0; lifting params to base=1000 needs
    // those explicit values to also lift, otherwise they collide with
    // SXA's inherited low-hundreds fields. Treat explicit sortOrder as
    // RELATIVE to the base, so `{ sortOrderBase: 1000, sortOrder: 50 }`
    // → 1050 on the rendering-parameters template.
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
    expect(sortField?.value).toMatchObject({ value: 1050 });
  });

  it("explicit sitecore.sortOrder on a base=0 field group is unchanged", () => {
    // Datasource fields (and any other group keeping the default
    // sortOrderBase=0) keep authored sortOrder values verbatim.
    const ops = buildFieldOp({
      recipeHandle: "h@1",
      fieldRefKey: "fk",
      fieldPath: "/p/Field",
      parentRefKey: "pk",
      labelPrefix: "field:h@1",
      field: field({ sitecore: { sortOrder: 50 } }),
      zeroBasedIndex: 0,
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

  it("image fields default to SHARED storage (brand imagery is language-invariant)", () => {
    // The registry's role-based image defaults must show in every locale;
    // versioned image fields were empty everywhere but `en` (Sitecore has
    // no field-level fallback by default).
    const ops = buildFieldOp({
      recipeHandle: "h@1",
      fieldRefKey: "fk",
      fieldPath: "/p/Field",
      parentRefKey: "pk",
      labelPrefix: "field:h@1",
      field: field({ name: "Background", shape: "image" }),
      zeroBasedIndex: 0,
      policy: "CreateOnly",
      site: "default",
    });
    const created = ops[0] as CreateItemOp;
    expect(created.fields.some((f) => f.value.kind === "string" && f.value.value === "1")).toBe(
      true
    );
  });

  it("an explicit storage: versioned opts an image field back out of SHARED", () => {
    const ops = buildFieldOp({
      recipeHandle: "h@1",
      fieldRefKey: "fk",
      fieldPath: "/p/Field",
      parentRefKey: "pk",
      labelPrefix: "field:h@1",
      field: field({ name: "Background", shape: "image", sitecore: { storage: "versioned" } }),
      zeroBasedIndex: 0,
      policy: "CreateOnly",
      site: "default",
    });
    const created = ops[0] as CreateItemOp;
    expect(created.fields.some((f) => f.value.kind === "string" && f.value.value === "1")).toBe(
      false
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

  // reference + enumHandle = multi-pick Treelist sourced from a shared
  // enum. Source emits a plain `DataSource=<path>` — earlier iterations
  // appended `&IncludeTemplatesForSelection=<GUID>` to restrict the
  // picker to enum value items, but Sitecore Pages's Treelist chrome
  // rejected every pick under that filter (the picker reported "the
  // source's filter doesn't allow those options" with no recovery
  // path). The filter wasn't load-bearing — scai doesn't emit stray
  // children inside enum folders, so the folder's children are
  // exactly the value items the picker should surface.
  it("emits DataSource pointing at the enum folder for a reference field with enumHandle (no IncludeTemplatesForSelection)", () => {
    const enumCtx: CompileContext = {
      ...baseContext,
      enumerationsRoot: "/enums",
      enumsByHandle: new Map<string, EnumerationRecipe>([
        [
          "social-platform@1",
          {
            kind: "enumeration",
            schemaVersion: "1",
            handle: "social-platform@1",
            name: "SocialPlatform",
            values: [{ name: "facebook" }, { name: "x" }],
          } as EnumerationRecipe,
        ],
      ]),
    };
    const ops = buildFieldOp({
      recipeHandle: "h@1",
      fieldRefKey: "fk",
      fieldPath: "/p/Platforms",
      parentRefKey: "pk",
      labelPrefix: "field:h@1",
      field: field({
        name: "Platforms",
        shape: "reference",
        multiple: true,
        sitecore: { type: "treelist", enumHandle: "social-platform@1" },
      }),
      zeroBasedIndex: 0,
      policy: "CreateOnly",
      site: "default",
      context: enumCtx,
    });
    const created = ops[0] as CreateItemOp;
    const source = created.fields.find(
      (f) =>
        f.value.kind === "string" && f.value.value.startsWith("DataSource=/enums/SocialPlatform")
    );
    expect(source).toBeDefined();
    if (source?.value.kind === "string") {
      expect(source.value.value).toBe("DataSource=/enums/SocialPlatform");
      // Regression guard: never re-introduce the IncludeTemplatesForSelection
      // suffix on this branch — Pages rejects it.
      expect(source.value.value).not.toMatch(/IncludeTemplatesForSelection/);
    }
  });
});

describe("buildStandardValuesFieldEntries", () => {
  it("skips a field with no declared default", () => {
    const { primary: entries } = buildStandardValuesFieldEntries("default", "h@1", [field({})]);
    expect(entries).toEqual([]);
  });

  it("encodes a string default for a text field", () => {
    const { primary: entries } = buildStandardValuesFieldEntries("default", "h@1", [
      field({ name: "Title", default: "Hello" }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      fieldName: "Title",
      value: { kind: "string", value: "Hello" },
    });
  });

  it("prefers sitecore.defaultValue over the abstract default", () => {
    const { primary: entries } = buildStandardValuesFieldEntries("default", "h@1", [
      field({ name: "Title", default: "abstract", sitecore: { defaultValue: "override" } }),
    ]);
    expect(entries[0].value).toMatchObject({ value: "override" });
  });

  it("encodes a checkbox default as '1' for truthy strings", () => {
    const { primary: entries } = buildStandardValuesFieldEntries("default", "h@1", [
      field({ name: "Flag", shape: "boolean", default: "yes" }),
    ]);
    expect(entries[0].value).toMatchObject({ kind: "string", value: "1" });
  });

  it("encodes a checkbox default as '' for falsey strings", () => {
    const { primary: entries } = buildStandardValuesFieldEntries("default", "h@1", [
      field({ name: "Flag", shape: "boolean", default: "no" }),
    ]);
    expect(entries[0].value).toMatchObject({ kind: "string", value: "" });
  });

  it("encodes an image default with alt|src as the Sitecore image XML payload", () => {
    const { primary: entries } = buildStandardValuesFieldEntries("default", "h@1", [
      field({
        name: "Hero",
        shape: "image",
        default: "Hero placeholder|https://picsum.photos/seed/hero/1200/600",
      }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].value).toMatchObject({
      kind: "string",
      value: '<image src="https://picsum.photos/seed/hero/1200/600" alt="Hero placeholder" />',
    });
  });

  it("encodes an image default with just a src (no pipe) as src-only image XML", () => {
    const { primary: entries } = buildStandardValuesFieldEntries("default", "h@1", [
      field({
        name: "Hero",
        shape: "image",
        default: "https://picsum.photos/seed/x/800/600",
      }),
    ]);
    expect(entries[0].value).toMatchObject({
      kind: "string",
      value: '<image src="https://picsum.photos/seed/x/800/600" />',
    });
  });

  it("materialises an external-URL image default as MediaUpload + media-xml-ref when a sink is provided", () => {
    // The media-item form is the only one Pages' canvas and the Layout
    // Service render — the sink-less `src=` XML fallback above only
    // shows a thumbnail in Pages' field editor.
    const sink = { policy: "CreateAndUpdate" as const, mediaOps: [] as MediaUploadOp[] };
    const { primary: entries } = buildStandardValuesFieldEntries(
      "default",
      "ai-chat@1",
      [
        field({
          name: "Avatar",
          shape: "image",
          default: "AI Assistant|https://api.dicebear.com/9.x/bottts/svg?seed=ai-chat",
        }),
      ],
      undefined,
      sink
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].value.kind).toBe("media-xml-ref");
    expect(sink.mediaOps).toHaveLength(1);
    const upload = sink.mediaOps[0];
    expect(upload.source).toEqual({
      kind: "external-url",
      url: "https://api.dicebear.com/9.x/bottts/svg?seed=ai-chat",
    });
    expect(upload.altText).toBe("AI Assistant");
    if (entries[0].value.kind === "media-xml-ref") {
      expect(upload.id).toBe(entries[0].value.refKey);
    }
    expect(upload.destinationPath).toContain("/sitecore/media library/RecipeImages/");
  });

  it("keeps media-library-path image defaults as XML even with a sink", () => {
    const sink = { policy: "CreateAndUpdate" as const, mediaOps: [] as MediaUploadOp[] };
    const { primary: entries } = buildStandardValuesFieldEntries(
      "default",
      "h@1",
      [
        field({
          name: "Hero",
          shape: "image",
          default: "Logo|/sitecore/media library/Project/Logo",
        }),
      ],
      undefined,
      sink
    );
    expect(sink.mediaOps).toHaveLength(0);
    expect(entries[0].value).toMatchObject({
      kind: "string",
      value: '<image src="/sitecore/media library/Project/Logo" alt="Logo" />',
    });
  });

  it("escapes XML attribute special chars in image defaults", () => {
    const { primary: entries } = buildStandardValuesFieldEntries("default", "h@1", [
      field({
        name: "Hero",
        shape: "image",
        default: 'Quotes "&" things|https://x?q=a&r=b',
      }),
    ]);
    expect(entries[0].value).toMatchObject({
      kind: "string",
      value: '<image src="https://x?q=a&amp;r=b" alt="Quotes &quot;&amp;&quot; things" />',
    });
  });

  it("skips an image default with no src (e.g. alt-only)", () => {
    const { primary: entries } = buildStandardValuesFieldEntries("default", "h@1", [
      field({
        name: "Hero",
        shape: "image",
        default: "alt only|",
      }),
    ]);
    expect(entries).toEqual([]);
  });

  it("encodes a file default with alt|src as the Sitecore file XML payload", () => {
    const { primary: entries } = buildStandardValuesFieldEntries("default", "h@1", [
      field({
        name: "Document",
        shape: "image",
        sitecore: { type: "file" },
        default: "Whitepaper|https://example.com/wp.pdf",
      }),
    ]);
    expect(entries[0].value).toMatchObject({
      kind: "string",
      value: '<file src="https://example.com/wp.pdf" alt="Whitepaper" />',
    });
  });

  // Reference-shape defaults resolve recipe handles to their
  // deterministic contentItemId GUIDs. The recipe set is responsible
  // for materialising those content items in the same compile run; if
  // the handle doesn't resolve, the SV write fails at apply time.
  it("encodes a single-reference (Droplink) default as a ref-recipe pointing at the handle's contentItemId", () => {
    const { primary: entries } = buildStandardValuesFieldEntries("default", "h@1", [
      field({
        name: "Author",
        shape: "reference",
        multiple: false,
        sitecore: { type: "droplink" },
        default: "author-jane@1",
      }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].value.kind).toBe("ref-recipe");
    if (entries[0].value.kind === "ref-recipe") {
      // Deterministic — uuid5 of `default::author-jane@1` under the
      // content-item namespace. Match a UUID shape rather than a hard
      // GUID so the test stays passing if the namespace seed changes.
      expect(entries[0].value.refKey).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    }
  });

  it("encodes a multi-reference (Treelist) default as a pipe-separated ref-recipe-list", () => {
    const { primary: entries } = buildStandardValuesFieldEntries("default", "h@1", [
      field({
        name: "Authors",
        shape: "reference",
        multiple: true,
        sitecore: { type: "treelist" },
        default: "author-jane@1|author-bob@1|author-eve@1",
      }),
    ]);
    expect(entries[0].value.kind).toBe("ref-recipe-list");
    if (entries[0].value.kind === "ref-recipe-list") {
      expect(entries[0].value.refKeys).toHaveLength(3);
      for (const refKey of entries[0].value.refKeys) {
        expect(refKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      }
    }
  });

  it("skips a single-reference default when the trimmed handle is empty", () => {
    const { primary: entries } = buildStandardValuesFieldEntries("default", "h@1", [
      field({
        name: "Author",
        shape: "reference",
        multiple: false,
        sitecore: { type: "droplink" },
        default: "   ",
      }),
    ]);
    expect(entries).toEqual([]);
  });

  it("skips a multi-reference default when no handles parse out (e.g. only pipes/whitespace)", () => {
    const { primary: entries } = buildStandardValuesFieldEntries("default", "h@1", [
      field({
        name: "Authors",
        shape: "reference",
        multiple: true,
        sitecore: { type: "treelist" },
        default: " | | ",
      }),
    ]);
    expect(entries).toEqual([]);
  });

  // Reference + enumHandle = pick value items from a shared enum (multi
  // via Treelist or single via Droplink-on-reference). Defaults resolve
  // to enumValueId rather than contentItemId so the SV writes point at
  // the enum's value-item folder, not a content-item GUID that doesn't
  // exist. Same author-error contract as the enum-shape SV.
  it("encodes a multi-reference default with enumHandle as enum-value ref-recipe-list", () => {
    const { primary: entries } = buildStandardValuesFieldEntries("default", "h@1", [
      field({
        name: "Platforms",
        shape: "reference",
        multiple: true,
        sitecore: {
          type: "treelist",
          enumHandle: "social-platform@1",
        },
        default: "facebook|x|linkedin",
      }),
    ]);
    expect(entries[0].value.kind).toBe("ref-recipe-list");
    if (entries[0].value.kind === "ref-recipe-list") {
      expect(entries[0].value.refKeys).toHaveLength(3);
      // Should differ from the plain (no-enumHandle) contentItemId
      // version — derived against enumValueId(enumerationFolderId(...))
      // instead of contentItemId(site, handle). Just shape-check.
      for (const refKey of entries[0].value.refKeys) {
        expect(refKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      }
    }
  });

  it("encodes a single-reference default with enumHandle as a single enum-value ref-recipe", () => {
    const { primary: entries } = buildStandardValuesFieldEntries("default", "h@1", [
      field({
        name: "Platform",
        shape: "reference",
        multiple: false,
        sitecore: {
          type: "droplink",
          enumHandle: "social-platform@1",
        },
        default: "x",
      }),
    ]);
    expect(entries[0].value.kind).toBe("ref-recipe");
    if (entries[0].value.kind === "ref-recipe") {
      expect(entries[0].value.refKey).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    }
  });

  it("encodes a general-link default with text|url as the Sitecore link XML payload", () => {
    const { primary: entries } = buildStandardValuesFieldEntries("default", "h@1", [
      field({
        name: "Link",
        shape: "link",
        sitecore: { type: "general-link" },
        default: "Get started|https://example.com",
      }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].value).toMatchObject({
      kind: "string",
      value: '<link text="Get started" linktype="external" url="https://example.com" />',
    });
  });

  it("encodes a general-link default with no pipe as text + anchor URL", () => {
    const { primary: entries } = buildStandardValuesFieldEntries("default", "h@1", [
      field({
        name: "Link",
        shape: "link",
        sitecore: { type: "general-link" },
        default: "Click here",
      }),
    ]);
    expect(entries[0].value).toMatchObject({
      kind: "string",
      value: '<link text="Click here" linktype="anchor" url="#" />',
    });
  });

  it("encodes a general-link default with mailto: as linktype mailto", () => {
    const { primary: entries } = buildStandardValuesFieldEntries("default", "h@1", [
      field({
        name: "Link",
        shape: "link",
        sitecore: { type: "general-link" },
        default: "Email us|mailto:hello@example.com",
      }),
    ]);
    expect(entries[0].value).toMatchObject({
      kind: "string",
      value: '<link text="Email us" linktype="mailto" url="mailto:hello@example.com" />',
    });
  });

  it("escapes XML attribute special chars in general-link defaults", () => {
    const { primary: entries } = buildStandardValuesFieldEntries("default", "h@1", [
      field({
        name: "Link",
        shape: "link",
        sitecore: { type: "general-link" },
        default: 'Read "A&B"|https://x?q=1&r=2',
      }),
    ]);
    expect(entries[0].value).toMatchObject({
      kind: "string",
      value:
        '<link text="Read &quot;A&amp;B&quot;" linktype="external" url="https://x?q=1&amp;r=2" />',
    });
  });

  it("skips a general-link default with empty raw string", () => {
    const { primary: entries } = buildStandardValuesFieldEntries("default", "h@1", [
      field({
        name: "Link",
        shape: "link",
        sitecore: { type: "general-link" },
        default: "",
      }),
    ]);
    // Empty default → encoder returns undefined, but the upstream
    // code in buildStandardValuesFieldEntries treats `default: ""`
    // as "no default declared" before the encoder ever runs; either
    // way the SV gets no entry for this field.
    expect(entries).toEqual([]);
  });

  it("encodes an inline droplist enum default as the raw string", () => {
    const { primary: entries } = buildStandardValuesFieldEntries("default", "h@1", [
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
    const { primary: entries } = buildStandardValuesFieldEntries("default", "h@1", [
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

describe("image-role substitution (imageDefaults map)", () => {
  const STOCK_URL = "https://api.dicebear.com/9.x/bottts/svg?seed=ai-chat";
  const BRAND_URL = "https://assets.example.invalid/brands/sync/avatar-bot.png";

  const avatarField = () =>
    field({
      name: "Avatar",
      shape: "image",
      role: "avatar",
      default: `AI Assistant|${STOCK_URL}`,
    });

  const sinkWith = (imageDefaults?: Record<string, string>) => ({
    policy: "CreateAndUpdate" as const,
    mediaOps: [] as MediaUploadOp[],
    ...(imageDefaults ? { imageDefaults } : {}),
  });

  it("materialises the mapped URL when the field's role is in the map", () => {
    const sink = sinkWith({ avatar: BRAND_URL });
    const { primary: entries } = buildStandardValuesFieldEntries(
      "default",
      "ai-chat@1",
      [avatarField()],
      undefined,
      sink
    );
    expect(sink.mediaOps).toHaveLength(1);
    expect(sink.mediaOps[0].source).toEqual({ kind: "external-url", url: BRAND_URL });
    // Recipe-authored alt survives the substitution — only the URL is branded.
    expect(sink.mediaOps[0].altText).toBe("AI Assistant");
    if (entries[0].value.kind === "media-xml-ref") {
      expect(sink.mediaOps[0].id).toBe(entries[0].value.refKey);
    }
  });

  it("derives the refKey from the EFFECTIVE URL — brand and stock yield distinct media items", () => {
    const branded = sinkWith({ avatar: BRAND_URL });
    const stock = sinkWith();
    buildStandardValuesFieldEntries("default", "ai-chat@1", [avatarField()], undefined, branded);
    buildStandardValuesFieldEntries("default", "ai-chat@1", [avatarField()], undefined, stock);
    expect(branded.mediaOps[0].id).not.toBe(stock.mediaOps[0].id);
  });

  it("falls back to the stock URL when the role is absent from the map", () => {
    const sink = sinkWith({ hero: BRAND_URL });
    buildStandardValuesFieldEntries("default", "ai-chat@1", [avatarField()], undefined, sink);
    expect(sink.mediaOps[0].source).toEqual({ kind: "external-url", url: STOCK_URL });
  });

  it("ignores the map entirely for fields without a role", () => {
    const sink = sinkWith({ avatar: BRAND_URL });
    buildStandardValuesFieldEntries(
      "default",
      "ai-chat@1",
      [field({ name: "Avatar", shape: "image", default: `AI Assistant|${STOCK_URL}` })],
      undefined,
      sink
    );
    expect(sink.mediaOps[0].source).toEqual({ kind: "external-url", url: STOCK_URL });
  });

  it("rejects a non-http(s) map entry with INPUT_INVALID", () => {
    const sink = sinkWith({ avatar: "/sitecore/media library/Not/A/Url" });
    try {
      buildStandardValuesFieldEntries("default", "ai-chat@1", [avatarField()], undefined, sink);
      expect.unreachable("expected INPUT_INVALID");
    } catch (e) {
      expect((e as { code?: string }).code).toBe("INPUT_INVALID");
    }
  });

  it("uploads a substituted image ONCE as a site-level Defaults item shared across recipes", () => {
    // Two different recipes, two different field names, same role: both
    // resolve the same (site, role, URL) refKey, so the second sink's op
    // is the same media item — dedup happens at plan time via the
    // captured-itemId map, and the destination is the shared Defaults
    // folder rather than either recipe's own folder.
    const sinkA = sinkWith({ avatar: BRAND_URL });
    const sinkB = sinkWith({ avatar: BRAND_URL });
    const { primary: entriesA } = buildStandardValuesFieldEntries(
      "default",
      "ai-chat@1",
      [avatarField()],
      undefined,
      sinkA
    );
    const { primary: entriesB } = buildStandardValuesFieldEntries(
      "default",
      "person-card@1",
      [
        field({
          name: "Portrait",
          shape: "image",
          role: "avatar",
          default: `Portrait|${STOCK_URL}`,
        }),
      ],
      undefined,
      sinkB
    );
    expect(sinkA.mediaOps[0].id).toBe(sinkB.mediaOps[0].id);
    expect(sinkA.mediaOps[0].destinationPath).toBe(sinkB.mediaOps[0].destinationPath);
    expect(sinkA.mediaOps[0].destinationPath).toMatch(
      /^\/sitecore\/media library\/RecipeImages\/default\/Defaults\/avatar-[0-9a-f]{8}$/
    );
    expect(sinkA.mediaOps[0].label).toBe("media-upload:site-image-defaults:avatar");
    // Both SV entries reference the shared refKey.
    expect(entriesA[0].value).toEqual(entriesB[0].value);
  });

  it("nests the Defaults folder under mediaLibraryRoot when configured", () => {
    const sink = {
      ...sinkWith({ avatar: BRAND_URL }),
      mediaLibraryRoot: "/sitecore/media library/Project/sync-site",
    };
    buildStandardValuesFieldEntries("default", "ai-chat@1", [avatarField()], undefined, sink);
    expect(sink.mediaOps[0].destinationPath).toMatch(
      /^\/sitecore\/media library\/Project\/sync-site\/Defaults\/avatar-[0-9a-f]{8}$/
    );
  });

  it("keeps per-recipe folders + identity for unsubstituted stock defaults", () => {
    const sink = sinkWith();
    buildStandardValuesFieldEntries("default", "ai-chat@1", [avatarField()], undefined, sink);
    expect(sink.mediaOps[0].destinationPath).toMatch(
      /^\/sitecore\/media library\/RecipeImages\/default\/ai-chat\/Avatar-[0-9a-f]{8}$/
    );
    expect(sink.mediaOps[0].label).toBe("media-upload:ai-chat@1:Avatar");
  });

  it("materialises a role-mapped image even when the field has NO authored default", () => {
    const bareRoleField = field({ name: "Image", shape: "image", role: "hero" });
    const mapped = sinkWith({ hero: BRAND_URL });
    const { primary: entries } = buildStandardValuesFieldEntries(
      "default",
      "hero@1",
      [bareRoleField],
      undefined,
      mapped
    );
    expect(entries).toHaveLength(1);
    expect(mapped.mediaOps).toHaveLength(1);
    expect(mapped.mediaOps[0].source).toEqual({ kind: "external-url", url: BRAND_URL });
    expect(mapped.mediaOps[0].destinationPath).toMatch(/\/Defaults\/hero-[0-9a-f]{8}$/);

    // Without a map entry the field stays defaultless — no synthetic SV.
    const unmapped = sinkWith({ avatar: BRAND_URL });
    const { primary: none } = buildStandardValuesFieldEntries(
      "default",
      "hero@1",
      [bareRoleField],
      undefined,
      unmapped
    );
    expect(none).toHaveLength(0);
    expect(unmapped.mediaOps).toHaveLength(0);
  });
});
