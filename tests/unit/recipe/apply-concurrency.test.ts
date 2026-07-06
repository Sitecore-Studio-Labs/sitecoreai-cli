import { describe, expect, it } from "vitest";
import { ctaButtonRecipe } from "../../../example/recipes/cta-button.recipe";
import type { UpdateItemInput } from "../../../src/recipe/api/client";
import { compileComponentTemplateRecipe } from "../../../src/recipe/compile";
import type {
  AppendToMultiListOp,
  CreateItemOp,
  OperationIr,
  SetFieldOp,
} from "../../../src/recipe/ir/operations";
import { type ExecutionEvent, executeIr } from "../../../src/recipe/runtime/execute";
import { MockAuthoringClient } from "./_fixtures/mock-client";

// Coverage for `ExecuteOptions.applyConcurrency` — the bounded updateItem
// flush pool. The contract under test:
//   - updates to DISTINCT items overlap on the wire, capped at the limit;
//   - same-cell (itemId, language, version) writes queued behind an
//     in-flight write coalesce into ONE updateItem call;
//   - writes to the SAME item never reorder;
//   - read-merge-write ops (AppendToMultiList) and non-updateItem
//     mutations act as pool barriers, so their plans read settled state;
//   - failure semantics are identical to the sequential path (fatal →
//     rollback + aborted result; unregistered-language → skip).

const CONTEXT = {
  templatesRoot: "/sitecore/templates/Project/sandbox/Components",
  renderingsRoot: "/sitecore/layout/Renderings/Project/sandbox",
  headlessVariantsRoot: "/sitecore/content/test-tenant/sandbox/Presentation/Headless Variants",
  enumerationsRoot: "/sitecore/content/test-tenant/sandbox/Settings/Enumerations",
};

const compileCta = () => compileComponentTemplateRecipe(ctaButtonRecipe, CONTEXT);

const ROOT = "/sitecore/content/pool-test";
const TEMPLATE_ID = "ab86861a-6030-46c5-b394-e8f99e8b87db";

const refKey = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const fieldId = (n: number): string => `11111111-1111-1111-1111-${String(n).padStart(12, "0")}`;

const createOp = (n: number, name: string): CreateItemOp => ({
  op: "CreateItem",
  policy: "CreateAndUpdate",
  label: `create:${name}`,
  id: refKey(n),
  path: `${ROOT}/${name}`,
  parent: { kind: "ref-path", value: ROOT },
  templateOf: TEMPLATE_ID,
  fields: [],
  name,
});

const setFieldOp = (
  target: number,
  field: number,
  value: string,
  language?: string
): SetFieldOp => ({
  op: "SetField",
  policy: "CreateAndUpdate",
  label: `set:${target}:${field}`,
  itemRefKey: refKey(target),
  fieldId: fieldId(field),
  fieldName: `Field${field}`,
  value: { kind: "string", value },
  ...(language !== undefined ? { language } : {}),
});

