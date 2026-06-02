import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Branch-coverage sweep for `runDoctor`. The runner is driven against
 * a temp dir with mocked keychain helpers and a mocked
 * readRootConfigurationFile so each per-check branch can be exercised
 * independently of the strict on-disk JSON schema (which rejects the
 * literal "type" field doctor's required-fields check looks for).
 *
 * Branches covered:
 *  - checkRuntime — exercised via the happy-path (Node 20+)
 *  - checkConfigFile — missing file, throw-on-read, ok
 *  - checkConfigSchema — ok, warn (validation issues), skip (parse error)
 *  - checkDefaultEnv — zero envs, one env no default, multi no default, default ok
 *  - checkEnvProfile — required-fields ok / missing, token present/absent,
 *    TTL expired / in-grace / healthy, keychain throws
 *  - checkBrandKeychain — no brand block, clientId missing, secret missing,
 *    secret present, keychain throws
 *  - summarize / table formatter / --strict / --json branches
 */

const keychainMocks = vi.hoisted(() => ({
  getDeployToken: vi.fn(),
  getBrandClientSecret: vi.fn(),
}));
const configMocks = vi.hoisted(() => ({
  readRootConfigurationFile: vi.fn(),
}));
const validationMocks = vi.hoisted(() => ({
  validateRootConfig: vi.fn(() => true) as ((value: unknown) => boolean) & {
    errors?: unknown[];
  },
  formatValidationErrors: vi.fn(() => []),
}));

vi.mock("../../../src/shared/keychain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/shared/keychain")>();
  return { ...actual, ...keychainMocks };
});
vi.mock("../../../src/config/root-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/config/root-config")>();
  return { ...actual, ...configMocks };
});
vi.mock("../../../src/config/validation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/config/validation")>();
  return { ...actual, ...validationMocks };
});

import { runDoctor } from "../../../src/doctor/run";

let tmpRoot: string;

const writeConfigFile = async (body: string = "{}"): Promise<string> => {
  const file = path.join(tmpRoot, "sitecoreai.cli.json");
  await fs.writeFile(file, body);
  return file;
};

