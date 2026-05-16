import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runAuditRoleBloat } from "../../../../src/hygiene/tasks/audit/role-bloat";
import { runAuditEmptyRoles } from "../../../../src/hygiene/tasks/audit/empty-roles";
import { runAuditStaleUsers } from "../../../../src/hygiene/tasks/audit/stale-users";

vi.mock("../../../../src/shared/env", () => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});
import { resolveEnvironment } from "../../../../src/shared/env";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

const setupEnv = () => {
  const env = { name: "sandbox", host: "h" } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: "sandbox",
    environment: env,
    root: { environments: { sandbox: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
  return env;
};

const mkClient = (overrides: Partial<HygieneApiClient>): HygieneApiClient => {
  const stub = {} as Record<string, unknown>;
  for (const k of [
    "search",
    "searchAll",
    "getItemFields",
    "getItemFieldsBatch",
    "itemExists",
    "itemsExistBatch",
    "getItemVersions",
    "getItemWorkflow",
    "listArchivedItems",
    "deleteItemVersion",
    "deleteItem",
    "deleteItemTemplate",
    "deleteArchivedItem",
    "archiveVersion",
    "listItemTemplates",
    "getChildren",
    "updateItemFields",
    "listUsers",
    "listRoles",
    "getUserDetail",
  ]) {
    stub[k] = vi.fn();
  }
  const client = { ...stub, ...overrides } as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

describe("audit empty-roles", () => {
  it("flags roles with memberCount=0", async () => {
    setupEnv();
    mkClient({
      listRoles: vi.fn().mockResolvedValue([
        { name: "sitecore\\A", domain: "sitecore", memberCount: 0 },
        { name: "sitecore\\B", domain: "sitecore", memberCount: 2 },
      ]),
    });
    const result = await runAuditEmptyRoles({ json: true } as never);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("sitecore\\A");
  });

  it("filters by --domain", async () => {
    setupEnv();
    mkClient({
      listRoles: vi.fn().mockResolvedValue([
        { name: "sitecore\\A", domain: "sitecore", memberCount: 0 },
        { name: "extranet\\B", domain: "extranet", memberCount: 0 },
      ]),
    });
    const result = await runAuditEmptyRoles({ domain: "extranet", json: true } as never);
    expect(result).toHaveLength(1);
    expect(result[0].domain).toBe("extranet");
  });
});

describe("audit role-bloat", () => {
  it("flags users at or above threshold", async () => {
    setupEnv();
    mkClient({
      listUsers: vi.fn().mockResolvedValue([
        { name: "u1", isAdministrator: false, isAuthenticated: true, domain: "sitecore" },
        { name: "u2", isAdministrator: false, isAuthenticated: true, domain: "sitecore" },
      ]),
      getUserDetail: vi.fn().mockImplementation(async (name: string) => ({
        name,
        isAdministrator: false,
        roles: name === "u1" ? ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"] : ["x"],
        lastLogin: null,
        lastActivity: null,
      })),
    });
    const result = await runAuditRoleBloat({ threshold: 10, json: true } as never);
    expect(result).toHaveLength(1);
    expect(result[0].user).toBe("u1");
  });

  it("excludes administrators by default", async () => {
    setupEnv();
    mkClient({
      listUsers: vi
        .fn()
        .mockResolvedValue([
          { name: "admin", isAdministrator: true, isAuthenticated: true, domain: "sitecore" },
        ]),
      getUserDetail: vi.fn(),
    });
    const result = await runAuditRoleBloat({ threshold: 1, json: true } as never);
    expect(result).toHaveLength(0);
  });
});

describe("audit stale-users", () => {
  it("flags users whose lastLogin is older than threshold", async () => {
    setupEnv();
    const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    mkClient({
      listUsers: vi.fn().mockResolvedValue([
        { name: "u1", isAdministrator: false, isAuthenticated: true, domain: "sitecore" },
        { name: "u2", isAdministrator: false, isAuthenticated: true, domain: "sitecore" },
      ]),
      getUserDetail: vi.fn().mockImplementation(async (name: string) => ({
        name,
        isAdministrator: false,
        roles: [],
        lastLogin: name === "u1" ? oldDate : recentDate,
        lastActivity: name === "u1" ? oldDate : recentDate,
      })),
    });
    const result = await runAuditStaleUsers({ notActiveDays: 180, json: true } as never);
    expect(result).toHaveLength(1);
    expect(result[0].user).toBe("u1");
  });

  it("flags users with null lastLogin (never logged in)", async () => {
    setupEnv();
    mkClient({
      listUsers: vi
        .fn()
        .mockResolvedValue([
          { name: "u1", isAdministrator: false, isAuthenticated: true, domain: "sitecore" },
        ]),
      getUserDetail: vi.fn().mockResolvedValue({
        name: "u1",
        isAdministrator: false,
        roles: [],
        lastLogin: null,
        lastActivity: null,
      }),
    });
    const result = await runAuditStaleUsers({ notActiveDays: 180, json: true } as never);
    expect(result).toHaveLength(1);
    expect(result[0].daysSinceActive).toBeNull();
  });

  it("excludes service accounts by default", async () => {
    setupEnv();
    mkClient({
      listUsers: vi.fn().mockResolvedValue([
        {
          name: "sitecore\\JssImport",
          isAdministrator: false,
          isAuthenticated: true,
          domain: "sitecore",
        },
        {
          name: "sitecore\\auto_sync",
          isAdministrator: false,
          isAuthenticated: true,
          domain: "sitecore",
        },
      ]),
      getUserDetail: vi.fn(),
    });
    const result = await runAuditStaleUsers({ notActiveDays: 30, json: true } as never);
    expect(result).toHaveLength(0);
  });
});
