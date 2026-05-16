/**
 * Real-tenant probe for the Brand Review API. Exercises the same code
 * path the CLI invokes (`generateBrandReview` + the shared auth /
 * client / scope-validation stack) so any wire-shape divergence
 * surfaces here before it surfaces in CI.
 *
 * Credentials come from scai's keychain entry — provision the AI
 * APIs key first with:
 *   scai login ai-skills --env <envName>   (interactive)
 * OR
 *   scai login ai-skills --env <envName> --client-id <id> --client-secret <secret>
 *
 * Usage:
 *   pnpm exec tsx -r tsconfig-paths/register \
 *     scripts/_smoke-brand-review-probe.ts <envName> <brandKitId> [<sectionId> [<fieldId>]]
 *
 *   <envName>       = env profile from sitecoreai.cli.json (default: sandbox).
 *                     Its `organizationId` selects the credential record.
 *   <brandKitId>    = UUID of the brand kit to evaluate against. Get this
 *                     from the Brand Management API List Brand Kits
 *                     endpoint until scai ships the read primitives.
 *   <sectionId>     = optional UUID; narrows the review to one section.
 *   <fieldId>       = optional UUID; further narrows to one subsection
 *                     within that section.
 *
 * The probe sends a small known-good text payload, then prints:
 *   - the resolved orgId + credential metadata
 *   - the wire request body (so any field-name divergence is visible)
 *   - the wire response (raw, before scai's normalization)
 *   - scai's normalized BrandReviewResult (overallScore + flattened
 *     sectionResults)
 *
 * Exits with 0 on success, with the ScaiError exitCode on a known
 * scai failure, or 99 on unhandled exceptions.
 */
import { readRootConfiguration } from "@/config/root-config";
import {
  acquireAiSkillsToken,
  AI_SKILLS_API_HOST,
  BRAND_MANAGEMENT_BASE_PATH,
  BRAND_REVIEW_BASE_PATH,
  generateBrandReview,
  requestBrandApi,
  type BrandApiClientOptions,
} from "@/brand";
import { ScaiError } from "@/shared/errors";

const PROBE_TEXT =
  "Unleash your potential with Powerful! At Powerful, we believe in fueling your active " +
  "lifestyle with clean, nutrient-dense energy solutions. Whether you are starting your " +
  "fitness journey or a seasoned athlete, our products are designed to empower you.";

