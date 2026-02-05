import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/deploy/api/common", () => ({
  deployRequest: vi.fn().mockResolvedValue({}),
  withOrganizationHeaders: vi.fn((id?: string) =>
    id ? { "x-organization-id": id, "x-org-id": id } : undefined
  ),
}));

let common: typeof import("../../../../src/deploy/api/common");
let api: typeof import("../../../../src/deploy/api/organizations");

beforeAll(async () => {
  common = await import("../../../../src/deploy/api/common");
  api = await import("../../../../src/deploy/api/organizations");
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("organizations api", () => {
  it("fetchOrganization calls /api/organizations/v1", async () => {
    await api.fetchOrganization({ accessToken: "token" });
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/organizations/v1"
    );
  });

  it("fetchOrganizationHealth sends org headers", async () => {
    await api.fetchOrganizationHealth({ accessToken: "token" }, "org-1");
    expect(common.withOrganizationHeaders).toHaveBeenCalledWith("org-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/organizations/v4/org-1/health",
      undefined,
      { headers: { "x-organization-id": "org-1", "x-org-id": "org-1" } }
    );
  });

  it("fetchOrganizationLicense uses org id in path", async () => {
    await api.fetchOrganizationLicense({ accessToken: "token" }, "org-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/organizations/v1/org-1/license"
    );
  });

  it("createOrganizationDemoSolution posts to demo-solution", async () => {
    await api.createOrganizationDemoSolution({ accessToken: "token" });
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/organizations/v1/demo-solution",
      undefined,
      { method: "POST" }
    );
  });
});
