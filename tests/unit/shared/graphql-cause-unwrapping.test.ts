import { afterEach, describe, expect, it, vi } from "vitest";
import { runSitecoreGraphQL } from "../../../src/shared/graphql";

/**
 * Node's `fetch` rejects with a bare `TypeError: fetch failed` — two words
 * that are identical for a DNS miss, a refused connection, an expired
 * certificate, and a broken proxy. The reason is on `.cause`, and the
 * transport used to drop it.
 *
 * The consumer that made this bite: the orchestrator's daily deploy smoke
 * classifies a tenant failure as "unreachable — infrastructure, not a
 * deploy-path regression" partly by matching "fetch failed". With nothing but
 * those two words in the CI log, a decommissioned host and a healthy host with
 * a bad certificate are indistinguishable — and only one of them is infra.
 */

const ENV = { host: "https://cm.example.com" } as unknown as Parameters<
  typeof runSitecoreGraphQL
>[0];
const TRANSPORT = {
  servicePath: "/sitecore/api/authoring/graphql/v1",
  label: "Authoring",
  requireToken: false,
  getAccessToken: async () => "tok",
} as unknown as Parameters<typeof runSitecoreGraphQL>[3];
const NO_RETRY = {
  maxAttempts: 1,
  retryableStatuses: new Set<number>(),
  retryAmbiguousNetwork: false,
  baseDelayMs: 0,
};

/** What `fetch` actually throws when the host does not resolve. */
const fetchFailed = (cause: unknown): TypeError => {
  const err = new TypeError("fetch failed");
  (err as { cause?: unknown }).cause = cause;
  return err;
};

const withCode = (message: string, code: string): Error => {
  const err = new Error(message);
  (err as { code?: string }).code = code;
  return err;
};

const run = () =>
  runSitecoreGraphQL(ENV, "query Q {}", undefined, TRANSPORT, {
    retry: NO_RETRY,
  });

afterEach(() => vi.unstubAllGlobals());

describe("runSitecoreGraphQL — fetch cause unwrapping", () => {
  it("names the DNS failure instead of only 'fetch failed'", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          fetchFailed(withCode("getaddrinfo ENOTFOUND cm.example.com", "ENOTFOUND"))
        )
    );

    await expect(run()).rejects.toThrow(
      /fetch failed \(cause: ENOTFOUND: getaddrinfo ENOTFOUND cm\.example\.com\)/
    );
  });

  it("distinguishes a certificate failure from an unreachable host", async () => {
    // The case the smoke's "infrastructure, not a regression" verdict gets
    // wrong: the host is up and answering, the deploy path is genuinely
    // broken, and both used to print the same two words.
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(fetchFailed(withCode("certificate has expired", "CERT_HAS_EXPIRED")))
    );

    await expect(run()).rejects.toThrow(/CERT_HAS_EXPIRED: certificate has expired/);
  });

  it("walks an AggregateError's branches (happy-eyeballs dual-stack)", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          fetchFailed(
            new AggregateError(
              [
                withCode("connect ECONNREFUSED 127.0.0.1:443", "ECONNREFUSED"),
                withCode("connect ECONNREFUSED ::1:443", "ECONNREFUSED"),
              ],
              "all connection attempts failed"
            )
          )
        )
    );

    const error = await run().catch((e: unknown) => e as Error);
    expect(error.message).toContain("all connection attempts failed");
    expect(error.message).toContain("connect ECONNREFUSED 127.0.0.1:443");
    expect(error.message).toContain("connect ECONNREFUSED ::1:443");
  });

  it("adds nothing when there is no cause to report", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const error = await run().catch((e: unknown) => e as Error);
    expect(error.message).toContain("fetch failed");
    expect(error.message).not.toContain("cause:");
  });

  it("terminates on a self-referential cause chain", async () => {
    const looping = new Error("loop");
    (looping as { cause?: unknown }).cause = looping;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(fetchFailed(looping)));

    const error = await run().catch((e: unknown) => e as Error);
    expect(error.message).toContain("(cause: loop)");
  });
});
