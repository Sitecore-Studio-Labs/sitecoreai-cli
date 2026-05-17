import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the `@napi-rs/keyring`-backed credential store.
 *
 * The native module is always mocked — these tests must NEVER write a
 * real token or touch the OS keychain. Each test calls `vi.resetModules()`
 * then `vi.doMock("@napi-rs/keyring", …)` so the keychain's
 * `cachedKeyring` memo is rebuilt against the per-test fake.
 *
 * Two failure surfaces are exercised: the keyring module failing to load
 * (fail-closed: undefined/false everywhere) and an `AsyncEntry` method
 * throwing at runtime (a NoEntry on read → undefined; a write/delete
 * failure → false).
 */

/** Build a fake `@napi-rs/keyring` whose AsyncEntry delegates to shared spies. */
const makeRing = (spies: {
  getPassword: ReturnType<typeof vi.fn>;
  setPassword: ReturnType<typeof vi.fn>;
  deleteCredential: ReturnType<typeof vi.fn>;
}): { AsyncEntry: unknown; lastArgs: () => [string, string] } => {
  let lastArgs: [string, string] = ["", ""];
  class AsyncEntry {
    constructor(service: string, account: string) {
      lastArgs = [service, account];
    }
    getPassword() {
      return spies.getPassword();
    }
    setPassword(password: string) {
      return spies.setPassword(password);
    }
    deleteCredential() {
      return spies.deleteCredential();
    }
  }
  return { AsyncEntry, lastArgs: () => lastArgs };
};

const okSpies = (password: string | undefined) => ({
  getPassword: vi.fn().mockResolvedValue(password),
  setPassword: vi.fn().mockResolvedValue(undefined),
  deleteCredential: vi.fn().mockResolvedValue(true),
});

const throwingSpies = () => ({
  getPassword: vi.fn().mockRejectedValue(new Error("NoEntry")),
  setPassword: vi.fn().mockRejectedValue(new Error("write failed")),
  deleteCredential: vi.fn().mockRejectedValue(new Error("delete failed")),
});

type Keychain = typeof import("../../../src/shared/keychain");

const importKeychainWith = async (ringFactory: () => unknown): Promise<Keychain> => {
  vi.resetModules();
  vi.doMock("@napi-rs/keyring", ringFactory);
  return import("../../../src/shared/keychain");
};

beforeEach(() => {
  delete process.env.SITECOREAI_JSON;
  delete process.env.SITECOREAI_QUIET;
});

afterEach(() => {
  vi.doUnmock("@napi-rs/keyring");
});

describe("keychain — keyring unavailable (fail-closed)", () => {
  it("returns undefined/false for every credential family", async () => {
    const keychain = await importKeychainWith(() => {
      throw new Error("native module missing");
    });

    expect(await keychain.getDeployToken("demo")).toBeUndefined();
    expect(await keychain.setDeployToken("demo", "t")).toBe(false);
    expect(await keychain.clearDeployToken("demo")).toBe(false);

    expect(await keychain.getPublishingToken("demo")).toBeUndefined();
    expect(await keychain.setPublishingToken("demo", "t")).toBe(false);
    expect(await keychain.clearPublishingToken("demo")).toBe(false);

    expect(await keychain.getBriefToken("demo")).toBeUndefined();
    expect(await keychain.setBriefToken("demo", "t")).toBe(false);
    expect(await keychain.clearBriefToken("demo")).toBe(false);

    expect(await keychain.getCampaignToken("demo")).toBeUndefined();
    expect(await keychain.setCampaignToken("demo", "t")).toBe(false);
    expect(await keychain.clearCampaignToken("demo")).toBe(false);

    expect(await keychain.getAgentsCredential("demo")).toBeUndefined();
    expect(await keychain.setAgentsCredential("demo", "c")).toBe(false);
    expect(await keychain.clearAgentsCredential("demo")).toBe(false);

    expect(await keychain.getCmTokens("demo")).toBeUndefined();
    expect(await keychain.setCmTokens("demo", { accessToken: "t" })).toBe(false);
    expect(await keychain.clearCmTokens("demo")).toBe(false);

    expect(await keychain.getCmClientSecret("demo")).toBeUndefined();
    expect(await keychain.setCmClientSecret("demo", "s")).toBe(false);
    expect(await keychain.clearCmClientSecret("demo")).toBe(false);

    expect(await keychain.getOrgClientSecret("org")).toBeUndefined();
    expect(await keychain.setOrgClientSecret("org", "s")).toBe(false);
    expect(await keychain.clearOrgClientSecret("org")).toBe(false);

    expect(await keychain.getBrandClientSecret("org")).toBeUndefined();
    expect(await keychain.setBrandClientSecret("org", "s")).toBe(false);
    expect(await keychain.clearBrandClientSecret("org")).toBe(false);

    expect(await keychain.getBrandToken("org")).toBeUndefined();
    expect(await keychain.setBrandToken("org", "t")).toBe(false);
    expect(await keychain.clearBrandToken("org")).toBe(false);
  });

  it("loads the keyring exactly once across calls (memoized)", async () => {
    const factory = vi.fn(() => {
      throw new Error("missing");
    });
    const keychain = await importKeychainWith(factory);

    await keychain.getDeployToken("demo");
    await keychain.getDeployToken("demo");
    await keychain.setBriefToken("demo", "t");

    // The dynamic import is attempted once; subsequent calls reuse the
    // cached `null` and never re-import.
    expect(factory).toHaveBeenCalledTimes(1);
  });
});

