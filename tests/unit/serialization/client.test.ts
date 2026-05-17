/**
 * `createSitecoreApiClient` — the options-binding factory over the
 * Authoring + Management GraphQL surface.
 *
 * The factory adds nothing of its own; it binds a fixed
 * `SitecoreApiClientOptions` as the head argument of each function-style
 * operation and spreads the caller's tail arguments through. These tests
 * mock every underlying module so each method's binding is asserted in
 * isolation from the wire.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/serialization/api/history", () => ({
  fetchHistoryEntries: vi.fn().mockResolvedValue("fetchHistoryEntries"),
  fetchHistoryTimestamp: vi.fn().mockResolvedValue("fetchHistoryTimestamp"),
}));
vi.mock("../../../src/serialization/api/items", () => ({
  executeSerializationCommands: vi.fn().mockResolvedValue("executeSerializationCommands"),
  fetchItemData: vi.fn().mockResolvedValue("fetchItemData"),
  fetchItemMetadata: vi.fn().mockResolvedValue("fetchItemMetadata"),
}));
vi.mock("../../../src/serialization/api/publish", () => ({
  checkPublishStatus: vi.fn().mockResolvedValue("checkPublishStatus"),
  fetchPublishingTargets: vi.fn().mockResolvedValue("fetchPublishingTargets"),
  publishItems: vi.fn().mockResolvedValue("publishItems"),
}));
vi.mock("../../../src/serialization/api/roles", () => ({
  fetchRoles: vi.fn().mockResolvedValue("fetchRoles"),
  pushRoleCommands: vi.fn().mockResolvedValue("pushRoleCommands"),
}));
vi.mock("../../../src/serialization/api/users", () => ({
  fetchUsers: vi.fn().mockResolvedValue("fetchUsers"),
  pushUserCommands: vi.fn().mockResolvedValue("pushUserCommands"),
}));

let factory: typeof import("../../../src/serialization/api/client");
let history: typeof import("../../../src/serialization/api/history");
let items: typeof import("../../../src/serialization/api/items");
let publish: typeof import("../../../src/serialization/api/publish");
let roles: typeof import("../../../src/serialization/api/roles");
let users: typeof import("../../../src/serialization/api/users");

const OPTIONS = { host: "https://cm.example", accessToken: "token" } as never;

beforeAll(async () => {
  factory = await import("../../../src/serialization/api/client");
  history = await import("../../../src/serialization/api/history");
  items = await import("../../../src/serialization/api/items");
  publish = await import("../../../src/serialization/api/publish");
  roles = await import("../../../src/serialization/api/roles");
  users = await import("../../../src/serialization/api/users");
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createSitecoreApiClient", () => {
  it("exposes the bound options object verbatim", () => {
    expect(factory.createSitecoreApiClient(OPTIONS).options).toBe(OPTIONS);
  });

  it("fetchItemMetadata binds options ahead of database, path, and tail args", async () => {
    const filter = {} as never;
    const result = await factory
      .createSitecoreApiClient(OPTIONS)
      .fetchItemMetadata("master", "/sitecore/content", "SingleItem", filter, false);
    expect(items.fetchItemMetadata).toHaveBeenCalledWith(
      OPTIONS,
      "master",
      "/sitecore/content",
      "SingleItem",
      filter,
      false
    );
    expect(result).toBe("fetchItemMetadata");
  });

  it("fetchItemData binds options ahead of database and path", async () => {
    await factory.createSitecoreApiClient(OPTIONS).fetchItemData("web", "/sitecore/content/Home");
    expect(items.fetchItemData).toHaveBeenCalledWith(OPTIONS, "web", "/sitecore/content/Home");
  });

  it("executeSerializationCommands binds options ahead of the command list", async () => {
    const commands = [{ type: "create" }] as never;
    await factory.createSitecoreApiClient(OPTIONS).executeSerializationCommands(commands, "Info");
    expect(items.executeSerializationCommands).toHaveBeenCalledWith(OPTIONS, commands, "Info");
  });

  it("fetchHistoryTimestamp binds options-only", async () => {
    const result = await factory.createSitecoreApiClient(OPTIONS).fetchHistoryTimestamp();
    expect(history.fetchHistoryTimestamp).toHaveBeenCalledWith(OPTIONS);
    expect(result).toBe("fetchHistoryTimestamp");
  });

  it("fetchHistoryEntries binds options ahead of the timestamp", async () => {
    await factory.createSitecoreApiClient(OPTIONS).fetchHistoryEntries("2026-01-01");
    expect(history.fetchHistoryEntries).toHaveBeenCalledWith(OPTIONS, "2026-01-01");
  });

  it("fetchRoles binds options ahead of the predicate list", async () => {
    await factory.createSitecoreApiClient(OPTIONS).fetchRoles(["sitecore\\Author"]);
    expect(roles.fetchRoles).toHaveBeenCalledWith(OPTIONS, ["sitecore\\Author"]);
  });

  it("pushRoleCommands binds options ahead of the command list", async () => {
    const commands = [{ kind: "add" }] as never;
    await factory.createSitecoreApiClient(OPTIONS).pushRoleCommands(commands);
    expect(roles.pushRoleCommands).toHaveBeenCalledWith(OPTIONS, commands);
  });

  it("fetchUsers binds options ahead of the predicate list", async () => {
    await factory.createSitecoreApiClient(OPTIONS).fetchUsers(["sitecore\\jdoe"]);
    expect(users.fetchUsers).toHaveBeenCalledWith(OPTIONS, ["sitecore\\jdoe"]);
  });

  it("pushUserCommands binds options ahead of the command list", async () => {
    const commands = [{ kind: "create" }] as never;
    await factory.createSitecoreApiClient(OPTIONS).pushUserCommands(commands);
    expect(users.pushUserCommands).toHaveBeenCalledWith(OPTIONS, commands);
  });

  it("publishItems binds options ahead of the item-id list", async () => {
    const result = await factory.createSitecoreApiClient(OPTIONS).publishItems(["id-1", "id-2"]);
    expect(publish.publishItems).toHaveBeenCalledWith(OPTIONS, ["id-1", "id-2"]);
    expect(result).toBe("publishItems");
  });

  it("checkPublishStatus binds options ahead of the publish id", async () => {
    await factory.createSitecoreApiClient(OPTIONS).checkPublishStatus("pub-1");
    expect(publish.checkPublishStatus).toHaveBeenCalledWith(OPTIONS, "pub-1");
  });

  it("fetchPublishingTargets binds options-only", async () => {
    const result = await factory.createSitecoreApiClient(OPTIONS).fetchPublishingTargets();
    expect(publish.fetchPublishingTargets).toHaveBeenCalledWith(OPTIONS);
    expect(result).toBe("fetchPublishingTargets");
  });
});
