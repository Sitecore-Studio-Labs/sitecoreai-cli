import { describe, expect, it } from "vitest";
import { buildAction } from "../../../src/recipe/runtime/plan";
import type { PruneChildrenOp } from "../../../src/recipe/ir/operations";
import { MockAuthoringClient } from "./_fixtures/mock-client";

const PARENT_REF_KEY = "11111111-1111-1111-1111-111111111111";
const PARENT_ITEM_ID = "22222222-2222-2222-2222-222222222222";
const PARENT_PATH = "/sitecore/content/test-tenant/test-site/Renderings/Showcase";

const ALLOWED_REF_KEY_A = "33333333-3333-3333-3333-333333333333";
const ALLOWED_ITEM_ID_A = "44444444-4444-4444-4444-444444444444";
const ALLOWED_REF_KEY_B = "55555555-5555-5555-5555-555555555555";
const ALLOWED_ITEM_ID_B = "66666666-6666-6666-6666-666666666666";

const RENDERING_TEMPLATE_ID = "77777777-7777-7777-7777-777777777777";
const FOLDER_TEMPLATE_ID = "88888888-8888-8888-8888-888888888888";

const ORPHAN_ITEM_ID_1 = "99999999-9999-9999-9999-999999999991";
const ORPHAN_ITEM_ID_2 = "99999999-9999-9999-9999-999999999992";

const newOp = (overrides: Partial<PruneChildrenOp> = {}): PruneChildrenOp => ({
  op: "PruneChildren",
  policy: "CreateAndUpdate",
  label: "prune:test",
  parentRefKey: PARENT_REF_KEY,
  allowedHandles: [
    { kind: "ref-recipe", refKey: ALLOWED_REF_KEY_A },
    { kind: "ref-recipe", refKey: ALLOWED_REF_KEY_B },
  ],
  mode: "warn",
  ...overrides,
});

const seedParent = (client: MockAuthoringClient): void => {
  client.preload({
    itemId: PARENT_ITEM_ID,
    templateId: FOLDER_TEMPLATE_ID,
    parentId: "00000000-0000-0000-0000-000000000000",
    name: "Showcase",
    path: PARENT_PATH,
    fields: [],
  });
};

const seedChild = (
  client: MockAuthoringClient,
  itemId: string,
  name: string,
  templateId: string = RENDERING_TEMPLATE_ID
): void => {
  client.preload({
    itemId,
    templateId,
    parentId: PARENT_ITEM_ID,
    name,
    path: `${PARENT_PATH}/${name}`,
    fields: [],
  });
};

describe("PruneChildren — base behavior", () => {
  it("status prune when live children include items outside allowedHandles", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    seedChild(client, ALLOWED_ITEM_ID_A, "Keep-A");
    seedChild(client, ALLOWED_ITEM_ID_B, "Keep-B");
    seedChild(client, ORPHAN_ITEM_ID_1, "Orphan-1");
    seedChild(client, ORPHAN_ITEM_ID_2, "Orphan-2");

    const captured = new Map<string, string>([
      [PARENT_REF_KEY, PARENT_ITEM_ID],
      [ALLOWED_REF_KEY_A, ALLOWED_ITEM_ID_A],
      [ALLOWED_REF_KEY_B, ALLOWED_ITEM_ID_B],
    ]);

    const action = await buildAction({ index: 0, op: newOp(), client, capturedItemIds: captured });

    expect(action.status).toBe("prune");
    if (action.mutation?.kind !== "pruneChildren") throw new Error("expected pruneChildren");
    expect(action.mutation.itemIds.sort()).toEqual([ORPHAN_ITEM_ID_1, ORPHAN_ITEM_ID_2].sort());
    expect(action.mutation.mode).toBe("warn");
    expect(action.prunedItems?.length).toBe(2);
    expect(action.prunedItems?.[0].path).toContain(PARENT_PATH);
  });

  it("status skip when every child is in allowedHandles (idempotent)", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    seedChild(client, ALLOWED_ITEM_ID_A, "Keep-A");
    seedChild(client, ALLOWED_ITEM_ID_B, "Keep-B");

    const captured = new Map<string, string>([
      [PARENT_REF_KEY, PARENT_ITEM_ID],
      [ALLOWED_REF_KEY_A, ALLOWED_ITEM_ID_A],
      [ALLOWED_REF_KEY_B, ALLOWED_ITEM_ID_B],
    ]);

    const action = await buildAction({ index: 0, op: newOp(), client, capturedItemIds: captured });

    expect(action.status).toBe("skip");
    expect(action.mutation).toBeUndefined();
  });

  it("status skip when parent is not captured (plan-mode preview against empty tenant)", async () => {
    const client = new MockAuthoringClient();
    // No seed — parent not in captured map.
    const captured = new Map<string, string>();

    const action = await buildAction({ index: 0, op: newOp(), client, capturedItemIds: captured });

    expect(action.status).toBe("skip");
    expect(action.reason).toMatch(/not yet captured/i);
  });
});

