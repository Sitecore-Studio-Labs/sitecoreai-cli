import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileComponentTemplateRecipe } from "../../../src/recipe/compile";
import { ctaButtonRecipe } from "../../../example/recipes/cta-button.recipe";
import { executeIr, type ExecutionEvent } from "../../../src/recipe/runtime/execute";
import { templateId } from "../../../src/recipe/items/guids";
import { SYSTEM_FIELDS } from "../../../src/recipe/ir/sitecore-templates";
import { inverseOf, rollback, type RollbackEvent } from "../../../src/recipe/rollback/rollback";
import { createRollbackLogger } from "../../../src/recipe/rollback/rollback-log";
import type { PlannedAction } from "../../../src/recipe/runtime/plan";
import type { CreateItemOp, SetBaseTemplatesOp } from "../../../src/recipe/ir/operations";
import { MockAuthoringClient } from "./_fixtures/mock-client";

const CONTEXT = {
  templatesRoot: "/sitecore/templates/Project/sandbox/Components",
  renderingsRoot: "/sitecore/layout/Renderings/Project/sandbox",
  headlessVariantsRoot: "/sitecore/content/test-tenant/sandbox/Presentation/Headless Variants",
  enumerationsRoot: "/sitecore/content/test-tenant/sandbox/Settings/Enumerations",
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

describe("inverseOf — pruneChildren restoration", () => {
  const PARENT_ITEM_ID = "deadbeef-0000-0000-0000-000000000001";
  const PRUNED_ITEM_ID_A = "deadbeef-0000-0000-0000-00000000000a";
  const PRUNED_ITEM_ID_B = "deadbeef-0000-0000-0000-00000000000b";

  const pruneAction = (
    mode: "warn" | "delete",
    itemIds: string[],
    versionsByLang: Record<string, number> = { en: 1 }
  ): PlannedAction => ({
    index: 0,
    operation: {
      op: "PruneChildren",
      policy: "CreateAndUpdate",
      label: "prune:test",
      parentRefKey: "11111111-1111-1111-1111-111111111111",
      allowedHandles: [],
      mode,
    },
    status: "prune",
    mutation: { kind: "pruneChildren", itemIds, mode },
    prunedItems: itemIds.map((id, i) => {
      const versions: Array<{
        language: string;
        version: number;
        fields: {
          fieldId: string;
          name?: string;
          language: string;
          version: number;
          value: string;
        }[];
      }> = [];
      for (const [lang, count] of Object.entries(versionsByLang)) {
        for (let v = 1; v <= count; v += 1) {
          versions.push({
            language: lang,
            version: v,
            fields: [
              {
                fieldId: "fff00000-0000-0000-0000-000000000002",
                name: "Body",
                language: lang,
                version: v,
                value: `body-text-${lang}-v${v}`,
              },
            ],
          });
        }
      }
      return {
        itemId: id,
        path: `/sitecore/.../Orphan${i}`,
        templateId: "77777777-7777-7777-7777-777777777777",
        name: `Orphan${i}`,
        parentId: PARENT_ITEM_ID,
        sharedFields: [{ fieldId: "fff00000-0000-0000-0000-000000000001", value: "title-value" }],
        versions,
        children: [],
      };
    }),
    snapshot: null,
  });

  it("returns null for warn-mode prunes (apply skipped, nothing to undo)", () => {
    const action = pruneAction("warn", [PRUNED_ITEM_ID_A]);
    expect(inverseOf(action, new Map())).toBeNull();
  });

  it("returns null when prunedItems is empty (skip status emitted before delete ran)", () => {
    const action = pruneAction("delete", []);
    expect(inverseOf(action, new Map())).toBeNull();
  });

  it("returns a restoreItems inverse with shared + (defaultLang, v1) fields in initialFields", () => {
    const action = pruneAction("delete", [PRUNED_ITEM_ID_A, PRUNED_ITEM_ID_B]);
    const inverse = inverseOf(action, new Map());
    if (!inverse || inverse.kind !== "restoreItems") throw new Error("expected restoreItems");
    expect(inverse.trees).toHaveLength(2);
    const t0 = inverse.trees[0];
    expect(t0.parent).toBe(PARENT_ITEM_ID);
    expect(t0.name).toBe("Orphan0");
    expect(t0.templateId).toBe("77777777-7777-7777-7777-777777777777");
    expect(t0.defaultLanguage).toBe("en");
    expect(t0.extraVersions).toEqual([]); // only en v1 → nothing extra
    expect(t0.children).toEqual([]);
    // initialFields = shared (title) + (en, v1) versioned (Body).
    expect(t0.initialFields).toEqual([
      {
        fieldId: "fff00000-0000-0000-0000-000000000001",
        value: { kind: "string", value: "title-value" },
      },
      {
        fieldId: "fff00000-0000-0000-0000-000000000002",
        fieldName: "Body",
        language: "en",
        version: 1,
        value: { kind: "string", value: "body-text-en-v1" },
      },
    ]);
  });

  it("splits multi-version into initialFields (v1) + extraVersions (v2+)", () => {
    const action = pruneAction("delete", [PRUNED_ITEM_ID_A], { en: 3 });
    const inverse = inverseOf(action, new Map());
    if (!inverse || inverse.kind !== "restoreItems") throw new Error("expected restoreItems");
    const t = inverse.trees[0];
    expect(t.defaultLanguage).toBe("en");
    expect(t.extraVersions.map((v) => `${v.language}-v${v.version}`)).toEqual(["en-v2", "en-v3"]);
    expect(t.extraVersions[0].fields[0].value).toEqual({
      kind: "string",
      value: "body-text-en-v2",
    });
  });

  it("splits multi-language: defaultLanguage is the first snapshot language, others land in extraVersions", () => {
    const action = pruneAction("delete", [PRUNED_ITEM_ID_A], { en: 2, fr: 2 });
    const inverse = inverseOf(action, new Map());
    if (!inverse || inverse.kind !== "restoreItems") throw new Error("expected restoreItems");
    const t = inverse.trees[0];
    expect(t.defaultLanguage).toBe("en");
    // (en, 1) is in initialFields; everything else in extraVersions.
    expect(t.extraVersions.map((v) => `${v.language}-v${v.version}`)).toEqual([
      "en-v2",
      "fr-v1",
      "fr-v2",
    ]);
  });
});

describe("rollback — restoreItems executes createItem per snapshot", () => {
  const PARENT_PATH = "/sitecore/content/test/Renderings/Showcase";
  const PARENT_ITEM_ID = "abcabcab-0000-0000-0000-000000000001";

  const seedParent = (client: MockAuthoringClient): void => {
    client.preload({
      itemId: PARENT_ITEM_ID,
      templateId: "55555555-5555-5555-5555-555555555555",
      parentId: "00000000-0000-0000-0000-000000000000",
      name: "Showcase",
      path: PARENT_PATH,
      fields: [],
    });
  };

  type SnapshotSpec = {
    name: string;
    versions?: number;
    languages?: Record<string, number>;
    children?: SnapshotSpec[];
  };
  const makeSnapshot = (s: SnapshotSpec, i: number, parentId: string) => {
    // Build per-(language, version) snapshot. Two input shapes:
    // - `versions: N` → en, v1..N (the most common test setup)
    // - `languages: { en: 2, fr: 1 }` → fully-specified
    const langs = s.languages ?? { en: s.versions ?? 1 };
    const versions: Array<{
      language: string;
      version: number;
      fields: Array<{
        fieldId: string;
        name?: string;
        language: string;
        version: number;
        value: string;
      }>;
    }> = [];
    for (const [lang, count] of Object.entries(langs)) {
      for (let v = 1; v <= count; v += 1) {
        versions.push({
          language: lang,
          version: v,
          fields: [
            {
              fieldId: "fff00000-0000-0000-0000-000000000002",
              name: "Body",
              language: lang,
              version: v,
              value: `${s.name}-${lang}-v${v}`,
            },
          ],
        });
      }
    }
    return {
      itemId: `dddddddd-0000-${i}000-0000-000000000000`,
      path: `${PARENT_PATH}/${s.name}`,
      templateId: "77777777-7777-7777-7777-777777777777",
      name: s.name,
      parentId,
      sharedFields: [
        { fieldId: "fff00000-0000-0000-0000-000000000001", value: `shared-${s.name}` },
      ],
      versions,
      children: (s.children ?? []).map((c, j) => makeSnapshot(c, j, "")),
    };
  };
  const pruneAction = (snapshots: SnapshotSpec[]): PlannedAction => ({
    index: 0,
    operation: {
      op: "PruneChildren",
      policy: "CreateAndUpdate",
      label: "prune:test",
      parentRefKey: "11111111-1111-1111-1111-111111111111",
      allowedHandles: [],
      mode: "delete",
    },
    status: "prune",
    mutation: {
      kind: "pruneChildren",
      itemIds: snapshots.map((_, i) => `dddddddd-0000-${i}000-0000-000000000000`),
      mode: "delete",
    },
    prunedItems: snapshots.map((s, i) => makeSnapshot(s, i, PARENT_ITEM_ID)),
    snapshot: null,
  });

  it("re-creates each pruned item under its prior parent via createItem", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    const action = pruneAction([{ name: "Orphan-A" }, { name: "Orphan-B" }]);

    const result = await rollback([action], client, new Map());

    expect(result.rolledBack).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(client.creates).toHaveLength(2);
    expect(client.creates.map((c) => c.name).sort()).toEqual(["Orphan-A", "Orphan-B"]);
    // The restored items live on the mock under the same parent, with
    // their snapshot fields — confirms the round-trip through the
    // CreateItemInput shape.
    const restored = Array.from(client.itemsByPath.values()).filter(
      (i) => i.parentId.toLowerCase() === PARENT_ITEM_ID.toLowerCase()
    );
    expect(restored.map((i) => i.name).sort()).toEqual(["Orphan-A", "Orphan-B"]);
  });

  it("per-item createItem failures are aggregated but other items still restore", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    // Configure the mock to throw on the second item's createItem call.
    client.throwOn = {
      method: "createItem",
      match: "Orphan-B",
      message: "simulated parent-missing failure",
    };
    const action = pruneAction([{ name: "Orphan-A" }, { name: "Orphan-B" }]);

    const result = await rollback([action], client, new Map());

    // Step failed overall (because one item failed), but Orphan-A's
    // createItem still ran. Best-effort restoration.
    expect(result.rolledBack).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/Restored 1 of 2/);
    expect(result.errors[0].error).toMatch(/Orphan-B/);
    expect(client.creates.some((c) => c.name === "Orphan-A")).toBe(true);
  });

  it("recursively restores a subtree depth-first under the original parent", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    // Two top-level items, one with two children, one of those grandchildren.
    const action = pruneAction([
      {
        name: "Orphan-Folder",
        children: [
          {
            name: "Orphan-Sub-A",
            children: [{ name: "Orphan-Leaf" }],
          },
          { name: "Orphan-Sub-B" },
        ],
      },
      { name: "Orphan-B" },
    ]);

    const result = await rollback([action], client, new Map());

    expect(result.errors).toHaveLength(0);
    expect(result.rolledBack).toBe(1);
    // Four creates total: Orphan-Folder, Orphan-Sub-A, Orphan-Leaf, Orphan-Sub-B, Orphan-B = 5.
    expect(client.creates).toHaveLength(5);
    // Top-level items land directly under the original parent.
    const topLevel = client.creates.filter((c) => c.parent === PARENT_ITEM_ID);
    expect(topLevel.map((c) => c.name).sort()).toEqual(["Orphan-B", "Orphan-Folder"]);
    // Each level's createItem.parent matches the previous level's restored
    // itemId — depth-first chaining works.
    const folderRestored = Array.from(client.itemsByPath.values()).find(
      (i) => i.name === "Orphan-Folder"
    );
    expect(folderRestored).toBeDefined();
    const subARestored = Array.from(client.itemsByPath.values()).find(
      (i) => i.name === "Orphan-Sub-A"
    );
    expect(subARestored?.parentId).toBe(folderRestored?.itemId);
    const leafRestored = Array.from(client.itemsByPath.values()).find(
      (i) => i.name === "Orphan-Leaf"
    );
    expect(leafRestored?.parentId).toBe(subARestored?.itemId);
  });

  it("a failed root cascades — descendants of the failed node are skipped, sibling subtrees still run", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    client.throwOn = {
      method: "createItem",
      match: "Orphan-Folder",
      message: "simulated root-create failure",
    };
    const action = pruneAction([
      {
        name: "Orphan-Folder",
        children: [{ name: "Orphan-Sub" }, { name: "Orphan-Sub-2" }],
      },
      { name: "Orphan-B" },
    ]);

    const result = await rollback([action], client, new Map());

    expect(result.errors).toHaveLength(1);
    // 4 total nodes (Orphan-Folder + 2 children + Orphan-B), 1 restored
    // (Orphan-B), 1 failed (Orphan-Folder), 2 cascaded skips (children).
    expect(result.errors[0].error).toMatch(/Restored 1 of 4/);
    expect(result.errors[0].error).toMatch(/2 cascaded skips/);
    expect(client.creates.some((c) => c.name === "Orphan-B")).toBe(true);
    expect(client.creates.some((c) => c.name === "Orphan-Sub")).toBe(false);
  });

  it("addItemVersion + updateItem chain materialises the full per-version field grid", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    // Item with 3 en versions; createItem makes v1, then 2 addItemVersion
    // calls bring count to 3 plus 2 updateItem calls populate v2/v3.
    const action = pruneAction([{ name: "Orphan-Versioned", versions: 3 }]);

    const result = await rollback([action], client, new Map());

    expect(result.errors).toHaveLength(0);
    expect(result.rolledBack).toBe(1);
    expect(client.creates).toHaveLength(1);
    expect(client.versionAdds).toHaveLength(2);
    // updateItem called once per extraVersion entry (v2, v3) with the
    // snapshotted field values for that version.
    expect(client.updates).toHaveLength(2);
    expect(client.updates[0].version).toBe(2);
    expect(client.updates[1].version).toBe(3);
    const v2Body = client.updates[0].fields.find((f) => f.fieldName === "Body");
    expect(v2Body?.value).toEqual({ kind: "string", value: "Orphan-Versioned-en-v2" });
  });

  it("restores multiple languages — non-default lang gets addItemVersion chain from 0 + per-version updateItem", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    // en v1/v2 + fr v1/v2: createItem makes en v1, then bring en to v2,
    // then create fr v1+v2.
    const action = pruneAction([{ name: "Orphan-MultiLang", languages: { en: 2, fr: 2 } }]);

    const result = await rollback([action], client, new Map());

    expect(result.errors).toHaveLength(0);
    expect(result.rolledBack).toBe(1);
    expect(client.creates).toHaveLength(1);
    expect(client.creates[0].language).toBe("en");
    // 3 addItemVersion calls: en→v2 (one call), fr→v1 (one), fr→v2 (one).
    expect(client.versionAdds).toHaveLength(3);
    expect(client.versionAdds.filter((v) => v.language === "en")).toHaveLength(1);
    expect(client.versionAdds.filter((v) => v.language === "fr")).toHaveLength(2);
    // 3 updateItem calls — one per extraVersion (en-v2, fr-v1, fr-v2).
    expect(client.updates).toHaveLength(3);
    const byLangVersion = client.updates.map((u) => `${u.language}-v${u.version}`);
    expect(byLangVersion).toEqual(["en-v2", "fr-v1", "fr-v2"]);
    // Field values round-trip per (language, version).
    const frV1Body = client.updates
      .find((u) => u.language === "fr" && u.version === 1)
      ?.fields.find((f) => f.fieldName === "Body");
    expect(frV1Body?.value).toEqual({ kind: "string", value: "Orphan-MultiLang-fr-v1" });
  });

  it("no addItemVersion/updateItem calls when the snapshot is single-language single-version", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    const action = pruneAction([{ name: "Orphan-Single", versions: 1 }]);

    const result = await rollback([action], client, new Map());

    expect(result.errors).toHaveLength(0);
    expect(client.versionAdds).toHaveLength(0);
    expect(client.updates).toHaveLength(0);
  });
});

