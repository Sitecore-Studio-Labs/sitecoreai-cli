import type { BrandApiClientOptions } from "./api/client";
import { createBrandKit, publishBrandKit, type CreateBrandKitOptions } from "./kits/create";
import { listBrandKitSections, type BrandKitSectionSummary } from "./kits/sections";
import {
  uploadDocument,
  type UploadDocumentSource,
  type UploadedDocument,
} from "./documents/upload";
import { runBrandIngestionPipeline, runEnrichSectionsPipeline } from "./pipeline/run";
import type { BrandKitSummary } from "./kits/list";
import type { BrandDocument } from "./recipe/schema";
import { createScaiError } from "@/shared/errors";

/**
 * Stage labels emitted via `onProgress`. Useful for callers that
 * surface progress (CLI streaming output, MCP progress events).
 */
export type SeedStage =
  | "createKit"
  | "uploadDocument"
  | "publishKit"
  | "runIngestion"
  | "runEnrichment"
  | "pollSections"
  | "done";

export interface SeedProgressEvent {
  stage: SeedStage;
  /** Wall-clock elapsed seconds since seed start. */
  elapsedSec: number;
  message: string;
  /** Populated when sections exist. */
  sectionCount?: number;
}

export interface SeedBrandKitOptions {
  client: BrandApiClientOptions;
  /** Display name + brand name for the new kit. */
  name: string;
  /**
   * Single source PDF. Must be a publicly reachable URL — Sitecore
   * fetches it server-side. Optional when `documents` is provided;
   * exactly one of `source` / `documents` must be set.
   */
  source?: UploadDocumentSource | { url: string };
  /**
   * Multiple source documents — uploaded before a single ingestion +
   * enrichment pass. Takes precedence over `source` when non-empty.
   * Accepts the recipe-shaped `BrandDocument` union (URL or
   * registry-file). The seed runner rejects `registry-file` entries
   * with `INPUT_INVALID` and a clear hint — see the
   * `LOCAL_UPLOAD_UNSUPPORTED_MESSAGE` rationale in
   * `documents/upload.ts` for why bytes uploads don't work end-to-end.
   * Callers (orchestrator's `brandkit_deploy` handler) must translate
   * registry-file paths to public URLs before invoking scai.
   */
  documents?: BrandDocument[];
  /** Optional kit metadata. */
  description?: string;
  industry?: string;
  /** Document metadata for the single-`source` path. */
  documentTitle?: string;
  documentSummary?: string;
  /** Poll interval for the sections endpoint, seconds. Default 15. */
  pollIntervalSec?: number;
  /** Hard timeout for waiting on sections to appear, seconds. Default 900. */
  timeoutSec?: number;
  /** Callback for stage transitions + polling ticks. */
  onProgress?: (event: SeedProgressEvent) => void;
  signal?: AbortSignal;
}

