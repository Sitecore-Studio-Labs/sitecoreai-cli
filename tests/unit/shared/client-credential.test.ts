import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the three-tier automation-client secret resolver.
 *
 * Tier 1 (`env-var`) reads `SITECOREAI_*` environment variables; tiers 2
 * and 3 read the OS keychain, which is mocked here — no real secrets are
 * touched. Each test controls exactly which tier should win and asserts
 * the resolved `{ clientId, clientSecret, source }` triple.
 */

const mocks = vi.hoisted(() => ({
  getCmClientSecret: vi.fn(),
  getOrgClientSecret: vi.fn(),
}));

vi.mock("../../../src/shared/keychain", () => ({
  getCmClientSecret: mocks.getCmClientSecret,
  getOrgClientSecret: mocks.getOrgClientSecret,
}));

import {
  resolveClientCredential,
  resolveEnvClientSecret,
} from "../../../src/shared/client-credential";

/** Snapshot and restore the SITECOREAI_* env vars these tests mutate. */
const TOUCHED = [
  "SITECOREAI_CLIENT_SECRET",
  "SITECOREAI_CLIENT_ID",
  "SITECOREAI_ENV_PROD_CLIENT_SECRET",
  "SITECOREAI_ENV_PROD_CLIENT_ID",
  "SITECOREAI_ENV_MY_ENV_CLIENT_SECRET",
];
let snapshot: Record<string, string | undefined>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCmClientSecret.mockResolvedValue(undefined);
  mocks.getOrgClientSecret.mockResolvedValue(undefined);
  snapshot = {};
  for (const key of TOUCHED) {
    snapshot[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of TOUCHED) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
});

describe("resolveEnvClientSecret", () => {
  it("prefers the env-scoped variable over the global one", () => {
    process.env.SITECOREAI_ENV_PROD_CLIENT_SECRET = "env-scoped";
    process.env.SITECOREAI_CLIENT_SECRET = "global";
    expect(resolveEnvClientSecret("prod")).toBe("env-scoped");
  });

  it("falls back to the global variable when the env-scoped one is unset", () => {
    process.env.SITECOREAI_CLIENT_SECRET = "global-secret";
    expect(resolveEnvClientSecret("prod")).toBe("global-secret");
  });

  it("returns undefined when neither variable is set", () => {
    expect(resolveEnvClientSecret("prod")).toBeUndefined();
  });

  it("normalizes the env name into the SITECOREAI_ENV_<ENV>_ key segment", () => {
    // "my env" → "MY_ENV"; non-alphanumerics collapse to a single `_`.
    process.env.SITECOREAI_ENV_MY_ENV_CLIENT_SECRET = "normalized";
    expect(resolveEnvClientSecret("my env")).toBe("normalized");
    expect(resolveEnvClientSecret("My-Env")).toBe("normalized");
  });

  it("ignores a whitespace-only env variable", () => {
    process.env.SITECOREAI_CLIENT_SECRET = "   ";
    expect(resolveEnvClientSecret("prod")).toBeUndefined();
  });
});

describe("resolveClientCredential — tier 1 (env-var)", () => {
  it("pairs the env-var secret with the env-profile clientId", async () => {
    process.env.SITECOREAI_ENV_PROD_CLIENT_SECRET = "byo-secret";

    const result = await resolveClientCredential({
      envName: "prod",
      clientId: "profile-client",
    });

    expect(result).toEqual({
      clientId: "profile-client",
      clientSecret: "byo-secret",
      source: "env-var",
    });
    // Tier 1 wins outright — the keychain is never consulted.
    expect(mocks.getCmClientSecret).not.toHaveBeenCalled();
    expect(mocks.getOrgClientSecret).not.toHaveBeenCalled();
  });

  it("pairs the env-var secret with the SITECOREAI_ENV_<ENV>_CLIENT_ID id", async () => {
    process.env.SITECOREAI_ENV_PROD_CLIENT_SECRET = "byo-secret";
    process.env.SITECOREAI_ENV_PROD_CLIENT_ID = "env-var-client";

    const result = await resolveClientCredential({ envName: "prod" });

    expect(result).toMatchObject({ clientId: "env-var-client", source: "env-var" });
  });

  it("falls through to tier 2 when the env-var secret has no matching clientId", async () => {
    process.env.SITECOREAI_ENV_PROD_CLIENT_SECRET = "orphan-secret";
    mocks.getCmClientSecret.mockResolvedValue("cm-secret");

    const result = await resolveClientCredential({
      envName: "prod",
      automationClientId: "cm-client-id",
    });

    expect(result).toEqual({
      clientId: "cm-client-id",
      clientSecret: "cm-secret",
      source: "cm-client",
    });
  });
});

describe("resolveClientCredential — tier 2 (cm-client)", () => {
  it("resolves the env-scoped keychain secret with the automationClientId", async () => {
    mocks.getCmClientSecret.mockResolvedValue("cm-secret");

    const result = await resolveClientCredential({
      envName: "prod",
      automationClientId: "cm-client-id",
    });

    expect(result).toEqual({
      clientId: "cm-client-id",
      clientSecret: "cm-secret",
      source: "cm-client",
    });
    expect(mocks.getCmClientSecret).toHaveBeenCalledWith("prod");
  });

  it("skips tier 2 entirely when no automationClientId is supplied", async () => {
    mocks.getCmClientSecret.mockResolvedValue("cm-secret");

    const result = await resolveClientCredential({ envName: "prod" });

    expect(mocks.getCmClientSecret).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("falls through to tier 3 when the keychain has no env-scoped secret", async () => {
    mocks.getCmClientSecret.mockResolvedValue(undefined);
    mocks.getOrgClientSecret.mockResolvedValue("org-secret");

    const result = await resolveClientCredential({
      envName: "prod",
      automationClientId: "cm-client-id",
      organizationId: "org-1",
      orgClientId: "org-client-id",
    });

    expect(result).toMatchObject({ source: "org-client" });
  });
});

describe("resolveClientCredential — tier 3 (org-client)", () => {
  it("resolves the org-scoped keychain secret keyed by organizationId", async () => {
    mocks.getOrgClientSecret.mockResolvedValue("org-secret");

    const result = await resolveClientCredential({
      envName: "prod",
      organizationId: "org-1",
      orgClientId: "org-client-id",
    });

    expect(result).toEqual({
      clientId: "org-client-id",
      clientSecret: "org-secret",
      source: "org-client",
    });
    expect(mocks.getOrgClientSecret).toHaveBeenCalledWith("org-1");
  });

  it("skips tier 3 when organizationId is missing", async () => {
    mocks.getOrgClientSecret.mockResolvedValue("org-secret");

    const result = await resolveClientCredential({
      envName: "prod",
      orgClientId: "org-client-id",
    });

    expect(mocks.getOrgClientSecret).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("skips tier 3 when orgClientId is missing", async () => {
    mocks.getOrgClientSecret.mockResolvedValue("org-secret");

    const result = await resolveClientCredential({
      envName: "prod",
      organizationId: "org-1",
    });

    expect(mocks.getOrgClientSecret).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});

describe("resolveClientCredential — no tier matches", () => {
  it("returns undefined when nothing resolves", async () => {
    const result = await resolveClientCredential({
      envName: "prod",
      clientId: "no-secret-for-this",
      automationClientId: "cm-id",
      organizationId: "org-1",
      orgClientId: "org-id",
    });

    expect(result).toBeUndefined();
  });
});
