import { describe, expect, it } from "vitest";
import { compileComponentTemplateRecipe } from "../../../src/recipe/compile";
import { ctaButtonRecipe } from "../../../example/recipes/cta-button.recipe";
import { executeIr, type ExecutionEvent } from "../../../src/recipe/execute";
import { templateId } from "../../../src/recipe/guids";
import { SYSTEM_FIELDS } from "../../../src/recipe/ir/sitecore-templates";
import { inverseOf, rollback, type RollbackEvent } from "../../../src/recipe/rollback";
import type { PlannedAction } from "../../../src/recipe/plan";
import type { CreateItemOp, SetBaseTemplatesOp } from "../../../src/recipe/ir/operations";
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

const STANDARD_TPL = "1930bbeb-7805-471a-a3be-4858ac7cf696";

describe("inverseOf — applied createItem inverts to deleteItem", () => {
  it("derives deleteItem(itemId) from a createItem mutation by looking up the captured itemId", () => {
    const refKey = "11111111-1111-1111-1111-111111111111";
    const assignedItemId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const op: CreateItemOp = {
      op: "CreateItem",
      policy: "CreateAndUpdate",
      label: "template:cta-button@1",
      id: refKey,
      path: "/sitecore/templates/CtaButton",
      parent: { kind: "ref-path", value: "/sitecore/templates" },
      templateOf: "ab86861a-6030-46c5-b394-e8f99e8b87db",
      name: "CtaButton",
      fields: [],
    };
    const action: PlannedAction = {
      index: 0,
      operation: op,
      status: "create",
      mutation: {
        kind: "createItem",
        input: {
          parent: "/sitecore/templates",
          templateId: op.templateOf,
          name: op.name,
          fields: op.fields,
        },
      },
      snapshot: null,
    };
    const captured = new Map([[refKey, assignedItemId]]);
    expect(inverseOf(action, captured)).toEqual({
      kind: "deleteItem",
      itemId: assignedItemId,
    });
  });

  it("throws when the createItem's refKey was never captured (defensive guard)", () => {
    const op: CreateItemOp = {
      op: "CreateItem",
      policy: "CreateAndUpdate",
      label: "template:cta-button@1",
      id: "11111111-1111-1111-1111-111111111111",
      path: "/sitecore/templates/CtaButton",
      parent: { kind: "ref-path", value: "/sitecore/templates" },
      templateOf: "ab86861a-6030-46c5-b394-e8f99e8b87db",
      name: "CtaButton",
      fields: [],
    };
    const action: PlannedAction = {
      index: 0,
      operation: op,
      status: "create",
      mutation: {
        kind: "createItem",
        input: {
          parent: "/sitecore/templates",
          templateId: op.templateOf,
          name: op.name,
          fields: [],
        },
      },
      snapshot: null,
    };
    expect(() => inverseOf(action, new Map())).toThrow(/no captured itemId/);
  });
});

