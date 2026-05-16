/**
 * Full end-to-end seed probe.
 *
 *   1. Create a fresh brand kit.
 *   2. Generate a minimal in-memory PDF carrying a few brand rules.
 *   3. Upload the PDF to the kit via the Documents API.
 *   4. Trigger the Brand Ingestion pipeline with populateSections=true.
 *   5. Poll the kit's sections list until at least one section
 *      appears OR a timeout expires.
 *   6. Run Brand Review against a sample piece of marketing copy.
 *
 * Proves the full "developer's-guide-to-Sitecore-AI" loop is wired in
 * scai end-to-end without leaving the CLI.
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register \
 *     scripts/_smoke-brand-seed-probe.ts [envName] [pollIntervalSec] [timeoutSec]
 *
 * Defaults: env=test, pollInterval=10s, timeout=300s.
 *
 * The probe creates a new kit each run. There is no Brand Management
 * DELETE endpoint — clean up manually via the Sitecore Stream UI.
 */
import { readRootConfiguration } from "@/config/root-config";
import {
  BRAND_MANAGEMENT_BASE_PATH,
  DOCUMENTS_BASE_PATH,
  generateBrandReview,
  requestBrandApi,
  runBrandIngestionPipeline,
  runEnrichSectionsPipeline,
  uploadDocument,
  type BrandApiClientOptions,
} from "@/brand";
import { ScaiError } from "@/shared/errors";

/**
 * Public PDF URL for the seed probe. Sitecore's v1 Documents endpoint
 * downloads the file from this URL to its own MMS storage — we don't
 * upload bytes directly. Any reasonably-sized public PDF works for
 * smoke testing; using a real brand-guidelines document gives
 * meaningful content for the ingestion pipeline to chunk.
 *
 * Override via `SCAI_BRAND_PROBE_PDF_URL` if you want to point at
 * your own hosted file.
 */
const PROBE_PDF_URL =
  process.env.SCAI_BRAND_PROBE_PDF_URL ??
  "https://www.eolss.net/sample-chapters/C01/E6-15-01-03.pdf";

