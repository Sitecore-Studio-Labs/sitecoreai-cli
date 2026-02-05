import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/deploy/api/common", () => ({
  DEFAULT_DEPLOY_API_BASE: "https://xmclouddeploy-api.sitecorecloud.io",
  deployRequest: vi.fn().mockResolvedValue({}),
  parseJsonIfPossible: vi.fn().mockResolvedValue({ ok: true }),
  withOrganizationHeaders: vi.fn(() => undefined),
}));

let common: typeof import("../../../../src/deploy/api/common");
let api: typeof import("../../../../src/deploy/api/deployments");

beforeAll(async () => {
  common = await import("../../../../src/deploy/api/common");
  api = await import("../../../../src/deploy/api/deployments");
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deployments api", () => {
  it("fetchDeployments lists deployments", async () => {
    await api.fetchDeployments({ accessToken: "token" }, { Statuses: ["Running"] });
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/deployments/v3",
      { Statuses: ["Running"] },
      { headers: undefined }
    );
  });

  it("fetchDeployment gets by id", async () => {
    await api.fetchDeployment({ accessToken: "token" }, "dep-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/deployments/v3/dep-1",
      undefined,
      { headers: undefined }
    );
  });

  it("fetchDeploymentV3 gets by id", async () => {
    await api.fetchDeploymentV3({ accessToken: "token" }, "dep-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/deployments/v3/dep-1",
      undefined,
      { headers: undefined }
    );
  });

  it("fetchDeploymentStatus hits status endpoint", async () => {
    await api.fetchDeploymentStatus({ accessToken: "token" });
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/deployments/v1/status",
      undefined,
      { headers: undefined }
    );
  });

  it("deployDeployment posts deploy", async () => {
    await api.deployDeployment({ accessToken: "token" }, "dep-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/deployments/v1/dep-1/deploy",
      undefined,
      { method: "POST", headers: undefined }
    );
  });

  it("cancelDeployment posts cancel", async () => {
    await api.cancelDeployment({ accessToken: "token" }, "dep-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/deployments/v1/dep-1/cancel",
      undefined,
      { method: "POST", headers: undefined }
    );
  });

  it("uploadDeploymentSource posts to v2 source endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(common.withOrganizationHeaders).mockReturnValueOnce({
      "x-organization-id": "org-1",
      "x-org-id": "org-1",
    });

    const buffer = Buffer.from("zip");
    await api.uploadDeploymentSource(
      { accessToken: "token", baseUrl: "https://example.com" },
      "dep-1",
      buffer,
      "application/zip",
      "org-1"
    );

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("https://example.com/api/deployments/v2/dep-1/source");
    const init = fetchMock.mock.calls[0][1] as { headers?: Record<string, string> };
    expect(init.headers).toMatchObject({
      Authorization: "Bearer token",
      "Content-Type": "application/zip",
      "x-organization-id": "org-1",
      "x-org-id": "org-1",
    });
  });

  it("uploadDeploymentSource throws on network errors", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      api.uploadDeploymentSource({ accessToken: "token" }, "dep-1", Buffer.from("zip"))
    ).rejects.toThrow("Deploy API request failed due to a network error.");
  });

  it("uploadDeploymentSource surfaces error details", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(common.parseJsonIfPossible).mockResolvedValueOnce("not allowed");
    await expect(
      api.uploadDeploymentSource({ accessToken: "token" }, "dep-1", Buffer.from("zip"))
    ).rejects.toThrow("not allowed");

    const detailResponse = vi.fn().mockResolvedValue(new Response("bad", { status: 500 }));
    vi.stubGlobal("fetch", detailResponse);
    vi.mocked(common.parseJsonIfPossible).mockResolvedValueOnce({ detail: "server error" });
    await expect(
      api.uploadDeploymentSource({ accessToken: "token" }, "dep-1", Buffer.from("zip"))
    ).rejects.toThrow("server error");
  });

  it("uploadDeploymentSource falls back to status message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(common.parseJsonIfPossible).mockResolvedValueOnce({ message: "nope" });
    await expect(
      api.uploadDeploymentSource({ accessToken: "token" }, "dep-1", Buffer.from("zip"))
    ).rejects.toThrow("Deploy API request failed (403)");
  });
});
