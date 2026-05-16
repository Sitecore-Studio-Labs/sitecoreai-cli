/**
 * Coverage for the folder-template gate added after a real-world
 * deletion incident where a leaf Page item with no children was
 * incorrectly treated as an empty folder and deleted. The gate
 * restricts deletion to a well-known Sitecore folder allowlist (plus
 * caller-supplied IDs and an optional name pattern); anything else is
 * skipped regardless of how empty it is.
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

import { resolveEnvironment } from "../../../../src/shared/env";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";
import { runCleanupEmptyFolders } from "../../../../src/hygiene/tasks/cleanup/empty-folders";

const FOLDER_TEMPLATE_ID = "a87a00b1-e6db-45ab-8b54-636fec3b5523"; // Common/Folder
const PAGE_TEMPLATE_ID = "76036f5e-cbce-46d1-af0a-4143f9b557aa"; // arbitrary "Page"-like

type ChildNode = {
  itemId: string;
  name: string;
  path: string;
  templateId: string | null;
  templateName: string | null;
};

const setup = (params: { childrenByPath: Record<string, ChildNode[]> }) => {
  const env = { name: "sandbox", host: "h", allowWrite: true } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: "sandbox",
    environment: env,
    root: { environments: { sandbox: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
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
    deleteItem: vi.fn().mockResolvedValue(undefined),
    deleteItemTemplate: vi.fn(),
    deleteArchivedItem: vi.fn(),
    archiveVersion: vi.fn(),
    listItemTemplates: vi.fn(),
    getChildren: vi.fn().mockImplementation(async (selector: { path?: string }) => {
      if (selector.path && params.childrenByPath[selector.path]) {
        return params.childrenByPath[selector.path];
      }
      return [];
    }),
    updateItemFields: vi.fn(),
    listUsers: vi.fn(),
    listRoles: vi.fn(),
    getUserDetail: vi.fn(),
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

describe("cleanup empty-folders — folder-template gate", () => {
  it("does NOT delete a leaf Page item with zero children", async () => {
    const client = setup({
      childrenByPath: {
        "/sitecore/content/Site": [
          {
            itemId: "page-1",
            name: "page-1",
            path: "/sitecore/content/Site/page-1",
            templateId: PAGE_TEMPLATE_ID,
            templateName: "Page",
          },
        ],
      },
    });
    const result = await runCleanupEmptyFolders({
      root: "/sitecore/content/Site",
      json: true,
    } as never);
    expect(result).toHaveLength(0);
    expect(client.deleteItem).not.toHaveBeenCalled();
  });

  it("deletes a leaf Common/Folder item with zero children", async () => {
    const client = setup({
      childrenByPath: {
        "/sitecore/content/Site": [
          {
            itemId: "folder-1",
            name: "empty-bucket",
            path: "/sitecore/content/Site/empty-bucket",
            templateId: FOLDER_TEMPLATE_ID,
            templateName: "Folder",
          },
        ],
      },
    });
    const result = await runCleanupEmptyFolders({
      root: "/sitecore/content/Site",
      json: true,
      allowWrite: true,
    } as never);
    expect(result.filter((a) => a.status === "deleted")).toHaveLength(1);
    expect(client.deleteItem).toHaveBeenCalledWith({
      itemId: "folder-1",
      permanently: true,
    });
  });

  it("accepts additional template IDs via folderTemplateIds", async () => {
    const customFolderId = "11111111-2222-3333-4444-555555555555";
    const client = setup({
      childrenByPath: {
        "/sitecore/content/Site": [
          {
            itemId: "custom-folder",
            name: "bucket",
            path: "/sitecore/content/Site/bucket",
            templateId: customFolderId,
            templateName: "Custom Folder",
          },
        ],
      },
    });
    const result = await runCleanupEmptyFolders({
      root: "/sitecore/content/Site",
      json: true,
      allowWrite: true,
      folderTemplateIds: [customFolderId],
    } as never);
    expect(result.filter((a) => a.status === "deleted")).toHaveLength(1);
    expect(client.deleteItem).toHaveBeenCalledWith({
      itemId: "custom-folder",
      permanently: true,
    });
  });

  it("matches templateNamePattern as a fallback", async () => {
    const otherId = "99999999-8888-7777-6666-555555555555";
    setup({
      childrenByPath: {
        "/sitecore/content/Site": [
          {
            itemId: "named-folder",
            name: "bucket",
            path: "/sitecore/content/Site/bucket",
            templateId: otherId,
            templateName: "Media Folder",
          },
        ],
      },
    });
    const result = await runCleanupEmptyFolders({
      root: "/sitecore/content/Site",
      json: true,
      allowWrite: true,
      templateNamePattern: "Folder$",
    } as never);
    expect(result.filter((a) => a.status === "deleted")).toHaveLength(1);
  });

  it("--any-template restores the pre-2026 behaviour of deleting any zero-child leaf", async () => {
    const client = setup({
      childrenByPath: {
        "/sitecore/content/Site": [
          {
            itemId: "page-1",
            name: "page-1",
            path: "/sitecore/content/Site/page-1",
            templateId: PAGE_TEMPLATE_ID,
            templateName: "Page",
          },
        ],
      },
    });
    const result = await runCleanupEmptyFolders({
      root: "/sitecore/content/Site",
      json: true,
      allowWrite: true,
      anyTemplate: true,
    } as never);
    expect(result.filter((a) => a.status === "deleted")).toHaveLength(1);
    expect(client.deleteItem).toHaveBeenCalled();
  });
});
