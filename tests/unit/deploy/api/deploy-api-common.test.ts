import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  deployRequest,
  extractErrorMessage,
  parseJsonIfPossible,
} from "../../../../src/deploy/api/common/request";
import { setDeployTransportListener } from "../../../../src/deploy/api/common/transport-events";
import { withOrganizationHeaders } from "../../../../src/deploy/api/common/headers";
import { ScaiError } from "../../../../src/shared/errors";

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

describe("extractErrorMessage", () => {
  it("returns a plain string body unchanged", () => {
    expect(extractErrorMessage("boom")).toBe("boom");
  });

  it("prefers detail/message/title over each other in order", () => {
    expect(extractErrorMessage({ detail: "d", message: "m", title: "t" })).toBe("d");
    expect(extractErrorMessage({ message: "m", title: "t" })).toBe("m");
    expect(extractErrorMessage({ title: "t" })).toBe("t");
  });

  it("surfaces ASP.NET ValidationProblemDetails field errors instead of the generic title", () => {
    const message = extractErrorMessage({
      title: "One or more validation errors occurred.",
      status: 400,
      errors: {
        ProjectId: ["The ProjectId field is required."],
        Name: ["Name is too long.", "Name has invalid characters."],
      },
    });
    // The generic title must not shadow the actionable field detail.
    expect(message).toContain("One or more validation errors occurred.");
    expect(message).toContain("ProjectId: The ProjectId field is required.");
    expect(message).toContain("Name: Name is too long. Name has invalid characters.");
  });

  it("handles an array-shaped errors member", () => {
    expect(extractErrorMessage({ errors: [{ message: "first" }, "second"] })).toBe("first; second");
  });

  it("returns undefined when no usable message is present", () => {
    expect(extractErrorMessage({ status: 400 })).toBeUndefined();
    expect(extractErrorMessage(undefined)).toBeUndefined();
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
    setDeployTransportListener(null);
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

  it("retries GET requests on network errors and throws a ScaiError", async () => {
    process.env.SITECOREAI_HTTP_RETRIES = "1";
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deployRequest({ accessToken: "token" }, "/api/test")).rejects.toBeInstanceOf(
      ScaiError
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

  it("settles the transport span on success and failure", async () => {
    const span = { succeed: vi.fn(), fail: vi.fn() };
    setDeployTransportListener({ onRequestStart: () => span });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    );
    await deployRequest({ accessToken: "token" }, "/api/ok");
    expect(span.succeed).toHaveBeenCalledTimes(1);

    process.env.SITECOREAI_HTTP_RETRIES = "0";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    await expect(deployRequest({ accessToken: "token" }, "/api/bad")).rejects.toBeInstanceOf(
      ScaiError
    );
    expect(span.fail).toHaveBeenCalledTimes(1);
  });

  it("reports trace output to the transport listener when HTTP tracing is enabled", async () => {
    process.env.SITECOREAI_TRACE_HTTP = "1";
    const onTrace = vi.fn();
    setDeployTransportListener({ onTrace });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await deployRequest({ accessToken: "token", baseUrl: "https://api.example/" }, "/api/trace");

    expect(onTrace).toHaveBeenCalled();
  });
});

describe("deployRequest library transport overrides", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    setDeployTransportListener(null);
  });

  it("passes silent: true through to the transport listener", async () => {
    const onRequestStart = vi.fn().mockReturnValue(null);
    setDeployTransportListener({ onRequestStart });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);

    await deployRequest({ accessToken: "token" }, "/api/silent", undefined, { silent: true });

    expect(onRequestStart).toHaveBeenCalledWith("GET", "/api/silent", true);
  });

  it("init.transport.maxRetries wins over SITECOREAI_HTTP_RETRIES env var", async () => {
    // Env says 5 retries, caller says 0 — caller wins.
    process.env.SITECOREAI_HTTP_RETRIES = "5";
    const fetchMock = vi.fn().mockRejectedValue(new Error("boom"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      deployRequest({ accessToken: "token" }, "/api/noretry", undefined, {
        transport: { maxRetries: 0 },
      })
    ).rejects.toBeInstanceOf(ScaiError);
    // Only the initial attempt, no retries.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("init.transport.traceHttp: true forces trace reporting without env var", async () => {
    delete process.env.SITECOREAI_TRACE_HTTP;
    const onTrace = vi.fn();
    setDeployTransportListener({ onTrace });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await deployRequest({ accessToken: "token" }, "/api/trace", undefined, {
      transport: { traceHttp: true },
    });

    expect(onTrace).toHaveBeenCalled();
  });

  it("init.transport.traceHttp: false suppresses trace reporting even when env var is set", async () => {
    process.env.SITECOREAI_TRACE_HTTP = "1";
    const onTrace = vi.fn();
    setDeployTransportListener({ onTrace });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await deployRequest({ accessToken: "token" }, "/api/trace-off", undefined, {
      transport: { traceHttp: false },
    });

    expect(onTrace).not.toHaveBeenCalled();
  });

  it("falls back to env var when init.transport.maxRetries is undefined", async () => {
    process.env.SITECOREAI_HTTP_RETRIES = "1";
    const fetchMock = vi.fn().mockRejectedValue(new Error("boom"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deployRequest({ accessToken: "token" }, "/api/envretry")).rejects.toBeInstanceOf(
      ScaiError
    );
    // 1 initial + 1 retry.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