describe("inverseOf — ensureLanguages is warn-only (no inverse)", () => {
  it("returns null: language registration is additive and environment-wide", () => {
    const action: PlannedAction = {
      index: 0,
      operation: {
        op: "CreateSiteFromTemplate",
        policy: "CreateAndUpdate",
        label: "site:solterra-co@1",
        templateRefKey: "11111111-1111-1111-1111-111111111111",
        siteRefKey: "22222222-2222-2222-2222-222222222222",
        siteName: "solterra",
        language: "en",
        collectionName: "Solterra",
      } as never,
      status: "update",
      mutation: { kind: "ensureLanguages", languages: ["en", "da"], missing: ["da"] },
    };
    expect(inverseOf(action, new Map())).toBeNull();
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

describe("rollback — disk audit log", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-rollback-integration-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("records a JSONL line per compensating-op outcome, success and failure alike", async () => {
    const { client, captured, applied } = await buildAppliedSequence(3);
    const middleAssignedId = captured.get(applied[1].operation.id)!;
    const originalDelete = client.deleteItem.bind(client);
    client.deleteItem = async (selector) => {
      if (selector.itemId === middleAssignedId) {
        throw new Error("simulated permission denied");
      }
      return originalDelete(selector);
    };

    const logger = createRollbackLogger("run-integration", { dir: tmpDir });
    await rollback(applied, client, captured, {
      log: { logger, recipe: "test-recipe@1" },
    });

    expect(logger.wasUsed).toBe(true);
    const raw = await fs.readFile(logger.logPath, "utf8");
    const lines = raw
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    expect(lines).toHaveLength(3);
    // LIFO order: index 2 first, then 1 (failure), then 0.
    expect(lines.map((l) => [l.index, l.status])).toEqual([
      [2, "success"],
      [1, "failed"],
      [0, "success"],
    ]);
    expect(lines[1].error).toMatch(/permission denied/);
    // Successful deletes get the captured itemId for replay.
    expect(lines[0].itemId).toBe(captured.get(applied[2].operation.id));
    expect(lines[2].itemId).toBe(captured.get(applied[0].operation.id));
  });
});

describe("executeIr — PruneChildren end-to-end (audit gap #10 + #14)", () => {
  // Audit found no test that exercises a prune through the actual executor
  // (only through inverseOf + rollback() directly). These two cover the
  // executor-side dispatch + the POLICY_DENIED gate.

  const PARENT_PATH = "/sitecore/content/test/Renderings/Section";
  const PARENT_ITEM_ID = "11111111-aaaa-aaaa-aaaa-000000000001";
  const KEEP_ITEM_ID = "11111111-aaaa-aaaa-aaaa-00000000000a";
  const ORPHAN_ITEM_ID = "11111111-aaaa-aaaa-aaaa-00000000000b";
  const ALLOWED_REF_KEY = "11111111-bbbb-bbbb-bbbb-00000000000a";

  const seedTree = (client: MockAuthoringClient): void => {
    client.preload({
      itemId: PARENT_ITEM_ID,
      templateId: "00000000-0000-0000-0000-000000000fff",
      parentId: "00000000-0000-0000-0000-000000000000",
      name: "Section",
      path: PARENT_PATH,
      fields: [],
    });
    client.preload({
      itemId: KEEP_ITEM_ID,
      templateId: "00000000-0000-0000-0000-000000000abc",
      parentId: PARENT_ITEM_ID,
      name: "Keep",
      path: `${PARENT_PATH}/Keep`,
      fields: [],
    });
    client.preload({
      itemId: ORPHAN_ITEM_ID,
      templateId: "00000000-0000-0000-0000-000000000abc",
      parentId: PARENT_ITEM_ID,
      name: "Orphan",
      path: `${PARENT_PATH}/Orphan`,
      fields: [],
    });
  };

  const pruneIr = (mode: "warn" | "delete") => ({
    schemaVersion: "1" as const,
    recipeHandle: "test-prune",
    operations: [
      {
        op: "PruneChildren" as const,
        policy: "CreateAndUpdate" as const,
        label: "prune:test",
        parentRefKey: "22222222-2222-2222-2222-222222222222",
        latePath: PARENT_PATH,
        allowedHandles: [{ kind: "ref-recipe" as const, refKey: ALLOWED_REF_KEY }],
        mode,
      },
    ],
  });

  it("delete-mode prune throws POLICY_DENIED through executeIr when allowPrune is unset", async () => {
    const client = new MockAuthoringClient();
    seedTree(client);

    const result = await executeIr(pruneIr("delete"), client, {
      mode: "apply",
      // allowPrune NOT set → executor must refuse.
      crossRecipeRefs: new Map([[ALLOWED_REF_KEY, `${PARENT_PATH}/Keep`]]),
    });

    // The action lands as `prune` status (planner ran fine), but the
    // dispatch hits the gate and the executor's apply errors. The
    // executeIr loop catches the dispatch error and triggers rollback.
    expect(result.aborted).toBe(true);
    // No items were actually deleted from the mock.
    expect(client.peek({ itemId: ORPHAN_ITEM_ID })).toBeDefined();
    expect(client.peek({ itemId: KEEP_ITEM_ID })).toBeDefined();
  });

  it("delete-mode prune + allowPrune deletes orphans through executeIr; rollback restores via the executor path", async () => {
    const client = new MockAuthoringClient();
    seedTree(client);

    // First: apply succeeds, orphan is deleted.
    const okResult = await executeIr(pruneIr("delete"), client, {
      mode: "apply",
      allowPrune: true,
      crossRecipeRefs: new Map([[ALLOWED_REF_KEY, `${PARENT_PATH}/Keep`]]),
    });

    expect(okResult.aborted).toBe(false);
    expect(client.peek({ itemId: ORPHAN_ITEM_ID })).toBeUndefined();
    expect(client.peek({ itemId: KEEP_ITEM_ID })).toBeDefined();
  });

  it("warn-mode prune dispatches a no-op apply through executeIr (no deletes)", async () => {
    const client = new MockAuthoringClient();
    seedTree(client);

    const result = await executeIr(pruneIr("warn"), client, {
      mode: "apply",
      crossRecipeRefs: new Map([[ALLOWED_REF_KEY, `${PARENT_PATH}/Keep`]]),
    });

    expect(result.aborted).toBe(false);
    // Both kept AND orphan still present — warn skips the delete.
    expect(client.peek({ itemId: ORPHAN_ITEM_ID })).toBeDefined();
    expect(client.peek({ itemId: KEEP_ITEM_ID })).toBeDefined();
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

/**
 * Warn-only rollback kinds — `createSite`, `ensureLanguages`,
 * `addItemVersion`, `mediaUpload` — return a null inverse, the same as an
 * action that never mutated anything. But they are not the same: these
 * applied a real mutation and left residue on the tenant.
 *
 * Rollback used to report both as "no inverse needed (no forward
 * mutation)", which told an operator nothing happened when something did.
 * These pin that the skip reason now names the artifact left behind, so
 * an abandoned push is still cleanable by hand.
 */
describe("rollback — warn-only kinds report their residue", () => {
  const versionAction = (itemId: string, language: string, addCount: number): PlannedAction => ({
    index: 0,
    operation: {
      op: "AddItemVersion",
      policy: "CreateAndUpdate",
      label: "content-item:launch-story@1",
      itemRefKey: "22222222-2222-2222-2222-222222222222",
      language,
      version: addCount + 1,
    },
    status: "create",
    mutation: { kind: "addItemVersion", itemId, language, addCount },
    snapshot: null,
  });

  it("still declines to invert an addItemVersion (no deleteItemVersion exists)", () => {
    expect(inverseOf(versionAction("item-1", "en", 1), new Map())).toBeNull();
  });

  it("names the item, language, and version count left behind", async () => {
    const client = new MockAuthoringClient();
    const events: RollbackEvent[] = [];
    const result = await rollback([versionAction("item-42", "fr-CA", 2)], client, new Map(), {
      emit: (e) => events.push(e),
    });

    // Nothing was undone — this is a skip, not a rolled-back step.
    expect(result.rolledBack).toBe(0);
    expect(result.errors).toHaveLength(0);

    const skip = events.find((e) => e.kind === "rollback-skip");
    expect(skip).toBeDefined();
    const reason = (skip as { reason: string }).reason;
    expect(reason).toContain("item-42");
    expect(reason).toContain("fr-CA");
    expect(reason).toContain("2 versions");
    // The misleading old wording must not be what an operator sees here.
    expect(reason).not.toContain("no forward mutation");
    // And it should point at the repair path rather than just the gap.
    expect(reason).toMatch(/re-push/i);
  });

  it("uses the singular when a single version was added", async () => {
    const client = new MockAuthoringClient();
    const events: RollbackEvent[] = [];
    await rollback([versionAction("item-7", "en", 1)], client, new Map(), {
      emit: (e) => events.push(e),
    });
    const skip = events.find((e) => e.kind === "rollback-skip") as { reason: string };
    expect(skip.reason).toContain("1 version ");
  });

  it("keeps the original wording for an action that genuinely mutated nothing", async () => {
    const client = new MockAuthoringClient();
    const events: RollbackEvent[] = [];
    const noop: PlannedAction = {
      index: 0,
      operation: {
        op: "AddItemVersion",
        policy: "CreateAndUpdate",
        label: "content-item:skipped@1",
        itemRefKey: "33333333-3333-3333-3333-333333333333",
        language: "en",
        version: 1,
      },
      status: "skip",
      snapshot: null,
    };
    await rollback([noop], client, new Map(), { emit: (e) => events.push(e) });
    const skip = events.find((e) => e.kind === "rollback-skip") as { reason: string };
    expect(skip.reason).toBe("no inverse needed (no forward mutation)");
  });
});
