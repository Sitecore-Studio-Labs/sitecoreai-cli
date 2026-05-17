import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `listBrandKitSections` / `listBrandKitFields` / `updateBrandKitField`
 * request shaping. `requestBrandApi` is mocked so each test asserts the
 * transport call args (path, method, body) and the returned payload.
 * `updateBrandKitField` builds a partial body — only keys present in
 * the options should appear. No network.
 */
const requestMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../src/brand/api/client", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/brand/api/client")>(
    "../../../../src/brand/api/client"
  );
  return { ...actual, requestBrandApi: requestMock };
});

const { listBrandKitSections, listBrandKitFields, updateBrandKitField } =
  await import("../../../../src/brand/kits/sections");

const FAKE_CLIENT = { orgId: "org_ABC", credential: { clientId: "x" } } as never;

beforeEach(() => {
  requestMock.mockReset();
});

describe("listBrandKitSections", () => {
  it("GETs the v1 sections endpoint and returns the bare array", async () => {
    const sections = [{ id: "s1", name: "Brand Context" }];
    requestMock.mockResolvedValue(sections);

    const result = await listBrandKitSections({ client: FAKE_CLIENT, brandKitId: "kit-1" });

    const [, req] = requestMock.mock.calls[0]!;
    expect(req).toMatchObject({
      path: "/api/brands/v1/organizations/org_ABC/brandkits/kit-1/sections",
      method: "GET",
    });
    expect(result).toBe(sections);
  });

  it("threads an AbortSignal through to the transport", async () => {
    requestMock.mockResolvedValue([]);
    const signal = new AbortController().signal;

    await listBrandKitSections({ client: FAKE_CLIENT, brandKitId: "kit-1", signal });

    expect(requestMock.mock.calls[0]![1].signal).toBe(signal);
  });
});

describe("listBrandKitFields", () => {
  it("GETs the v2 fields endpoint scoped to the section", async () => {
    const fields = [{ id: "f1", name: "Tone", type: "text" }];
    requestMock.mockResolvedValue(fields);

    const result = await listBrandKitFields({
      client: FAKE_CLIENT,
      brandKitId: "kit-1",
      sectionId: "sec-1",
    });

    const [, req] = requestMock.mock.calls[0]!;
    expect(req).toMatchObject({
      path: "/api/brands/v2/organizations/org_ABC/brandkits/kit-1/sections/sec-1/fields",
      method: "GET",
    });
    expect(result).toBe(fields);
  });
});

describe("updateBrandKitField", () => {
  it("PATCHes the v2 field endpoint and includes only the keys that were supplied", async () => {
    requestMock.mockResolvedValue({ id: "f1", name: "Tone", value: "Bold" });

    const result = await updateBrandKitField({
      client: FAKE_CLIENT,
      brandKitId: "kit-1",
      sectionId: "sec-1",
      fieldId: "f-1",
      value: "Bold",
    });

    const [, req] = requestMock.mock.calls[0]!;
    expect(req).toMatchObject({
      path: "/api/brands/v2/organizations/org_ABC/brandkits/kit-1/sections/sec-1/fields/f-1",
      method: "PATCH",
    });
    // Only `value` was passed — the body must carry exactly that key.
    expect(req.body).toEqual({ value: "Bold" });
    expect(result).toMatchObject({ id: "f1", value: "Bold" });
  });

  it("sends an empty body when no mutable fields are supplied", async () => {
    requestMock.mockResolvedValue({ id: "f1", name: "Tone" });

    await updateBrandKitField({
      client: FAKE_CLIENT,
      brandKitId: "kit-1",
      sectionId: "sec-1",
      fieldId: "f-1",
    });

    expect(requestMock.mock.calls[0]![1].body).toEqual({});
  });

  it("forwards every supported mutable key into the PATCH body", async () => {
    requestMock.mockResolvedValue({ id: "f1", name: "Renamed" });

    await updateBrandKitField({
      client: FAKE_CLIENT,
      brandKitId: "kit-1",
      sectionId: "sec-1",
      fieldId: "f-1",
      value: [{ name: "Do this" }],
      intent: "new intent",
      verified: true,
      aiEditable: false,
      order: 3,
      name: "Renamed",
    });

    expect(requestMock.mock.calls[0]![1].body).toEqual({
      value: [{ name: "Do this" }],
      intent: "new intent",
      verified: true,
      aiEditable: false,
      order: 3,
      name: "Renamed",
    });
  });

  it("includes a verified:false flag rather than dropping it", async () => {
    requestMock.mockResolvedValue({ id: "f1", name: "Tone" });

    await updateBrandKitField({
      client: FAKE_CLIENT,
      brandKitId: "kit-1",
      sectionId: "sec-1",
      fieldId: "f-1",
      verified: false,
    });

    expect(requestMock.mock.calls[0]![1].body).toEqual({ verified: false });
  });
});