export interface SeedBrandKitResult {
  kit: BrandKitSummary;
  document: UploadedDocument;
  sections: BrandKitSectionSummary[];
  /** Total wall-clock seconds spent. */
  elapsedSec: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The headline composite — drive a brand kit from "doesn't exist" to
 * "has populated sections and is ready for Brand Review" in one call.
 *
 * Sequence (see [[project-scai-brand-kit-seed-recipe]]):
 *
 *   1. createBrandKit          → draft kit
 *   2. uploadDocument          → doc attached (status: pending)
 *   3. publishBrandKit         → kit status: published (required!)
 *   4. runBrandIngestionPipeline (chunks the doc)
 *   5. runEnrichSectionsPipeline  (populates sections from chunks)
 *   6. poll listBrandKitSections until the count goes from 0 to >0
 *   7. return kit + doc + section list
 *
 * The `doc.status` going to `failed` mid-flight is misleading and
 * NOT a real error — sections still populate via enrichment, so the
 * composite ignores that signal and only cares about section count.
 *
 * Cost note: this triggers two paid AI pipeline runs. Each run takes
 * ~5 min wall-clock. Don't loop this without consent.
 */
export const seedBrandKit = async (options: SeedBrandKitOptions): Promise<SeedBrandKitResult> => {
  const start = Date.now();
  const pollIntervalSec = options.pollIntervalSec ?? 15;
  const timeoutSec = options.timeoutSec ?? 900;
  const emit = (event: Omit<SeedProgressEvent, "elapsedSec">): void => {
    options.onProgress?.({
      ...event,
      elapsedSec: Math.round((Date.now() - start) / 1000),
    });
  };

  // 1. CREATE kit
  emit({ stage: "createKit", message: `Creating brand kit '${options.name}'…` });
  const createInput: CreateBrandKitOptions = {
    client: options.client,
    name: options.name,
    description: options.description,
    industry: options.industry,
  };
  const kit = await createBrandKit(createInput);
  emit({ stage: "createKit", message: `Created kit ${kit.id}` });

  // 2. UPLOAD doc(s) — one or many, before a single ingestion pass.
  //
  // The `documents` list is the recipe-shaped discriminated union.
  // `registry-file` entries arrive unresolved (path relative to the
  // recipe file) and CANNOT be uploaded as bytes — the Sitecore
  // Documents API has no working local-upload path (verified
  // 2026-05-15; see documents/upload.ts). The caller (orchestrator's
  // `brandkit_deploy` handler) must translate them to URL entries
  // first. Failing fast here — with the path in the hint — beats
  // a confusing 400 from `uploadDocument` minutes later.
  if (options.documents) {
    for (const doc of options.documents) {
      if (doc.kind === "registry-file") {
        throw createScaiError(
          `Brand document "${doc.path}" is a registry-file path; scai cannot upload local bytes.`,
          "INPUT_INVALID",
          {
            hint: 'Host the file at an HTTPS URL Sitecore\'s edge can reach (S3, GitHub raw, a CDN) and pass it as a `{ kind: "url", url }` document. The Sitecore Documents API rejects local-file uploads — translation has to happen upstream of scai.',
          }
        );
      }
    }
  }
  const uploadList: {
    source: UploadDocumentSource | { url: string };
    title?: string;
    summary?: string;
  }[] =
    options.documents && options.documents.length > 0
      ? options.documents.map((doc) => {
          // After the registry-file guard above, every doc is a URL
          // variant; the narrow keeps the TS surface clean.
          if (doc.kind !== "url") {
            throw createScaiError(
              "Unreachable: non-URL document survived the registry-file guard.",
              "INPUT_INVALID"
            );
          }
          return {
            source: { url: doc.url },
            title: doc.title,
            summary: doc.summary,
          };
        })
      : options.source
        ? [
            {
              source: options.source,
              title: options.documentTitle,
              summary: options.documentSummary,
            },
          ]
        : [];
  if (uploadList.length === 0) {
    throw createScaiError("seedBrandKit requires `source` or `documents`.", "INPUT_INVALID");
  }
  const documents: UploadedDocument[] = [];
  for (const [index, entry] of uploadList.entries()) {
    emit({
      stage: "uploadDocument",
      message: `Uploading source document ${index + 1}/${uploadList.length}…`,
    });
    const uploaded = await uploadDocument({
      client: options.client,
      brandKitId: kit.id,
      source: entry.source,
      title: entry.title ?? `${options.name} Brand Guidelines`,
      summary: entry.summary ?? `Source doc for ${options.name} brand kit (seeded via scai)`,
      type: "brand guidelines",
      fileType: "application/pdf",
    });
    documents.push(uploaded);
    emit({ stage: "uploadDocument", message: `Uploaded document ${uploaded.id}` });
  }
  const document = documents[0];

  // 3. PUBLISH kit (REQUIRED before pipelines)
  emit({ stage: "publishKit", message: "Publishing kit…" });
  await publishBrandKit({ client: options.client, brandKitId: kit.id });
  emit({ stage: "publishKit", message: "Kit published" });

  // 4. RUN brand ingestion (chunks the doc)
  emit({ stage: "runIngestion", message: "Triggering BrandIngestionPipeline…" });
  const ingestionRun = await runBrandIngestionPipeline({
    client: options.client,
    brandKitId: kit.id,
    populateSections: true,
    documentIds: documents.map((doc) => doc.id),
  });
  emit({
    stage: "runIngestion",
    message: `Ingestion run started: ${ingestionRun.id}`,
  });

  // 5. RUN enrich sections (populates section content from chunks)
  emit({ stage: "runEnrichment", message: "Triggering EnrichSectionsPipeline…" });
  const enrichmentRun = await runEnrichSectionsPipeline({
    client: options.client,
    brandKitId: kit.id,
  });
  emit({
    stage: "runEnrichment",
    message: `Enrichment run started: ${enrichmentRun.id}`,
  });

  // 6. POLL sections until they appear
  const deadline = Date.now() + timeoutSec * 1000;
  let sections: BrandKitSectionSummary[] = [];
  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      throw new Error("seedBrandKit aborted by signal");
    }
    sections = await listBrandKitSections({
      client: options.client,
      brandKitId: kit.id,
    });
    emit({
      stage: "pollSections",
      message: `Sections: ${sections.length}`,
      sectionCount: sections.length,
    });
    if (sections.length > 0) {
      break;
    }
    await sleep(pollIntervalSec * 1000);
  }
  if (sections.length === 0) {
    throw new Error(
      `Timed out after ${timeoutSec}s waiting for sections to populate. Kit ${kit.id} is on the tenant; check status manually with \`scai brand kits sections ${kit.id}\`.`
    );
  }
  emit({
    stage: "done",
    message: `Seeded ${sections.length} sections for kit ${kit.id}`,
    sectionCount: sections.length,
  });

  return {
    kit,
    document,
    sections,
    elapsedSec: Math.round((Date.now() - start) / 1000),
  };
};
