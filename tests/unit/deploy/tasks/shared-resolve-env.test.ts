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
  fetchProjectEnvironments: vi.fn(),
  fetchEnvironments: vi.fn(),
  fetchOrganization: vi.fn(),
  fetchProjects: vi.fn(),
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
    apiMocks.fetchProjectEnvironments.mockResolvedValue([]);
    apiMocks.fetchEnvironments.mockResolvedValue({ items: [] });
  });

  it("returns --id immediately without any lookup", async () => {
    const { resolveDeployEnvironmentId } = await import(
      "../../../../src/deploy/tasks/shared"
    );

    const result = await resolveDeployEnvironmentId(
      { token: "t", envName: "test" },
      { id: "env-known", project: "Some Project" }
    );

    expect(result).toBe("env-known");
    expect(apiMocks.fetchProjectEnvironments).not.toHaveBeenCalled();
    expect(apiMocks.fetchEnvironments).not.toHaveBeenCalled();
  });

  it("falls back to a name lookup when --id is absent", async () => {
    apiMocks.fetchEnvironments.mockResolvedValue({
      items: [{ id: "env-1", name: "Env One" }],
    });
    const { resolveDeployEnvironmentId } = await import(
      "../../../../src/deploy/tasks/shared"
    );

    const result = await resolveDeployEnvironmentId(
      { token: "t", envName: "test" },
      { name: "Env One" }
    );

    expect(result).toBe("env-1");
    expect(apiMocks.fetchEnvironments).toHaveBeenCalled();
  });

  it("uses context.environmentId when no flags or name are supplied", async () => {
    const { resolveDeployEnvironmentId } = await import(
      "../../../../src/deploy/tasks/shared"
    );

    const result = await resolveDeployEnvironmentId(
      { token: "t", envName: "test", environmentId: "ctx-env" },
      {}
    );

    expect(result).toBe("ctx-env");
    expect(apiMocks.fetchEnvironments).not.toHaveBeenCalled();
  });
});
