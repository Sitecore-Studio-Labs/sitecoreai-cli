import { describe, expect, it, vi } from "vitest";
import { compileComponentTemplateRecipe } from "../../../src/recipe/compile";
import { ctaButtonRecipe } from "../../../example/recipes/cta-button.recipe";
import { executeIr, type ExecutionEvent } from "../../../src/recipe/execute";
import { SYSTEM_FIELDS } from "../../../src/recipe/ir/sitecore-templates";
import type { CreateItemOp } from "../../../src/recipe/ir/operations";
import type { RemoteItem } from "../../../src/recipe/api/client";
import { MockAuthoringClient } from "./_fixtures/mock-client";

const CONTEXT = {
  templatesRoot: "/sitecore/templates/Project/sandbox/Components",
  renderingsRoot: "/sitecore/layout/Renderings/Project/sandbox",
  headlessVariantsRoot: "/sitecore/content/test-tenant/sandbox/Presentation/Headless Variants",
  enumerationsRoot: "/sitecore/content/test-tenant/sandbox/Settings/Enumerations",
};

const compileCta = () => compileComponentTemplateRecipe(ctaButtonRecipe, CONTEXT);

describe("executeIr — plan mode", () => {
  it("emits planning events but never calls createItem/updateItem", async () => {
    const ir = compileCta();
    const client = new MockAuthoringClient();
    const events: ExecutionEvent[] = [];
    await executeIr(ir, client, { mode: "plan", emit: (e) => events.push(e) });
    expect(client.creates).toHaveLength(0);
    expect(client.updates).toHaveLength(0);
    expect(events.some((e) => e.kind === "op-result")).toBe(true);
    expect(events.every((e) => e.kind !== "apply-start" && e.kind !== "apply-success")).toBe(true);
  });
});

describe("executeIr — apply mode", () => {
  it("dispatches createItem and updateItem matching the per-op plan summary", async () => {
    const ir = compileCta();
    const client = new MockAuthoringClient();
    const result = await executeIr(ir, client, { mode: "apply" });
    // Apply mode interleaves plan-and-apply: SetBaseTemplates and
    // SetStandardValues read the just-created item and dispatch updateItem
    // to add the missing field. They count as `update` in the summary.
    expect(client.creates.length).toBe(result.summary.create);
    expect(client.updates.length).toBe(result.summary.update);
    expect(result.summary.create).toBeGreaterThan(0);
    expect(result.summary.update).toBeGreaterThan(0);
    expect(result.aborted).toBe(false);
  });

  it("aborts after the first failed mutation; subsequent ops do not dispatch", async () => {
    const ir = compileCta();
    const client = new MockAuthoringClient();
    // Match the very first createItem the executor dispatches (template).
    client.throwOn = {
      method: "createItem",
      match: "CtaButton",
      message: "boom",
    };
    const events: ExecutionEvent[] = [];
    const result = await executeIr(ir, client, {
      mode: "apply",
      emit: (e) => events.push(e),
    });
    expect(result.aborted).toBe(true);
    expect(client.creates.length).toBe(0);
    expect(events.some((e) => e.kind === "apply-error" && e.error === "boom")).toBe(true);
    expect(events.some((e) => e.kind === "apply-success")).toBe(false);
  });
});

describe("executeIr — idempotency", () => {
  it("a second apply against the post-first-apply state dispatches zero mutations", async () => {
    const ir = compileCta();
    const client = new MockAuthoringClient();

    const first = await executeIr(ir, client, { mode: "apply" });
    expect(first.aborted).toBe(false);
    expect(first.summary.create).toBeGreaterThan(0);
    const firstCreateCount = client.creates.length;
    const firstUpdateCount = client.updates.length;

    // Second apply against the same client (which now contains post-first-run state).
    const second = await executeIr(ir, client, { mode: "apply" });

    expect(second.aborted).toBe(false);
    expect(second.summary.create).toBe(0);
    expect(second.summary.update).toBe(0);
    expect(second.summary.skip).toBe(ir.operations.length);
    // Mock client appends to .creates/.updates across runs — assert delta = 0.
    expect(client.creates.length).toBe(firstCreateCount);
    expect(client.updates.length).toBe(firstUpdateCount);
  });
});

