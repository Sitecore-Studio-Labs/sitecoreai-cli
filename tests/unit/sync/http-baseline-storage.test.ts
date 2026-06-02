import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Baseline } from "../../../src/sync/baseline";
import {
  HttpBaselineStorage,
  resolveHttpBaselineStorageFromEnv,
  SYNC_BASELINE_ENV_VARS,
} from "../../../src/sync/http-baseline-storage";

const BASE = "https://orch.test/api/v1/sync-baselines";
const TOKEN = "v1|job-xyz|brief|story-sync|9999999999|abc123";

interface BriefBaselinePayload {
  schemaVersion: "1";
  elements: Record<string, string>;
  fields: Record<string, string>;
}

const sampleBaseline: Baseline<BriefBaselinePayload> = {
  envelopeVersion: "1",
  kind: "brief",
  recipeHandle: "Q3 Launch [story:abc/quarterly]",
  envName: "story-sync",
  capturedAt: "2026-06-02T00:00:00.000Z",
  payload: {
    schemaVersion: "1",
    elements: { briefTypeName: "deadbeef" },
    fields: { audience: "feedface" },
  },
};

describe("HttpBaselineStorage.locator", () => {
  it("URL-encodes kind / env / handle into the endpoint path", () => {
    const storage = new HttpBaselineStorage(BASE, TOKEN);
    const url = storage.locator("brief", "story-sync", "Q3 Launch [story:abc/quarterly]");
    expect(url.startsWith(BASE)).toBe(true);
    // `[` and `]` and `:` ride through with encodeURIComponent.
    expect(url).toContain("/brief/story-sync/");
    expect(url).toContain("Q3%20Launch%20%5Bstory");
  });

  it("trims a trailing slash from the base URL", () => {
    const storage = new HttpBaselineStorage(`${BASE}/`, TOKEN);
    const url = storage.locator("brief", "story-sync", "abc");
    expect(url).toBe(`${BASE}/brief/story-sync/abc`);
  });

  it("rejects invalid kinds at locator time", () => {
    const storage = new HttpBaselineStorage(BASE, TOKEN);
    expect(() => storage.locator("Bad/Kind", "story-sync", "x")).toThrow(/Invalid baseline kind/);
  });

  it("rejects invalid env names at locator time", () => {
    const storage = new HttpBaselineStorage(BASE, TOKEN);
    expect(() => storage.locator("brief", "1bad", "x")).toThrow(/Invalid baseline env/);
  });
});

