import { describe, expect, it } from "vitest";
import {
  compileContentTemplateRecipe,
  compileRecipe,
  type CompileContext,
} from "../../../src/recipe/compile";
import { templateId, standardValuesId, workflowId } from "../../../src/recipe/items/guids";
import {
  SITECORE_TEMPLATES,
  STANDARD_TEMPLATE_ID,
  SYSTEM_FIELDS,
  TEMPLATE_FIELD_FIELDS,
} from "../../../src/recipe/ir/sitecore-templates";
import type { CreateItemOp, Operation, SetFieldOp } from "../../../src/recipe/ir/operations";

const CONTEXT: CompileContext = {
  templatesRoot: "/sitecore/templates/Project/test-site/Components",
  renderingsRoot: "/sitecore/layout/Renderings/Project/test-site",
};

const SITE = "default";

const findField = (op: CreateItemOp, fieldGuid: string) =>
  op.fields.find((f) => f.fieldId === fieldGuid);

describe("compileContentTemplateRecipe", () => {
  it("emits the template + sections + fields + standard-values + back-fill, no rendering", () => {
    const ir = compileContentTemplateRecipe(
      {
        kind: "content-template",
        schemaVersion: "1",
        handle: "accordion-item@1",
        name: "AccordionItem",
        displayName: "Accordion Item",
        fields: [
          { name: "Title", shape: "text" },
          { name: "Body", shape: "richText" },
        ],
      },
      CONTEXT
    );

    expect(ir.operations.map((op) => op.op)).toEqual([
      "CreateItem", // template
      "SetBaseTemplates", // base
      "CreateItem", // section "Content"
      "CreateItem", // field "Title"
      "CreateItem", // field "Body"
      "CreateItem", // standard values
      "SetStandardValues", // back-fill
    ]);
    expect(
      ir.operations.find(
        (op) => op.op === "CreateItem" && op.templateOf === SITECORE_TEMPLATES.RENDERING
      )
    ).toBeUndefined();
  });

  it("emits an Insert Options SetField when `insertOptions` is set", () => {
    const ir = compileContentTemplateRecipe(
      {
        kind: "content-template",
        schemaVersion: "1",
        handle: "section@1",
        name: "Section",
        displayName: "Section",
        fields: [{ name: "Title", shape: "text" }],
        insertOptions: ["accordion-item@1", "rich-text-block@1"],
      },
      CONTEXT
    );

    const insertOpsOp = ir.operations.find(
      (op): op is SetFieldOp => op.op === "SetField" && op.fieldId === SYSTEM_FIELDS.INSERT_OPTIONS
    );
    expect(insertOpsOp).toBeDefined();
    expect(insertOpsOp?.itemRefKey).toBe(standardValuesId(SITE, "section@1"));
    expect(insertOpsOp?.value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [templateId(SITE, "accordion-item@1"), templateId(SITE, "rich-text-block@1")],
    });
  });

  it("emits a __Default workflow SetField on Standard Values when defaultWorkflow is set", () => {
    const ir = compileContentTemplateRecipe(
      {
        kind: "content-template",
        schemaVersion: "1",
        handle: "article@1",
        name: "Article",
        displayName: "Article",
        fields: [{ name: "Title", shape: "text" }],
        defaultWorkflow: "editorial@1",
      },
      CONTEXT
    );
    const wf = ir.operations.find(
      (op): op is SetFieldOp =>
        op.op === "SetField" && op.label === "content-template-default-workflow:article@1"
    )!;
    expect(wf).toBeDefined();
    expect(wf.itemRefKey).toBe(standardValuesId(SITE, "article@1"));
    expect(wf.fieldName).toBe("__Default workflow");
    expect(wf.value).toEqual({
      kind: "ref-recipe",
      refKey: workflowId("editorial@1"),
    });
  });

  it("omits the __Default workflow SetField when defaultWorkflow is unset", () => {
    const ir = compileContentTemplateRecipe(
      {
        kind: "content-template",
        schemaVersion: "1",
        handle: "minimal@1",
        name: "Minimal",
        displayName: "Minimal",
        fields: [{ name: "Title", shape: "text" }],
      },
      CONTEXT
    );
    const wf = ir.operations.find(
      (op) => op.op === "SetField" && op.label.startsWith("content-template-default-workflow:")
    );
    expect(wf).toBeUndefined();
  });

  it("the emitted template uses STANDARD_TEMPLATE_ID as its base", () => {
    const ir = compileContentTemplateRecipe(
      {
        kind: "content-template",
        schemaVersion: "1",
        handle: "minimal@1",
        name: "Minimal",
        displayName: "Minimal",
        fields: [{ name: "Title", shape: "text" }],
      },
      CONTEXT
    );
    const setBase = ir.operations[1];
    expect(setBase.op).toBe("SetBaseTemplates");
    if (setBase.op === "SetBaseTemplates") {
      expect(setBase.baseTemplates).toEqual([STANDARD_TEMPLATE_ID]);
    }
  });
});