describe("keychain — store / retrieve / delete round-trips", () => {
  it("getDeployToken reads the deploy:<env> account", async () => {
    const ok = okSpies("deploy-token");
    const ring = makeRing(ok);
    const keychain = await importKeychainWith(() => ring);

    expect(await keychain.getDeployToken("prod")).toBe("deploy-token");
    expect(ring.lastArgs()).toEqual(["SitecoreAI CLI", "deploy:prod"]);
  });

  it("setDeployToken writes the token and returns true", async () => {
    const ok = okSpies(undefined);
    const ring = makeRing(ok);
    const keychain = await importKeychainWith(() => ring);

    expect(await keychain.setDeployToken("prod", "new-token")).toBe(true);
    expect(ok.setPassword).toHaveBeenCalledWith("new-token");
    expect(ring.lastArgs()).toEqual(["SitecoreAI CLI", "deploy:prod"]);
  });

  it("clearDeployToken delegates to deleteCredential", async () => {
    const ok = okSpies(undefined);
    const ring = makeRing(ok);
    const keychain = await importKeychainWith(() => ring);

    expect(await keychain.clearDeployToken("prod")).toBe(true);
    expect(ok.deleteCredential).toHaveBeenCalledTimes(1);
  });

  it("publishing/brief/campaign tokens use their own account prefixes", async () => {
    const ok = okSpies("scoped-token");
    const ring = makeRing(ok);
    const keychain = await importKeychainWith(() => ring);

    expect(await keychain.getPublishingToken("e")).toBe("scoped-token");
    expect(ring.lastArgs()[1]).toBe("publishing:e");
    expect(await keychain.getBriefToken("e")).toBe("scoped-token");
    expect(ring.lastArgs()[1]).toBe("brief:e");
    expect(await keychain.getCampaignToken("e")).toBe("scoped-token");
    expect(ring.lastArgs()[1]).toBe("campaign:e");
  });

  it("agents credential round-trips under the agents:<env> account", async () => {
    const ok = okSpies('{"cookie":"x"}');
    const ring = makeRing(ok);
    const keychain = await importKeychainWith(() => ring);

    expect(await keychain.getAgentsCredential("e")).toBe('{"cookie":"x"}');
    expect(ring.lastArgs()[1]).toBe("agents:e");
    expect(await keychain.setAgentsCredential("e", '{"cookie":"y"}')).toBe(true);
    expect(ok.setPassword).toHaveBeenCalledWith('{"cookie":"y"}');
  });

  it("org/brand secrets are keyed by organizationId, not env", async () => {
    const ok = okSpies("org-secret");
    const ring = makeRing(ok);
    const keychain = await importKeychainWith(() => ring);

    expect(await keychain.getOrgClientSecret("org-123")).toBe("org-secret");
    expect(ring.lastArgs()[1]).toBe("org-client:org-123");

    expect(await keychain.setBrandClientSecret("org-123", "brand-secret")).toBe(true);
    expect(ring.lastArgs()[1]).toBe("ai-skills-secret:org-123");

    expect(await keychain.setBrandToken("org-123", "brand-token")).toBe(true);
    expect(ring.lastArgs()[1]).toBe("ai-skills-token:org-123");
  });
});

describe("keychain — CM token bundle (JSON serialization)", () => {
  it("parses a stored bundle from JSON", async () => {
    const bundle = { accessToken: "a", refreshToken: "r", expiresIn: 3600 };
    const ok = okSpies(JSON.stringify(bundle));
    const ring = makeRing(ok);
    const keychain = await importKeychainWith(() => ring);

    expect(await keychain.getCmTokens("demo")).toEqual(bundle);
  });

  it("returns undefined when no bundle is stored", async () => {
    const ok = okSpies(undefined);
    const ring = makeRing(ok);
    const keychain = await importKeychainWith(() => ring);

    expect(await keychain.getCmTokens("demo")).toBeUndefined();
  });

  it("returns undefined for a corrupt (non-JSON) bundle (safeParse)", async () => {
    const ok = okSpies("not-json{");
    const ring = makeRing(ok);
    const keychain = await importKeychainWith(() => ring);

    expect(await keychain.getCmTokens("demo")).toBeUndefined();
  });

  it("setCmTokens serializes the bundle to JSON", async () => {
    const ok = okSpies(undefined);
    const ring = makeRing(ok);
    const keychain = await importKeychainWith(() => ring);

    const bundle = { accessToken: "a", expiresIn: 60 };
    expect(await keychain.setCmTokens("demo", bundle)).toBe(true);
    expect(ok.setPassword).toHaveBeenCalledWith(JSON.stringify(bundle));
  });
});

