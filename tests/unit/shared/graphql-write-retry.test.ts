import { afterEach, describe, expect, it, vi } from "vitest";
import { runSitecoreGraphQL } from "../../../src/shared/graphql";

// Minimal environment + transport — `fetch` is stubbed, so nothing hits the
// network; only `environment.host` + the transport shape are read.
const ENV = { host: "https://cm.example.com" } as unknown as Parameters<
  typeof runSitecoreGraphQL
>[0];
const TRANSPORT = {
  servicePath: "/sitecore/api/authoring/graphql/v1",
  label: "Authoring",
  requireToken: false,
  getAccessToken: async () => "tok",
} as unknown as Parameters<typeof runSitecoreGraphQL>[3];

// The write-path retry config from `authoring-client.ts`: retry ONLY on a
// server-side cancellation.
const WRITE_RETRY = {
  maxAttempts: 3,
  retryableStatuses: new Set<number>(),
  retryAmbiguousNetwork: false,
  baseDelayMs: 0,
};

const gqlError = (message: string): Response =>
  new Response(JSON.stringify({ errors: [{ message }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const ok = (data: unknown): Response =>
  new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

afterEach(() => vi.unstubAllGlobals());

describe("runSitecoreGraphQL — write retry on server cancellation", () => {
  it("retries a write on 'operation was canceled' and returns the eventual success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(gqlError("The operation was canceled."))
      .mockResolvedValueOnce(gqlError("The operation was canceled."))
      .mockResolvedValueOnce(ok({ ran: true }));
    vi.stubGlobal("fetch", fetchMock);

    const data = await runSitecoreGraphQL(ENV, "mutation M {}", undefined, TRANSPORT, {
      retry: WRITE_RETRY,
    });

    expect(data).toEqual({ ran: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry a write on a non-cancellation GraphQL error (duplicate-write safety)", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () =>
        gqlError('The item name "X" is already defined on this level.')
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runSitecoreGraphQL(ENV, "mutation M {}", undefined, TRANSPORT, { retry: WRITE_RETRY })
    ).rejects.toThrow(/already defined/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after the retry budget on a persistent cancellation", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => gqlError("The operation was canceled."));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runSitecoreGraphQL(ENV, "mutation M {}", undefined, TRANSPORT, { retry: WRITE_RETRY })
    ).rejects.toThrow(/canceled/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