describe("compileRecipe — dispatcher", () => {
  it("routes content-template kinds to compileContentTemplateRecipe", () => {
    const ir = compileRecipe(
      {
        kind: "content-template",
        schemaVersion: "1",
        handle: "x@1",
        name: "X",
        displayName: "X",
        fields: [{ name: "Title", shape: "text" }],
      },
      CONTEXT
    );
    expect(ir.recipeHandle).toBe("x@1");
    expect(
      ir.operations.some(
        (op) => op.op === "CreateItem" && op.templateOf === SITECORE_TEMPLATES.RENDERING
      )
    ).toBe(false);
  });

  it("routes component-template kinds to compileComponentTemplateRecipe", () => {
    const ir = compileRecipe(
      {
        kind: "component-template",
        schemaVersion: "1",
        handle: "x@1",
        name: "X",
        displayName: "X",
        fields: [{ name: "Title", shape: "text" }],
        variants: [],
        params: [],
      },
      CONTEXT
    );
    expect(
      ir.operations.some(
        (op) => op.op === "CreateItem" && op.templateOf === SITECORE_TEMPLATES.RENDERING
      )
    ).toBe(true);
  });
});

describe("structured source field resolution", () => {
  const compileWithSitecore = (sitecore: Record<string, unknown>) =>
    compileContentTemplateRecipe(
      {
        kind: "content-template",
        schemaVersion: "1",
        handle: "src@1",
        name: "Src",
        displayName: "Src",
        fields: [
          {
            name: "Picker",
            shape: "reference",
            multiple: true,
            sitecore: { type: "treelist", ...sitecore },
          },
        ],
      },
      CONTEXT
    );

  const sourceField = (ir: ReturnType<typeof compileWithSitecore>) => {
    const fieldOp = ir.operations.find(
      (op): op is CreateItemOp => op.op === "CreateItem" && op.name === "Picker"
    );
    return findField(fieldOp!, TEMPLATE_FIELD_FIELDS.SOURCE);
  };

  it("standalone sourceQuery → string with `query:<query>` shorthand", () => {
    const ir = compileWithSitecore({ sourceQuery: "$site/*[@@name='Data']" });
    expect(sourceField(ir)?.value).toEqual({
      kind: "string",
      value: "query:$site/*[@@name='Data']",
    });
  });

  it("emits ref-source-fields for sourceTypes with one handle (executor resolves to IncludeTemplatesForSelection={guid})", () => {
    const ir = compileWithSitecore({ sourceTypes: ["accordion-item@1"] });
    expect(sourceField(ir)?.value).toEqual({
      kind: "ref-source-fields",
      site: SITE,
      sourceTypes: ["accordion-item@1"],
      sourceQuery: undefined,
      sourceScope: undefined,
    });
  });

  it("emits ref-source-fields for sourceTypes with multiple handles (executor resolves at apply time)", () => {
    const ir = compileWithSitecore({ sourceTypes: ["accordion-item@1", "rich-text-block@1"] });
    expect(sourceField(ir)?.value).toEqual({
      kind: "ref-source-fields",
      site: SITE,
      sourceTypes: ["accordion-item@1", "rich-text-block@1"],
      sourceQuery: undefined,
      sourceScope: undefined,
    });
  });

  it("emits ref-source-fields combining sourceScope + sourceTypes (executor resolves DataSource + IncludeTemplatesForSelection)", () => {
    const ir = compileWithSitecore({
      sourceScope: "/sitecore/content/Library",
      sourceTypes: ["accordion-item@1"],
    });
    expect(sourceField(ir)?.value).toEqual({
      kind: "ref-source-fields",
      site: SITE,
      sourceTypes: ["accordion-item@1"],
      sourceQuery: undefined,
      sourceScope: "/sitecore/content/Library",
    });
  });

  it("passes sourceRaw through verbatim as a plain string", () => {
    const ir = compileWithSitecore({ sourceRaw: "/sitecore/content/Tags" });
    expect(sourceField(ir)?.value).toEqual({
      kind: "string",
      value: "/sitecore/content/Tags",
    });
  });
});