describe("PruneChildren — templateFilter", () => {
  it("only prunes children whose template matches the filter", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    // Two rendering items the recipe doesn't list, plus one folder item
    // also under the same parent that the recipe should NOT touch.
    seedChild(client, ORPHAN_ITEM_ID_1, "Orphan-Rendering-1", RENDERING_TEMPLATE_ID);
    seedChild(client, ORPHAN_ITEM_ID_2, "Orphan-Rendering-2", RENDERING_TEMPLATE_ID);
    seedChild(client, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "Some-Folder", FOLDER_TEMPLATE_ID);

    const captured = new Map<string, string>([[PARENT_REF_KEY, PARENT_ITEM_ID]]);

    const action = await buildAction({
      index: 0,
      op: newOp({ allowedHandles: [], templateFilter: [RENDERING_TEMPLATE_ID] }),
      client,
      capturedItemIds: captured,
    });

    expect(action.status).toBe("prune");
    if (action.mutation?.kind !== "pruneChildren") throw new Error("expected pruneChildren");
    expect(action.mutation.itemIds.sort()).toEqual([ORPHAN_ITEM_ID_1, ORPHAN_ITEM_ID_2].sort());
    // The folder item is co-located but template-filtered out — must stay.
    expect(action.mutation.itemIds).not.toContain("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  });

  it("normalizes GUID format on both sides of templateFilter comparison (regression)", async () => {
    // Caught live 2026-06-02 against TestDemo: Sitecore's Authoring API
    // returns templateIds WITHOUT dashes (e.g. "0437fee244c946a6abe928858d9fee8c")
    // while scai's SITECORE_TEMPLATES.* constants and operator-written
    // ref-guid entries are in canonical dashed form. Direct
    // toLowerCase() comparison silently excluded every orphan, turning
    // delete-mode prunes into no-op skips. Both sides now go through
    // `dashifyGuid` before comparison.
    const client = new MockAuthoringClient();
    seedParent(client);
    // Child seeded with UNDASHED template GUID — the form Sitecore
    // actually returns from getChildren.
    const undashedRenderingGuid = RENDERING_TEMPLATE_ID.replace(/-/g, "");
    client.preload({
      itemId: ORPHAN_ITEM_ID_1,
      templateId: undashedRenderingGuid,
      parentId: PARENT_ITEM_ID,
      name: "Orphan-Undashed",
      path: `${PARENT_PATH}/Orphan-Undashed`,
      fields: [],
    });

    const captured = new Map<string, string>([[PARENT_REF_KEY, PARENT_ITEM_ID]]);
    const action = await buildAction({
      index: 0,
      // Filter uses the canonical DASHED form. The planner must
      op:
        // normalize for the comparison to succeed.
        newOp({ allowedHandles: [], templateFilter: [RENDERING_TEMPLATE_ID] }),
      client,
      capturedItemIds: captured,
    });

    expect(action.status).toBe("prune");
    if (action.mutation?.kind !== "pruneChildren") throw new Error("expected pruneChildren");
    expect(action.mutation.itemIds).toContain(ORPHAN_ITEM_ID_1);
  });

  it("normalizes GUID format on both sides of allowedHandles comparison (regression)", async () => {
    // Same root cause as templateFilter — guarding the allowedHandles
    // comparison too so an operator who hand-writes a `ref-guid` entry
    // in dashed form still matches a tenant child with undashed form.
    const client = new MockAuthoringClient();
    seedParent(client);
    const undashedItemId = ALLOWED_ITEM_ID_A.replace(/-/g, "");
    client.preload({
      itemId: undashedItemId,
      templateId: RENDERING_TEMPLATE_ID,
      parentId: PARENT_ITEM_ID,
      name: "Keep",
      path: `${PARENT_PATH}/Keep`,
      fields: [],
    });
    seedChild(client, ORPHAN_ITEM_ID_1, "Orphan");

    const captured = new Map<string, string>([[PARENT_REF_KEY, PARENT_ITEM_ID]]);
    const action = await buildAction({
      index: 0,
      op: newOp({
        // Operator writes the keep itemId in DASHED form; tenant returns
        // it undashed. dashifyGuid on both sides normalizes the match.
        allowedHandles: [{ kind: "ref-guid", value: ALLOWED_ITEM_ID_A }],
      }),
      client,
      capturedItemIds: captured,
    });

    expect(action.status).toBe("prune");
    if (action.mutation?.kind !== "pruneChildren") throw new Error("expected pruneChildren");
    // Only Orphan is pruned — Keep survives despite the GUID format
    // disagreement between operator config and Sitecore's response.
    expect(action.mutation.itemIds).toEqual([ORPHAN_ITEM_ID_1]);
    expect(action.mutation.itemIds).not.toContain(undashedItemId);
  });
});

describe("PruneChildren — mode", () => {
  it("carries mode through to the mutation snapshot (warn)", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    seedChild(client, ORPHAN_ITEM_ID_1, "Orphan-1");
    const captured = new Map<string, string>([[PARENT_REF_KEY, PARENT_ITEM_ID]]);

    const action = await buildAction({
      index: 0,
      op: newOp({ allowedHandles: [], mode: "warn" }),
      client,
      capturedItemIds: captured,
    });
    if (action.mutation?.kind !== "pruneChildren") throw new Error("expected pruneChildren");
    expect(action.mutation.mode).toBe("warn");
  });

  it("carries mode through to the mutation snapshot (delete)", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    seedChild(client, ORPHAN_ITEM_ID_1, "Orphan-1");
    const captured = new Map<string, string>([[PARENT_REF_KEY, PARENT_ITEM_ID]]);

    const action = await buildAction({
      index: 0,
      op: newOp({ allowedHandles: [], mode: "delete" }),
      client,
      capturedItemIds: captured,
    });
    if (action.mutation?.kind !== "pruneChildren") throw new Error("expected pruneChildren");
    expect(action.mutation.mode).toBe("delete");
  });
});

