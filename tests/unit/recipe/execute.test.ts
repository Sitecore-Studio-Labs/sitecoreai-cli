import { describe, expect, it, vi } from "vitest";
import { compileComponentTemplateRecipe } from "../../../src/recipe/compile";
import { ctaButtonRecipe } from "../../../example/recipes/cta-button.recipe";
import { executeIr, type ExecutionEvent } from "../../../src/recipe/runtime/execute";
import { SITECORE_TEMPLATES, SYSTEM_FIELDS } from "../../../src/recipe/ir/sitecore-templates";
import type { CreateItemOp, OperationIr } from "../../../src/recipe/ir/operations";
import type { AuthoringApiClient, RemoteItem } from "../../../src/recipe/api/client";
import type { NewSiteInput, SitesApiClient } from "../../../src/recipe/api/sites-client";
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

  it("continues past a failed mutation when onError is 'continue' (tolerant push)", async () => {
    const ir = compileCta();
    const client = new MockAuthoringClient();
    client.throwOn = {
      method: "createItem",
      match: "CtaButton",
      message: "boom",
    };
    const events: ExecutionEvent[] = [];
    const result = await executeIr(ir, client, {
      mode: "apply",
      onError: "continue",
      emit: (e) => events.push(e),
    });
    // The op errored and is surfaced, but the recipe neither aborts nor rolls
    // back — a tolerant push records the failure and keeps going.
    expect(result.aborted).toBe(false);
    expect(result.rollback).toBeUndefined();
    expect(result.summary.error).toBeGreaterThan(0);
    expect(events.some((e) => e.kind === "apply-error" && e.error === "boom")).toBe(true);
    // Strict stops at the first error (one op-start); tolerant walks the
    // whole IR, so the loop dispatches every subsequent op.
    const opStarts = events.filter((e) => e.kind === "op-start").length;
    expect(opStarts).toBeGreaterThan(1);
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

describe("executeIr — unregistered-language tolerance", () => {
  // A component whose Heading field carries a locale-map `__Standard
  // Values` default (en + fr). Compiling with both languages "available"
  // makes the compiler emit a primary en version on the SV item plus a
  // non-primary `fr` AddItemVersion + versioned SetField.
  const localeRecipe = {
    kind: "component-template",
    schemaVersion: "1",
    handle: "locale-card@1",
    name: "LocaleCard",
    displayName: "Locale Card",
    description: "Component with a locale-map Standard Values default for testing.",
    fields: [
      {
        name: "Heading",
        shape: "text",
        default: { en: "Welcome", fr: "Bienvenue" },
        sitecore: { type: "single-line-text", sortOrder: 100 },
      },
    ],
  } as const;

  const compileLocale = () =>
    compileComponentTemplateRecipe(localeRecipe as never, {
      ...CONTEXT,
      availableLanguages: ["en", "fr"],
    });

  it("skips a non-primary-language version write against an unregistered language instead of aborting", async () => {
    const ir = compileLocale();
    // Sanity: the IR must contain a non-primary `fr` AddItemVersion for the
    // test to exercise the branch it targets.
    const frAddVersion = ir.operations.find(
      (op) => op.op === "AddItemVersion" && op.language === "fr"
    );
    expect(frAddVersion).toBeDefined();

    const client = new MockAuthoringClient();
    // The environment has no `fr` registered — the Authoring API rejects the
    // version write with an "unavailable language" shaped error.
    client.throwOn = {
      method: "addItemVersion",
      match: "fr",
      message: "The specified language 'fr' is not defined on this environment.",
    };

    const events: ExecutionEvent[] = [];
    const result = await executeIr(ir, client, {
      mode: "apply",
      emit: (e) => events.push(e),
    });

    // The push completes — primary-language content installed, only the
    // unregistered-language version was skipped.
    expect(result.aborted).toBe(false);
    expect(result.summary.create).toBeGreaterThan(0);
    expect(result.rollback).toBeUndefined();

    // The `fr` AddItemVersion op surfaced as a skip, not an error.
    const skipEvent = events.find((e) => e.kind === "apply-skip");
    expect(skipEvent).toBeDefined();
    expect(skipEvent).toMatchObject({ kind: "apply-skip", language: "fr" });
    expect(result.summary.skip).toBeGreaterThan(0);
    expect(events.some((e) => e.kind === "apply-error")).toBe(false);
    expect(events.some((e) => e.kind === "failed")).toBe(false);
  });

  it("still aborts when a version write fails for a reason other than an unregistered language", async () => {
    const ir = compileLocale();
    const client = new MockAuthoringClient();
    // A non-language failure on the same op must NOT be swallowed.
    client.throwOn = {
      method: "addItemVersion",
      match: "fr",
      message: "Timeout contacting the Authoring API.",
    };

    const events: ExecutionEvent[] = [];
    const result = await executeIr(ir, client, {
      mode: "apply",
      emit: (e) => events.push(e),
    });

    // A non-language failure aborts + rolls back; it is NOT swallowed as a skip.
    expect(result.aborted).toBe(true);
    expect(result.rollback).toBeDefined();
    expect(events.some((e) => e.kind === "apply-error")).toBe(true);
    expect(events.some((e) => e.kind === "apply-skip")).toBe(false);
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

// ─────────────────────────────────────────────────────────────────────────
// AddItemVersion dispatch — the executor's addItemVersion mutation branch.
// ─────────────────────────────────────────────────────────────────────────

const ITEM_REF = "aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa";
const ITEM_ID = "bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb";

/** An IR whose single op adds version 3 of `en` to a preloaded item. */
const addVersionIr = (version: number): OperationIr => ({
  schemaVersion: "1",
  recipeHandle: "story@1",
  operations: [
    {
      op: "AddItemVersion",
      policy: "CreateAndUpdate",
      label: `add-version:en:${version}`,
      itemRefKey: ITEM_REF,
      language: "en",
      version,
    },
  ],
});

describe("executeIr — AddItemVersion dispatch", () => {
  it("dispatches addItemVersion N times to reconcile a multi-version gap", async () => {
    const client = new MockAuthoringClient();
    client.preload({
      itemId: ITEM_ID,
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: "00000000-0000-0000-0000-000000000aaa",
      name: "Story",
      path: "/sitecore/content/Story",
      fields: [],
    });
    // Preloaded item has en v1 → target v3 means addCount 2.
    const result = await executeIr(addVersionIr(3), client, {
      mode: "apply",
      pathItemIdCache: new Map([[ITEM_REF, ITEM_ID]]),
    });

    expect(result.aborted).toBe(false);
    expect(result.summary.create).toBe(1);
    // dispatchMutation loops addCount times: one addItemVersion call per
    // missing version.
    expect(client.versionAdds).toHaveLength(2);
    expect(client.versionAdds.every((v) => v.itemId === ITEM_ID && v.language === "en")).toBe(true);
  });

  it("dispatches nothing when the target version already exists (idempotent)", async () => {
    const client = new MockAuthoringClient();
    client.preload({
      itemId: ITEM_ID,
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: "00000000-0000-0000-0000-000000000aaa",
      name: "Story",
      path: "/sitecore/content/Story",
      fields: [],
    });
    // Preloaded item is at en v1; target v1 → skip, no mutation.
    const result = await executeIr(addVersionIr(1), client, {
      mode: "apply",
      pathItemIdCache: new Map([[ITEM_REF, ITEM_ID]]),
    });

    expect(result.summary.skip).toBe(1);
    expect(client.versionAdds).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// CreateSiteFromTemplate dispatch — the executor's Sites API branch.
// ─────────────────────────────────────────────────────────────────────────

const SITE_REF = "cccccccc-3333-3333-3333-cccccccccccc";
const TEMPLATE_REF = "dddddddd-4444-4444-4444-dddddddddddd";

const createSiteIr = (): OperationIr => ({
  schemaVersion: "1",
  recipeHandle: "marketing-site@1",
  operations: [
    {
      op: "CreateSiteFromTemplate",
      policy: "CreateOnly",
      label: "create-site:marketing-site@1",
      siteRefKey: SITE_REF,
      siteName: "MarketingSite",
      language: "en",
      templateRefKey: TEMPLATE_REF,
      collectionName: "Marketing",
    },
  ],
});

/** A SitesApiClient whose createSite job runs through one poll then Done. */
const makeSitesClient = (
  overrides: Partial<SitesApiClient> = {}
): SitesApiClient & { createCalls: unknown[] } => {
  const createCalls: unknown[] = [];
  return {
    createCalls,
    createSite: async (input) => {
      createCalls.push(input);
      return { handle: "job-1" } as never;
    },
    getJobStatus: async () => ({ state: "Done" }) as never,
    listSites: async () =>
      [{ id: "site-id-1", name: "MarketingSite", supportedLanguages: ["en"] }] as never,
    retrieveSite: async () => ({ id: "site-id-1", supportedLanguages: ["en"] }) as never,
    updateSite: async () => ({}) as never,
    listSiteTemplates: async () => [],
    listCollections: async () => [],
    listLanguages: async () => [],
    listSupportedLanguages: async () => [],
    addLanguage: async () => ({}) as never,
    ...overrides,
  };
};

describe("executeIr — CreateSiteFromTemplate dispatch", () => {
  it("dispatches createSite, awaits the job, and captures the site itemId", async () => {
    const client = new MockAuthoringClient();
    // Preload the template path so seedCrossRecipeRefs captures TEMPLATE_REF.
    client.preload({
      itemId: "tpl-id",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: "p",
      name: "SiteTemplate",
      path: "/sitecore/templates/SiteTemplate",
      fields: [],
    });
    // After createSite runs, the executor captures the site's itemId via
    // Authoring `getItem` against the SXA content-tree path
    // `/sitecore/content/<collectionName>/<siteName>`. Preload that path
    // so the post-apply getItem lookup returns the materialised site.
    let siteCreated = false;
    client.preload({
      itemId: "site-id-1",
      templateId: "site-tpl",
      parentId: "p",
      name: "MarketingSite",
      path: "/sitecore/content/Marketing/MarketingSite",
      fields: [],
    });
    const sitesClient = makeSitesClient({
      createSite: async () => {
        siteCreated = true;
        return { handle: "job-1" } as never;
      },
      listSites: async () => [] as never,
    });
    const events: ExecutionEvent[] = [];

    const result = await executeIr(createSiteIr(), client, {
      mode: "apply",
      sitesClient,
      // Seed the templateRefKey so the planner produces a create (not skip).
      crossRecipeRefs: new Map([[TEMPLATE_REF, "/sitecore/templates/SiteTemplate"]]),
      emit: (e) => events.push(e),
    });

    expect(result.aborted).toBe(false);
    expect(result.summary.create).toBe(1);
    // The job poll emitted a site-job-poll event.
    expect(events.some((e) => e.kind === "site-job-poll")).toBe(true);
    expect(siteCreated).toBe(true);
  });

  it("ensures language + additionalLanguages on the environment before createSite, skipping present ones", async () => {
    const client = new MockAuthoringClient();
    client.preload({
      itemId: "tpl-id",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: "p",
      name: "SiteTemplate",
      path: "/sitecore/templates/SiteTemplate",
      fields: [],
    });
    client.preload({
      itemId: "site-id-1",
      templateId: "site-tpl",
      parentId: "p",
      name: "MarketingSite",
      path: "/sitecore/content/Marketing/MarketingSite",
      fields: [],
    });

    const added: string[] = [];
    const order: string[] = [];
    const createInputs: NewSiteInput[] = [];
    const sitesClient = makeSitesClient({
      listSites: async () => [] as never,
      // "en" already present on the environment; da/fr-FR are not.
      listLanguages: async () => [{ iso: "en" }] as never,
      addLanguage: async (code) => {
        added.push(code);
        order.push(`add:${code}`);
        return {} as never;
      },
      createSite: async (input) => {
        order.push("createSite");
        createInputs.push(input);
        return { handle: "job-1" } as never;
      },
    });

    const ir: OperationIr = {
      schemaVersion: "1",
      recipeHandle: "marketing-site@1",
      operations: [
        {
          op: "CreateSiteFromTemplate",
          policy: "CreateOnly",
          label: "create-site:marketing-site@1",
          siteRefKey: SITE_REF,
          siteName: "MarketingSite",
          language: "en",
          additionalLanguages: ["da", "fr-FR"],
          templateRefKey: TEMPLATE_REF,
          collectionName: "Marketing",
        },
      ],
    };

    const result = await executeIr(ir, client, {
      mode: "apply",
      sitesClient,
      crossRecipeRefs: new Map([[TEMPLATE_REF, "/sitecore/templates/SiteTemplate"]]),
    });

    expect(result.aborted).toBe(false);
    // "en" already present → skipped; the two missing ones are added...
    expect(added).toEqual(["da", "fr-FR"]);
    // ...and every add runs BEFORE the site is created.
    expect(order).toEqual(["add:da", "add:fr-FR", "createSite"]);
    // The full declared list rides the SITE definition (all three passed
    // the env gate), so Pages offers every locale on the site.
    expect(createInputs[0]?.languages).toEqual(["en", "da", "fr-FR"]);
  });

  it("plans createSite as skip when the site already exists in the tenant", async () => {
    const client = new MockAuthoringClient();
    client.preload({
      itemId: "tpl-id",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: "p",
      name: "SiteTemplate",
      path: "/sitecore/templates/SiteTemplate",
      fields: [],
    });
    // The declared language is registered → nothing to provision either.
    const sitesClient = makeSitesClient({
      listLanguages: async () => [{ iso: "en", regionalIsoCode: "en" }] as never,
    });
    const result = await executeIr(createSiteIr(), client, {
      mode: "apply",
      sitesClient,
      crossRecipeRefs: new Map([[TEMPLATE_REF, "/sitecore/templates/SiteTemplate"]]),
    });

    // listSites already returns a site named MarketingSite → skip.
    expect(result.summary.skip).toBe(1);
    expect(sitesClient.createCalls).toHaveLength(0);
  });

  it("aborts when the createSite job reports a terminal Failed state", async () => {
    const client = new MockAuthoringClient();
    client.preload({
      itemId: "tpl-id",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: "p",
      name: "SiteTemplate",
      path: "/sitecore/templates/SiteTemplate",
      fields: [],
    });
    const sitesClient = makeSitesClient({
      listSites: async () => [],
      getJobStatus: async () => ({ state: "Failed" }) as never,
    });

    const events: ExecutionEvent[] = [];
    const result = await executeIr(createSiteIr(), client, {
      mode: "apply",
      sitesClient,
      crossRecipeRefs: new Map([[TEMPLATE_REF, "/sitecore/templates/SiteTemplate"]]),
      emit: (e) => events.push(e),
    });

    // awaitSitesJob throws on a terminal Failed state → apply-error → abort.
    expect(result.aborted).toBe(true);
    const failed = events.find((e) => e.kind === "failed");
    expect(failed).toBeDefined();
    if (failed?.kind === "failed") {
      expect(failed.error).toMatch(/terminal state 'Failed'/);
    }
  });

  it("aborts when createSite returns a JobResponse with no handle", async () => {
    const client = new MockAuthoringClient();
    client.preload({
      itemId: "tpl-id",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: "p",
      name: "SiteTemplate",
      path: "/sitecore/templates/SiteTemplate",
      fields: [],
    });
    const sitesClient = makeSitesClient({
      listSites: async () => [],
      createSite: async () => ({}) as never,
    });

    const result = await executeIr(createSiteIr(), client, {
      mode: "apply",
      sitesClient,
      crossRecipeRefs: new Map([[TEMPLATE_REF, "/sitecore/templates/SiteTemplate"]]),
    });

    expect(result.aborted).toBe(true);
  });

  it("errors a createSite op when no SitesApiClient is threaded into the executor", async () => {
    const client = new MockAuthoringClient();
    client.preload({
      itemId: "tpl-id",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: "p",
      name: "SiteTemplate",
      path: "/sitecore/templates/SiteTemplate",
      fields: [],
    });
    const result = await executeIr(createSiteIr(), client, {
      mode: "apply",
      crossRecipeRefs: new Map([[TEMPLATE_REF, "/sitecore/templates/SiteTemplate"]]),
    });

    // planCreateSite returns an `error` action (no mutation) when the
    // SitesApiClient is absent — it counts as a plan-time error but the
    // executor continues rather than rolling back (nothing was applied).
    expect(result.summary.error).toBe(1);
    expect(result.plan.actions[0].status).toBe("error");
    expect(result.plan.actions[0].reason).toMatch(/requires a SitesApiClient/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Cooperative cancellation — abort signal between operations.
// ─────────────────────────────────────────────────────────────────────────

describe("executeIr — cancellation by AbortSignal", () => {
  it("aborts before the first op when the signal is already aborted", async () => {
    const ir = compileCta();
    const client = new MockAuthoringClient();
    const controller = new AbortController();
    controller.abort();
    const events: ExecutionEvent[] = [];

    const result = await executeIr(ir, client, {
      mode: "apply",
      signal: controller.signal,
      emit: (e) => events.push(e),
    });

    expect(result.aborted).toBe(true);
    // No mutations dispatched — the cancel check fires before op 0.
    expect(client.creates).toHaveLength(0);
    const failed = events.find((e) => e.kind === "failed");
    expect(failed).toBeDefined();
    if (failed?.kind === "failed") {
      expect(failed.error).toMatch(/Cancelled by client before op 0/);
    }
  });

  it("stops mid-stream when the signal fires after the first op applies", async () => {
    const ir = compileCta();
    const client = new MockAuthoringClient();
    const controller = new AbortController();

    let applied = 0;
    const result = await executeIr(ir, client, {
      mode: "apply",
      signal: controller.signal,
      emit: (e) => {
        if (e.kind === "apply-success") {
          applied += 1;
          // Fire the cancel after the first successful apply.
          if (applied === 1) controller.abort();
        }
      },
    });

    expect(result.aborted).toBe(true);
    // At least one op applied before the cancel; not the whole IR.
    expect(applied).toBeGreaterThan(0);
    expect(client.creates.length).toBeLessThan(
      ir.operations.filter((o) => o.op === "CreateItem").length
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Plan-time error — buildAction throws → rollback path.
// ─────────────────────────────────────────────────────────────────────────

describe("executeIr — plan-time error triggers rollback", () => {
  it("aborts and rolls back applied ops when buildAction throws on a later op", async () => {
    const ir = compileCta();
    const client = new MockAuthoringClient();
    // Let the first few getItem reads succeed, then throw on a path-keyed
    // read partway through — this surfaces inside buildAction as a thrown
    // error rather than a planned skip/error action.
    let reads = 0;
    const realGetItem = client.getItem.bind(client);
    client.getItem = async (selector) => {
      reads += 1;
      if (reads > 1) {
        throw new Error("Authoring GraphQL errors: transient read failure");
      }
      return realGetItem(selector);
    };

    const events: ExecutionEvent[] = [];
    const result = await executeIr(ir, client, {
      mode: "apply",
      emit: (e) => events.push(e),
    });

    expect(result.aborted).toBe(true);
    const failed = events.find((e) => e.kind === "failed");
    expect(failed).toBeDefined();
    if (failed?.kind === "failed") {
      expect(failed.error).toMatch(/transient read failure/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Rollback audit log — recordSummary on a failed apply.
// ─────────────────────────────────────────────────────────────────────────

describe("executeIr — rollback audit log", () => {
  it("records a rollback summary entry when an apply fails with a logger threaded in", async () => {
    const ir = compileCta();
    const client = new MockAuthoringClient();
    // Fail the second createItem so at least one op is applied (and thus
    // rolled back) when the failure hits.
    let creates = 0;
    const realCreate = client.createItem.bind(client);
    client.createItem = async (input) => {
      creates += 1;
      if (creates === 2) throw new Error("Authoring GraphQL errors: create rejected");
      return realCreate(input);
    };

    const summaries: Array<{ recipe: string; trigger: string }> = [];
    const rollbackLog = {
      runId: "rb-1",
      logPath: "/tmp/rb-1.jsonl",
      wasUsed: false,
      recordStep: vi.fn(async () => {}),
      recordSummary: vi.fn(async (recipe: string, entry: { trigger: string }) => {
        summaries.push({ recipe, trigger: entry.trigger });
      }),
    };

    const result = await executeIr(ir, client, {
      mode: "apply",
      rollbackLog: rollbackLog as never,
    });

    expect(result.aborted).toBe(true);
    expect(rollbackLog.recordSummary).toHaveBeenCalledTimes(1);
    expect(summaries[0]).toMatchObject({ recipe: "cta-button@1", trigger: "apply-error" });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Plan-mode cross-recipe ref seeding — snapshot-cache short-circuit.
// ─────────────────────────────────────────────────────────────────────────

describe("executeIr — plan-mode crossRecipeRefs", () => {
  it("resolves a cross-recipe ref from the pathSnapshotCache without a wire call", async () => {
    const ir = compileCta();
    const client = new MockAuthoringClient();
    const getItemsByPathsSpy = vi.spyOn(client, "getItemsByPaths");

    const externalRefKey = "99999999-9999-9999-9999-999999999999";
    const externalPath = "/sitecore/templates/Project/External";
    // Pre-seed the snapshot cache with the cross-recipe ref's path — the
    // seeder must short-circuit and never call getItemsByPaths for it.
    const pathSnapshotCache = new Map<string, RemoteItem | null>([
      [
        externalPath,
        {
          itemId: "ext-id",
          templateId: SITECORE_TEMPLATES.TEMPLATE,
          parentId: "p",
          name: "External",
          path: externalPath,
          fields: [],
        },
      ],
    ]);

    await executeIr(ir, client, {
      mode: "plan",
      crossRecipeRefs: new Map([[externalRefKey, externalPath]]),
      pathSnapshotCache,
    });

    // The cached path was never re-fetched.
    const fetchedExternal = getItemsByPathsSpy.mock.calls.some((call) =>
      call[0].includes(externalPath)
    );
    expect(fetchedExternal).toBe(false);
  });

  it("treats a pathSnapshotCache null entry as 'checked and missing' (no wire call, no capture)", async () => {
    const ir = compileCta();
    const client = new MockAuthoringClient();
    const getItemsByPathsSpy = vi.spyOn(client, "getItemsByPaths");

    const externalRefKey = "88888888-8888-8888-8888-888888888888";
    const externalPath = "/sitecore/templates/Project/Absent";
    const pathSnapshotCache = new Map<string, RemoteItem | null>([[externalPath, null]]);

    const result = await executeIr(ir, client, {
      mode: "plan",
      crossRecipeRefs: new Map([[externalRefKey, externalPath]]),
      pathSnapshotCache,
    });

    expect(result.aborted).toBe(false);
    const fetchedAbsent = getItemsByPathsSpy.mock.calls.some((call) =>
      call[0].includes(externalPath)
    );
    expect(fetchedAbsent).toBe(false);
  });

  it("batches an uncached cross-recipe ref through a single getItemsByPaths call", async () => {
    const ir = compileCta();
    const client = new MockAuthoringClient() as AuthoringApiClient & {
      getItemsByPaths: ReturnType<typeof vi.fn>;
    };
    const externalRefKey = "77777777-7777-7777-7777-777777777777";
    const externalPath = "/sitecore/templates/Project/Uncached";

    const result = await executeIr(ir, client, {
      mode: "plan",
      crossRecipeRefs: new Map([[externalRefKey, externalPath]]),
      // No pathSnapshotCache → the ref falls through to a wire fetch.
    });

    expect(result.aborted).toBe(false);
  });
});
