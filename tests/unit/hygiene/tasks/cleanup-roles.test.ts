/**
 * Coverage for the built-in role allowlist added after a real-world
 * incident where `cleanup roles purge-empty` flagged the entire
 * `sitecore\` platform role family (Administrator, every `Sitecore
 * Client …`, every `Analytics …`) because they ship empty on a fresh
 * tenant. The default now refuses to delete built-in roles regardless
 * of emptiness; --include-builtin restores the old behaviour for the
 * rare case where it's actually wanted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";

vi.mock("../../../../src/shared/env", () => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});
vi.mock("../../../../src/shared/allow-write", () => ({ ensureAllowWrite: vi.fn() }));
vi.mock("../../../../src/hygiene/tasks/audit/empty-roles", () => ({
  runAuditEmptyRoles: vi.fn(),
}));

import { resolveEnvironment } from "../../../../src/shared/env";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";
import { runAuditEmptyRoles } from "../../../../src/hygiene/tasks/audit/empty-roles";
import { runCleanupRoles } from "../../../../src/hygiene/tasks/cleanup/roles";

const setup = (emptyRoles: Array<{ name: string; domain: string | null }>) => {
  const env = { name: "sandbox", host: "h", allowWrite: true } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: "sandbox",
    environment: env,
    root: { environments: { sandbox: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
  // The audit may set richer fields (memberCount, etc.); the cleanup
  // only reads `.name` and `.domain`, so this minimal shape suffices.
  vi.mocked(runAuditEmptyRoles).mockResolvedValue(emptyRoles as never);
  const client = {
    search: vi.fn(),
    searchAll: vi.fn(),
    getItemFields: vi.fn(),
    getItemFieldsBatch: vi.fn(),
    itemExists: vi.fn(),
    itemsExistBatch: vi.fn(),
    getItemVersions: vi.fn(),
    getItemWorkflow: vi.fn(),
    listArchivedItems: vi.fn(),
    deleteItemVersion: vi.fn(),
    deleteItem: vi.fn(),
    deleteItemTemplate: vi.fn(),
    deleteArchivedItem: vi.fn(),
    archiveVersion: vi.fn(),
    listItemTemplates: vi.fn(),
    getChildren: vi.fn(),
    updateItemFields: vi.fn(),
    listUsers: vi.fn(),
    listRoles: vi.fn(),
    getUserDetail: vi.fn(),
    deleteRole: vi.fn().mockResolvedValue(undefined),
  } as unknown as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("cleanup roles purge-empty — built-in skip", () => {
  it("does NOT delete sitecore\\Administrator even when the audit lists it as empty", async () => {
    const client = setup([
      { name: "sitecore\\Administrator", domain: "sitecore" },
      { name: "CustomDomain\\StaleRole", domain: "CustomDomain" },
    ]);
    const result = await runCleanupRoles({
      json: true,
      allowWrite: true,
    } as never);
    // One delete, the custom-domain role only.
    expect(client.deleteRole).toHaveBeenCalledTimes(1);
    expect(client.deleteRole).toHaveBeenCalledWith("CustomDomain\\StaleRole");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("CustomDomain\\StaleRole");
  });

  it("skips every Sitecore Client * role by default", async () => {
    const client = setup([
      { name: "sitecore\\Sitecore Client Authoring", domain: "sitecore" },
      { name: "sitecore\\Sitecore Client Publishing", domain: "sitecore" },
      { name: "sitecore\\Sitecore Client Forms Author", domain: "sitecore" },
    ]);
    await runCleanupRoles({ json: true, allowWrite: true } as never);
    expect(client.deleteRole).not.toHaveBeenCalled();
  });

  it("--include-builtin deletes the built-ins anyway", async () => {
    const client = setup([
      { name: "sitecore\\Administrator", domain: "sitecore" },
      { name: "sitecore\\Author", domain: "sitecore" },
    ]);
    await runCleanupRoles({
      json: true,
      allowWrite: true,
      includeBuiltin: true,
    } as never);
    expect(client.deleteRole).toHaveBeenCalledTimes(2);
  });

  it("--always-skip honors custom skip names (bare or fully-qualified)", async () => {
    const client = setup([
      { name: "CustomDomain\\SpecialRole", domain: "CustomDomain" },
      { name: "CustomDomain\\DropMe", domain: "CustomDomain" },
      { name: "OtherDomain\\BareNameMatch", domain: "OtherDomain" },
    ]);
    await runCleanupRoles({
      json: true,
      allowWrite: true,
      alwaysSkip: ["CustomDomain\\SpecialRole", "BareNameMatch"],
    } as never);
    expect(client.deleteRole).toHaveBeenCalledTimes(1);
    expect(client.deleteRole).toHaveBeenCalledWith("CustomDomain\\DropMe");
  });

  it("preserves the existing what-if + max-deletions semantics", async () => {
    const client = setup([
      { name: "CustomDomain\\A", domain: "CustomDomain" },
      { name: "CustomDomain\\B", domain: "CustomDomain" },
      { name: "CustomDomain\\C", domain: "CustomDomain" },
    ]);
    const result = await runCleanupRoles({
      json: true,
      allowWrite: true,
      whatIf: true,
      maxDeletions: 2,
    } as never);
    expect(client.deleteRole).not.toHaveBeenCalled();
    expect(result).toHaveLength(2);
    expect(result.every((a) => a.status === "what-if")).toBe(true);
  });
});