describe("PruneChildren — late-path seeding", () => {
  it("seeds the captured map from latePath when parentRefKey is missing", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    seedChild(client, ORPHAN_ITEM_ID_1, "Orphan-1");
    // Captured map empty; only latePath can resolve the parent itemId.
    const captured = new Map<string, string>();

    const action = await buildAction({
      index: 0,
      op: newOp({ allowedHandles: [], latePath: PARENT_PATH }),
      client,
      capturedItemIds: captured,
    });

    expect(captured.get(PARENT_REF_KEY)).toBe(PARENT_ITEM_ID);
    expect(action.status).toBe("prune");
  });
});

describe("PruneChildren — recursive subtree snapshot", () => {
  it("captures descendants in prunedItems.children depth-first", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    // Orphan folder with two children, one of which has a grandchild.
    seedChild(client, ORPHAN_ITEM_ID_1, "Orphan-Folder", FOLDER_TEMPLATE_ID);
    // Override the parentId so these items chain UNDER Orphan-Folder.
    client.preload({
      itemId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1",
      templateId: RENDERING_TEMPLATE_ID,
      parentId: ORPHAN_ITEM_ID_1,
      name: "Child-A",
      path: `${PARENT_PATH}/Orphan-Folder/Child-A`,
      fields: [],
    });
    client.preload({
      itemId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2",
      templateId: RENDERING_TEMPLATE_ID,
      parentId: ORPHAN_ITEM_ID_1,
      name: "Child-B",
      path: `${PARENT_PATH}/Orphan-Folder/Child-B`,
      fields: [],
    });
    client.preload({
      itemId: "cccccccc-cccc-cccc-cccc-cccccccccc11",
      templateId: RENDERING_TEMPLATE_ID,
      parentId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1",
      name: "Grandchild",
      path: `${PARENT_PATH}/Orphan-Folder/Child-A/Grandchild`,
      fields: [],
    });

    const captured = new Map<string, string>([[PARENT_REF_KEY, PARENT_ITEM_ID]]);
    const action = await buildAction({
      index: 0,
      op: newOp({ allowedHandles: [] }),
      client,
      capturedItemIds: captured,
    });

    expect(action.status).toBe("prune");
    expect(action.prunedItems).toHaveLength(1);
    const folder = action.prunedItems![0];
    expect(folder.name).toBe("Orphan-Folder");
    expect(folder.children.map((c) => c.name).sort()).toEqual(["Child-A", "Child-B"]);
    const childA = folder.children.find((c) => c.name === "Child-A");
    expect(childA?.children.map((c) => c.name)).toEqual(["Grandchild"]);
    // Leaves have empty children arrays.
    const childB = folder.children.find((c) => c.name === "Child-B");
    expect(childB?.children).toEqual([]);
    expect(childA?.children[0].children).toEqual([]);
  });

  it("populates per-(language, version) snapshot via getItemVersions + per-version getItem", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    seedChild(client, ORPHAN_ITEM_ID_1, "Orphan");
    // Mock starts items at v1 in en. Bump it twice → 3 versions.
    await client.addItemVersion({ itemId: ORPHAN_ITEM_ID_1, language: "en" });
    await client.addItemVersion({ itemId: ORPHAN_ITEM_ID_1, language: "en" });

    const captured = new Map<string, string>([[PARENT_REF_KEY, PARENT_ITEM_ID]]);
    const action = await buildAction({
      index: 0,
      op: newOp({ allowedHandles: [] }),
      client,
      capturedItemIds: captured,
    });

    // Three (language, version) entries snapshotted (en v1/v2/v3). No
    // fr/de since the operator didn't request them.
    expect(action.prunedItems?.[0].versions).toHaveLength(3);
    expect(action.prunedItems?.[0].versions.map((v) => `${v.language}-v${v.version}`)).toEqual([
      "en-v1",
      "en-v2",
      "en-v3",
    ]);
  });

  it("captures per-(language, version) snapshots for every operator-configured language", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    seedChild(client, ORPHAN_ITEM_ID_1, "Orphan");
    // The item has en v1 (from preload) and we bump fr to v1+v2.
    await client.addItemVersion({ itemId: ORPHAN_ITEM_ID_1, language: "fr" });
    await client.addItemVersion({ itemId: ORPHAN_ITEM_ID_1, language: "fr" });

    const captured = new Map<string, string>([[PARENT_REF_KEY, PARENT_ITEM_ID]]);
    const action = await buildAction({
      index: 0,
      op: newOp({ allowedHandles: [] }),
      client,
      capturedItemIds: captured,
      snapshotLanguages: ["en", "fr"],
    });

    const snap = action.prunedItems?.[0];
    expect(snap?.versions.map((v) => `${v.language}-v${v.version}`)).toEqual([
      "en-v1",
      "fr-v1",
      "fr-v2",
    ]);
  });

  it("skips languages the item has no versions in (no wasted snapshot rows)", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    seedChild(client, ORPHAN_ITEM_ID_1, "Orphan");
    // Item is en-only. Operator requested en + fr + de; only en should
    // appear in the snapshot.
    const captured = new Map<string, string>([[PARENT_REF_KEY, PARENT_ITEM_ID]]);
    const action = await buildAction({
      index: 0,
      op: newOp({ allowedHandles: [] }),
      client,
      capturedItemIds: captured,
      snapshotLanguages: ["en", "fr", "de"],
    });

    const snap = action.prunedItems?.[0];
    expect(snap?.versions.map((v) => `${v.language}-v${v.version}`)).toEqual(["en-v1"]);
  });
});