describe("keychain — runtime errors from AsyncEntry", () => {
  it("a read failure (NoEntry) resolves to undefined, not a throw", async () => {
    const ring = makeRing(throwingSpies());
    const keychain = await importKeychainWith(() => ring);

    expect(await keychain.getDeployToken("demo")).toBeUndefined();
    expect(await keychain.getCmClientSecret("demo")).toBeUndefined();
    expect(await keychain.getCmTokens("demo")).toBeUndefined();
  });

  it("a write failure resolves to false, not a throw", async () => {
    const ring = makeRing(throwingSpies());
    const keychain = await importKeychainWith(() => ring);

    expect(await keychain.setDeployToken("demo", "t")).toBe(false);
    expect(await keychain.setCmClientSecret("demo", "s")).toBe(false);
    expect(await keychain.setOrgClientSecret("org", "s")).toBe(false);
    expect(await keychain.setBrandToken("org", "t")).toBe(false);
  });

  it("a successful delete resolves to true", async () => {
    const ok = okSpies(undefined);
    const ring = makeRing(ok);
    const keychain = await importKeychainWith(() => ring);

    expect(await keychain.clearDeployToken("demo")).toBe(true);
    expect(await keychain.clearOrgClientSecret("org")).toBe(true);
    expect(await keychain.clearBrandClientSecret("org")).toBe(true);
  });

  it("a delete that returns false (NoEntry-style) propagates false", async () => {
    const ring = makeRing({
      getPassword: vi.fn().mockResolvedValue(undefined),
      setPassword: vi.fn().mockResolvedValue(undefined),
      deleteCredential: vi.fn().mockResolvedValue(false),
    });
    const keychain = await importKeychainWith(() => ring);

    expect(await keychain.clearDeployToken("demo")).toBe(false);
  });

  it("a delete that rejects resolves to false, not a rejected promise", async () => {
    // Regression: each clear* helper must `await` deleteCredential() inside
    // its try/catch. A returned-but-unawaited promise lets a rejection
    // escape the catch and reject the helper instead of resolving false.
    const ring = makeRing({
      getPassword: vi.fn().mockResolvedValue(undefined),
      setPassword: vi.fn().mockResolvedValue(undefined),
      deleteCredential: vi.fn().mockRejectedValue(new Error("delete failed")),
    });
    const keychain = await importKeychainWith(() => ring);

    await expect(keychain.clearDeployToken("demo")).resolves.toBe(false);
    await expect(keychain.clearPublishingToken("e")).resolves.toBe(false);
    await expect(keychain.clearBriefToken("e")).resolves.toBe(false);
    await expect(keychain.clearCampaignToken("e")).resolves.toBe(false);
    await expect(keychain.clearAgentsCredential("e")).resolves.toBe(false);
    await expect(keychain.clearCmTokens("e")).resolves.toBe(false);
    await expect(keychain.clearCmClientSecret("e")).resolves.toBe(false);
    await expect(keychain.clearOrgClientSecret("org")).resolves.toBe(false);
    await expect(keychain.clearBrandClientSecret("org")).resolves.toBe(false);
    await expect(keychain.clearBrandToken("org")).resolves.toBe(false);
  });
});