describe("inverseOf — applied updateItem reverts each touched field", () => {
  it("uses the prior snapshot value for each touched field", () => {
    const targetItemId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const op: SetBaseTemplatesOp = {
      op: "SetBaseTemplates",
      policy: "CreateAndUpdate",
      label: "base-templates:cta-button@1",
      itemRefKey: "11111111-1111-1111-1111-111111111111",
      baseTemplates: [STANDARD_TPL],
    };
    const action: PlannedAction = {
      index: 1,
      operation: op,
      status: "update",
      mutation: {
        kind: "updateItem",
        input: {
          itemId: targetItemId,
          fields: [
            {
              fieldId: SYSTEM_FIELDS.BASE_TEMPLATE,
              value: { kind: "ref-guid-list", values: op.baseTemplates },
            },
          ],
        },
      },
      snapshot: {
        itemId: targetItemId,
        templateId: "ab86861a-6030-46c5-b394-e8f99e8b87db",
        parentId: "00000000-0000-0000-0000-000000000aaa",
        name: "CtaButton",
        path: "/sitecore/templates/CtaButton",
        fields: [{ fieldId: SYSTEM_FIELDS.BASE_TEMPLATE, value: "{PRIOR-BASE-TPL-GUID}" }],
      },
    };
    expect(inverseOf(action, new Map())).toEqual({
      kind: "updateItem",
      input: {
        itemId: targetItemId,
        fields: [
          {
            fieldId: SYSTEM_FIELDS.BASE_TEMPLATE,
            language: undefined,
            version: undefined,
            value: { kind: "string", value: "{PRIOR-BASE-TPL-GUID}" },
          },
        ],
      },
    });
  });

  it("clears (empty string) when the field had no prior value", () => {
    const targetItemId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const op: SetBaseTemplatesOp = {
      op: "SetBaseTemplates",
      policy: "CreateAndUpdate",
      label: "base-templates:fresh@1",
      itemRefKey: "22222222-2222-2222-2222-222222222222",
      baseTemplates: [STANDARD_TPL],
    };
    const action: PlannedAction = {
      index: 0,
      operation: op,
      status: "update",
      mutation: {
        kind: "updateItem",
        input: {
          itemId: targetItemId,
          fields: [
            {
              fieldId: SYSTEM_FIELDS.BASE_TEMPLATE,
              value: { kind: "ref-guid-list", values: op.baseTemplates },
            },
          ],
        },
      },
      // Snapshot exists but has no __Base template field — common
      // "first-push update style op" case where the parent item was just
      // created and didn't have the field yet.
      snapshot: {
        itemId: targetItemId,
        templateId: "ab86861a-6030-46c5-b394-e8f99e8b87db",
        parentId: "00000000-0000-0000-0000-000000000aaa",
        name: "Fresh",
        path: "/sitecore/templates/Fresh",
        fields: [{ fieldId: SYSTEM_FIELDS.ICON, value: "Office/32x32/document.png" }],
      },
    };
    const inverse = inverseOf(action, new Map());
    expect(inverse).toEqual({
      kind: "updateItem",
      input: {
        itemId: targetItemId,
        fields: [
          {
            fieldId: SYSTEM_FIELDS.BASE_TEMPLATE,
            language: undefined,
            version: undefined,
            value: { kind: "string", value: "" },
          },
        ],
      },
    });
  });
});

describe("inverseOf — actions without a forward mutation have no inverse", () => {
  it("returns null for skipped actions", () => {
    const op: CreateItemOp = {
      op: "CreateItem",
      policy: "CreateOnly",
      label: "template:already-there@1",
      id: "33333333-3333-3333-3333-333333333333",
      path: "/sitecore/templates/AlreadyThere",
      parent: { kind: "ref-path", value: "/sitecore/templates" },
      templateOf: "ab86861a-6030-46c5-b394-e8f99e8b87db",
      name: "AlreadyThere",
      fields: [],
    };
    const action: PlannedAction = {
      index: 0,
      operation: op,
      status: "skip",
      reason: "Item already exists and policy is CreateOnly.",
      snapshot: null,
    };
    expect(inverseOf(action, new Map())).toBeNull();
  });
});

/**
 * Build a small applied-actions list backed by a mock client that genuinely
 * created the items, so the captured-itemId map matches what the executor
 * would record at apply time.
 */
const buildAppliedSequence = async (count: number) => {
  const client = new MockAuthoringClient();
  const captured = new Map<string, string>();
  const applied: PlannedAction[] = [];
  for (let index = 0; index < count; index += 1) {
    const refKey = `11111111-1111-1111-1111-1111111111${index.toString(16).padStart(2, "0")}`;
    const op: CreateItemOp = {
      op: "CreateItem",
      policy: "CreateAndUpdate",
      label: `template:test/${index}`,
      id: refKey,
      path: `/sitecore/templates/Test${index}`,
      parent: { kind: "ref-path", value: "/sitecore/templates" },
      templateOf: "ab86861a-6030-46c5-b394-e8f99e8b87db",
      name: `Test${index}`,
      fields: [],
    };
    const result = await client.createItem({
      parent: "/sitecore/templates",
      templateId: op.templateOf,
      name: op.name,
      fields: [],
    });
    captured.set(refKey, result.itemId);
    applied.push({
      index,
      operation: op,
      status: "create",
      mutation: {
        kind: "createItem",
        input: {
          parent: "/sitecore/templates",
          templateId: op.templateOf,
          name: op.name,
          fields: [],
        },
      },
      snapshot: null,
    });
  }
  return { client, captured, applied };
};