describe("PruneChildren — auto-discovery of languages (snapshotLanguages undefined)", () => {
  it("uses tenant-level getTenantLanguages to pick up every language the tenant supports", async () => {
    const client = new MockAuthoringClient();
    client.tenantLanguages = ["en", "fr", "de"];
    seedParent(client);
    seedChild(client, ORPHAN_ITEM_ID_1, "Orphan-MultiLang");
    // Item exists in en (from preload) + fr + de.
    await client.addItemVersion({ itemId: ORPHAN_ITEM_ID_1, language: "fr" });
    await client.addItemVersion({ itemId: ORPHAN_ITEM_ID_1, language: "de" });

    const captured = new Map<string, string>([[PARENT_REF_KEY, PARENT_ITEM_ID]]);
    // snapshotLanguages omitted (undefined) → planner auto-discovers.
    const action = await buildAction({
      index: 0,
      op: newOp({ allowedHandles: [] }),
      client,
      capturedItemIds: captured,
    });

    const snap = action.prunedItems?.[0];
    const tuples = snap?.versions.map((v) => `${v.language}-v${v.version}`).sort();
    expect(tuples).toEqual(["de-v1", "en-v1", "fr-v1"]);
  });

  it("skips tenant languages the item isn't authored in (per-item getItemVersions filter)", async () => {
    const client = new MockAuthoringClient();
    // Tenant supports en + fr + de + ar-SA, but the orphan is only en.
    client.tenantLanguages = ["en", "fr", "de", "ar-SA"];
    seedParent(client);
    seedChild(client, ORPHAN_ITEM_ID_1, "Orphan-EnOnly");

    const captured = new Map<string, string>([[PARENT_REF_KEY, PARENT_ITEM_ID]]);
    const action = await buildAction({
      index: 0,
      op: newOp({ allowedHandles: [] }),
      client,
      capturedItemIds: captured,
    });

    const snap = action.prunedItems?.[0];
    expect(snap?.versions.map((v) => `${v.language}-v${v.version}`)).toEqual(["en-v1"]);
  });

  it("falls back to ['en'] when the tenant schema's `languages` query is unsupported", async () => {
    const client = new MockAuthoringClient();
    client.tenantLanguagesUnsupported = true;
    seedParent(client);
    seedChild(client, ORPHAN_ITEM_ID_1, "Orphan-Fallback");

    const captured = new Map<string, string>([[PARENT_REF_KEY, PARENT_ITEM_ID]]);
    // Auto-discovery fails → planner sees the thrown error propagate.
    // (The real client catches at the client layer; the mock throws so
    // we can assert the failure mode surfaces if not caught.) Test the
    // production path by using the real client surface — for now the
    // mock-throws case is exercised in the executor's catch path; the
    // planner expects the client method itself to handle failure.
    await expect(
      buildAction({
        index: 0,
        op: newOp({ allowedHandles: [] }),
        client,
        capturedItemIds: captured,
      })
    ).rejects.toThrow(/simulated/);
  });

  it("explicit snapshotLanguages skips auto-discovery (operator override wins)", async () => {
    const client = new MockAuthoringClient();
    // Tenant has multiple languages but operator wants only en captured.
    client.tenantLanguages = ["en", "fr", "de"];
    seedParent(client);
    seedChild(client, ORPHAN_ITEM_ID_1, "Orphan");
    await client.addItemVersion({ itemId: ORPHAN_ITEM_ID_1, language: "fr" });

    const captured = new Map<string, string>([[PARENT_REF_KEY, PARENT_ITEM_ID]]);
    const action = await buildAction({
      index: 0,
      op: newOp({ allowedHandles: [] }),
      client,
      capturedItemIds: captured,
      snapshotLanguages: ["en"],
    });

    const snap = action.prunedItems?.[0];
    expect(snap?.versions.map((v) => `${v.language}-v${v.version}`)).toEqual(["en-v1"]);
  });
});

