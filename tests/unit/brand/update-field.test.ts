import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrandApiClientOptions } from "../../../src/brand/api/client";

/**
 * Unit tests for `updateBrandKitField` — the direct-PATCH primitive
 * that bypasses the AI enrichment pipeline. This is the only reliable
 * population path for synthesized / AI-generated brand kits, since
 * Chrome and WeasyPrint PDFs both fail Sitecore's ingestion parser.
 *
 * Tests mock the HTTP layer and verify URL shape, partial-update
 * semantics (only sent keys are forwarded), and the discriminated
 * value type (text vs array vs richArray).
 */

const requestMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/brand/api/client", async () => {
  const actual = await vi.importActual<typeof import("../../../src/brand/api/client")>(
    "../../../src/brand/api/client"
  );
  return { ...actual, requestBrandApi: requestMock };
});

const FAKE_CLIENT: BrandApiClientOptions = {
  orgId: "org_ABC",
  credential: { clientId: "x" } as never,
};

const { updateBrandKitField } = await import("../../../src/brand/kits/sections");

describe("updateBrandKitField", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("PATCHes the field URL with method=PATCH", async () => {
    requestMock.mockResolvedValueOnce({ id: "field-1", value: "hi" });
    await updateBrandKitField({
      client: FAKE_CLIENT,
      brandKitId: "kit-1",
      sectionId: "sec-1",
      fieldId: "field-1",
      value: "hi",
    });
    expect(requestMock).toHaveBeenCalledWith(
      FAKE_CLIENT,
      expect.objectContaining({
        method: "PATCH",
        path: "/api/brands/v2/organizations/org_ABC/brandkits/kit-1/sections/sec-1/fields/field-1",
      })
    );
  });

  it("forwards only the keys present in options (partial update)", async () => {
    requestMock.mockResolvedValueOnce({ id: "field-1" });
    await updateBrandKitField({
      client: FAKE_CLIENT,
      brandKitId: "kit-1",
      sectionId: "sec-1",
      fieldId: "field-1",
      verified: true,
      // No value, no intent — should NOT appear in the body.
    });
    const call = requestMock.mock.calls[0][1];
    expect(call.body).toEqual({ verified: true });
    expect(call.body).not.toHaveProperty("value");
    expect(call.body).not.toHaveProperty("intent");
  });

  it("forwards string values verbatim for text fields", async () => {
    requestMock.mockResolvedValueOnce({ id: "field-1", value: "x" });
    await updateBrandKitField({
      client: FAKE_CLIENT,
      brandKitId: "kit-1",
      sectionId: "sec-1",
      fieldId: "field-1",
      value: "Allstate's voice is reassuring, plainspoken, confident.",
    });
    expect(requestMock.mock.calls[0][1].body.value).toBe(
      "Allstate's voice is reassuring, plainspoken, confident."
    );
  });

  it("forwards array values for `array` fields", async () => {
    requestMock.mockResolvedValueOnce({ id: "field-1" });
    const value = [{ name: "First do" }, { name: "Second do" }];
    await updateBrandKitField({
      client: FAKE_CLIENT,
      brandKitId: "kit-1",
      sectionId: "sec-1",
      fieldId: "field-1",
      value,
    });
    expect(requestMock.mock.calls[0][1].body.value).toEqual(value);
  });

  it("forwards richArray values (with tags + restrictions) for `richArray` fields", async () => {
    requestMock.mockResolvedValueOnce({ id: "field-1" });
    const value = [
      { name: "Marketing voice", tags: ["Marketing"], restrictions: "No false urgency" },
      { name: "Claims voice", tags: ["Claims"], restrictions: "No marketing CTAs" },
    ];
    await updateBrandKitField({
      client: FAKE_CLIENT,
      brandKitId: "kit-1",
      sectionId: "sec-1",
      fieldId: "field-1",
      value,
    });
    expect(requestMock.mock.calls[0][1].body.value).toEqual(value);
  });

  it("supports updating intent / aiEditable / order / name without value", async () => {
    requestMock.mockResolvedValueOnce({ id: "field-1" });
    await updateBrandKitField({
      client: FAKE_CLIENT,
      brandKitId: "kit-1",
      sectionId: "sec-1",
      fieldId: "field-1",
      intent: "Updated intent",
      aiEditable: false,
      order: 3,
      name: "Renamed field",
    });
    expect(requestMock.mock.calls[0][1].body).toEqual({
      intent: "Updated intent",
      aiEditable: false,
      order: 3,
      name: "Renamed field",
    });
  });

  it("returns the server's BrandKitFieldSummary verbatim", async () => {
    requestMock.mockResolvedValueOnce({
      id: "field-1",
      name: "Brand purpose",
      type: "text",
      value: "patched",
      verified: true,
    });
    const result = await updateBrandKitField({
      client: FAKE_CLIENT,
      brandKitId: "kit-1",
      sectionId: "sec-1",
      fieldId: "field-1",
      value: "patched",
      verified: true,
    });
    expect(result).toMatchObject({
      id: "field-1",
      name: "Brand purpose",
      type: "text",
      value: "patched",
      verified: true,
    });
  });
});
