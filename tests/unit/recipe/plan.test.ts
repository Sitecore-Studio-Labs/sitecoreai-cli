import { describe, expect, it } from "vitest";
import { compileComponentTemplateRecipe } from "../../../src/recipe/compile";
import { ctaButtonRecipe } from "../../../example/recipes/cta-button.recipe";
import { renderRefValue } from "../../../src/recipe/api/ref-encoding";
import { buildPlan } from "../../../src/recipe/plan";
import { executeIr } from "../../../src/recipe/execute";
import { templateId } from "../../../src/recipe/guids";
import { SITECORE_TEMPLATES, SYSTEM_FIELDS } from "../../../src/recipe/ir/sitecore-templates";
import { MockAuthoringClient } from "./_fixtures/mock-client";

const CONTEXT = {
  templatesRoot: "/sitecore/templates/Project/sandbox/Components",
  renderingsRoot: "/sitecore/layout/Renderings/Project/sandbox",
  headlessVariantsRoot:
    "/sitecore/content/test-tenant/sandbox/Presentation/Headless Variants",
  enumerationsRoot:
    "/sitecore/content/test-tenant/sandbox/Settings/Enumerations",
};

const compileCta = () => compileComponentTemplateRecipe(ctaButtonRecipe, CONTEXT);

const HANDLE = "cta-button@1";

describe("buildPlan — first-push (nothing exists in tenant)", () => {
  it("plans a create for every CreateItem op and skips the update-style ops", async () => {
    const ir = compileCta();
    const client = new MockAuthoringClient();
    const plan = await buildPlan(ir, client);
    expect(plan.actions).toHaveLength(ir.operations.length);
    // CreateItem ops plan as create (parent path is derivable from op.path
    // even when the captured-itemId map is empty in plan-mode). Update-
    // style ops (SetBaseTemplates, SetStandardValues) plan as skip because
    // their target item doesn't yet exist on the tenant.
    const createItemCount = ir.operations.filter((op) => op.op === "CreateItem").length;
    const updateStyleCount = ir.operations.length - createItemCount;
    expect(plan.summary.create).toBe(createItemCount);
    expect(plan.summary.skip).toBe(updateStyleCount);
    expect(plan.summary.update).toBe(0);
    expect(plan.summary.error).toBe(0);
  });

  it("the template's create action carries the mutation the executor would dispatch", async () => {
    const ir = compileCta();
    const client = new MockAuthoringClient();
    const plan = await buildPlan(ir, client);
    const templateAction = plan.actions[0];
    expect(templateAction.status).toBe("create");
    expect(templateAction.mutation).toMatchObject({
      kind: "createItem",
      input: {
        parent: CONTEXT.templatesRoot,
        templateId: SITECORE_TEMPLATES.TEMPLATE,
        name: "CtaButton",
      },
    });
  });
});

describe("buildPlan — idempotent re-push (everything already in desired state)", () => {
  it("plans every operation as a skip", async () => {
    const ir = compileCta();
    const client = new MockAuthoringClient();
    // Seed the tenant by running an apply pass first; the mock's stored
    // state is now what a successful first push leaves behind.
    const firstApply = await executeIr(ir, client, { mode: "apply" });
    expect(firstApply.aborted).toBe(false);

    const plan = await buildPlan(ir, client);
    expect(plan.summary).toEqual({ create: 0, update: 0, skip: ir.operations.length, error: 0 });
    expect(plan.actions.every((a) => a.status === "skip")).toBe(true);
  });
});

describe("buildPlan — drifted item produces an update plan", () => {
  it("emits an update with a per-field diff when remote values disagree", async () => {
    const ir = compileCta();
    const client = new MockAuthoringClient();

    const templateOp = ir.operations[0];
    if (templateOp.op !== "CreateItem") throw new Error("expected first op to be CreateItem");

    // Pre-seed the template at its path with a wrong icon to stage drift.
    const preloadedTemplateId = "11111111-1111-1111-1111-111111111111";
    client.preload({
      itemId: preloadedTemplateId,
      templateId: templateOp.templateOf,
      parentId: "00000000-0000-0000-0000-000000000aaa",
      name: templateOp.name,
      path: templateOp.path,
      fields: [{ fieldId: SYSTEM_FIELDS.ICON, value: "Office/32x32/old-icon.png" }],
    });

    const plan = await buildPlan(ir, client);
    const templateAction = plan.actions[0];
    expect(templateAction.status).toBe("update");
    const iconDrift = templateAction.diff?.find((d) => d.fieldId === SYSTEM_FIELDS.ICON);
    expect(iconDrift).toMatchObject({
      before: "Office/32x32/old-icon.png",
      after: "office/32x32/elements3.png",
    });
    expect(templateAction.mutation).toMatchObject({
      kind: "updateItem",
      input: { itemId: preloadedTemplateId },
    });
  });
});

