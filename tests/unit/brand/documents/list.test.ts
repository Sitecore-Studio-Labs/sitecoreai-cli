import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `listDocuments` / `getDocument` / `deleteDocument` request shaping.
 * `requestBrandApi` is mocked so each test asserts the transport call
 * args (path, method, query) and the returned payload. The DELETE
 * endpoint deliberately lives on v1 while list/get are v2 — covered
 * explicitly below. No network.
 */
const requestMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../src/brand/api/client", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/brand/api/client")>(
    "../../../../src/brand/api/client"
  );
  return { ...actual, requestBrandApi: requestMock };
});

const { listDocuments, getDocument, deleteDocument } =
  await import("../../../../src/brand/documents/list");

const FAKE_CLIENT = { orgId: "org_ABC", credential: { clientId: "x" } } as never;

beforeEach(() => {
  requestMock.mockReset();
});

describe("listDocuments", () => {
  it("GETs the v2 documents endpoint and returns the paginated envelope", async () => {
    const envelope = { totalCount: 1, data: [{ id: "doc-1", status: "processed" }] };
    requestMock.mockResolvedValue(envelope);

    const result = await listDocuments({ client: FAKE_CLIENT });

    const [, req] = requestMock.mock.calls[0]!;
    expect(req).toMatchObject({
      path: "/api/documents/v2/organizations/org_ABC/documents",
      method: "GET",
    });
    expect(result).toBe(envelope);
  });

  it("leaves all query keys undefined when no filters are passed", async () => {
    requestMock.mockResolvedValue({ totalCount: 0, data: [] });

    await listDocuments({ client: FAKE_CLIENT });

    expect(requestMock.mock.calls[0]![1].query).toEqual({
      brandkitId: undefined,
      status: undefined,
      pageNumber: undefined,
      pageSize: undefined,
    });
  });

  it("maps brandKitId/status/pagination into the query string", async () => {
    requestMock.mockResolvedValue({ totalCount: 0, data: [] });

    await listDocuments({
      client: FAKE_CLIENT,
      brandKitId: "kit-1",
      status: "failed",
      pageNumber: 3,
      pageSize: 10,
    });

    expect(requestMock.mock.calls[0]![1].query).toEqual({
      brandkitId: "kit-1",
      status: "failed",
      pageNumber: "3",
      pageSize: "10",
    });
  });
});

describe("getDocument", () => {
  it("GETs the v2 single-document endpoint and returns the summary", async () => {
    requestMock.mockResolvedValue({ id: "doc-9", status: "processed", chunked: true });

    const result = await getDocument({ client: FAKE_CLIENT, documentId: "doc-9" });

    const [, req] = requestMock.mock.calls[0]!;
    expect(req).toMatchObject({
      path: "/api/documents/v2/organizations/org_ABC/documents/doc-9",
      method: "GET",
    });
    expect(result).toMatchObject({ id: "doc-9", chunked: true });
  });

  it("threads an AbortSignal through to the transport", async () => {
    requestMock.mockResolvedValue({ id: "doc-9" });
    const signal = new AbortController().signal;

    await getDocument({ client: FAKE_CLIENT, documentId: "doc-9", signal });

    expect(requestMock.mock.calls[0]![1].signal).toBe(signal);
  });
});

describe("deleteDocument", () => {
  it("issues a DELETE against the v1 (not v2) document endpoint", async () => {
    requestMock.mockResolvedValue(undefined);

    await expect(
      deleteDocument({ client: FAKE_CLIENT, documentId: "doc-3" })
    ).resolves.toBeUndefined();

    const [, req] = requestMock.mock.calls[0]!;
    expect(req).toMatchObject({
      path: "/api/documents/v1/organizations/org_ABC/documents/doc-3",
      method: "DELETE",
    });
  });

  it("propagates a transport rejection to the caller", async () => {
    requestMock.mockRejectedValue(
      Object.assign(new Error("not found"), { code: "BRAND_API_FAILED" })
    );

    await expect(
      deleteDocument({ client: FAKE_CLIENT, documentId: "ghost" })
    ).rejects.toMatchObject({ code: "BRAND_API_FAILED" });
  });
});
