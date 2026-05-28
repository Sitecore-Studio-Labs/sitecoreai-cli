import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/brand/kits/create", () => ({
  createBrandKit: vi.fn(),
  publishBrandKit: vi.fn(),
}));
vi.mock("../../../src/brand/kits/sections", () => ({
  listBrandKitSections: vi.fn(),
}));
vi.mock("../../../src/brand/documents/upload", () => ({
  uploadDocument: vi.fn(),
}));
vi.mock("../../../src/brand/pipeline/run", () => ({
  runBrandIngestionPipeline: vi.fn(),
  runEnrichSectionsPipeline: vi.fn(),
}));

import { seedBrandKit, enrichBrandKitWithDocuments } from "../../../src/brand/seed";
import { createBrandKit, publishBrandKit } from "../../../src/brand/kits/create";
import { listBrandKitSections } from "../../../src/brand/kits/sections";
import { uploadDocument } from "../../../src/brand/documents/upload";
import {
  runBrandIngestionPipeline,
  runEnrichSectionsPipeline,
} from "../../../src/brand/pipeline/run";

const CLIENT = { accessToken: "token", region: "eus" } as never;

const baseOptions = (overrides: Record<string, unknown> = {}) => ({
  client: CLIENT,
  name: "Acme",
  source: { url: "https://example.com/brand.pdf" },
  pollIntervalSec: 0,
  timeoutSec: 5,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createBrandKit).mockResolvedValue({ id: "kit-1", name: "Acme" } as never);
  vi.mocked(uploadDocument).mockResolvedValue({ id: "doc-1", status: "pending" } as never);
  vi.mocked(publishBrandKit).mockResolvedValue(undefined as never);
  vi.mocked(runBrandIngestionPipeline).mockResolvedValue({ id: "ingest-run" } as never);
  vi.mocked(runEnrichSectionsPipeline).mockResolvedValue({ id: "enrich-run" } as never);
  vi.mocked(listBrandKitSections).mockResolvedValue([{ id: "sec-1" }] as never);
});

describe("seedBrandKit — happy path (single source)", () => {
  it("drives create → upload → publish → ingest → enrich → poll in order", async () => {
    const result = await seedBrandKit(baseOptions());

    expect(createBrandKit).toHaveBeenCalledTimes(1);
    expect(uploadDocument).toHaveBeenCalledTimes(1);
    expect(publishBrandKit).toHaveBeenCalledWith({ client: CLIENT, brandKitId: "kit-1" });
    expect(runBrandIngestionPipeline).toHaveBeenCalledWith({
      client: CLIENT,
      brandKitId: "kit-1",
      populateSections: true,
      documentIds: ["doc-1"],
    });
    expect(runEnrichSectionsPipeline).toHaveBeenCalledWith({
      client: CLIENT,
      brandKitId: "kit-1",
    });
    expect(result.kit).toMatchObject({ id: "kit-1" });
    expect(result.document).toMatchObject({ id: "doc-1" });
    expect(result.sections).toHaveLength(1);
  });

  it("defaults the document title/summary when not supplied", async () => {
    await seedBrandKit(baseOptions());

    expect(uploadDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Acme Brand Guidelines",
        summary: "Source doc for Acme brand kit (seeded via scai)",
        type: "brand guidelines",
        fileType: "application/pdf",
      })
    );
  });

  it("uses caller-supplied document title/summary when provided", async () => {
    await seedBrandKit(
      baseOptions({ documentTitle: "Custom Title", documentSummary: "Custom Summary" })
    );

    expect(uploadDocument).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Custom Title", summary: "Custom Summary" })
    );
  });

  it("emits progress events covering every stage", async () => {
    const stages: string[] = [];
    await seedBrandKit(baseOptions({ onProgress: (e: { stage: string }) => stages.push(e.stage) }));

    expect(stages).toContain("createKit");
    expect(stages).toContain("uploadDocument");
    expect(stages).toContain("publishKit");
    expect(stages).toContain("runIngestion");
    expect(stages).toContain("runEnrichment");
    expect(stages).toContain("pollSections");
    expect(stages).toContain("done");
  });
});

