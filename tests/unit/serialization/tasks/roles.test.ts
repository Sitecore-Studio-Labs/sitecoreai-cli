import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EnvironmentConfiguration,
  RootConfiguration,
  SerializationModuleConfiguration,
} from "../../../../src/config/types";

const apiMocks = vi.hoisted(() => ({
  fetchRoles: vi.fn(),
  pushRoleCommands: vi.fn(),
}));

vi.mock("../../../../src/serialization/sitecore-api/roles", () => ({
  fetchRoles: (...args: unknown[]) => apiMocks.fetchRoles(...args),
  pushRoleCommands: (...args: unknown[]) => apiMocks.pushRoleCommands(...args),
}));

const fsMocks = vi.hoisted(() => ({
  readRolesFromFilesystem: vi.fn(),
  writeRoleToFilesystem: vi.fn(),
  removeRoleFromFilesystem: vi.fn(),
}));

vi.mock("../../../../src/serialization/filesystem-store/roles", () => ({
  readRolesFromFilesystem: (...args: unknown[]) => fsMocks.readRolesFromFilesystem(...args),
  writeRoleToFilesystem: (...args: unknown[]) => fsMocks.writeRoleToFilesystem(...args),
  removeRoleFromFilesystem: (...args: unknown[]) => fsMocks.removeRoleFromFilesystem(...args),
}));

describe("serialization roles sync", () => {
  const logger = {
    info: vi.fn(),
  };

  const buildRoot = (overrides: Partial<RootConfiguration> = {}): RootConfiguration => ({
    modules: [],
    serialization: {
      defaultMaxRelativeItemPathLength: 120,
      defaultModuleRelativeSerializationPath: "serialization",
      removeOrphansForRoles: true,
      removeOrphansForUsers: true,
      continueOnItemFailure: false,
      excludedFields: [],
    },
    settings: {
      telemetryEnabled: false,
      cacheAuthenticationToken: true,
      versionComparisonEnabled: true,
      apiClientTimeoutInMinutes: 1,
    },
    environments: {
      demo: {} as EnvironmentConfiguration,
    },
    physicalPath: "/tmp",
    defaultEnvironment: "demo",
    ...overrides,
  });

  const buildModule = (
    roles: SerializationModuleConfiguration["roles"]
  ): SerializationModuleConfiguration => ({
    namespace: "demo",
    references: [],
    items: { includes: [], excludedFields: [] },
    roles,
    users: [],
    tags: [],
    sourceIdentifier: "demo",
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("compares role lists case-insensitively", async () => {
    const { rolesEqual } = await import("../../../../src/serialization/tasks/roles");
    expect(
      rolesEqual(["sitecore\\Admin", "sitecore\\Author"], ["Sitecore\\author", "SITECORE\\ADMIN"])
    ).toBe(true);
    expect(rolesEqual(["sitecore\\Admin"], ["sitecore\\Admin", "sitecore\\Author"])).toBe(false);
  });

  it("returns early when module has no roles", async () => {
    const { syncRolesPull, syncRolesPush } =
      await import("../../../../src/serialization/tasks/roles");
    const root = buildRoot();
    const module = buildModule([]);

    await syncRolesPull(root, module, "demo", logger);
    await syncRolesPush(root, module, "demo", logger);

    expect(apiMocks.fetchRoles).not.toHaveBeenCalled();
    expect(apiMocks.pushRoleCommands).not.toHaveBeenCalled();
  });

  it("pulls roles, writes updates, and removes orphans", async () => {
    const { syncRolesPull } = await import("../../../../src/serialization/tasks/roles");
    const root = buildRoot();
    const module = buildModule([{ domain: "sitecore", pattern: "*" }]);

    apiMocks.fetchRoles.mockResolvedValue([
      { roleName: "sitecore\\Authors", memberOfRoles: ["sitecore\\Everyone"] },
    ]);
    fsMocks.readRolesFromFilesystem.mockResolvedValue([
      { roleName: "sitecore\\Authors", memberOfRoles: [] },
      { roleName: "sitecore\\Orphan", memberOfRoles: [], serializedItemId: "orphan-id" },
    ]);

    await syncRolesPull(root, module, "demo", logger);

    expect(apiMocks.fetchRoles).toHaveBeenCalledWith(
      root.environments.demo,
      [{ domain: "sitecore", pattern: "*" }],
      { timeoutMs: 60000 }
    );
    expect(fsMocks.writeRoleToFilesystem).toHaveBeenCalledWith(
      root,
      module,
      expect.objectContaining({ roleName: "sitecore\\Authors" })
    );
    expect(fsMocks.removeRoleFromFilesystem).toHaveBeenCalledWith("orphan-id");
    expect(logger.info).toHaveBeenCalledWith("[roles] Synced 1 roles", "green");
  });

  it("pushes add/assign/unassign/remove commands and skips when empty", async () => {
    const { syncRolesPush } = await import("../../../../src/serialization/tasks/roles");
    const root = buildRoot();
    const module = buildModule([{ domain: "sitecore", pattern: "*" }]);

    fsMocks.readRolesFromFilesystem.mockResolvedValue([
      { roleName: "sitecore\\Writers", memberOfRoles: ["sitecore\\Everyone"] },
      { roleName: "sitecore\\NewRole", memberOfRoles: ["sitecore\\Parent"] },
    ]);
    apiMocks.fetchRoles.mockResolvedValue([
      { roleName: "sitecore\\Writers", memberOfRoles: ["sitecore\\OldParent"] },
      { roleName: "sitecore\\Orphan", memberOfRoles: [] },
    ]);

    await syncRolesPush(root, module, "demo", logger);

    const [, commands] = apiMocks.pushRoleCommands.mock.calls[0];
    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roleCommandType: "ADD",
          roleData: { roleName: "sitecore\\NewRole", memberOfRoles: [] },
        }),
        expect.objectContaining({
          roleCommandType: "ASSIGN",
          parentRoleData: { roleName: "sitecore\\Parent" },
        }),
        expect.objectContaining({
          roleCommandType: "ASSIGN",
          parentRoleData: { roleName: "sitecore\\Everyone" },
        }),
        expect.objectContaining({
          roleCommandType: "UNASSIGN",
          parentRoleData: { roleName: "sitecore\\OldParent" },
        }),
        expect.objectContaining({
          roleCommandType: "REMOVE",
          roleData: { roleName: "sitecore\\Orphan", memberOfRoles: [] },
        }),
      ])
    );

    apiMocks.pushRoleCommands.mockClear();
    fsMocks.readRolesFromFilesystem.mockResolvedValue([
      { roleName: "sitecore\\Writers", memberOfRoles: [] },
    ]);
    apiMocks.fetchRoles.mockResolvedValue([{ roleName: "sitecore\\Writers", memberOfRoles: [] }]);
    await syncRolesPush(
      buildRoot({ serialization: { ...root.serialization, removeOrphansForRoles: false } }),
      module,
      "demo",
      logger
    );
    expect(apiMocks.pushRoleCommands).not.toHaveBeenCalled();
  });
});