const main = async (): Promise<void> => {
  const envName = process.argv[2] ?? "sandbox";
  const brandKitId = process.argv[3];
  const sectionId = process.argv[4];
  const fieldId = process.argv[5];

  if (!brandKitId) {
    process.stderr.write(
      "ERROR: brandKitId is required.\n" +
        "USAGE: tsx scripts/_smoke-brand-review-probe.ts <envName> <brandKitId> [<sectionId> [<fieldId>]]\n"
    );
    process.exit(2);
  }

  const root = readRootConfiguration(process.cwd(), envName);
  const env = root.environments[envName];
  if (!env) {
    process.stderr.write(`ERROR: env profile '${envName}' not found in sitecoreai.cli.json.\n`);
    process.exit(2);
  }
  const orgId = env.organizationId;
  if (!orgId) {
    process.stderr.write(`ERROR: env '${envName}' has no organizationId.\n`);
    process.exit(2);
  }
  const credential = root.aiSkills?.[orgId];
  if (!credential) {
    process.stderr.write(
      `ERROR: no AI Skills credential configured for org '${orgId}'. Run \`scai login ai-skills -n ${envName}\` first.\n`
    );
    process.exit(3);
  }

  process.stderr.write(`> env:        ${envName}\n`);
  process.stderr.write(`> orgId:      ${orgId}\n`);
  process.stderr.write(`> clientId:   ${credential.clientId}\n`);
  process.stderr.write(`> brandKitId: ${brandKitId}\n`);
  if (sectionId) {
    process.stderr.write(`> sectionId:  ${sectionId}${fieldId ? `:${fieldId}` : ""}\n`);
  }
  process.stderr.write(`> host:       ${AI_SKILLS_API_HOST}${BRAND_REVIEW_BASE_PATH}\n\n`);

  try {
    // Step 1: prove we can mint a token with the right scopes. Fails
    // early if the credential is broken before we send any payload.
    process.stderr.write("[1/3] minting Brand Review token...\n");
    const token = await acquireAiSkillsToken({ orgId, credential });
    process.stderr.write(`      ok (len=${token.length})\n\n`);

    // Step 2: list brand kits — verifies the kit UUID the caller
    // passed actually exists in this org. Server's Brand Review
    // 500s with `'name'` for a phantom kit, so this diagnostic
    // upgrades that to "kit not found" up front.
    process.stderr.write("[2/3] listing brand kits for the org...\n");
    const clientForList: BrandApiClientOptions = { orgId, credential };
    type BrandKitList = {
      totalCount?: number;
      data?: Array<{ id?: string; name?: string; status?: string }>;
      [key: string]: unknown;
    };
    const list = await requestBrandApi<BrandKitList>(clientForList, {
      basePath: BRAND_MANAGEMENT_BASE_PATH,
      path: `/api/brands/v1/organizations/${orgId}/brandkits`,
      method: "GET",
    });
    const kits = list.data ?? [];
    process.stderr.write(`      ok (${kits.length} kit(s) returned)\n`);
    for (const k of kits) {
      process.stderr.write(`      - ${k.id} ${k.name ?? "(unnamed)"} [${k.status ?? "?"}]\n`);
    }
    const kitFound = kits.some((k) => k.id === brandKitId);
    if (!kitFound) {
      process.stderr.write(
        `\nWARN: brandKitId '${brandKitId}' not in the list. Use one of the IDs above.\n`
      );
    }

    // Step 2b: list sections for the chosen kit. Empty / unpopulated
    // sections may be what's crashing the Brand Review server.
    process.stderr.write(`\n[2b/3] listing sections for kit '${brandKitId}'...\n`);
    type SectionList = {
      totalCount?: number;
      data?: Array<{ id?: string; name?: string; status?: string; intent?: string }>;
      [key: string]: unknown;
    };
    const sections = await requestBrandApi<SectionList>(clientForList, {
      basePath: BRAND_MANAGEMENT_BASE_PATH,
      path: `/api/brands/v1/organizations/${orgId}/brandkits/${brandKitId}/sections`,
      method: "GET",
    });
    const sectionRows = sections.data ?? [];
    process.stderr.write(`      ok (${sectionRows.length} section(s))\n`);
    for (const s of sectionRows) {
      process.stderr.write(`      - ${s.id} ${s.name ?? "(unnamed)"} [${s.status ?? "?"}]\n`);
    }
    if (sectionRows.length === 0) {
      process.stderr.write(
        "\nWARN: kit has no sections — Brand Review has nothing to evaluate against. The kit needs the Documents + Pipeline pass first to populate sections.\n"
      );
    }

    // Step 3: send the probe payload. This exercises:
    //   - request body shape (brandkitId lowercase, input map, sections[])
    //   - response normalization (reviews → flattened sectionResults)
    //   - overallScore aggregation (client-side min)
    process.stderr.write("[3/3] POST /api/skills/v1/brandreview/generate...\n");
    const client: BrandApiClientOptions = { orgId, credential };
    // Tap fetch so the request body is visible to the probe — the
    // server's error messages are opaque, so we want to see exactly
    // what scai sent over the wire.
    const realFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (
      url: Parameters<typeof globalThis.fetch>[0],
      init?: Parameters<typeof globalThis.fetch>[1]
    ): ReturnType<typeof globalThis.fetch> => {
      if (typeof url === "string" && url.includes("/brandreview/generate") && init?.body) {
        process.stderr.write(`\n=== wire request body ===\n${init.body}\n\n`);
      }
      return realFetch(url, init);
    };
    const result = await generateBrandReview({
      client,
      input: { text: PROBE_TEXT, label: "probe.txt" },
      selector: {
        brandKitId,
        sections: sectionId
          ? [{ sectionId, fieldIds: fieldId ? [fieldId] : undefined }]
          : undefined,
      },
    });
    process.stderr.write(`      ok\n\n`);

    // Pretty-print so divergences show up.
    process.stdout.write("=== scai-normalized BrandReviewResult ===\n");
    process.stdout.write(
      JSON.stringify(
        {
          overallScore: result.overallScore,
          sectionResultCount: result.sectionResults.length,
          sectionResults: result.sectionResults,
        },
        null,
        2
      ) + "\n\n"
    );
    process.stdout.write("=== raw response ===\n");
    process.stdout.write(JSON.stringify(result.raw, null, 2) + "\n");
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
