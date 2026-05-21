import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Covers the three-gate aggregation in `checkAccess`: ready, plus each
 * gate's blocked path (config absent / unreadable, policy not enrolled,
 * identity drift, no credentials). The config reader, policy resolver,
 * credential matrix, and identity helpers are mocked — this test owns
 * only the gate composition and the hoisted `nextStep`.
 */
const mocks = vi.hoisted(() => ({
  readRootConfiguration: vi.fn(),
  resolveEffectivePolicy: vi.fn(),
  resolveCredentialMatrix: vi.fn(),
  describeIdentityDrift: vi.fn(),
  extractIdentity: vi.fn(),
}));

vi.mock("../../../src/config/root-config", () => ({
  readRootConfiguration: mocks.readRootConfiguration,
}));
vi.mock("../../../src/policy/resolve", () => ({
  resolveEffectivePolicy: mocks.resolveEffectivePolicy,
}));
vi.mock("../../../src/shared/credential-matrix", () => ({
  resolveCredentialMatrix: mocks.resolveCredentialMatrix,
}));
vi.mock("../../../src/policy/identity", () => ({
  describeIdentityDrift: mocks.describeIdentityDrift,
  extractIdentity: mocks.extractIdentity,
}));

const { checkAccess } = await import("../../../src/policy/access-check");

const ENV = { organizationId: "org-1", projectId: "p-1", environmentId: "e-1" };

const rootWith = (
  envName: string,
  env: Record<string, unknown> | undefined
): Record<string, unknown> => ({
  environments: env ? { [envName]: env } : {},
  brand: {},
  orgClients: {},
  physicalPath: "/proj/sitecoreai.cli.json",
});

const unmanaged = {
  managed: false,
  enrolled: false,
  ceiling: "read",
  identity: null,
  mintCredentials: false,
  ciWrites: false,
  stepUpMinutes: undefined,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readRootConfiguration.mockReturnValue(rootWith("demo", { ...ENV }));
  mocks.resolveEffectivePolicy.mockReturnValue(unmanaged);
  mocks.resolveCredentialMatrix.mockResolvedValue({
    envClient: true,
    orgClient: false,
    brand: false,
  });
  mocks.describeIdentityDrift.mockReturnValue([]);
  mocks.extractIdentity.mockReturnValue({});
});

describe("checkAccess", () => {
  it("reports ready when config, policy, and credentials all pass", async () => {
    // Brand key present so the org-scoped brand-credentials probe stays
    // out of the gate list; this test owns the all-green path.
    mocks.resolveCredentialMatrix.mockResolvedValue({
      envClient: true,
      orgClient: false,
      brand: true,
    });
    const report = await checkAccess({ configPath: "/proj", environmentName: "demo" });
    expect(report.ready).toBe(true);
    expect(report.gates.map((gate) => gate.status)).toEqual(["ok", "ok", "ok"]);
    expect(report.nextStep).toBeUndefined();
    expect(report.humanOnlyOperations.length).toBeGreaterThan(0);
  });

  it("warns (non-blocking) when the brand / AI APIs key is missing for the env's org", async () => {
    mocks.resolveCredentialMatrix.mockResolvedValue({
      envClient: true,
      orgClient: false,
      brand: false,
    });
    const report = await checkAccess({ configPath: "/proj", environmentName: "demo" });
    expect(report.ready).toBe(true);
    const credentialGates = report.gates.filter((gate) => gate.id === "credentials");
    expect(credentialGates).toHaveLength(2);
    expect(credentialGates[0].status).toBe("ok");
    expect(credentialGates[1].status).toBe("warn");
    expect(credentialGates[1].summary).toMatch(/brand/i);
    expect(credentialGates[1].remediation?.fix).toContain("register-brand");
  });

  it("blocks the config gate when the environment is not configured", async () => {
    mocks.readRootConfiguration.mockReturnValue(rootWith("demo", undefined));
    const report = await checkAccess({ configPath: "/proj", environmentName: "demo" });
    expect(report.ready).toBe(false);
    expect(report.gates.find((gate) => gate.id === "config")?.status).toBe("blocked");
    expect(report.nextStep?.actor).toBe("agent");
    expect(report.nextStep?.fix).toContain("setup init");
  });

  it("blocks the config gate when the config cannot be read", async () => {
    mocks.readRootConfiguration.mockImplementation(() => {
      throw new Error("no config file");
    });
    const report = await checkAccess({ configPath: "/proj", environmentName: "demo" });
    expect(report.gates.find((gate) => gate.id === "config")?.status).toBe("blocked");
    expect(report.ready).toBe(false);
  });

  it("blocks the policy gate when the environment is not enrolled", async () => {
    mocks.resolveEffectivePolicy.mockReturnValue({ ...unmanaged, managed: true });
    const report = await checkAccess({ configPath: "/proj", environmentName: "demo" });
    const policy = report.gates.find((gate) => gate.id === "policy");
    expect(policy?.status).toBe("blocked");
    expect(policy?.remediation?.fix).toBe("scai policy allow demo");
    expect(report.ready).toBe(false);
  });

  it("blocks the policy gate on tenant-identity drift", async () => {
    mocks.resolveEffectivePolicy.mockReturnValue({
      ...unmanaged,
      managed: true,
      enrolled: true,
      identity: { organizationId: "x" },
    });
    mocks.describeIdentityDrift.mockReturnValue(["organizationId changed"]);
    const report = await checkAccess({ configPath: "/proj", environmentName: "demo" });
    const policy = report.gates.find((gate) => gate.id === "policy");
    expect(policy?.status).toBe("blocked");
    expect(policy?.remediation?.fix).toBe("scai policy trust demo");
  });

  it("blocks the credentials gate with a needs-human-terminal remediation", async () => {
    mocks.resolveCredentialMatrix.mockResolvedValue({
      envClient: false,
      orgClient: false,
      brand: false,
    });
    const report = await checkAccess({ configPath: "/proj", environmentName: "demo" });
    const creds = report.gates.find((gate) => gate.id === "credentials");
    expect(creds?.status).toBe("blocked");
    expect(creds?.remediation?.actor).toBe("needs-human-terminal");
    expect(report.ready).toBe(false);
  });
});
