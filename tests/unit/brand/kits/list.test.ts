import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `listBrandKits` / `getBrandKit` request shaping. `requestBrandApi` is
 * mocked so each test asserts the transport call args (path, method,
 * query) and the returned payload. No network.
 */
const requestMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../src/brand/api/client", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/brand/api/client")>(
    "../../../../src/brand/api/client"
  );
  return { ...actual, requestBrandApi: requestMock };
});

const { listBrandKits, getBrandKit } = await import("../../../../src/brand/kits/list");

const FAKE_CLIENT = { orgId: "org_ABC", credential: { clientId: "x" } } as never;

beforeEach(() => {
  requestMock.mockReset();
});

describe("listBrandKits", () => {
  it("GETs the org-scoped brandkits endpoint and returns the paginated envelope", async () => {
    const envelope = {
      totalCount: 2,
      data: [
        { id: "k1", name: "A" },
        { id: "k2", name: "B" },
      ],
    };
    requestMock.mockResolvedValue(envelope);

    const result = await listBrandKits({ client: FAKE_CLIENT });

    const [, req] = requestMock.mock.calls[0]!;
    expect(req).toMatchObject({
      path: "/api/brands/v1/organizations/org_ABC/brandkits",
      method: "GET",
    });
    expect(result).toBe(envelope);
  });

  it("omits pagination query keys when pageNumber/pageSize are not given", async () => {
    requestMock.mockResolvedValue({ totalCount: 0, data: [] });

    await listBrandKits({ client: FAKE_CLIENT });

    expect(requestMock.mock.calls[0]![1].query).toEqual({
      pageNumber: undefined,
      pageSize: undefined,
    });
  });

  it("stringifies pageNumber and pageSize into the query when supplied", async () => {
    requestMock.mockResolvedValue({ totalCount: 0, data: [] });

    await listBrandKits({ client: FAKE_CLIENT, pageNumber: 2, pageSize: 25 });

    expect(requestMock.mock.calls[0]![1].query).toEqual({ pageNumber: "2", pageSize: "25" });
  });

  it("stringifies a pageNumber of 0 rather than dropping it", async () => {
    requestMock.mockResolvedValue({ totalCount: 0, data: [] });

    await listBrandKits({ client: FAKE_CLIENT, pageNumber: 0 });

    expect(requestMock.mock.calls[0]![1].query.pageNumber).toBe("0");
  });
});

describe("getBrandKit", () => {
  it("GETs the single-kit endpoint and returns the summary", async () => {
    requestMock.mockResolvedValue({ id: "kit-7", name: "Acme", status: "published" });

    const result = await getBrandKit({ client: FAKE_CLIENT, brandKitId: "kit-7" });

    const [, req] = requestMock.mock.calls[0]!;
    expect(req).toMatchObject({
      path: "/api/brands/v1/organizations/org_ABC/brandkits/kit-7",
      method: "GET",
    });
    expect(result).toMatchObject({ id: "kit-7", status: "published" });
  });

  it("threads an AbortSignal through to the transport", async () => {
    requestMock.mockResolvedValue({ id: "kit-7", name: "Acme" });
    const signal = new AbortController().signal;

    await getBrandKit({ client: FAKE_CLIENT, brandKitId: "kit-7", signal });

    expect(requestMock.mock.calls[0]![1].signal).toBe(signal);
  });
});
