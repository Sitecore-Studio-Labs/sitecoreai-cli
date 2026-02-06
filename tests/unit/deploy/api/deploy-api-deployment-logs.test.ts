import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDeploymentLogs } from "../../../../src/deploy/api/deployment-logs";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("deployment logs api", () => {
  it("fetchDeploymentLogs calls monitoring endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchDeploymentLogs("dep-1", "token");
    expect(result).toEqual({ ok: true });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("https://xmcloud-monitoring-api.sitecorecloud.io/api/Deployments/v1/dep-1");
    const init = fetchMock.mock.calls[0][1] as { headers?: Record<string, string> };
    expect(init.headers).toMatchObject({ Authorization: "Bearer token" });
  });

  it("surfaces error message from string responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("not allowed", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchDeploymentLogs("dep-1", "token")).rejects.toThrow("not allowed");
  });

  it("surfaces error message from detail field", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ detail: "server error" }), { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchDeploymentLogs("dep-1", "token")).rejects.toThrow("server error");
  });

  it("falls back to status message when detail is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchDeploymentLogs("dep-1", "token")).rejects.toThrow(
      "Deploy API request failed (403)"
    );
  });
});
