import { describe, expect, it } from "vitest";
import { buildAction } from "../../../src/recipe/runtime/plan";
import type { SetBaseTemplatesOp } from "../../../src/recipe/ir/operations";
import { STANDARD_TEMPLATE_ID } from "../../../src/recipe/ir/sitecore-templates";
import { MockAuthoringClient } from "./_fixtures/mock-client";

const TEMPLATE_REF_KEY = "22222222-2222-2222-2222-222222222222";
const TEMPLATE_ITEM_ID = "11111111-1111-1111-1111-111111111111";
const TEMPLATE_PATH = "/sitecore/templates/Project/Acme Collection/acme/Pages/Page";

const COLLECTION_PAGE_PATH = "/sitecore/templates/Project/Acme Collection/Page";
const COLLECTION_PAGE_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FALLBACK_FACET = "99999999-9999-4999-8999-999999999999";

const newOp = (): SetBaseTemplatesOp => ({
  op: "SetBaseTemplates",
  policy: "CreateAndUpdate",
  label: "base-templates:page@1",
  itemRefKey: TEMPLATE_REF_KEY,
  baseTemplates: [STANDARD_TEMPLATE_ID],
  pathBases: [{ path: COLLECTION_PAGE_PATH, fallbackTemplates: [FALLBACK_FACET] }],
});

const seedTargetTemplate = (client: MockAuthoringClient): void => {
  client.preload({
    itemId: TEMPLATE_ITEM_ID,
    templateId: "abcdef01-2345-6789-abcd-ef0123456789",
    parentId: "00000000-0000-0000-0000-000000000000",
    name: "Page",
    path: TEMPLATE_PATH,
    fields: [],
  });
};

const seedCollectionPage = (client: MockAuthoringClient): void => {
  client.preload({
    itemId: COLLECTION_PAGE_ID,
    templateId: "abcdef01-2345-6789-abcd-ef0123456789",
    parentId: "00000000-0000-0000-0000-000000000000",
    name: "Page",
    path: COLLECTION_PAGE_PATH,
    fields: [],
  });
};

const desiredBaseList = async (client: MockAuthoringClient): Promise<string[]> => {
  const captured = new Map<string, string>([[TEMPLATE_REF_KEY, TEMPLATE_ITEM_ID]]);
  const action = await buildAction({ index: 0, op: newOp(), client, capturedItemIds: captured });
  expect(action.status).toBe("update");
  if (action.mutation?.kind !== "updateItem") throw new Error("expected updateItem mutation");
  const field = action.mutation.input.fields[0];
  if (field.value.kind !== "ref-guid-list") throw new Error("expected ref-guid-list value");
  return field.value.values.map((guid) => guid.toLowerCase());
};

describe("SetBaseTemplates — pathBases resolution", () => {
  it("inherits the live item when the tenant path exists (fallbacks unused)", async () => {
    const client = new MockAuthoringClient();
    seedTargetTemplate(client);
    seedCollectionPage(client);

    const values = await desiredBaseList(client);
    expect(values).toContain(STANDARD_TEMPLATE_ID.toLowerCase());
    expect(values).toContain(COLLECTION_PAGE_ID.toLowerCase());
    expect(values).not.toContain(FALLBACK_FACET.toLowerCase());
  });

  it("falls back to fallbackTemplates when the tenant path is missing", async () => {
    const client = new MockAuthoringClient();
    seedTargetTemplate(client);

    const values = await desiredBaseList(client);
    expect(values).toContain(STANDARD_TEMPLATE_ID.toLowerCase());
    expect(values).toContain(FALLBACK_FACET.toLowerCase());
    expect(values).not.toContain(COLLECTION_PAGE_ID.toLowerCase());
  });

  it("skips as drift-free on re-push once the resolved base list is on the tenant", async () => {
    const client = new MockAuthoringClient();
    seedTargetTemplate(client);
    seedCollectionPage(client);

    const captured = new Map<string, string>([[TEMPLATE_REF_KEY, TEMPLATE_ITEM_ID]]);
    const first = await buildAction({
      index: 0,
      op: newOp(),
      client,
      capturedItemIds: captured,
    });
    expect(first.status).toBe("update");
    if (first.mutation?.kind !== "updateItem") throw new Error("expected updateItem mutation");
    const written = first.mutation.input.fields[0];
    if (written.value.kind !== "ref-guid-list") throw new Error("expected ref-guid-list value");

    // Simulate the tenant carrying the applied value (Sitecore stores a
    // pipe-separated curly-GUID list), then re-plan.
    client.preload({
      itemId: TEMPLATE_ITEM_ID,
      templateId: "abcdef01-2345-6789-abcd-ef0123456789",
      parentId: "00000000-0000-0000-0000-000000000000",
      name: "Page",
      path: TEMPLATE_PATH,
      fields: [
        {
          fieldId: written.fieldId,
          name: "__Base template",
          value: written.value.values.map((guid) => `{${guid.toUpperCase()}}`).join("|"),
        },
      ],
    });
    const second = await buildAction({
      index: 0,
      op: newOp(),
      client,
      capturedItemIds: captured,
    });
    expect(second.status).toBe("skip");
  });
});