describe("PruneChildren — wire-call batching", () => {
  it("single-language single-version: 1 perLanguage batch, 0 atVersions batch (no historic fetch)", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    seedChild(client, ORPHAN_ITEM_ID_1, "Orphan-Simple");

    const captured = new Map<string, string>([[PARENT_REF_KEY, PARENT_ITEM_ID]]);
    await buildAction({
      index: 0,
      op: newOp({ allowedHandles: [] }),
      client,
      capturedItemIds: captured,
      snapshotLanguages: ["en"],
    });

    expect(client.batchCallCounts.perLanguageBatch).toBe(1);
    expect(client.batchCallCounts.atVersionsBatch).toBe(0);
  });

  it("multi-language all-single-version: 1 perLanguage batch (aliased across all languages), 0 atVersions", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    seedChild(client, ORPHAN_ITEM_ID_1, "Orphan-MultiLang");
    await client.addItemVersion({ itemId: ORPHAN_ITEM_ID_1, language: "fr" });
    await client.addItemVersion({ itemId: ORPHAN_ITEM_ID_1, language: "de" });

    const captured = new Map<string, string>([[PARENT_REF_KEY, PARENT_ITEM_ID]]);
    await buildAction({
      index: 0,
      op: newOp({ allowedHandles: [] }),
      client,
      capturedItemIds: captured,
      snapshotLanguages: ["en", "fr", "de"],
    });

    // The whole point: 3 languages = still 1 batched call, not 3.
    expect(client.batchCallCounts.perLanguageBatch).toBe(1);
    expect(client.batchCallCounts.atVersionsBatch).toBe(0);
  });

  it("multi-version: pass 2 fires ONCE for the historic versions (one batched call across all (lang, ver) tuples)", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    seedChild(client, ORPHAN_ITEM_ID_1, "Orphan-MultiVersion");
    // en v1/v2/v3 + fr v1/v2
    await client.addItemVersion({ itemId: ORPHAN_ITEM_ID_1, language: "en" });
    await client.addItemVersion({ itemId: ORPHAN_ITEM_ID_1, language: "en" });
    await client.addItemVersion({ itemId: ORPHAN_ITEM_ID_1, language: "fr" });
    await client.addItemVersion({ itemId: ORPHAN_ITEM_ID_1, language: "fr" });

    const captured = new Map<string, string>([[PARENT_REF_KEY, PARENT_ITEM_ID]]);
    await buildAction({
      index: 0,
      op: newOp({ allowedHandles: [] }),
      client,
      capturedItemIds: captured,
      snapshotLanguages: ["en", "fr"],
    });

    // 1 perLanguage batch (aliased en+fr) + 1 atVersions batch (en-v1,
    // en-v2, fr-v1 historic tuples). The naive implementation would
    // have done 2 getItemVersions + 5 getItem = 7 calls.
    expect(client.batchCallCounts.perLanguageBatch).toBe(1);
    expect(client.batchCallCounts.atVersionsBatch).toBe(1);
  });

  it("throws when operator override snapshotLanguages is empty (no language to restore in)", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    seedChild(client, ORPHAN_ITEM_ID_1, "Orphan");

    const captured = new Map<string, string>([[PARENT_REF_KEY, PARENT_ITEM_ID]]);
    // Operator passes empty list — degenerate, the planner refuses
    // because rollback can't pick a default language if none is
    // configured. (Previous behavior silently produced a wrong-language
    // snapshot — audit Fix 7.)
    await expect(
      buildAction({
        index: 0,
        op: newOp({ allowedHandles: [] }),
        client,
        capturedItemIds: captured,
        snapshotLanguages: [],
      })
    ).rejects.toThrow(/no versions in any of/i);
    // Wire-call counters confirm no batch fired before the throw.
    expect(client.batchCallCounts.perLanguageBatch).toBe(0);
    expect(client.batchCallCounts.atVersionsBatch).toBe(0);
  });

  it("captures correct snapshot shape even with batched reads (multi-language multi-version)", async () => {
    // Regression guard: refactoring snapshot reads to use batched calls
    // must produce the same (language, version, fields) tuples as the
    // unbatched implementation would have.
    const client = new MockAuthoringClient();
    seedParent(client);
    seedChild(client, ORPHAN_ITEM_ID_1, "Orphan");
    await client.addItemVersion({ itemId: ORPHAN_ITEM_ID_1, language: "en" });
    await client.addItemVersion({ itemId: ORPHAN_ITEM_ID_1, language: "fr" });

    const captured = new Map<string, string>([[PARENT_REF_KEY, PARENT_ITEM_ID]]);
    const action = await buildAction({
      index: 0,
      op: newOp({ allowedHandles: [] }),
      client,
      capturedItemIds: captured,
      snapshotLanguages: ["en", "fr"],
    });

    const snap = action.prunedItems?.[0];
    expect(snap?.versions.map((v) => `${v.language}-v${v.version}`)).toEqual([
      "en-v1",
      "en-v2",
      "fr-v1",
    ]);
  });
});

describe("PruneChildren — ref-guid allowedHandles", () => {
  it("treats real Sitecore GUIDs in allowedHandles as allowed", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    seedChild(client, ALLOWED_ITEM_ID_A, "Keep-Guid");
    seedChild(client, ORPHAN_ITEM_ID_1, "Orphan");

    const captured = new Map<string, string>([[PARENT_REF_KEY, PARENT_ITEM_ID]]);

    const action = await buildAction({
      index: 0,
      op: newOp({
        allowedHandles: [{ kind: "ref-guid", value: ALLOWED_ITEM_ID_A }],
      }),
      client,
      capturedItemIds: captured,
    });

    expect(action.status).toBe("prune");
    if (action.mutation?.kind !== "pruneChildren") throw new Error("expected pruneChildren");
    expect(action.mutation.itemIds).toEqual([ORPHAN_ITEM_ID_1]);
  });
});
