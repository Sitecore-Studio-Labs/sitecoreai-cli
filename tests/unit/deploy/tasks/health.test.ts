import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  fetchAllEnvironments: vi.fn(),
  fetchAllProjectEnvironments: vi.fn(),
  fetchEnvironmentDeployments: vi.fn(),
  probeEnvironmentHealth: vi.fn(),
  resolveHostFromEnvironment: vi.fn(),
  getProvisioningStatus: vi.fn(),
}));
vi.mock("../../../../src/deploy/api", () => ({ ...apiMocks }));

const sharedMocks = vi.hoisted(() => ({
  getDeployContext: vi.fn(),
  getEnvironmentType: vi.fn(),
  printDeployResultWithContext: vi.fn(),
  resolveDeployProjectId: vi.fn(),
  toLogger: vi.fn(),
}));
vi.mock("../../../../src/deploy/tasks/shared", () => sharedMocks);

describe("deploy health task", () => {
  const logger = {
    isJson: vi.fn(),
    info: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    sharedMocks.toLogger.mockReturnValue(logger);
    sharedMocks.getDeployContext.mockResolvedValue({
      token: "token",
      baseUrl: "https://api.example",
      envName: "test",
    });
    sharedMocks.resolveDeployProjectId.mockResolvedValue(undefined);
    logger.isJson.mockReturnValue(true);
  });

  it("probes CM via /healthz/ready and EH via latest deployment", async () => {
    apiMocks.fetchAllEnvironments.mockResolvedValue({
      totalCount: 2,
      pageSize: 50,
      items: [
        { id: "cm-1", name: "CM One", type: "cm", provisioningStatus: 2 },
        { id: "eh-1", name: "EH One", type: "eh", provisioningStatus: 2 },
      ],
    });
    sharedMocks.getEnvironmentType.mockImplementation((env: { type?: string }) => env.type);
    apiMocks.getProvisioningStatus.mockReturnValue("provisioned");
    apiMocks.resolveHostFromEnvironment.mockReturnValue("cm.example");
    apiMocks.probeEnvironmentHealth.mockResolvedValue({
      host: "https://cm.example",
      url: "https://cm.example/healthz/ready",
      status: 200,
      ok: true,
      body: "OK",
    });
    apiMocks.fetchEnvironmentDeployments.mockResolvedValue({
      data: [
        {
          id: "dep-old",
          createdAt: "2026-04-01T00:00:00Z",
          statusName: "Complete",
        },
        {
          id: "dep-new",
          createdAt: "2026-05-10T00:00:00Z",
          statusName: "Complete",
        },
      ],
    });

    const { runDeployHealth } = await import("../../../../src/deploy/tasks/health");
    await runDeployHealth({});

    expect(apiMocks.fetchAllEnvironments).toHaveBeenCalled();
    expect(apiMocks.probeEnvironmentHealth).toHaveBeenCalledWith("cm.example", 10_000);
    expect(apiMocks.fetchEnvironmentDeployments).toHaveBeenCalledWith(
      { accessToken: "token", baseUrl: "https://api.example" },
      "eh-1"
    );

    const call = sharedMocks.printDeployResultWithContext.mock.calls[0];
    expect(call[2]).toBe("health");
    const payload = call[3] as {
      totalCount: number;
      environments: Array<{
        id: string;
        type: string;
        probe?: { kind: string; status?: number | string; deploymentId?: string };
      }>;
    };
    expect(payload.totalCount).toBe(2);
    const [cm, eh] = payload.environments;
    expect(cm.probe).toEqual({
      kind: "healthz",
      url: "https://cm.example/healthz/ready",
      status: 200,
      ok: true,
    });
    expect(eh.probe).toMatchObject({
      kind: "deployment",
      deploymentId: "dep-new",
      status: "Complete",
    });
  });

  it("skips probes for unprovisioned environments", async () => {
    apiMocks.fetchAllEnvironments.mockResolvedValue({
      totalCount: 1,
      pageSize: 50,
      items: [{ id: "eh-2", name: "EH Two", type: "eh", provisioningStatus: 0 }],
    });
    sharedMocks.getEnvironmentType.mockReturnValue("eh");
    apiMocks.getProvisioningStatus.mockReturnValue("unprovisioned");

    const { runDeployHealth } = await import("../../../../src/deploy/tasks/health");
    await runDeployHealth({});

    expect(apiMocks.fetchEnvironmentDeployments).not.toHaveBeenCalled();
    expect(apiMocks.probeEnvironmentHealth).not.toHaveBeenCalled();
    const payload = sharedMocks.printDeployResultWithContext.mock.calls[0][3] as {
      environments: Array<{ probe: { kind: string; reason: string } }>;
    };
    expect(payload.environments[0].probe).toEqual({
      kind: "skipped",
      reason: "Environment has never been provisioned.",
    });
  });

  it("honors --no-probe and skips every probe", async () => {
    apiMocks.fetchAllEnvironments.mockResolvedValue({
      totalCount: 1,
      pageSize: 50,
      items: [{ id: "cm-1", name: "CM One", type: "cm", provisioningStatus: 2 }],
    });
    sharedMocks.getEnvironmentType.mockReturnValue("cm");
    apiMocks.getProvisioningStatus.mockReturnValue("provisioned");

    const { runDeployHealth } = await import("../../../../src/deploy/tasks/health");
    await runDeployHealth({ noProbe: true });

    expect(apiMocks.probeEnvironmentHealth).not.toHaveBeenCalled();
    const payload = sharedMocks.printDeployResultWithContext.mock.calls[0][3] as {
      environments: Array<{ probe: { kind: string; reason: string } }>;
    };
    expect(payload.environments[0].probe.kind).toBe("skipped");
    expect(payload.environments[0].probe.reason).toMatch(/--no-probe/);
  });

  it("filters by type before probing", async () => {
    apiMocks.fetchAllEnvironments.mockResolvedValue({
      totalCount: 2,
      pageSize: 50,
      items: [
        { id: "cm-1", name: "CM", type: "cm", provisioningStatus: 2 },
        { id: "eh-1", name: "EH", type: "eh", provisioningStatus: 2 },
      ],
    });
    sharedMocks.getEnvironmentType.mockImplementation((env: { type?: string }) => env.type);
    apiMocks.getProvisioningStatus.mockReturnValue("provisioned");
    apiMocks.resolveHostFromEnvironment.mockReturnValue("cm.example");
    apiMocks.probeEnvironmentHealth.mockResolvedValue({
      host: "https://cm.example",
      url: "https://cm.example/healthz/ready",
      status: 200,
      ok: true,
      body: "OK",
    });

    const { runDeployHealth } = await import("../../../../src/deploy/tasks/health");
    await runDeployHealth({ type: "cm" });

    expect(apiMocks.probeEnvironmentHealth).toHaveBeenCalledTimes(1);
    expect(apiMocks.fetchEnvironmentDeployments).not.toHaveBeenCalled();
    const payload = sharedMocks.printDeployResultWithContext.mock.calls[0][3] as {
      totalCount: number;
    };
    expect(payload.totalCount).toBe(1);
  });

  it("records errors per environment without aborting the whole probe", async () => {
    apiMocks.fetchAllEnvironments.mockResolvedValue({
      totalCount: 2,
      pageSize: 50,
      items: [
        { id: "cm-bad", name: "CM Bad", type: "cm", provisioningStatus: 2 },
        { id: "cm-good", name: "CM Good", type: "cm", provisioningStatus: 2 },
      ],
    });
    sharedMocks.getEnvironmentType.mockImplementation(() => "cm");
    apiMocks.getProvisioningStatus.mockReturnValue("provisioned");
    apiMocks.resolveHostFromEnvironment
      .mockReturnValueOnce("bad.example")
      .mockReturnValueOnce("good.example");
    apiMocks.probeEnvironmentHealth
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({
        host: "https://good.example",
        url: "https://good.example/healthz/ready",
        status: 200,
        ok: true,
        body: "OK",
      });

    const { runDeployHealth } = await import("../../../../src/deploy/tasks/health");
    await runDeployHealth({});

    const payload = sharedMocks.printDeployResultWithContext.mock.calls[0][3] as {
      environments: Array<{ id: string; error?: string; probe?: unknown }>;
    };
    const bad = payload.environments.find((entry) => entry.id === "cm-bad")!;
    const good = payload.environments.find((entry) => entry.id === "cm-good")!;
    expect(bad.error).toBe("timeout");
    expect(good.probe).toMatchObject({ kind: "healthz", status: 200 });
  });
});
