import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  resolveBrandOrgId,
  resolveBrandClient,
  resolveBrandSecrets,
} from "../../../src/brand/credential";
import { ScaiError } from "../../../src/shared/errors";

vi.mock("../../../src/shared/keychain", () => ({
  getBrandClientSecret: vi.fn(),
}));
import { getBrandClientSecret } from "../../../src/shared/keychain";

describe("brand/credential — resolveBrandOrgId", () => {
  it("returns the explicit orgId when provided (highest precedence)", () => {
    const envs = { sandbox: { organizationId: "org_from_env" } };
    expect(resolveBrandOrgId("org_explicit", envs, "sandbox")).toBe("org_explicit");
  });

  it("does not consult env profiles when an explicit orgId is provided", () => {
    expect(resolveBrandOrgId("org_explicit", {}, undefined)).toBe("org_explicit");
  });

  it("uses the named env profile's organizationId", () => {
    const envs = { sandbox: { organizationId: "org_from_env" }, prod: { organizationId: "org_p" } };
    expect(resolveBrandOrgId(undefined, envs, "sandbox")).toBe("org_from_env");
  });

  it("throws INPUT_INVALID when the named env profile has no organizationId", () => {
    try {
      resolveBrandOrgId(undefined, { sandbox: {} }, "sandbox");
      throw new Error("expected resolveBrandOrgId to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ScaiError);
      expect((error as ScaiError).code).toBe("INPUT_INVALID");
      expect((error as ScaiError).message).toContain("sandbox");
      expect((error as ScaiError).hint).toContain("--org-id");
    }
  });

  it("throws INPUT_INVALID when the named env profile does not exist", () => {
    try {
      resolveBrandOrgId(undefined, { other: { organizationId: "org_x" } }, "sandbox");
      throw new Error("expected resolveBrandOrgId to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ScaiError);
      expect((error as ScaiError).code).toBe("INPUT_INVALID");
      expect((error as ScaiError).message).toContain("sandbox");
    }
  });

  it("falls back to the first env profile with an organizationId when no env is named", () => {
    const envs = { sandbox: { organizationId: "org_first" }, prod: { organizationId: "org_p" } };
    expect(resolveBrandOrgId(undefined, envs, undefined)).toBe("org_first");
  });

  it("skips env profiles without an organizationId when scanning", () => {
    const envs = { incomplete: {}, sandbox: { organizationId: "org_real" } };
    expect(resolveBrandOrgId(undefined, envs, undefined)).toBe("org_real");
  });

  it("throws INPUT_INVALID without an env clause when nothing resolves", () => {
    try {
      resolveBrandOrgId(undefined, { incomplete: {} }, undefined);
      throw new Error("expected resolveBrandOrgId to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ScaiError);
      expect((error as ScaiError).code).toBe("INPUT_INVALID");
      // No env clause when no env was named.
      expect((error as ScaiError).message).not.toContain("env '");
      expect((error as ScaiError).hint).toContain("--org-id");
    }
  });
});

describe("brand/credential — resolveBrandClient", () => {
  let tmpRoot: string;

  const writeConfig = async (config: Record<string, unknown>): Promise<string> => {
    await fs.writeFile(
      path.join(tmpRoot, "sitecoreai.cli.json"),
      JSON.stringify({ modules: [], ...config }, null, 2),
      "utf8"
    );
    return tmpRoot;
  };

  const CREDENTIAL = {
    clientId: "cid",
    audience: "https://api.sitecorecloud.io",
    authority: "https://auth.sitecorecloud.io",
  };

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "scai-brand-cred-"));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("resolves the org from the sole env profile and returns its credential", async () => {
    const dir = await writeConfig({
      envProfiles: { only: { organizationId: "org_only" } },
      brand: { org_only: CREDENTIAL },
    });
    const client = resolveBrandClient({ config: dir });
    expect(client.orgId).toBe("org_only");
    expect(client.credential.clientId).toBe("cid");
  });

  it("honors an explicit --org-id over the env profile", async () => {
    const dir = await writeConfig({
      envProfiles: { only: { organizationId: "org_env" } },
      brand: { org_explicit: CREDENTIAL },
    });
    expect(resolveBrandClient({ config: dir, orgId: "org_explicit" }).orgId).toBe("org_explicit");
  });

  it("throws AUTH_BRAND_REQUIRED when the org has no registered credential", async () => {
    const dir = await writeConfig({
      envProfiles: { only: { organizationId: "org_only" } },
      brand: {},
    });
    try {
      resolveBrandClient({ config: dir });
      throw new Error("expected resolveBrandClient to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ScaiError);
      expect((error as ScaiError).code).toBe("AUTH_BRAND_REQUIRED");
    }
  });

  it("throws INPUT_INVALID when no org can be resolved at all", async () => {
    const dir = await writeConfig({ envProfiles: { only: {} }, brand: {} });
    try {
      resolveBrandClient({ config: dir });
      throw new Error("expected resolveBrandClient to throw");
    } catch (error) {
      expect((error as ScaiError).code).toBe("INPUT_INVALID");
    }
  });
});

/**
 * `resolveBrandSecrets` — env-var (serverless) vs config+keychain
 * precedence. The env-var tier is the orchestrator's path: a Vercel
 * function has no OS keychain, so it sets `SITECOREAI_BRAND_*` right
 * before invoking scai. Verifying both tiers in isolation and the
 * malformed-partial-env state.
 */
describe("brand/credential — resolveBrandSecrets", () => {
  const BRAND_ENV_KEYS = [
    "SITECOREAI_BRAND_CLIENT_ID",
    "SITECOREAI_BRAND_CLIENT_SECRET",
    "SITECOREAI_BRAND_AUTHORITY",
    "SITECOREAI_BRAND_AUDIENCE",
  ] as const;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of BRAND_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    vi.mocked(getBrandClientSecret).mockReset();
  });

  afterEach(() => {
    for (const key of BRAND_ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it("returns env-tier secrets when both id+secret env vars are set", async () => {
    process.env.SITECOREAI_BRAND_CLIENT_ID = "env-cid";
    process.env.SITECOREAI_BRAND_CLIENT_SECRET = "env-secret";

    const result = await resolveBrandSecrets({ orgId: "org_x" });
    expect(result).toEqual({
      clientId: "env-cid",
      clientSecret: "env-secret",
      authority: "https://auth.sitecorecloud.io",
      audience: "https://api.sitecorecloud.io",
      source: "env",
    });
    expect(getBrandClientSecret).not.toHaveBeenCalled();
  });

  it("env tier wins over config+keychain when both are present", async () => {
    process.env.SITECOREAI_BRAND_CLIENT_ID = "env-cid";
    process.env.SITECOREAI_BRAND_CLIENT_SECRET = "env-secret";
    vi.mocked(getBrandClientSecret).mockResolvedValue("keychain-secret");

    const result = await resolveBrandSecrets({
      orgId: "org_x",
      credential: { clientId: "config-cid" },
    });
    expect(result?.source).toBe("env");
    expect(result?.clientId).toBe("env-cid");
    expect(result?.clientSecret).toBe("env-secret");
    // The keychain MUST NOT be consulted when the env tier resolves —
    // serverless callers may not even have a keychain available, and
    // a stray call would log a "keychain unavailable" warning.
    expect(getBrandClientSecret).not.toHaveBeenCalled();
  });

  it("honors authority/audience env-var overrides on top of env-tier secrets", async () => {
    process.env.SITECOREAI_BRAND_CLIENT_ID = "env-cid";
    process.env.SITECOREAI_BRAND_CLIENT_SECRET = "env-secret";
    process.env.SITECOREAI_BRAND_AUTHORITY = "https://auth.staging.test";
    process.env.SITECOREAI_BRAND_AUDIENCE = "https://api.staging.test";

    const result = await resolveBrandSecrets({ orgId: "org_x" });
    expect(result?.authority).toBe("https://auth.staging.test");
    expect(result?.audience).toBe("https://api.staging.test");
  });

  it("env-var authority/audience override the config values on the keychain tier too", async () => {
    process.env.SITECOREAI_BRAND_AUTHORITY = "https://auth.staging.test";
    process.env.SITECOREAI_BRAND_AUDIENCE = "https://api.staging.test";
    vi.mocked(getBrandClientSecret).mockResolvedValue("keychain-secret");

    const result = await resolveBrandSecrets({
      orgId: "org_x",
      credential: {
        clientId: "config-cid",
        authority: "https://auth.prod.test",
        audience: "https://api.prod.test",
      },
    });
    expect(result?.source).toBe("keychain");
    expect(result?.authority).toBe("https://auth.staging.test");
    expect(result?.audience).toBe("https://api.staging.test");
  });

  it("throws AUTH_BRAND_REQUIRED when only the env clientId is set (partial-env)", async () => {
    process.env.SITECOREAI_BRAND_CLIENT_ID = "env-cid";

    await expect(resolveBrandSecrets({ orgId: "org_x" })).rejects.toMatchObject({
      code: "AUTH_BRAND_REQUIRED",
    });
    expect(getBrandClientSecret).not.toHaveBeenCalled();
  });

  it("throws AUTH_BRAND_REQUIRED when only the env clientSecret is set (partial-env)", async () => {
    process.env.SITECOREAI_BRAND_CLIENT_SECRET = "env-secret";

    await expect(resolveBrandSecrets({ orgId: "org_x" })).rejects.toMatchObject({
      code: "AUTH_BRAND_REQUIRED",
    });
  });

  it("partial-env error message names the missing var so operators know which one to set", async () => {
    process.env.SITECOREAI_BRAND_CLIENT_ID = "env-cid";

    try {
      await resolveBrandSecrets({ orgId: "org_x" });
      throw new Error("expected resolveBrandSecrets to throw");
    } catch (error) {
      expect((error as ScaiError).message).toContain("SITECOREAI_BRAND_CLIENT_SECRET");
    }
  });

  it("ignores whitespace-only env-var values (treats them as unset)", async () => {
    process.env.SITECOREAI_BRAND_CLIENT_ID = "   ";
    process.env.SITECOREAI_BRAND_CLIENT_SECRET = "   ";
    vi.mocked(getBrandClientSecret).mockResolvedValue("keychain-secret");

    const result = await resolveBrandSecrets({
      orgId: "org_x",
      credential: { clientId: "config-cid" },
    });
    expect(result?.source).toBe("keychain");
  });

  it("falls back to config+keychain when no env vars are set", async () => {
    vi.mocked(getBrandClientSecret).mockResolvedValue("keychain-secret");

    const result = await resolveBrandSecrets({
      orgId: "org_x",
      credential: {
        clientId: "config-cid",
        authority: "https://auth.x",
        audience: "https://api.x",
      },
    });
    expect(result).toEqual({
      clientId: "config-cid",
      clientSecret: "keychain-secret",
      authority: "https://auth.x",
      audience: "https://api.x",
      source: "keychain",
    });
    expect(getBrandClientSecret).toHaveBeenCalledWith("org_x");
  });

  it("uses default authority/audience when the config omits them", async () => {
    vi.mocked(getBrandClientSecret).mockResolvedValue("keychain-secret");

    const result = await resolveBrandSecrets({
      orgId: "org_x",
      credential: { clientId: "config-cid" },
    });
    expect(result?.authority).toBe("https://auth.sitecorecloud.io");
    expect(result?.audience).toBe("https://api.sitecorecloud.io");
  });

  it("returns undefined when neither env nor config has a clientId", async () => {
    const result = await resolveBrandSecrets({ orgId: "org_x" });
    expect(result).toBeUndefined();
    expect(getBrandClientSecret).not.toHaveBeenCalled();
  });

  it("returns undefined when the config has a clientId but the keychain has no secret", async () => {
    vi.mocked(getBrandClientSecret).mockResolvedValue(undefined);

    const result = await resolveBrandSecrets({
      orgId: "org_x",
      credential: { clientId: "config-cid" },
    });
    expect(result).toBeUndefined();
  });
});
