import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REGION,
  clearRegionCache,
  regionalHost,
  resolveRegion,
  resolveRegionCode,
  resolveRegionalBaseUrl,
} from "../../../src/shared/region";

const okResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const tenants = (region: string): unknown => ({ data: [{ region }] });

beforeEach(() => {
  clearRegionCache();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("regionalHost", () => {
  it("fills the {region} placeholder", () => {
    expect(regionalHost("https://ai-workflows-{region}.sitecorecloud.io", "eus")).toBe(
      "https://ai-workflows-eus.sitecorecloud.io"
    );
  });
});

describe("resolveRegion", () => {
  it("reads the region from platform-inventory", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(tenants("eus")));
    vi.stubGlobal("fetch", fetchMock);

    expect(await resolveRegion("org-1", "tok")).toBe("eus");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("platform-inventory.sitecorecloud.io/api/inventory/v1/tenants");
    expect(url).toContain("organizationId=org-1");
    expect((init as { headers?: Record<string, string> }).headers).toMatchObject({
      Authorization: "Bearer tok",
    });
  });

  it("reads the region from labels.RegionCode when the top-level field is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okResponse({ data: [{ labels: { RegionCode: "jpe" } }] }))
    );
    expect(await resolveRegion("org-labels", "tok")).toBe("jpe");
  });

  it("falls back to DEFAULT_REGION on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    expect(await resolveRegion("org-403", "tok")).toBe(DEFAULT_REGION);
  });

  it("falls back to DEFAULT_REGION when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    expect(await resolveRegion("org-net", "tok")).toBe(DEFAULT_REGION);
  });

  it("caches the resolved region per organization", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(tenants("aus")));
    vi.stubGlobal("fetch", fetchMock);

    expect(await resolveRegion("org-cache", "tok")).toBe("aus");
    expect(await resolveRegion("org-cache", "tok")).toBe("aus");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("resolveRegionCode", () => {
  it("returns DEFAULT_REGION without minting a token when no org id is given", async () => {
    const acquireToken = vi.fn();
    expect(await resolveRegionCode({ acquireToken })).toBe(DEFAULT_REGION);
    expect(acquireToken).not.toHaveBeenCalled();
  });

  it("returns DEFAULT_REGION when the token resolver yields nothing", async () => {
    expect(
      await resolveRegionCode({ organizationId: "org-x", acquireToken: async () => undefined })
    ).toBe(DEFAULT_REGION);
  });

  it("returns DEFAULT_REGION when the token resolver rejects", async () => {
    expect(
      await resolveRegionCode({
        organizationId: "org-x",
        acquireToken: async () => {
          throw new Error("no credentials");
        },
      })
    ).toBe(DEFAULT_REGION);
  });

  it("resolves via platform-inventory and does not re-mint a token on a cache hit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(tenants("eus"))));
    const acquireToken = vi.fn().mockResolvedValue("tok");

    expect(await resolveRegionCode({ organizationId: "org-hit", acquireToken })).toBe("eus");
    expect(await resolveRegionCode({ organizationId: "org-hit", acquireToken })).toBe("eus");
    expect(acquireToken).toHaveBeenCalledTimes(1);
  });
});

describe("resolveRegionalBaseUrl", () => {
  it("returns the override verbatim — no resolution, no token mint", async () => {
    const acquireToken = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await resolveRegionalBaseUrl({
        hostTemplate: "https://co-brief-api-{region}.sitecorecloud.io",
        organizationId: "org-1",
        override: "https://brief.internal.example",
        acquireToken,
      })
    ).toBe("https://brief.internal.example");
    expect(acquireToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fills the host template with the resolved region", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(tenants("eus"))));

    expect(
      await resolveRegionalBaseUrl({
        hostTemplate: "https://ai-workflows-{region}.sitecorecloud.io",
        organizationId: "org-1",
        acquireToken: async () => "tok",
      })
    ).toBe("https://ai-workflows-eus.sitecorecloud.io");
  });

  it("falls back to the DEFAULT_REGION host when no org id is given", async () => {
    expect(
      await resolveRegionalBaseUrl({
        hostTemplate: "https://ai-workflows-{region}.sitecorecloud.io",
        acquireToken: async () => "tok",
      })
    ).toBe(`https://ai-workflows-${DEFAULT_REGION}.sitecorecloud.io`);
  });
});
