import { describe, expect, it } from "vitest";
import {
  compileContentTemplateRecipe,
  compileRecipe,
  type CompileContext,
} from "../../../src/recipe/compile";
import { templateId, standardValuesId } from "../../../src/recipe/guids";
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
    expect(insertOpsOp?.itemRefKey).toBe(standardValuesId("section@1"));
    expect(insertOpsOp?.value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [templateId("accordion-item@1"), templateId("rich-text-block@1")],
    });
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
        rendering: { datasourceLocation: "current-item", openPropertiesAfterAdd: false },
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

describe("source prefix resolution", () => {
  const compileWithSource = (source: string) =>
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
            sitecore: { type: "treelist", source },
          },
        ],
      },
      CONTEXT
    );

  const sourceField = (ir: ReturnType<typeof compileWithSource>) => {
    const fieldOp = ir.operations.find(
      (op): op is CreateItemOp => op.op === "CreateItem" && op.name === "Picker"
    );
    return findField(fieldOp!, TEMPLATE_FIELD_FIELDS.SOURCE);
  };

  it("passes `query:...` through verbatim", () => {
    const ir = compileWithSource("query:$site/*[@@name='Data']");
    expect(sourceField(ir)?.value).toEqual({
      kind: "string",
      value: "query:$site/*[@@name='Data']",
    });
  });

  it("emits ref-source-prefix for `template:<handle>` (executor resolves to IncludeTemplatesForSelection={guid})", () => {
    const ir = compileWithSource("template:accordion-item@1");
    expect(sourceField(ir)?.value).toEqual({
      kind: "ref-source-prefix",
      raw: "template:accordion-item@1",
    });
  });

  it("emits ref-source-prefix for `templates:<h1>,<h2>` (executor resolves at apply time)", () => {
    const ir = compileWithSource("templates:accordion-item@1,rich-text-block@1");
    expect(sourceField(ir)?.value).toEqual({
      kind: "ref-source-prefix",
      raw: "templates:accordion-item@1,rich-text-block@1",
    });
  });

  it("emits ref-source-prefix for `datasource:<q>&template:<h>` (executor resolves DataSource + IncludeTemplatesForSelection)", () => {
    const ir = compileWithSource("datasource:/sitecore/content/Library&template:accordion-item@1");
    expect(sourceField(ir)?.value).toEqual({
      kind: "ref-source-prefix",
      raw: "datasource:/sitecore/content/Library&template:accordion-item@1",
    });
  });

  it("passes unknown prefixes through verbatim", () => {
    const ir = compileWithSource("/sitecore/content/Tags");
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
        rendering: { datasourceLocation: "current-item", openPropertiesAfterAdd: false },
      },
      CONTEXT
    ).operations;
    const insertOps = irOps.find(
      (op): op is SetFieldOp => op.op === "SetField" && op.fieldId === SYSTEM_FIELDS.INSERT_OPTIONS
    );
    expect(insertOps).toBeDefined();
    expect(insertOps?.itemRefKey).toBe(standardValuesId("accordion-block@1"));
    expect(insertOps?.value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [templateId("accordion-item@1")],
    });
  });
});