describe("seedBrandKit — multiple documents", () => {
  it("uploads every document and passes all ids to ingestion", async () => {
    vi.mocked(uploadDocument)
      .mockResolvedValueOnce({ id: "doc-a" } as never)
      .mockResolvedValueOnce({ id: "doc-b" } as never);

    const result = await seedBrandKit(
      baseOptions({
        source: undefined,
        documents: [
          { kind: "url", url: "https://example.com/a.pdf", title: "A" },
          { kind: "url", url: "https://example.com/b.pdf" },
        ],
      })
    );

    expect(uploadDocument).toHaveBeenCalledTimes(2);
    expect(runBrandIngestionPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ documentIds: ["doc-a", "doc-b"] })
    );
    // `result.document` is the FIRST uploaded doc.
    expect(result.document).toMatchObject({ id: "doc-a" });
  });

  it("prefers `documents` over `source` when both are set", async () => {
    await seedBrandKit(
      baseOptions({
        documents: [{ kind: "url", url: "https://example.com/doc.pdf" }],
      })
    );

    expect(uploadDocument).toHaveBeenCalledTimes(1);
    expect(uploadDocument).toHaveBeenCalledWith(
      expect.objectContaining({ source: { url: "https://example.com/doc.pdf" } })
    );
  });

  it("rejects a registry-file document with INPUT_INVALID before any API call", async () => {
    // The Sitecore Documents API has no working bytes-upload path
    // (verified empirically; see LOCAL_UPLOAD_UNSUPPORTED_MESSAGE in
    // src/brand/documents/upload.ts). seedBrandKit fails fast so the
    // operator gets a clear hint pointing at the orchestrator-side
    // translation step, not a confusing 400 from the upload endpoint.
    await expect(
      seedBrandKit(
        baseOptions({
          source: undefined,
          documents: [{ kind: "registry-file", path: "brand-docs/voice.pdf" }],
        })
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(uploadDocument).not.toHaveBeenCalled();
  });
});

