import { describe, expect, it } from "vitest";
import type { GetItemOptions, ItemSelector, RemoteItem } from "../../../src/recipe/api/client";
import type {
  AddItemVersionOp,
  CreateItemOp,
  OperationIr,
  SetFieldOp,
} from "../../../src/recipe/ir/operations";
import { executeIr } from "../../../src/recipe/runtime/execute";
import { MockAuthoringClient } from "./_fixtures/mock-client";

// Coverage for `ExecuteOptions.idSnapshotCache` / `versionStackCache` —
// the push-scoped plan-read caches. The contract under test:
//   - ops targeting a captured itemId read the cached snapshot instead of
//     paying a per-op `getItem({ itemId })` round trip (created items are
//     seeded at create time; pre-existing items cache their first read);
//   - `planAddItemVersion` reads an item's version stacks ONCE via a
//     single `getItemPerLanguageBatch` covering every language the IR
//     adds, instead of one `getItemVersions` per add op;
//   - write-through keeps plans truthful: a second write to a field an
//     earlier op in the same push set plans as no-drift skip;
//   - snapshot merges are copy-on-write, so the pre-op `snapshot`
//     attached to earlier actions (rollback state) stays frozen.

const ROOT = "/sitecore/content/cache-test";
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
  language?: string,
  version?: number
): SetFieldOp => ({
  op: "SetField",
  policy: "CreateAndUpdate",
  label: `set:${target}:${field}`,
  itemRefKey: refKey(target),
  fieldId: fieldId(field),
  fieldName: `Field${field}`,
  value: { kind: "string", value },
  ...(language !== undefined ? { language } : {}),
  ...(version !== undefined ? { version } : {}),
});

const addVersionOp = (target: number, language: string): AddItemVersionOp => ({
  op: "AddItemVersion",
  policy: "CreateAndUpdate",
  label: `add-version:${target}:${language}`,
  itemRefKey: refKey(target),
  language,
  version: 1,
});

const ir = (operations: OperationIr["operations"]): OperationIr => ({
  schemaVersion: "1",
  recipeHandle: "cache-test@1",
  operations,
});

/** Mock that counts read calls so tests assert wire-read elimination. */
class CountingClient extends MockAuthoringClient {
  getItemByIdCalls = 0;
  getItemVersionsCalls = 0;

  override async getItem(
    selector: ItemSelector,
    options?: GetItemOptions
  ): Promise<RemoteItem | null> {
    if (selector.itemId !== undefined) this.getItemByIdCalls += 1;
    return super.getItem(selector, options);
  }

  override async getItemVersions(selector: ItemSelector, language: string): Promise<number[]> {
    this.getItemVersionsCalls += 1;
    return super.getItemVersions(selector, language);
  }
}

const caches = () => ({
  idSnapshotCache: new Map<string, RemoteItem>(),
  versionStackCache: new Map<string, Map<string, number>>(),
});

const fieldValueOf = (client: MockAuthoringClient, path: string, fid: string): string => {
  const item = client.peek({ path });
  if (!item) throw new Error(`item not found at ${path}`);
  const field = item.fields.find((f) => f.fieldId.toLowerCase() === fid.toLowerCase());
  if (!field) throw new Error(`field ${fid} not found on ${path}`);
  return field.value;
};

