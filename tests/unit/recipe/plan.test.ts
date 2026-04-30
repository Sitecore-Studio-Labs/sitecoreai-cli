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
      after: "Office/32x32/document.png",
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
      itemId: templateId(HANDLE),
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
