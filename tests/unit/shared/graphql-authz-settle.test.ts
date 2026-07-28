import { afterEach, describe, expect, it, vi } from "vitest";
import { ScaiError } from "../../../src/shared/errors";
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

// The write-path retry config from `authoring-client.ts` — maxAttempts 3,
// nothing retryable except cancellation. The authz-settle track must work
// even under this most-restrictive posture.
const WRITE_RETRY = {
  maxAttempts: 3,
  retryableStatuses: new Set<number>(),
  retryAmbiguousNetwork: false,
  baseDelayMs: 0,
};

const AUTHZ_REFUSED = {
  message: "The current user is not authorized to access this resource.",
  extensions: { code: "AUTH_NOT_AUTHORIZED" },
};

const gqlErrors = (errors: unknown[]): Response =>
  new Response(JSON.stringify({ errors }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const ok = (data: unknown): Response =>
  new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

afterEach(() => vi.unstubAllGlobals());

describe("runSitecoreGraphQL — authorization-settle retry (AUTH_NOT_AUTHORIZED)", () => {
  it("retries an authz refusal and returns the eventual success (write posture)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(gqlErrors([AUTHZ_REFUSED]))
      .mockResolvedValueOnce(gqlErrors([AUTHZ_REFUSED]))
      .mockResolvedValueOnce(ok({ ran: true }));
    vi.stubGlobal("fetch", fetchMock);

    const data = await runSitecoreGraphQL(ENV, "mutation M {}", undefined, TRANSPORT, {
      retry: { ...WRITE_RETRY, authzSettleDelaysMs: [0, 0, 0, 0] },
    });

    expect(data).toEqual({ ran: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not consume the regular attempt budget: settle retries stack on top of maxAttempts 1", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(gqlErrors([AUTHZ_REFUSED]))
      .mockResolvedValueOnce(gqlErrors([AUTHZ_REFUSED]))
      .mockResolvedValueOnce(ok({ ran: true }));
    vi.stubGlobal("fetch", fetchMock);

    const data = await runSitecoreGraphQL(ENV, "query Q {}", undefined, TRANSPORT, {
      retry: { maxAttempts: 1, authzSettleDelaysMs: [0, 0] },
    });

    expect(data).toEqual({ ran: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("classifies a persistent refusal as AUTH_DENIED (not NETWORK) after the schedule is exhausted", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => gqlErrors([AUTHZ_REFUSED]));
    vi.stubGlobal("fetch", fetchMock);

    let thrown: unknown;
    try {
      await runSitecoreGraphQL(ENV, "mutation M {}", undefined, TRANSPORT, {
        retry: { ...WRITE_RETRY, authzSettleDelaysMs: [0, 0] },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ScaiError);
    const scaiError = thrown as ScaiError;
    expect(scaiError.code).toBe("AUTH_DENIED");
    expect(scaiError.message).toMatch(/not authorized to access/);
    expect(scaiError.details).toEqual(['{"code":"AUTH_NOT_AUTHORIZED"}']);
    expect(scaiError.hint).toMatch(/role assignment settles/);
    // Initial attempt + the two scheduled settle retries.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("matches on message text when the refusal carries no extensions", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        gqlErrors([{ message: "The current user is not authorized to access this resource." }])
      )
      .mockResolvedValueOnce(ok({ ran: true }));
    vi.stubGlobal("fetch", fetchMock);

    const data = await runSitecoreGraphQL(ENV, "query Q {}", undefined, TRANSPORT, {
      retry: { maxAttempts: 1, authzSettleDelaysMs: [0] },
    });

    expect(data).toEqual({ ran: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("can be disabled with an empty schedule — refusal fails fast as AUTH_DENIED", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => gqlErrors([AUTHZ_REFUSED]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runSitecoreGraphQL(ENV, "mutation M {}", undefined, TRANSPORT, {
        retry: { maxAttempts: 1, authzSettleDelaysMs: [] },
      })
    ).rejects.toMatchObject({ code: "AUTH_DENIED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves ordinary GraphQL errors on the NETWORK path with no settle retries", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () =>
        gqlErrors([{ message: 'The item name "X" is already defined on this level.' }])
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runSitecoreGraphQL(ENV, "mutation M {}", undefined, TRANSPORT, {
        retry: { maxAttempts: 1, authzSettleDelaysMs: [0, 0] },
      })
    ).rejects.toMatchObject({ code: "NETWORK" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
