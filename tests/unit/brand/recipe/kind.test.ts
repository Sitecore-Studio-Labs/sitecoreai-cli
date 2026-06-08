import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncContext } from "../../../../src/sync";
import type { Logger } from "../../../../src/shared/logger";

// Stub the env → client bridge so the kind never reads real config.
vi.mock("../../../../src/brand/recipe/client", () => ({
  resolveBrandClient: () => ({ orgId: "org", credential: {} }),
}));

// Mock the Brand Management API surface the kind composes.
const brandApi = vi.hoisted(() => ({
  listBrandKits: vi.fn(),
  listBrandKitSections: vi.fn(),
  listBrandKitFields: vi.fn(),
  updateBrandKitField: vi.fn(),
  createBrandKitSectionField: vi.fn(),
  seedBrandKit: vi.fn(),
  createBrandKit: vi.fn(),
  enrichBrandKitWithDocuments: vi.fn(),
}));
vi.mock("../../../../src/brand", () => brandApi);

import { brandKitKind } from "../../../../src/brand/recipe/kind";

const ctx: SyncContext = {
  environmentName: "test",
  logger: { info: vi.fn() } as unknown as Logger,
};
const ref = { kind: "brand-kit", id: "Acme" } as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("brandKitKind", () => {
  it("exposes the recipe-kind contract", () => {
    expect(brandKitKind.name).toBe("brand-kit");
    expect(brandKitKind.schema).toBeDefined();
    expect(typeof brandKitKind.readCurrent).toBe("function");
    expect(typeof brandKitKind.apply).toBe("function");
    expect(typeof brandKitKind.list).toBe("function");
  });
});

describe("list", () => {
  it("enumerates every brand kit as KindRefs, paging the list endpoint", async () => {
    brandApi.listBrandKits
      .mockResolvedValueOnce({
        totalCount: 3,
        pageSize: 2,
        data: [
          { id: "k1", name: "Acme" },
          { id: "k2", name: "Globex" },
        ],
      })
      .mockResolvedValueOnce({
        totalCount: 3,
        pageSize: 2,
        data: [{ id: "k3", name: "Initech" }],
      });

    const refs = await brandKitKind.list?.(ctx);

    expect(refs).toEqual([
      { kind: "brand-kit", id: "Acme" },
      { kind: "brand-kit", id: "Globex" },
      { kind: "brand-kit", id: "Initech" },
    ]);
    expect(brandApi.listBrandKits).toHaveBeenCalledTimes(2);
  });

  it("pages the list endpoint when a page omits pageSize", async () => {
    brandApi.listBrandKits
      .mockResolvedValueOnce({ totalCount: 2, data: [{ id: "k1", name: "Acme" }] })
      .mockResolvedValueOnce({ totalCount: 2, data: [{ id: "k2", name: "Globex" }] });

    const refs = await brandKitKind.list?.(ctx);
    expect(refs).toEqual([
      { kind: "brand-kit", id: "Acme" },
      { kind: "brand-kit", id: "Globex" },
    ]);
    expect(brandApi.listBrandKits).toHaveBeenCalledTimes(2);
  });

  it("stops paging when a page returns no data", async () => {
    brandApi.listBrandKits.mockResolvedValueOnce({ totalCount: 0, pageSize: 50, data: [] });
    expect(await brandKitKind.list?.(ctx)).toEqual([]);
    expect(brandApi.listBrandKits).toHaveBeenCalledTimes(1);
  });
});

describe("readCurrent", () => {
  it("returns null when no kit matches the name", async () => {
    brandApi.listBrandKits.mockResolvedValue({ totalCount: 0, data: [] });
    expect(await brandKitKind.readCurrent({ kind: "brand-kit", id: "Nope" }, ctx)).toBeNull();
  });

  it("builds a recipe from kit + sections + fields, dropping server ids", async () => {
    brandApi.listBrandKits.mockResolvedValue({
      totalCount: 1,
      data: [{ id: "kit-1", name: "Acme", industry: "retail" }],
    });
    brandApi.listBrandKitSections.mockResolvedValue([{ id: "sec-1", name: "Tone of Voice" }]);
    brandApi.listBrandKitFields.mockResolvedValue([
      { id: "fld-1", name: "Voice", type: "text", value: "Confident" },
      { id: "fld-2", name: "Personality", type: "array", value: [{ id: "e1", name: "Bold" }] },
    ]);

    const recipe = await brandKitKind.readCurrent(ref, ctx);
    expect(recipe).toMatchObject({
      name: "Acme",
      industry: "retail",
      sections: {
        "Tone of Voice": {
          Voice: "Confident",
          // `array` entries round-trip as `{name}` objects (server `id`s dropped).
          Personality: [{ name: "Bold" }],
        },
      },
    });
  });
});