describe("rollback — LIFO unwind", () => {
  it("dispatches inverses in reverse order of application", async () => {
    const { client, captured, applied } = await buildAppliedSequence(3);
    const events: RollbackEvent[] = [];
    const result = await rollback(applied, client, captured, {
      emit: (e) => events.push(e),
    });

    expect(result.rolledBack).toBe(3);
    expect(result.errors).toHaveLength(0);
    // All three items removed from the mock.
    for (const refKey of captured.keys()) {
      expect(client.peek({ itemId: captured.get(refKey)! })).toBeUndefined();
    }
    // Event order proves LIFO: most-recent first.
    const successes = events.filter((e) => e.kind === "rollback-success");
    expect(successes.map((e) => e.action.operation.label)).toEqual([
      "template:test/2",
      "template:test/1",
      "template:test/0",
    ]);
  });
});

describe("rollback — best-effort", () => {
  it("a rollback step that errors is logged + counted but does NOT abort remaining rollbacks", async () => {
    const { client, captured, applied } = await buildAppliedSequence(3);
    const middleAssignedId = captured.get(applied[1].operation.id)!;

    // Stage a rollback failure on the middle item by overriding deleteItem
    // to throw for that one selector.
    const originalDelete = client.deleteItem.bind(client);
    client.deleteItem = async (selector) => {
      if (selector.itemId === middleAssignedId) {
        throw new Error("simulated permission denied");
      }
      return originalDelete(selector);
    };

    const events: RollbackEvent[] = [];
    const result = await rollback(applied, client, captured, {
      emit: (e) => events.push(e),
    });

    expect(result.rolledBack).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].label).toBe("template:test/1");
    expect(result.errors[0].error).toMatch(/permission denied/);
    // Both successes and the one failure must appear in the event stream.
    expect(events.filter((e) => e.kind === "rollback-success")).toHaveLength(2);
    expect(events.filter((e) => e.kind === "rollback-failed")).toHaveLength(1);
  });
});

describe("executeIr — apply error triggers rollback + terminal failed event", () => {
  it("rolls back applied ops in LIFO order and emits a `failed` terminal event", async () => {
    const ir = compileCta();
    const client = new MockAuthoringClient();
    // Make the section createItem fail: it's the 3rd op overall (template,
    // base-templates updateItem, section). Match by name "Content".
    client.throwOn = {
      method: "createItem",
      match: "Content",
      message: "Sitecore rejected the section",
    };

    const events: ExecutionEvent[] = [];
    const result = await executeIr(ir, client, {
      mode: "apply",
      emit: (e) => events.push(e),
    });

    expect(result.aborted).toBe(true);
    expect(result.rollback).toBeDefined();
    expect(result.rollback?.errors).toHaveLength(0);

    // Before the section failed, the executor applied:
    //   1. createItem(template) — creates the item
    //   2. updateItem(template) — SetBaseTemplates added __Base template field
    // Rollback should LIFO: undo the updateItem first, then deleteItem the template.
    // The template was assigned a fresh itemId by the mock; assert it was
    // deleted by checking the path-keyed lookup is empty.
    expect(client.peek({ path: `${CONTEXT.templatesRoot}/CtaButton` })).toBeUndefined();
    // Rollback ran two inverses (the SetBaseTemplates updateItem revert and the template deleteItem).
    expect(result.rollback?.rolledBack).toBe(2);

    const failedEvent = events.find(
      (e): e is Extract<ExecutionEvent, { kind: "failed" }> => e.kind === "failed"
    );
    expect(failedEvent).toBeDefined();
    expect(failedEvent?.applied).toBe(2);
    expect(failedEvent?.rolledBack).toBe(2);
    expect(failedEvent?.rollbackErrors).toEqual([]);
    expect(failedEvent?.error).toMatch(/Sitecore rejected the section/);
    // Rollback events fired in LIFO order (most recently applied first).
    const rollbackSuccesses = events.filter((e) => e.kind === "rollback-success");
    expect(rollbackSuccesses[0].action.operation.label).toBe("base-templates:cta-button@1");
    expect(rollbackSuccesses[1].action.operation.label).toBe("template:cta-button@1");
    // Sanity: the template's refKey was the one our deletion targeted.
    expect(rollbackSuccesses[1].action.operation.op).toBe("CreateItem");
    if (rollbackSuccesses[1].action.operation.op === "CreateItem") {
      expect(rollbackSuccesses[1].action.operation.id).toBe(templateId("default", "cta-button@1"));
    }
  });
});
