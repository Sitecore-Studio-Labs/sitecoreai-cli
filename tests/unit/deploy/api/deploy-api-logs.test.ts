import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/deploy/api/common/request", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../src/deploy/api/common/request")>();
  return {
    ...actual,
    deployRequest: vi.fn().mockResolvedValue({}),
    parseJsonIfPossible: vi.fn().mockResolvedValue({ ok: true }),
  };
});
vi.mock("../../../../src/deploy/api/common/headers", () => ({
  withOrganizationHeaders: vi.fn((id?: string) =>
    id ? { "x-organization-id": id, "x-org-id": id } : undefined
  ),
}));

let request: typeof import("../../../../src/deploy/api/common/request");
let headers: typeof import("../../../../src/deploy/api/common/headers");
let api: typeof import("../../../../src/deploy/api/logs");
const common = {
  get deployRequest() {
    return request.deployRequest;
  },
  get parseJsonIfPossible() {
    return request.parseJsonIfPossible;
  },
  get withOrganizationHeaders() {
    return headers.withOrganizationHeaders;
  },
};

beforeAll(async () => {
  request = await import("../../../../src/deploy/api/common/request");
  headers = await import("../../../../src/deploy/api/common/headers");
  api = await import("../../../../src/deploy/api/logs");
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("logs api", () => {
  it("fetchLogList lists logs", async () => {
    await api.fetchLogList({ accessToken: "token" }, "env-1", true, "org-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://xmcloud-monitoring-api.sitecorecloud.io" },
      "/api/logs/v1/env-1",
      { latest: true },
      { headers: { "x-organization-id": "org-1", "x-org-id": "org-1" } }
    );
  });

  it("fetchLogFile downloads file", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("log", { headers: { "content-type": "text/plain" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.fetchLogFile(
      { accessToken: "token", baseUrl: "https://example.com" },
      "env-1",
      "app.log",
      false,
      "org-1"
    );

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("https://example.com/api/logs/v2/env-1/app.log?download=false");
    const init = fetchMock.mock.calls[0][1] as { headers?: Record<string, string> };
    expect(init.headers).toMatchObject({
      Authorization: "Bearer token",
      "x-organization-id": "org-1",
      "x-org-id": "org-1",
    });
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
  });

  it("fetchLogFile surfaces error messages from string bodies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(common.parseJsonIfPossible).mockResolvedValueOnce("not allowed");

    await expect(
      api.fetchLogFile({ accessToken: "token" }, "env-1", "app.log", true)
    ).rejects.toThrow("not allowed");
  });

  it("fetchLogFile surfaces error details from objects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(common.parseJsonIfPossible).mockResolvedValueOnce({ detail: "server error" });

    await expect(
      api.fetchLogFile({ accessToken: "token" }, "env-1", "app.log", true)
    ).rejects.toThrow("server error");
  });

  it("fetchLogFile falls back to status message on unknown errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(common.parseJsonIfPossible).mockResolvedValueOnce({ errors: [] });

    await expect(
      api.fetchLogFile({ accessToken: "token" }, "env-1", "app.log", true)
    ).rejects.toThrow("Deploy API request failed (403)");
  });
});
