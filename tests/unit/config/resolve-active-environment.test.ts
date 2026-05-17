import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { resolveActiveEnvironment } from "../../../src/config/root-config";
import type { ScaiError } from "../../../src/shared/errors";

/**
 * `resolveActiveEnvironment` picks the environment profile a `setup`
 * command acts on. The contract under test: explicit name → configured
 * `defaultEnvProfile` → the sole profile when exactly one exists. The
 * sole-profile fallback is what lets a single-environment config work
 * without anyone designating a default — declining "set as default"
 * during `setup init` must not strand the only environment.
 */

let tmpRoot: string;

/** Write a `sitecoreai.cli.json` into the temp dir and return the dir. */
const writeConfig = async (config: Record<string, unknown>): Promise<string> => {
  await fs.writeFile(
    path.join(tmpRoot, "sitecoreai.cli.json"),
    JSON.stringify({ modules: [], ...config }, null, 2),
    "utf8"
  );
  return tmpRoot;
};

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "scai-resolve-env-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("resolveActiveEnvironment", () => {
  it("uses the explicitly named environment", async () => {
    const dir = await writeConfig({
      envProfiles: { prod: { organizationId: "org_p" }, dev: { organizationId: "org_d" } },
      defaultEnvProfile: "dev",
    });
    const resolved = resolveActiveEnvironment(dir, "prod");
    expect(resolved.envName).toBe("prod");
    expect(resolved.env.organizationId).toBe("org_p");
  });

  it("falls back to defaultEnvProfile when no name is given", async () => {
    const dir = await writeConfig({
      envProfiles: { prod: { organizationId: "org_p" }, dev: { organizationId: "org_d" } },
      defaultEnvProfile: "dev",
    });
    const resolved = resolveActiveEnvironment(dir, undefined);
    expect(resolved.envName).toBe("dev");
    expect(resolved.env.organizationId).toBe("org_d");
  });

  it("falls back to the sole profile when there is no default", async () => {
    const dir = await writeConfig({
      envProfiles: { only: { organizationId: "org_only" } },
    });
    const resolved = resolveActiveEnvironment(dir, undefined);
    expect(resolved.envName).toBe("only");
    expect(resolved.env.organizationId).toBe("org_only");
  });

  it("throws INPUT_INVALID when several profiles exist with no default", async () => {
    const dir = await writeConfig({
      envProfiles: { prod: { organizationId: "org_p" }, dev: { organizationId: "org_d" } },
    });
    try {
      resolveActiveEnvironment(dir, undefined);
      throw new Error("expected resolveActiveEnvironment to throw");
    } catch (error) {
      const scai = error as ScaiError;
      expect(scai.code).toBe("INPUT_INVALID");
      // The hint names the candidates so the operator can pick one.
      expect(scai.hint).toContain("prod");
      expect(scai.hint).toContain("dev");
    }
  });

  it("throws INPUT_INVALID when no environment is configured", async () => {
    const dir = await writeConfig({ envProfiles: {} });
    try {
      resolveActiveEnvironment(dir, undefined);
      throw new Error("expected resolveActiveEnvironment to throw");
    } catch (error) {
      expect((error as ScaiError).code).toBe("INPUT_INVALID");
    }
  });

  it("throws ENV_NOT_FOUND when the named environment does not exist", async () => {
    const dir = await writeConfig({
      envProfiles: { prod: { organizationId: "org_p" } },
    });
    try {
      resolveActiveEnvironment(dir, "staging");
      throw new Error("expected resolveActiveEnvironment to throw");
    } catch (error) {
      expect((error as ScaiError).code).toBe("ENV_NOT_FOUND");
    }
  });

  it("prefers an explicit name over the configured default", async () => {
    const dir = await writeConfig({
      envProfiles: { prod: { organizationId: "org_p" }, dev: { organizationId: "org_d" } },
      defaultEnvProfile: "dev",
    });
    expect(resolveActiveEnvironment(dir, "prod").envName).toBe("prod");
  });
});
