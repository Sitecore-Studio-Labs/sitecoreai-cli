import { describe, expect, it } from "vitest";
import type { ItemSelector, RemoteItem } from "../../../src/recipe/api/client";
import type { CreateItemOp } from "../../../src/recipe/ir/operations";
import { buildAction } from "../../../src/recipe/runtime/plan";
import { SITECORE_TEMPLATES } from "../../../src/recipe/ir/sitecore-templates";
import { MockAuthoringClient } from "./_fixtures/mock-client";

/**
 * Adopt-and-retemplate for recipe-seeded content items (the
 * recipe-push-batch "Cannot find a field with the name Title" abort).
 *
 * A tenant that has seen partial/rolled-back installs can hold a
 * NAME-TWIN of a content item at the recipe's own path — same parent,
 * same name, but a live template from a different GUID family (a
 * different site handle's template at the same shared Data-folder path,
 * or a template the earlier rollback deleted). Rollback is best-effort:
 * a failed `deleteItem` strands exactly such twins.
 *
 * Pre-fix, every adoption seam was template-blind for content items —
 * the planner's path-hit / sibling-byName adoption and the authoring
 * client's `idempotencyCheck` pre-check + already-exists fallback all
 * adopted the twin untouched, and the first SetField (resolving field
 * NAMES against the twin's stale template) aborted the recipe.
 *
 * The fix: a CreateOnly CreateItem that seeds authored fields and whose
 * expected template resolves to a LIVE itemId routes a
 * template-mismatched twin through a fresh create mutation carrying
 * `retemplateOnAdopt` — the client's adoption then CONVERGES the twin:
 * adopt as-is when its live template resolves the recipe's authored
 * field names (cross-seed same-shape twin), or delete + recreate
 * marker-verified childless residue (see `adoptExistingChild` in
 * authoring-client.ts, covered by api.test.ts — the Authoring API has
 * no template-change surface, so in-place retemplating is impossible).
 * Everything else keeps its prior behavior:
 * matching templates still skip, folder-class ops keep the v0.33.0
 * lossless adoption, the v0.32.5 rebind guard is untouched, and
 * CreateAndUpdate structure ops keep drift updates.
 */

const DATA_PATH = "/sitecore/content/duke/another-test/Data";
const DATA_ITEM_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_NAME = "features";
const ITEM_PATH = `${DATA_PATH}/${ITEM_NAME}`;
const ITEM_REF_KEY = "22222222-2222-4222-8222-222222222222";
const STRANDED_ITEM_ID = "33333333-3333-4333-8333-333333333333";
const TEMPLATE_REF_KEY = "44444444-4444-4444-4444-444444444444";
const LIVE_TEMPLATE_ID = "77777777-7777-4777-8777-777777777777";
const STALE_TEMPLATE_ID = "88888888-8888-4888-8888-888888888888";

// Authored seed field + the `Scai Handle` marker `injectHandleMarker`
// stamps — the realistic content-item op shape. Eligibility requires at
// least one AUTHORED (non-marker) field: adoption only breaks when the
// recipe writes field values the twin's live template can't resolve.
const contentItemFields = (): CreateItemOp["fields"] => [
  {
    fieldId: "55555555-5555-4555-8555-555555555555",
    fieldName: "Title",
    value: { kind: "string", value: "Features" },
  },
  {
    fieldId: "00000000-0000-0000-0000-5ca15ca15ca1",
    fieldName: "Scai Handle",
    value: { kind: "string", value: "footer-link-features@1" },
  },
];

const contentItemCreateOp = (policy: CreateItemOp["policy"] = "CreateOnly"): CreateItemOp => ({
  op: "CreateItem",
  policy,
  label: "content-item:footer-link-features@1",
  id: ITEM_REF_KEY,
  path: ITEM_PATH,
  parent: { kind: "ref-path", value: DATA_PATH },
  templateOf: TEMPLATE_REF_KEY,
  name: ITEM_NAME,
  fields: contentItemFields(),
});

/** Captured map as the workspace seed leaves it: parent path + live template. */
const capturedWithLiveTemplate = (): Map<string, string> =>
  new Map<string, string>([
    [DATA_PATH, DATA_ITEM_ID],
    [TEMPLATE_REF_KEY, LIVE_TEMPLATE_ID],
  ]);