describe("HttpBaselineStorage.load", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the parsed baseline on 200", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(sampleBaseline), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const storage = new HttpBaselineStorage(BASE, TOKEN);
    const result = await storage.load("brief", "story-sync", "abc");
    expect(result).toEqual(sampleBaseline);
    const call = fetchMock.mock.calls[0];
    expect(call?.[1]?.method).toBe("GET");
    expect(call?.[1]?.headers).toMatchObject({
      authorization: `Bearer ${TOKEN}`,
      accept: "application/json",
    });
  });

  it("returns null on 404 (first-push)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 404 }));
    const storage = new HttpBaselineStorage(BASE, TOKEN);
    const result = await storage.load("brief", "story-sync", "abc");
    expect(result).toBeNull();
  });

  it("throws AUTH_DENIED on 401", async () => {
    fetchMock.mockResolvedValueOnce(new Response("expired", { status: 401 }));
    const storage = new HttpBaselineStorage(BASE, TOKEN);
    await expect(storage.load("brief", "story-sync", "abc")).rejects.toThrow(
      /unauthorized \(401\)/
    );
  });

  it("throws AUTH_DENIED on 403 (scope mismatch)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("scope mismatch", { status: 403 }));
    const storage = new HttpBaselineStorage(BASE, TOKEN);
    await expect(storage.load("brief", "story-sync", "abc")).rejects.toThrow(
      /unauthorized \(403\)/
    );
  });

  it("throws DEPLOY_FAILED on other non-2xx responses", async () => {
    fetchMock.mockResolvedValueOnce(new Response("internal error", { status: 500 }));
    const storage = new HttpBaselineStorage(BASE, TOKEN);
    await expect(storage.load("brief", "story-sync", "abc")).rejects.toThrow(/returned 500/);
  });

  it("wraps fetch errors as NETWORK", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const storage = new HttpBaselineStorage(BASE, TOKEN);
    await expect(storage.load("brief", "story-sync", "abc")).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe("HttpBaselineStorage.write", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PUTs the envelope and returns the locator on success", async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"ok":true,"locator":"x"}', { status: 200 }));
    const storage = new HttpBaselineStorage(BASE, TOKEN);
    const locator = await storage.write("brief", "story-sync", "abc", sampleBaseline);
    expect(locator).toBe(`${BASE}/brief/story-sync/abc`);
    const call = fetchMock.mock.calls[0];
    expect(call?.[1]?.method).toBe("PUT");
    expect(call?.[1]?.headers).toMatchObject({
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    });
    expect(JSON.parse(call?.[1]?.body as string)).toEqual(sampleBaseline);
  });

  it("throws AUTH_DENIED on 401/403 write attempts", async () => {
    fetchMock.mockResolvedValueOnce(new Response("scope mismatch", { status: 403 }));
    const storage = new HttpBaselineStorage(BASE, TOKEN);
    await expect(storage.write("brief", "story-sync", "abc", sampleBaseline)).rejects.toThrow(
      /unauthorized \(403\)/
    );
  });
});

describe("constructor invariants", () => {
  it("refuses construction with empty endpointUrl", () => {
    expect(() => new HttpBaselineStorage("", TOKEN)).toThrow(/non-empty endpointUrl/);
  });

  it("refuses construction with empty authToken", () => {
    expect(() => new HttpBaselineStorage(BASE, "")).toThrow(/non-empty authToken/);
  });
});

describe("resolveHttpBaselineStorageFromEnv", () => {
  const originalUrl = process.env[SYNC_BASELINE_ENV_VARS.ENDPOINT_URL];
  const originalToken = process.env[SYNC_BASELINE_ENV_VARS.AUTH_TOKEN];

  afterEach(() => {
    if (originalUrl === undefined) delete process.env[SYNC_BASELINE_ENV_VARS.ENDPOINT_URL];
    else process.env[SYNC_BASELINE_ENV_VARS.ENDPOINT_URL] = originalUrl;
    if (originalToken === undefined) delete process.env[SYNC_BASELINE_ENV_VARS.AUTH_TOKEN];
    else process.env[SYNC_BASELINE_ENV_VARS.AUTH_TOKEN] = originalToken;
  });

  it("returns an HttpBaselineStorage instance when both env vars are set", () => {
    process.env[SYNC_BASELINE_ENV_VARS.ENDPOINT_URL] = BASE;
    process.env[SYNC_BASELINE_ENV_VARS.AUTH_TOKEN] = TOKEN;
    const storage = resolveHttpBaselineStorageFromEnv();
    expect(storage).toBeInstanceOf(HttpBaselineStorage);
    expect(storage?.endpointUrl).toBe(BASE);
    expect(storage?.authToken).toBe(TOKEN);
  });

  it("returns undefined when endpoint URL is missing", () => {
    delete process.env[SYNC_BASELINE_ENV_VARS.ENDPOINT_URL];
    process.env[SYNC_BASELINE_ENV_VARS.AUTH_TOKEN] = TOKEN;
    expect(resolveHttpBaselineStorageFromEnv()).toBeUndefined();
  });

  it("returns undefined when auth token is missing", () => {
    process.env[SYNC_BASELINE_ENV_VARS.ENDPOINT_URL] = BASE;
    delete process.env[SYNC_BASELINE_ENV_VARS.AUTH_TOKEN];
    expect(resolveHttpBaselineStorageFromEnv()).toBeUndefined();
  });
});