const stubConfigFile = (config: Record<string, unknown>) => {
  configMocks.readRootConfigurationFile.mockReturnValue({
    rootPath: path.join(tmpRoot, "sitecoreai.cli.json"),
    rootDir: tmpRoot,
    config,
  });
};

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "scai-doctor-branch-"));
  keychainMocks.getDeployToken.mockReset().mockResolvedValue("tok");
  keychainMocks.getBrandClientSecret.mockReset().mockResolvedValue("sec");
  configMocks.readRootConfigurationFile.mockReset();
  validationMocks.validateRootConfig.mockReset();
  Object.defineProperty(validationMocks.validateRootConfig, "errors", {
    value: undefined,
    writable: true,
    configurable: true,
  });
  validationMocks.validateRootConfig.mockImplementation(() => true);
  validationMocks.formatValidationErrors.mockReset().mockReturnValue([]);
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("runDoctor — config-file branches", () => {
  it("emits a config-file fail row when the file is missing (no JSON parse attempted)", async () => {
    // No file written, no mock — readRootConfigurationFile not invoked.
    await expect(runDoctor({ config: tmpRoot, quiet: true })).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("emits a config-file fail row when readRootConfigurationFile throws", async () => {
    await writeConfigFile("{}");
    configMocks.readRootConfigurationFile.mockImplementation(() => {
      throw new Error("schema validation failed: extra field 'foo'");
    });
    await expect(runDoctor({ config: tmpRoot, quiet: true })).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("config-file ok when the file is present and reads cleanly", async () => {
    await writeConfigFile(JSON.stringify({ envProfiles: { dev: { organizationId: "o" } } }));
    stubConfigFile({ envProfiles: { dev: { organizationId: "o", type: "Sandbox" } } });
    await expect(runDoctor({ config: tmpRoot, quiet: true })).resolves.toBeDefined();
  });
});

describe("runDoctor — config-schema branches", () => {
  it("warn when validateRootConfig returns false (schema reports issues)", async () => {
    await writeConfigFile(JSON.stringify({ envProfiles: { dev: { organizationId: "o" } } }));
    stubConfigFile({
      defaultEnvProfile: "dev",
      envProfiles: { dev: { organizationId: "o", type: "Sandbox" } },
    });
    validationMocks.validateRootConfig.mockImplementation(() => false);
    Object.defineProperty(validationMocks.validateRootConfig, "errors", {
      value: [{ instancePath: "/envProfiles", message: "extra field" }],
      writable: true,
      configurable: true,
    });
    validationMocks.formatValidationErrors.mockReturnValue(["/envProfiles: extra field"]);
    const result = await runDoctor({ config: tmpRoot, quiet: true });
    const schema = result.checks.find((c) => c.name === "config-schema");
    expect(schema?.status).toBe("warn");
    expect(schema?.message).toMatch(/1 issue/);
  });

  it("skip when the config-schema check can't parse the file (catch arm)", async () => {
    await writeConfigFile("{not parseable");
    stubConfigFile({
      defaultEnvProfile: "dev",
      envProfiles: { dev: { organizationId: "o", type: "Sandbox" } },
    });
    const result = await runDoctor({ config: tmpRoot, quiet: true });
    const schema = result.checks.find((c) => c.name === "config-schema");
    expect(schema?.status).toBe("skip");
  });
});

describe("runDoctor — default-env branches", () => {
  beforeEach(async () => {
    await writeConfigFile("{}");
  });

  it("fail when no env profiles are configured", async () => {
    stubConfigFile({ envProfiles: {} });
    await expect(runDoctor({ config: tmpRoot, quiet: true })).rejects.toBeDefined();
  });

  it("warn when one env exists but no defaultEnvProfile", async () => {
    stubConfigFile({
      envProfiles: { sandbox: { organizationId: "o", type: "Sandbox" } },
    });
    const result = await runDoctor({ config: tmpRoot, quiet: true });
    const defaultEnv = result.checks.find((c) => c.name === "default-env");
    expect(defaultEnv?.status).toBe("warn");
    expect(defaultEnv?.message).toMatch(/One env profile/);
  });

  it("warn when multi-env but no default", async () => {
    stubConfigFile({
      envProfiles: {
        sandbox: { organizationId: "o", type: "Sandbox" },
        prod: { organizationId: "o", type: "Production" },
      },
    });
    const result = await runDoctor({ config: tmpRoot, quiet: true });
    const defaultEnv = result.checks.find((c) => c.name === "default-env");
    expect(defaultEnv?.status).toBe("warn");
    expect(defaultEnv?.message).toMatch(/2 env profiles/);
  });

  it("ok when defaultEnvProfile resolves to a configured profile", async () => {
    stubConfigFile({
      defaultEnvProfile: "sandbox",
      envProfiles: { sandbox: { organizationId: "o", type: "Sandbox" } },
    });
    const result = await runDoctor({ config: tmpRoot, quiet: true });
    expect(result.checks.find((c) => c.name === "default-env")?.status).toBe("ok");
  });
});

describe("runDoctor — env profile branches", () => {
  beforeEach(async () => {
    await writeConfigFile("{}");
  });

  it("fail when env profile is missing required fields", async () => {
    stubConfigFile({
      defaultEnvProfile: "sandbox",
      envProfiles: { sandbox: { host: "https://example/" } },
    });
    await expect(runDoctor({ config: tmpRoot, quiet: true })).rejects.toBeDefined();
  });

  it("fail when deploy token is missing from keychain", async () => {
    keychainMocks.getDeployToken.mockResolvedValue(null);
    stubConfigFile({
      defaultEnvProfile: "sandbox",
      envProfiles: { sandbox: { organizationId: "o", type: "Sandbox" } },
    });
    await expect(runDoctor({ config: tmpRoot, quiet: true })).rejects.toBeDefined();
  });

  it("ok env profile with token + no TTL block emits no deploy-token-ttl row", async () => {
    stubConfigFile({
      defaultEnvProfile: "sandbox",
      envProfiles: { sandbox: { organizationId: "o", type: "Sandbox" } },
    });
    const result = await runDoctor({ config: tmpRoot, quiet: true });
    expect(result.checks.find((c) => c.name === "deploy-token")?.status).toBe("ok");
    expect(result.checks.find((c) => c.name === "deploy-token-ttl")).toBeUndefined();
  });

  it("warn on expired deploy token TTL", async () => {
    stubConfigFile({
      defaultEnvProfile: "sandbox",
      envProfiles: {
        sandbox: {
          organizationId: "o",
          type: "Sandbox",
          deployTokenLastUpdated: new Date(Date.now() - 7200_000).toISOString(),
          deployTokenExpiresIn: 3600,
        },
      },
    });
    const result = await runDoctor({ config: tmpRoot, quiet: true });
    const ttl = result.checks.find((c) => c.name === "deploy-token-ttl");
    expect(ttl?.status).toBe("warn");
    expect(ttl?.message).toMatch(/expired/);
  });

  it("warn on deploy token TTL within the 5-minute refresh threshold", async () => {
    stubConfigFile({
      defaultEnvProfile: "sandbox",
      envProfiles: {
        sandbox: {
          organizationId: "o",
          type: "Sandbox",
          deployTokenLastUpdated: new Date(Date.now() - 3500_000).toISOString(),
          deployTokenExpiresIn: 3600,
        },
      },
    });
    const result = await runDoctor({ config: tmpRoot, quiet: true });
    const ttl = result.checks.find((c) => c.name === "deploy-token-ttl");
    expect(ttl?.status).toBe("warn");
    expect(ttl?.message).toMatch(/expires in/);
  });

  it("ok on deploy token TTL well beyond the refresh threshold", async () => {
    stubConfigFile({
      defaultEnvProfile: "sandbox",
      envProfiles: {
        sandbox: {
          organizationId: "o",
          type: "Sandbox",
          deployTokenLastUpdated: new Date(Date.now() - 600_000).toISOString(),
          deployTokenExpiresIn: 3600,
        },
      },
    });
    const result = await runDoctor({ config: tmpRoot, quiet: true });
    const ttl = result.checks.find((c) => c.name === "deploy-token-ttl");
    expect(ttl?.status).toBe("ok");
  });

  it("warn when keychain probe throws (catch arm)", async () => {
    keychainMocks.getDeployToken.mockRejectedValue(new Error("keychain locked"));
    stubConfigFile({
      defaultEnvProfile: "sandbox",
      envProfiles: { sandbox: { organizationId: "o", type: "Sandbox" } },
    });
    const result = await runDoctor({ config: tmpRoot, quiet: true });
    const token = result.checks.find((c) => c.name === "deploy-token");
    expect(token?.status).toBe("warn");
    expect(token?.message).toMatch(/keychain locked/);
  });
});

describe("runDoctor — brand keychain branches", () => {
  beforeEach(async () => {
    await writeConfigFile("{}");
  });

  it("ok when brand credential has clientId + secret resolves", async () => {
    stubConfigFile({
      defaultEnvProfile: "sandbox",
      envProfiles: { sandbox: { organizationId: "o", type: "Sandbox" } },
      brand: { "org-1": { clientId: "client-x" } },
    });
    const result = await runDoctor({ config: tmpRoot, quiet: true });
    const brand = result.checks.find((c) => c.category === "brand:org-1");
    expect(brand?.status).toBe("ok");
  });

  it("fail when brand entry has no clientId", async () => {
    stubConfigFile({
      defaultEnvProfile: "sandbox",
      envProfiles: { sandbox: { organizationId: "o", type: "Sandbox" } },
      brand: { "org-1": {} },
    });
    await expect(runDoctor({ config: tmpRoot, quiet: true })).rejects.toBeDefined();
  });

  it("fail when clientId is set but the keychain secret is missing", async () => {
    keychainMocks.getBrandClientSecret.mockResolvedValue(null);
    stubConfigFile({
      defaultEnvProfile: "sandbox",
      envProfiles: { sandbox: { organizationId: "o", type: "Sandbox" } },
      brand: { "org-1": { clientId: "client-x" } },
    });
    await expect(runDoctor({ config: tmpRoot, quiet: true })).rejects.toBeDefined();
  });

  it("warn when the brand keychain probe throws", async () => {
    keychainMocks.getBrandClientSecret.mockRejectedValue(new Error("locked"));
    stubConfigFile({
      defaultEnvProfile: "sandbox",
      envProfiles: { sandbox: { organizationId: "o", type: "Sandbox" } },
      brand: { "org-1": { clientId: "client-x" } },
    });
    const result = await runDoctor({ config: tmpRoot, quiet: true });
    const brand = result.checks.find((c) => c.category === "brand:org-1");
    expect(brand?.status).toBe("warn");
  });

  it("emits no brand rows when the config has no brand block", async () => {
    stubConfigFile({
      defaultEnvProfile: "sandbox",
      envProfiles: { sandbox: { organizationId: "o", type: "Sandbox" } },
    });
    const result = await runDoctor({ config: tmpRoot, quiet: true });
    expect(result.checks.find((c) => c.category.startsWith("brand:"))).toBeUndefined();
  });
});

describe("runDoctor — output + strict branches", () => {
  beforeEach(async () => {
    await writeConfigFile("{}");
  });

  it("writes a JSON envelope on --json (success path)", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stubConfigFile({
      defaultEnvProfile: "sandbox",
      envProfiles: { sandbox: { organizationId: "o", type: "Sandbox" } },
    });
    await runDoctor({ config: tmpRoot, json: true });
    const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain('"command": "doctor"');
    expect(written).toContain('"summary"');
  });

  it("--strict turns a warn-only run into a throw", async () => {
    stubConfigFile({
      // No defaultEnvProfile → warn on default-env. No fails.
      envProfiles: { sandbox: { organizationId: "o", type: "Sandbox" } },
    });
    await expect(runDoctor({ config: tmpRoot, strict: true, quiet: true })).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });
});