describe("keychain — write/delete failures across every credential family", () => {
  it("every set* resolves false (not a throw) when AsyncEntry write throws", async () => {
    const ring = makeRing(throwingSpies());
    const keychain = await importKeychainWith(() => ring);

    expect(await keychain.setPublishingToken("e", "t")).toBe(false);
    expect(await keychain.setBriefToken("e", "t")).toBe(false);
    expect(await keychain.setCampaignToken("e", "t")).toBe(false);
    expect(await keychain.setAgentsCredential("e", "c")).toBe(false);
    expect(await keychain.setCmTokens("e", { accessToken: "a" })).toBe(false);
    expect(await keychain.setBrandClientSecret("org", "s")).toBe(false);
  });

  it("every clear* resolves false when AsyncEntry delete reports NoEntry-style false", async () => {
    // deleteCredential resolving `false` is the NoEntry path — the
    // clear* helpers propagate that without throwing.
    const ring = makeRing({
      getPassword: vi.fn().mockResolvedValue(undefined),
      setPassword: vi.fn().mockResolvedValue(undefined),
      deleteCredential: vi.fn().mockResolvedValue(false),
    });
    const keychain = await importKeychainWith(() => ring);

    expect(await keychain.clearPublishingToken("e")).toBe(false);
    expect(await keychain.clearBriefToken("e")).toBe(false);
    expect(await keychain.clearCampaignToken("e")).toBe(false);
    expect(await keychain.clearAgentsCredential("e")).toBe(false);
    expect(await keychain.clearCmTokens("e")).toBe(false);
    expect(await keychain.clearCmClientSecret("e")).toBe(false);
    expect(await keychain.clearBrandToken("org")).toBe(false);
  });

  it("a read failure resolves to undefined for the org/brand-keyed credentials", async () => {
    const ring = makeRing(throwingSpies());
    const keychain = await importKeychainWith(() => ring);

    expect(await keychain.getPublishingToken("e")).toBeUndefined();
    expect(await keychain.getBriefToken("e")).toBeUndefined();
    expect(await keychain.getCampaignToken("e")).toBeUndefined();
    expect(await keychain.getAgentsCredential("e")).toBeUndefined();
    expect(await keychain.getOrgClientSecret("org")).toBeUndefined();
    expect(await keychain.getBrandClientSecret("org")).toBeUndefined();
    expect(await keychain.getBrandToken("org")).toBeUndefined();
  });

  it("warns once for a write failure in human mode and suppresses repeats", async () => {
    vi.resetModules();
    vi.doMock("@napi-rs/keyring", () => makeRing(throwingSpies()));
    const { consola } = await import("consola");
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => undefined);

    const keychain = await import("../../../src/shared/keychain");
    await keychain.setDeployToken("e", "t");
    await keychain.setPublishingToken("e", "t");
    await keychain.setBriefToken("e", "t");

    // `warnedKeyringError` is one-shot — only the first write-failure warns.
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("keychain — full round-trips for publishing / brief / campaign / agents", () => {
  it("set* writes the token and clear* deletes it for every env-keyed family", async () => {
    const ok = okSpies(undefined);
    const ring = makeRing(ok);
    const keychain = await importKeychainWith(() => ring);

    expect(await keychain.setPublishingToken("prod", "p")).toBe(true);
    expect(ring.lastArgs()[1]).toBe("publishing:prod");
    expect(await keychain.setBriefToken("prod", "b")).toBe(true);
    expect(ring.lastArgs()[1]).toBe("brief:prod");
    expect(await keychain.setCampaignToken("prod", "c")).toBe(true);
    expect(ring.lastArgs()[1]).toBe("campaign:prod");

    expect(await keychain.clearPublishingToken("prod")).toBe(true);
    expect(await keychain.clearBriefToken("prod")).toBe(true);
    expect(await keychain.clearCampaignToken("prod")).toBe(true);
    expect(await keychain.clearAgentsCredential("prod")).toBe(true);
  });

  it("brand token + brand client secret round-trip under the ai-skills-* accounts", async () => {
    const ok = okSpies("stored");
    const ring = makeRing(ok);
    const keychain = await importKeychainWith(() => ring);

    expect(await keychain.getBrandToken("org-9")).toBe("stored");
    expect(ring.lastArgs()[1]).toBe("ai-skills-token:org-9");
    expect(await keychain.getBrandClientSecret("org-9")).toBe("stored");
    expect(ring.lastArgs()[1]).toBe("ai-skills-secret:org-9");
    expect(await keychain.getCmClientSecret("prod")).toBe("stored");
    expect(ring.lastArgs()[1]).toBe("cm-client:prod");
  });
});

describe("keychain — unavailable warning suppression", () => {
  it("suppresses the keyring-unavailable warning under SITECOREAI_JSON=1", async () => {
    process.env.SITECOREAI_JSON = "1";
    // resetModules first so the keychain and consola share one instance.
    vi.resetModules();
    vi.doMock("@napi-rs/keyring", () => {
      throw new Error("missing");
    });
    const { consola } = await import("consola");
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => undefined);

    const keychain = await import("../../../src/shared/keychain");
    await keychain.getDeployToken("demo");

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns once (not per call) when the keyring is unavailable in human mode", async () => {
    vi.resetModules();
    vi.doMock("@napi-rs/keyring", () => {
      throw new Error("missing");
    });
    const { consola } = await import("consola");
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => undefined);

    const keychain = await import("../../../src/shared/keychain");
    await keychain.getDeployToken("demo");
    await keychain.getDeployToken("demo");
    await keychain.getBriefToken("demo");

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