describe("executeIr — drift detection under CreateAndUpdate", () => {
  it("emits an updateItem when remote drifts on a tracked field", async () => {
    const ir = compileCta();
    const client = new MockAuthoringClient();
    const templateOp = ir.operations[0] as CreateItemOp;

    // Pre-seed the template at its path with a wrong icon. The compiler
    // emits Icon=DEFAULT_ICON ("office/32x32/elements3.png", the SXA
    // component icon); we stage a different one so the planner sees drift.
    const preloadedTemplateId = "11111111-1111-1111-1111-111111111111";
    client.preload({
      itemId: preloadedTemplateId,
      templateId: templateOp.templateOf,
      parentId: "00000000-0000-0000-0000-000000000aaa",
      name: templateOp.name,
      path: templateOp.path,
      fields: [{ fieldId: SYSTEM_FIELDS.ICON, value: "Office/32x32/old-icon.png" }],
    });

    const result = await executeIr(ir, client, { mode: "apply" });

    expect(result.aborted).toBe(false);
    // The first op is the template CreateItem; the planner must mark it
    // `update` because the seeded item drifted on its Icon field.
    expect(result.plan.actions[0].status).toBe("update");
    // The dispatched updateItem for the template must carry the corrected
    // Icon. Other update-style ops (SetBaseTemplates, SetStandardValues)
    // also update the template but on different field ids.
    const templateIconUpdate = client.updates
      .filter((u) => u.itemId === preloadedTemplateId)
      .flatMap((u) => u.fields)
      .find((f) => f.fieldId === SYSTEM_FIELDS.ICON);
    expect(templateIconUpdate?.value).toEqual({
      kind: "string",
      value: "office/32x32/elements3.png",
    });
  });
});

describe("executeIr — CreateOnly policy enforcement", () => {
  it("a drifted item under CreateOnly is skipped, not updated", async () => {
    const ir = compileCta();
    const templateOp = ir.operations[0] as CreateItemOp;

    // Override the template op's policy to CreateOnly (Phase 3 simulation).
    const tweaked = {
      ...ir,
      operations: ir.operations.map((op, idx) =>
        idx === 0 ? { ...op, policy: "CreateOnly" as const } : op
      ),
    };

    const client = new MockAuthoringClient();
    // Pre-seed the template at its path with a drifted icon.
    const preloadedTemplateId = "11111111-1111-1111-1111-111111111111";
    client.preload({
      itemId: preloadedTemplateId,
      templateId: templateOp.templateOf,
      parentId: "00000000-0000-0000-0000-000000000aaa",
      name: templateOp.name,
      path: templateOp.path,
      fields: [{ fieldId: SYSTEM_FIELDS.ICON, value: "Office/32x32/old-icon.png" }],
    });

    const result = await executeIr(tweaked, client, { mode: "apply" });

    // The template's CreateItem op was planned as `skip` with a CreateOnly
    // reason; the drifted icon stays drifted. (Subsequent SetBaseTemplates
    // and SetStandardValues ops still update the same item — they have
    // their own policies and target different fields. CreateOnly only
    // governs the op it's attached to.)
    const templateAction = result.plan.actions[0];
    expect(templateAction.status).toBe("skip");
    expect(templateAction.reason).toMatch(/CreateOnly/);
    // The icon field is still drifted on the remote — no update was made
    // by the CreateOnly op.
    const templateIconUpdates = client.updates
      .filter((u) => u.itemId === preloadedTemplateId)
      .flatMap((u) => u.fields)
      .filter((f) => f.fieldId === SYSTEM_FIELDS.ICON);
    expect(templateIconUpdates).toHaveLength(0);
  });
});

