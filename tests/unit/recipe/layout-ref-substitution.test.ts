import { describe, expect, it } from "vitest";
import { substituteCapturedGuids } from "../../../src/recipe/api/ref-encoding";
import { executeIr } from "../../../src/recipe/runtime/execute";
import { LAYOUT_FIELDS, SITECORE_TEMPLATES } from "../../../src/recipe/ir/sitecore-templates";
import type { CreateItemOp, OperationIr, SetFieldOp } from "../../../src/recipe/ir/operations";
import { MockAuthoringClient } from "./_fixtures/mock-client";

// Regression: layout XML is compiled to a plain string with uuidv5
// refKeys (renderingId / contentItemId / variantId) baked in, but the
// Authoring API mints its own item ids at create time — so without
// plan-time substitution every `s:id` / `ds` in a pushed layout points
// at an item id that does not exist on the tenant, and the layout
// service can never resolve the renderings (pages render empty even
// with a well-formed delta).

const RENDERING_REF = "aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb";
const PAGE_REF = "cccccccc-4444-4555-8666-dddddddddddd";
const DEVICE_ID = "fe5d7fdf-89c0-4d99-9aa3-b5fbd009c9f3";

describe("substituteCapturedGuids", () => {
  const captured = new Map([[RENDERING_REF, "0af1077dcb7b4d63ad34c8f21c9c0dd2"]]);

  it("replaces braced refKey tokens with the dashed captured id", () => {
    const input = `<r uid="{X}" s:id="{${RENDERING_REF.toUpperCase()}}" s:ph="main" />`;
    expect(substituteCapturedGuids(input, captured)).toContain(
      's:id="{0AF1077D-CB7B-4D63-AD34-C8F21C9C0DD2}"'
    );
  });

  it("replaces bare refKey tokens (URL-encoded par blobs) preserving surrounding text", () => {
    const input = `s:par="FieldNames=%7B${RENDERING_REF.toUpperCase()}%7D&Size=lg"`;
    const out = substituteCapturedGuids(input, captured);
    expect(out).toContain("FieldNames=%7B0AF1077D-CB7B-4D63-AD34-C8F21C9C0DD2%7D");
    expect(out).toContain("Size=lg");
  });

  it("leaves non-captured GUIDs (devices, Sitecore constants) untouched", () => {
    const input = `<d id="{${DEVICE_ID.toUpperCase()}}">`;
    expect(substituteCapturedGuids(input, captured)).toBe(input);
  });
});

describe("layout refKey substitution — end-to-end through executeIr (apply)", () => {
  it("a pushed layout's s:id resolves to the server-assigned rendering id", async () => {
    const client = new MockAuthoringClient();
    client.preload({
      itemId: "99999999-0000-4000-8000-000000000001",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: "00000000-0000-0000-0000-000000000000",
      name: "Home",
      path: "/sitecore/content/Demo/Home",
      fields: [],
    });
    const layoutXml =
      `<r xmlns:p="p" xmlns:s="s" p:p="1"><d id="{${DEVICE_ID.toUpperCase()}}">` +
      `<r uid="{11111111-2222-4333-8444-555555555555}" p:before="*" s:id="{${RENDERING_REF.toUpperCase()}}" s:par="DynamicPlaceholderId=1" s:ph="headless-main" />` +
      `</d></r>`;
    const ir: OperationIr = {
      schemaVersion: "1",
      recipeHandle: "sub@1",
      operations: [
        {
          op: "CreateItem",
          policy: "CreateAndUpdate",
          label: "rendering:widget@1",
          id: RENDERING_REF,
          path: "/sitecore/content/Demo/Home/Widget",
          parent: { kind: "ref-path", value: "/sitecore/content/Demo/Home" },
          templateOf: SITECORE_TEMPLATES.RENDERING,
          name: "Widget",
          fields: [],
        } satisfies CreateItemOp,
        {
          op: "CreateItem",
          policy: "CreateAndUpdate",
          label: "page:sub@1",
          id: PAGE_REF,
          path: "/sitecore/content/Demo/Home/Sub",
          parent: { kind: "ref-path", value: "/sitecore/content/Demo/Home" },
          templateOf: SITECORE_TEMPLATES.FOLDER,
          name: "Sub",
          fields: [],
        } satisfies CreateItemOp,
        {
          op: "SetField",
          policy: "CreateAndUpdate",
          label: "page-layout:sub@1:en",
          itemRefKey: PAGE_REF,
          fieldId: LAYOUT_FIELDS.FINAL_RENDERINGS,
          language: "en",
          version: 1,
          value: { kind: "string", value: layoutXml },
        } satisfies SetFieldOp,
      ],
    };

    const result = await executeIr(ir, client, { mode: "apply" });
    expect(result.aborted).toBe(false);
    expect(result.summary.error).toBe(0);

    const renderingItem = await client.getItem({ path: "/sitecore/content/Demo/Home/Widget" });
    const tenantRenderingId = renderingItem!.itemId; // dashless — server-minted
    expect(tenantRenderingId).not.toBe(RENDERING_REF);

    const page = await client.getItem({ path: "/sitecore/content/Demo/Home/Sub" });
    const stored = page!.fields.find(
      (f) => f.fieldId.toLowerCase() === LAYOUT_FIELDS.FINAL_RENDERINGS.toLowerCase()
    );
    expect(stored).toBeDefined();
    // The refKey never reaches the tenant; the server-assigned id does,
    // in dashed curly form.
    expect(stored!.value!.toLowerCase()).not.toContain(RENDERING_REF.toLowerCase());
    const dashed = tenantRenderingId
      .toLowerCase()
      .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
    expect(stored!.value!.toLowerCase()).toContain(`s:id="{${dashed}}"`);
    // Untouched: device GUID and the uid.
    expect(stored!.value!.toLowerCase()).toContain(`<d id="{${DEVICE_ID}}"`);
  });
});