describe("executeIr — plan-read caches", () => {
  it("plans update ops on a created item without any getItem({itemId}) round trips", async () => {
    const client = new CountingClient();
    const operations = [
      createOp(1, "A"),
      setFieldOp(1, 1, "one"),
      setFieldOp(1, 2, "two"),
      setFieldOp(1, 3, "three"),
    ];

    const result = await executeIr(ir(operations), client, {
      mode: "apply",
      applyConcurrency: 4,
      ...caches(),
    });

    expect(result.aborted).toBe(false);
    // The create seeds the itemId snapshot; every SetField plan hits it.
    expect(client.getItemByIdCalls).toBe(0);
    for (const [n, value] of [
      [1, "one"],
      [2, "two"],
      [3, "three"],
    ] as const) {
      expect(fieldValueOf(client, `${ROOT}/A`, fieldId(n))).toBe(value);
    }
  });

  it("caches the first wire read for a PRE-EXISTING item and dedupes the rest", async () => {
    const client = new CountingClient();
    client.preload({
      itemId: "feedfacefeedfacefeedfacefeedface",
      templateId: TEMPLATE_ID,
      parentId: "",
      name: "Existing",
      path: `${ROOT}/Existing`,
      fields: [],
    });
    const operations = [
      createOp(1, "Existing"), // plans as existing → captures the itemId
      setFieldOp(1, 1, "one"),
      setFieldOp(1, 2, "two"),
      setFieldOp(1, 3, "three"),
    ];

    const result = await executeIr(ir(operations), client, {
      mode: "apply",
      applyConcurrency: 4,
      ...caches(),
    });

    expect(result.aborted).toBe(false);
    // No create ran, so nothing seeded the cache — the first SetField
    // pays the read, the remaining two hit the cache.
    expect(client.getItemByIdCalls).toBe(1);
    expect(client.updates.length).toBeGreaterThan(0);
  });

  it("reads an item's version stacks once via getItemPerLanguageBatch for all its adds", async () => {
    const client = new CountingClient();
    const operations = [
      createOp(1, "Localized"),
      addVersionOp(1, "fr-FR"),
      addVersionOp(1, "de-DE"),
      addVersionOp(1, "ja-JP"),
      setFieldOp(1, 1, "bonjour", "fr-FR", 1),
      setFieldOp(1, 1, "hallo", "de-DE", 1),
      setFieldOp(1, 1, "こんにちは", "ja-JP", 1),
    ];

    const result = await executeIr(ir(operations), client, {
      mode: "apply",
      applyConcurrency: 4,
      ...caches(),
    });

    expect(result.aborted).toBe(false);
    expect(client.versionAdds).toHaveLength(3);
    // One batched read covering fr-FR + de-DE + ja-JP; zero per-op reads.
    expect(client.getItemVersionsCalls).toBe(0);
    expect(client.batchCallCounts.perLanguageBatch).toBe(1);
    // Write-through: the batch never re-fires for later adds, and the
    // itemId snapshot covers the SetFields too.
    expect(client.getItemByIdCalls).toBe(0);
  });

  it("write-through makes a same-value re-write in a later IR plan as no-drift skip", async () => {
    const client = new CountingClient();
    const shared = { ...caches(), createdItemRefKeys: new Set<string>() };
    const first = await executeIr(ir([createOp(1, "A"), setFieldOp(1, 1, "same")]), client, {
      mode: "apply",
      applyConcurrency: 4,
      ...shared,
    });
    expect(first.aborted).toBe(false);
    const updatesAfterFirst = client.updates.length;

    // Same push (shared caches), later IR re-writes the same value — the
    // merged snapshot already carries it, so the op skips without a read.
    const second = await executeIr(ir([setFieldOp(1, 1, "same")]), client, {
      mode: "apply",
      applyConcurrency: 4,
      ...shared,
      crossRecipeRefs: new Map([[refKey(1), `${ROOT}/A`]]),
    });
    expect(second.aborted).toBe(false);
    expect(second.plan.actions[0].status).toBe("skip");
    expect(client.updates.length).toBe(updatesAfterFirst);
    expect(client.getItemByIdCalls).toBe(0);
  });

  it("merges snapshots copy-on-write so earlier actions' rollback snapshots stay frozen", async () => {
    const client = new CountingClient();
    const operations = [createOp(1, "A"), setFieldOp(1, 1, "one"), setFieldOp(1, 1, "two")];

    const result = await executeIr(ir(operations), client, {
      mode: "apply",
      applyConcurrency: 4,
      ...caches(),
    });

    expect(result.aborted).toBe(false);
    const [, firstSet, secondSet] = result.plan.actions;
    // First SetField planned against the create's synthetic snapshot —
    // Field1 absent. Second planned against the merged snapshot — "one".
    const valueIn = (snapshot: RemoteItem | null | undefined): string | undefined =>
      snapshot?.fields.find((f) => f.fieldId.toLowerCase() === fieldId(1).toLowerCase())?.value;
    expect(valueIn(firstSet.snapshot)).toBeUndefined();
    expect(valueIn(secondSet.snapshot)).toBe("one");
    // Convergence: last write wins on the wire.
    expect(fieldValueOf(client, `${ROOT}/A`, fieldId(1))).toBe("two");
  });

  it("without the caches, behavior and per-op reads match the historical path", async () => {
    const client = new CountingClient();
    const operations = [
      createOp(1, "Legacy"),
      addVersionOp(1, "fr-FR"),
      setFieldOp(1, 1, "one"),
      setFieldOp(1, 2, "two"),
    ];

    const result = await executeIr(ir(operations), client, {
      mode: "apply",
      applyConcurrency: 4,
    });

    expect(result.aborted).toBe(false);
    // Historical: one getItem({itemId}) per update-style op, one
    // getItemVersions per add, no batch reads.
    expect(client.getItemByIdCalls).toBe(3);
    expect(client.getItemVersionsCalls).toBe(1);
    expect(client.batchCallCounts.perLanguageBatch).toBe(0);
  });
});
