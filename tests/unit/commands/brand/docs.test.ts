import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `scai brand docs …` command wiring. The brand SDK primitives and the
 * root-config reader are mocked; tests parse the commander command tree
 * and assert the SDK call args, the json vs human output fork, the
 * URL-only upload guard, and the destructive-delete confirmation.
 */

const brandMocks = vi.hoisted(() => ({
  deleteDocument: vi.fn().mockResolvedValue(undefined),
  getDocument: vi
    .fn()
    .mockResolvedValue({ id: "doc-1", status: "processed", title: "Guide", numberOfPages: 4 }),
  listDocuments: vi.fn().mockResolvedValue({
    totalCount: 1,
    pageNumber: 1,
    pageSize: 50,
    data: [{ id: "doc-1", status: "processed", title: "Guide", brandkitId: "kit-1" }],
  }),
  uploadDocument: vi.fn().mockResolvedValue({ id: "doc-new", status: "pending" }),
  LOCAL_UPLOAD_UNSUPPORTED_MESSAGE: "Local-file document upload is not supported.",
  LOCAL_UPLOAD_UNSUPPORTED_HINT: "Host the PDF at an HTTPS URL and pass --url.",
}));

vi.mock("../../../../src/brand", () => brandMocks);

const configMocks = vi.hoisted(() => ({
  readRootConfiguration: vi.fn(),
}));

vi.mock("../../../../src/config/root-config", () => ({
  readRootConfiguration: configMocks.readRootConfiguration,
}));

import { createBrandDocsCommand } from "../../../../src/commands/brand/docs";

const rootWithCredential = {
  defaultEnvironment: "sandbox",
  environments: { sandbox: { organizationId: "org_ABC", name: "sandbox" } },
  brand: { org_ABC: { clientId: "cid" } },
};

const runDocs = async (args: string[]): Promise<void> => {
  const command = createBrandDocsCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  configMocks.readRootConfiguration.mockReset();
  configMocks.readRootConfiguration.mockReturnValue(rootWithCredential);
  brandMocks.deleteDocument.mockClear();
  brandMocks.getDocument.mockClear();
  brandMocks.listDocuments.mockClear();
  brandMocks.uploadDocument.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("brand docs — resolveClient guards", () => {
  it("throws INPUT_INVALID when no organizationId resolves", async () => {
    configMocks.readRootConfiguration.mockReturnValue({
      defaultEnvironment: "sandbox",
      environments: { sandbox: { name: "sandbox" } },
      brand: {},
    });
    await expect(runDocs(["list", "--quiet"])).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("throws AUTH_BRAND_REQUIRED when the org has no Brand credential", async () => {
    configMocks.readRootConfiguration.mockReturnValue({
      defaultEnvironment: "sandbox",
      environments: { sandbox: { organizationId: "org_ABC", name: "sandbox" } },
      brand: {},
    });
    await expect(runDocs(["list", "--quiet"])).rejects.toMatchObject({
      code: "AUTH_BRAND_REQUIRED",
    });
  });
});

describe("brand docs upload", () => {
  it("rejects a local file positional with INPUT_INVALID", async () => {
    await expect(runDocs(["upload", "kit-1", "./local.pdf", "--quiet"])).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
    expect(brandMocks.uploadDocument).not.toHaveBeenCalled();
  });

  it("requires a --url when no positional file is given", async () => {
    await expect(runDocs(["upload", "kit-1", "--quiet"])).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("uploads by URL, forwarding title + summary + type + mime", async () => {
    await runDocs([
      "upload",
      "kit-1",
      "--quiet",
      "--url",
      "https://x.com/a.pdf",
      "--title",
      "Brand Guide",
      "--summary",
      "Voice + tone",
      "--type",
      "guidelines",
      "--mime",
      "application/pdf",
    ]);
    expect(brandMocks.uploadDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        brandKitId: "kit-1",
        source: { url: "https://x.com/a.pdf" },
        title: "Brand Guide",
        summary: "Voice + tone",
        type: "guidelines",
        fileType: "application/pdf",
      })
    );
  });

  it("emits raw JSON to stdout with --format json", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runDocs([
      "upload",
      "kit-1",
      "--quiet",
      "--url",
      "https://x.com/a.pdf",
      "--format",
      "json",
    ]);
    const payload = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
    expect(payload).toMatchObject({ id: "doc-new", status: "pending" });
  });
});

describe("brand docs list", () => {
  it("forwards --kit and --status filters and numeric pagination", async () => {
    await runDocs([
      "list",
      "--quiet",
      "--kit",
      "kit-1",
      "--status",
      "failed",
      "--page-number",
      "3",
      "--page-size",
      "10",
    ]);
    expect(brandMocks.listDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        brandKitId: "kit-1",
        status: "failed",
        pageNumber: 3,
        pageSize: 10,
      })
    );
  });

  it("serializes the list response with --format json", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runDocs(["list", "--quiet", "--format", "json"]);
    const payload = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
    expect(payload.totalCount).toBe(1);
  });
});

describe("brand docs get", () => {
  it("passes the docId argument to getDocument", async () => {
    await runDocs(["get", "doc-1", "--quiet"]);
    expect(brandMocks.getDocument).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "doc-1" })
    );
  });
});

describe("brand docs delete (destructive)", () => {
  it("deletes when --force skips the confirmation", async () => {
    await runDocs(["delete", "doc-1", "--quiet", "--force"]);
    expect(brandMocks.deleteDocument).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "doc-1" })
    );
  });

  it("throws INPUT_INVALID without --force in a non-interactive shell", async () => {
    // The test environment is non-interactive (stdin/stdout `isTTY`
    // undefined), so confirmDestructive refuses without --force.
    await expect(runDocs(["delete", "doc-1", "--quiet"])).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
    expect(brandMocks.deleteDocument).not.toHaveBeenCalled();
  });
});
