import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EnvironmentConfiguration,
  RootConfiguration,
  SerializationModuleConfiguration,
} from "../../../../src/config/types";
import type { UserData } from "../../../../src/serialization/types";

const apiMocks = vi.hoisted(() => ({
  fetchUsers: vi.fn(),
  pushUserCommands: vi.fn(),
}));

vi.mock("../../../../src/serialization/api/users", () => ({
  fetchUsers: (...args: unknown[]) => apiMocks.fetchUsers(...args),
  pushUserCommands: (...args: unknown[]) => apiMocks.pushUserCommands(...args),
}));

const fsMocks = vi.hoisted(() => ({
  readUsersFromFilesystem: vi.fn(),
  writeUserToFilesystem: vi.fn(),
  removeUserFromFilesystem: vi.fn(),
}));

vi.mock("../../../../src/serialization/filesystem-store/users", () => ({
  readUsersFromFilesystem: (...args: unknown[]) => fsMocks.readUsersFromFilesystem(...args),
  writeUserToFilesystem: (...args: unknown[]) => fsMocks.writeUserToFilesystem(...args),
  removeUserFromFilesystem: (...args: unknown[]) => fsMocks.removeUserFromFilesystem(...args),
}));

describe("serialization users sync", () => {
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
      apiClientTimeoutInMinutes: 2,
    },
    environments: {
      demo: {} as EnvironmentConfiguration,
    },
    physicalPath: "/tmp",
    defaultEnvironment: "demo",
    ...overrides,
  });

  const buildModule = (
    users: SerializationModuleConfiguration["users"]
  ): SerializationModuleConfiguration => ({
    namespace: "demo",
    references: [],
    items: { includes: [], excludedFields: [] },
    roles: [],
    users,
    tags: [],
    sourceIdentifier: "demo",
  });

  const buildUser = (overrides: Partial<UserData>): UserData => ({
    userName: "sitecore\\demo",
    creationDate: "2024-01-01T00:00:00Z",
    isApproved: true,
    roles: [],
    profileProperties: [],
    ...overrides,
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns early when module has no users", async () => {
    const { syncUsersPull, syncUsersPush } =
      await import("../../../../src/serialization/tasks/users");
    const root = buildRoot();
    const module = buildModule([]);

    await syncUsersPull(root, module, "demo", logger);
    await syncUsersPush(root, module, "demo", logger);

    expect(apiMocks.fetchUsers).not.toHaveBeenCalled();
    expect(apiMocks.pushUserCommands).not.toHaveBeenCalled();
  });

  it("pulls users, writes updates, and removes orphans", async () => {
    const { syncUsersPull } = await import("../../../../src/serialization/tasks/users");
    const root = buildRoot();
    const module = buildModule([{ domain: "sitecore", pattern: "*" }]);
    const sourceUser = buildUser({ userName: "sitecore\\UserA", email: "a@example.com" });
    const changedDest = buildUser({ userName: "SITECORE\\usera", email: "old@example.com" });
    const orphan = buildUser({ userName: "sitecore\\orphan", serializedItemId: "orphan-id" });

    apiMocks.fetchUsers.mockResolvedValue([sourceUser]);
    fsMocks.readUsersFromFilesystem.mockResolvedValue([changedDest, orphan]);

    await syncUsersPull(root, module, "demo", logger);

    expect(apiMocks.fetchUsers).toHaveBeenCalledWith(
      root.environments.demo,
      [{ domain: "sitecore", pattern: "*" }],
      { timeoutMs: 120000 }
    );
    expect(fsMocks.writeUserToFilesystem).toHaveBeenCalledWith(root, module, sourceUser);
    expect(fsMocks.removeUserFromFilesystem).toHaveBeenCalledWith("orphan-id");
    expect(logger.info).toHaveBeenCalledWith("[users] Synced 1 users", "green");
  });

  it("pushes add/update/remove commands and skips when empty", async () => {
    const { syncUsersPush } = await import("../../../../src/serialization/tasks/users");
    const root = buildRoot();
    const module = buildModule([{ domain: "sitecore", pattern: "*" }]);
    const newUser = buildUser({ userName: "sitecore\\new" });
    const updatedUser = buildUser({ userName: "sitecore\\update", comment: "new" });
    const oldUpdated = buildUser({ userName: "sitecore\\update", comment: "old" });
    const orphan = buildUser({ userName: "sitecore\\orphan" });

    fsMocks.readUsersFromFilesystem.mockResolvedValue([newUser, updatedUser]);
    apiMocks.fetchUsers.mockResolvedValue([oldUpdated, orphan]);

    await syncUsersPush(root, module, "demo", logger);

    const [env, commands, options] = apiMocks.pushUserCommands.mock.calls[0];
    expect(env).toBe(root.environments.demo);
    expect(options).toEqual({ timeoutMs: 120000 });
    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userCommandType: "ADD", userData: newUser }),
        expect.objectContaining({ userCommandType: "UPDATE", userData: updatedUser }),
        expect.objectContaining({ userCommandType: "REMOVE", userData: orphan }),
      ])
    );

    apiMocks.pushUserCommands.mockClear();
    fsMocks.readUsersFromFilesystem.mockResolvedValue([updatedUser]);
    apiMocks.fetchUsers.mockResolvedValue([updatedUser]);
    await syncUsersPush(root, module, "demo", logger);
    expect(apiMocks.pushUserCommands).not.toHaveBeenCalled();
  });
});
