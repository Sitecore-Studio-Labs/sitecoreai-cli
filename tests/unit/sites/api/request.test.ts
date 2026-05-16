import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScaiError } from "../../../../src/shared/errors";
import { sitesRequest } from "../../../../src/sites/api/request";
import { DEFAULT_SITES_API_BASE } from "../../../../src/sites/api/types";

const baseOptions = { accessToken: "test-token" };

const okResponse = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sitesRequest — request shape", () => {
  it("issues GET against the default base URL with bearer auth + JSON Accept", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sitesRequest<{ ok: boolean }>(baseOptions, "/api/v1/sites");

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body?: string },
    ];
    expect(url).toBe(`${DEFAULT_SITES_API_BASE}/api/v1/sites`);
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-token",
      Accept: "application/json",
    });
    expect(init.body).toBeUndefined();
  });

  it("respects baseUrl override and serializes query parameters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await sitesRequest({ ...baseOptions, baseUrl: "https://example.test" }, "/api/v1/sites", {
      query: { environmentId: "abc", page: 2, includeDeleted: false },
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://example.test/api/v1/sites?environmentId=abc&page=2&includeDeleted=false"
    );
  });

  it("issues POST with JSON body + Content-Type header for write methods", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ jobHandle: "job-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await sitesRequest(baseOptions, "/api/v1/sites", {
      method: "POST",
      body: { siteName: "Foo", templateId: "tpl-1", language: "en" },
    });

    const init = fetchMock.mock.calls[0][1] as {
      method: string;
      headers: Record<string, string>;
      body: string;
    };
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      siteName: "Foo",
      templateId: "tpl-1",
      language: "en",
    });
  });

  it("returns undefined for 204 No Content responses (e.g. successful DELETE)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(undefined, 204));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sitesRequest(baseOptions, "/api/v1/sites/abc", {
      method: "DELETE",
    });

    expect(result).toBeUndefined();
  });
});

describe("sitesRequest — error mapping", () => {
  it("throws SITES_API_FAILED with a server-supplied detail when the response is non-2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "https://tools.ietf.org/html/rfc7231#section-6.5.1",
          title: "Bad Request",
          status: 400,
          detail: "Site name 'foo' already exists",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await sitesRequest(baseOptions, "/api/v1/sites", {
      method: "POST",
      body: { siteName: "foo" },
    }).catch((e) => e);

    expect(error).toBeInstanceOf(ScaiError);
    expect(error.code).toBe("SITES_API_FAILED");
    expect(error.message).toContain("Site name 'foo' already exists");
  });

  it("throws SITES_API_FAILED with status code when the body has no usable message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await sitesRequest(baseOptions, "/api/v1/sites").catch((e) => e);

    expect(error.code).toBe("SITES_API_FAILED");
    expect(error.message).toContain("503");
  });

  it("throws NETWORK when fetch itself rejects (DNS, connection refused, etc.)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const error = await sitesRequest(baseOptions, "/api/v1/sites").catch((e) => e);

    expect(error.code).toBe("NETWORK");
    expect(error.message).toContain("ECONNREFUSED");
  });
});
