import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyCloudflareEdgeError, runSitecoreGraphQL } from "../../../src/shared/graphql";

// Cloudflare serves an HTML error page (never JSON) when a request dies at its
// edge. The Authoring API only returns JSON, so an HTML body is an unambiguous
// transient edge failure — the CM host was momentarily unroutable. These guard
// that such a page is (a) classified/retried correctly, write-safely, and (b)
// surfaced as a concise message instead of the raw HTML under a misleading
// status — while a genuine JSON error is untouched.

const ENV = { host: "https://cm.example.com" } as unknown as Parameters<
  typeof runSitecoreGraphQL
>[0];
const TRANSPORT = {
  servicePath: "/sitecore/api/authoring/graphql/v1",
  label: "Authoring",
  requireToken: false,
  getAccessToken: async () => "tok",
} as unknown as Parameters<typeof runSitecoreGraphQL>[3];

// The write-path config from `authoring-client.ts`: no retryable statuses and
// ambiguous-network retries OFF (duplicate-write safety).
const WRITE_RETRY = {
  maxAttempts: 3,
  retryableStatuses: new Set<number>(),
  retryAmbiguousNetwork: false,
  baseDelayMs: 0,
};
// A read/idempotent caller: ambiguous-network retries ON.
const READ_RETRY = {
  maxAttempts: 3,
  retryableStatuses: new Set<number>(),
  retryAmbiguousNetwork: true,
  baseDelayMs: 0,
};

// 1018 "Could not find host": the request never reached the origin.
const CF_1018 = `<!DOCTYPE html><html><head><title>Could not find host | xmc-example.sitecorecloud.io | Cloudflare</title></head><body><div id="cf-wrapper"><h1>Error 1018</h1><h2>Could not find host</h2><span>Cloudflare Ray ID: abc123</span><a href="/cdn-cgi/styles/main.css"></a></body></html>`;
// 524 "A timeout occurred": the origin may have received it (ambiguous).
const CF_524 = `<!DOCTYPE html><html><head><title>xmc-example.sitecorecloud.io | 524: A timeout occurred | Cloudflare</title></head><body><div class="cf-error-details cf-error-524"><h1>A timeout occurred</h1><span>Cloudflare Ray ID: def456</span></body></html>`;

const htmlResponse = (status: number, html: string): Response =>
  new Response(html, { status, headers: { "content-type": "text/html" } });
const jsonConflict = (): Response =>
  new Response(
    JSON.stringify({
      errors: [{ message: "An item with the same key has already been added." }],
    }),
    { status: 409, headers: { "content-type": "application/json" } }
  );
const ok = (data: unknown): Response =>
  new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

afterEach(() => vi.unstubAllGlobals());

describe("classifyCloudflareEdgeError", () => {
  it("classifies a 1018 'could not find host' page as safe (never reached origin)", () => {
    const result = classifyCloudflareEdgeError(CF_1018);
    expect(result?.retry).toBe("safe");
    expect(result?.summary).toContain("Could not find host");
  });

  it("classifies a 524 timeout page as ambiguous (origin may have received it)", () => {
    expect(classifyCloudflareEdgeError(CF_524)?.retry).toBe("ambiguous");
  });

  it("returns undefined for a JSON object body (a real API error, not an edge page)", () => {
    expect(classifyCloudflareEdgeError({ errors: [{ message: "conflict" }] })).toBeUndefined();
  });

  it("returns undefined for a non-Cloudflare text body", () => {
    expect(classifyCloudflareEdgeError("upstream connect error 503")).toBeUndefined();
  });
});

describe("runSitecoreGraphQL — Cloudflare edge retry", () => {
  it("retries a WRITE on a 1018 edge page (safe) despite retryAmbiguousNetwork:false, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      // The 1018 arrives under a 409 (as seen in production) — classification
      // is body-based, so the misleading status is irrelevant.
      .mockResolvedValueOnce(htmlResponse(409, CF_1018))
      .mockResolvedValueOnce(ok({ ran: true }));
    vi.stubGlobal("fetch", fetchMock);

    const data = await runSitecoreGraphQL(ENV, "mutation M {}", undefined, TRANSPORT, {
      retry: WRITE_RETRY,
    });

    expect(data).toEqual({ ran: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces a concise message (not the raw HTML) after exhausting retries on a persistent 1018", async () => {
    // Fresh Response per call — a Response body can only be read once.
    const fetchMock = vi.fn().mockImplementation(async () => htmlResponse(409, CF_1018));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runSitecoreGraphQL(ENV, "mutation M {}", undefined, TRANSPORT, { retry: WRITE_RETRY })
    ).rejects.toThrow(/host temporarily unreachable at the Cloudflare edge/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry a WRITE on a 524 ambiguous edge page (duplicate-write safety)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(htmlResponse(524, CF_524));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runSitecoreGraphQL(ENV, "mutation M {}", undefined, TRANSPORT, { retry: WRITE_RETRY })
    ).rejects.toThrow(/Cloudflare edge/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("DOES retry a 524 ambiguous edge page for a read / idempotent caller, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse(524, CF_524))
      .mockResolvedValueOnce(ok({ read: true }));
    vi.stubGlobal("fetch", fetchMock);

    const data = await runSitecoreGraphQL(ENV, "query Q {}", undefined, TRANSPORT, {
      retry: READ_RETRY,
    });

    expect(data).toEqual({ read: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT treat a genuine JSON 409 conflict as an edge failure (fail-fast for writes)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonConflict());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runSitecoreGraphQL(ENV, "mutation M {}", undefined, TRANSPORT, { retry: WRITE_RETRY })
    ).rejects.toThrow(/request failed \(409\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
