import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithRateLimitRetry } from "../../../src/shared/rate-limit-retry";

const URL = "https://co-orchestrate-euw.sitecorecloud.io/api/x";
const INIT = { method: "PUT", headers: { Authorization: "Bearer t" }, body: "{}" };

// Fresh Response per call — the helper cancels the body of a retried 429,
// which consumes the stream, so a shared instance can't be reused.
const res = (status: number, headers: Record<string, string> = {}): Response =>
  new Response(status === 200 ? '{"ok":true}' : "rate limited", {
    status,
    headers,
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchWithRateLimitRetry", () => {
  it("returns a 2xx without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithRateLimitRetry(URL, INIT, { timeoutMs: 1000 });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 (writes included) then returns the eventual success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(429, { "x-ms-retry-after-ms": "0" }))
      .mockResolvedValueOnce(res(429, { "x-ms-retry-after-ms": "0" }))
      .mockResolvedValue(res(200));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithRateLimitRetry(URL, INIT, {
      timeoutMs: 1000,
      baseMs: 0,
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after the retry budget and returns the final 429", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => res(429, { "x-ms-retry-after-ms": "0" }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithRateLimitRetry(URL, INIT, {
      timeoutMs: 1000,
      maxRetries: 2,
      baseMs: 0,
    });

    expect(response.status).toBe(429);
    // 1 initial attempt + 2 retries.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-429 error (e.g. 500)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(500));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithRateLimitRetry(URL, INIT, {
      timeoutMs: 1000,
      baseMs: 0,
    });

    expect(response.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honors a standard Retry-After (seconds) header as the wait hint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(429, { "retry-after": "0" }))
      .mockResolvedValue(res(200));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithRateLimitRetry(URL, INIT, {
      timeoutMs: 1000,
      baseMs: 0,
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("propagates a network error (fetch rejection) without swallowing it", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("socket hang up"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchWithRateLimitRetry(URL, INIT, { timeoutMs: 1000, baseMs: 0 })
    ).rejects.toThrow("socket hang up");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