const seedParent = (client: MockAuthoringClient): void => {
  client.preload({
    itemId: DATA_ITEM_ID,
    templateId: SITECORE_TEMPLATES.FOLDER,
    parentId: "00000000-0000-0000-0000-000000000000",
    name: "Data",
    path: DATA_PATH,
    fields: [],
  });
};

const seedStrandedTwin = (client: MockAuthoringClient, templateId: string): void => {
  client.preload({
    itemId: STRANDED_ITEM_ID,
    templateId,
    parentId: DATA_ITEM_ID,
    name: ITEM_NAME,
    path: ITEM_PATH,
    fields: [],
  });
};

/** Mock that simulates path-index lag: `getItem({path})` lies about listed paths. */
class LaggingMockClient extends MockAuthoringClient {
  private lagPaths = new Set<string>();
  hideFromPathIndex(path: string): void {
    this.lagPaths.add(path);
  }
  async getItem(selector: ItemSelector): Promise<RemoteItem | null> {
    if (selector.path && this.lagPaths.has(selector.path)) return null;
    return super.getItem(selector);
  }
  async getItemsByPaths(paths: readonly string[]): Promise<Map<string, RemoteItem | null>> {
    const result = await super.getItemsByPaths(paths);
    for (const p of this.lagPaths) {
      if (result.has(p)) result.set(p, null);
    }
    return result;
  }
}

const createMutationInput = (action: Awaited<ReturnType<typeof buildAction>>) => {
  expect(action.mutation?.kind).toBe("createItem");
  if (action.mutation?.kind !== "createItem") throw new Error("unreachable");
  return action.mutation.input;
};