const TEST_COPY = [
  "Hey there! Get ready because we are PUMPED to unveil the most",
  "revolutionary, game-changing, world-class platform in the industry.",
  "Our team has been crushing it for months and we cannot wait to",
  "share what we have built. You have never seen anything like it!",
].join("\n");

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "test";
  const pollIntervalSec = Number(process.argv[3] ?? "10");
  const timeoutSec = Number(process.argv[4] ?? "300");

  const root = readRootConfiguration(process.cwd(), envName);
  const env = root.environments[envName];
  if (!env?.organizationId) {
    process.stderr.write(`ERROR: env '${envName}' has no organizationId.\n`);
    process.exit(2);
  }
  const orgId = env.organizationId;
  const credential = root.aiSkills?.[orgId];
  if (!credential) {
    process.stderr.write(`ERROR: no AI Skills credential for org '${orgId}'.\n`);
    process.exit(3);
  }
  const client: BrandApiClientOptions = { orgId, credential };
  const kitName = `scai-seed-probe-${Date.now()}`;

  try {
    // 1. CREATE kit
    process.stderr.write(`[1/6] creating brand kit '${kitName}'...\n`);
    type Created = { id?: string; [k: string]: unknown };
    const created = await requestBrandApi<Created>(client, {
      basePath: BRAND_MANAGEMENT_BASE_PATH,
      path: `/api/brands/v1/organizations/${orgId}/brandkits`,
      method: "POST",
      body: {
        name: kitName,
        brandName: kitName,
        description: "scai end-to-end seed probe",
        industry: "developer-tools",
      },
    });
    const kitId = created.id;
    if (!kitId) {
      process.stderr.write(`ERROR: create returned no id.\n${JSON.stringify(created, null, 2)}\n`);
      process.exit(7);
    }
    process.stderr.write(`      ok — kitId=${kitId}\n\n`);

    // 2. (PDF is hosted at a URL — Sitecore downloads it)
    process.stderr.write(`[2/6] PDF source: ${PROBE_PDF_URL}\n\n`);

    // 3. UPLOAD document (Sitecore re-fetches the URL to MMS)
    process.stderr.write(`[3/6] uploading document to kit...\n`);
    // If SCAI_BRAND_PROBE_PDF_PATH is set, upload as local bytes via
    // base64 data URL — exercises the local-file path. Otherwise fall
    // back to URL fetch.
    const localPath = process.env.SCAI_BRAND_PROBE_PDF_PATH;
    let source: Parameters<typeof uploadDocument>[0]["source"];
    if (localPath) {
      const fs = await import("node:fs");
      const bytes = fs.readFileSync(localPath);
      process.stderr.write(`      [local-file mode] ${localPath} (${bytes.length} bytes)\n`);
      source = { kind: "bytes", bytes, mimeType: "application/pdf" };
    } else {
      source = { url: PROBE_PDF_URL };
    }
    const uploaded = await uploadDocument({
      client,
      brandKitId: kitId,
      source,
      title: "Brand Guidelines",
      summary: "scai seed probe",
      type: "brand guidelines",
      fileType: "application/pdf",
    });
    process.stderr.write(`      ok — documentId=${uploaded.id} status=${uploaded.status}\n\n`);

    // 3b. PATCH kit to status=published. Empirically the brand
    //     ingestion pipeline only successfully summarizes documents
    //     attached to a kit in `published` status. New kits land in
    //     `draft` and the pipeline silently fails (chunks but never
    //     summarizes) until they're published.
    process.stderr.write(`[3b/6] publishing kit...\n`);
    await requestBrandApi(client, {
      basePath: BRAND_MANAGEMENT_BASE_PATH,
      path: `/api/brands/v1/organizations/${orgId}/brandkits/${kitId}`,
      method: "PATCH",
      body: { status: "published" },
    });
    process.stderr.write(`      ok\n\n`);

    // 4. RUN both pipelines in sequence. BrandIngestionPipeline
    //    chunks the doc; EnrichSectionsPipeline is what actually
    //    populates the brand kit sections from the chunked content.
    //    Triggering just BrandIngestion leaves sections empty
    //    indefinitely — verified empirically 2026-05-14.
    process.stderr.write(`[4/6] triggering BrandIngestionPipeline...\n`);
    const run = await runBrandIngestionPipeline({
      client,
      brandKitId: kitId,
      populateSections: true,
      documentIds: [uploaded.id],
    });
    process.stderr.write(`      ok — runId=${run.id}\n`);
    process.stderr.write(`      triggering EnrichSectionsPipeline...\n`);
    const enrichRun = await runEnrichSectionsPipeline({
      client,
      brandKitId: kitId,
    });
    process.stderr.write(`      ok — runId=${enrichRun.id}\n\n`);

    // 5. POLL document status first (cheap signal); once processed,
    //    sections should be populated. Document status reaches
    //    `processed` if the AI extracted brand knowledge or `failed`
    //    if the PDF contents do not yield brand-shaped knowledge.
    process.stderr.write(
      `[5/6] polling status every ${pollIntervalSec}s (timeout ${timeoutSec}s)...\n`
    );
    type DocStatus = {
      id?: string;
      status?: string;
      chunked?: boolean;
      summarized?: boolean;
      numberOfPages?: number;
    };
    // Sections list returns a bare array (not a paginated envelope) —
    // verified empirically.
    type SectionList = Array<{ id?: string; name?: string }>;
    const deadline = Date.now() + timeoutSec * 1000;
    let sections: SectionList = [];
    let firstSectionId: string | undefined;
    while (Date.now() < deadline) {
      const doc = await requestBrandApi<DocStatus>(client, {
        basePath: DOCUMENTS_BASE_PATH,
        path: `/api/documents/v2/organizations/${orgId}/documents/${uploaded.id}`,
        method: "GET",
      });
      sections = await requestBrandApi<SectionList>(client, {
        basePath: BRAND_MANAGEMENT_BASE_PATH,
        path: `/api/brands/v1/organizations/${orgId}/brandkits/${kitId}/sections`,
        method: "GET",
      });
      const elapsed = Math.round((Date.now() - (deadline - timeoutSec * 1000)) / 1000);
      process.stderr.write(
        `      [+${elapsed.toString().padStart(3, " ")}s] doc=${doc.status ?? "?"} ` +
          `chunked=${doc.chunked} ${sections.length} section(s)\n`
      );
      // doc.status going to "failed" is misleading — sections still
      // populate via EnrichSectionsPipeline. Keep polling.
      if (sections.length > 0) {
        firstSectionId = sections[0].id;
        break;
      }
      await sleep(pollIntervalSec * 1000);
    }
    if (sections.length === 0) {
      process.stderr.write(
        `\nERROR: timed out waiting for ingestion to populate sections.\nKit '${kitName}' (${kitId}) is still on the tenant.\n`
      );
      process.exit(8);
    }
    process.stderr.write(`      sections appeared.\n`);
    for (const s of sections) {
      process.stderr.write(`      - ${s.id} ${s.name ?? "(unnamed)"} [${s.status ?? "?"}]\n`);
    }

    // 6. RUN brand review against the now-populated kit
    process.stderr.write(`\n[6/6] running brand review against the populated kit...\n`);
    const result = await generateBrandReview({
      client,
      input: { text: TEST_COPY, label: "test-copy.txt" },
      selector: {
        brandKitId: kitId,
        sections: firstSectionId ? [{ sectionId: firstSectionId }] : undefined,
      },
    });
    process.stderr.write(`      ok\n\n`);
    process.stdout.write("=== Brand Review result ===\n");
    process.stdout.write(
      JSON.stringify(
        {
          overallScore: result.overallScore,
          sectionResultCount: result.sectionResults.length,
          sectionResults: result.sectionResults,
        },
        null,
        2
      ) + "\n"
    );
    process.stderr.write(
      `\nKit '${kitName}' (${kitId}) and document ${uploaded.id} left on the tenant. Clean up via Sitecore Stream UI.\n`
    );
  } catch (err) {
    if (err instanceof ScaiError) {
      process.stderr.write(`\nFAIL [${err.code}] ${err.message}\n`);
      if (err.hint) {
        process.stderr.write(`HINT  ${err.hint}\n`);
      }
      process.exit(err.exitCode);
    }
    throw err;
  }
};

main().catch((err) => {
  process.stderr.write(
    `unhandled: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`
  );
  process.exit(99);
});
