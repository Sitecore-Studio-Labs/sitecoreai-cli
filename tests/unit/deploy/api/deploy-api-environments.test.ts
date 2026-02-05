import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/deploy/api/common", () => ({
  deployRequest: vi.fn().mockResolvedValue({}),
}));

let common: typeof import("../../../../src/deploy/api/common");
let api: typeof import("../../../../src/deploy/api/environments");

beforeAll(async () => {
  common = await import("../../../../src/deploy/api/common");
  api = await import("../../../../src/deploy/api/environments");
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("environments api", () => {
  it("fetchEnvironments lists environments", async () => {
    await api.fetchEnvironments({ accessToken: "token" }, { PageNumber: 1 });
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/environments/v2",
      { PageNumber: 1 }
    );
  });

  it("fetchEnvironmentsLimitation hits limitation endpoint", async () => {
    await api.fetchEnvironmentsLimitation({ accessToken: "token" });
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/environments/v1/limitation"
    );
  });

  it("fetchEnvironment gets by id", async () => {
    await api.fetchEnvironment({ accessToken: "token" }, "env-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/environments/v2/env-1"
    );
  });

  it("fetchEnvironmentDeployments lists environment deployments", async () => {
    await api.fetchEnvironmentDeployments({ accessToken: "token" }, "env-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/environments/v2/env-1/deployments"
    );
  });

  it("createEnvironmentDeployment posts redeploy query", async () => {
    await api.createEnvironmentDeployment({ accessToken: "token" }, "env-1", true);
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/environments/v2/env-1/deployments",
      { redeploy: true },
      { method: "POST" }
    );
  });

  it("fetchEnvironmentVariables lists variables", async () => {
    await api.fetchEnvironmentVariables({ accessToken: "token" }, "env-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/environments/v1/env-1/variables"
    );
  });

  it("upsertEnvironmentVariable posts variable update", async () => {
    await api.upsertEnvironmentVariable({ accessToken: "token" }, "env-1", "Var/Name", {
      value: "x",
    });
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/environments/v1/env-1/variables/Var%2FName",
      undefined,
      { method: "POST", body: { value: "x" } }
    );
  });

  it("deleteEnvironmentVariable deletes variable", async () => {
    await api.deleteEnvironmentVariable({ accessToken: "token" }, "env-1", "Var/Name");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/environments/v1/env-1/variables/Var%2FName",
      undefined,
      { method: "DELETE" }
    );
  });

  it("fetchEnvironmentEdgeToken gets edge token", async () => {
    await api.fetchEnvironmentEdgeToken({ accessToken: "token" }, "env-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/environments/v1/env-1/obtain-edge-token"
    );
  });

  it("fetchEnvironmentEditingSecret gets editing secret", async () => {
    await api.fetchEnvironmentEditingSecret({ accessToken: "token" }, "env-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/environments/v1/env-1/obtain-editing-secret"
    );
  });

  it("regenerateEnvironmentContext posts regenerate", async () => {
    await api.regenerateEnvironmentContext({ accessToken: "token" }, "env-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/environments/v1/env-1/regenerate-context",
      undefined,
      { method: "POST" }
    );
  });

  it("deleteEnvironment passes force query", async () => {
    await api.deleteEnvironment({ accessToken: "token" }, "env-1", true);
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/environments/v1/env-1",
      { force: true },
      { method: "DELETE" }
    );
  });

  it("updateEnvironment updates name", async () => {
    await api.updateEnvironment({ accessToken: "token" }, "env-1", { name: "New Name" });
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/environments/v1/env-1",
      undefined,
      { method: "PUT", body: { name: "New Name" } }
    );
  });

  it("promoteEnvironmentDeployment posts promote request", async () => {
    await api.promoteEnvironmentDeployment({ accessToken: "token" }, "env-1", "dep-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/environments/v2/env-1/promote/dep-1",
      undefined,
      { method: "POST", body: { environmentId: "env-1", deploymentId: "dep-1" } }
    );
  });

  it("linkEnvironmentRepository uses repository endpoint", async () => {
    await api.linkEnvironmentRepository({ accessToken: "token" }, "env-1", { repo: "x" });
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/environments/v1/env-1/repository",
      undefined,
      { method: "PUT", body: { repo: "x" } }
    );
  });

  it("unlinkEnvironmentRepository deletes repository link", async () => {
    await api.unlinkEnvironmentRepository({ accessToken: "token" }, "env-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/environments/v1/env-1/repository",
      undefined,
      { method: "DELETE" }
    );
  });

  it("fetchEnvironmentRestartStatus calls restart GET", async () => {
    await api.fetchEnvironmentRestartStatus({ accessToken: "token" }, "env-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/environments/v1/env-1/restart"
    );
  });

  it("restartEnvironment posts restart", async () => {
    await api.restartEnvironment({ accessToken: "token" }, "env-1");
    expect(common.deployRequest).toHaveBeenCalledWith(
      { accessToken: "token" },
      "/api/environments/v1/env-1/restart",
      undefined,
      { method: "POST" }
    );
  });

  it("resolveHostFromEnvironment chooses direct host", () => {
    expect(api.resolveHostFromEnvironment({ host: "example.com" })).toBe("example.com");
  });

  it("resolveHostFromEnvironment falls back to hosts array", () => {
    expect(api.resolveHostFromEnvironment({ hosts: [{ url: "https://example.com" }] })).toBe(
      "https://example.com"
    );
  });
});
