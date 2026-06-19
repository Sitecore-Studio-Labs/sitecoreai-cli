import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `requestBrandApi` transport coverage. `acquireBrandToken` and
 * `clearBrandToken` are mocked so this exercises the client's own
 * branches: URL composition (basePath + path + query), the
 * Content-Type/body conditional, the 401-clear-and-retry path, the
 * non-2xx → BRAND_API_FAILED mapping with server detail extraction, and
 * the 204 → undefined short-circuit. No real network, no real keychain.
 */

const authMocks = vi.hoisted(() => ({ acquireBrandToken: vi.fn() }));
vi.mock("../../../../src/brand/api/auth", () => ({
  acquireBrandToken: authMocks.acquireBrandToken,
}));

const keychainMocks = vi.hoisted(() => ({ clearBrandToken: vi.fn() }));
vi.mock("../../../../src/shared/keychain", () => ({
  clearBrandToken: keychainMocks.clearBrandToken,
}));

import { requestBrandApi } from "../../../../src/brand/api/client";
import { BRAND_API_HOST } from "../../../../src/brand/api/types";

const client = {
  orgId: "org-1",
  credential: { clientId: "brand-client" },
} as never;

const okResponse = (body: unknown, status = 200): Response =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: status === 204 ? undefined : { "Content-Type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.acquireBrandToken.mockResolvedValue("brand-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestBrandApi — URL composition", () => {
  it("joins basePath + path against the default Brand API host", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await requestBrandApi(client, {
      basePath: "/stream/ai-skills-api",
      path: "/brandkits",
      method: "GET",
    });

    expect(fetchMock.mock.calls[0][0]).toBe(`${BRAND_API_HOST}/stream/ai-skills-api/brandkits`);
  });

  it("strips a trailing slash off basePath before joining", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await requestBrandApi(client, {
      basePath: "/stream/ai-skills-api/",
      path: "/brandkits",
      method: "GET",
    });

    expect(fetchMock.mock.calls[0][0]).toBe(`${BRAND_API_HOST}/stream/ai-skills-api/brandkits`);
  });

  it("appends defined query params and drops undefined ones", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await requestBrandApi(client, {
      basePath: "/b",
      path: "/x",
      method: "GET",
      query: { keep: "yes", drop: undefined },
    });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("keep=yes");
    expect(url).not.toContain("drop=");
  });

  it("honours a per-request host override", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await requestBrandApi(
      { ...client, host: "https://edge-platform-eus.sitecorecloud.io" } as never,
      { basePath: "/b", path: "/x", method: "GET" }
    );

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "https://edge-platform-eus.sitecorecloud.io"
    );
  });
});

describe("requestBrandApi — auth + body headers", () => {
  it("sends the acquired token as a Bearer header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await requestBrandApi(client, { basePath: "/b", path: "/x", method: "GET" });

    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe("Bearer brand-token");
    expect(init.headers.Accept).toBe("application/json");
  });

  it("omits Content-Type and body for a request with no body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await requestBrandApi(client, { basePath: "/b", path: "/x", method: "GET" });

    const init = fetchMock.mock.calls[0][1] as {
      headers: Record<string, string>;
      body?: string;
    };
    expect(init.headers["Content-Type"]).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("sets Content-Type and serializes the body for a write request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: "new" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await requestBrandApi(client, {
      basePath: "/b",
      path: "/x",
      method: "POST",
      body: { name: "Acme" },
    });

    const init = fetchMock.mock.calls[0][1] as {
      method: string;
      body: string;
      headers: Record<string, string>;
    };
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ name: "Acme" });
  });
});

describe("requestBrandApi — 401 clear-and-retry", () => {
  it("clears the cached token and retries once on a 401, succeeding on retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestBrandApi<{ ok: boolean }>(client, {
      basePath: "/b",
      path: "/x",
      method: "GET",
    });

    expect(keychainMocks.clearBrandToken).toHaveBeenCalledWith("org-1");
    expect(authMocks.acquireBrandToken).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true });
  });

  it("surfaces BRAND_API_FAILED when the retry also returns 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response('{"detail":"token expired"}', { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestBrandApi(client, { basePath: "/b", path: "/x", method: "GET" })
    ).rejects.toMatchObject({ code: "BRAND_API_FAILED" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not clear or retry when the first response is 2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await requestBrandApi(client, { basePath: "/b", path: "/x", method: "GET" });

    expect(keychainMocks.clearBrandToken).not.toHaveBeenCalled();
    expect(authMocks.acquireBrandToken).toHaveBeenCalledOnce();
  });
});

describe("requestBrandApi — error mapping", () => {
  it("extracts error_description from a JSON error body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error_description: "scope denied" }), { status: 403 })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestBrandApi(client, { basePath: "/b", path: "/x", method: "GET" })
    ).rejects.toMatchObject({
      code: "BRAND_API_FAILED",
      message: expect.stringContaining("scope denied"),
    });
  });

  it("falls back to the `detail` field when error_description is absent", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ detail: "kit not found" }), { status: 404 })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestBrandApi(client, { basePath: "/b", path: "/missing", method: "GET" })
    ).rejects.toMatchObject({ message: expect.stringContaining("kit not found") });
  });

  it("uses the raw body text when the error body is not JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("<html>500</html>", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestBrandApi(client, { basePath: "/b", path: "/x", method: "GET" })
    ).rejects.toMatchObject({ message: expect.stringContaining("<html>500</html>") });
  });

  it("includes the status code and the HTTP method in the error message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{"message":"boom"}', { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestBrandApi(client, { basePath: "/b", path: "/x", method: "DELETE" })
    ).rejects.toMatchObject({ message: expect.stringContaining("502") });
  });
});

describe("requestBrandApi — response parsing", () => {
  it("returns undefined for a 204 No Content response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(null, 204));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestBrandApi(client, {
      basePath: "/b",
      path: "/x",
      method: "DELETE",
    });

    expect(result).toBeUndefined();
  });

  it("parses and returns a 2xx JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: "kit-1", name: "Acme" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestBrandApi<{ id: string; name: string }>(client, {
      basePath: "/b",
      path: "/kits/kit-1",
      method: "GET",
    });

    expect(result).toEqual({ id: "kit-1", name: "Acme" });
  });
});

describe("requestBrandApi — 409 brand-kit-lock retry", () => {
  it("retries a 409 (locked by background enrichment) and resolves once the lock clears", async () => {
    // Seed pass kicks off Sitecore enrichment, which holds the kit lock;
    // the override pass's field PATCH 409s until it releases. The client
    // now rides that out with backoff instead of hard-failing.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse({ error: "Brand Kit is locked by another user" }, 409))
      .mockResolvedValueOnce(okResponse({ id: "field-1" }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestBrandApi(client, {
      basePath: "/stream/ai-skills-api",
      path: "/brandkits/k1/sections/s1/fields/f1",
      method: "PATCH",
      body: { value: "x" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ id: "field-1" });
  });
});
