import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `uploadDocument` — URL-mode happy path, the 401 token-refresh retry,
 * and non-OK error wrapping. `acquireBrandToken` / `clearBrandToken` are
 * mocked and `fetch` is stubbed so the test asserts the wire shape
 * (form-urlencoded `create_request` JSON, references, headers) without
 * a real network call. The bytes-rejection path is covered separately
 * in tests/unit/brand/upload.test.ts.
 */
const authMock = vi.hoisted(() => ({ acquireBrandToken: vi.fn() }));
const keychainMock = vi.hoisted(() => ({ clearBrandToken: vi.fn() }));

vi.mock("../../../../src/brand/api/auth", () => ({
  acquireBrandToken: authMock.acquireBrandToken,
}));
vi.mock("../../../../src/shared/keychain", () => ({
  clearBrandToken: keychainMock.clearBrandToken,
}));

const { uploadDocument } = await import("../../../../src/brand/documents/upload");

const FAKE_CLIENT = { orgId: "org_ABC", credential: { clientId: "x" } } as never;

/** A JSON Response for the fetch stub. */
const okJson = (body: unknown, status = 201): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  authMock.acquireBrandToken.mockReset();
  keychainMock.clearBrandToken.mockReset();
  authMock.acquireBrandToken.mockResolvedValue("tok-1");
  keychainMock.clearBrandToken.mockResolvedValue(undefined);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadDocument — URL mode", () => {
  it("POSTs a form-urlencoded create_request with the URL, defaults and a brandkit reference", async () => {
    fetchMock.mockResolvedValue(okJson({ id: "doc-1", brandkitId: "kit-1" }));

    const result = await uploadDocument({
      client: FAKE_CLIENT,
      brandKitId: "kit-1",
      source: { kind: "url", url: "https://cdn.example/brand.pdf" },
    });

    expect(result).toMatchObject({ id: "doc-1" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain(
      "/stream/ai-document-api/api/documents/v2/organizations/org_ABC/documents"
    );
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(init.headers.Authorization).toBe("Bearer tok-1");

    const body = new URLSearchParams(String(init.body));
    const createRequest = JSON.parse(body.get("create_request")!) as {
      url: string;
      setMetadata: boolean;
      type: string;
      fileType: string;
      tags: string[];
      references: Array<{ type: string; id: string; path: string }>;
    };
    expect(createRequest.url).toBe("https://cdn.example/brand.pdf");
    expect(createRequest.setMetadata).toBe(true);
    expect(createRequest.type).toBe("brand guidelines");
    expect(createRequest.fileType).toBe("application/pdf");
    expect(createRequest.tags).toEqual([]);
    expect(createRequest.references[0]).toEqual({
      type: "brandkit",
      id: "kit-1",
      path: "/api/brands/v1/organizations/org_ABC/brandkits/kit-1/references",
    });
  });

  it("accepts the shorthand { url } source form", async () => {
    fetchMock.mockResolvedValue(okJson({ id: "doc-2" }));

    await uploadDocument({
      client: FAKE_CLIENT,
      brandKitId: "kit-1",
      source: { url: "https://cdn.example/x.pdf" },
    });

    const body = new URLSearchParams(String(fetchMock.mock.calls[0]![1].body));
    const createRequest = JSON.parse(body.get("create_request")!) as { url: string };
    expect(createRequest.url).toBe("https://cdn.example/x.pdf");
  });

  it("forwards explicit metadata overrides into the create_request", async () => {
    fetchMock.mockResolvedValue(okJson({ id: "doc-3" }));

    await uploadDocument({
      client: FAKE_CLIENT,
      brandKitId: "kit-1",
      source: { kind: "url", url: "https://cdn.example/x.docx" },
      type: "spec",
      fileType: "application/vnd.openxmlformats",
      title: "My Spec",
      summary: "summary text",
      tags: ["a", "b"],
      setMetadata: false,
    });

    const body = new URLSearchParams(String(fetchMock.mock.calls[0]![1].body));
    const createRequest = JSON.parse(body.get("create_request")!) as Record<string, unknown>;
    expect(createRequest).toMatchObject({
      type: "spec",
      fileType: "application/vnd.openxmlformats",
      title: "My Spec",
      summary: "summary text",
      tags: ["a", "b"],
      setMetadata: false,
    });
  });

  it("clears the cached token and retries once on a 401", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(okJson({ id: "doc-retry" }));
    authMock.acquireBrandToken.mockResolvedValueOnce("stale").mockResolvedValueOnce("fresh");

    const result = await uploadDocument({
      client: FAKE_CLIENT,
      brandKitId: "kit-1",
      source: { kind: "url", url: "https://cdn.example/x.pdf" },
    });

    expect(result).toMatchObject({ id: "doc-retry" });
    expect(keychainMock.clearBrandToken).toHaveBeenCalledWith("org_ABC");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![1].headers.Authorization).toBe("Bearer fresh");
  });

  it("wraps a non-OK response as BRAND_API_FAILED with the status in the message", async () => {
    fetchMock.mockResolvedValue(new Response("bad url", { status: 422 }));

    await expect(
      uploadDocument({
        client: FAKE_CLIENT,
        brandKitId: "kit-1",
        source: { kind: "url", url: "https://cdn.example/x.pdf" },
      })
    ).rejects.toMatchObject({ code: "BRAND_API_FAILED", message: expect.stringContaining("422") });
  });
});
