import { describe, expect, it } from "vitest";
import { buildPlan } from "../../../src/recipe/plan";
import { templatePathRefKey } from "../../../src/recipe/guids";
import type { OperationIr } from "../../../src/recipe/ir/operations";
import { MockAuthoringClient } from "./_fixtures/mock-client";

/**
 * Round-trip tests for the new `templateOf: { kind: "ref-path", value }`
 * variant. The push pipeline pre-seeds `crossRecipeRefs` from CreateItem
 * ops; we bypass that and pass `capturedItemIds` directly to `buildPlan`.
 */

const PATH = "/sitecore/templates/System/Workflow/Workflow";

const irForOneCreate = (templateOf: { kind: "ref-path"; value: string }): OperationIr => ({
  schemaVersion: "1",
  recipeHandle: "wf-test@1",
  operations: [
    {
      op: "CreateItem",
      policy: "CreateAndUpdate",
      label: "wf",
      id: "11111111-1111-1111-1111-111111111111",
      path: "/sitecore/system/Workflows/TestWorkflow",
      parent: { kind: "ref-path", value: "/sitecore/system/Workflows" },
      templateOf,
      name: "TestWorkflow",
      fields: [],
    },
  ],
});

describe("buildPlan — templateOf: ref-path", () => {
  it("plans a create when the templatePathRefKey is pre-seeded in capturedItemIds", async () => {
    const ir = irForOneCreate({ kind: "ref-path", value: PATH });
    const client = new MockAuthoringClient();
    const captured = new Map<string, string>([
      [templatePathRefKey(PATH), "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
    ]);

    const plan = await buildPlan(ir, client, { capturedItemIds: captured });
    const action = plan.actions[0]!;

    expect(action.status).toBe("create");
    expect(action.mutation).toMatchObject({
      kind: "createItem",
      input: { templateId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
    });
  });

  it("skips with a clear reason when the template path was not seeded (missing on tenant)", async () => {
    const ir = irForOneCreate({ kind: "ref-path", value: PATH });
    const client = new MockAuthoringClient();

    const plan = await buildPlan(ir, client, { capturedItemIds: new Map() });
    const action = plan.actions[0]!;

    expect(action.status).toBe("skip");
    expect(action.reason ?? "").toContain(PATH);
  });
});