describe("insertOptions on a ComponentTemplateRecipe", () => {
  it("appends a SetField on the standard-values item with pipe-encoded template GUIDs", () => {
    const irOps: Operation[] = compileRecipe(
      {
        kind: "component-template",
        schemaVersion: "1",
        handle: "accordion-block@1",
        name: "AccordionBlock",
        displayName: "Accordion",
        fields: [{ name: "Heading", shape: "text" }],
        variants: [],
        params: [],
        insertOptions: ["accordion-item@1"],
      },
      CONTEXT
    ).operations;
    const insertOps = irOps.find(
      (op): op is SetFieldOp => op.op === "SetField" && op.fieldId === SYSTEM_FIELDS.INSERT_OPTIONS
    );
    expect(insertOps).toBeDefined();
    expect(insertOps?.itemRefKey).toBe(standardValuesId(SITE, "accordion-block@1"));
    expect(insertOps?.value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [templateId(SITE, "accordion-item@1")],
    });
  });
});

describe("field storage axis (sitecore.storage)", () => {
  const compileStorageFields = () =>
    compileContentTemplateRecipe(
      {
        kind: "content-template",
        schemaVersion: "1",
        handle: "story@1",
        name: "Story",
        displayName: "Story",
        fields: [
          { name: "Headline", shape: "text" }, // no storage → versioned default
          { name: "Locale", shape: "text", sitecore: { storage: "shared" } },
          { name: "Summary", shape: "text", sitecore: { storage: "unversioned" } },
          { name: "Body", shape: "richText", sitecore: { storage: "versioned" } },
        ],
      },
      CONTEXT
    );

  const fieldOp = (ir: ReturnType<typeof compileStorageFields>, name: string): CreateItemOp =>
    ir.operations.find((op): op is CreateItemOp => op.op === "CreateItem" && op.name === name)!;

  it("emits the Shared flag only for storage: shared", () => {
    const ir = compileStorageFields();
    expect(findField(fieldOp(ir, "Locale"), TEMPLATE_FIELD_FIELDS.SHARED)?.value).toEqual({
      kind: "string",
      value: "1",
    });
    expect(findField(fieldOp(ir, "Headline"), TEMPLATE_FIELD_FIELDS.SHARED)).toBeUndefined();
    expect(findField(fieldOp(ir, "Summary"), TEMPLATE_FIELD_FIELDS.SHARED)).toBeUndefined();
  });

  it("emits the Unversioned flag only for storage: unversioned", () => {
    const ir = compileStorageFields();
    expect(findField(fieldOp(ir, "Summary"), TEMPLATE_FIELD_FIELDS.UNVERSIONED)?.value).toEqual({
      kind: "string",
      value: "1",
    });
    expect(findField(fieldOp(ir, "Locale"), TEMPLATE_FIELD_FIELDS.UNVERSIONED)).toBeUndefined();
  });

  it("emits neither flag for storage: versioned (the Sitecore default)", () => {
    const ir = compileStorageFields();
    for (const name of ["Headline", "Body"]) {
      expect(findField(fieldOp(ir, name), TEMPLATE_FIELD_FIELDS.SHARED)).toBeUndefined();
      expect(findField(fieldOp(ir, name), TEMPLATE_FIELD_FIELDS.UNVERSIONED)).toBeUndefined();
    }
  });
});