describe("executeIr — topological invariant of compiled IR", () => {
  it("every CreateItem's parent is either a path or has been emitted earlier in the IR", () => {
    // The executor relies on the compiler to emit ops in parent-before-child
    // order (Sitecore createItem rejects items whose parent doesn't exist).
    // This test pins that invariant against the compiled IR — if a future
    // compiler change reorders things, this fails before it hits the wire.
    const ir = compileCta();
    const knownRefKeys = new Set<string>();

    for (const op of ir.operations) {
      if (op.op !== "CreateItem") continue;
      if (op.parent.kind === "ref-recipe") {
        expect(knownRefKeys.has(op.parent.refKey)).toBe(true);
      }
      knownRefKeys.add(op.id);
    }
  });

  it("update-style ops (SetField, SetBaseTemplates, SetStandardValues) target refKeys already emitted", () => {
    const ir = compileCta();
    const knownRefKeys = new Set<string>();

    for (const op of ir.operations) {
      switch (op.op) {
        case "CreateItem":
          knownRefKeys.add(op.id);
          break;
        case "SetField":
          expect(knownRefKeys.has(op.itemRefKey)).toBe(true);
          break;
        case "SetBaseTemplates":
          expect(knownRefKeys.has(op.itemRefKey)).toBe(true);
          break;
        case "SetStandardValues":
          expect(knownRefKeys.has(op.templateRefKey)).toBe(true);
          expect(knownRefKeys.has(op.standardValuesRefKey)).toBe(true);
          break;
      }
    }
  });
});

describe("executeIr — crossRecipeRefs seeding", () => {
  it("seeds capturedItemIds for cross-recipe refs that exist on the tenant", async () => {
    const ir = compileCta();
    const client = new MockAuthoringClient();
    // Pre-load a "different recipe's" template at a path the IR doesn't
    // produce, so the ref appears as cross-recipe from the executor's POV.
    const externalRefKey = "99999999-9999-9999-9999-999999999999";
    const externalPath = "/sitecore/templates/Project/sandbox/Components/ExternalTemplate";
    const externalItemId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    client.preload({
      itemId: externalItemId,
      templateId: "ab86861a-6030-46c5-b394-e8f99e8b87db",
      parentId: "00000000-0000-0000-0000-000000000aaa",
      name: "ExternalTemplate",
      path: externalPath,
      fields: [],
    });

    const result = await executeIr(ir, client, {
      mode: "apply",
      crossRecipeRefs: new Map([[externalRefKey, externalPath]]),
    });
    expect(result.aborted).toBe(false);
    // The cross-recipe item should not have been re-created — only looked up.
    expect(client.creates.find((c) => c.name === "ExternalTemplate")).toBeUndefined();
  });

  it("ignores cross-recipe refs whose path doesn't exist on the tenant (silent skip)", async () => {
    const ir = compileCta();
    const client = new MockAuthoringClient();
    // No preload — the cross-recipe ref points at a path that doesn't exist.
    // Apply still proceeds; the cta-button recipe doesn't depend on this ref,
    // so the entry is silently skipped.
    const result = await executeIr(ir, client, {
      mode: "apply",
      crossRecipeRefs: new Map([
        ["99999999-9999-9999-9999-999999999999", "/sitecore/templates/Missing"],
      ]),
    });
    expect(result.aborted).toBe(false);
  });

  it("does not seed refs the current IR itself produces (avoids redundant tenant call)", async () => {
    const ir = compileCta();
    const client = new MockAuthoringClient();
    // Build crossRecipeRefs from the IR's own CreateItem ops — i.e. simulate
    // what push.ts does when only one recipe is in scope. The seeder must
    // skip these since they'll land via dispatchMutation.
    const ownRefs = new Map<string, string>();
    for (const op of ir.operations) {
      if (op.op === "CreateItem") ownRefs.set(op.id, op.path);
    }
    const result = await executeIr(ir, client, {
      mode: "apply",
      crossRecipeRefs: ownRefs,
    });
    expect(result.aborted).toBe(false);
    expect(result.summary.create).toBeGreaterThan(0);
  });
});

