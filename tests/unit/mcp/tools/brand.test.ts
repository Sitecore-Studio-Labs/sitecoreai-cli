import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpContext } from "../../../../src/mcp/auth";

/**
 * Mocks the brand SDK primitives + the root config reader. The MCP
 * tool dispatch layer routes verb/action → SDK fn; these tests
 * verify the routing + input validation without round-tripping to a
 * real tenant. Library behavior is covered separately in
 * tests/unit/brand/.
 */
const brandMocks = vi.hoisted(() => ({
  listBrandKits: vi.fn().mockResolvedValue({
    totalCount: 1,
    data: [{ id: "kit-1", name: "Sync", status: "published" }],
  }),
  getBrandKit: vi.fn().mockResolvedValue({ id: "kit-1", name: "Sync", status: "published" }),
  listBrandKitSections: vi
    .fn()
    .mockResolvedValue([{ id: "sec-1", name: "Brand Context", order: 1 }]),
  listBrandKitFields: vi
    .fn()
    .mockResolvedValue([{ id: "field-1", name: "Brand purpose", intent: "Why" }]),
  listDocuments: vi.fn().mockResolvedValue({
    totalCount: 1,
    data: [{ id: "doc-1", status: "processed" }],
  }),
  getDocument: vi.fn().mockResolvedValue({ id: "doc-1", status: "processed" }),
  createBrandKit: vi.fn().mockResolvedValue({ id: "new-kit", name: "X", status: "draft" }),
  publishBrandKit: vi.fn().mockResolvedValue({ id: "new-kit", status: "published" }),
  deleteBrandKit: vi.fn().mockResolvedValue(undefined),
  uploadDocument: vi.fn().mockResolvedValue({ id: "new-doc", status: "pending" }),
  deleteDocument: vi.fn().mockResolvedValue(undefined),
  runBrandIngestionPipeline: vi.fn().mockResolvedValue({ id: "run-1" }),
  runEnrichSectionsPipeline: vi.fn().mockResolvedValue({ id: "run-2" }),
  seedBrandKit: vi.fn().mockResolvedValue({
    kit: { id: "seeded-kit", name: "S", status: "published" },
    document: { id: "seeded-doc", status: "pending" },
    sections: [{ id: "sec-A", name: "Brand Context" }],
    elapsedSec: 42,
  }),
  generateBrandReview: vi.fn().mockResolvedValue({
    overallScore: 4,
    sectionResults: [{ section: "sec-1", score: 4 }],
  }),
  updateBrandKitField: vi.fn().mockResolvedValue({
    id: "field-1",
    name: "Brand purpose",
    type: "text",
    value: "Patched value",
    verified: true,
  }),
  LOCAL_UPLOAD_UNSUPPORTED_MESSAGE:
    "Local-file document upload is not supported — the Sitecore documents API has no working path for it.",
  LOCAL_UPLOAD_UNSUPPORTED_HINT:
    "Host the PDF at an HTTPS URL that Sitecore's edge can reach (S3, GitHub raw, a CDN), then upload it by URL — `--url <pdfUrl>` on the CLI, or the `url` field on the MCP tool.",
}));

vi.mock("../../../../src/brand/index", () => brandMocks);

// `readRootConfiguration` is overridable per-test so the
// resolveBrandClient error branches (no org, no credential) can be
// exercised. The default echoes a two-env / two-org workspace.
const defaultRootConfig = {
  defaultEnvironment: "test-env",
  environments: {
    "test-env": { organizationId: "org_ABC123", name: "test-env" },
    "prod-env": { organizationId: "org_PROD999", name: "prod-env" },
  },
  brand: {
    org_ABC123: { clientId: "client-x" },
    org_PROD999: { clientId: "client-prod" },
  },
};

const configMocks = vi.hoisted(() => ({
  readRootConfiguration: vi.fn(),
}));

