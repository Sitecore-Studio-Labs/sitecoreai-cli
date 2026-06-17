import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration } from "../../../src/config/types";
import { resolveSiteRoot } from "../../../src/publishing/api/sites";
import { ScaiError } from "../../../src/shared/errors";

vi.mock("../../../src/authoring/site-discovery", () => ({
  discoverSites: vi.fn(),
}));

vi.mock("../../../src/publishing/api/path-resolver", () => ({
  resolveItemPathsToIds: vi.fn(),
}));

import { discoverSites } from "../../../src/authoring/site-discovery";
import { resolveItemPathsToIds } from "../../../src/publishing/api/path-resolver";

const mockDiscoverSites = discoverSites as unknown as ReturnType<typeof vi.fn>;
const mockResolvePaths = resolveItemPathsToIds as unknown as ReturnType<typeof vi.fn>;

const env: EnvironmentConfiguration = { name: "sandbox" } as EnvironmentConfiguration;

beforeEach(() => {
  mockDiscoverSites.mockReset();
  mockResolvePaths.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("resolveSiteRoot", () => {
  it("returns the site's path + itemId for a matching site name", async () => {
    mockDiscoverSites.mockResolvedValue([
      {
        name: "marketing",
        tenantName: "MyTenant",
        path: "/sitecore/content/MyTenant/marketing",
      },
    ]);
    mockResolvePaths.mockResolvedValue({
      resolved: [{ path: "/sitecore/content/MyTenant/marketing", itemId: "abc-123" }],
    });
    const out = await resolveSiteRoot(env, "marketing");
    expect(out).toEqual({
      siteName: "marketing",
      tenantName: "MyTenant",
      path: "/sitecore/content/MyTenant/marketing",
      itemId: "abc-123",
    });
  });

  it("throws INPUT_INVALID with an available-sites hint when the site doesn't exist", async () => {
    mockDiscoverSites.mockResolvedValue([
      { name: "marketing", path: "/x", tenantName: "T" },
      { name: "support", path: "/y", tenantName: "T" },
    ]);
    await expect(resolveSiteRoot(env, "missing")).rejects.toMatchObject({
      code: "INPUT_INVALID",
      hint: expect.stringContaining("marketing"),
    });
  });

  it("caps the available-sites hint at 12 names", async () => {
    mockDiscoverSites.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({
        name: `site-${i}`,
        path: `/x/site-${i}`,
        tenantName: "T",
      }))
    );
    await expect(resolveSiteRoot(env, "ghost")).rejects.toMatchObject({
      hint: expect.stringContaining("(and 18 more)"),
    });
  });

  it("returns ScaiError on missing site", async () => {
    mockDiscoverSites.mockResolvedValue([]);
    await expect(resolveSiteRoot(env, "nope")).rejects.toBeInstanceOf(ScaiError);
  });

  it("propagates path-resolver errors (e.g. permission denied on /sitecore/content)", async () => {
    mockDiscoverSites.mockResolvedValue([{ name: "marketing", path: "/p", tenantName: "T" }]);
    mockResolvePaths.mockRejectedValue(
      new ScaiError("Could not resolve 1 item path(s) to IDs.", { code: "INPUT_INVALID" })
    );
    await expect(resolveSiteRoot(env, "marketing")).rejects.toBeInstanceOf(ScaiError);
  });
});