describe("CreateItem — adopt-and-retemplate for stranded content-item name-twins", () => {
  it("routes a path-visible template-mismatched twin through a retemplating create", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    seedStrandedTwin(client, STALE_TEMPLATE_ID);
    const captured = capturedWithLiveTemplate();

    const action = await buildAction({
      index: 0,
      op: contentItemCreateOp(),
      client,
      capturedItemIds: captured,
    });

    // NOT the blind CreateOnly skip — the twin's template doesn't match,
    // so adopting it untouched would abort the first SetField. The plan
    // carries a create mutation whose apply-time pre-check adopts and
    // RETEMPLATES the twin (creates are pool barriers, so the heal lands
    // before any dependent field write dispatches).
    expect(action.status).toBe("create");
    const input = createMutationInput(action);
    expect(input.retemplateOnAdopt).toBe(true);
    expect(input.idempotencyCheck).toBe(true);
    expect(input.templateId).toBe(LIVE_TEMPLATE_ID);
    expect(action.reason).toMatch(/converging/i);
    expect(action.reason).toContain(STRANDED_ITEM_ID);
    // The adopted identity is still the twin's — downstream ops resolve it.
    expect(captured.get(ITEM_REF_KEY)).toBe(STRANDED_ITEM_ID);
  });

  it("routes a lag-hidden twin found by the sibling byName fallback the same way", async () => {
    const client = new LaggingMockClient();
    seedParent(client);
    seedStrandedTwin(client, STALE_TEMPLATE_ID);
    client.hideFromPathIndex(ITEM_PATH);
    const captured = capturedWithLiveTemplate();

    const action = await buildAction({
      index: 0,
      op: contentItemCreateOp(),
      client,
      capturedItemIds: captured,
    });

    expect(action.status).toBe("create");
    const input = createMutationInput(action);
    expect(input.retemplateOnAdopt).toBe(true);
    expect(input.templateId).toBe(LIVE_TEMPLATE_ID);
    expect(captured.get(ITEM_REF_KEY)).toBe(STRANDED_ITEM_ID);
  });

  it("keeps the plain CreateOnly skip when the twin's template matches", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    seedStrandedTwin(client, LIVE_TEMPLATE_ID);
    const captured = capturedWithLiveTemplate();

    const action = await buildAction({
      index: 0,
      op: contentItemCreateOp(),
      client,
      capturedItemIds: captured,
    });

    expect(action.status).toBe("skip");
    expect(action.reason).toContain("CreateOnly");
    expect(captured.get(ITEM_REF_KEY)).toBe(STRANDED_ITEM_ID);
  });

  it("normalizes GUID shape before comparing (undashed uppercase live template still matches)", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    seedStrandedTwin(client, LIVE_TEMPLATE_ID.replace(/-/g, "").toUpperCase());
    const captured = capturedWithLiveTemplate();

    const action = await buildAction({
      index: 0,
      op: contentItemCreateOp(),
      client,
      capturedItemIds: captured,
    });

    expect(action.status).toBe("skip");
  });

  it("defers to apply-time convergence when the expected template can't be resolved at plan time (batch-separated pushes)", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    seedStrandedTwin(client, STALE_TEMPLATE_ID);
    // No TEMPLATE_REF_KEY entry: in a batch-separated push the
    // datasource template's recipe lives in an EARLIER batch, so its
    // refKey is never captured here. Pre-0.34.4 this silently disabled
    // convergence (blind CreateOnly skip → the follow-up field op
    // aborted with "Cannot find a field with the name <X>"). The op's
    // templateOf is the deterministic template GUID, so the create
    // mutation resolves it as-is and the apply-time compare is
    // authoritative.
    const captured = new Map<string, string>([[DATA_PATH, DATA_ITEM_ID]]);

    const action = await buildAction({
      index: 0,
      op: contentItemCreateOp(),
      client,
      capturedItemIds: captured,
    });

    expect(action.status).toBe("create");
    const input = createMutationInput(action);
    expect(input.retemplateOnAdopt).toBe(true);
    expect(input.idempotencyCheck).toBe(true);
    expect(action.reason).toMatch(/cannot be template-verified at plan time/i);
    // The twin's identity stays captured for downstream ops; apply
    // re-captures the mutation's result (twin id on adopt, fresh id on
    // replace).
    expect(captured.get(ITEM_REF_KEY)).toBe(STRANDED_ITEM_ID);
  });

  it("leaves CreateAndUpdate structure ops on their drift-update behavior", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    seedStrandedTwin(client, STALE_TEMPLATE_ID);
    const captured = capturedWithLiveTemplate();

    const action = await buildAction({
      index: 0,
      op: contentItemCreateOp("CreateAndUpdate"),
      client,
      capturedItemIds: captured,
    });

    // Tracked-field drift (the twin lacks Title) → the normal
    // drift-update route; never the retemplate route.
    expect(action.status).toBe("update");
    expect(action.mutation?.kind).toBe("updateItem");
  });

  it("keeps the v0.33.0 lossless adopt-as-is for folder-class CreateOnly ops", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    // Twin folder created by an older scai under a legacy template.
    seedStrandedTwin(client, "da26c636-96e1-45e4-88d6-3fcec70d5699");
    const captured = capturedWithLiveTemplate();

    const folderOp: CreateItemOp = {
      ...contentItemCreateOp(),
      label: `content-items-folder:another-test:${ITEM_NAME}`,
      templateOf: SITECORE_TEMPLATES.FOLDER,
    };
    const action = await buildAction({
      index: 0,
      op: folderOp,
      client,
      capturedItemIds: captured,
    });

    // Folders carry no authored data — adoption stays lossless, no
    // retemplate route even though the live template differs.
    expect(action.status).toBe("skip");
    expect(action.reason).toContain("CreateOnly");
    expect(captured.get(ITEM_REF_KEY)).toBe(STRANDED_ITEM_ID);
  });

  it("keeps adopt-as-is for marker-only ops (recipe-created grouping folders)", async () => {
    // The v0.34.1 regression: `enumerations-grouping-folder:default:Card`
    // uses a RECIPE-CREATED folder template (per-site GUID family), so the
    // built-in folder-class set can't exclude it, its cross-seed twin's
    // template never matches by construction, and the retemplate attempt
    // aborted batch-1. A marker-only op seeds no authored data — adoption
    // is lossless and must stay untouched.
    const client = new MockAuthoringClient();
    seedParent(client);
    seedStrandedTwin(client, STALE_TEMPLATE_ID);
    const captured = capturedWithLiveTemplate();

    const groupingFolderOp: CreateItemOp = {
      ...contentItemCreateOp(),
      label: "enumerations-grouping-folder:default:Card",
      fields: contentItemFields().filter((f) => f.fieldName === "Scai Handle"),
    };
    const action = await buildAction({
      index: 0,
      op: groupingFolderOp,
      client,
      capturedItemIds: captured,
    });

    expect(action.status).toBe("skip");
    expect(action.reason).toContain("CreateOnly");
    expect(captured.get(ITEM_REF_KEY)).toBe(STRANDED_ITEM_ID);
  });

  it("does not flag marker-only fresh creates for apply-time retemplating either", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);

    const groupingFolderOp: CreateItemOp = {
      ...contentItemCreateOp(),
      label: "enumerations-grouping-folder:default:Card",
      fields: [],
    };
    const action = await buildAction({
      index: 0,
      op: groupingFolderOp,
      client,
      capturedItemIds: capturedWithLiveTemplate(),
    });

    expect(action.status).toBe("create");
    expect(createMutationInput(action).retemplateOnAdopt).toBeUndefined();
  });

  it("flags eligible fresh creates so APPLY-time adoption also retemplates", async () => {
    // Plan sees nothing at all (true miss or full-index lag with an
    // uncaptured twin) — the mutation must still carry the opt-in so the
    // client-side pre-check / already-exists fallback heals a twin the
    // planner never saw.
    const client = new MockAuthoringClient();
    seedParent(client);
    const captured = capturedWithLiveTemplate();

    const action = await buildAction({
      index: 0,
      op: contentItemCreateOp(),
      client,
      capturedItemIds: captured,
    });

    expect(action.status).toBe("create");
    const input = createMutationInput(action);
    expect(input.retemplateOnAdopt).toBe(true);
  });

  it("does not flag fresh creates for CreateAndUpdate ops; flags them regardless of plan-time template resolution", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);

    const structural = await buildAction({
      index: 0,
      op: contentItemCreateOp("CreateAndUpdate"),
      client,
      capturedItemIds: capturedWithLiveTemplate(),
    });
    expect(structural.status).toBe("create");
    expect(createMutationInput(structural).retemplateOnAdopt).toBeUndefined();

    // Eligibility is plan-local (policy + authored fields) — the
    // apply-time pre-check must converge twins the planner never saw
    // even when the template refKey wasn't captured in this batch.
    const unresolved = await buildAction({
      index: 1,
      op: contentItemCreateOp(),
      client,
      capturedItemIds: new Map([[DATA_PATH, DATA_ITEM_ID]]),
    });
    expect(unresolved.status).toBe("create");
    expect(createMutationInput(unresolved).retemplateOnAdopt).toBe(true);
  });
});