describe("apply", () => {
  it("updates a field on an existing kit", async () => {
    brandApi.listBrandKits.mockResolvedValue({
      totalCount: 1,
      data: [{ id: "kit-1", name: "Acme" }],
    });
    brandApi.listBrandKitSections.mockResolvedValue([{ id: "sec-1", name: "Tone of Voice" }]);
    brandApi.listBrandKitFields.mockResolvedValue([{ id: "fld-1", name: "Voice", type: "text" }]);
    brandApi.updateBrandKitField.mockResolvedValue({});

    const result = await brandKitKind.apply(
      {
        changes: [
          {
            kind: "update",
            path: "sections.Tone of Voice.Voice",
            summary: "Voice",
            after: "New voice",
            meta: { stage: "field", section: "Tone of Voice", field: "Voice" },
          },
        ],
      },
      ref,
      ctx
    );

    expect(brandApi.updateBrandKitField).toHaveBeenCalledWith(
      expect.objectContaining({ sectionId: "sec-1", fieldId: "fld-1", value: "New voice" })
    );
    expect(result.applied).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it("coerces a stray string into a richArray field's object-array shape", async () => {
    // An LLM-generated recipe can hand a plain string to a richArray
    // field ("Tone scenarios" / "Image style scenarios"). Writing it raw
    // corrupts the field so the Sitecore app's section page throws. The
    // write must wrap it as `[{ name }]` to match the live field type.
    brandApi.listBrandKits.mockResolvedValue({
      totalCount: 1,
      data: [{ id: "kit-1", name: "Acme" }],
    });
    brandApi.listBrandKitSections.mockResolvedValue([{ id: "sec-1", name: "Tone of Voice" }]);
    brandApi.listBrandKitFields.mockResolvedValue([
      { id: "fld-9", name: "Tone scenarios", type: "richArray" },
    ]);
    brandApi.updateBrandKitField.mockResolvedValue({});

    await brandKitKind.apply(
      {
        changes: [
          {
            kind: "update",
            path: "sections.Tone of Voice.Tone scenarios",
            summary: "Tone scenarios",
            after: "Be warm but precise.",
            meta: {
              stage: "field",
              section: "Tone of Voice",
              field: "Tone scenarios",
            },
          },
        ],
      },
      ref,
      ctx
    );

    expect(brandApi.updateBrandKitField).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldId: "fld-9",
        // richArray entries always carry tags + restrictions so the
        // Sitecore AI section render's `entry.tags.map(...)` never hits
        // undefined.
        value: [{ name: "Be warm but precise.", tags: [], restrictions: "" }],
      })
    );
  });

  it("flattens an object-array into a text field's string shape", async () => {
    brandApi.listBrandKits.mockResolvedValue({
      totalCount: 1,
      data: [{ id: "kit-1", name: "Acme" }],
    });
    brandApi.listBrandKitSections.mockResolvedValue([{ id: "sec-1", name: "Tone of Voice" }]);
    brandApi.listBrandKitFields.mockResolvedValue([{ id: "fld-1", name: "Voice", type: "text" }]);
    brandApi.updateBrandKitField.mockResolvedValue({});

    await brandKitKind.apply(
      {
        changes: [
          {
            kind: "update",
            path: "sections.Tone of Voice.Voice",
            summary: "Voice",
            after: [{ name: "Confident" }, { name: "Warm" }],
            meta: { stage: "field", section: "Tone of Voice", field: "Voice" },
          },
        ],
      },
      ref,
      ctx
    );

    expect(brandApi.updateBrandKitField).toHaveBeenCalledWith(
      expect.objectContaining({ fieldId: "fld-1", value: "Confident\nWarm" })
    );
  });

  it("creates a Glossary term field that does not exist yet", async () => {
    // Glossary terms are FIELDS the enrichment pipeline never creates,
    // so the section starts empty. A term change must CREATE the field
    // (name = term, type = array, value = locale rows) rather than skip.
    brandApi.listBrandKits.mockResolvedValue({
      totalCount: 1,
      data: [{ id: "kit-1", name: "Acme" }],
    });
    brandApi.listBrandKitSections.mockResolvedValue([
      { id: "sec-g", name: "Glossary and Localization" },
    ]);
    brandApi.listBrandKitFields.mockResolvedValue([]); // empty glossary section
    brandApi.createBrandKitSectionField.mockResolvedValue({});

    const result = await brandKitKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "sections.Glossary and Localization.Sync",
            summary: "Sync",
            after: [{ term: "Sync", locale: "ja-JP", displayName: "Japanese (Japan)" }],
            meta: { stage: "field", section: "Glossary and Localization", field: "Sync" },
          },
        ],
      },
      ref,
      ctx
    );

    expect(brandApi.createBrandKitSectionField).toHaveBeenCalledWith(
      expect.objectContaining({
        sectionId: "sec-g",
        name: "Sync",
        type: "array",
        value: [{ term: "Sync", locale: "ja-JP", displayName: "Japanese (Japan)" }],
      })
    );
    expect(result.applied).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it("preserves {term, locale, displayName} when writing an existing glossary field", async () => {
    // The array-type coercion must NOT flatten glossary rows to {name}.
    brandApi.listBrandKits.mockResolvedValue({
      totalCount: 1,
      data: [{ id: "kit-1", name: "Acme" }],
    });
    brandApi.listBrandKitSections.mockResolvedValue([
      { id: "sec-g", name: "Glossary and Localization" },
    ]);
    brandApi.listBrandKitFields.mockResolvedValue([{ id: "fld-g", name: "Sync", type: "array" }]);
    brandApi.updateBrandKitField.mockResolvedValue({});

    await brandKitKind.apply(
      {
        changes: [
          {
            kind: "update",
            path: "sections.Glossary and Localization.Sync",
            summary: "Sync",
            after: [{ term: "Sync", locale: "fr-FR", displayName: "French (France)" }],
            meta: { stage: "field", section: "Glossary and Localization", field: "Sync" },
          },
        ],
      },
      ref,
      ctx
    );

    expect(brandApi.updateBrandKitField).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldId: "fld-g",
        value: [{ term: "Sync", locale: "fr-FR", displayName: "French (France)" }],
      })
    );
    expect(brandApi.createBrandKitSectionField).not.toHaveBeenCalled();
  });

  it("skips a field change that does not resolve to a kit field", async () => {
    brandApi.listBrandKits.mockResolvedValue({
      totalCount: 1,
      data: [{ id: "kit-1", name: "Acme" }],
    });
    brandApi.listBrandKitSections.mockResolvedValue([]);

    const result = await brandKitKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "sections.X.Y",
            summary: "Y",
            after: "v",
            meta: { stage: "field", section: "X", field: "Y" },
          },
        ],
      },
      ref,
      ctx
    );

    expect(brandApi.updateBrandKitField).not.toHaveBeenCalled();
    expect(result.skipped).toHaveLength(1);
  });

  it("seeds the kit with every document when the plan creates a kit", async () => {
    brandApi.seedBrandKit.mockResolvedValue({ kit: { id: "kit-9", name: "New" } });
    brandApi.listBrandKitSections.mockResolvedValue([]);

    const result = await brandKitKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "kit",
            summary: 'Create brand kit "New"',
            after: "New",
            meta: { stage: "kit" },
          },
          {
            kind: "create",
            path: "documents[0]",
            summary: "ingest a",
            after: "https://x.test/a.pdf",
            meta: { stage: "document", document: { url: "https://x.test/a.pdf" } },
          },
          {
            kind: "create",
            path: "documents[1]",
            summary: "ingest b",
            after: "https://x.test/b.pdf",
            meta: { stage: "document", document: { url: "https://x.test/b.pdf" } },
          },
        ],
      },
      { kind: "brand-kit", id: "New" },
      ctx
    );

    expect(brandApi.seedBrandKit).toHaveBeenCalledOnce();
    // Gap-2 fix: all documents in the plan reach seedBrandKit, not just the first.
    const seedArgs = brandApi.seedBrandKit.mock.calls[0][0] as { documents: unknown[] };
    expect(seedArgs.documents).toHaveLength(2);
    expect(result.applied).toHaveLength(3);
  });

  it("forwards the seed onProgress callback to the logger", async () => {
    brandApi.seedBrandKit.mockImplementation(
      async (args: {
        onProgress?: (e: { elapsedSec: number; stage: string; message: string }) => void;
      }) => {
        args.onProgress?.({ elapsedSec: 3, stage: "ingest", message: "running" });
        return { kit: { id: "kit-9", name: "New" } };
      }
    );
    brandApi.listBrandKitSections.mockResolvedValue([]);
    const info = vi.fn();
    const progressCtx: SyncContext = {
      environmentName: "test",
      logger: { info } as unknown as Logger,
    };

    await brandKitKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "kit",
            summary: "create",
            after: "New",
            meta: { stage: "kit", description: "desc", industry: "tech" },
          },
          {
            kind: "create",
            path: "documents[0]",
            summary: "doc",
            after: "https://x.test/a.pdf",
            meta: { stage: "document", document: { url: "https://x.test/a.pdf" } },
          },
        ],
      },
      { kind: "brand-kit", id: "New" },
      progressCtx
    );

    const seedArgs = brandApi.seedBrandKit.mock.calls[0][0] as {
      description?: string;
      industry?: string;
    };
    expect(seedArgs.description).toBe("desc");
    expect(seedArgs.industry).toBe("tech");
    expect(info).toHaveBeenCalledWith(expect.stringContaining("[+3s] ingest: running"));
  });

  it("synthesizes a stub document when the plan has field changes but no operator documents", async () => {
    // Sections only exist after EnrichSections runs over an uploaded
    // document. If the operator declared field values but no doc, the
    // kind synthesizes a stub PDF naming the sections so enrichment
    // produces the canonical section set; field values then converge.
    brandApi.seedBrandKit.mockResolvedValue({ kit: { id: "kit-syn", name: "Acme" } });
    brandApi.listBrandKitSections.mockResolvedValue([
      { id: "sec-gg", name: "Global Goals" },
      { id: "sec-bc", name: "Brand Context" },
    ]);
    brandApi.listBrandKitFields.mockImplementation(({ sectionId }: { sectionId: string }) =>
      Promise.resolve(
        sectionId === "sec-gg"
          ? [{ id: "fld-cm", name: "contentMission", type: "text" }]
          : [{ id: "fld-desc", name: "description", type: "text" }]
      )
    );
    brandApi.updateBrandKitField.mockResolvedValue({});

    const result = await brandKitKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "kit",
            summary: "create",
            after: "Acme",
            meta: { stage: "kit" },
          },
          {
            kind: "create",
            path: "sections.Global Goals.contentMission",
            summary: "contentMission",
            after: "Inform every reader.",
            meta: { stage: "field", section: "Global Goals", field: "contentMission" },
          },
          {
            kind: "create",
            path: "sections.Brand Context.description",
            summary: "description",
            after: "Acme is a thing.",
            meta: { stage: "field", section: "Brand Context", field: "description" },
          },
        ],
      },
      { kind: "brand-kit", id: "Acme" },
      ctx
    );

    // seedBrandKit must be called — not createBrandKit — because the
    // synthesis path goes through the full pipeline.
    expect(brandApi.createBrandKit).not.toHaveBeenCalled();
    expect(brandApi.seedBrandKit).toHaveBeenCalledOnce();
    const seedArgs = brandApi.seedBrandKit.mock.calls[0][0] as {
      documents: Array<{ kind: string; url: string; tags?: string[] }>;
    };
    expect(seedArgs.documents).toHaveLength(1);
    expect(seedArgs.documents[0].kind).toBe("url");
    expect(seedArgs.documents[0].url.startsWith("data:application/pdf;base64,")).toBe(true);
    expect(seedArgs.documents[0].tags).toEqual(["scai-synthesized", "stub"]);

    // Both field PATCHes converge after the kit is seeded.
    expect(brandApi.updateBrandKitField).toHaveBeenCalledTimes(2);
    expect(result.applied.length).toBeGreaterThanOrEqual(2);
  });

  it("creates a bare kit (no seed) when the plan has a kit change but no documents", async () => {
    brandApi.createBrandKit.mockResolvedValue({ id: "kit-bare", name: "Bare" });
    brandApi.listBrandKitSections.mockResolvedValue([]);

    const result = await brandKitKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "kit",
            summary: "create",
            after: "Bare",
            meta: { stage: "kit", description: "d", industry: "i" },
          },
        ],
      },
      { kind: "brand-kit", id: "Bare" },
      ctx
    );

    expect(brandApi.createBrandKit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Bare", description: "d", industry: "i" })
    );
    expect(brandApi.seedBrandKit).not.toHaveBeenCalled();
    expect(result.applied).toHaveLength(1);
  });

  it("self-heals a pre-existing bare kit by synthesizing a stub doc and running enrichment", async () => {
    // A kit previously created without sections (older scai, or a
    // direct createBrandKit call) is stuck — every field write
    // skips because no section IDs exist. This test verifies the
    // self-heal: when the existing kit has zero sections AND there
    // are pending field writes, the kind synthesizes a stub doc and
    // runs enrichBrandKitWithDocuments against the existing kit id.
    brandApi.listBrandKits.mockResolvedValue({
      totalCount: 1,
      data: [{ id: "kit-stuck", name: "Acme" }],
    });
    // First listBrandKitSections call (in the self-heal pre-check) →
    // empty; second call (inside indexFields after enrichment) →
    // populated.
    brandApi.listBrandKitSections.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: "sec-gg", name: "Global Goals" },
      { id: "sec-bc", name: "Brand Context" },
    ]);
    brandApi.listBrandKitFields.mockImplementation(({ sectionId }: { sectionId: string }) =>
      Promise.resolve(
        sectionId === "sec-gg"
          ? [{ id: "fld-cm", name: "contentMission", type: "text" }]
          : [{ id: "fld-desc", name: "description", type: "text" }]
      )
    );
    brandApi.enrichBrandKitWithDocuments.mockResolvedValue({
      document: { id: "doc-stub" },
      sections: [
        { id: "sec-gg", name: "Global Goals" },
        { id: "sec-bc", name: "Brand Context" },
      ],
      elapsedSec: 300,
    });
    brandApi.updateBrandKitField.mockResolvedValue({});

    const result = await brandKitKind.apply(
      {
        changes: [
          // No kit change — kit exists. Only field writes.
          {
            kind: "create",
            path: "sections.Global Goals.contentMission",
            summary: "contentMission",
            after: "Inform every reader.",
            meta: { stage: "field", section: "Global Goals", field: "contentMission" },
          },
          {
            kind: "create",
            path: "sections.Brand Context.description",
            summary: "description",
            after: "Acme is a thing.",
            meta: { stage: "field", section: "Brand Context", field: "description" },
          },
        ],
      },
      { kind: "brand-kit", id: "Acme" },
      ctx
    );

    expect(brandApi.enrichBrandKitWithDocuments).toHaveBeenCalledOnce();
    const enrichArgs = brandApi.enrichBrandKitWithDocuments.mock.calls[0][0] as {
      brandKitId: string;
      documents: Array<{ kind: string; url: string; tags?: string[] }>;
    };
    expect(enrichArgs.brandKitId).toBe("kit-stuck");
    expect(enrichArgs.documents).toHaveLength(1);
    expect(enrichArgs.documents[0].url.startsWith("data:application/pdf;base64,")).toBe(true);
    expect(enrichArgs.documents[0].tags).toEqual(["scai-synthesized", "stub"]);

    // After enrichment, the two field writes converge.
    expect(brandApi.updateBrandKitField).toHaveBeenCalledTimes(2);
    expect(result.applied).toHaveLength(2);
  });

  it("does not run the self-heal when the existing kit already has sections", async () => {
    brandApi.listBrandKits.mockResolvedValue({
      totalCount: 1,
      data: [{ id: "kit-healthy", name: "Acme" }],
    });
    brandApi.listBrandKitSections.mockResolvedValue([{ id: "sec-gg", name: "Global Goals" }]);
    brandApi.listBrandKitFields.mockResolvedValue([
      { id: "fld-cm", name: "contentMission", type: "text" },
    ]);
    brandApi.updateBrandKitField.mockResolvedValue({});

    await brandKitKind.apply(
      {
        changes: [
          {
            kind: "update",
            path: "sections.Global Goals.contentMission",
            summary: "contentMission",
            after: "Updated mission.",
            meta: { stage: "field", section: "Global Goals", field: "contentMission" },
          },
        ],
      },
      { kind: "brand-kit", id: "Acme" },
      ctx
    );

    expect(brandApi.enrichBrandKitWithDocuments).not.toHaveBeenCalled();
    expect(brandApi.updateBrandKitField).toHaveBeenCalledOnce();
  });

  it("self-heals AND surfaces a diagnostic when sections exist but no targets resolve post-enrichment", async () => {
    // The "stuck kit" shape this covers: live kit has sections + fields,
    // but their names don't match the recipe (so writes can't resolve).
    // Self-heal fires (anyTargetReachable=false), enrichment runs, but
    // post-enrich the names still mismatch — every write skips, and
    // the diagnostic block names the recipe targets + live structure.
    brandApi.listBrandKits.mockResolvedValue({
      totalCount: 1,
      data: [{ id: "kit-mismatch", name: "Acme" }],
    });
    // Same response for both the initial probe (in self-heal block)
    // and the post-enrich re-index — the live shape never converges
    // with the recipe's section names.
    brandApi.listBrandKitSections.mockResolvedValue([{ id: "sec-legacy", name: "Legacy Section" }]);
    brandApi.listBrandKitFields.mockResolvedValue([
      { id: "fld-legacy", name: "legacyField", type: "text" },
    ]);
    brandApi.enrichBrandKitWithDocuments.mockImplementation(
      (args: {
        onProgress?: (e: { elapsedSec: number; stage: string; message: string }) => void;
      }) => {
        // Drive onProgress so the kind's `[+Ns] stage: msg` log line runs.
        args.onProgress?.({ elapsedSec: 60, stage: "upload", message: "uploading stub" });
        args.onProgress?.({ elapsedSec: 120, stage: "enrich", message: "enriching" });
        return Promise.resolve({
          document: { id: "doc-stub" },
          sections: [{ id: "sec-legacy", name: "Legacy Section" }],
          elapsedSec: 120,
        });
      }
    );

    const infoSpy = ctx.logger?.info as ReturnType<typeof vi.fn>;

    const result = await brandKitKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "sections.Global Goals.contentMission",
            summary: "contentMission",
            after: "Inform every reader.",
            meta: { stage: "field", section: "Global Goals", field: "contentMission" },
          },
        ],
      },
      { kind: "brand-kit", id: "Acme" },
      ctx
    );

    // Broadened self-heal trigger: live index non-empty but no targets reachable.
    expect(brandApi.enrichBrandKitWithDocuments).toHaveBeenCalledOnce();
    expect(brandApi.updateBrandKitField).not.toHaveBeenCalled();
    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);

    // Diagnostic block surfaces the mismatch: live sections, recipe
    // targets, and the `pull` suggestion.
    const infoCalls = infoSpy.mock.calls.map((c) => String(c[0]));
    expect(infoCalls.some((m) => m.includes("Every field write skipped"))).toBe(true);
    expect(infoCalls.some((m) => m.includes("Legacy Section"))).toBe(true);
    expect(infoCalls.some((m) => m.includes("Global Goals / contentMission"))).toBe(true);
    expect(infoCalls.some((m) => m.includes("scai brand sync pull"))).toBe(true);
    // Per-section live-fields log lines (the loop over liveFieldsBySection).
    expect(infoCalls.some((m) => /live: Legacy Section -> \[legacyField\]/.test(m))).toBe(true);
  });

  it("refuses to create a new kit when ctx.skipEnrichment is set", async () => {
    // --no-enrich + kit creation is incoherent: sections only exist
    // after enrichment, so PATCHes can't land. Refuse with a clear
    // INPUT_INVALID rather than silently creating a bare kit + every
    // field skipped.
    const noEnrichCtx: SyncContext = { ...ctx, skipEnrichment: true };
    await expect(
      brandKitKind.apply(
        {
          changes: [
            {
              kind: "create",
              path: "kit",
              summary: "create",
              after: "Acme",
              meta: { stage: "kit" },
            },
          ],
        },
        { kind: "brand-kit", id: "Acme" },
        noEnrichCtx
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(brandApi.seedBrandKit).not.toHaveBeenCalled();
    expect(brandApi.createBrandKit).not.toHaveBeenCalled();
  });

  it("skips the self-heal enrichment cycle when ctx.skipEnrichment is set", async () => {
    // Existing kit with no reachable targets is the self-heal trigger.
    // With --no-enrich, the operator opted out — log + proceed to the
    // PATCH loop (which will skip everything), but don't run the
    // 5-15-minute enrichment pipeline.
    brandApi.listBrandKits.mockResolvedValue({
      totalCount: 1,
      data: [{ id: "kit-stuck", name: "Acme" }],
    });
    brandApi.listBrandKitSections.mockResolvedValue([]);
    brandApi.listBrandKitFields.mockResolvedValue([]);
    const info = vi.fn();
    const noEnrichCtx: SyncContext = {
      ...ctx,
      logger: { info } as unknown as Logger,
      skipEnrichment: true,
    };

    const result = await brandKitKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "sections.Global Goals.Digital mandatories",
            summary: "Digital mandatories",
            after: ["foo"],
            meta: {
              stage: "field",
              section: "Global Goals",
              field: "Digital mandatories",
            },
          },
        ],
      },
      { kind: "brand-kit", id: "Acme" },
      noEnrichCtx
    );

    expect(brandApi.enrichBrandKitWithDocuments).not.toHaveBeenCalled();
    expect(brandApi.seedBrandKit).not.toHaveBeenCalled();
    expect(brandApi.updateBrandKitField).not.toHaveBeenCalled();
    expect(result.skipped.length).toBe(1);
    // Diagnostic message names the no-enrich opt-out so the operator
    // understands why nothing landed.
    const infoCalls = info.mock.calls.map(([msg]) => String(msg));
    expect(infoCalls.some((m) => m.includes("`--no-enrich` is set"))).toBe(true);
  });

  it("throws INPUT_INVALID when no kit change exists and the kit is not found", async () => {
    brandApi.listBrandKits.mockResolvedValue({ totalCount: 0, data: [] });

    await expect(
      brandKitKind.apply(
        {
          changes: [
            {
              kind: "update",
              path: "sections.A.B",
              summary: "B",
              after: "v",
              meta: { stage: "field", section: "A", field: "B" },
            },
          ],
        },
        { kind: "brand-kit", id: "Ghost" },
        ctx
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("pages findKitByName to locate a kit on a later page", async () => {
    brandApi.listBrandKits
      .mockResolvedValueOnce({ totalCount: 3, pageSize: 2, data: [{ id: "k1", name: "Globex" }] })
      .mockResolvedValueOnce({ totalCount: 3, pageSize: 2, data: [{ id: "k2", name: "Acme" }] });
    brandApi.listBrandKitSections.mockResolvedValue([{ id: "sec-1", name: "S" }]);
    brandApi.listBrandKitFields.mockResolvedValue([{ id: "fld-1", name: "F", type: "text" }]);
    brandApi.updateBrandKitField.mockResolvedValue({});

    const result = await brandKitKind.apply(
      {
        changes: [
          {
            kind: "update",
            path: "sections.S.F",
            summary: "F",
            after: "v",
            meta: { stage: "field", section: "S", field: "F" },
          },
        ],
      },
      ref,
      ctx
    );

    expect(brandApi.listBrandKits).toHaveBeenCalledTimes(2);
    expect(result.applied).toHaveLength(1);
  });

  it("passes richArray entry objects through toApiValue unchanged", async () => {
    brandApi.listBrandKits.mockResolvedValue({
      totalCount: 1,
      data: [{ id: "kit-1", name: "Acme" }],
    });
    brandApi.listBrandKitSections.mockResolvedValue([{ id: "sec-1", name: "S" }]);
    brandApi.listBrandKitFields.mockResolvedValue([
      { id: "fld-1", name: "Claims", type: "richArray" },
    ]);
    brandApi.updateBrandKitField.mockResolvedValue({});

    await brandKitKind.apply(
      {
        changes: [
          {
            kind: "update",
            path: "sections.S.Claims",
            summary: "Claims",
            after: [{ name: "Fast", tags: ["Marketing"] }],
            meta: { stage: "field", section: "S", field: "Claims" },
          },
        ],
      },
      ref,
      ctx
    );

    expect(brandApi.updateBrandKitField).toHaveBeenCalledWith(
      // tags preserved; restrictions filled to "" so the Sitecore AI
      // render never reads an undefined field.
      expect.objectContaining({ value: [{ name: "Fast", tags: ["Marketing"], restrictions: "" }] })
    );
  });

  it("passes array entry objects through toApiValue unchanged", async () => {
    // Recipe `array` fields are already object-shaped (`{name, id?}`);
    // toApiValue is now a thin type bridge, not a string→object converter.
    brandApi.listBrandKits.mockResolvedValue({
      totalCount: 1,
      data: [{ id: "kit-1", name: "Acme" }],
    });
    brandApi.listBrandKitSections.mockResolvedValue([{ id: "sec-1", name: "S" }]);
    brandApi.listBrandKitFields.mockResolvedValue([
      { id: "fld-1", name: "Pillars", type: "array" },
    ]);
    brandApi.updateBrandKitField.mockResolvedValue({});

    await brandKitKind.apply(
      {
        changes: [
          {
            kind: "update",
            path: "sections.S.Pillars",
            summary: "Pillars",
            after: [{ name: "Trust" }, { name: "Speed" }],
            meta: { stage: "field", section: "S", field: "Pillars" },
          },
        ],
      },
      ref,
      ctx
    );

    expect(brandApi.updateBrandKitField).toHaveBeenCalledWith(
      expect.objectContaining({ value: [{ name: "Trust" }, { name: "Speed" }] })
    );
  });

  it("records noop field changes as skipped", async () => {
    brandApi.listBrandKits.mockResolvedValue({
      totalCount: 1,
      data: [{ id: "kit-1", name: "Acme" }],
    });

    const result = await brandKitKind.apply(
      {
        changes: [
          {
            kind: "noop",
            path: "sections.A.B",
            summary: "B",
            after: "v",
            meta: { stage: "field", section: "A", field: "B" },
          },
        ],
      },
      ref,
      ctx
    );

    expect(brandApi.updateBrandKitField).not.toHaveBeenCalled();
    expect(result.skipped).toHaveLength(1);
    expect(result.applied).toHaveLength(0);
  });
});

describe("plan", () => {
  it("diffs the desired recipe against the live kit", async () => {
    brandApi.listBrandKits.mockResolvedValue({ totalCount: 0, data: [] });

    const recipePlan = await brandKitKind.plan(
      { name: "Acme", documents: [{ url: "https://x.test/a.pdf" }], sections: {} },
      ref,
      ctx
    );

    // Kit absent → the plan stages a kit-create change.
    expect(recipePlan.changes.some((c) => c.meta?.stage === "kit")).toBe(true);
  });
});

describe("readCurrent — value projection", () => {
  it("keeps a description and projects richArray entries with tags", async () => {
    brandApi.listBrandKits.mockResolvedValue({
      totalCount: 1,
      data: [{ id: "kit-1", name: "Acme", description: "A kit" }],
    });
    brandApi.listBrandKitSections.mockResolvedValue([{ id: "sec-1", name: "Messaging" }]);
    brandApi.listBrandKitFields.mockResolvedValue([
      {
        id: "fld-1",
        name: "Claims",
        type: "richArray",
        value: [{ id: "e1", name: "Fast", tags: ["Marketing"], restrictions: "no scarcity" }],
      },
    ]);

    const recipe = await brandKitKind.readCurrent(ref, ctx);
    expect(recipe?.description).toBe("A kit");
    expect(recipe?.sections.Messaging.Claims).toEqual([
      { name: "Fast", tags: ["Marketing"], restrictions: "no scarcity" },
    ]);
  });

  it("projects a richArray entry missing tags/restrictions with undefined slots", async () => {
    brandApi.listBrandKits.mockResolvedValue({
      totalCount: 1,
      data: [{ id: "kit-1", name: "Acme" }],
    });
    brandApi.listBrandKitSections.mockResolvedValue([{ id: "sec-1", name: "Messaging" }]);
    brandApi.listBrandKitFields.mockResolvedValue([
      {
        id: "fld-1",
        name: "Claims",
        type: "richArray",
        value: [
          { id: "e1", name: "Tagged", tags: ["Marketing"] },
          { id: "e2", name: "Plain" },
        ],
      },
    ]);

    const recipe = await brandKitKind.readCurrent(ref, ctx);
    expect(recipe?.sections.Messaging.Claims).toEqual([
      { name: "Tagged", tags: ["Marketing"], restrictions: undefined },
      { name: "Plain", tags: undefined, restrictions: undefined },
    ]);
  });

  it("drops empty-string and empty-array field values", async () => {
    brandApi.listBrandKits.mockResolvedValue({
      totalCount: 1,
      data: [{ id: "kit-1", name: "Acme" }],
    });
    brandApi.listBrandKitSections.mockResolvedValue([{ id: "sec-1", name: "S" }]);
    brandApi.listBrandKitFields.mockResolvedValue([
      { id: "f1", name: "Empty", type: "text", value: "" },
      { id: "f2", name: "EmptyArr", type: "array", value: [] },
    ]);

    const recipe = await brandKitKind.readCurrent(ref, ctx);
    // No fields survive → the section is not added at all.
    expect(recipe?.sections).toEqual({});
  });
});