vi.mock("../../../../src/config/root-config", () => ({
  readRootConfiguration: configMocks.readRootConfiguration,
}));

const fakeContext: McpContext = {
  envName: "test-env",
  configPath: "/tmp",
  resolved: {
    envName: "test-env",
    environment: {} as never,
    root: {} as never,
    timeoutMs: undefined,
  },
  allowWriteEnabled: false,
  deployToken: "tok",
};

const fakeExtra = {
  signal: new AbortController().signal,
  progressToken: undefined,
  sendProgress: vi.fn().mockResolvedValue(undefined),
  sendNotification: vi.fn().mockResolvedValue(undefined),
};

const setup = async () => {
  const { buildScaiMcpRegistry } = await import("../../../../src/mcp/build-registry");
  return buildScaiMcpRegistry();
};

beforeEach(() => {
  configMocks.readRootConfiguration.mockReset();
  configMocks.readRootConfiguration.mockReturnValue(defaultRootConfig);
});

describe("brand_inspect tool", () => {
  it("registers with read auth + readOnlyHint=true", async () => {
    const reg = await setup();
    const tool = reg.getTool("brand_inspect")!;
    expect(tool.auth).toBe("read");
    expect(tool.annotations.readOnlyHint).toBe(true);
  });

  it("routes verb='list-kits' to listBrandKits with pagination", async () => {
    const reg = await setup();
    await reg
      .getTool("brand_inspect")!
      .handler({ verb: "list-kits", pageNumber: 2, pageSize: 25 }, fakeContext, fakeExtra);
    expect(brandMocks.listBrandKits).toHaveBeenCalledWith(
      expect.objectContaining({ pageNumber: 2, pageSize: 25 })
    );
  });

  it("requires brandKitId for verb='get-kit'", async () => {
    const reg = await setup();
    await expect(
      reg.getTool("brand_inspect")!.handler({ verb: "get-kit" } as never, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("routes verb='list-sections' and returns the section count + array", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("brand_inspect")!
      .handler({ verb: "list-sections", brandKitId: "kit-1" }, fakeContext, fakeExtra);
    expect(brandMocks.listBrandKitSections).toHaveBeenCalledWith(
      expect.objectContaining({ brandKitId: "kit-1" })
    );
    expect(result.structuredContent).toMatchObject({
      verb: "list-sections",
      count: 1,
      sections: expect.any(Array),
    });
  });

  it("requires both brandKitId and sectionId for verb='list-fields'", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("brand_inspect")!
        .handler({ verb: "list-fields", brandKitId: "kit-1" } as never, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("forwards optional kit + status filters on verb='list-docs'", async () => {
    const reg = await setup();
    await reg
      .getTool("brand_inspect")!
      .handler(
        { verb: "list-docs", brandKitId: "kit-1", status: "failed" },
        fakeContext,
        fakeExtra
      );
    expect(brandMocks.listDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ brandKitId: "kit-1", status: "failed" })
    );
  });
});

describe("brand_inspect — remaining verbs", () => {
  it("routes verb='get-kit' to getBrandKit and returns the kit", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("brand_inspect")!
      .handler({ verb: "get-kit", brandKitId: "kit-1" }, fakeContext, fakeExtra);
    expect(brandMocks.getBrandKit).toHaveBeenCalledWith(
      expect.objectContaining({ brandKitId: "kit-1" })
    );
    expect(result.structuredContent).toMatchObject({ verb: "get-kit", kit: { id: "kit-1" } });
  });

  it("routes verb='list-fields' with brandKitId + sectionId", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("brand_inspect")!
      .handler(
        { verb: "list-fields", brandKitId: "kit-1", sectionId: "sec-1" },
        fakeContext,
        fakeExtra
      );
    expect(brandMocks.listBrandKitFields).toHaveBeenCalledWith(
      expect.objectContaining({ brandKitId: "kit-1", sectionId: "sec-1" })
    );
    expect(result.structuredContent).toMatchObject({ verb: "list-fields", count: 1 });
  });

  it("requires documentId for verb='get-doc'", async () => {
    const reg = await setup();
    await expect(
      reg.getTool("brand_inspect")!.handler({ verb: "get-doc" } as never, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("routes verb='get-doc' to getDocument", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("brand_inspect")!
      .handler({ verb: "get-doc", documentId: "doc-1" }, fakeContext, fakeExtra);
    expect(brandMocks.getDocument).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "doc-1" })
    );
    expect(result.structuredContent).toMatchObject({ verb: "get-doc" });
  });

  it("requires brandKitId for verb='list-sections'", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("brand_inspect")!
        .handler({ verb: "list-sections" } as never, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("brand_manage tool", () => {
  it("registers with write auth + destructiveHint=true", async () => {
    const reg = await setup();
    const tool = reg.getTool("brand_manage")!;
    expect(tool.auth).toBe("write");
    expect(tool.annotations.destructiveHint).toBe(true);
  });

  it("requires name for action='create-kit'", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("brand_manage")!
        .handler({ action: "create-kit", allowWrite: true } as never, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("dispatches action='create-kit' with metadata", async () => {
    const reg = await setup();
    await reg.getTool("brand_manage")!.handler(
      {
        action: "create-kit",
        name: "Spotify",
        industry: "music",
        allowWrite: true,
      },
      fakeContext,
      fakeExtra
    );
    expect(brandMocks.createBrandKit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Spotify", industry: "music" })
    );
  });

  it("dispatches action='publish-kit' and surfaces the new status", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("brand_manage")!
      .handler(
        { action: "publish-kit", brandKitId: "kit-1", allowWrite: true },
        fakeContext,
        fakeExtra
      );
    expect(brandMocks.publishBrandKit).toHaveBeenCalledWith(
      expect.objectContaining({ brandKitId: "kit-1" })
    );
    expect(result.structuredContent).toMatchObject({
      action: "publish-kit",
      kit: { status: "published" },
    });
  });

  it("upload-doc requires a url", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("brand_manage")!
        .handler(
          { action: "upload-doc", brandKitId: "kit-1", allowWrite: true } as never,
          fakeContext,
          fakeExtra
        )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("upload-doc rejects bytesBase64 without calling uploadDocument", async () => {
    const reg = await setup();
    brandMocks.uploadDocument.mockClear();
    await expect(
      reg.getTool("brand_manage")!.handler(
        {
          action: "upload-doc",
          brandKitId: "kit-1",
          bytesBase64: Buffer.from("pdf bytes", "utf8").toString("base64"),
          allowWrite: true,
        },
        fakeContext,
        fakeExtra
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(brandMocks.uploadDocument).not.toHaveBeenCalled();
  });

  it("upload-doc URL mode passes through to uploadDocument", async () => {
    const reg = await setup();
    await reg.getTool("brand_manage")!.handler(
      {
        action: "upload-doc",
        brandKitId: "kit-1",
        url: "https://x.com/a.pdf",
        title: "Guide",
        allowWrite: true,
      },
      fakeContext,
      fakeExtra
    );
    expect(brandMocks.uploadDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        brandKitId: "kit-1",
        source: { url: "https://x.com/a.pdf" },
        title: "Guide",
      })
    );
  });

  it("seed rejects bytesBase64 without calling seedBrandKit", async () => {
    const reg = await setup();
    brandMocks.seedBrandKit.mockClear();
    await expect(
      reg.getTool("brand_manage")!.handler(
        {
          action: "seed",
          name: "Acme",
          bytesBase64: Buffer.from("pdf bytes", "utf8").toString("base64"),
          allowWrite: true,
        },
        fakeContext,
        fakeExtra
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(brandMocks.seedBrandKit).not.toHaveBeenCalled();
  });

  it("update-field requires brandKitId + sectionId + fieldId", async () => {
    const reg = await setup();
    await expect(
      reg.getTool("brand_manage")!.handler(
        {
          action: "update-field",
          brandKitId: "kit-1",
          // missing sectionId + fieldId
          value: "x",
          allowWrite: true,
        } as never,
        fakeContext,
        fakeExtra
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("update-field requires at least one of value/intent/verified/aiEditable", async () => {
    const reg = await setup();
    await expect(
      reg.getTool("brand_manage")!.handler(
        {
          action: "update-field",
          brandKitId: "kit-1",
          sectionId: "sec-1",
          fieldId: "field-1",
          allowWrite: true,
        } as never,
        fakeContext,
        fakeExtra
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("update-field forwards string value to updateBrandKitField for text fields", async () => {
    const reg = await setup();
    await reg.getTool("brand_manage")!.handler(
      {
        action: "update-field",
        brandKitId: "kit-1",
        sectionId: "sec-1",
        fieldId: "field-1",
        value: "Allstate's voice is reassuring, plainspoken, confident.",
        verified: true,
        allowWrite: true,
      },
      fakeContext,
      fakeExtra
    );
    expect(brandMocks.updateBrandKitField).toHaveBeenCalledWith(
      expect.objectContaining({
        brandKitId: "kit-1",
        sectionId: "sec-1",
        fieldId: "field-1",
        value: "Allstate's voice is reassuring, plainspoken, confident.",
        verified: true,
      })
    );
  });

  it("update-field forwards array value (array / richArray fields)", async () => {
    const reg = await setup();
    const value = [
      { name: "Marketing scenario", tags: ["Marketing"], restrictions: "No urgency" },
      { name: "Claims scenario", tags: ["Claims"], restrictions: "No marketing CTA" },
    ];
    await reg.getTool("brand_manage")!.handler(
      {
        action: "update-field",
        brandKitId: "kit-1",
        sectionId: "sec-1",
        fieldId: "field-tone-scenarios",
        value,
        allowWrite: true,
      },
      fakeContext,
      fakeExtra
    );
    const call =
      brandMocks.updateBrandKitField.mock.calls[
        brandMocks.updateBrandKitField.mock.calls.length - 1
      ][0];
    expect(call.value).toEqual(value);
  });

  it("update-field returns the updated field in structuredContent", async () => {
    const reg = await setup();
    const result = await reg.getTool("brand_manage")!.handler(
      {
        action: "update-field",
        brandKitId: "kit-1",
        sectionId: "sec-1",
        fieldId: "field-1",
        verified: true,
        allowWrite: true,
      },
      fakeContext,
      fakeExtra
    );
    expect(result.structuredContent).toMatchObject({
      action: "update-field",
      field: { id: "field-1", verified: true },
    });
  });

  it("dispatches action='seed' and wires progress callback to extra.sendProgress", async () => {
    const reg = await setup();
    brandMocks.seedBrandKit.mockImplementationOnce(
      async (opts: {
        onProgress: (e: {
          stage: string;
          message: string;
          elapsedSec: number;
          sectionCount?: number;
        }) => void;
      }) => {
        opts.onProgress({ stage: "createKit", message: "creating", elapsedSec: 0 });
        opts.onProgress({ stage: "done", message: "done", elapsedSec: 60, sectionCount: 9 });
        return {
          kit: { id: "seeded-kit", name: "S", status: "published" },
          document: { id: "seeded-doc", status: "pending" },
          sections: [{ id: "sec-A", name: "Brand Context" }],
          elapsedSec: 60,
        };
      }
    );
    await reg.getTool("brand_manage")!.handler(
      {
        action: "seed",
        name: "Spotify",
        url: "https://x.com/a.pdf",
        allowWrite: true,
      },
      fakeContext,
      fakeExtra
    );
    // Two onProgress calls = two sendProgress invocations.
    expect(fakeExtra.sendProgress).toHaveBeenCalledTimes(2);
  });
});

describe("brand_manage — remaining actions + validation", () => {
  it("publish-kit without brandKitId throws INPUT_INVALID", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("brand_manage")!
        .handler({ action: "publish-kit", allowWrite: true } as never, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("delete-kit without brandKitId throws INPUT_INVALID", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("brand_manage")!
        .handler({ action: "delete-kit", allowWrite: true } as never, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("delete-kit routes to deleteBrandKit and reports deleted", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("brand_manage")!
      .handler(
        { action: "delete-kit", brandKitId: "kit-9", allowWrite: true },
        fakeContext,
        fakeExtra
      );
    expect(brandMocks.deleteBrandKit).toHaveBeenCalledWith(
      expect.objectContaining({ brandKitId: "kit-9" })
    );
    expect(result.structuredContent).toMatchObject({
      action: "delete-kit",
      brandKitId: "kit-9",
      deleted: true,
    });
  });

  it("delete-doc without documentId throws INPUT_INVALID", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("brand_manage")!
        .handler({ action: "delete-doc", allowWrite: true } as never, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("delete-doc routes to deleteDocument", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("brand_manage")!
      .handler(
        { action: "delete-doc", documentId: "doc-7", allowWrite: true },
        fakeContext,
        fakeExtra
      );
    expect(brandMocks.deleteDocument).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "doc-7" })
    );
    expect(result.structuredContent).toMatchObject({ action: "delete-doc", deleted: true });
  });

  it("run-ingestion without brandKitId throws INPUT_INVALID", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("brand_manage")!
        .handler({ action: "run-ingestion", allowWrite: true } as never, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("run-ingestion forwards documentIds + populateSections", async () => {
    const reg = await setup();
    await reg.getTool("brand_manage")!.handler(
      {
        action: "run-ingestion",
        brandKitId: "kit-1",
        documentIds: ["d-1"],
        populateSections: false,
        allowWrite: true,
      },
      fakeContext,
      fakeExtra
    );
    expect(brandMocks.runBrandIngestionPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        brandKitId: "kit-1",
        documentIds: ["d-1"],
        populateSections: false,
      })
    );
  });

  it("run-enrichment without brandKitId throws INPUT_INVALID", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("brand_manage")!
        .handler({ action: "run-enrichment", allowWrite: true } as never, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("run-enrichment forwards sectionIds + fieldIds", async () => {
    const reg = await setup();
    const result = await reg.getTool("brand_manage")!.handler(
      {
        action: "run-enrichment",
        brandKitId: "kit-1",
        sectionIds: ["sec-1"],
        fieldIds: ["f-1"],
        allowWrite: true,
      },
      fakeContext,
      fakeExtra
    );
    expect(brandMocks.runEnrichSectionsPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ sectionIds: ["sec-1"], fieldIds: ["f-1"] })
    );
    expect(result.structuredContent).toMatchObject({ action: "run-enrichment" });
  });

  it("seed without name throws INPUT_INVALID", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("brand_manage")!
        .handler(
          { action: "seed", url: "https://x.com/a.pdf", allowWrite: true } as never,
          fakeContext,
          fakeExtra
        )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("seed without url throws INPUT_INVALID", async () => {
    const reg = await setup();
    await expect(
      reg
        .getTool("brand_manage")!
        .handler(
          { action: "seed", name: "Acme", allowWrite: true } as never,
          fakeContext,
          fakeExtra
        )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("brand tools — resolveBrandClient error branches", () => {
  it("throws INPUT_INVALID when the target env has no organizationId", async () => {
    configMocks.readRootConfiguration.mockReturnValue({
      defaultEnvironment: "test-env",
      environments: { "test-env": { name: "test-env" } },
      brand: {},
    });
    const reg = await setup();
    await expect(
      reg.getTool("brand_inspect")!.handler({ verb: "list-kits" }, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("throws AUTH_BRAND_REQUIRED when no Brand credential is configured for the org", async () => {
    configMocks.readRootConfiguration.mockReturnValue({
      defaultEnvironment: "test-env",
      environments: { "test-env": { organizationId: "org_NOCRED", name: "test-env" } },
      brand: {},
    });
    const reg = await setup();
    await expect(
      reg.getTool("brand_inspect")!.handler({ verb: "list-kits" }, fakeContext, fakeExtra)
    ).rejects.toMatchObject({ code: "AUTH_BRAND_REQUIRED" });
  });
});

describe("brand_review tool", () => {
  it("registers with read auth despite being paid AI compute (server-side enforcement only)", async () => {
    const reg = await setup();
    const tool = reg.getTool("brand_review")!;
    expect(tool.auth).toBe("read");
    expect(tool.annotations.readOnlyHint).toBe(true);
  });

  it("forwards brandKitId + text + label to generateBrandReview", async () => {
    const reg = await setup();
    await reg.getTool("brand_review")!.handler(
      {
        brandKitId: "kit-1",
        text: "PUMPED to launch",
        label: "landing.md",
      },
      fakeContext,
      fakeExtra
    );
    expect(brandMocks.generateBrandReview).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { text: "PUMPED to launch", label: "landing.md" },
        selector: { brandKitId: "kit-1", sections: undefined },
      })
    );
  });

  it("expands sectionIds into Section[] selectors", async () => {
    const reg = await setup();
    await reg.getTool("brand_review")!.handler(
      {
        brandKitId: "kit-1",
        text: "copy",
        sectionIds: ["sec-1", "sec-2"],
        fieldIds: ["field-A"],
      },
      fakeContext,
      fakeExtra
    );
    const call =
      brandMocks.generateBrandReview.mock.calls[
        brandMocks.generateBrandReview.mock.calls.length - 1
      ][0];
    expect(call.selector.sections).toEqual([
      { sectionId: "sec-1", fieldIds: ["field-A"] },
      { sectionId: "sec-2", fieldIds: ["field-A"] },
    ]);
  });

  it("returns overallScore + sectionResultCount in structuredContent", async () => {
    const reg = await setup();
    const result = await reg
      .getTool("brand_review")!
      .handler({ brandKitId: "kit-1", text: "copy" }, fakeContext, fakeExtra);
    expect(result.structuredContent).toMatchObject({
      brandKitId: "kit-1",
      overallScore: 4,
      sectionResultCount: 1,
    });
  });
});

describe("brand tools — per-call environment retargeting (derive org)", () => {
  it("derives the bound env's org when environmentName is omitted", async () => {
    brandMocks.listBrandKits.mockClear();
    const reg = await setup();
    await reg.getTool("brand_inspect")!.handler({ verb: "list-kits" }, fakeContext, fakeExtra);
    const call = brandMocks.listBrandKits.mock.calls.at(-1)![0];
    expect(call.client.orgId).toBe("org_ABC123");
  });

  it("derives the TARGET env's org when environmentName is set", async () => {
    brandMocks.listBrandKits.mockClear();
    const reg = await setup();
    await reg
      .getTool("brand_inspect")!
      .handler({ verb: "list-kits", environmentName: "prod-env" }, fakeContext, fakeExtra);
    const call = brandMocks.listBrandKits.mock.calls.at(-1)![0];
    // Org is derived from `prod-env`'s organizationId — no separate orgId input.
    expect(call.client.orgId).toBe("org_PROD999");
  });

  it("brand_review derives org from the retargeted env", async () => {
    brandMocks.generateBrandReview.mockClear();
    const reg = await setup();
    await reg
      .getTool("brand_review")!
      .handler(
        { brandKitId: "kit-1", text: "copy", environmentName: "prod-env" },
        fakeContext,
        fakeExtra
      );
    const call = brandMocks.generateBrandReview.mock.calls.at(-1)![0];
    expect(call.client.orgId).toBe("org_PROD999");
  });
});