describe("CreateItem — marker-first identity (cross-recipe name collisions)", () => {
  const FOREIGN_HANDLE = "utility-link-support@1";

  const seedMarkedTwin = (client: MockAuthoringClient, marker: string, templateId: string): void =>
    client.preload({
      itemId: STRANDED_ITEM_ID,
      templateId,
      parentId: DATA_ITEM_ID,
      name: ITEM_NAME,
      path: ITEM_PATH,
      fields: [{ name: "Scai Handle", value: marker }],
    });

  it("errors precisely when the name-twin is owned by a DIFFERENT recipe", async () => {
    // The blank-environment batch-9 class: two recipes materialise items
    // with the same name under the shared content folder. The twin is the
    // OTHER recipe's item — adopting it can never be right (its template
    // may not resolve this recipe's fields; even when it does, both
    // recipes would ping-pong one item), and deleting it would destroy
    // the other recipe's content. Fail at plan time naming both owners.
    const client = new MockAuthoringClient();
    seedParent(client);
    seedMarkedTwin(client, FOREIGN_HANDLE, LIVE_TEMPLATE_ID);

    const action = await buildAction({
      index: 0,
      op: contentItemCreateOp(),
      client,
      capturedItemIds: capturedWithLiveTemplate(),
    });

    expect(action.status).toBe("error");
    expect(action.reason).toMatch(/name collision/i);
    expect(action.reason).toContain(FOREIGN_HANDLE);
    expect(action.reason).toContain("footer-link-features@1");
    expect(action.reason).toContain(STRANDED_ITEM_ID);
  });

  it("does not flag a re-versioned recipe's own twin (@1 -> @2 handle bump)", async () => {
    // The marker compares by versionless handle BASE: a re-released
    // recipe still owns its item and keeps the normal skip/convergence
    // semantics.
    const client = new MockAuthoringClient();
    seedParent(client);
    seedMarkedTwin(client, "footer-link-features@2", LIVE_TEMPLATE_ID);

    const action = await buildAction({
      index: 0,
      op: contentItemCreateOp(),
      client,
      capturedItemIds: capturedWithLiveTemplate(),
    });

    expect(action.status).toBe("skip");
    expect(action.reason).toContain("CreateOnly");
  });

  it("keeps adopting unmarked twins (pre-marker or user-created items)", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    seedStrandedTwin(client, LIVE_TEMPLATE_ID);

    const action = await buildAction({
      index: 0,
      op: contentItemCreateOp(),
      client,
      capturedItemIds: capturedWithLiveTemplate(),
    });

    expect(action.status).toBe("skip");
    expect(action.reason).toContain("CreateOnly");
  });

  it("adopts a FOREIGN-marked grouping folder as-is (shared folders wear only the first creator's marker)", async () => {
    // The 0.35.1 field-report class: shared organizational folders
    // (`Presentation/Enumerations/Layout`, `…/Navigation`) are claimed by
    // MANY recipes but carry the marker of whichever recipe created them
    // first. They have no authored fields, so the wrong-template failure
    // mode the guard exists for cannot occur — guarding them broke every
    // re-push against an environment with history ("Name collision: item
    // 'Layout' … is owned by recipe 'alignment@1', not 'alert-layout@1'").
    const client = new MockAuthoringClient();
    seedParent(client);
    seedMarkedTwin(client, FOREIGN_HANDLE, LIVE_TEMPLATE_ID);

    const folderOp: CreateItemOp = {
      ...contentItemCreateOp(),
      label: "enumerations-grouping-folder:default:Layout",
      fields: contentItemFields().filter((f) => f.fieldName === "Scai Handle"),
    };
    const action = await buildAction({
      index: 0,
      op: folderOp,
      client,
      capturedItemIds: capturedWithLiveTemplate(),
      fieldTargetRefKeys: new Set<string>(),
    });

    expect(action.status).toBe("skip");
    expect(action.reason).toContain("CreateOnly");
  });

  it("still errors for a FOREIGN-marked twin of a fieldless content item whose fields ride SetField ops", async () => {
    // The guard must keep protecting the real collision class: a
    // marker-only create whose fields arrive as separate SetField ops in
    // the same push (the 0.34.5 content-item shape).
    const client = new MockAuthoringClient();
    seedParent(client);
    seedMarkedTwin(client, FOREIGN_HANDLE, LIVE_TEMPLATE_ID);

    const markerOnly: CreateItemOp = {
      ...contentItemCreateOp(),
      fields: contentItemFields().filter((f) => f.fieldName === "Scai Handle"),
    };
    const action = await buildAction({
      index: 0,
      op: markerOnly,
      client,
      capturedItemIds: capturedWithLiveTemplate(),
      fieldTargetRefKeys: new Set([ITEM_REF_KEY]),
    });

    expect(action.status).toBe("error");
    expect(action.reason).toMatch(/name collision/i);
  });
});

