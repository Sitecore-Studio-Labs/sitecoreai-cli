import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScaiError } from "../../../src/shared/errors";
import {
  extractErrorMessage,
  parseJsonIfPossible,
  runSitecoreRest,
} from "../../../src/shared/rest";

/**
 * Direct coverage for the shared REST spine. The sites/brand/publishing
 * client tests exercise the thin-wrapper integration; this file covers the
 * transport behaviors those wrappers don't reach: the backoff retry loop
 * (status + network), the auth-failure clear-and-retry, empty-body
 * statuses, the timeout abort, and the default network-error mapping.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const failError = () => new ScaiError("mapped http error", { code: "NETWORK" });

const baseConfig = {
  url: "https://api.test/x",
  headers: { Authorization: "Bearer t" },
  label: "Test API",
  mapHttpError: failError,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runSitecoreRest — success + parsing", () => {
  it("returns the parsed JSON body for a 2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ ok: true })));
    const result = await runSitecoreRest<{ ok: boolean }>(baseConfig);
    expect(result).toEqual({ ok: true });
  });

  it("uppercases the method and defaults to GET", async () => {
    const fetchMock = vi.fn().mockImplementation(() => json({}));
    vi.stubGlobal("fetch", fetchMock);
    await runSitecoreRest({ ...baseConfig, method: "post" });
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    await runSitecoreRest(baseConfig);
    expect(fetchMock.mock.calls[1][1].method).toBe("GET");
  });

  it("resolves undefined for configured empty-body statuses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 202 })));
    const result = await runSitecoreRest({
      ...baseConfig,
      emptyStatuses: new Set([202, 204]),
    });
    expect(result).toBeUndefined();
  });
});

describe("runSitecoreRest — error mapping", () => {
  it("throws the mapped http error for a non-2xx, passing the parsed body", async () => {
    const mapHttpError = vi.fn().mockReturnValue(new ScaiError("boom", { code: "NETWORK" }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ detail: "bad" }, 400)));
    await expect(runSitecoreRest({ ...baseConfig, mapHttpError })).rejects.toMatchObject({
      message: "boom",
    });
    expect(mapHttpError.mock.calls[0][1]).toEqual({ detail: "bad" });
  });

  it("maps a fetch rejection to a NETWORK ScaiError by default", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const error = await runSitecoreRest(baseConfig).catch((e) => e);
    expect(error).toBeInstanceOf(ScaiError);
    expect(error.code).toBe("NETWORK");
    expect(error.message).toContain("Test API request failed");
    expect(error.message).toContain("ECONNREFUSED");
  });

  it("lets a custom mapNetworkError rethrow the raw error", async () => {
    const raw = new Error("raw boom");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(raw));
    const error = await runSitecoreRest({
      ...baseConfig,
      mapNetworkError: (e) => {
        throw e;
      },
    }).catch((e) => e);
    expect(error).toBe(raw);
  });
});

describe("runSitecoreRest — backoff retry", () => {
  it("retries a retryable status up to maxRetries then maps the error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await runSitecoreRest<{ ok: boolean }>({
      ...baseConfig,
      retry: {
        maxRetries: 3,
        retryBaseMs: 1,
        shouldRetryStatus: (status) => status === 503,
      },
    });
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a network error when shouldRetryNetworkError allows it", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("blip"))
      .mockResolvedValueOnce(json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await runSitecoreRest<{ ok: boolean }>({
      ...baseConfig,
      retry: {
        maxRetries: 1,
        retryBaseMs: 1,
        shouldRetryNetworkError: () => true,
      },
    });
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry when no retry config is supplied", async () => {
    const mapHttpError = vi.fn().mockReturnValue(new ScaiError("x", { code: "NETWORK" }));
    const fetchMock = vi.fn().mockResolvedValue(json({}, 503));
    vi.stubGlobal("fetch", fetchMock);
    await runSitecoreRest({ ...baseConfig, mapHttpError }).catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("runSitecoreRest — auth refresh", () => {
  it("clears + re-resolves the token once on the refresh status, then retries", async () => {
    const onAuthFailure = vi.fn().mockResolvedValue(undefined);
    const getAuthHeader = vi
      .fn()
      .mockResolvedValueOnce("Bearer stale")
      .mockResolvedValueOnce("Bearer fresh");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runSitecoreRest<{ ok: boolean }>({
      ...baseConfig,
      headers: { Accept: "application/json" },
      auth: { getAuthHeader, refreshOnStatus: 401, onAuthFailure },
    });

    expect(result).toEqual({ ok: true });
    expect(onAuthFailure).toHaveBeenCalledOnce();
    expect(getAuthHeader).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer fresh");
  });

  it("maps the error when the auth retry also returns the refresh status", async () => {
    const mapHttpError = vi.fn().mockReturnValue(new ScaiError("denied", { code: "NETWORK" }));
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{"detail":"expired"}', { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runSitecoreRest({
        ...baseConfig,
        headers: {},
        mapHttpError,
        auth: {
          getAuthHeader: async () => "Bearer x",
          refreshOnStatus: 401,
          onAuthFailure: async () => undefined,
        },
      })
    ).rejects.toMatchObject({ message: "denied" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("runSitecoreRest — timeout", () => {
  it("aborts the request when timeoutMs elapses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        (_url: string, init: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          })
      )
    );
    const error = await runSitecoreRest({ ...baseConfig, timeoutMs: 5 }).catch((e) => e);
    expect(error).toBeInstanceOf(ScaiError);
    expect(error.code).toBe("NETWORK");
  });
});

describe("extractErrorMessage + parseJsonIfPossible (re-exported helpers)", () => {
  it("parseJsonIfPossible returns undefined / parsed / raw text", async () => {
    expect(await parseJsonIfPossible(new Response(""))).toBeUndefined();
    expect(await parseJsonIfPossible(new Response('{"a":1}'))).toEqual({ a: 1 });
    expect(await parseJsonIfPossible(new Response("not-json"))).toBe("not-json");
  });

  it("extractErrorMessage prefers detail, falls through to field errors", () => {
    expect(extractErrorMessage("boom")).toBe("boom");
    expect(extractErrorMessage({ detail: "d", message: "m" })).toBe("d");
    expect(extractErrorMessage({ errors: { Name: ["required"] } })).toBe("Name: required");
    expect(extractErrorMessage(undefined)).toBeUndefined();
  });
});