describe("seedBrandKit — input validation + error paths", () => {
  it("throws INPUT_INVALID when neither source nor documents is provided", async () => {
    await expect(
      seedBrandKit(baseOptions({ source: undefined, documents: undefined }))
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(createBrandKit).toHaveBeenCalledTimes(1);
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  it("treats an empty `documents` array with no source as INPUT_INVALID", async () => {
    await expect(
      seedBrandKit(baseOptions({ source: undefined, documents: [] }))
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("throws a timeout error when sections never populate", async () => {
    vi.useFakeTimers();
    vi.mocked(listBrandKitSections).mockResolvedValue([] as never);
    try {
      const promise = seedBrandKit(baseOptions({ pollIntervalSec: 1, timeoutSec: 3 }));
      const assertion = expect(promise).rejects.toThrow(/Timed out after 3s/);
      await vi.runAllTimersAsync();
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts mid-poll when the AbortSignal is already triggered", async () => {
    vi.mocked(listBrandKitSections).mockResolvedValue([] as never);
    const controller = new AbortController();
    controller.abort();

    await expect(
      seedBrandKit(baseOptions({ signal: controller.signal, timeoutSec: 5 }))
    ).rejects.toThrow(/aborted by signal/);
  });

  it("breaks the poll loop as soon as sections appear (no sleep)", async () => {
    vi.mocked(listBrandKitSections)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ id: "sec-1" }, { id: "sec-2" }] as never);

    const result = await seedBrandKit(baseOptions({ pollIntervalSec: 0 }));

    expect(listBrandKitSections).toHaveBeenCalledTimes(2);
    expect(result.sections).toHaveLength(2);
  });
});

describe("enrichBrandKitWithDocuments — self-heal entry point", () => {
  const enrichOptions = (overrides: Record<string, unknown> = {}) => ({
    client: CLIENT,
    brandKitId: "kit-stuck",
    name: "Acme",
    documents: [{ kind: "url" as const, url: "https://example.com/stub.pdf" }],
    pollIntervalSec: 0,
    timeoutSec: 5,
    ...overrides,
  });

  it("drives upload -> publish -> ingest -> enrich -> poll against the existing kit (no createBrandKit call)", async () => {
    const result = await enrichBrandKitWithDocuments(enrichOptions());

    // The whole point of this entry point: it does NOT create a new kit.
    expect(createBrandKit).not.toHaveBeenCalled();
    expect(uploadDocument).toHaveBeenCalledWith(
      expect.objectContaining({ brandKitId: "kit-stuck", type: "brand guidelines" })
    );
    expect(publishBrandKit).toHaveBeenCalledWith({ client: CLIENT, brandKitId: "kit-stuck" });
    expect(runBrandIngestionPipeline).toHaveBeenCalledWith({
      client: CLIENT,
      brandKitId: "kit-stuck",
      populateSections: true,
      documentIds: ["doc-1"],
    });
    expect(runEnrichSectionsPipeline).toHaveBeenCalledWith({
      client: CLIENT,
      brandKitId: "kit-stuck",
    });
    expect(result.document).toMatchObject({ id: "doc-1" });
    expect(result.sections).toHaveLength(1);
  });

  it("defaults document title/summary against the kit name when not supplied", async () => {
    await enrichBrandKitWithDocuments(enrichOptions());

    expect(uploadDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Acme Brand Guidelines",
        summary: "Source doc for Acme brand kit (seeded via scai)",
      })
    );
  });

  it("uses the caller-supplied document title/summary when provided", async () => {
    await enrichBrandKitWithDocuments(
      enrichOptions({
        documents: [
          {
            kind: "url" as const,
            url: "https://example.com/stub.pdf",
            title: "Stub",
            summary: "Self-heal stub",
          },
        ],
      })
    );

    expect(uploadDocument).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Stub", summary: "Self-heal stub" })
    );
  });

  it("uploads every document and passes all ids to ingestion", async () => {
    vi.mocked(uploadDocument)
      .mockResolvedValueOnce({ id: "doc-a" } as never)
      .mockResolvedValueOnce({ id: "doc-b" } as never);

    await enrichBrandKitWithDocuments(
      enrichOptions({
        documents: [
          { kind: "url" as const, url: "https://example.com/a.pdf" },
          { kind: "url" as const, url: "https://example.com/b.pdf" },
        ],
      })
    );

    expect(uploadDocument).toHaveBeenCalledTimes(2);
    expect(runBrandIngestionPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ documentIds: ["doc-a", "doc-b"] })
    );
  });

  it("emits progress events covering every stage", async () => {
    const stages: string[] = [];
    await enrichBrandKitWithDocuments(
      enrichOptions({ onProgress: (e: { stage: string }) => stages.push(e.stage) })
    );

    expect(stages).toContain("uploadDocument");
    expect(stages).toContain("publishKit");
    expect(stages).toContain("runIngestion");
    expect(stages).toContain("runEnrichment");
    expect(stages).toContain("pollSections");
    expect(stages).toContain("done");
    // createKit MUST NOT appear — this entry point operates on an existing kit.
    expect(stages).not.toContain("createKit");
  });

  it("rejects an empty documents array with INPUT_INVALID", async () => {
    await expect(
      enrichBrandKitWithDocuments(enrichOptions({ documents: [] }))
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects a registry-file document with INPUT_INVALID + a host-it-at-a-URL hint", async () => {
    await expect(
      enrichBrandKitWithDocuments(
        enrichOptions({
          documents: [{ kind: "registry-file" as const, path: "./brand.pdf" }],
        })
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("throws when the signal aborts mid-poll", async () => {
    vi.mocked(listBrandKitSections).mockResolvedValue([] as never);
    const controller = new AbortController();
    controller.abort();

    await expect(
      enrichBrandKitWithDocuments(enrichOptions({ signal: controller.signal, timeoutSec: 5 }))
    ).rejects.toThrow(/aborted by signal/);
  });

  it("breaks the poll loop as soon as sections appear (no sleep between polls)", async () => {
    vi.mocked(listBrandKitSections)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ id: "sec-a" }, { id: "sec-b" }] as never);

    const result = await enrichBrandKitWithDocuments(enrichOptions({ pollIntervalSec: 0 }));

    expect(listBrandKitSections).toHaveBeenCalledTimes(2);
    expect(result.sections).toHaveLength(2);
  });

  it("throws when the poll loop times out without sections appearing", async () => {
    vi.mocked(listBrandKitSections).mockResolvedValue([] as never);

    await expect(
      enrichBrandKitWithDocuments(enrichOptions({ pollIntervalSec: 0, timeoutSec: 0 }))
    ).rejects.toThrow(/Timed out/);
  });
});