describe("CreateItem — fieldless creates with downstream SetField ops converge too", () => {
  const markerOnlyOp = (): CreateItemOp => ({
    ...contentItemCreateOp(),
    fields: contentItemFields().filter((f) => f.fieldName === "Scai Handle"),
  });

  it("diverts an existing twin to apply-time convergence when this push writes its fields", async () => {
    // Content-item IRs seed fields as SEPARATE SetField ops, so the
    // create itself is marker-only and eligibility keyed on inline
    // fields missed it — the blank-environment blind skip. With the
    // push-wide field-target index the create converges like one with
    // inline fields.
    const client = new MockAuthoringClient();
    seedParent(client);
    seedStrandedTwin(client, STALE_TEMPLATE_ID);
    const captured = capturedWithLiveTemplate();

    const action = await buildAction({
      index: 0,
      op: markerOnlyOp(),
      client,
      capturedItemIds: captured,
      fieldTargetRefKeys: new Set([ITEM_REF_KEY]),
    });

    expect(action.status).toBe("create");
    const input = createMutationInput(action);
    expect(input.retemplateOnAdopt).toBe(true);
    expect(captured.get(ITEM_REF_KEY)).toBe(STRANDED_ITEM_ID);
  });

  it("still adopts marker-only grouping folders as-is (no SetField ops target them)", async () => {
    const client = new MockAuthoringClient();
    seedParent(client);
    seedStrandedTwin(client, STALE_TEMPLATE_ID);

    const action = await buildAction({
      index: 0,
      op: { ...markerOnlyOp(), label: "enumerations-grouping-folder:default:Card" },
      client,
      capturedItemIds: capturedWithLiveTemplate(),
      fieldTargetRefKeys: new Set<string>(),
    });

    expect(action.status).toBe("skip");
    expect(action.reason).toContain("CreateOnly");
  });
});
