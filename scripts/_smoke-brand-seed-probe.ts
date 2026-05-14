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
  generateBrandReview,
  requestBrandApi,
  runBrandIngestionPipeline,
  uploadDocument,
  type BrandApiClientOptions,
} from "@/brand";
import { ScaiError } from "@/shared/errors";

/**
 * Build a minimal valid PDF carrying the given text as a single-page
 * document. Avoids a runtime PDF library dependency; the Documents
 * API only accepts PDFs so we cannot just upload a `.txt` payload.
 *
 * The structure follows the PDF 1.4 spec: catalog → pages → page →
 * content stream → font. Object offsets are tracked dynamically so
 * the xref table lines up regardless of the rendered text length.
 */
const makeMinimalPdf = (text: string): Buffer => {
  const escaped = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const lines = escaped.split("\n");
  const contentStream = lines
    .map((line, i) => `T* (${line}) Tj`)
    .join("\n")
    .replace("T* ", "");
  const stream = `BT /F1 12 Tf 50 750 Td 16 TL ${contentStream} ET`;
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${stream.length}>>stream\n${stream}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(body, "latin1");
};

const BRAND_GUIDELINES = [
  "Brand Voice Guidelines",
  "",
  "We are warm, energetic, and direct.",
  "We use active voice. We avoid jargon.",
  "We address the reader as 'you' and speak in plain language.",
  "We celebrate effort and capability, never gatekeep expertise.",
  "We use clear specifics over vague superlatives:",
  "  - 'cuts page load by 40%' not 'lightning fast'",
  "  - 'works on every browser since 2020' not 'universal compatibility'",
  "",
  "Tone of Voice",
  "",
  "Confident but not arrogant.",
  "Helpful but not condescending.",
  "Excited about real outcomes, not features.",
  "Direct about tradeoffs, never hide what does not work.",
].join("\n");

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

    // 2. Generate PDF
    process.stderr.write(`[2/6] generating minimal PDF...\n`);
    const pdf = makeMinimalPdf(BRAND_GUIDELINES);
    process.stderr.write(`      ok (${pdf.length} bytes)\n\n`);

    // 3. UPLOAD document
    process.stderr.write(`[3/6] uploading document to kit...\n`);
    const uploaded = await uploadDocument({
      client,
      brandKitId: kitId,
      pdf,
      fileName: "brand-guidelines.pdf",
      metadata: {
        title: "Brand Guidelines",
        summary: "Voice + tone rules for scai seed probe",
        type: "brand guidelines",
        fileType: "PDF",
        status: "draft",
      },
    });
    process.stderr.write(`      ok — documentId=${uploaded.id} status=${uploaded.status}\n\n`);

    // 4. RUN brand ingestion pipeline
    process.stderr.write(`[4/6] triggering brand ingestion pipeline...\n`);
    const run = await runBrandIngestionPipeline({
      client,
      brandKitId: kitId,
      populateSections: true,
      documentIds: [uploaded.id],
    });
    process.stderr.write(`      ok — runId=${run.id} pipelineName=${run.name ?? "?"}\n\n`);

    // 5. POLL sections until populated
    process.stderr.write(
      `[5/6] polling sections every ${pollIntervalSec}s (timeout ${timeoutSec}s)...\n`
    );
    type SectionList = {
      data?: Array<{ id?: string; name?: string; status?: string }>;
    };
    const deadline = Date.now() + timeoutSec * 1000;
    let sections: SectionList["data"] = [];
    let firstSectionId: string | undefined;
    while (Date.now() < deadline) {
      const list = await requestBrandApi<SectionList>(client, {
        basePath: BRAND_MANAGEMENT_BASE_PATH,
        path: `/api/brands/v1/organizations/${orgId}/brandkits/${kitId}/sections`,
        method: "GET",
      });
      sections = list.data ?? [];
      const elapsed = Math.round((Date.now() - (deadline - timeoutSec * 1000)) / 1000);
      process.stderr.write(
        `      [+${elapsed.toString().padStart(3, " ")}s] ${sections.length} section(s)\n`
      );
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
