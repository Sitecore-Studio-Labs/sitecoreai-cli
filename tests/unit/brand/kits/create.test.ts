import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `createBrandKit` / `publishBrandKit` / `deleteBrandKit` request shaping.
 * `requestBrandApi` is mocked so each test asserts the transport call
 * args (path, method, body) and the returned summary. No network.
 */
const requestMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../src/brand/api/client", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/brand/api/client")>(
    "../../../../src/brand/api/client"
  );
  return { ...actual, requestBrandApi: requestMock };
});

const { createBrandKit, publishBrandKit, deleteBrandKit } =
  await import("../../../../src/brand/kits/create");

const FAKE_CLIENT = { orgId: "org_ABC", credential: { clientId: "x" } } as never;

beforeEach(() => {
  requestMock.mockReset();
});

describe("createBrandKit", () => {
  it("POSTs to the org-scoped brandkits endpoint with the name in the body", async () => {
    requestMock.mockResolvedValue({ id: "kit-1", name: "Acme", status: "draft" });

    const result = await createBrandKit({ client: FAKE_CLIENT, name: "Acme" });

    const [, req] = requestMock.mock.calls[0]!;
    expect(req).toMatchObject({
      path: "/api/brands/v1/organizations/org_ABC/brandkits",
      method: "POST",
    });
    expect(req.body).toMatchObject({ name: "Acme" });
    expect(result).toMatchObject({ id: "kit-1", status: "draft" });
  });

  it("defaults brandName to name when brandName is omitted", async () => {
    requestMock.mockResolvedValue({ id: "kit-1", name: "Acme" });

    await createBrandKit({ client: FAKE_CLIENT, name: "Acme" });

    expect(requestMock.mock.calls[0]![1].body).toMatchObject({ brandName: "Acme" });
  });

  it("passes through every optional field and an explicit brandName + signal", async () => {
    requestMock.mockResolvedValue({ id: "kit-2", name: "Acme" });
    const signal = new AbortController().signal;

    await createBrandKit({
      client: FAKE_CLIENT,
      name: "Acme",
      brandName: "Acme Internal",
      description: "desc",
      industry: "retail",
      companyName: "Acme Corp",
      logo: "https://cdn.example/logo.png",
      signal,
    });

    const [, req] = requestMock.mock.calls[0]!;
    expect(req.body).toEqual({
      name: "Acme",
      brandName: "Acme Internal",
      description: "desc",
      industry: "retail",
      companyName: "Acme Corp",
      logo: "https://cdn.example/logo.png",
    });
    expect(req.signal).toBe(signal);
  });
});

describe("publishBrandKit", () => {
  it("PATCHes the kit with status: published", async () => {
    requestMock.mockResolvedValue({ id: "kit-1", status: "published" });

    const result = await publishBrandKit({ client: FAKE_CLIENT, brandKitId: "kit-1" });

    const [, req] = requestMock.mock.calls[0]!;
    expect(req).toMatchObject({
      path: "/api/brands/v1/organizations/org_ABC/brandkits/kit-1",
      method: "PATCH",
    });
    expect(req.body).toEqual({ status: "published" });
    expect(result).toMatchObject({ status: "published" });
  });

  it("threads an AbortSignal through to the transport", async () => {
    requestMock.mockResolvedValue({ id: "kit-1", status: "published" });
    const signal = new AbortController().signal;

    await publishBrandKit({ client: FAKE_CLIENT, brandKitId: "kit-1", signal });

    expect(requestMock.mock.calls[0]![1].signal).toBe(signal);
  });
});

describe("deleteBrandKit", () => {
  it("issues a DELETE against the kit endpoint and resolves void", async () => {
    requestMock.mockResolvedValue(undefined);

    await expect(
      deleteBrandKit({ client: FAKE_CLIENT, brandKitId: "kit-9" })
    ).resolves.toBeUndefined();

    const [, req] = requestMock.mock.calls[0]!;
    expect(req).toMatchObject({
      path: "/api/brands/v1/organizations/org_ABC/brandkits/kit-9",
      method: "DELETE",
    });
  });

  it("propagates a transport rejection (e.g. 404) to the caller", async () => {
    requestMock.mockRejectedValue(
      Object.assign(new Error("not found"), { code: "BRAND_API_FAILED" })
    );

    await expect(
      deleteBrandKit({ client: FAKE_CLIENT, brandKitId: "ghost" })
    ).rejects.toMatchObject({ code: "BRAND_API_FAILED" });
  });
});