describe("buildPlan — CreateOnly policy preserves CMS-owned items", () => {
  it("skips a CreateItem when the item already exists, regardless of drift", async () => {
    const ir = compileCta();
    const tweaked = {
      ...ir,
      operations: ir.operations.map((op, idx) =>
        idx === 0 ? { ...op, policy: "CreateOnly" as const } : op
      ),
    };
    const templateOp = ir.operations[0];
    if (templateOp.op !== "CreateItem") throw new Error("expected first op to be CreateItem");

    const client = new MockAuthoringClient();
    client.preload({
      itemId: "11111111-1111-1111-1111-111111111111",
      templateId: templateOp.templateOf,
      parentId: "00000000-0000-0000-0000-000000000aaa",
      name: templateOp.name,
      path: templateOp.path,
      fields: [{ fieldId: SYSTEM_FIELDS.ICON, value: "Office/32x32/old-icon.png" }],
    });
    const plan = await buildPlan(tweaked, client);
    expect(plan.actions[0].status).toBe("skip");
    expect(plan.actions[0].reason).toMatch(/CreateOnly/);
  });
});

describe("buildPlan — field name lookup is case-insensitive", () => {
  it("treats remote field GUIDs as equivalent regardless of case", async () => {
    const ir = compileCta();
    const client = new MockAuthoringClient();
    const expectedTemplateOp = ir.operations[0];
    if (expectedTemplateOp.op !== "CreateItem") {
      throw new Error("expected first op to be CreateItem");
    }
    client.preload({
      itemId: templateId("default", HANDLE),
      templateId: expectedTemplateOp.templateOf,
      parentId: "00000000-0000-0000-0000-000000000aaa",
      name: expectedTemplateOp.name,
      path: expectedTemplateOp.path,
      fields: expectedTemplateOp.fields.map((f) => ({
        fieldId: f.fieldId.toUpperCase(),
        value: renderRefValue(f.value),
        language: f.language,
        version: f.version,
      })),
    });
    const plan = await buildPlan({ ...ir, operations: [expectedTemplateOp] }, client);
    expect(plan.actions[0].status).toBe("skip");
  });
});

describe("buildPlan — fieldName-based diff matching", () => {
  it("matches remote fields by name (not GUID) when the IR carries fieldName, so recipe-created fields diff cleanly", async () => {
    // Simulate a content item already on the tenant whose Body field's
    // server-assigned GUID differs from the recipe-derived fieldId. Diff
    // must still find the existing value via name to plan an update (or a
    // skip if value matches), not a stale "field doesn't exist" entry.
    const itemId = "33333333-3333-3333-3333-333333333333";
    const recipeDerivedFieldId = "c8a15ad2-8107-5cdd-a248-8c94eff1488e";
    const serverAssignedFieldGuid = "44444444-4444-4444-4444-444444444444";
    const itemPath = "/sitecore/content/Demo/Data/Foo";

    const setBodyOp: import("../../../src/recipe/ir/operations").SetFieldOp = {
      op: "SetField",
      policy: "CreateAndUpdate",
      label: "content-item-field:foo@1:Body",
      itemRefKey: "55555555-5555-5555-5555-555555555555",
      fieldId: recipeDerivedFieldId,
      fieldName: "Body",
      language: "en",
      version: 1,
      value: { kind: "string", value: "Hello" },
    };

    const client = new MockAuthoringClient();
    client.preload({
      itemId,
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: "00000000-0000-0000-0000-000000000aaa",
      name: "Foo",
      path: itemPath,
      fields: [
        // Server-assigned GUID, different from the recipe-derived fieldId,
        // but same field name + matching value → should diff to "skip".
        { fieldId: serverAssignedFieldGuid, name: "Body", value: "Hello" },
      ],
    });

    const plan = await buildPlan(
      {
        schemaVersion: "1",
        recipeHandle: "foo@1",
        operations: [setBodyOp],
      },
      client,
      { capturedItemIds: new Map([[setBodyOp.itemRefKey, itemId]]) }
    );

    expect(plan.actions[0].status).toBe("skip");
    expect(plan.actions[0].reason).toMatch(/already at desired value/i);
  });

  it("plans an update when the name-matched remote value disagrees", async () => {
    const itemId = "66666666-6666-6666-6666-666666666666";
    const setBodyOp: import("../../../src/recipe/ir/operations").SetFieldOp = {
      op: "SetField",
      policy: "CreateAndUpdate",
      label: "content-item-field:foo@1:Body",
      itemRefKey: "77777777-7777-7777-7777-777777777777",
      fieldId: "c8a15ad2-8107-5cdd-a248-8c94eff1488e",
      fieldName: "Body",
      language: "en",
      version: 1,
      value: { kind: "string", value: "NewValue" },
    };
    const client = new MockAuthoringClient();
    client.preload({
      itemId,
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: "00000000-0000-0000-0000-000000000aaa",
      name: "Foo",
      path: "/sitecore/content/Demo/Data/Foo",
      fields: [
        {
          fieldId: "88888888-8888-8888-8888-888888888888",
          name: "Body",
          value: "OldValue",
        },
      ],
    });

    const plan = await buildPlan(
      {
        schemaVersion: "1",
        recipeHandle: "foo@1",
        operations: [setBodyOp],
      },
      client,
      { capturedItemIds: new Map([[setBodyOp.itemRefKey, itemId]]) }
    );

    expect(plan.actions[0].status).toBe("update");
    if (plan.actions[0].status === "update") {
      expect(plan.actions[0].diff).toEqual([
        {
          fieldId: setBodyOp.fieldId,
          before: "OldValue",
          after: "NewValue",
          language: "en",
          version: 1,
        },
      ]);
    }
  });
});
