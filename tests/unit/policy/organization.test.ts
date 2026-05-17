import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveOrganization } from "../../../src/policy/organization";
import { ScaiError } from "../../../src/shared/errors";

/**
 * `resolveOrganization` resolution-order coverage. Each case writes a
 * throwaway `sitecoreai.cli.json` into a temp dir and resolves against
 * it — no env vars, no keychain, no network.
 */

let configRoot: string;

const writeConfig = (config: unknown): void => {
  fs.writeFileSync(path.join(configRoot, "sitecoreai.cli.json"), JSON.stringify(config, null, 2));
};

beforeEach(() => {
  configRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scai-org-"));
});

afterEach(() => {
  fs.rmSync(configRoot, { recursive: true, force: true });
});

describe("resolveOrganization", () => {
  it("resolves the sole env profile's org with no flag and no default", () => {
    // The reported bug: `scai ops brief list` against a single-env config
    // must not demand --environment-name.
    writeConfig({ envProfiles: { RegistryCM: { organizationId: "org_one" } } });
    const result = resolveOrganization({ config: configRoot });
    expect(result.orgId).toBe("org_one");
    expect(result.envName).toBe("RegistryCM");
    expect(result.environment?.organizationId).toBe("org_one");
  });

  it("returns the explicit --org-id verbatim, ahead of every env profile", () => {
    writeConfig({ envProfiles: { RegistryCM: { organizationId: "org_env" } } });
    expect(resolveOrganization({ config: configRoot, orgId: "org_explicit" }).orgId).toBe(
      "org_explicit"
    );
  });

  it("uses the named env profile's organizationId", () => {
    writeConfig({
      envProfiles: { a: { organizationId: "org_a" }, b: { organizationId: "org_b" } },
    });
    const result = resolveOrganization({ config: configRoot, environmentName: "b" });
    expect(result.orgId).toBe("org_b");
    expect(result.envName).toBe("b");
  });

  it("falls back to the first env profile that carries an organizationId", () => {
    writeConfig({
      envProfiles: { incomplete: {}, real: { organizationId: "org_real" } },
    });
    expect(resolveOrganization({ config: configRoot }).orgId).toBe("org_real");
  });

  it("resolves the sole brand credential entry when no env profile carries an org", () => {
    writeConfig({
      envProfiles: { incomplete: {} },
      brand: { org_brand: { clientId: "c", audience: "a", authority: "https://auth" } },
    });
    const result = resolveOrganization({ config: configRoot });
    expect(result.orgId).toBe("org_brand");
    expect(result.environment).toBeUndefined();
  });

  it("throws INPUT_INVALID when no organization can be resolved", () => {
    writeConfig({ envProfiles: { incomplete: {} } });
    try {
      resolveOrganization({ config: configRoot });
      throw new Error("expected resolveOrganization to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ScaiError);
      expect((error as ScaiError).code).toBe("INPUT_INVALID");
      expect((error as ScaiError).hint).toContain("--org-id");
    }
  });

  it("throws ENV_NOT_FOUND when an explicitly named env profile does not exist", () => {
    writeConfig({ envProfiles: { real: { organizationId: "org_real" } } });
    try {
      resolveOrganization({ config: configRoot, environmentName: "ghost" });
      throw new Error("expected resolveOrganization to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ScaiError);
      expect((error as ScaiError).code).toBe("ENV_NOT_FOUND");
    }
  });

  it("throws INPUT_INVALID when the named env profile has no organizationId", () => {
    writeConfig({ envProfiles: { real: {} } });
    try {
      resolveOrganization({ config: configRoot, environmentName: "real" });
      throw new Error("expected resolveOrganization to throw");
    } catch (error) {
      expect((error as ScaiError).code).toBe("INPUT_INVALID");
    }
  });
});
