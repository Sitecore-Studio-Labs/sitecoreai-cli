/**
 * Coverage for `resolveDeployEnvironmentId` — the path that turns
 * `--id` / `--name` / config-bound environmentId into a concrete env
 * ID for downstream deploy-API calls. The interesting case here is
 * the `--id` short-circuit: when the user passes an explicit ID we
 * must never round-trip to a project-scoped lookup, because that
 * lookup paginates at 10 and would surface a spurious "not found"
 * for any project past its first page.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  fetchAllProjectEnvironments: vi.fn(),
  fetchAllEnvironments: vi.fn(),
  fetchAllProjects: vi.fn(),
  fetchOrganization: vi.fn(),
}));
vi.mock("../../../../src/deploy/api", () => ({ ...apiMocks }));

vi.mock("../../../../src/shared/keychain", () => ({
  getDeployToken: vi.fn().mockResolvedValue("token"),
}));

vi.mock("../../../../src/shared/env", () => ({
  resolveEnvironment: vi.fn().mockReturnValue({
    envName: "test",
    environment: { deployToken: "token", environmentId: "config-env" },
  }),
}));

describe("resolveDeployEnvironmentId", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiMocks.fetchAllProjectEnvironments.mockResolvedValue({
      totalCount: 0,
      pageSize: 50,
      items: [],
    });
    apiMocks.fetchAllEnvironments.mockResolvedValue({
      totalCount: 0,
      pageSize: 50,
      items: [],
    });
    apiMocks.fetchAllProjects.mockResolvedValue({
      totalCount: 0,
      pageSize: 50,
      items: [],
    });
  });

  it("returns --id immediately without any lookup", async () => {
    const { resolveDeployEnvironmentId } = await import("../../../../src/deploy/tasks/shared");

    const result = await resolveDeployEnvironmentId(
      { token: "t", envName: "test" },
      { id: "env-known", project: "Some Project" }
    );

    expect(result).toBe("env-known");
    expect(apiMocks.fetchAllProjectEnvironments).not.toHaveBeenCalled();
    expect(apiMocks.fetchAllEnvironments).not.toHaveBeenCalled();
    expect(apiMocks.fetchAllProjects).not.toHaveBeenCalled();
  });

  it("falls back to a paginated name lookup when --id is absent", async () => {
    apiMocks.fetchAllEnvironments.mockResolvedValue({
      totalCount: 1,
      pageSize: 50,
      items: [{ id: "env-1", name: "Env One" }],
    });
    const { resolveDeployEnvironmentId } = await import("../../../../src/deploy/tasks/shared");

    const result = await resolveDeployEnvironmentId(
      { token: "t", envName: "test" },
      { name: "Env One" }
    );

    expect(result).toBe("env-1");
    expect(apiMocks.fetchAllEnvironments).toHaveBeenCalled();
  });

  it("uses context.environmentId when no flags or name are supplied", async () => {
    const { resolveDeployEnvironmentId } = await import("../../../../src/deploy/tasks/shared");

    const result = await resolveDeployEnvironmentId(
      { token: "t", envName: "test", environmentId: "ctx-env" },
      {}
    );

    expect(result).toBe("ctx-env");
    expect(apiMocks.fetchAllEnvironments).not.toHaveBeenCalled();
  });

  it("name lookup inside a project walks all pages of project envs", async () => {
    apiMocks.fetchAllProjects.mockResolvedValue({
      totalCount: 1,
      pageSize: 50,
      items: [{ id: "proj-1", name: "Some Project" }],
    });
    apiMocks.fetchAllProjectEnvironments.mockResolvedValue({
      totalCount: 25,
      pageSize: 50,
      items: [
        ...Array.from({ length: 24 }, (_, idx) => ({
          id: `env-${idx}`,
          name: `Env ${idx}`,
        })),
        { id: "env-target", name: "Env Target" },
      ],
    });
    const { resolveDeployEnvironmentId } = await import("../../../../src/deploy/tasks/shared");

    const result = await resolveDeployEnvironmentId(
      { token: "t", envName: "test" },
      { name: "Env Target", project: "Some Project" }
    );

    expect(result).toBe("env-target");
    expect(apiMocks.fetchAllProjects).toHaveBeenCalled();
    expect(apiMocks.fetchAllProjectEnvironments).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "t" }),
      "proj-1"
    );
  });
});
