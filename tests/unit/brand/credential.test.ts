import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { resolveBrandOrgId, resolveBrandClient } from "../../../src/brand/credential";
import { ScaiError } from "../../../src/shared/errors";

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