const ir = (operations: OperationIr["operations"]): OperationIr => ({
  schemaVersion: "1",
  recipeHandle: "pool-test@1",
  operations,
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mock client whose `updateItem` holds the wire open for `delayMs` while
 * tracking in-flight overlap — how the tests observe concurrency and give
 * queued-but-not-started same-cell writes a window to coalesce in.
 */
class SlowUpdateClient extends MockAuthoringClient {
  inFlight = 0;
  maxInFlight = 0;

  constructor(private readonly delayMs: number) {
    super();
  }

  override async updateItem(input: UpdateItemInput): Promise<void> {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      await sleep(this.delayMs);
      await super.updateItem(input);
    } finally {
      this.inFlight -= 1;
    }
  }
}

const fieldValueOf = (client: MockAuthoringClient, path: string, fid: string): string => {
  const item = client.peek({ path });
  if (!item) throw new Error(`item not found at ${path}`);
  const field = item.fields.find((f) => f.fieldId.toLowerCase() === fid.toLowerCase());
  if (!field) throw new Error(`field ${fid} not found on ${path}`);
  return field.value;
};

describe("executeIr — applyConcurrency pool", () => {
  it("overlaps updates to distinct items, capped at the configured limit", async () => {
    const client = new SlowUpdateClient(25);
    const items = [1, 2, 3, 4, 5, 6];
    const operations = [
      ...items.map((n) => createOp(n, `Item${n}`)),
      ...items.map((n) => setFieldOp(n, 1, `value-${n}`)),
    ];

    const result = await executeIr(ir(operations), client, {
      mode: "apply",
      applyConcurrency: 3,
    });

    expect(result.aborted).toBe(false);
    expect(client.updates).toHaveLength(6);
    // All six enqueue within microtasks while each write holds the wire
    // for 25ms — the semaphore is what stops overlap at 3.
    expect(client.maxInFlight).toBe(3);
    for (const n of items) {
      expect(fieldValueOf(client, `${ROOT}/Item${n}`, fieldId(1))).toBe(`value-${n}`);
    }
  });

  it("stays strictly serial when applyConcurrency is unset", async () => {
    const client = new SlowUpdateClient(5);
    const items = [1, 2, 3];
    const operations = [
      ...items.map((n) => createOp(n, `Item${n}`)),
      ...items.map((n) => setFieldOp(n, 1, `value-${n}`)),
    ];

    const result = await executeIr(ir(operations), client, { mode: "apply" });

    expect(result.aborted).toBe(false);
    expect(client.updates).toHaveLength(3);
    expect(client.maxInFlight).toBe(1);
  });

  it("coalesces same-cell writes queued behind an in-flight write into one updateItem", async () => {
    const client = new SlowUpdateClient(25);
    const operations = [
      createOp(1, "A"),
      setFieldOp(1, 1, "one"),
      setFieldOp(1, 2, "two"),
      setFieldOp(1, 3, "three"),
    ];

    const events: ExecutionEvent[] = [];
    const result = await executeIr(ir(operations), client, {
      mode: "apply",
      applyConcurrency: 4,
      emit: (e) => events.push(e),
    });

    expect(result.aborted).toBe(false);
    // Per-item chain: field 1's write claims the cell and holds the wire;
    // fields 2 and 3 queue into the next cell and flush as ONE call.
    expect(client.updates).toHaveLength(2);
    expect(client.updates[0].fields).toHaveLength(1);
    expect(client.updates[1].fields).toHaveLength(2);
    // Coalescing changes the wire shape, not the semantics: every field
    // lands, and every action still reports its own apply-success.
    expect(fieldValueOf(client, `${ROOT}/A`, fieldId(1))).toBe("one");
    expect(fieldValueOf(client, `${ROOT}/A`, fieldId(2))).toBe("two");
    expect(fieldValueOf(client, `${ROOT}/A`, fieldId(3))).toBe("three");
    expect(result.summary.update).toBe(3);
    expect(events.filter((e) => e.kind === "apply-success")).toHaveLength(4); // create + 3 updates
  });

  it("drains the pool before an AppendToMultiList reads the field it merges into", async () => {
    const client = new SlowUpdateClient(25);
    const existing = "99999999-9999-9999-9999-999999999999";
    const appended = "88888888-8888-8888-8888-888888888888";
    const listField = fieldId(7);
    const appendOp: AppendToMultiListOp = {
      op: "AppendToMultiList",
      policy: "CreateAndUpdate",
      label: "append:test",
      itemRefKey: refKey(1),
      fieldId: listField,
      fieldName: "Field7",
      values: [{ kind: "ref-guid", value: appended }],
      appendPolicy: "merge-unique",
    };
    const operations = [
      createOp(1, "Section"),
      // Pooled write seeds the multi-list; the append's read-merge-write
      // MUST see it settled or the merge loses this value.
      setFieldOp(1, 7, `{${existing.toUpperCase()}}`),
      appendOp,
    ];

    const result = await executeIr(ir(operations), client, {
      mode: "apply",
      applyConcurrency: 4,
    });

    expect(result.aborted).toBe(false);
    const merged = fieldValueOf(client, `${ROOT}/Section`, listField).toLowerCase();
    expect(merged).toContain(existing);
    expect(merged).toContain(appended);
  });

  it("a pooled apply failure rolls back and aborts with sequential semantics", async () => {
    class FailingUpdateClient extends MockAuthoringClient {
      override async updateItem(): Promise<void> {
        throw new Error("wire down");
      }
    }
    const client = new FailingUpdateClient();
    const events: ExecutionEvent[] = [];
    const result = await executeIr(compileCta(), client, {
      mode: "apply",
      applyConcurrency: 4,
      emit: (e) => events.push(e),
    });

    expect(result.aborted).toBe(true);
    expect(result.rollback).toBeDefined();
    expect(events.some((e) => e.kind === "apply-error" && e.error === "wire down")).toBe(true);
    expect(events.some((e) => e.kind === "failed")).toBe(true);
  });

  it("skips a pooled non-primary-language write against an unregistered language", async () => {
    class NoFrenchClient extends MockAuthoringClient {
      override async updateItem(input: UpdateItemInput): Promise<void> {
        if (input.language === "fr") {
          throw new Error("The specified language 'fr' is not defined on this environment.");
        }
        return super.updateItem(input);
      }
    }
    const client = new NoFrenchClient();
    const operations = [
      createOp(1, "A"),
      setFieldOp(1, 1, "Bienvenue", "fr"),
      // A later pooled write on the same item must still land — the
      // language skip is tolerated, not escalated to fatal.
      setFieldOp(1, 2, "Welcome", "en"),
    ];

    const events: ExecutionEvent[] = [];
    const result = await executeIr(ir(operations), client, {
      mode: "apply",
      applyConcurrency: 4,
      emit: (e) => events.push(e),
    });

    expect(result.aborted).toBe(false);
    expect(result.rollback).toBeUndefined();
    expect(events.some((e) => e.kind === "apply-skip" && e.language === "fr")).toBe(true);
    expect(events.some((e) => e.kind === "apply-error")).toBe(false);
    expect(result.summary.skip).toBe(1);
    expect(fieldValueOf(client, `${ROOT}/A`, fieldId(2))).toBe("Welcome");
  });

  it("pooled apply converges: summary matches sequential, and a re-push is all skips", async () => {
    const recipeIr = compileCta();

    const pooled = new MockAuthoringClient();
    const first = await executeIr(recipeIr, pooled, { mode: "apply", applyConcurrency: 4 });
    expect(first.aborted).toBe(false);

    const sequential = new MockAuthoringClient();
    const sequentialResult = await executeIr(recipeIr, sequential, { mode: "apply" });
    // Same plan outcomes op-for-op — coalescing changes wire-call count,
    // never action classification.
    expect(first.summary).toEqual(sequentialResult.summary);

    // Second pooled apply against post-first state: pooled writes must
    // have landed exactly as planned or the planner would see drift.
    const second = await executeIr(recipeIr, pooled, { mode: "apply", applyConcurrency: 4 });
    expect(second.aborted).toBe(false);
    expect(second.summary.create).toBe(0);
    expect(second.summary.update).toBe(0);
    expect(second.summary.skip).toBe(recipeIr.operations.length);
  });
});