describe("executeIr — pathSnapshotCache short-circuit", () => {
  it("the workspace prefetch eliminates per-op wire calls for cached paths", async () => {
    const ir = compileCta();

    // Run plan mode WITHOUT a cache to establish the baseline call count.
    const baselineClient = new MockAuthoringClient();
    const baselineSpy = vi.spyOn(baselineClient, "getItem");
    await executeIr(ir, baselineClient, { mode: "plan" });
    const baselineCalls = baselineSpy.mock.calls.length;
    expect(baselineCalls).toBeGreaterThan(0);

    // Now run plan mode WITH a fully primed snapshot cache. Every path
    // the planner reads for a CreateItem op is pre-cached as `null`
    // (missing on tenant). buildAction's cachedReadByPath short-circuits
    // every cache hit; the only remaining wire calls are for parent
    // path resolutions that weren't part of any op's `op.path`.
    const cachedClient = new MockAuthoringClient();
    const pathSnapshotCache = new Map<string, RemoteItem | null>();
    for (const op of ir.operations) {
      if (op.op === "CreateItem") pathSnapshotCache.set(op.path, null);
    }
    const cachedSpy = vi.spyOn(cachedClient, "getItem");
    await executeIr(ir, cachedClient, { mode: "plan", pathSnapshotCache });

    expect(cachedSpy.mock.calls.length).toBeLessThan(baselineCalls);
  });

  it("synthesizes a snapshot after dispatch so a sibling recipe sees the just-created item even if the tenant's path index lags", async () => {
    // Reproduce the cross-recipe duplicate-create failure mode:
    //   1. Recipe A creates `<componentsRoot>/ui` (CreateOnly section folder).
    //   2. Recipe B's IR also has a CreateOnly op for the same path.
    //   3. Sitecore's getItem({ path }) lags and still returns null.
    //   Without the synthetic-snapshot fix, recipe B re-plans a create and
    //   the tenant rejects with "name already defined on this level".
    const ir = compileCta();
    const sectionFolderOp = ir.operations.find(
      (op): op is import("../../../src/recipe/ir/operations").CreateItemOp => op.op === "CreateItem"
    )!;

    const client = new MockAuthoringClient();
    // Apply once — captures the synthetic snapshot in the shared cache.
    const pathSnapshotCache = new Map<string, RemoteItem | null>();
    const pathItemIdCache = new Map<string, string>();
    pathSnapshotCache.set(sectionFolderOp.path, null);
    await executeIr(ir, client, {
      mode: "apply",
      pathSnapshotCache,
      pathItemIdCache,
    });

    // Now SIMULATE the path-index lag: pretend the tenant returns null for
    // the just-created path even though a sibling recipe needs it to
    // resolve as "exists". Override getItem to always return null —
    // the synthetic snapshot in pathSnapshotCache must short-circuit.
    const sndClient = new MockAuthoringClient();
    sndClient.getItem = async () => null;
    sndClient.getItemsByPaths = async (paths) => {
      const result = new Map<string, RemoteItem | null>();
      for (const p of paths) result.set(p, null);
      return result;
    };

    // Re-run the same IR with the SHARED caches. Without the synthetic
    // snapshot, this would plan a `create` for sectionFolderOp.path and
    // dispatch a duplicate createItem. With the fix, pathSnapshotCache
    // returns the synthetic and the planner emits skip (CreateOnly) or
    // no-drift update.
    const result = await executeIr(ir, sndClient, {
      mode: "apply",
      pathSnapshotCache,
      pathItemIdCache,
    });

    // No mutations dispatched against the lagging tenant for the section
    // folder op — the planner saw the synthetic and returned skip.
    const sectionFolderAction = result.plan.actions.find(
      (a) => a.operation === sectionFolderOp || a.operation.label === sectionFolderOp.label
    );
    expect(sectionFolderAction?.status).not.toBe("create");
  });

  it("a primed pathItemIdCache pre-seeds capturedItemIds for ref-path parents", async () => {
    const ir = compileCta();
    const client = new MockAuthoringClient();

    // Find the first CreateItem with a ref-path parent — that's the path
    // the executor would otherwise fetch via getItem to resolve the
    // parent itemId. Pre-prime the path → itemId cache and assert the
    // planner doesn't issue a fetch for that path.
    const refPathOp = ir.operations.find(
      (op): op is CreateItemOp => op.op === "CreateItem" && op.parent.kind === "ref-path"
    );
    expect(refPathOp).toBeTruthy();
    const parentPath = refPathOp!.parent.kind === "ref-path" ? refPathOp!.parent.value : undefined;
    expect(parentPath).toBeTruthy();

    const pathItemIdCache = new Map<string, string>([[parentPath as string, "primed-parent-id"]]);
    const getItemSpy = vi.spyOn(client, "getItem");

    await executeIr(ir, client, { mode: "plan", pathItemIdCache });

    // No getItem call against the primed parent path.
    const fetchedParent = getItemSpy.mock.calls.some((call) => call[0].path === parentPath);
    expect(fetchedParent).toBe(false);
  });
});
