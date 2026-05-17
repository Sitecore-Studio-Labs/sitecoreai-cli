import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `scai policy …` command wiring. The `@/policy` store/enroll primitives
 * and the root-config readers are mocked; tests parse the commander
 * command tree and assert env-profile resolution, the JSON vs human
 * output fork, the write-failure error path, and the `set` flag coercion
 * (ceiling / ci-writes / mint / step-up).
 */

const policyMocks = vi.hoisted(() => ({
  enrollEnvironment: vi.fn(),
  readRepoPolicy: vi.fn(),
  readWorkspacePolicy: vi.fn(),
  repinEnvironment: vi.fn(),
  resolveUserPolicyPath: vi.fn(() => "/home/u/.sitecoreai/policy.json"),
  setEnvironmentFlags: vi.fn(),
  unenrollEnvironment: vi.fn(),
}));

vi.mock("../../../src/policy", () => policyMocks);

const configMocks = vi.hoisted(() => ({
  readRootConfiguration: vi.fn(),
  readRootConfigurationFile: vi.fn(),
}));

vi.mock("../../../src/config/root-config", () => configMocks);

import { createPolicyCommand } from "../../../src/commands/policy";
import { consola } from "consola";

const ENV = { organizationId: "org_A", name: "sandbox" };

const runPolicy = async (args: string[]): Promise<void> => {
  const command = createPolicyCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

/**
 * Capture human-mode output. `Logger.info`/`warn` route through
 * `consola.info`/`consola.warn` (not `process.stdout.write`), so the
 * non-JSON output tests spy on consola.
 */
const captureHuman = (): { output: () => string; restore: () => void } => {
  const lines: string[] = [];
  const collect = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  const infoSpy = vi.spyOn(consola, "info").mockImplementation(collect as never);
  const warnSpy = vi.spyOn(consola, "warn").mockImplementation(collect as never);
  return {
    output: () => lines.join("\n"),
    restore: () => {
      infoSpy.mockRestore();
      warnSpy.mockRestore();
    },
  };
};

beforeEach(() => {
  for (const m of Object.values(policyMocks)) {
    if (typeof m === "function" && "mockReset" in m) m.mockReset();
  }
  policyMocks.resolveUserPolicyPath.mockReturnValue("/home/u/.sitecoreai/policy.json");
  policyMocks.readWorkspacePolicy.mockReturnValue(null);
  policyMocks.readRepoPolicy.mockReturnValue(null);
  policyMocks.enrollEnvironment.mockReturnValue({ written: true, alreadyEnrolled: false });
  policyMocks.setEnvironmentFlags.mockReturnValue(true);
  policyMocks.unenrollEnvironment.mockReturnValue(true);

  configMocks.readRootConfiguration.mockReset().mockReturnValue({
    defaultEnvironment: "sandbox",
    environments: { sandbox: ENV },
  });
  configMocks.readRootConfigurationFile.mockReset().mockReturnValue({
    rootPath: "/repo/sitecoreai.cli.json",
    rootDir: "/repo",
    config: { defaultEnvProfile: "sandbox" },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("policy show", () => {
  it("reports unmanaged in JSON when no policy file exists", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runPolicy(["show", "--json"]);
    const payload = JSON.parse(String(writeSpy.mock.calls.at(-1)?.[0]));
    expect(payload).toMatchObject({ managed: false, environments: [] });
  });

  it("serializes enrolled environments in JSON when a policy exists", async () => {
    policyMocks.readWorkspacePolicy.mockReturnValue({
      environments: {
        sandbox: { ceiling: "write", identity: { organizationId: "org_A" } },
      },
    });
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runPolicy(["show", "--json"]);
    const payload = JSON.parse(String(writeSpy.mock.calls.at(-1)?.[0]));
    expect(payload.managed).toBe(true);
    expect(payload.environments).toEqual([
      { name: "sandbox", ceiling: "write", identity: { organizationId: "org_A" } },
    ]);
  });
});

describe("policy init", () => {
  it("enrolls the default environment via policy-init", async () => {
    await runPolicy(["init", "--quiet"]);
    expect(policyMocks.enrollEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({ envName: "sandbox", via: "policy-init" })
    );
  });

  it("throws CONFIG_INVALID when the policy file cannot be written", async () => {
    policyMocks.enrollEnvironment.mockReturnValue({ written: false });
    await expect(runPolicy(["init", "--quiet"])).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });

  it("throws INPUT_INVALID when no environment name resolves", async () => {
    configMocks.readRootConfigurationFile.mockReturnValue({
      rootPath: "/repo/sitecoreai.cli.json",
      rootDir: "/repo",
      config: {},
    });
    await expect(runPolicy(["init", "--quiet"])).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("throws ENV_NOT_FOUND when the resolved env is not configured", async () => {
    configMocks.readRootConfiguration.mockReturnValue({
      defaultEnvironment: "sandbox",
      environments: {},
    });
    await expect(runPolicy(["init", "--quiet"])).rejects.toMatchObject({ code: "ENV_NOT_FOUND" });
  });
});

describe("policy allow", () => {
  it("enrolls a named environment and reports the action in JSON", async () => {
    policyMocks.enrollEnvironment.mockReturnValue({ written: true, alreadyEnrolled: false });
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runPolicy(["allow", "sandbox", "--json"]);
    expect(policyMocks.enrollEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({ envName: "sandbox", via: "policy-allow" })
    );
    expect(JSON.parse(String(writeSpy.mock.calls.at(-1)?.[0]))).toEqual({
      envName: "sandbox",
      action: "enrolled",
    });
  });

  it("reports `refreshed` when the environment was already enrolled", async () => {
    policyMocks.enrollEnvironment.mockReturnValue({ written: true, alreadyEnrolled: true });
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runPolicy(["allow", "--json"]);
    expect(JSON.parse(String(writeSpy.mock.calls.at(-1)?.[0])).action).toBe("refreshed");
  });
});

describe("policy remove", () => {
  it("reports `removed` when the environment was enrolled", async () => {
    policyMocks.unenrollEnvironment.mockReturnValue(true);
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runPolicy(["remove", "sandbox", "--json"]);
    expect(policyMocks.unenrollEnvironment).toHaveBeenCalledWith("sandbox");
    expect(JSON.parse(String(writeSpy.mock.calls.at(-1)?.[0])).action).toBe("removed");
  });

  it("reports `not-enrolled` when there was nothing to remove", async () => {
    policyMocks.unenrollEnvironment.mockReturnValue(false);
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runPolicy(["rm", "sandbox", "--json"]);
    expect(JSON.parse(String(writeSpy.mock.calls.at(-1)?.[0])).action).toBe("not-enrolled");
  });

  it("throws INPUT_INVALID when no environment name resolves", async () => {
    configMocks.readRootConfigurationFile.mockReturnValue({
      rootPath: "/repo/sitecoreai.cli.json",
      rootDir: "/repo",
      config: {},
    });
    await expect(runPolicy(["remove", "--quiet"])).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("policy trust", () => {
  it("re-pins an enrolled environment's identity", async () => {
    policyMocks.readWorkspacePolicy.mockReturnValue({ environments: { sandbox: {} } });
    await runPolicy(["trust", "sandbox", "--quiet"]);
    expect(policyMocks.repinEnvironment).toHaveBeenCalledWith("sandbox", ENV);
  });

  it("throws POLICY_DENIED when the environment is not enrolled", async () => {
    policyMocks.readWorkspacePolicy.mockReturnValue({ environments: {} });
    await expect(runPolicy(["trust", "sandbox", "--quiet"])).rejects.toMatchObject({
      code: "POLICY_DENIED",
    });
    expect(policyMocks.repinEnvironment).not.toHaveBeenCalled();
  });
});

describe("policy set — flag coercion", () => {
  it("forwards --ceiling as a tier flag", async () => {
    await runPolicy(["set", "sandbox", "--ceiling", "write", "--quiet"]);
    expect(policyMocks.setEnvironmentFlags).toHaveBeenCalledWith("sandbox", { ceiling: "write" });
  });

  it("coerces --ci-writes on/off into a boolean", async () => {
    await runPolicy(["set", "sandbox", "--ci-writes", "on", "--quiet"]);
    expect(policyMocks.setEnvironmentFlags).toHaveBeenCalledWith("sandbox", { ciWrites: true });
  });

  it("coerces --mint off into a false boolean", async () => {
    await runPolicy(["set", "sandbox", "--mint", "off", "--quiet"]);
    expect(policyMocks.setEnvironmentFlags).toHaveBeenCalledWith("sandbox", {
      mintCredentials: false,
    });
  });

  it("parses a positive --step-up into minutes", async () => {
    await runPolicy(["set", "sandbox", "--step-up", "60", "--quiet"]);
    expect(policyMocks.setEnvironmentFlags).toHaveBeenCalledWith("sandbox", { stepUpMinutes: 60 });
  });

  it("clears step-up to null when --step-up is 'off'", async () => {
    await runPolicy(["set", "sandbox", "--step-up", "off", "--quiet"]);
    expect(policyMocks.setEnvironmentFlags).toHaveBeenCalledWith("sandbox", {
      stepUpMinutes: null,
    });
  });

  it("throws INPUT_INVALID for a non-positive --step-up value", async () => {
    await expect(runPolicy(["set", "sandbox", "--step-up", "0", "--quiet"])).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
    expect(policyMocks.setEnvironmentFlags).not.toHaveBeenCalled();
  });

  it("throws INPUT_INVALID when no flag is supplied", async () => {
    await expect(runPolicy(["set", "sandbox", "--quiet"])).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("throws POLICY_DENIED when the environment is not enrolled", async () => {
    policyMocks.setEnvironmentFlags.mockReturnValue(false);
    await expect(
      runPolicy(["set", "sandbox", "--ceiling", "read", "--quiet"])
    ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  });

  it("rejects --step-up with a fractional value", async () => {
    await expect(
      runPolicy(["set", "sandbox", "--step-up", "1.5", "--quiet"])
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(policyMocks.setEnvironmentFlags).not.toHaveBeenCalled();
  });

  it("combines several flags into one setEnvironmentFlags call", async () => {
    await runPolicy([
      "set",
      "sandbox",
      "--ceiling",
      "destructive",
      "--ci-writes",
      "off",
      "--mint",
      "on",
      "--quiet",
    ]);
    expect(policyMocks.setEnvironmentFlags).toHaveBeenCalledWith("sandbox", {
      ceiling: "destructive",
      ciWrites: false,
      mintCredentials: true,
    });
  });

  it("throws INPUT_INVALID when no environment name resolves for set", async () => {
    configMocks.readRootConfigurationFile.mockReturnValue({
      rootPath: "/repo/sitecoreai.cli.json",
      rootDir: "/repo",
      config: {},
    });
    await expect(runPolicy(["set", "--ceiling", "read", "--quiet"])).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });
});

describe("policy show — human (non-JSON) output", () => {
  it("reports unmanaged guidance when no policy file exists", async () => {
    const cap = captureHuman();
    await runPolicy(["show"]);
    cap.restore();
    expect(cap.output()).toContain("unmanaged");
    expect(cap.output()).toContain("scai policy init");
  });

  it("warns when the policy exists but has zero enrolled environments", async () => {
    policyMocks.readWorkspacePolicy.mockReturnValue({ environments: {} });
    const cap = captureHuman();
    await runPolicy(["show"]);
    cap.restore();
    expect(cap.output()).toContain("No environments are enrolled");
  });

  it("prints per-environment ceiling, mint, step-up, and pinned identity", async () => {
    policyMocks.readWorkspacePolicy.mockReturnValue({
      environments: {
        sandbox: {
          ceiling: "write",
          mintCredentials: true,
          ciWrites: false,
          stepUpMinutes: 30,
          enrolledAt: "2026-05-01",
          enrolledVia: "policy-allow",
          identity: { organizationId: "org_A", host: "h.example" },
        },
      },
    });
    const cap = captureHuman();
    await runPolicy(["show"]);
    cap.restore();
    expect(cap.output()).toContain("ceiling:  write");
    expect(cap.output()).toContain("mint:     allowed");
    expect(cap.output()).toContain("30 min");
    expect(cap.output()).toContain("org=org_A");
    expect(cap.output()).toContain("host=h.example");
  });

  it("shows '(none pinned)' when a managed environment has no identity parts", async () => {
    policyMocks.readWorkspacePolicy.mockReturnValue({
      environments: {
        sandbox: {
          ceiling: "read",
          mintCredentials: false,
          ciWrites: false,
          stepUpMinutes: 0,
          enrolledAt: "2026-05-01",
          enrolledVia: "setup-login",
          identity: {},
        },
      },
    });
    const cap = captureHuman();
    await runPolicy(["show"]);
    cap.restore();
    expect(cap.output()).toContain("(none pinned)");
    expect(cap.output()).toContain("step-up:  off");
  });

  it("surfaces a narrowing repo policy with allowEnvironments and a lowered ceiling", async () => {
    policyMocks.readWorkspacePolicy.mockReturnValue({
      environments: {
        sandbox: {
          ceiling: "destructive",
          mintCredentials: true,
          ciWrites: true,
          stepUpMinutes: null,
          enrolledAt: "2026-05-01",
          enrolledVia: "policy-init",
          identity: { projectId: "proj_1", environmentId: "env_1" },
        },
      },
    });
    policyMocks.readRepoPolicy.mockReturnValue({
      allowEnvironments: ["sandbox"],
      environments: { sandbox: { ceiling: "write" } },
    });
    const cap = captureHuman();
    await runPolicy(["show"]);
    cap.restore();
    expect(cap.output()).toContain("repo policy");
    expect(cap.output()).toContain("allowEnvironments: sandbox");
    expect(cap.output()).toContain("ceiling lowered to write");
  });

  it("treats an unresolvable repo policy as simply absent", async () => {
    policyMocks.readWorkspacePolicy.mockReturnValue({ environments: {} });
    configMocks.readRootConfigurationFile.mockImplementation(() => {
      throw new Error("no config here");
    });
    const cap = captureHuman();
    await runPolicy(["show"]);
    cap.restore();
    // The throw is swallowed — show still renders the workspace policy.
    expect(cap.output()).toContain("No environments are enrolled");
  });
});

describe("policy — human (non-JSON) success output", () => {
  it("init reports the created policy path and the active-guardrails line", async () => {
    const cap = captureHuman();
    await runPolicy(["init"]);
    cap.restore();
    expect(cap.output()).toContain("Workspace policy created");
    expect(cap.output()).toContain("guardrails are active");
  });

  it("init omits the 'created' line when the policy was already managed", async () => {
    policyMocks.readWorkspacePolicy.mockReturnValue({ environments: {} });
    const cap = captureHuman();
    await runPolicy(["init"]);
    cap.restore();
    expect(cap.output()).not.toContain("Workspace policy created");
    expect(cap.output()).toContain("guardrails are active");
  });

  it("allow prints the enrolled action in human mode", async () => {
    const cap = captureHuman();
    await runPolicy(["allow", "sandbox"]);
    cap.restore();
    expect(cap.output()).toContain("enrolled in the workspace policy");
  });

  it("remove warns in human mode when nothing was enrolled", async () => {
    policyMocks.unenrollEnvironment.mockReturnValue(false);
    const cap = captureHuman();
    await runPolicy(["remove", "sandbox"]);
    cap.restore();
    expect(cap.output()).toContain("nothing to remove");
  });

  it("remove confirms the removal in human mode when the env was enrolled", async () => {
    policyMocks.unenrollEnvironment.mockReturnValue(true);
    const cap = captureHuman();
    await runPolicy(["remove", "sandbox"]);
    cap.restore();
    expect(cap.output()).toContain("removed from the workspace policy");
  });

  it("trust prints the re-pin confirmation in human mode", async () => {
    policyMocks.readWorkspacePolicy.mockReturnValue({ environments: { sandbox: {} } });
    const cap = captureHuman();
    await runPolicy(["trust", "sandbox"]);
    cap.restore();
    expect(cap.output()).toContain("identity re-pinned");
  });

  it("set prints the updated-policy confirmation in human mode", async () => {
    const cap = captureHuman();
    await runPolicy(["set", "sandbox", "--ceiling", "read"]);
    cap.restore();
    expect(cap.output()).toContain("Updated the workspace policy");
  });

  it("allow throws CONFIG_INVALID when the policy write fails", async () => {
    policyMocks.enrollEnvironment.mockReturnValue({ written: false });
    await expect(runPolicy(["allow", "sandbox", "--quiet"])).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
  });
});
