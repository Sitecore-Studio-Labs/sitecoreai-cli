import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { consola } from "consola";
import {
  deployRequest,
  parseJsonIfPossible,
  startDeploySpinner,
  withOrganizationHeaders,
} from "../../../../src/deploy/api/common";
import { CliError } from "../../../../src/shared/errors";

const oraMocks = vi.hoisted(() => {
  const spinner = {
    succeed: vi.fn(),
    fail: vi.fn(),
    stop: vi.fn(),
  };
  const start = vi.fn(() => spinner);
  const ora = vi.fn(() => ({ start }));
  return { spinner, start, ora };
});

vi.mock("ora", () => ({
  default: oraMocks.ora,
}));

describe("withOrganizationHeaders", () => {
  it("returns undefined when organizationId is missing", () => {
    expect(withOrganizationHeaders(undefined)).toBeUndefined();
  });

  it("returns headers when organizationId is provided", () => {
    expect(withOrganizationHeaders("org-1")).toEqual({
      "x-organization-id": "org-1",
      "x-org-id": "org-1",
    });
  });
});

describe("parseJsonIfPossible", () => {
  it("returns undefined for empty response body", async () => {
    const response = new Response("");
    await expect(parseJsonIfPossible(response)).resolves.toBeUndefined();
  });

  it("parses JSON response bodies", async () => {
    const response = new Response(JSON.stringify({ ok: true }));
    await expect(parseJsonIfPossible(response)).resolves.toEqual({ ok: true });
  });

  it("returns text when JSON parsing fails", async () => {
    const response = new Response("not-json");
    await expect(parseJsonIfPossible(response)).resolves.toBe("not-json");
  });
});

describe("deployRequest", () => {
  const originalEnv = { ...process.env };
  const originalTty = process.stdout.isTTY;

  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    Object.defineProperty(process.stdout, "isTTY", { value: originalTty, configurable: true });
  });

  it("builds query string and sends request with auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);

    await deployRequest(
      { accessToken: "token" },
      "/api/test",
      { a: "1", list: ["x", "y"] },
      { method: "post", body: { value: 1 } }
    );

    const url = fetchMock.mock.calls[0][0] as string;
    const init = fetchMock.mock.calls[0][1] as {
      method?: string;
      headers?: Record<string, string>;
    };
    expect(url).toContain("/api/test");
    expect(url).toContain("a=1");
    expect(url).toContain("list=x");
    expect(url).toContain("list=y");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    });
  });

  it("retries GET requests on network errors and throws a CliError", async () => {
    process.env.SITECOREAI_HTTP_RETRIES = "1";
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deployRequest({ accessToken: "token" }, "/api/test")).rejects.toBeInstanceOf(
      CliError
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws a deploy failure for non-ok responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ detail: "bad request" }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deployRequest({ accessToken: "token" }, "/api/test")).rejects.toMatchObject({
      code: "DEPLOY_FAILED",
      exitCode: 6,
    });
  });

  it("returns a what-if payload when dry-run is enabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await deployRequest(
      { accessToken: "token" },
      "/api/test",
      { a: "1" },
      { method: "post", body: { value: 1 }, whatIf: true }
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      whatIf: true,
      request: {
        method: "POST",
        path: "/api/test",
      },
    });
  });

  it("retries GET requests on 500 responses and succeeds", async () => {
    vi.useFakeTimers();
    process.env.SITECOREAI_HTTP_RETRIES = "1";
    process.env.SITECOREAI_HTTP_RETRY_BASE_MS = "10";
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("error", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const request = deployRequest({ accessToken: "token" }, "/api/retry");
    await vi.advanceTimersByTimeAsync(10);
    const result = await request;

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    randomSpy.mockRestore();
    vi.useRealTimers();
  });

  it("redacts secrets in error responses", async () => {
    process.env.SITECOREAI_HTTP_RETRIES = "0";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("token=super-secret", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deployRequest({ accessToken: "token" }, "/api/secret")).rejects.toMatchObject({
      message: expect.stringContaining("<redacted>"),
    });
  });

  it("logs trace output when HTTP tracing is enabled", async () => {
    process.env.SITECOREAI_TRACE_HTTP = "1";
    const debugSpy = vi.spyOn(consola, "debug").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await deployRequest({ accessToken: "token", baseUrl: "https://api.example/" }, "/api/trace");

    expect(debugSpy).toHaveBeenCalled();
    debugSpy.mockRestore();
  });
});

describe("startDeploySpinner", () => {
  const originalTty = process.stdout.isTTY;
  const originalQuiet = process.env.SITECOREAI_QUIET;
  const originalJson = process.env.SITECOREAI_JSON;

  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    delete process.env.SITECOREAI_QUIET;
    delete process.env.SITECOREAI_JSON;
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", { value: originalTty, configurable: true });
    if (originalQuiet === undefined) {
      delete process.env.SITECOREAI_QUIET;
    } else {
      process.env.SITECOREAI_QUIET = originalQuiet;
    }
    if (originalJson === undefined) {
      delete process.env.SITECOREAI_JSON;
    } else {
      process.env.SITECOREAI_JSON = originalJson;
    }
  });

  it("returns null when stdout is not a TTY", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    const result = await startDeploySpinner("GET /status");
    expect(result).toBeNull();
    expect(oraMocks.ora).not.toHaveBeenCalled();
  });

  it("returns null when quiet or JSON mode is enabled", async () => {
    process.env.SITECOREAI_QUIET = "1";
    const quietResult = await startDeploySpinner("GET /quiet");
    expect(quietResult).toBeNull();

    delete process.env.SITECOREAI_QUIET;
    process.env.SITECOREAI_JSON = "1";
    const jsonResult = await startDeploySpinner("GET /json");
    expect(jsonResult).toBeNull();
  });

  it("starts a spinner and exposes success/fail handlers", async () => {
    const handle = await startDeploySpinner("GET /health");
    expect(handle).not.toBeNull();
    expect(oraMocks.ora).toHaveBeenCalledWith({ text: "GET /health" });
    handle?.succeed();
    handle?.fail();
    expect(oraMocks.spinner.succeed).toHaveBeenCalled();
    expect(oraMocks.spinner.fail).toHaveBeenCalled();
  });
});
